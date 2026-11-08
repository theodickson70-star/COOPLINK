// =====================================================================
//  PESA YA KUNI — mikopo ya fedha kwa wakulima
//   Mipangilio ya msimu (Mhasibu): riba % kwa msimu, kikomo TZS kwa ekari, wazi/imefungwa
//   Kikomo cha mkulima = ekari za makisio yaliyoidhinishwa x kiasi kwa ekari - alichokwisha kukopa msimu huu
//   Mhasibu anaandaa orodha -> Meneja anaidhinisha -> pesa zinatumwa kwenye akaunti za wakulima
//   -> Mhasibu anathibitisha waliolipwa (mkopo + riba vinaingia kwenye deni la mkulima)
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import * as ledger from '../lib/ledger';
import { createApproval } from '../lib/approvals';
import { accountBalance, lockAccount, nextTxnNo } from '../lib/finance';
import { postJournal } from '../lib/gl';
import { destinationOf } from '../lib/payout';
import { assertOpen } from '../lib/periods';
import { currentSeason } from './seasons.routes';
import { todayStr } from './accounting.routes';
import { toCsv } from './owner/common';

export const kuniRouter = Router();
const KS = schema.kuniSettings;
const KB = schema.kuniBatches;
const KL = schema.kuniLoans;
const M = schema.members;
const E = schema.estimates;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function season() {
  const s = await currentSeason();
  if (!s) throw badRequest('Hakuna msimu unaoendelea');
  return s;
}

async function settingsOf(amcosId: string, seasonId: string) {
  const [s] = await db.select().from(KS).where(and(eq(KS.amcosId, amcosId), eq(KS.seasonId, seasonId)));
  return s ?? null;
}

kuniRouter.get('/settings', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const s = await season();
  const st = await settingsOf(amcosId, s.id);
  res.json({ season: s, settings: st ?? { interestRate: '0', amountPerAcre: '0', isOpen: false, configured: false } });
}));

kuniRouter.put('/settings', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = z.object({
    interestRate: decimalSchema({ min: 0 }).refine((v) => Number(v) <= 100, 'Riba haiwezi kuzidi 100%'),
    amountPerAcre: decimalSchema({ min: 0 }),
    isOpen: z.boolean(),
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season();
  const before = await settingsOf(amcosId, s.id);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(KS).values({ amcosId, seasonId: s.id, ...body, updatedById: req.auth!.userId })
      .onConflictDoUpdate({ target: [KS.amcosId, KS.seasonId], set: { ...body, updatedById: req.auth!.userId, updatedAt: new Date() } }).returning();
    await audit(tx, req, { action: 'KUNI_SETTINGS_UPDATE', entity: 'KuniSettings', entityId: r.id, amcosId, before, after: r });
    return r;
  });
  res.json({ settings: row });
}));

/** Kiasi ambacho kila mkulima ameshakopa msimu huu (pamoja na kinachosubiri idhini/malipo). */
async function takenBy(amcosId: string, seasonId: string, memberIds?: string[]) {
  const rows = await db.select({ memberId: KL.memberId, v: sql<string>`coalesce(sum(${KL.amount}), 0)` }).from(KL)
    .where(and(eq(KL.amcosId, amcosId), eq(KL.seasonId, seasonId), sql`${KL.status} in ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')`, memberIds?.length ? inArray(KL.memberId, memberIds) : undefined))
    .groupBy(KL.memberId);
  return new Map(rows.map((r) => [r.memberId, D(r.v)]));
}

/** Wakulima wenye makisio yaliyoidhinishwa msimu huu na kikomo chao. */
kuniRouter.get('/eligible', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().optional() }).parse(req.query);
  const amcosId = await readAmcosId(req);
  const s = await season();
  const st = await settingsOf(amcosId, s.id);
  const like = search ? `%${search}%` : null;
  const rows = await db.select({ m: M, acres: sql<string>`sum(${E.acresPlanted})`, kg: sql<string>`sum(${E.estimatedKg})`,
    group: sql<string | null>`(select g.name from member_group_members x join member_groups g on g.id = x.group_id where x.member_id = "members"."id" and x.left_at is null and g.status = 'ACTIVE' limit 1)`,
    balance: sql<string>`(select coalesce(sum(l.credit) - sum(l.debit), 0) from member_ledger_entries l where l.member_id = "members"."id")` })
    .from(E).innerJoin(M, eq(M.id, E.memberId))
    .where(and(eq(E.amcosId, amcosId), eq(E.seasonId, s.id), eq(E.status, 'APPROVED'), eq(M.status, 'ACTIVE'),
      like ? sql`(${M.firstName} ilike ${like} or ${M.lastName} ilike ${like} or ${M.memberNo} ilike ${like})` : undefined))
    .groupBy(M.id).orderBy(asc(M.memberNo));
  const taken = await takenBy(amcosId, s.id);
  const per = D(st?.amountPerAcre ?? 0);
  res.json({
    settings: st, season: s,
    data: rows.map((r) => {
      const limit = D(r.acres).times(per).toDecimalPlaces(2);
      const t = taken.get(r.m.id) ?? D(0);
      const d = destinationOf(r.m);
      return { memberId: r.m.id, memberNo: r.m.memberNo, name: `${r.m.firstName} ${r.m.lastName}`, village: r.m.village, group: r.group,
        acres: fmt2(r.acres), estimatedKg: fmt2(r.kg), limit: fmt2(limit), taken: fmt2(t), available: fmt2(Decimal0(limit.minus(t))),
        debt: fmt2(D(r.balance).lt(0) ? D(r.balance).neg() : 0), method: d.method, destination: d.destination };
    }),
  });
}));
const Decimal0 = (v: ReturnType<typeof D>) => (v.gt(0) ? v : D(0));

