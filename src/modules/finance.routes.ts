// =====================================================================
//  FEDHA ZA CHAMA (Mhasibu) — mapato, matumizi, malipo, akaunti, bajeti, ripoti
//   Mapato             -> yanarekodiwa moja kwa moja (POSTED)
//   Matumizi / malipo  -> Mhasibu anaandaa -> Meneja anaidhinisha -> Mhasibu anakamilisha (POSTED)
//   Muamala uliokamilika haufutwi wala kubadilishwa: unasahihishwa kwa REVERSAL (nayo inaidhinishwa)
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import * as ledger from '../lib/ledger';
import { createApproval } from '../lib/approvals';
import {
  accountBalance, EXPENSE_CATEGORIES, FARMER_PAYMENT_CATEGORIES, INCOME_CATEGORIES, lockAccount, nextTxnNo, SUPPLIER_PAYMENT_CATEGORIES,
} from '../lib/finance';
import { findMemberScoped } from './members.routes';
import { currentSeason } from './seasons.routes';
import { toCsv } from './owner/common';
import { journalFor, postJournal } from '../lib/gl';
import { currentRate, inputCurrency, rateProblem, settleUsdDebt, usdSummary } from '../lib/fx';
import { assertOpen, lockedThrough } from '../lib/periods';

/** Tarehe ya kukamilisha: kama tarehe ya maandalizi iko kwenye kipindi kilichofungwa, tumia leo. */
async function postDate(amcosId: string, given: string | undefined, prepared: string) {
  if (given) { await assertOpen(db, amcosId, given); return given; }
  const l = await lockedThrough(db, amcosId);
  return l && prepared <= l ? todayStr() : prepared;
}

export const financeRouter = Router();
const T = schema.financeTransactions;
const ACC = schema.financeAccounts;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });

financeRouter.get('/categories', requireAmcosPerm('finance.read'), (_req, res) => {
  res.json({ income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES, farmerPayment: { PAYMENT: FARMER_PAYMENT_CATEGORIES.PAYMENT }, supplierPayment: SUPPLIER_PAYMENT_CATEGORIES });
});

// ------------------------------ AKAUNTI ------------------------------
async function findAccount(req: Request, id: string) {
  const [a] = await db.select().from(ACC).where(and(eq(ACC.id, id), amcosScope(req, ACC.amcosId)));
  if (!a) throw notFound('Akaunti');
  return a;
}

financeRouter.get('/accounts', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const rows = await db.select({
    account: ACC,
    net: sql<string>`coalesce((select sum(case when t.direction = 'IN' then t.amount else -t.amount end) from finance_transactions t
      where t.account_id = "finance_accounts"."id" and t.status = 'POSTED'), 0)`,
  }).from(ACC).where(amcosScope(req, ACC.amcosId)).orderBy(asc(ACC.name));
  res.json({ data: rows.map((r) => ({ ...r.account, balance: fmt2(D(r.account.openingBalance).plus(r.net)) })) });
}));

const accountBody = z.object({
  name: z.string().trim().min(2),
  kind: z.enum(schema.financeAccountKindEnum.enumValues),
  bankName: z.string().trim().nullable().optional(),
  accountNumber: z.string().trim().nullable().optional(),
  openingBalance: decimalSchema({ min: 0 }).optional(),
});

financeRouter.post('/accounts', requireAmcosPerm('finance.accounts'), ah(async (req, res) => {
  const body = accountBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const account = await db.transaction(async (tx) => {
    const [a] = await tx.insert(ACC).values({ ...body, amcosId }).returning();
    await audit(tx, req, { action: 'FINANCE_ACCOUNT_CREATE', entity: 'FinanceAccount', entityId: a.id, amcosId, after: a });
    return a;
  });
  res.status(201).json({ account });
}));

financeRouter.patch('/accounts/:id', requireAmcosPerm('finance.accounts'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = accountBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const before = await findAccount(req, id);
  if (body.openingBalance !== undefined && body.openingBalance !== before.openingBalance) {
    const [{ n }] = await db.select({ n: count() }).from(T).where(eq(T.accountId, id));
    if (n > 0) throw badRequest('Salio la kuanzia haliwezi kubadilishwa baada ya akaunti kuwa na miamala');
    if (await journalFor(db, before.amcosId, 'ACCOUNT_OPENING', id)) throw badRequest('Salio la kuanzia limeshaingia kwenye daftari kuu — tumia journal ya marekebisho');
  }
  const account = await db.transaction(async (tx) => {
    const [a] = await tx.update(ACC).set(body).where(eq(ACC.id, id)).returning();
    await audit(tx, req, { action: 'FINANCE_ACCOUNT_UPDATE', entity: 'FinanceAccount', entityId: id, amcosId: before.amcosId, before, after: a });
    return a;
  });
  res.json({ account });
}));

// ------------------------------ MIAMALA ------------------------------
const listQuery = paginationQuery.extend({
  kind: z.enum(schema.financeTxnKindEnum.enumValues).optional(),
  status: z.enum(schema.financeTxnStatusEnum.enumValues).optional(),
  accountId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  search: z.string().trim().optional(),
});

function txnWhere(req: Request, q: z.infer<typeof listQuery>) {
  const s = q.search ? `%${q.search}%` : null;
  return and(
    amcosScope(req, T.amcosId),
    q.kind ? eq(T.kind, q.kind) : undefined,
    q.status ? eq(T.status, q.status) : undefined,
    q.accountId ? eq(T.accountId, q.accountId) : undefined,
    q.from ? gte(T.txnDate, q.from) : undefined,
    q.to ? lte(T.txnDate, q.to) : undefined,
    s ? or(ilike(T.txnNo, s), ilike(T.description, s), ilike(T.payee, s), ilike(T.reference, s)) : undefined,
  );
}

const txnCols = {
  txn: T,
  account: ACC.name,
  member: sql<string | null>`(select m.first_name || ' ' || m.last_name || ' (' || m.member_no || ')' from members m where m.id = "finance_transactions"."member_id")`,
  supplier: sql<string | null>`(select s.name from suppliers s where s.id = "finance_transactions"."supplier_id")`,
  createdBy: sql<string | null>`(select u.full_name from users u where u.id = "finance_transactions"."created_by_id")`,
  reversed: sql<boolean>`exists (select 1 from finance_transactions r where r.reversal_of_id = "finance_transactions"."id")`,
  reversalPending: sql<boolean>`exists (select 1 from approval_requests ar where ar.type = 'REVERSAL' and ar.status = 'PENDING' and ar.entity_id = "finance_transactions"."id")`,
};
const shape = (r: { txn: typeof T.$inferSelect; account: string | null; member: string | null; supplier: string | null; createdBy: string | null; reversed: boolean; reversalPending: boolean }) =>
  ({ ...r.txn, accountName: r.account, memberName: r.member, supplierName: r.supplier, createdBy: r.createdBy, reversed: r.reversed, reversalPending: r.reversalPending });

