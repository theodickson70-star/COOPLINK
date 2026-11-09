// =====================================================================
//  ADA ZA COOPLINK — upande wa chama (Mhasibu ndiye mhusika wa kulipa; Meneja anaona — analipa kama hakuna Mhasibu)
//  Njia hizi zinapatikana HATA chama kikiwa kimefungwa kwa ada, ili mlipaji alipe.
// =====================================================================
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, normalizePhone, uuidParam } from '../lib/http';
import { AppError, badRequest, notFound } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { PAYER_LABEL, feePayerRole, PROVIDER_NAME, type Provider, abandonMobilePayment, ensureSeasonFee, feeLock, feesOverview, receiptOf, requestMobilePayment, syncMobilePayment } from '../lib/fees';
import { getSetting } from '../lib/settings';
import { lookupNameOrNull } from '../lib/name-lookup';
import { TeePayError } from '../lib/teepay';

export const billingRouter = Router();
const MP = schema.platformMobilePayments;
// Mhasibu ndiye analipa ada ya CoopLink; Meneja anaona hali na risiti (analipa tu kama chama hakina Mhasibu).
billingRouter.use(requireRole(['AMCOS_ADMIN', 'ACCOUNTANT']));
billingRouter.use(ah(async (req, _res, next) => {
  const payer = await feePayerRole(req.auth!.amcosId!);
  req.feePayer = { role: payer, isPayer: req.auth!.role === payer };
  // Chama kimefungwa: mlipaji peke yake ndiye anabaki (hata Meneja anazuiwa kama kuna Mhasibu)
  if (!req.feePayer.isPayer) {
    const lock = await feeLock(req.auth!.amcosId!);
    if (lock) throw new AppError(402, 'FEES_LOCKED', `Chama kimefungwa kwa sababu ${lock.label.toLowerCase()} (${lock.outstanding}) haijalipwa. ${PAYER_LABEL[payer]} alipie; kitafunguka papo hapo.`, { lock });
  }
  next();
}));
const payerOnly = (req: Request) => {
  if (!req.feePayer?.isPayer) throw new AppError(403, 'FEE_PAYER_ONLY', `Ada ya CoopLink inalipwa na ${PAYER_LABEL[req.feePayer!.role]} wa chama.`);
};

const ownFee = async (req: Request, id: string) => {
  const [f] = await db.select().from(schema.platformFees).where(and(eq(schema.platformFees.id, id), eq(schema.platformFees.amcosId, req.auth!.amcosId!)));
  if (!f) throw notFound('Ada');
  return f;
};
const teepayFail = (e: unknown) => {
  if (e instanceof TeePayError) return new AppError(502, 'PAYMENT_PROVIDER_ERROR', `Malipo: ${e.message}. Jaribu tena baada ya muda mfupi.`);
  return e;
};

billingRouter.get('/', ah(async (req, res) => {
  const amcosId = req.auth!.amcosId!;
  await db.transaction((tx) => ensureSeasonFee(tx, amcosId));
  const c = await getSetting('fees');
  res.json({ ...(await feesOverview(amcosId)), payer: { role: req.feePayer!.role, label: PAYER_LABEL[req.feePayer!.role], isMe: req.feePayer!.isPayer }, config: { entranceFee: c.entranceFee, seasonFee: c.seasonFee, seasonInstallments: c.seasonInstallments, entranceDays: c.entranceDays, deadlineDay: c.deadlineDay, deadlineMonth: c.deadlineMonth } });
}));

