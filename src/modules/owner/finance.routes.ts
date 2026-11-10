// =====================================================================
//  FINANCE & REVENUE — mapato ya KAMPUNI (CoopLink / DUKALANGU SOLUTION) pekee.
//  Hakuna kinachosomwa wala kuandikwa kwenye ledger ya wanachama wa vyama.
//  Malipo yote yanaanza PENDING; yanakuwa VERIFIED tu kwa uthibitisho wa mtu (na nenosiri).
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../../lib/http';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { extendSubscription, nextInvoiceNo } from '../../lib/subscriptions';
import { rangeQuery, toCsv } from './common';

export const financeRouter = Router();
const Pay = schema.platformPayments;
const Exp = schema.platformExpenses;

// ------------------------------ MALIPO ------------------------------
financeRouter.get(
  '/payments',
  requirePermission('finance.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({
      status: z.enum(schema.platformPaymentStatusEnum.enumValues).optional(),
      amcosId: z.string().uuid().optional(),
      from: z.string().optional(), to: z.string().optional(),
    }).parse(req.query);
    const r = q.from || q.to ? rangeQuery.parse({ from: q.from, to: q.to }) : null;
    const where = and(
      q.status ? eq(Pay.status, q.status) : undefined,
      q.amcosId ? eq(Pay.amcosId, q.amcosId) : undefined,
      r ? and(gte(Pay.paidAt, r.fromTs), lt(Pay.paidAt, r.toTs)) : undefined,
    );
    const rows = await db.select({ p: Pay, amcos: { id: schema.amcos.id, name: schema.amcos.name, code: schema.amcos.code } })
      .from(Pay).leftJoin(schema.amcos, eq(schema.amcos.id, Pay.amcosId))
      .where(where).orderBy(desc(Pay.paidAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(Pay).where(where);
    res.json(paged(rows.map((x) => ({ ...x.p, amcos: x.amcos })), total, q.page, q.pageSize));
  }),
);

financeRouter.post(
  '/payments',
  requirePermission('finance.manage'),
  ah(async (req, res) => {
    const b = z.object({
      amcosId: z.string().uuid().nullable().optional(),
      subscriptionId: z.string().uuid().nullable().optional(),
      category: z.enum(schema.platformPaymentCategoryEnum.enumValues),
      amount: decimalSchema({ min: 0.01 }),
      method: z.enum(schema.paymentMethodEnum.enumValues),
      providerRef: z.string().trim().min(3).max(80).nullable().optional(),
      paidAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      periods: z.number().int().min(1).max(36).default(1),
      cycle: z.enum(['MONTHLY', 'ANNUAL']).nullable().optional(),
      notes: z.string().trim().nullable().optional(),
    }).parse(req.body);
    if (b.category === 'SUBSCRIPTION' && !b.subscriptionId) throw badRequest('Chagua subscription inayolipiwa');
    let amcosId = b.amcosId ?? null;
    if (b.subscriptionId) {
      const sub = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, b.subscriptionId) });
      if (!sub) throw notFound('Subscription');
      if (amcosId && amcosId !== sub.amcosId) throw badRequest('Subscription si ya chama hiki');
      if (sub.status === 'CANCELLED') throw badRequest('Subscription hii imefutwa');
      if (sub.cycle === 'TRIAL' && !b.cycle) throw badRequest('Chagua mzunguko wa kulipia (mwezi au mwaka) kwa chama kilicho kwenye trial');
      amcosId = sub.amcosId;
    }
    if (b.providerRef) {
      const dup = await db.query.platformPayments.findFirst({ where: eq(Pay.providerRef, b.providerRef) });
      if (dup) throw conflict(`Muamala ${b.providerRef} tayari umerekodiwa (${dup.invoiceNo})`);
    }
    const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(b.paidAt) ? new Date(`${b.paidAt}T12:00:00+03:00`) : new Date(b.paidAt);
    const row = await db.transaction(async (tx) => {
      const [p] = await tx.insert(Pay).values({
        invoiceNo: await nextInvoiceNo(tx), amcosId, subscriptionId: b.subscriptionId ?? null, category: b.category,
        amount: b.amount, method: b.method, providerRef: b.providerRef ?? null, periods: b.periods, cycle: b.cycle ?? null,
        status: 'PENDING', paidAt, notes: b.notes ?? null, createdById: req.auth!.userId,
      }).returning();
      await audit(tx, req, { action: 'PLATFORM_PAYMENT_RECORD', entity: 'PlatformPayment', entityId: p.id, amcosId, after: p });
      return p;
    });
    res.status(201).json({ payment: row });
  }),
);

async function lockPayment(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) {
  const [p] = await tx.select().from(Pay).where(eq(Pay.id, id)).for('update');
  if (!p) throw notFound('Malipo');
  return p;
}

