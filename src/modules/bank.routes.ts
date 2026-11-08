// =====================================================================
//  BENKI NA VOCHA (Mhasibu)
//   Uhamisho kati ya akaunti za chama (kwa idhini) · Usuluhishi wa benki (bank reconciliation)
//   · Vocha ya malipo / risiti ya kuchapisha
// =====================================================================
import { Router, type Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { createApproval } from '../lib/approvals';
import { EXPENSE_CATEGORIES, FARMER_PAYMENT_CATEGORIES, INCOME_CATEGORIES, nextTxnNo } from '../lib/finance';
import { currentSeason } from './seasons.routes';
import { todayStr } from './accounting.routes';

export const bankRouter = Router();
const T = schema.financeTransactions;
const ACC = schema.financeAccounts;
const R = schema.bankReconciliations;
const RI = schema.bankReconciliationItems;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');

async function account(req: Request, id: string) {
  const [a] = await db.select().from(ACC).where(and(eq(ACC.id, id), amcosScope(req, ACC.amcosId)));
  if (!a) throw notFound('Akaunti');
  return a;
}

// ------------------------------ UHAMISHO ------------------------------
/** Kuhamisha fedha (mf. taslimu -> benki). Pande mbili zinaandaliwa pamoja, Meneja anaidhinisha, Mhasibu anakamilisha. */
bankRouter.post('/transfers', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = z.object({
    fromAccountId: z.string().uuid(), toAccountId: z.string().uuid(), amount: decimalSchema({ min: 0.01 }),
    txnDate: dateStr.optional(), description: z.string().trim().min(3, 'Eleza uhamisho huu'), reference: z.string().trim().nullable().optional(),
  }).parse(req.body);
  if (body.fromAccountId === body.toAccountId) throw badRequest('Chagua akaunti mbili tofauti');
  const amcosId = await resolveWriteAmcosId(req);
  const [from, to] = [await account(req, body.fromAccountId), await account(req, body.toAccountId)];
  if (!from.isActive || !to.isActive) throw badRequest('Akaunti mojawapo imefungwa');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const season = await currentSeason();
  const group = randomUUID();
  const out = await db.transaction(async (tx) => {
    const base = {
      amcosId, seasonId: season?.id ?? null, kind: 'TRANSFER' as const, category: 'TRANSFER', amount: body.amount, txnDate: body.txnDate ?? todayStr(),
      reference: body.reference ?? null, transferGroupId: group, status: 'PENDING_APPROVAL' as const, createdById: req.auth!.userId,
    };
    const [o] = await tx.insert(T).values({ ...base, txnNo: await nextTxnNo(tx, amcosId, amcos.code), direction: 'OUT', accountId: from.id, payee: to.name, description: `Uhamisho kwenda ${to.name}: ${body.description}` }).returning();
    const [i] = await tx.insert(T).values({ ...base, txnNo: await nextTxnNo(tx, amcosId, amcos.code), direction: 'IN', accountId: to.id, payee: from.name, description: `Uhamisho kutoka ${from.name}: ${body.description}` }).returning();
    const approval = await createApproval(tx, req, {
      amcosId, type: 'TRANSFER', entityType: 'FinanceTransaction', entityId: o.id, amount: body.amount,
      title: `Uhamisho ${tshText(body.amount)}: ${from.name} → ${to.name}`, reason: body.description,
    });
    await tx.update(T).set({ approvalId: approval.id }).where(eq(T.transferGroupId, group));
    await audit(tx, req, { action: 'TRANSFER_PREPARE', entity: 'FinanceTransaction', entityId: o.id, amcosId, after: { out: o.txnNo, in: i.txnNo, amount: body.amount } });
    return { approval, out: o, in: i };
  });
  res.status(201).json(out);
}));

