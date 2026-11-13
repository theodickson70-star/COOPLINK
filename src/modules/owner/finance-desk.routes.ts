// =====================================================================
//  FINANCE DESK (v0.36) — kazi za Finance Manager wa CoopLink
//   GET  /owner/finance/overview              dashibodi ya kazi: mapato ya mwezi vs lengo, foleni ya idhini, madeni, ukusanyaji
//   GET  /owner/finance/receivables           madeni ya ada (umri wa deni), ukusanyaji kwa msimu
//   POST /owner/finance/receivables/remind    vikumbusho vya ada (kupitia mfumo wa matangazo uliopo; mara 1 kwa saa 24 kwa chama)
//   GET  /owner/finance/budgets?month=        bajeti dhidi ya matumizi halisi kwa aina
//   PUT  /owner/finance/budgets               kuweka bajeti ya mwezi
//   GET  /owner/finance/statement/:amcosId    taarifa ya mteja (ada, malipo, salio) + .csv
//  Fedha za KAMPUNI pekee — hakuna kinachosomwa kwenye fedha za vyama wala wakulima.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, decimalSchema, uuidParam } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { today } from '../../lib/subscriptions';
import { deliver, resolveTargets } from './comms.routes';
import { toCsv } from './common';

export const financeDeskRouter = Router();
const CATS = schema.expenseCategoryEnum.enumValues;
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mwezi uwe YYYY-MM');
const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
const one = async <T>(q: ReturnType<typeof sql>) => (await rows<T>(q))[0];
const n = (v: unknown) => Number(v ?? 0);
const REMINDER_TITLE = 'Ada ya CoopLink';

/** Ndoo za umri wa deni (siku tangu tarehe ya mwisho). */
const bucketOf = (t: string) => sql`case when f.due_date >= ${t}::date then 'CURRENT'
  when ${t}::date - f.due_date <= 30 then 'D1_30' when ${t}::date - f.due_date <= 60 then 'D31_60'
  when ${t}::date - f.due_date <= 90 then 'D61_90' else 'D90_PLUS' end`;