financeRouter.post(
  '/payments/:id/verify',
  requirePermission('finance.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await requireReauth(req);
    const result = await db.transaction(async (tx) => {
      const p = await lockPayment(tx, id);
      if (p.status !== 'PENDING') throw conflict(`Malipo haya ni ${p.status}, hayawezi kuthibitishwa tena`);
      const [v] = await tx.update(Pay).set({ status: 'VERIFIED', verifiedById: req.auth!.userId, verifiedAt: new Date() }).where(eq(Pay.id, id)).returning();
      let extension = null;
      if (p.category === 'SUBSCRIPTION' && p.subscriptionId) {
        const sub = (await tx.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, p.subscriptionId) }))!;
        const plan = (await tx.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.id, sub.planId) }))!;
        const out = await extendSubscription(tx, sub, { periods: p.periods, cycle: p.cycle ?? undefined, plan });
        extension = { from: sub.endDate, to: out.sub.endDate, status: out.sub.status, access: out.access };
      }
      await audit(tx, req, { action: 'PLATFORM_PAYMENT_VERIFY', entity: 'PlatformPayment', entityId: id, amcosId: p.amcosId,
        before: { status: p.status }, after: { status: 'VERIFIED', amount: p.amount, extension } });
      return { payment: v, extension };
    });
    res.json(result);
  }),
);

financeRouter.post(
  '/payments/:id/fail',
  requirePermission('finance.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
    const row = await db.transaction(async (tx) => {
      const p = await lockPayment(tx, id);
      if (p.status !== 'PENDING') throw conflict('Malipo yanayosubiri tu ndiyo yanaweza kukataliwa');
      const [v] = await tx.update(Pay).set({ status: 'FAILED', failureReason: reason }).where(eq(Pay.id, id)).returning();
      await audit(tx, req, { action: 'PLATFORM_PAYMENT_FAIL', entity: 'PlatformPayment', entityId: id, amcosId: p.amcosId, before: { status: p.status }, after: { status: 'FAILED', reason } });
      return v;
    });
    res.json({ payment: row });
  }),
);

financeRouter.post(
  '/payments/:id/refund',
  requirePermission('finance.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3) }).passthrough().parse(req.body);
    await requireReauth(req);
    const row = await db.transaction(async (tx) => {
      const p = await lockPayment(tx, id);
      if (p.status !== 'VERIFIED') throw conflict('Malipo yaliyothibitishwa tu ndiyo yanaweza kurudishwa');
      const [v] = await tx.update(Pay).set({ status: 'REFUNDED', refundedAt: new Date(), refundReason: reason }).where(eq(Pay.id, id)).returning();
      await audit(tx, req, { action: 'PLATFORM_PAYMENT_REFUND', entity: 'PlatformPayment', entityId: id, amcosId: p.amcosId, before: { status: p.status }, after: { status: 'REFUNDED', reason, amount: p.amount } });
      return v;
    });
    res.json({ payment: row });
  }),
);

