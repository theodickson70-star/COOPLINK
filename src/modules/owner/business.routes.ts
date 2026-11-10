// DUKALANGU SOLUTION BUSINESS CENTER — wasifu wa biashara, malengo na uchambuzi wa ukuaji
import { Router } from 'express';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, decimalSchema, uuidParam } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { getSetting, setSetting } from '../../lib/settings';

export const businessRouter = Router();
const T = schema.businessTargets;
const METRICS = ['REVENUE', 'NEW_AMCOS', 'ACTIVE_SUBSCRIPTIONS'] as const;

businessRouter.get('/profile', requirePermission('business.read'), ah(async (_req, res) => {
  res.json({ profile: await getSetting('business.profile', { fresh: true }) });
}));

businessRouter.put('/profile', requirePermission('business.manage'), ah(async (req, res) => {
  const s = z.string().trim().max(200);
  const b = z.object({
    companyName: s.min(2), productName: s.min(2), slogan: s, ownerName: s, phone: s, email: s, address: s, tin: s, website: s, poweredBy: s.default('DUKALANGU SOLUTION'),
  }).parse(req.body);
  const before = await getSetting('business.profile', { fresh: true });
  await db.transaction(async (tx) => {
    await setSetting(tx, 'business.profile', b, req.auth!.userId);
    await audit(tx, req, { action: 'BUSINESS_PROFILE_UPDATE', entity: 'PlatformSetting', entityId: 'business.profile', before, after: b });
  });
  res.json({ profile: b });
}));

/** Thamani halisi ya lengo kwa kipindi (YYYY au YYYY-MM). */
async function actualFor(metric: string, period: string) {
  const unit = period.length === 4 ? 'year' : 'month';
  const start = period.length === 4 ? `${period}-01-01` : `${period}-01`;
  const inPeriod = (col: string) => sql.raw(`date_trunc('${unit}', ${col} at time zone 'Africa/Dar_es_Salaam') = date_trunc('${unit}', '${start}'::date)`);
  if (metric === 'REVENUE') {
    const r = await db.execute<{ v: string }>(sql`select coalesce(sum(amount),0) as v from platform_payments where status = 'VERIFIED' and ${inPeriod('paid_at')}`);
    return Number(r.rows[0].v);
  }
  if (metric === 'NEW_AMCOS') {
    const r = await db.execute<{ v: number }>(sql`select count(*)::int as v from amcos where ${inPeriod('created_at')}`);
    return Number(r.rows[0].v);
  }
  const r = await db.execute<{ v: number }>(sql`select count(*)::int as v from subscriptions where status in ('ACTIVE','PAST_DUE') and cycle <> 'TRIAL'`);
  return Number(r.rows[0].v);
}

businessRouter.get('/targets', requirePermission('business.read'), ah(async (_req, res) => {
  const rows = await db.select().from(T).orderBy(sql`${T.period} desc`, T.metric);
  const data = [];
  for (const t of rows) {
    const actual = await actualFor(t.metric, t.period);
    data.push({ ...t, actual, progress: Number(t.targetValue) > 0 ? Math.round((actual / Number(t.targetValue)) * 1000) / 10 : null });
  }
  res.json({ data });
}));

businessRouter.post('/targets', requirePermission('business.manage'), ah(async (req, res) => {
  const b = z.object({
    period: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, 'Kipindi kiwe YYYY au YYYY-MM'),
    metric: z.enum(METRICS), targetValue: decimalSchema({ min: 0 }), notes: z.string().trim().nullable().optional(),
  }).parse(req.body);
  const row = await db.transaction(async (tx) => {
    const [t] = await tx.insert(T).values({ ...b, createdById: req.auth!.userId })
      .onConflictDoUpdate({ target: [T.period, T.metric], set: { targetValue: b.targetValue, notes: b.notes ?? null, updatedAt: new Date() } }).returning();
    await audit(tx, req, { action: 'BUSINESS_TARGET_SET', entity: 'BusinessTarget', entityId: t.id, after: t });
    return t;
  });
  res.status(201).json({ target: row });
}));

businessRouter.delete('/targets/:id', requirePermission('business.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const t = await db.query.businessTargets.findFirst({ where: eq(T.id, id) });
  if (!t) throw notFound('Lengo');
  await db.transaction(async (tx) => {
    await tx.delete(T).where(eq(T.id, id));
    await audit(tx, req, { action: 'BUSINESS_TARGET_DELETE', entity: 'BusinessTarget', entityId: id, before: t });
  });
  res.json({ ok: true });
}));

businessRouter.get('/analytics', requirePermission('business.read'), ah(async (req, res) => {
  const finance = req.auth!.permissions.includes('finance.read');
  const series = (await db.execute(sql`
    with months as (select generate_series(date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') - interval '11 months',
      date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam'), interval '1 month') as m)
    select to_char(m, 'YYYY-MM') as month,
      (select count(*) from amcos a where date_trunc('month', a.created_at at time zone 'Africa/Dar_es_Salaam') = m)::int as registered,
      (select count(*) from amcos a where date_trunc('month', a.approved_at at time zone 'Africa/Dar_es_Salaam') = m)::int as approved,
      (select count(*) from subscriptions s where s.cycle = 'TRIAL' and date_trunc('month', s.created_at at time zone 'Africa/Dar_es_Salaam') = m)::int as trials,
      (select count(*) from (select amcos_id, min(paid_at) as first_paid from platform_payments where status = 'VERIFIED' and category = 'SUBSCRIPTION' and amcos_id is not null group by amcos_id) f
        where date_trunc('month', f.first_paid at time zone 'Africa/Dar_es_Salaam') = m)::int as converted,
      ${finance ? sql`(select coalesce(sum(amount),0) from platform_payments p where p.status = 'VERIFIED' and date_trunc('month', p.paid_at at time zone 'Africa/Dar_es_Salaam') = m)` : sql`null`} as revenue,
      ${finance ? sql`(select coalesce(sum(amount),0) from platform_expenses e where date_trunc('month', e.spent_at) = m)` : sql`null`} as expenses
    from months order by m`)).rows as Record<string, string | number | null>[];
  const [totals] = (await db.execute(sql`
    select (select count(*) from amcos where status = 'ACTIVE')::int as active_amcos,
      (select count(distinct amcos_id) from platform_payments where status = 'VERIFIED' and category = 'SUBSCRIPTION')::int as paying_amcos,
      (select count(distinct amcos_id) from subscriptions where cycle = 'TRIAL')::int as ever_trial,
      (select count(*) from amcos where status = 'SUSPENDED' and status_reason = 'SUBSCRIPTION_EXPIRED')::int as churned,
      ${finance ? sql`(select coalesce(sum(amount),0) from platform_payments where status = 'VERIFIED' and paid_at > now() - interval '12 months')` : sql`null`} as revenue_12m`)).rows as Record<string, number | string | null>[];
  const paying = Number(totals.paying_amcos);
  const everTrial = Number(totals.ever_trial);
  res.json({
    series,
    totals: {
      ...totals,
      conversionRate: everTrial ? Math.round((paying / everTrial) * 1000) / 10 : null,
      arpu12m: finance && paying ? (Number(totals.revenue_12m) / paying).toFixed(2) : null,
    },
  });
}));