// ------------------------------ DASHIBODI YA KAZI ------------------------------
financeDeskRouter.get('/overview', requirePermission('finance.read'), ah(async (req, res) => {
  const me = req.auth!;
  const t = today(); const month = t.slice(0, 7);
  const prev = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
  const TZ = sql`'Africa/Dar_es_Salaam'`;
  const [rev, target, exp, budget, queue, recv, collect, byMethod, series, top] = await Promise.all([
    one<{ mtd: string; prev: string; prev_to_date: string }>(sql`select
      coalesce(sum(amount) filter (where to_char(paid_at at time zone ${TZ}, 'YYYY-MM') = ${month}), 0) as mtd,
      coalesce(sum(amount) filter (where to_char(paid_at at time zone ${TZ}, 'YYYY-MM') = ${prev}), 0) as prev,
      coalesce(sum(amount) filter (where to_char(paid_at at time zone ${TZ}, 'YYYY-MM') = ${prev}
        and extract(day from paid_at at time zone ${TZ}) <= extract(day from now() at time zone ${TZ})), 0) as prev_to_date
      from platform_payments where status = 'VERIFIED'`),
    one<{ v: string | null }>(sql`select target_value as v from business_targets where metric = 'REVENUE' and period = ${month}`),
    one<{ approved: string; pending: string }>(sql`select
      coalesce(sum(amount) filter (where status = 'APPROVED' and to_char(spent_at, 'YYYY-MM') = ${month}), 0) as approved,
      coalesce(sum(amount) filter (where status = 'PENDING'), 0) as pending from platform_expenses`),
    one<{ v: string }>(sql`select coalesce(sum(amount), 0) as v from platform_budgets where period = ${month}`),
    one<{ pay_n: number; pay_sum: string; pay_mine: number; exp_n: number; exp_sum: string; exp_mine: number }>(sql`select
      (select count(*)::int from platform_payments where status = 'PENDING') as pay_n,
      (select coalesce(sum(amount), 0) from platform_payments where status = 'PENDING') as pay_sum,
      (select count(*)::int from platform_payments where status = 'PENDING' and created_by_id = ${me.userId}) as pay_mine,
      (select count(*)::int from platform_expenses where status = 'PENDING') as exp_n,
      (select coalesce(sum(amount), 0) from platform_expenses where status = 'PENDING') as exp_sum,
      (select count(*)::int from platform_expenses where status = 'PENDING' and created_by_id = ${me.userId}) as exp_mine`),
    one<{ outstanding: string; overdue: string; overdue_n: number; due_soon: number; debtors: number }>(sql`select
      coalesce(sum(f.amount - f.paid), 0) as outstanding,
      coalesce(sum(f.amount - f.paid) filter (where f.due_date < ${t}::date), 0) as overdue,
      count(*) filter (where f.due_date < ${t}::date)::int as overdue_n,
      count(*) filter (where f.due_date between ${t}::date and ${t}::date + 7)::int as due_soon,
      count(distinct f.amcos_id)::int as debtors
      from platform_fees f where f.status in ('UNPAID', 'PARTIAL')`),
    one<{ due: string; paid: string; waived: string; label: string | null }>(sql`select max(label) as label,
      coalesce(sum(amount) filter (where status <> 'WAIVED'), 0) as due, coalesce(sum(paid) filter (where status <> 'WAIVED'), 0) as paid,
      coalesce(sum(amount) filter (where status = 'WAIVED'), 0) as waived
      from platform_fees where kind = 'SEASON' and due_date = (select max(due_date) from platform_fees where kind = 'SEASON')`),
    rows<{ method: string; total: string; n: number }>(sql`select method, coalesce(sum(amount), 0) as total, count(*)::int as n from platform_payments
      where status = 'VERIFIED' and to_char(paid_at at time zone ${TZ}, 'YYYY-MM') = ${month} group by method order by total desc`),
    rows<{ month: string; revenue: string; expenses: string }>(sql`
      with months as (select generate_series(date_trunc('month', now() at time zone ${TZ}) - interval '5 months', date_trunc('month', now() at time zone ${TZ}), interval '1 month') as m)
      select to_char(m, 'YYYY-MM') as month,
        (select coalesce(sum(amount), 0) from platform_payments p where p.status = 'VERIFIED' and date_trunc('month', p.paid_at at time zone ${TZ}) = m) as revenue,
        (select coalesce(sum(amount), 0) from platform_expenses e where e.status = 'APPROVED' and date_trunc('month', e.spent_at) = m) as expenses
      from months order by m`),
    rows<{ amcos_id: string; name: string; code: string; balance: string; oldest: string }>(sql`select f.amcos_id, a.name, a.code,
      sum(f.amount - f.paid) as balance, min(f.due_date) as oldest from platform_fees f join amcos a on a.id = f.amcos_id
      where f.status in ('UNPAID', 'PARTIAL') group by f.amcos_id, a.name, a.code order by balance desc limit 5`),
  ]);
  const owner = me.role === 'SUPER_ADMIN';
  res.json({
    month,
    revenue: { mtd: rev.mtd, previousMonth: rev.prev, previousToDate: rev.prev_to_date, target: target?.v ?? null },
    expenses: { mtd: exp.approved, pending: exp.pending, budget: budget.v },
    profitMtd: (n(rev.mtd) - n(exp.approved)).toFixed(2),
    queue: {
      payments: { n: queue.pay_n, sum: queue.pay_sum, canAct: owner ? queue.pay_n : queue.pay_n - queue.pay_mine },
      expenses: { n: queue.exp_n, sum: queue.exp_sum, canAct: owner ? queue.exp_n : queue.exp_n - queue.exp_mine },
    },
    receivables: { outstanding: recv.outstanding, overdue: recv.overdue, overdueCount: recv.overdue_n, dueSoon: recv.due_soon, debtors: recv.debtors },
    collection: collect.label ? { label: collect.label, due: collect.due, paid: collect.paid, waived: collect.waived,
      rate: n(collect.due) > 0 ? Math.round((n(collect.paid) / n(collect.due)) * 1000) / 10 : null } : null,
    byMethod, series, topDebtors: top,
  });
}));