/** Mhasibu anaandaa orodha ya pesa ya kuni -> Meneja anaidhinisha. */
kuniRouter.post('/batches', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = z.object({
    loans: z.array(z.object({ memberId: z.string().uuid(), amount: decimalSchema({ min: 1 }) })).min(1, 'Chagua angalau mkulima mmoja').max(2000),
    notes: z.string().trim().nullable().optional(),
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season();
  const st = await settingsOf(amcosId, s.id);
  if (!st || !st.isOpen) throw badRequest('Pesa ya kuni haijafunguliwa msimu huu — weka mipangilio (riba na kiasi kwa ekari) kwanza');
  if (D(st.amountPerAcre).lte(0)) throw badRequest('Weka kiasi cha pesa ya kuni kwa ekari kwenye mipangilio');
  const ids = body.loans.map((l) => l.memberId);
  if (new Set(ids).size !== ids.length) throw badRequest('Mkulima amerudiwa kwenye orodha');
  const mems = await db.select().from(M).where(and(eq(M.amcosId, amcosId), inArray(M.id, ids)));
  if (mems.length !== ids.length) throw badRequest('Baadhi ya wakulima si wa chama hiki');
  const acres = await db.select({ memberId: E.memberId, a: sql<string>`sum(${E.acresPlanted})` }).from(E)
    .where(and(eq(E.seasonId, s.id), eq(E.status, 'APPROVED'), inArray(E.memberId, ids))).groupBy(E.memberId);
  const acreOf = new Map(acres.map((a) => [a.memberId, D(a.a)]));
  const taken = await takenBy(amcosId, s.id, ids);
  const byId = new Map(mems.map((m) => [m.id, m]));
  const rate = D(st.interestRate);
  const rows = body.loans.map((l) => {
    const m = byId.get(l.memberId)!;
    if (m.status !== 'ACTIVE') throw badRequest(`${m.memberNo}: mkulima hayuko hai`);
    const ac = acreOf.get(m.id);
    if (!ac || ac.lte(0)) throw badRequest(`${m.firstName} ${m.lastName} (${m.memberNo}) hana makisio yaliyoidhinishwa msimu huu`);
    const available = ac.times(st.amountPerAcre).minus(taken.get(m.id) ?? 0);
    if (D(l.amount).gt(available)) throw badRequest(`${m.firstName} ${m.lastName} (${m.memberNo}): kikomo kilichobaki ni ${tshText(Decimal0(available))} (ekari ${fmt2(ac)} × ${tshText(st.amountPerAcre)})`);
    return { m, amount: fmt2(l.amount), interest: fmt2(D(l.amount).times(rate).div(100)), ...destinationOf(m) };
  });
  const total = rows.reduce((t, r) => t.plus(r.amount), D(0));
  const interest = rows.reduce((t, r) => t.plus(r.interest), D(0));
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const out = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, amcosId, 'kuni_batch');
    const [b] = await tx.insert(KB).values({ amcosId, seasonId: s.id, batchNo: `${amcos.code}-KN-${pad(n, 4)}`, interestRate: st.interestRate, totalAmount: fmt2(total), totalInterest: fmt2(interest), notes: body.notes ?? null, createdById: req.auth!.userId }).returning();
    await tx.insert(KL).values(rows.map((r) => ({ amcosId, batchId: b.id, seasonId: s.id, memberId: r.m.id, amount: r.amount, interest: r.interest, method: r.method, provider: r.provider, destination: r.destination })));
    const approval = await createApproval(tx, req, {
      amcosId, type: 'KUNI_BATCH', entityType: 'KuniBatch', entityId: b.id, amount: fmt2(total),
      title: `Pesa ya kuni ${b.batchNo}: wakulima ${rows.length}, ${tshText(total)} (riba ${fmt2(rate)}%: ${tshText(interest)})`,
      reason: body.notes ?? `Kikomo: ${tshText(st.amountPerAcre)} kwa ekari`,
      payload: { farmers: rows.length, total: fmt2(total), interest: fmt2(interest), rate: st.interestRate, amountPerAcre: st.amountPerAcre },
    });
    const [upd] = await tx.update(KB).set({ approvalId: approval.id }).where(eq(KB.id, b.id)).returning();
    await audit(tx, req, { action: 'KUNI_BATCH_PREPARE', entity: 'KuniBatch', entityId: b.id, amcosId, after: { ...upd, farmers: rows.length } });
    return { batch: upd, approval };
  });
  res.status(201).json(out);
}));