financeRouter.get('/transactions', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = txnWhere(req, q);
  const [rows, [{ total }]] = await Promise.all([
    db.select(txnCols).from(T).leftJoin(ACC, eq(ACC.id, T.accountId)).where(where)
      .orderBy(desc(T.txnDate), desc(T.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(T).where(where),
  ]);
  res.json(paged(rows.map(shape), total, q.page, q.pageSize));
}));

financeRouter.get('/transactions/:id', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [row] = await db.select(txnCols).from(T).leftJoin(ACC, eq(ACC.id, T.accountId)).where(and(eq(T.id, id), amcosScope(req, T.amcosId)));
  if (!row) throw notFound('Muamala');
  const approvals = await db.select().from(schema.approvalRequests)
    .where(or(eq(schema.approvalRequests.entityId, id), row.txn.approvalId ? eq(schema.approvalRequests.id, row.txn.approvalId) : undefined))
    .orderBy(asc(schema.approvalRequests.createdAt));
  res.json({ transaction: shape(row), approvals });
}));

async function scopedTxn(req: Request, id: string) {
  const [t] = await db.select().from(T).where(and(eq(T.id, id), amcosScope(req, T.amcosId)));
  if (!t) throw notFound('Muamala');
  return t;
}

const baseTxn = z.object({
  amount: decimalSchema({ min: 0.01 }),
  txnDate: dateStr.optional(),
  description: z.string().trim().min(3, 'Eleza muamala huu'),
  reference: z.string().trim().nullable().optional(),
  payee: z.string().trim().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  contraGlAccountId: z.string().uuid().nullable().optional(), // hiari: akaunti ya daftari kuu (mf. 1500 mali, 2410 PAYE)
});

/** Akaunti ya daftari kuu iliyochaguliwa kwa mkono: lazima iwe ya chama hiki, iwe hai na isiwe akaunti ya fedha. */
async function checkContra(amcosId: string, id: string | null | undefined) {
  if (!id) return null;
  const [g] = await db.select().from(schema.glAccounts).where(and(eq(schema.glAccounts.id, id), eq(schema.glAccounts.amcosId, amcosId)));
  if (!g || !g.isActive) throw badRequest('Akaunti ya daftari kuu si sahihi');
  if (g.subtype === 'CASH' || g.subtype === 'CASH_GROUP' || g.subtype === 'TRANSFER') throw badRequest('Chagua akaunti isiyo ya fedha (kwa uhamisho tumia ukurasa wa Benki)');
  return g.id;
}

async function activeAccount(req: Request, id: string | null | undefined, required: boolean) {
  if (!id) {
    if (required) throw badRequest('Chagua akaunti ya fedha');
    return null;
  }
  const a = await findAccount(req, id);
  if (!a.isActive) throw badRequest('Akaunti hii imefungwa');
  return a;
}

/** MAPATO — yanarekodiwa moja kwa moja. Marejesho ya deni la mkulima yanaingia kwenye ledger yake. */
financeRouter.post('/income', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = baseTxn.extend({ category: z.string(), memberId: z.string().uuid().nullable().optional(), marketId: z.string().uuid().nullable().optional() }).parse(req.body);
  if (!(body.category in INCOME_CATEGORIES)) throw badRequest('Aina ya mapato si sahihi');
  const amcosId = await resolveWriteAmcosId(req);
  await assertOpen(db, amcosId, body.txnDate ?? todayStr());
  // Malipo ya mnunuzi wa tumbaku yanaunganishwa na soko husika (kuona soko lipi bado halijalipwa)
  let marketId: string | null = null;
  if (body.marketId) {
    if (body.category !== 'TOBACCO_SALES') throw badRequest('Soko linaunganishwa na malipo ya mauzo ya tumbaku tu');
    const mk = await db.query.markets.findFirst({ where: and(eq(schema.markets.id, body.marketId), eq(schema.markets.amcosId, amcosId)) });
    if (!mk) throw notFound('Soko');
    marketId = mk.id;
  }
  const account = (await activeAccount(req, body.accountId, true))!;
  const member = body.memberId ? await findMemberScoped(req, body.memberId) : null;
  if (body.category === 'FARMER_REPAYMENT' && !member) throw badRequest('Chagua mkulima anayerejesha deni');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const season = await currentSeason();
  const contra = ['FARMER_REPAYMENT', 'MEMBER_FEES'].includes(body.category) ? null : await checkContra(amcosId, body.contraGlAccountId);
  const txn = await db.transaction(async (tx) => {
    const [t] = await tx.insert(T).values({
      contraGlAccountId: contra, marketId,
      amcosId, seasonId: season?.id ?? null, txnNo: await nextTxnNo(tx, amcosId, amcos.code), kind: 'INCOME', direction: 'IN',
      category: body.category, accountId: account.id, amount: body.amount, txnDate: body.txnDate ?? todayStr(),
      description: body.description, reference: body.reference ?? null, payee: body.payee ?? (member ? `${member.firstName} ${member.lastName}` : null),
      memberId: member?.id ?? null, status: 'POSTED', createdById: req.auth!.userId, postedById: req.auth!.userId, postedAt: new Date(),
    }).returning();
    if (member && body.category === 'FARMER_REPAYMENT') {
      // Deni la pembejeo la dola: linabadilishwa kwa kiwango cha leo, kisha marejesho yanalipunguza kwanza
      const rate = await currentRate(tx, amcosId);
      if (rate) {
        const jl = await settleUsdDebt(tx, req, { amcosId, memberId: member.id, seasonId: season?.id ?? null, rate: rate.usdToTzs, paidTzs: body.amount, ref: t.txnNo, referenceType: 'FINANCE_TXN', referenceId: t.id });
        if (jl.length) await postJournal(tx, { amcosId, date: t.txnDate, description: `Tofauti ya kiwango cha dola — marejesho ${t.txnNo}`, source: 'FX_REVALUE', sourceId: t.id, reference: t.txnNo, createdById: req.auth!.userId, lines: jl });
      }
      await ledger.post(tx, {
        amcosId, memberId: member.id, seasonId: season?.id ?? null, type: 'REPAYMENT', credit: body.amount,
        description: `Marejesho ya deni ${t.txnNo}`, referenceType: 'FINANCE_TXN', referenceId: t.id, createdById: req.auth!.userId,
      });
    }
    // Kiingilio cha uanachama: kinawekwa "kimelipwa" kwenye taarifa za mkulima
    if (member && body.category === 'MEMBER_FEES' && !member.entryFeePaid) {
      await tx.update(schema.members).set({ entryFeePaid: true, entryFeePaidAt: t.txnDate, entryFeeReference: t.txnNo }).where(eq(schema.members.id, member.id));
      await audit(tx, req, { action: 'MEMBER_ENTRY_FEE_PAID', entity: 'Member', entityId: member.id, amcosId, before: { entryFeePaid: false }, after: { entryFeePaid: true, reference: t.txnNo, amount: t.amount } });
    }
    await audit(tx, req, { action: 'FINANCE_INCOME_RECORD', entity: 'FinanceTransaction', entityId: t.id, amcosId, after: t });
    return t;
  });
  res.status(201).json({ transaction: txn });
}));