// ------------------------------ MADENI (RECEIVABLES) ------------------------------
financeDeskRouter.get('/receivables', requirePermission('finance.read'), ah(async (req, res) => {
  const q = z.object({ bucket: z.enum(['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS', 'OVERDUE']).optional(), q: z.string().trim().max(60).optional() }).parse(req.query);
  const t = today();
  const list = await rows<Record<string, unknown>>(sql`
    select f.id, f.amcos_id, a.name as amcos_name, a.code as amcos_code, a.status as amcos_status, f.kind, f.label, f.amount, f.paid,
      (f.amount - f.paid) as balance, f.due_date, f.status, greatest(${t}::date - f.due_date, 0) as days_overdue, ${bucketOf(t)} as bucket,
      (select max(d.created_at) from announcement_deliveries d join announcements an on an.id = d.announcement_id
        where d.amcos_id = f.amcos_id and an.title = ${REMINDER_TITLE}) as last_reminder_at,
      (select u.full_name from users u where u.amcos_id = f.amcos_id and u.is_active and u.role = 'ACCOUNTANT' limit 1) as accountant,
      (select u.full_name from users u where u.amcos_id = f.amcos_id and u.is_active and u.role = 'AMCOS_ADMIN' limit 1) as manager,
      coalesce(a.phone, (select u.phone from users u where u.amcos_id = f.amcos_id and u.is_active and u.role = 'AMCOS_ADMIN' limit 1)) as phone
    from platform_fees f join amcos a on a.id = f.amcos_id
    where f.status in ('UNPAID', 'PARTIAL')
      ${q.bucket === 'OVERDUE' ? sql`and f.due_date < ${t}::date` : q.bucket ? sql`and ${bucketOf(t)} = ${q.bucket}` : sql``}
      ${q.q ? sql`and (a.name ilike ${'%' + q.q + '%'} or a.code ilike ${'%' + q.q + '%'})` : sql``}
    order by f.due_date asc, balance desc limit 500`);
  const buckets = await rows<{ bucket: string; total: string; n: number }>(sql`
    select ${bucketOf(t)} as bucket, coalesce(sum(f.amount - f.paid), 0) as total, count(*)::int as n
    from platform_fees f where f.status in ('UNPAID', 'PARTIAL') group by 1`);
  // Ukusanyaji kwa kila ada (msimu / kingilio): kilichotozwa, kilicholipwa, kilichosamehewa
  const collection = await rows<Record<string, unknown>>(sql`
    select label, kind, max(due_date) as due_date, count(*)::int as fees,
      coalesce(sum(amount) filter (where status <> 'WAIVED'), 0) as billed, coalesce(sum(paid) filter (where status <> 'WAIVED'), 0) as collected,
      coalesce(sum(amount) filter (where status = 'WAIVED'), 0) as waived, count(*) filter (where status = 'PAID')::int as paid_n,
      count(*) filter (where status in ('UNPAID', 'PARTIAL'))::int as open_n
    from platform_fees group by label, kind order by max(due_date) desc limit 8`);
  // Subscriptions za zamani zilizopita muda (kama bado zinatumika)
  const subs = await one<{ total: string; n: number }>(sql`select coalesce(sum(price), 0) as total, count(*)::int as n from subscriptions
    where status in ('PAST_DUE', 'EXPIRED') and cycle <> 'TRIAL'`);
  res.json({ data: list, buckets, collection, overdueSubscriptions: subs });
}));