kuniRouter.get('/batches', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const rows = await db.select({ b: KB, farmers: sql<number>`(select count(*)::int from kuni_loans l where l.batch_id = "kuni_batches"."id")`,
    paid: sql<string>`(select coalesce(sum(l.amount), 0) from kuni_loans l where l.batch_id = "kuni_batches"."id" and l.status = 'SUCCESS')` })
    .from(KB).where(amcosScope(req, KB.amcosId)).orderBy(desc(KB.createdAt));
  res.json({ data: rows.map((r) => ({ ...r.b, farmers: r.farmers, paid: fmt2(r.paid) })) });
}));

async function findBatch(req: Request, id: string) {
  const [b] = await db.select().from(KB).where(and(eq(KB.id, id), amcosScope(req, KB.amcosId)));
  if (!b) throw notFound('Orodha ya pesa ya kuni');
  return b;
}
const loanRows = (batchId: string) => db.select({ l: KL, memberNo: M.memberNo, name: sql<string>`${M.firstName} || ' ' || ${M.lastName}`,
  txnNo: sql<string | null>`(select t.txn_no from finance_transactions t where t.id = "kuni_loans"."finance_txn_id")` })
  .from(KL).innerJoin(M, eq(M.id, KL.memberId)).where(eq(KL.batchId, batchId)).orderBy(asc(KL.method), asc(M.memberNo));

kuniRouter.get('/batches/:id', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await loanRows(id);
  const approval = b.approvalId ? await db.select({ a: schema.approvalRequests, by: sql<string | null>`(select u.full_name from users u where u.id = "approval_requests"."decided_by_id")` })
    .from(schema.approvalRequests).where(eq(schema.approvalRequests.id, b.approvalId)) : [];
  const sum = (k: string) => fmt2(rows.filter((r) => r.l.method === k).reduce((t, r) => t.plus(r.l.amount), D(0)));
  res.json({
    batch: b, approval: approval[0] ? { ...approval[0].a, decidedBy: approval[0].by } : null,
    loans: rows.map((r) => ({ ...r.l, memberNo: r.memberNo, memberName: r.name, txnNo: r.txnNo })),
    summary: { MOBILE_MONEY: sum('MOBILE_MONEY'), BANK: sum('BANK'), CASH: sum('CASH'),
      paid: fmt2(rows.filter((r) => r.l.status === 'SUCCESS').reduce((t, r) => t.plus(r.l.amount), D(0))), pending: rows.filter((r) => r.l.status === 'PENDING' || r.l.status === 'FAILED').length },
  });
}));

kuniRouter.get('/batches/:id/csv', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await loanRows(id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pesa-ya-kuni-${b.batchNo}.csv"`);
  res.send(toCsv([['Namba ya mkulima', 'Jina', 'Njia', 'Mtoa huduma', 'Namba ya simu / akaunti', 'Kiasi (TSh)', 'Hali'],
    ...rows.map((r) => [r.memberNo, r.name, r.l.method, r.l.provider, r.l.destination, r.l.amount, r.l.status])]));
}));