/** Matumizi / malipo yanayohitaji idhini ya Meneja. */
async function prepare(req: Request, kind: 'EXPENSE' | 'FARMER_PAYMENT' | 'SUPPLIER_PAYMENT', body: z.infer<typeof baseTxn> & { category: string; memberId?: string | null; supplierId?: string | null; purchaseRequestId?: string | null; amountUsd?: string | null; fxRate?: string | null }, title: string, preApprovedBy?: string | null) {
  const amcosId = await resolveWriteAmcosId(req);
  if (body.accountId) await activeAccount(req, body.accountId, false);
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const season = await currentSeason();
  const contra = kind === 'EXPENSE' ? await checkContra(amcosId, body.contraGlAccountId) : null;
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(T).values({
      contraGlAccountId: contra,
      amcosId, seasonId: season?.id ?? null, txnNo: await nextTxnNo(tx, amcosId, amcos.code), kind, direction: 'OUT',
      category: body.category, accountId: body.accountId ?? null, amount: body.amount, txnDate: body.txnDate ?? todayStr(),
      description: body.description, reference: body.reference ?? null, payee: body.payee ?? null,
      memberId: body.memberId ?? null, supplierId: body.supplierId ?? null, purchaseRequestId: body.purchaseRequestId ?? null,
      amountUsd: body.amountUsd ?? null, fxRate: body.fxRate ?? null,
      status: preApprovedBy ? 'APPROVED' : 'PENDING_APPROVAL', approvalId: preApprovedBy ?? null, createdById: req.auth!.userId,
    }).returning();
    await audit(tx, req, { action: `FINANCE_${kind}_PREPARE`, entity: 'FinanceTransaction', entityId: t.id, amcosId, after: t });
    if (preApprovedBy) return { transaction: t, approval: null };
    const approval = await createApproval(tx, req, {
      amcosId, type: kind, entityType: 'FinanceTransaction', entityId: t.id, amount: body.amount, title: `${title} · ${t.txnNo}`, reason: body.description,
    });
    const [upd] = await tx.update(T).set({ approvalId: approval.id }).where(eq(T.id, t.id)).returning();
    return { transaction: upd, approval };
  });
}

financeRouter.post('/expenses', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = baseTxn.extend({ category: z.string() }).parse(req.body);
  if (!(body.category in EXPENSE_CATEGORIES)) throw badRequest('Aina ya matumizi si sahihi');
  if (body.category === 'REMITTANCE') {
    // Kulipa deni la chama: lazima kuchagua deni husika (mf. 2150 Chama Kikuu, 2310 Halmashauri, 2410 PAYE)
    const g = body.contraGlAccountId ? await db.query.glAccounts.findFirst({ where: eq(schema.glAccounts.id, body.contraGlAccountId) }) : null;
    if (!g || g.type !== 'LIABILITY') throw badRequest('Chagua deni linalolipwa (akaunti ya madeni)');
  }
  res.status(201).json(await prepare(req, 'EXPENSE', body, `${EXPENSE_CATEGORIES[body.category]}: ${tshText(body.amount)}${body.payee ? ` kwa ${body.payee}` : ''}`));
}));

financeRouter.post('/farmer-payments', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = baseTxn.extend({ category: z.enum(['PAYMENT', 'CASH_LOAN']).default('PAYMENT'), memberId: z.string().uuid() }).parse(req.body);
  // Mikopo ya fedha ina njia moja tu: Pesa ya kuni (kikomo kwa ekari, riba, orodha kwa idhini)
  if (body.category === 'CASH_LOAN') throw badRequest('Mikopo ya fedha kwa wakulima inatolewa kupitia "Pesa ya kuni"');
  const member = await findMemberScoped(req, body.memberId);
  if (member.status !== 'ACTIVE') throw badRequest('Mkulima hayuko hai (ACTIVE)');
  const payee = `${member.firstName} ${member.lastName} (${member.memberNo})`;
  res.status(201).json(await prepare(req, 'FARMER_PAYMENT', { ...body, payee }, `${FARMER_PAYMENT_CATEGORIES[body.category]}: ${tshText(body.amount)} kwa ${payee}`));
}));

/** Malipo kwa mzabuni. Yakihusishwa na ombi la manunuzi LILILOIDHINISHWA, idhini hiyo inatosha (hakuna idhini mara mbili). */
financeRouter.post('/supplier-payments', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = baseTxn.extend({ supplierId: z.string().uuid(), purchaseRequestId: z.string().uuid().nullable().optional(), amountUsd: decimalSchema({ min: 0.01 }).nullable().optional() }).parse(req.body);
  let usdPart: { amountUsd: string; fxRate: string } | null = null;
  const [supplier] = await db.select().from(schema.suppliers).where(and(eq(schema.suppliers.id, body.supplierId), amcosScope(req, schema.suppliers.amcosId)));
  if (!supplier) throw notFound('Mzabuni');
  let preApproved: string | null = null;
  if (body.purchaseRequestId) {
    const [pr] = await db.select().from(schema.purchaseRequests).where(and(eq(schema.purchaseRequests.id, body.purchaseRequestId), amcosScope(req, schema.purchaseRequests.amcosId)));
    if (!pr) throw notFound('Ombi la manunuzi');
    if (!['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(pr.status)) throw badRequest('Ombi hili la manunuzi halijaidhinishwa');
    if (pr.supplierId && pr.supplierId !== supplier.id) throw badRequest('Mzabuni hailingani na ombi la manunuzi');
    const [{ committed }] = await db.select({ committed: sql<string>`coalesce(sum(${T.amount}), 0)` }).from(T)
      .where(and(eq(T.purchaseRequestId, pr.id), eq(T.kind, 'SUPPLIER_PAYMENT'), inArray(T.status, ['PENDING_APPROVAL', 'APPROVED', 'POSTED'])));
    const reversed = await db.select({ v: sql<string>`coalesce(sum(${T.amount}), 0)` }).from(T)
      .where(and(eq(T.purchaseRequestId, pr.id), eq(T.kind, 'REVERSAL')));
    if (pr.currency === 'USD' && pr.totalUsd) {
      // Ombi la dola: kinacholipwa ni dola; TSh = dola x kiwango cha leo
      if (!body.amountUsd) throw badRequest('Ombi hili la manunuzi ni la dola — weka kiasi kwa USD');
      const [u] = await db.select({
        paid: sql<string>`coalesce(sum(${T.amountUsd}) filter (where ${T.kind} = 'SUPPLIER_PAYMENT' and ${T.status} in ('PENDING_APPROVAL', 'APPROVED', 'POSTED')), 0)`,
        rev: sql<string>`coalesce(sum(${T.amountUsd}) filter (where ${T.kind} = 'REVERSAL'), 0)`,
      }).from(T).where(eq(T.purchaseRequestId, pr.id));
      const leftUsd = D(pr.totalUsd).minus(u.paid).plus(u.rev);
      if (D(body.amountUsd).gt(leftUsd)) throw badRequest(`Kiasi kinazidi deni la ombi hili. Kilichobaki: $${fmt2(leftUsd)}`);
      const rate = await currentRate(db, pr.amcosId);
      if (!rate) throw badRequest('Kiwango cha dola hakijawekwa');
      usdPart = { amountUsd: fmt2(body.amountUsd), fxRate: D(rate.usdToTzs).toFixed(4) };
      body.amount = fmt2(D(body.amountUsd).times(rate.usdToTzs));
    } else {
      const remaining = D(pr.totalAmount).minus(committed).plus(reversed[0].v);
      if (D(body.amount).greaterThan(remaining)) throw badRequest(`Kiasi kinazidi deni la ombi hili. Kilichobaki: TSh ${fmt2(remaining)}`);
    }
    preApproved = pr.approvalId;
  }
  res.status(201).json(await prepare(req, 'SUPPLIER_PAYMENT', { ...body, ...usdPart, category: 'SUPPLIER', payee: supplier.name }, `Malipo kwa ${supplier.name}: ${usdPart ? `$${usdPart.amountUsd} (${tshText(body.amount)})` : tshText(body.amount)}`, preApproved));
}));