financeDeskRouter.post('/receivables/remind', requirePermission('finance.manage'), ah(async (req, res) => {
  const b = z.object({
    feeIds: z.array(z.string().uuid()).min(1, 'Chagua angalau deni moja').max(300),
    channels: z.array(z.enum(['IN_APP', 'SMS'])).min(1).default(['IN_APP', 'SMS']),
  }).parse(req.body);
  const fees = await db.select({ f: schema.platformFees, name: schema.amcos.name }).from(schema.platformFees)
    .innerJoin(schema.amcos, eq(schema.amcos.id, schema.platformFees.amcosId))
    .where(and(inArray(schema.platformFees.id, b.feeIds), inArray(schema.platformFees.status, ['UNPAID', 'PARTIAL'])));
  if (!fees.length) throw badRequest('Madeni uliyochagua yameshalipwa au hayapo');
  // Chama kimoja hakikumbushwi zaidi ya mara moja ndani ya saa 24 (kuepuka usumbufu na gharama za SMS)
  const recent = new Set((await rows<{ amcos_id: string }>(sql`select distinct d.amcos_id from announcement_deliveries d
    join announcements an on an.id = d.announcement_id where an.title = ${REMINDER_TITLE} and d.created_at > now() - interval '24 hours'
    and d.amcos_id in (${sql.join(fees.map((x) => sql`${x.f.amcosId}`), sql`, `)})`)).map((r) => r.amcos_id));
  const byAmcos = new Map<string, typeof fees>();
  for (const x of fees) if (!recent.has(x.f.amcosId)) byAmcos.set(x.f.amcosId, [...(byAmcos.get(x.f.amcosId) ?? []), x]);
  const skipped = [...new Set(fees.filter((x) => recent.has(x.f.amcosId)).map((x) => x.name))];
  if (!byAmcos.size) return res.json({ targets: 0, skipped, deliveries: {} });
  const targets = await resolveTargets('SELECTED', [...byAmcos.keys()]);
  const t = today();
  const msg = (id: string, name: string) => {
    const list = byAmcos.get(id)!;
    const total = list.reduce((s, x) => s + n(x.f.amount) - n(x.f.paid), 0);
    const due = list.map((x) => x.f.dueDate).sort()[0];
    const tsh = `TSh ${Math.round(total).toLocaleString('en-US')}`;
    return due < t
      ? `CoopLink: ${name}, ${list.map((x) => x.f.label).join(' na ')} (${tsh}) ilipaswa kulipwa ${due}. Lipa sasa kupitia mfumo: menyu "Ada ya CoopLink" ili huduma iendelee bila kukatizwa.`
      : `CoopLink: ${name}, ukumbusho wa ${list.map((x) => x.f.label).join(' na ')} (${tsh}), mwisho ${due}. Lipa kupitia mfumo: menyu "Ada ya CoopLink". Asante.`;
  };
  const [a] = await db.insert(schema.announcements).values({
    kind: 'EXPIRY_REMINDER', title: REMINDER_TITLE, body: 'Ukumbusho wa ada ya CoopLink inayodaiwa.', audience: 'SELECTED',
    amcosIds: targets.map((x) => x.id), channels: b.channels, createdById: req.auth!.userId,
  }).returning();
  await audit(db, req, { action: 'FEE_REMINDERS_SEND', entity: 'Announcement', entityId: a.id, after: { targets: targets.length, fees: fees.length, skipped } });
  const deliveries = await deliver(a.id, targets, b.channels, (x) => msg(x.id, x.name), REMINDER_TITLE);
  res.status(201).json({ targets: targets.length, skipped, deliveries });
}));

// ------------------------------ BAJETI ------------------------------
async function budgetView(month: string) {
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const B = await rows<{ category: string; amount: string; period: string }>(sql`select category, amount, period from platform_budgets where period in (${month}, ${prev})`);
  const A = await rows<{ category: string; approved: string; pending: string }>(sql`select category,
    coalesce(sum(amount) filter (where status = 'APPROVED'), 0) as approved, coalesce(sum(amount) filter (where status = 'PENDING'), 0) as pending
    from platform_expenses where to_char(spent_at, 'YYYY-MM') = ${month} group by category`);
  const items = CATS.map((c) => {
    const budget = B.find((x) => x.category === c && x.period === month)?.amount ?? null;
    const a = A.find((x) => x.category === c);
    const actual = n(a?.approved);
    return {
      category: c, budget, previous: B.find((x) => x.category === c && x.period === prev)?.amount ?? null,
      actual: actual.toFixed(2), pending: n(a?.pending).toFixed(2),
      used: budget && n(budget) > 0 ? Math.round((actual / n(budget)) * 1000) / 10 : null,
    };
  });
  const sum = (k: 'budget' | 'actual' | 'pending') => items.reduce((s, i) => s + n(i[k]), 0).toFixed(2);
  return { month, previousMonth: prev, items, totals: { budget: sum('budget'), actual: sum('actual'), pending: sum('pending') } };
}

financeDeskRouter.get('/budgets', requirePermission('finance.read'), ah(async (req, res) => {
  const { month } = z.object({ month: monthStr.default(today().slice(0, 7)) }).parse(req.query);
  res.json(await budgetView(month));
}));