// ------------------------------ USULUHISHI WA BENKI ------------------------------
/** Miamala ya akaunti iliyokamilika hadi tarehe ya taarifa ya benki, ambayo bado haijasuluhishwa. */
bankRouter.get('/reconciliation/:id', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { statementDate } = z.object({ statementDate: dateStr.optional() }).parse(req.query);
  const acc = await account(req, id);
  const date = statementDate ?? todayStr();
  const book = await db.select({ net: sql<string>`coalesce(sum(case when direction = 'IN' then amount else -amount end), 0)` })
    .from(T).where(and(eq(T.accountId, acc.id), eq(T.status, 'POSTED'), lte(T.txnDate, date)));
  const cleared = await db.select({ net: sql<string>`coalesce(sum(case when ${T.direction} = 'IN' then ${T.amount} else -${T.amount} end), 0)` })
    .from(RI).innerJoin(T, eq(T.id, RI.financeTxnId)).where(eq(T.accountId, acc.id));
  const open = await db.select().from(T).where(and(eq(T.accountId, acc.id), eq(T.status, 'POSTED'), lte(T.txnDate, date),
    sql`not exists (select 1 from bank_reconciliation_items i where i.finance_txn_id = "finance_transactions"."id")`)).orderBy(asc(T.txnDate), asc(T.postedAt));
  const history = await db.select({
    rec: R, by: sql<string | null>`(select u.full_name from users u where u.id = "bank_reconciliations"."created_by_id")`,
    items: sql<number>`(select count(*)::int from bank_reconciliation_items i where i.reconciliation_id = "bank_reconciliations"."id")`,
  }).from(R).where(eq(R.accountId, acc.id)).orderBy(desc(R.statementDate), desc(R.createdAt));
  res.json({
    account: acc, statementDate: date,
    bookBalance: fmt2(D(acc.openingBalance).plus(book[0].net)),
    clearedBefore: fmt2(D(acc.openingBalance).plus(cleared[0]?.net ?? 0)),
    uncleared: open.map((t) => ({ id: t.id, txnNo: t.txnNo, txnDate: t.txnDate, description: t.description, reference: t.reference, kind: t.kind, direction: t.direction, amount: t.amount })),
    history: history.map((h) => ({ ...h.rec, createdBy: h.by, items: h.items })),
  });
}));