/** Mhasibu anakamilisha malipo yaliyoidhinishwa (fedha zimetoka kweli). */
financeRouter.post('/transactions/:id/post', requireAmcosPerm('finance.post'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ accountId: z.string().uuid().optional(), txnDate: dateStr.optional(), reference: z.string().trim().optional() }).parse(req.body);
  const t = await scopedTxn(req, id);
  if (t.status !== 'APPROVED') throw badRequest(t.status === 'PENDING_APPROVAL' ? 'Muamala huu bado unasubiri idhini ya Meneja' : 'Muamala huu hauwezi kukamilishwa');
  if (t.kind === 'TRANSFER') {
    // Uhamisho: pande zote mbili zinakamilishwa pamoja, kuanzia upande wa kutoa fedha
    const pair = await db.select().from(T).where(and(eq(T.transferGroupId, t.transferGroupId!), eq(T.status, 'APPROVED')));
    const outLeg = pair.find((p) => p.direction === 'OUT');
    const inLeg = pair.find((p) => p.direction === 'IN');
    if (!outLeg || !inLeg) throw conflict('Uhamisho huu haujakamilika vizuri');
    const done = await db.transaction(async (tx) => {
      await lockAccount(tx, outLeg.accountId!);
      const bal = await accountBalance(tx, outLeg.accountId!);
      if (bal.lessThan(outLeg.amount)) throw badRequest(`Salio la akaunti ya kutoa halitoshi (TSh ${fmt2(bal)})`);
      const date = await postDate(outLeg.amcosId, body.txnDate, outLeg.txnDate);
      const rows = await tx.update(T).set({ status: 'POSTED', txnDate: date, reference: body.reference ?? outLeg.reference, postedById: req.auth!.userId, postedAt: new Date() })
        .where(and(eq(T.transferGroupId, outLeg.transferGroupId!), eq(T.status, 'APPROVED'))).returning();
      if (rows.length !== 2) throw conflict('Uhamisho umebadilishwa na mtu mwingine');
      await audit(tx, req, { action: 'TRANSFER_POST', entity: 'FinanceTransaction', entityId: outLeg.id, amcosId: outLeg.amcosId, after: { out: outLeg.txnNo, in: inLeg.txnNo, amount: outLeg.amount } });
      return rows.find((r) => r.id === id)!;
    });
    return res.json({ transaction: done });
  }
  const account = (await activeAccount(req, body.accountId ?? t.accountId, true))!;
  const date = await postDate(t.amcosId, body.txnDate, t.txnDate);
  const txn = await db.transaction(async (tx) => {
    await lockAccount(tx, account.id);
    const bal = await accountBalance(tx, account.id);
    if (bal.lessThan(t.amount)) throw badRequest(`Salio la ${account.name} halitoshi (TSh ${fmt2(bal)})`);
    const [p] = await tx.update(T).set({
      status: 'POSTED', accountId: account.id, txnDate: date, reference: body.reference ?? t.reference,
      postedById: req.auth!.userId, postedAt: new Date(),
    }).where(and(eq(T.id, id), eq(T.status, 'APPROVED'))).returning();
    if (!p) throw conflict('Muamala umebadilishwa na mtu mwingine');
    if (p.kind === 'FARMER_PAYMENT' && p.memberId) {
      await ledger.post(tx, {
        amcosId: p.amcosId, memberId: p.memberId, seasonId: p.seasonId, type: p.category === 'CASH_LOAN' ? 'CASH_LOAN' : 'PAYMENT', debit: p.amount,
        description: `${FARMER_PAYMENT_CATEGORIES[p.category] ?? 'Malipo'} ${p.txnNo}`, referenceType: 'FINANCE_TXN', referenceId: p.id, createdById: req.auth!.userId,
      });
    }
    await audit(tx, req, { action: 'FINANCE_TXN_POST', entity: 'FinanceTransaction', entityId: id, amcosId: t.amcosId, before: { status: t.status }, after: p });
    return p;
  });
  res.json({ transaction: txn });
}));

/** Kusahihisha muamala uliokamilika: ombi la REVERSAL kwa Meneja. */
financeRouter.post('/transactions/:id/reverse', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Eleza sababu ya kusahihisha') }).parse(req.body);
  const t = await scopedTxn(req, id);
  if (t.status !== 'POSTED' || t.kind === 'REVERSAL') throw badRequest('Ni muamala uliokamilika tu unaoweza kusahihishwa');
  if (await db.query.financeTransactions.findFirst({ where: eq(T.reversalOfId, id) })) throw conflict('Muamala huu tayari umesahihishwa');
  const pending = await db.query.approvalRequests.findFirst({ where: and(eq(schema.approvalRequests.type, 'REVERSAL'), eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, 'PENDING')) });
  if (pending) throw conflict('Tayari kuna ombi la kusahihisha muamala huu');
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId: t.amcosId, type: 'REVERSAL', entityType: 'FinanceTransaction', entityId: id, amount: t.amount,
    title: `Kusahihisha ${t.txnNo} (${tshText(t.amount)})`, reason,
  }));
  res.status(202).json({ approval });
}));

// ------------------------------ BAJETI ------------------------------
/**
 * Bajeti ya msimu dhidi ya matumizi halisi: kwa kila kundi — bajeti, kilichotumika, kinachobaki, asilimia,
 * matumizi ya kila mwezi, na hali (SAWA / KARIBU / IMEZIDI / KASI) ikilinganishwa na muda wa msimu uliopita.
 */