// ------------------------------ MATUMIZI ------------------------------
financeRouter.get(
  '/expenses',
  requirePermission('finance.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({ category: z.enum(schema.expenseCategoryEnum.enumValues).optional(), from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const r = q.from || q.to ? rangeQuery.parse({ from: q.from, to: q.to }) : null;
    const where = and(q.category ? eq(Exp.category, q.category) : undefined, r ? sql`${Exp.spentAt} between ${r.from} and ${r.to}` : undefined);
    const rows = await db.select().from(Exp).where(where).orderBy(desc(Exp.spentAt), desc(Exp.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(Exp).where(where);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

financeRouter.post(
  '/expenses',
  requirePermission('finance.manage'),
  ah(async (req, res) => {
    const b = z.object({
      category: z.enum(schema.expenseCategoryEnum.enumValues),
      amount: decimalSchema({ min: 0.01 }),
      description: z.string().trim().min(3),
      vendor: z.string().trim().nullable().optional(),
      spentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [e] = await tx.insert(Exp).values({ ...b, createdById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'PLATFORM_EXPENSE_RECORD', entity: 'PlatformExpense', entityId: e.id, after: e });
      return e;
    });
    res.status(201).json({ expense: row });
  }),
);

// ------------------------------ RIPOTI ------------------------------
async function buildReport(from: string, to: string, fromTs: Date, toTs: Date) {
  const one = async (q: SQL) => (await db.execute(q)).rows[0] as Record<string, string>;
  const revenue = (await db.execute(sql`
    select category, coalesce(sum(amount), 0) as total, count(*)::int as n from platform_payments
    where status = 'VERIFIED' and paid_at >= ${fromTs} and paid_at < ${toTs} group by category`)).rows as { category: string; total: string; n: number }[];
  const refunds = await one(sql`select coalesce(sum(amount), 0) as total, count(*)::int as n from platform_payments where status = 'REFUNDED' and refunded_at >= ${fromTs} and refunded_at < ${toTs}`);
  const expenses = (await db.execute(sql`
    select category, coalesce(sum(amount), 0) as total, count(*)::int as n from platform_expenses
    where spent_at between ${from} and ${to} group by category`)).rows as { category: string; total: string; n: number }[];
  const tx = await one(sql`
    select count(*) filter (where status = 'VERIFIED')::int as successful, count(*) filter (where status = 'FAILED')::int as failed,
      count(*) filter (where status = 'PENDING')::int as pending, count(*) filter (where status = 'REFUNDED')::int as refunded
    from platform_payments where paid_at >= ${fromTs} and paid_at < ${toTs}`);
  // Yanayodaiwa: malipo yanayosubiri + subscriptions zilizopita muda bila kulipwa (bei ya kipindi kimoja)
  const outstanding = await one(sql`
    select (select coalesce(sum(amount), 0) from platform_payments where status = 'PENDING') as pending_payments,
      (select coalesce(sum(price), 0) from subscriptions where status in ('PAST_DUE','EXPIRED') and cycle <> 'TRIAL') as overdue_subscriptions,
      (select count(*)::int from subscriptions where status in ('PAST_DUE','EXPIRED')) as overdue_count`);
  const series = (await db.execute(sql`
    with months as (select generate_series(date_trunc('month', ${toTs}::timestamptz at time zone 'Africa/Dar_es_Salaam') - interval '11 months',
      date_trunc('month', ${toTs}::timestamptz at time zone 'Africa/Dar_es_Salaam'), interval '1 month') as m)
    select to_char(m, 'YYYY-MM') as month,
      (select coalesce(sum(amount), 0) from platform_payments p where p.status = 'VERIFIED' and date_trunc('month', p.paid_at at time zone 'Africa/Dar_es_Salaam') = m) as revenue,
      (select coalesce(sum(amount), 0) from platform_expenses e where date_trunc('month', e.spent_at) = m) as expenses
    from months order by m`)).rows as { month: string; revenue: string; expenses: string }[];

  const sum = (rows: { total: string }[]) => rows.reduce((s, r) => s + Number(r.total), 0);
  const totalRevenue = sum(revenue);
  const totalExpenses = sum(expenses);
  const subscriptionRevenue = Number(revenue.find((r) => r.category === 'SUBSCRIPTION')?.total ?? 0);
  return {
    range: { from, to },
    revenue: { total: totalRevenue.toFixed(2), subscription: subscriptionRevenue.toFixed(2), other: (totalRevenue - subscriptionRevenue).toFixed(2), byCategory: revenue },
    refunds, expenses: { total: totalExpenses.toFixed(2), byCategory: expenses },
    profit: (totalRevenue - Number(refunds.total) - totalExpenses).toFixed(2),
    transactions: tx, outstanding, series,
  };
}

financeRouter.get(
  '/report',
  requirePermission('finance.read'),
  ah(async (req, res) => {
    const r = rangeQuery.parse(req.query);
    res.json(await buildReport(r.from, r.to, r.fromTs, r.toTs));
  }),
);

financeRouter.get(
  '/export.csv',
  requirePermission('finance.read'),
  ah(async (req, res) => {
    const r = rangeQuery.parse(req.query);
    const rep = await buildReport(r.from, r.to, r.fromTs, r.toTs);
    const pays = await db.select({ p: Pay, name: schema.amcos.name }).from(Pay).leftJoin(schema.amcos, eq(schema.amcos.id, Pay.amcosId))
      .where(and(gte(Pay.paidAt, r.fromTs), lt(Pay.paidAt, r.toTs))).orderBy(Pay.paidAt);
    const exps = await db.select().from(Exp).where(sql`${Exp.spentAt} between ${r.from} and ${r.to}`).orderBy(Exp.spentAt);
    const rows: (string | number | null)[][] = [
      ['COOPLINK - RIPOTI YA FEDHA ZA KAMPUNI', `${r.from} hadi ${r.to}`],
      [],
      ['MUHTASARI'],
      ['Mapato yote (yaliyothibitishwa)', rep.revenue.total],
      ['Mapato ya subscriptions', rep.revenue.subscription],
      ['Mapato mengine', rep.revenue.other],
      ['Marejesho (refunds)', rep.refunds.total],
      ['Matumizi', rep.expenses.total],
      ['Faida / Hasara', rep.profit],
      ['Yanayodaiwa (malipo yanayosubiri)', rep.outstanding.pending_payments],
      ['Yanayodaiwa (subscriptions zilizopita muda)', rep.outstanding.overdue_subscriptions],
      [],
      ['MALIPO'],
      ['Ankara', 'Tarehe', 'Chama', 'Aina', 'Njia', 'Kumbukumbu', 'Kiasi', 'Hali'],
      ...pays.map(({ p, name }) => [p.invoiceNo, p.paidAt.toISOString().slice(0, 10), name ?? '', p.category, p.method, p.providerRef ?? '', p.amount, p.status]),
      [],
      ['MATUMIZI'],
      ['Tarehe', 'Aina', 'Maelezo', 'Mtoa huduma', 'Kiasi'],
      ...exps.map((e) => [e.spentAt, e.category, e.description, e.vendor ?? '', e.amount]),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cooplink-fedha-${r.from}-${r.to}.csv"`);
    res.send(toCsv(rows));
  }),
);