/** Kukamilisha usuluhishi: salio la benki LAZIMA lilingane na miamala iliyothibitishwa (tofauti = 0). */
bankRouter.post('/reconciliation/:id', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    statementDate: dateStr, statementBalance: decimalSchema({ allowNegative: true }), clearedTxnIds: z.array(z.string().uuid()).max(5000),
    notes: z.string().trim().nullable().optional(),
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const acc = await account(req, id);
  if (body.statementDate > todayStr()) throw badRequest('Tarehe ya taarifa ya benki haiwezi kuwa ya baadaye');
  const rec = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'recon:' + acc.id}))`);
    const picked = body.clearedTxnIds.length ? await tx.select().from(T).where(and(inArray(T.id, body.clearedTxnIds), eq(T.accountId, acc.id))) : [];
    if (picked.length !== new Set(body.clearedTxnIds).size) throw badRequest('Baadhi ya miamala haiko kwenye akaunti hii');
    for (const t of picked) {
      if (t.status !== 'POSTED') throw badRequest(`${t.txnNo} haijakamilika`);
      if (t.txnDate > body.statementDate) throw badRequest(`${t.txnNo} ni ya baada ya tarehe ya taarifa`);
    }
    const already = picked.length ? await tx.select({ id: RI.financeTxnId }).from(RI).where(inArray(RI.financeTxnId, picked.map((p) => p.id))) : [];
    if (already.length) throw badRequest('Baadhi ya miamala tayari imesuluhishwa');
    const net = (rows: typeof picked) => rows.reduce((s, t) => (t.direction === 'IN' ? s.plus(t.amount) : s.minus(t.amount)), D(0));
    const [prev] = await tx.select({ net: sql<string>`coalesce(sum(case when ${T.direction} = 'IN' then ${T.amount} else -${T.amount} end), 0)` })
      .from(RI).innerJoin(T, eq(T.id, RI.financeTxnId)).where(eq(T.accountId, acc.id));
    const clearedBalance = D(acc.openingBalance).plus(prev?.net ?? 0).plus(net(picked));
    const diff = D(body.statementBalance).minus(clearedBalance);
    if (!diff.isZero()) throw badRequest(`Usuluhishi haujalingana: salio la benki TSh ${fmt2(body.statementBalance)} − miamala iliyothibitishwa TSh ${fmt2(clearedBalance)} = tofauti TSh ${fmt2(diff)}. Rekodi gharama/mapato yaliyo kwenye taarifa ya benki kwanza.`);
    const all = await tx.select().from(T).where(and(eq(T.accountId, acc.id), eq(T.status, 'POSTED'), lte(T.txnDate, body.statementDate)));
    const pickedIds = new Set(picked.map((p) => p.id));
    const reconciled = new Set((await tx.select({ id: RI.financeTxnId }).from(RI).innerJoin(T, eq(T.id, RI.financeTxnId)).where(eq(T.accountId, acc.id))).map((r) => r.id));
    const open = all.filter((t) => !pickedIds.has(t.id) && !reconciled.has(t.id));
    const book = D(acc.openingBalance).plus(net(all));
    const [r] = await tx.insert(R).values({
      amcosId, accountId: acc.id, statementDate: body.statementDate, statementBalance: fmt2(body.statementBalance), bookBalance: fmt2(book),
      clearedBalance: fmt2(clearedBalance), unclearedIn: fmt2(open.filter((t) => t.direction === 'IN').reduce((s, t) => s.plus(t.amount), D(0))),
      unclearedOut: fmt2(open.filter((t) => t.direction === 'OUT').reduce((s, t) => s.plus(t.amount), D(0))), notes: body.notes ?? null, createdById: req.auth!.userId,
    }).returning();
    if (picked.length) await tx.insert(RI).values(picked.map((p) => ({ reconciliationId: r.id, financeTxnId: p.id })));
    await audit(tx, req, { action: 'BANK_RECONCILIATION_COMPLETE', entity: 'BankReconciliation', entityId: r.id, amcosId, after: { ...r, cleared: picked.length } });
    return r;
  });
  res.status(201).json({ reconciliation: rec });
}));

// ------------------------------ VOCHA / RISITI ------------------------------
bankRouter.get('/voucher/:id', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const amcosId = await readAmcosId(req);
  const [t] = await db.select({
    txn: T, account: ACC.name, accountKind: ACC.kind, bankName: ACC.bankName, accountNumber: ACC.accountNumber,
    createdBy: sql<string | null>`(select u.full_name from users u where u.id = "finance_transactions"."created_by_id")`,
    postedBy: sql<string | null>`(select u.full_name from users u where u.id = "finance_transactions"."posted_by_id")`,
    member: sql<string | null>`(select m.first_name || ' ' || m.last_name || ' (' || m.member_no || ')' from members m where m.id = "finance_transactions"."member_id")`,
    contra: sql<string | null>`(select g.code || ' ' || g.name from gl_accounts g where g.id = "finance_transactions"."contra_gl_account_id")`,
  }).from(T).leftJoin(ACC, eq(ACC.id, T.accountId)).where(and(eq(T.id, id), eq(T.amcosId, amcosId)));
  if (!t) throw notFound('Muamala');
  const approval = t.txn.approvalId ? await db.select({
    a: schema.approvalRequests, by: sql<string | null>`(select u.full_name from users u where u.id = "approval_requests"."decided_by_id")`,
  }).from(schema.approvalRequests).where(eq(schema.approvalRequests.id, t.txn.approvalId)) : [];
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const labels: Record<string, string> = { ...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES, ...FARMER_PAYMENT_CATEGORIES, SUPPLIER: 'Malipo kwa mzabuni', TRANSFER: 'Uhamisho kati ya akaunti' };
  res.json({
    kind: t.txn.direction === 'IN' ? 'RECEIPT' : 'PAYMENT_VOUCHER',
    amcos: { name: amcos.name, code: amcos.code, regNumber: amcos.regNumber, region: amcos.region, district: amcos.district, ward: amcos.ward, village: amcos.village, phone: amcos.phone, email: amcos.email },
    transaction: { ...t.txn, categoryLabel: labels[t.txn.category] ?? t.txn.category, accountName: t.account, accountKind: t.accountKind, bankName: t.bankName, accountNumber: t.accountNumber,
      createdBy: t.createdBy, postedBy: t.postedBy, memberName: t.member, contraAccount: t.contra },
    approval: approval[0] ? { requestNo: approval[0].a.requestNo, decidedBy: approval[0].by, decidedAt: approval[0].a.decidedAt, note: approval[0].a.decisionNote } : null,
  });
}));