// ------------------------------ KIWANGO CHA DOLA NA SARAFU YA PEMBEJEO ------------------------------
financeRouter.get('/fx', requireAmcosPerm('finance.read', 'stock.read', 'issues.request', 'purchases.request', 'sales.read'), ah(async (req, res) => {
  const amcosId = await resolveWriteAmcosId(req);
  const [currency, cur] = await Promise.all([inputCurrency(db, amcosId), currentRate(db, amcosId)]);
  const history = await db.select({ id: schema.fxRates.id, usdToTzs: schema.fxRates.usdToTzs, note: schema.fxRates.note, createdAt: schema.fxRates.createdAt, setBy: schema.users.fullName })
    .from(schema.fxRates).leftJoin(schema.users, eq(schema.users.id, schema.fxRates.setById))
    .where(eq(schema.fxRates.amcosId, amcosId)).orderBy(desc(schema.fxRates.createdAt)).limit(30);
  const [usd] = (await db.execute<{ debt: string | null; farmers: number }>(sql`
    select sum(x.u)::numeric(14,2)::text as debt, count(*)::int as farmers from (select member_id, sum(usd) as u from member_usd_ledger where amcos_id = ${amcosId} group by member_id having sum(usd) > 0) x`)).rows;
  res.json({ currency, rate: cur ? { usdToTzs: cur.usdToTzs, createdAt: cur.createdAt } : null, history, farmersUsdDebt: usd?.debt ?? '0', farmersWithUsdDebt: usd?.farmers ?? 0 });
}));

/** Mhasibu anaweka kiwango kipya. Kinatumika kwa ugawaji/manunuzi/marejesho yanayofuata (ya zamani yanabaki na kiwango chao). */
financeRouter.post('/fx', requireAmcosPerm('finance.accounts'), ah(async (req, res) => {
  const b = z.object({ usdToTzs: decimalSchema({ min: 1 }), note: z.string().trim().max(200).optional() }).parse(req.body);
  const bad = rateProblem(b.usdToTzs);
  if (bad) throw badRequest(bad);
  const amcosId = await resolveWriteAmcosId(req);
  const before = await currentRate(db, amcosId);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(schema.fxRates).values({ amcosId, usdToTzs: D(b.usdToTzs).toFixed(4), note: b.note ?? null, setById: req.auth!.userId }).returning();
    await audit(tx, req, { action: 'FX_RATE_SET', entity: 'FxRate', entityId: r.id, amcosId, before: before ? { usdToTzs: before.usdToTzs } : null, after: { usdToTzs: r.usdToTzs, note: r.note } });
    return r;
  });
  res.status(201).json({ rate: row });
}));

