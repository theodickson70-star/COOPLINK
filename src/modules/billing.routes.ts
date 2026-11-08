// =====================================================================
//  ADA ZA COOPLINK — upande wa chama (Meneja pekee ndiye mhusika mkuu wa kulipa)
//  Njia hizi zinapatikana HATA chama kikiwa kimefungwa kwa ada, ili Meneja alipe.
// =====================================================================
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { AppError, notFound } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { ensureSeasonFee, feeLock, feesOverview, issueControlNumber, receiptOf, syncControlNumber } from '../lib/fees';
import { getSetting } from '../lib/settings';
import { TeePayError } from '../lib/teepay';

export const billingRouter = Router();
billingRouter.use(requireRole(['AMCOS_ADMIN']));

const ownFee = async (req: Request, id: string) => {
  const [f] = await db.select().from(schema.platformFees).where(and(eq(schema.platformFees.id, id), eq(schema.platformFees.amcosId, req.auth!.amcosId!)));
  if (!f) throw notFound('Ada');
  return f;
};
const teepayFail = (e: unknown) => {
  if (e instanceof TeePayError) return new AppError(502, 'TEEPAY_ERROR', `TeePay: ${e.message}. Jaribu tena baada ya muda mfupi.`);
  return e;
};

billingRouter.get('/', ah(async (req, res) => {
  const amcosId = req.auth!.amcosId!;
  await db.transaction((tx) => ensureSeasonFee(tx, amcosId));
  const c = await getSetting('fees');
  res.json({ ...(await feesOverview(amcosId)), config: { entranceFee: c.entranceFee, seasonFee: c.seasonFee, seasonInstallments: c.seasonInstallments, entranceDays: c.entranceDays, deadlineDay: c.deadlineDay, deadlineMonth: c.deadlineMonth } });
}));

billingRouter.post('/fees/:id/control-number', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { amount } = z.object({ amount: decimalSchema({ min: 1 }) }).parse(req.body);
  await ownFee(req, id);
  const cn = await issueControlNumber(id, amount, req.auth!.userId).catch((e) => { throw teepayFail(e); });
  const { request: _r, idempotencyKey: _k, ...out } = cn;
  res.status(201).json({ controlNumber: out });
}));

billingRouter.post('/control-numbers/:id/sync', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [cn] = await db.select().from(schema.platformControlNumbers).where(and(eq(schema.platformControlNumbers.id, id), eq(schema.platformControlNumbers.amcosId, req.auth!.amcosId!)));
  if (!cn) throw notFound('Control number');
  const r = await syncControlNumber(id).catch((e) => { throw teepayFail(e); });
  res.json({ recorded: r.recorded.map((p) => ({ id: p.id, receiptNo: p.invoiceNo, amount: p.amount })), status: r.cn.status, number: r.cn.number, lock: await feeLock(req.auth!.amcosId!, { fresh: true }) });
}));

billingRouter.get('/receipts/:id', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  res.json(await receiptOf(id, req.auth!.amcosId!));
}));

/**
 * Chama kimefungwa kwa ada ambayo haijalipwa -> kila njia ya data ya chama inazuiwa (402).
 * Meneja anabaki na /billing (imewekwa KABLA ya mlinzi huu) ili alipe.
 */
export async function feeGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const amcosId = req.auth?.amcosId;
    if (!amcosId) return next();
    const lock = await feeLock(amcosId);
    if (!lock) return next();
    const who = req.auth!.role === 'AMCOS_ADMIN' ? 'Lipia kwenye ukurasa wa "Ada ya CoopLink"' : 'Meneja wa chama alipie';
    next(new AppError(402, 'FEES_LOCKED', `Chama kimefungwa kwa sababu ${lock.label.toLowerCase()} (${lock.outstanding}) haijalipwa tangu ${lock.dueDate}. ${who}; kitafunguka papo hapo malipo yakithibitishwa.`, { lock }));
  } catch (e) { next(e); }
}