/** Mhasibu anathibitisha pesa zilizotumwa KWELI. Mkopo + riba vinaingia kwenye deni la mkulima na daftari kuu. */
kuniRouter.post('/batches/:id/confirm', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    accountId: z.string().uuid(), loanIds: z.array(z.string().uuid()).min(1, 'Chagua waliotumiwa pesa').max(2000),
    reference: z.string().trim().min(2, 'Weka kumbukumbu ya malipo (mf. namba ya bulk payment)'), txnDate: dateStr.optional(),
  }).parse(req.body);
  const b = await findBatch(req, id);
  if (!['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status)) throw badRequest(b.status === 'DRAFT' ? 'Orodha hii bado inasubiri idhini ya Meneja' : 'Orodha hii haipokei malipo tena');
  const date = body.txnDate ?? todayStr();
  await assertOpen(db, b.amcosId, date);
  const [acc] = await db.select().from(schema.financeAccounts).where(and(eq(schema.financeAccounts.id, body.accountId), eq(schema.financeAccounts.amcosId, b.amcosId)));
  if (!acc || !acc.isActive) throw badRequest('Akaunti ya fedha si sahihi');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId) }))!;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from kuni_batches where id = ${id} for update`);
    const loans = await tx.select().from(KL).where(and(eq(KL.batchId, id), inArray(KL.id, body.loanIds)));
    if (loans.length !== new Set(body.loanIds).size) throw badRequest('Baadhi ya mikopo haiko kwenye orodha hii');
    if (loans.some((l) => l.status !== 'PENDING' && l.status !== 'FAILED')) throw badRequest('Baadhi ya mikopo tayari imethibitishwa au imesitishwa');
    const total = loans.reduce((t, l) => t.plus(l.amount), D(0));
    await lockAccount(tx, acc.id);
    const bal = await accountBalance(tx, acc.id);
    if (bal.lessThan(total)) throw badRequest(`Salio la ${acc.name} halitoshi: linahitajika ${tshText(total)}, lipo TSh ${fmt2(bal)}`);
    for (const l of loans) {
      const m = (await tx.query.members.findFirst({ where: eq(M.id, l.memberId) }))!;
      const [t] = await tx.insert(schema.financeTransactions).values({
        amcosId: b.amcosId, seasonId: b.seasonId, txnNo: await nextTxnNo(tx, b.amcosId, amcos.code), kind: 'FARMER_PAYMENT', direction: 'OUT', category: 'CASH_LOAN',
        accountId: acc.id, amount: l.amount, txnDate: date, description: `Pesa ya kuni (${b.batchNo})`, reference: body.reference,
        payee: `${m.firstName} ${m.lastName} (${m.memberNo})`, memberId: m.id, status: 'POSTED', approvalId: b.approvalId,
        createdById: req.auth!.userId, postedById: req.auth!.userId, postedAt: new Date(),
      }).returning();
      await ledger.post(tx, { amcosId: b.amcosId, memberId: m.id, seasonId: b.seasonId, type: 'CASH_LOAN', debit: l.amount,
        description: `Pesa ya kuni ${t.txnNo}`, referenceType: 'FINANCE_TXN', referenceId: t.id, createdById: req.auth!.userId });
      if (D(l.interest).gt(0)) {
        await ledger.post(tx, { amcosId: b.amcosId, memberId: m.id, seasonId: b.seasonId, type: 'LOAN_INTEREST', debit: l.interest,
          description: `Riba ya pesa ya kuni ${fmt2(b.interestRate)}% (${t.txnNo})`, referenceType: 'KUNI_LOAN', referenceId: l.id, createdById: req.auth!.userId });
        await postJournal(tx, { amcosId: b.amcosId, date, description: `Riba ya pesa ya kuni ${m.memberNo} (${t.txnNo})`, source: 'KUNI_INTEREST', sourceId: l.id, reference: b.batchNo,
          approvalId: b.approvalId, createdById: req.auth!.userId, lines: [{ code: '1200', debit: l.interest, memberId: m.id }, { code: '4450', credit: l.interest }] });
      }
      await tx.update(KL).set({ status: 'SUCCESS', providerRef: body.reference, paidAt: new Date(), financeTxnId: t.id, failureReason: null }).where(eq(KL.id, l.id));
    }
    const all = await tx.select({ status: KL.status }).from(KL).where(eq(KL.batchId, id));
    const status = all.every((x) => x.status === 'SUCCESS' || x.status === 'CANCELLED') ? 'COMPLETED' : all.some((x) => x.status === 'FAILED') ? 'PARTIAL' : 'PROCESSING';
    await tx.update(KB).set({ status }).where(eq(KB.id, id));
    await audit(tx, req, { action: 'KUNI_PAYMENTS_CONFIRMED', entity: 'KuniBatch', entityId: id, amcosId: b.amcosId, after: { count: loans.length, total: fmt2(total), reference: body.reference, account: acc.name } });
    return { confirmed: loans.length, total: fmt2(total), status };
  });
  res.json(result);
}));

kuniRouter.post('/batches/:id/fail', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ loanIds: z.array(z.string().uuid()).min(1), reason: z.string().trim().min(3, 'Eleza sababu') }).parse(req.body);
  const b = await findBatch(req, id);
  const rows = await db.transaction(async (tx) => {
    const r = await tx.update(KL).set({ status: 'FAILED', failureReason: body.reason }).where(and(eq(KL.batchId, b.id), inArray(KL.id, body.loanIds), eq(KL.status, 'PENDING'))).returning();
    if (r.length) await tx.update(KB).set({ status: 'PARTIAL' }).where(eq(KB.id, b.id));
    await audit(tx, req, { action: 'KUNI_PAYMENTS_FAILED', entity: 'KuniBatch', entityId: b.id, amcosId: b.amcosId, after: { count: r.length, reason: body.reason } });
    return r;
  });
  res.json({ failed: rows.length });
}));