/** Sarafu ya pembejeo ya chama (TSh au USD). Inaathiri bei, ugawaji na manunuzi MAPYA tu. */
financeRouter.put('/fx/currency', requireAmcosPerm('finance.accounts'), ah(async (req, res) => {
  const { currency } = z.object({ currency: z.enum(['TZS', 'USD']) }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (currency === 'USD' && !(await currentRate(db, amcosId))) throw badRequest('Weka kiwango cha dola kwanza');
  const before = await inputCurrency(db, amcosId);
  await db.transaction(async (tx) => {
    await tx.update(schema.amcos).set({ inputCurrency: currency }).where(eq(schema.amcos.id, amcosId));
    await audit(tx, req, { action: 'INPUT_CURRENCY_SET', entity: 'Amcos', entityId: amcosId, amcosId, before: { inputCurrency: before }, after: { inputCurrency: currency } });
  });
  res.json({ currency });
}));

financeRouter.get('/budgets', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
  const season = seasonId ? (await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)))[0] : await currentSeason();
  if (!season) return res.json({ data: [], months: [], totals: null });
  const B = schema.financeBudgets;
  const budgets = await db.select().from(B).where(and(amcosScope(req, B.amcosId), eq(B.seasonId, season.id)));
  const monthly = await db.select({ category: T.category, month: sql<string>`to_char(${T.txnDate}, 'YYYY-MM')`, v: sql<string>`coalesce(sum(case when ${T.kind} = 'REVERSAL' then -${T.amount} else ${T.amount} end), 0)` })
    .from(T).where(and(amcosScope(req, T.amcosId), eq(T.seasonId, season.id), eq(T.status, 'POSTED'),
      inArray(T.kind, ['EXPENSE', 'REVERSAL']), inArray(T.category, Object.keys(EXPENSE_CATEGORIES))))
    .groupBy(T.category, sql`to_char(${T.txnDate}, 'YYYY-MM')`);
  // Miezi ya msimu hadi leo (au mwisho wa msimu)
  const today = todayStr();
  const last = (season.endDate < today ? season.endDate : today).slice(0, 7);
  const months: string[] = [];
  for (let d = new Date(`${season.startDate.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= last && months.length < 24; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  for (const x of monthly) if (!months.includes(x.month)) months.push(x.month);
  months.sort();
  // Sehemu ya msimu iliyopita (0–1): kulinganisha kasi ya matumizi
  const span = Date.parse(season.endDate) - Date.parse(season.startDate);
  const elapsed = span > 0 ? Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(season.startDate)) / span)) : 1;
  const cats = new Set([...budgets.map((b) => b.category), ...monthly.map((m) => m.category)]);
  const data = [...cats].map((c) => {
    const b = budgets.find((x) => x.category === c);
    const byMonth: Record<string, string> = {};
    let spent = D(0);
    for (const m of monthly.filter((x) => x.category === c)) { byMonth[m.month] = fmt2(m.v); spent = spent.plus(m.v); }
    const pct = b && D(b.amount).gt(0) ? Number(spent.div(b.amount).times(100).toFixed(1)) : null;
    const state = !b ? (spent.gt(0) ? 'NO_BUDGET' : 'OK') : pct! > 100 ? 'OVER' : pct! >= 90 ? 'NEAR' : pct! > elapsed * 100 + 15 ? 'FAST' : 'OK';
    return { category: c, label: EXPENSE_CATEGORIES[c] ?? c, budget: b?.amount ?? null, notes: b?.notes ?? null, actual: fmt2(spent),
      remaining: b ? fmt2(D(b.amount).minus(spent)) : null, percent: pct, state, byMonth };
  }).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
  const tb = budgets.reduce((t, b) => t.plus(b.amount), D(0));
  const ta = data.reduce((t, x) => t.plus(x.actual), D(0));
  res.json({
    data, months, seasonId: season.id, season: { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate },
    elapsedPercent: Math.round(elapsed * 100),
    totals: { budget: fmt2(tb), actual: fmt2(ta), remaining: fmt2(tb.minus(ta)), percent: tb.gt(0) ? Number(ta.div(tb).times(100).toFixed(1)) : null },
  });
}));

/** Kabla ya kurekodi matumizi: yataathiri bajeti kiasi gani? (onyo tu — hakuna kinachozuiwa) */
financeRouter.get('/budgets/check', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const q = z.object({ category: z.string(), amount: z.coerce.number().min(0).default(0) }).parse(req.query);
  const season = await currentSeason();
  if (!season || !(q.category in EXPENSE_CATEGORIES)) return res.json({ budget: null });
  const B = schema.financeBudgets;
  const [b] = await db.select().from(B).where(and(amcosScope(req, B.amcosId), eq(B.seasonId, season.id), eq(B.category, q.category)));
  if (!b) return res.json({ budget: null, label: EXPENSE_CATEGORIES[q.category] });
  const [a] = await db.select({ v: sql<string>`coalesce(sum(case when ${T.kind} = 'REVERSAL' then -${T.amount} else ${T.amount} end), 0)` })
    .from(T).where(and(amcosScope(req, T.amcosId), eq(T.seasonId, season.id), eq(T.status, 'POSTED'), inArray(T.kind, ['EXPENSE', 'REVERSAL']), eq(T.category, q.category)));
  const after = D(a.v).plus(q.amount);
  res.json({ label: EXPENSE_CATEGORIES[q.category], budget: b.amount, actual: fmt2(a.v), after: fmt2(after),
    percentAfter: D(b.amount).gt(0) ? Number(after.div(b.amount).times(100).toFixed(1)) : null, exceeds: after.gt(b.amount), over: fmt2(after.minus(b.amount)) });
}));

financeRouter.put('/budgets', requireAmcosPerm('finance.accounts'), ah(async (req, res) => {
  const body = z.object({ category: z.string(), amount: decimalSchema({ min: 0 }), notes: z.string().trim().nullable().optional() }).parse(req.body);
  if (!(body.category in EXPENSE_CATEGORIES)) throw badRequest('Aina ya matumizi si sahihi');
  const amcosId = await resolveWriteAmcosId(req);
  const season = await currentSeason();
  if (!season) throw badRequest('Hakuna msimu unaoendelea');
  const B = schema.financeBudgets;
  const row = await db.transaction(async (tx) => {
    const [b] = await tx.insert(B).values({ amcosId, seasonId: season.id, category: body.category, amount: body.amount, notes: body.notes ?? null, createdById: req.auth!.userId })
      .onConflictDoUpdate({ target: [B.amcosId, B.seasonId, B.category], set: { amount: body.amount, notes: body.notes ?? null, updatedAt: new Date() } }).returning();
    await audit(tx, req, { action: 'FINANCE_BUDGET_SET', entity: 'FinanceBudget', entityId: b.id, amcosId, after: b });
    return b;
  });
  res.json({ budget: row });
}));

// ------------------------------ RIPOTI ------------------------------
const range = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const defaultRange = (q: { from?: string; to?: string }) => {
  const to = q.to ?? todayStr();
  const from = q.from ?? `${to.slice(0, 4)}-01-01`;
  return { from, to };
};
/** Kiasi halisi: REVERSAL inapunguza aina yake ya asili. */
const signed = sql<string>`case when ${T.kind} = 'REVERSAL' then -${T.amount} else ${T.amount} end`;

financeRouter.get('/reports/summary', requireAmcosPerm('reports.finance'), ah(async (req, res) => {
  const { from, to } = defaultRange(range.parse(req.query));
  const posted = and(amcosScope(req, T.amcosId), eq(T.status, 'POSTED'), gte(T.txnDate, from), lte(T.txnDate, to));
  // Reversal inahesabiwa upande wa muamala wake wa asili (mapato yakisahihishwa yanapungua mapato)
  const origKind = sql<string>`coalesce((select o.kind::text from finance_transactions o where o.id = "finance_transactions"."reversal_of_id"), "finance_transactions"."kind"::text)`;
  const rows = await db.select({ kind: origKind, category: T.category, total: sql<string>`sum(${signed})` })
    .from(T).where(posted).groupBy(origKind, T.category);
  const sum = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s.plus(r.total), D(0));
  const income = sum('INCOME'), expense = sum('EXPENSE'), farmer = sum('FARMER_PAYMENT'), supplier = sum('SUPPLIER_PAYMENT');
  const label = (k: string, c: string) => (k === 'INCOME' ? INCOME_CATEGORIES : k === 'EXPENSE' ? EXPENSE_CATEGORIES : k === 'FARMER_PAYMENT' ? FARMER_PAYMENT_CATEGORIES : SUPPLIER_PAYMENT_CATEGORIES)[c] ?? c;
  const [pending] = await db.select({
    n: count(), v: sql<string>`coalesce(sum(${T.amount}), 0)`,
  }).from(T).where(and(amcosScope(req, T.amcosId), inArray(T.status, ['PENDING_APPROVAL', 'APPROVED'])));
  res.json({
    from, to,
    totals: { income: fmt2(income), expense: fmt2(expense), farmerPayments: fmt2(farmer), supplierPayments: fmt2(supplier), totalOut: fmt2(expense.plus(farmer).plus(supplier)), net: fmt2(income.minus(expense).minus(farmer).minus(supplier)) },
    breakdown: rows.map((r) => ({ kind: r.kind, category: r.category, label: label(r.kind, r.category), total: fmt2(r.total) })).sort((a, b) => a.kind.localeCompare(b.kind) || Number(b.total) - Number(a.total)),
    pending: { count: pending.n, amount: fmt2(pending.v) },
  });
}));

/** Cashbook ya akaunti moja: salio la mwanzo, miamala na salio linalofuatana. */
financeRouter.get('/reports/cashbook', requireAmcosPerm('reports.finance'), ah(async (req, res) => {
  const q = range.extend({ accountId: z.string().uuid() }).parse(req.query);
  const { from, to } = defaultRange(q);
  const acc = await findAccount(req, q.accountId);
  const [before] = await db.select({ net: sql<string>`coalesce(sum(case when ${T.direction} = 'IN' then ${T.amount} else -${T.amount} end), 0)` })
    .from(T).where(and(eq(T.accountId, acc.id), eq(T.status, 'POSTED'), sql`${T.txnDate} < ${from}`));
  const lines = await db.select().from(T).where(and(eq(T.accountId, acc.id), eq(T.status, 'POSTED'), gte(T.txnDate, from), lte(T.txnDate, to)))
    .orderBy(asc(T.txnDate), asc(T.postedAt));
  let run = D(acc.openingBalance).plus(before.net);
  const opening = fmt2(run);
  const out = lines.map((l) => {
    run = l.direction === 'IN' ? run.plus(l.amount) : run.minus(l.amount);
    return { id: l.id, txnNo: l.txnNo, txnDate: l.txnDate, kind: l.kind, category: l.category, description: l.description, reference: l.reference, payee: l.payee,
      moneyIn: l.direction === 'IN' ? l.amount : null, moneyOut: l.direction === 'OUT' ? l.amount : null, balance: fmt2(run) };
  });
  res.json({ account: acc, from, to, opening, closing: fmt2(run), lines: out });
}));

/** Madeni ya wazabuni (accounts payable): thamani ya mzigo uliopokelewa - malipo yaliyokamilika. */
financeRouter.get('/reports/payables', requireAmcosPerm('reports.finance'), ah(async (req, res) => {
  const P = schema.purchaseRequests;
  const rows = await db.select({
    id: P.id, prNo: P.prNo, status: P.status, totalAmount: P.totalAmount,
    supplier: sql<string | null>`(select s.name from suppliers s where s.id = "purchase_requests"."supplier_id")`,
    received: sql<string>`(select coalesce(sum(l.received_qty * l.unit_cost), 0) from purchase_request_lines l where l.purchase_request_id = "purchase_requests"."id")`,
    paid: sql<string>`(select coalesce(sum(case when t.kind = 'REVERSAL' then -t.amount else t.amount end), 0) from finance_transactions t
      where t.purchase_request_id = "purchase_requests"."id" and t.status = 'POSTED' and (t.kind = 'SUPPLIER_PAYMENT' or t.kind = 'REVERSAL'))`,
  }).from(P).where(and(amcosScope(req, P.amcosId), inArray(P.status, ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED']))).orderBy(desc(P.createdAt));
  const data = rows.map((r) => ({ ...r, received: fmt2(r.received), paid: fmt2(r.paid), owing: fmt2(D(r.received).minus(r.paid)) }));
  res.json({ data, totalOwing: fmt2(data.reduce((s, r) => s.plus(D(r.owing).gt(0) ? r.owing : 0), D(0))) });
}));

financeRouter.get('/reports/transactions.csv', requireAmcosPerm('reports.finance'), ah(async (req, res) => {
  const { from, to } = defaultRange(range.parse(req.query));
  const rows = await db.select(txnCols).from(T).leftJoin(ACC, eq(ACC.id, T.accountId))
    .where(and(amcosScope(req, T.amcosId), gte(T.txnDate, from), lte(T.txnDate, to))).orderBy(asc(T.txnDate), asc(T.createdAt));
  const csv = toCsv([
    ['Namba', 'Tarehe', 'Aina', 'Kundi', 'Ndani/Nje', 'Kiasi', 'Akaunti', 'Mlipwaji/Mlipaji', 'Maelezo', 'Kumbukumbu', 'Hali', 'Aliandaa'],
    ...rows.map((r) => [r.txn.txnNo, r.txn.txnDate, r.txn.kind, r.txn.category, r.txn.direction, r.txn.amount, r.account, r.txn.payee, r.txn.description, r.txn.reference, r.txn.status, r.createdBy]),
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="miamala-${from}-${to}.csv"`);
  res.send(csv);
}));