// Ombi la malipo kwa simu: Meneja anaweka namba ya simu (yake au ya mlipaji mwingine), jina kamili na email
billingRouter.post('/fees/:id/pay', ah(async (req, res) => {
  payerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const b = z.object({
    amount: decimalSchema({ min: 1 }),
    phone: z.string().trim().min(9, 'Weka namba ya simu'),
    name: z.string().trim().min(3).max(120).refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, 'Weka jina kamili: la kwanza na la mwisho'),
    email: z.string().trim().email('Weka email halali (TeePay wanaihitaji)'),
  }).parse(req.body);
  const phone = normalizePhone(b.phone);
  if (!phone || !/^255[67]\d{8}$/.test(phone)) throw badRequest('Namba ya simu si sahihi. Mfano: 0712345678');
  b.name = (await lookupNameOrNull(phone, 'Namba ya simu itakayolipa')) ?? b.name; // jina kutoka mobile money
  await ownFee(req, id);
  // Ombi la zamani lililo wazi: lihakikiwe kwanza ili lisilipwe mara mbili
  const open = await db.select({ id: MP.id }).from(MP).where(and(eq(MP.feeId, id), inArray(MP.status, ['SENDING', 'PENDING'])));
  for (const o of open) await syncMobilePayment(o.id).catch(() => undefined);
  const r = await requestMobilePayment(id, b.amount, { phone, name: b.name, email: b.email }, req.auth!.userId).catch((e) => { throw teepayFail(e); });
  const { request: _r, idempotencyKey: _k, ...out } = r.mp;
  const failedOver = r.tried.length > 1 ? { from: PROVIDER_NAME[r.tried[0].provider as Provider], to: PROVIDER_NAME[r.mp.provider as Provider], reason: r.tried[0].lastError } : null;
  res.status(201).json({ payment: { ...out, phoneLocal: '0' + phone.slice(3), providerName: PROVIDER_NAME[r.mp.provider as Provider] }, failedOver });
}));

billingRouter.post('/payments/:id/sync', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [mp] = await db.select().from(MP).where(and(eq(MP.id, id), eq(MP.amcosId, req.auth!.amcosId!)));
  if (!mp) throw notFound('Malipo');
  const r = await syncMobilePayment(id).catch((e) => { throw teepayFail(e); });
  res.json({
    status: r.mp.status, statusDetail: r.mp.statusDetail, lastError: r.mp.lastError,
    recorded: r.recorded ? { id: r.recorded.id, receiptNo: r.recorded.invoiceNo, amount: r.recorded.amount } : null,
    lock: await feeLock(req.auth!.amcosId!, { fresh: true }),
  });
}));

// "Push haijafika": Meneja anaghairi ombi ili aombe tena (ombi linaendelea kuhakikiwa TeePay nyuma)
billingRouter.post('/payments/:id/cancel', ah(async (req, res) => {
  payerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const [mp] = await db.select().from(MP).where(and(eq(MP.id, id), eq(MP.amcosId, req.auth!.amcosId!)));
  if (!mp) throw notFound('Malipo');
  const r = await abandonMobilePayment(id, req.auth!.userId);
  if (r.mp.status === 'SUCCEEDED') return res.json({ status: 'SUCCEEDED', message: 'Malipo haya tayari yamethibitishwa — hayawezi kughairiwa.' });
  res.json({ status: r.mp.status, abandoned: r.abandoned });
}));

billingRouter.get('/receipts/:id', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  res.json(await receiptOf(id, req.auth!.amcosId!));
}));

/**
 * Chama kimefungwa kwa ada ambayo haijalipwa -> kila njia ya data ya chama inazuiwa (402).
 * Mlipaji (Mhasibu, au Meneja kama hakuna Mhasibu) anabaki na /billing (imewekwa KABLA ya mlinzi huu) ili alipe.
 */
export async function feeGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const amcosId = req.auth?.amcosId;
    if (!amcosId) return next();
    const lock = await feeLock(amcosId);
    if (!lock) return next();
    const payer = await feePayerRole(amcosId);
    const who = req.auth!.role === payer ? 'Lipia kwenye ukurasa wa "Ada ya CoopLink"' : `${PAYER_LABEL[payer]} wa chama alipie`;
    next(new AppError(402, 'FEES_LOCKED', `Chama kimefungwa kwa sababu ${lock.label.toLowerCase()} (${lock.outstanding}) haijalipwa tangu ${lock.dueDate}. ${who}; kitafunguka papo hapo malipo yakithibitishwa.`, { lock }));
  } catch (e) { next(e); }
}
