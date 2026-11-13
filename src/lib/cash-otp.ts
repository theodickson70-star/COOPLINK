// =====================================================================
//  FEDHA TASLIMU KWA OTP (v0.40)
//   Mkulima akipokea fedha taslimu (malipo ya mauzo, mkopo wa kuni/grading/miti, au malipo mengine), anatumiwa namba ya
//   uthibitisho na kuitaja akishashika fedha. Mhasibu hawezi kuthibitisha malipo ya taslimu bila namba hiyo.
//   Mkulima hana simu? Meneja (approvals.decide) pekee anaruhusu kwa sababu — inaandikwa kwenye audit.
//   OTP ikiwa imezimwa na Owner (au SMS hazijawekwa), malipo yanaendelea kama zamani.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah } from './http';
import { AppError, badRequest, forbidden, notFound } from './errors';
import { issueOtp, verifiedSet, verifyOtp } from './otp';
import { smsConfigured, smsEnabled } from './sms';
import { farmerPhone } from './sms-events';
import { canAmcos } from './amcos-permissions';
import { amcosScope } from '../middleware/tenant';
import { D } from './money';

export const CASH_OTP_MINUTES = 120;
type Target = 'payment' | 'loan' | 'txn';
const LOAN_LABEL: Record<string, string> = { KUNI: 'mkopo wa kuni', GRADING: 'mkopo wa grading', TREES: 'mkopo wa miti' };

export async function cashOtpOn() {
  return smsConfigured() && (await smsEnabled('CASH_PAYOUT_OTP'));
}

/** Rekodi ya malipo ya taslimu (ndani ya chama cha mtumiaji) + mkulima */
async function target(req: Request, type: Target, id: string) {
  if (type === 'payment') {
    const P = schema.payments;
    const [p] = await db.select().from(P).where(and(eq(P.id, id), amcosScope(req, P.amcosId)));
    if (!p) throw notFound('Malipo');
    if (!canAmcos(req.auth!, 'sales.manage')) throw forbidden('Huna ruhusa ya malipo ya mauzo');
    return { amcosId: p.amcosId, memberId: p.memberId, amount: p.amount, cash: p.method === 'CASH', open: p.status === 'PENDING' || p.status === 'FAILED', label: 'malipo ya mauzo ya tumbaku' };
  }
  if (type === 'loan') {
    const L = schema.kuniLoans;
    const [l] = await db.select().from(L).where(and(eq(L.id, id), amcosScope(req, L.amcosId)));
    if (!l) throw notFound('Mkopo');
    if (!canAmcos(req.auth!, 'finance.record')) throw forbidden('Huna ruhusa ya kurekodi fedha');
    return { amcosId: l.amcosId, memberId: l.memberId, amount: l.amount, cash: l.method === 'CASH', open: l.status === 'PENDING' || l.status === 'FAILED', label: LOAN_LABEL[l.loanType] ?? 'mkopo' };
  }
  const T = schema.financeTransactions;
  const [t] = await db.select().from(T).where(and(eq(T.id, id), amcosScope(req, T.amcosId)));
  if (!t || t.kind !== 'FARMER_PAYMENT' || !t.memberId) throw notFound('Malipo ya mkulima');
  if (!canAmcos(req.auth!, 'finance.post')) throw forbidden('Huna ruhusa ya kukamilisha malipo');
  return { amcosId: t.amcosId, memberId: t.memberId, amount: t.amount, cash: true, open: t.status === 'APPROVED', label: 'malipo' };
}

export const cashOtpRouter = Router();
const params = z.object({ type: z.enum(['payment', 'loan', 'txn']), id: z.string().uuid() });

cashOtpRouter.post('/:type/:id/otp', ah(async (req, res) => {
  const { type, id } = params.parse(req.params);
  if (!(await cashOtpOn())) throw badRequest('OTP ya kupokea fedha taslimu haijawashwa');
  const t = await target(req, type, id);
  if (!t.open) throw badRequest('Malipo haya hayasubiri kukabidhiwa');
  const m = await db.query.members.findFirst({ where: eq(schema.members.id, t.memberId) });
  if (!m) throw notFound('Mkulima');
  const amcos = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, t.amcosId), columns: { name: true } });
  const amt = `TSh ${D(t.amount).toDecimalPlaces(0).toNumber().toLocaleString('en-US')}`;
  const o = await issueOtp({ purpose: 'CASH_PAYOUT', kind: 'CASH_PAYOUT_OTP', subjectId: id, phone: farmerPhone(m), amcosId: t.amcosId, memberId: m.id, createdById: req.auth!.userId, ip: req.ip ?? null,
    payload: { type, amount: t.amount },
    text: (c) => `${amcos?.name ?? 'Chama'}: ${m.firstName}, unakabidhiwa taslimu ${amt} (${t.label}). Namba ya uthibitisho: ${c}. Itaje TU ukishashika fedha mkononi.` });
  res.json(o);
}));

cashOtpRouter.post('/:type/:id/otp/verify', ah(async (req, res) => {
  const { type, id } = params.parse(req.params);
  const { code } = z.object({ code: z.string().trim().min(4).max(10) }).parse(req.body);
  await target(req, type, id);
  await verifyOtp('CASH_PAYOUT', id, code);
  res.json({ verified: true });
}));

/**
 * Kabla ya kuthibitisha malipo ya taslimu: kila moja liwe limethibitishwa kwa OTP (saa 2 zilizopita),
 * au Meneja aandike sababu. Inarudisha njia iliyotumika kwa kila malipo (kwa audit).
 */
export async function assertCashConfirmed(req: Request, items: { id: string; memberNo: string }[], override?: string | null) {
  const out = new Map<string, 'OTP' | 'OVERRIDE' | 'NONE'>();
  if (!items.length) return out;
  if (!(await cashOtpOn())) { for (const i of items) out.set(i.id, 'NONE'); return out; }
  const ok = await verifiedSet('CASH_PAYOUT', items.map((i) => i.id), CASH_OTP_MINUTES);
  const missing = items.filter((i) => !ok.has(i.id));
  if (missing.length) {
    if (!override || override.trim().length < 10) {
      throw new AppError(400, 'CASH_OTP_REQUIRED', `Malipo ya taslimu hayajathibitishwa na mkulima kwa OTP: ${missing.slice(0, 8).map((m) => m.memberNo).join(', ')}${missing.length > 8 ? ` na ${missing.length - 8} zaidi` : ''}`);
    }
    if (!canAmcos(req.auth!, 'approvals.decide')) throw forbidden('Meneja pekee ndiye anaweza kuthibitisha taslimu bila OTP ya mkulima');
  }
  for (const i of items) out.set(i.id, ok.has(i.id) ? 'OTP' : 'OVERRIDE');
  return out;
}