// ------------------------------ MADENI YA WAKULIMA (kwa Mhasibu) ------------------------------
// Mhasibu haoni taarifa binafsi za wakulima; anaona pembejeo walizokopa, mauzo, makato, malipo na deni lote.
const MLE = schema.memberLedgerEntries;

financeRouter.get('/farmers', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const q = paginationQuery.extend({ search: z.string().trim().optional(), filter: z.enum(['all', 'owing', 'owed']).default('owing') }).parse(req.query);
  const M = schema.members;
  const s = q.search ? `%${q.search}%` : null;
  const sums = db.select({
    memberId: MLE.memberId,
    inputs: sql<string>`coalesce(sum(case when ${MLE.referenceType} = 'INPUT_ISSUE' then ${MLE.debit} - ${MLE.credit} else 0 end), 0)`.as('inputs'),
    // Pesa ya kuni na riba yake ni NETI: marekebisho (REVERSAL) ya mkopo/riba yanatolewa
    loans: sql<string>`coalesce(sum(case when ${MLE.type} = 'CASH_LOAN' then ${MLE.debit}
      when ${MLE.type} = 'REVERSAL' and ${MLE.referenceType} = 'FINANCE_TXN' and exists (select 1 from member_ledger_entries c where c.type = 'CASH_LOAN' and c.reference_id = ${MLE.referenceId}) then -${MLE.credit} else 0 end), 0)`.as('loans'),
    interest: sql<string>`coalesce(sum(case when ${MLE.type} = 'LOAN_INTEREST' then ${MLE.debit}
      when ${MLE.type} = 'REVERSAL' and ${MLE.referenceType} = 'KUNI_LOAN' then -${MLE.credit} else 0 end), 0)`.as('interest'),
    sales: sql<string>`coalesce(sum(case when ${MLE.type} = 'TOBACCO_SALE' then ${MLE.credit} else 0 end), 0)`.as('sales'),
    deductions: sql<string>`coalesce(sum(case when ${MLE.type} = 'DEDUCTION' then ${MLE.debit} else 0 end), 0)`.as('deductions'),
    repaid: sql<string>`coalesce(sum(case when ${MLE.type} = 'REPAYMENT' then ${MLE.credit} else 0 end), 0)`.as('repaid'),
    paid: sql<string>`coalesce(sum(case when ${MLE.type} = 'PAYMENT' then ${MLE.debit} else 0 end), 0)`.as('paid'),
    balance: sql<string>`coalesce(sum(${MLE.credit}) - sum(${MLE.debit}), 0)`.as('balance'),
    lastAt: sql<string>`max(${MLE.createdAt})`.as('last_at'),
  }).from(MLE).where(amcosScope(req, MLE.amcosId)).groupBy(MLE.memberId).as('sums');
  const where = and(
    amcosScope(req, M.amcosId),
    s ? or(ilike(M.firstName, s), ilike(M.lastName, s), ilike(M.memberNo, s), ilike(M.village, s)) : undefined,
    q.filter === 'owing' ? sql`${sums.balance} < 0` : q.filter === 'owed' ? sql`${sums.balance} > 0` : undefined,
  );
  const base = db.select({ id: M.id, memberNo: M.memberNo, firstName: M.firstName, lastName: M.lastName, village: M.village, status: M.status,
    groupName: sql<string | null>`(select g.name from member_group_members x join member_groups g on g.id = x.group_id where x.member_id = "members"."id" and x.left_at is null and g.status = 'ACTIVE' limit 1)`,
    inputs: sums.inputs, loans: sums.loans, interest: sums.interest, sales: sums.sales, deductions: sums.deductions, repaid: sums.repaid, paid: sums.paid, balance: sums.balance, lastAt: sums.lastAt })
    .from(M).innerJoin(sums, eq(sums.memberId, M.id)).where(where);
  const [rows, [tot]] = await Promise.all([
    base.orderBy(asc(sql`${sums.balance}`), asc(M.memberNo)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ n: count(), owing: sql<string>`coalesce(sum(case when ${sums.balance} < 0 then -${sums.balance} else 0 end), 0)`,
      owed: sql<string>`coalesce(sum(case when ${sums.balance} > 0 then ${sums.balance} else 0 end), 0)`, inputs: sql<string>`coalesce(sum(${sums.inputs}), 0)` })
      .from(M).innerJoin(sums, eq(sums.memberId, M.id)).where(where),
  ]);
  res.json({
    ...paged(rows.map((r) => ({ ...r, inputs: fmt2(r.inputs), loans: fmt2(r.loans), interest: fmt2(r.interest), sales: fmt2(r.sales), deductions: fmt2(r.deductions), repaid: fmt2(r.repaid), paid: fmt2(r.paid), balance: fmt2(r.balance), amountOwed: fmt2(D(r.balance).lt(0) ? D(r.balance).neg() : 0) })), tot.n, q.page, q.pageSize),
    totals: { farmersOwing: fmt2(tot.owing), owedToFarmers: fmt2(tot.owed), inputs: fmt2(tot.inputs) },
  });
}));

financeRouter.get('/farmers/:id', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
  const m = await findMemberScoped(req, id);
  res.json(await farmerStatement(m, seasonId));
}));