financeDeskRouter.put('/budgets', requirePermission('finance.manage'), ah(async (req, res) => {
  const b = z.object({
    month: monthStr,
    items: z.array(z.object({ category: z.enum(CATS), amount: decimalSchema({ min: 0 }) })).min(1).max(CATS.length)
      .refine((l) => new Set(l.map((x) => x.category)).size === l.length, 'Aina moja imerudiwa'),
  }).parse(req.body);
  const before = await budgetView(b.month);
  await db.transaction(async (tx) => {
    for (const it of b.items) {
      await tx.insert(schema.platformBudgets).values({ period: b.month, category: it.category, amount: it.amount, updatedById: req.auth!.userId })
        .onConflictDoUpdate({ target: [schema.platformBudgets.period, schema.platformBudgets.category], set: { amount: it.amount, updatedById: req.auth!.userId, updatedAt: new Date() } });
    }
    await audit(tx, req, { action: 'PLATFORM_BUDGET_SET', entity: 'PlatformBudget', after: b,
      before: { month: b.month, items: before.items.filter((i) => i.budget !== null).map((i) => ({ category: i.category, amount: i.budget })) } });
  });
  res.json(await budgetView(b.month));
}));

// ------------------------------ TAARIFA YA MTEJA (STATEMENT) ------------------------------
async function statement(amcosId: string) {
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { id: true, name: true, code: true, region: true, district: true, status: true, createdAt: true } });
  if (!a) throw notFound('Chama');
  const fees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.amcosId, amcosId)).orderBy(schema.platformFees.dueDate);
  const pays = await db.select().from(schema.platformPayments).where(eq(schema.platformPayments.amcosId, amcosId)).orderBy(desc(schema.platformPayments.paidAt));
  const billed = fees.filter((f) => f.status !== 'WAIVED').reduce((s, f) => s + n(f.amount), 0);
  const waived = fees.filter((f) => f.status === 'WAIVED').reduce((s, f) => s + n(f.amount), 0);
  const balance = fees.filter((f) => f.status === 'UNPAID' || f.status === 'PARTIAL').reduce((s, f) => s + n(f.amount) - n(f.paid), 0);
  const paid = pays.filter((p) => p.status === 'VERIFIED').reduce((s, p) => s + n(p.amount), 0);
  const refunded = pays.filter((p) => p.status === 'REFUNDED').reduce((s, p) => s + n(p.amount), 0);
  return {
    amcos: a, fees, payments: pays.map(({ notes: _n, ...p }) => p),
    totals: { billed: billed.toFixed(2), waived: waived.toFixed(2), paid: paid.toFixed(2), refunded: refunded.toFixed(2), balance: balance.toFixed(2) },
    generatedAt: new Date().toISOString(),
  };
}

financeDeskRouter.get('/statement/:id', requirePermission('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  res.json(await statement(id));
}));

financeDeskRouter.get('/statement/:id/csv', requirePermission('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const s = await statement(id);
  const out: (string | number | null)[][] = [
    ['COOPLINK - TAARIFA YA MTEJA', s.amcos.name, s.amcos.code, `Tarehe: ${today()}`], [],
    ['MUHTASARI'], ['Ada zilizotozwa', s.totals.billed], ['Zilizosamehewa', s.totals.waived], ['Malipo yaliyothibitishwa', s.totals.paid],
    ['Marejesho', s.totals.refunded], ['Salio linalodaiwa', s.totals.balance], [],
    ['ADA'], ['Ada', 'Aina', 'Tarehe ya mwisho', 'Kiasi', 'Kilicholipwa', 'Hali'],
    ...s.fees.map((f) => [f.label, f.kind, f.dueDate, f.amount, f.paid, f.status]), [],
    ['MALIPO'], ['Risiti/Ankara', 'Tarehe', 'Aina', 'Njia', 'Kumbukumbu', 'Kiasi', 'Hali'],
    ...s.payments.map((p) => [p.invoiceNo, p.paidAt.toISOString().slice(0, 10), p.category, p.method, p.providerRef, p.amount, p.status]),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="taarifa-${s.amcos.code}-${today()}.csv"`);
  res.send(toCsv(out));
}));