/**
 * Taarifa kamili ya mkulima (ledger, mauzo, pembejeo) — inatumika na ofisi (Fedha) na portal ya mkulima.
 * `approvedOnly`: portal haionyeshi ugawaji unaosubiri idhini (takwimu ambazo bado zinaweza kubadilika).
 */
export async function farmerStatement(m: typeof schema.members.$inferSelect, seasonId?: string, opts: { approvedOnly?: boolean } = {}) {
  const allEntries = await db.select().from(MLE).where(eq(MLE.memberId, m.id)).orderBy(asc(MLE.createdAt));
  // Taarifa ya msimu mmoja: salio la kuanzia (kabla ya msimu) + miamala ya msimu + salio la kufunga
  const seasonList = await db.select({ id: schema.seasons.id, name: schema.seasons.name, startDate: schema.seasons.startDate, endDate: schema.seasons.endDate, isCurrent: schema.seasons.isCurrent })
    .from(schema.seasons).orderBy(desc(schema.seasons.startDate));
  const season = seasonId ? seasonList.find((x) => x.id === seasonId) : undefined;
  if (seasonId && !season) throw notFound('Msimu');
  const dar = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const before = season ? allEntries.filter((e) => dar(e.createdAt) < season.startDate) : [];
  const entries = season ? allEntries.filter((e) => dar(e.createdAt) >= season.startDate && dar(e.createdAt) <= season.endDate) : allEntries;
  const opening = before.reduce((t, e) => t.plus(e.credit).minus(e.debit), D(0));
  let run = opening;
  const statement = entries.map((e) => { run = run.plus(e.credit).minus(e.debit); return { id: e.id, date: e.createdAt, type: e.type, description: e.description, debit: e.debit, credit: e.credit, balance: fmt2(run) }; });
  // Jumla kwa aina ya muamala ndani ya kipindi
  const totals: Record<string, { debit: string; credit: string }> = {};
  for (const e of entries) {
    const t = totals[e.type] ?? { debit: '0', credit: '0' };
    totals[e.type] = { debit: fmt2(D(t.debit).plus(e.debit)), credit: fmt2(D(t.credit).plus(e.credit)) };
  }
  // Mauzo ya tumbaku ya mkulima (hesabu zilizoidhinishwa)
  const S = schema.settlements;
  const sales = await db.select({ id: S.id, settlementNo: S.settlementNo, kg: S.totalKg, grossTzs: S.grossTzs, deductions: S.totalDeductions, netTzs: S.netTzs, status: S.status,
    marketNo: schema.markets.marketNo, marketDate: schema.markets.marketDate, buyer: schema.markets.buyerName })
    .from(S).innerJoin(schema.markets, eq(schema.markets.id, S.marketId))
    .where(and(eq(S.memberId, m.id), inArray(S.status, ['APPROVED', 'PAID']), season ? eq(S.seasonId, season.id) : undefined))
    .orderBy(asc(schema.markets.marketDate));
  const [grp] = await db.select({ name: schema.memberGroups.name }).from(schema.memberGroupMembers)
    .innerJoin(schema.memberGroups, eq(schema.memberGroups.id, schema.memberGroupMembers.groupId))
    .where(and(eq(schema.memberGroupMembers.memberId, m.id), isNull(schema.memberGroupMembers.leftAt))).limit(1);
  const I = schema.inputIssues;
  const issues = (await db.select().from(I).where(and(eq(I.memberId, m.id), opts.approvedOnly ? sql`${I.status} in ('ISSUED', 'CANCELLED')` : sql`${I.status} in ('ISSUED', 'CANCELLED', 'PENDING_APPROVAL')`)).orderBy(desc(I.issuedAt)))
    .filter((i) => !season || (i.issuedAt ? dar(i.issuedAt) >= season.startDate && dar(i.issuedAt) <= season.endDate : true));
  const lines = issues.length ? await db.select({ l: schema.inputIssueLines, name: schema.inputItems.name, unit: schema.inputItems.unit })
    .from(schema.inputIssueLines).innerJoin(schema.inputItems, eq(schema.inputItems.id, schema.inputIssueLines.inputItemId))
    .where(inArray(schema.inputIssueLines.inputIssueId, issues.map((i) => i.id))) : [];
  const byItem = new Map<string, { name: string; unit: string; quantity: ReturnType<typeof D>; kg: ReturnType<typeof D>; amount: ReturnType<typeof D>; amountUsd: ReturnType<typeof D> }>();
  for (const x of lines) {
    const iss = issues.find((i) => i.id === x.l.inputIssueId)!;
    if (iss.status !== 'ISSUED') continue;
    const cur = byItem.get(x.l.inputItemId) ?? { name: x.name, unit: x.unit, quantity: D(0), kg: D(0), amount: D(0), amountUsd: D(0) };
    // Mifuko kamili na kilo (vitalu) zinahesabiwa kando ili taarifa isionyeshe "mifuko 0.06"
    if (x.l.kg) cur.kg = cur.kg.plus(x.l.kg); else cur.quantity = cur.quantity.plus(x.l.quantity);
    cur.amount = cur.amount.plus(x.l.amount); cur.amountUsd = cur.amountUsd.plus(x.l.amountUsd ?? 0);
    byItem.set(x.l.inputItemId, cur);
  }
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, m.amcosId) }))!;
  const usd = await usdSummary(m.amcosId, m.id);
  return {
    usd,
    member: { id: m.id, memberNo: m.memberNo, firstName: m.firstName, middleName: m.middleName, lastName: m.lastName, village: m.village, status: m.status, group: grp?.name ?? null },
    amcos: { name: amcos.name, code: amcos.code },
    seasons: seasonList, season: season ?? null, opening: fmt2(opening), totals,
    sales: sales.map((x) => ({ ...x, kg: fmt2(x.kg), grossTzs: fmt2(x.grossTzs), deductions: fmt2(x.deductions), netTzs: fmt2(x.netTzs) })),
    balance: fmt2(run), amountOwed: fmt2(run.lt(0) ? run.neg() : 0),
    inputsSummary: [...byItem.values()].map((v) => ({ name: v.name, unit: v.unit, quantity: fmt2(v.quantity), kg: v.kg.gt(0) ? fmt2(v.kg) : null, amount: fmt2(v.amount), amountUsd: v.amountUsd.gt(0) ? fmt2(v.amountUsd) : null })),
    issues: issues.map((i) => ({ id: i.id, issueNo: i.issueNo, issuedAt: i.issuedAt, status: i.status, totalAmount: i.totalAmount, cancelReason: i.cancelReason,
      currency: i.currency, totalUsd: i.totalUsd, fxRate: i.fxRate,
      lines: lines.filter((x) => x.l.inputIssueId === i.id).map((x) => ({ name: x.name, unit: x.unit, quantity: x.l.quantity, kg: x.l.kg, unitPrice: x.l.unitPrice, amount: x.l.amount, unitPriceUsd: x.l.unitPriceUsd, amountUsd: x.l.amountUsd })) })),
    statement,
  };
}
