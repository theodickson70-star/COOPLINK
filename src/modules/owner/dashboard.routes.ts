// OWNER DASHBOARD — takwimu zote zinatoka kwenye database (hakuna namba za kubuni)
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { ah } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import { getSetting } from '../../lib/settings';
import { addDays, today } from '../../lib/subscriptions';
import { rangeQuery } from './common';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  requirePermission('platform.dashboard'),
  ah(async (req, res) => {
    const r = rangeQuery.parse(req.query);
    const cfg = await getSetting('config');
    const t = today();
    const soon = addDays(t, cfg.expiringWindowDays);
    const canFinance = req.auth!.permissions.includes('finance.read');
    const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;

    const amcos = await one<Record<string, number>>(sql`
      select count(*)::int as total,
        count(*) filter (where status = 'ACTIVE')::int as active,
        count(*) filter (where status = 'SUSPENDED')::int as suspended,
        count(*) filter (where status = 'PENDING')::int as pending,
        count(*) filter (where status = 'REJECTED')::int as rejected,
        count(*) filter (where created_at >= ${r.fromTs} and created_at < ${r.toTs})::int as new_in_range
      from amcos`);

    const users = await one<Record<string, number>>(sql`
      select count(*) filter (where role not in ('SUPER_ADMIN','FINANCE_MANAGER','TECH_SUPPORT','CUSTOMER_SUPPORT','MARKETING_MANAGER'))::int as total,
        count(*) filter (where is_active and role not in ('SUPER_ADMIN','FINANCE_MANAGER','TECH_SUPPORT','CUSTOMER_SUPPORT','MARKETING_MANAGER'))::int as active,
        count(*) filter (where role in ('FINANCE_MANAGER','TECH_SUPPORT','CUSTOMER_SUPPORT','MARKETING_MANAGER'))::int as staff,
        count(*) filter (where last_login_at >= ${r.fromTs} and last_login_at < ${r.toTs})::int as logged_in_range
      from users`);

    const subs = await one<Record<string, number>>(sql`
      select count(*) filter (where status = 'ACTIVE')::int as active,
        count(*) filter (where status = 'TRIAL')::int as trial,
        count(*) filter (where status = 'PAST_DUE')::int as past_due,
        count(*) filter (where status = 'EXPIRED')::int as expired,
        count(*) filter (where status in ('TRIAL','ACTIVE') and end_date between ${t} and ${soon})::int as expiring
      from subscriptions where status <> 'CANCELLED'`);

    let revenue = null;
    if (canFinance) {
      revenue = await one<Record<string, string>>(sql`
        select coalesce(sum(amount) filter (where paid_at >= ${r.fromTs} and paid_at < ${r.toTs}), 0) as in_range,
          coalesce(sum(amount) filter (where date_trunc('month', paid_at at time zone 'Africa/Dar_es_Salaam') = date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam')), 0) as this_month,
          coalesce(sum(amount) filter (where date_trunc('year', paid_at at time zone 'Africa/Dar_es_Salaam') = date_trunc('year', now() at time zone 'Africa/Dar_es_Salaam')), 0) as this_year,
          coalesce(sum(amount), 0) as all_time,
          count(*)::int as payments
        from platform_payments where status = 'VERIFIED'`);
    }

    const series = (await db.execute(sql`
      with months as (
        select generate_series(date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') - interval '11 months',
                               date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam'), interval '1 month') as m)
      select to_char(m, 'YYYY-MM') as month,
        (select count(*) from amcos a where date_trunc('month', a.created_at at time zone 'Africa/Dar_es_Salaam') = m)::int as new_amcos,
        (select count(*) from subscriptions s where s.cycle <> 'TRIAL' and date_trunc('month', s.created_at at time zone 'Africa/Dar_es_Salaam') = m)::int as new_paid_subs,
        (select count(*) from subscriptions s where s.cycle = 'TRIAL' and date_trunc('month', s.created_at at time zone 'Africa/Dar_es_Salaam') = m)::int as new_trials,
        ${canFinance ? sql`(select coalesce(sum(amount),0) from platform_payments p where p.status = 'VERIFIED' and date_trunc('month', p.paid_at at time zone 'Africa/Dar_es_Salaam') = m)` : sql`null`} as revenue
      from months order by m`)).rows;

    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const dbMs = Date.now() - t0;
    const health = await one<Record<string, unknown>>(sql`
      select (select count(*) from system_errors where created_at > now() - interval '24 hours')::int as errors_24h,
        (select status from job_runs order by started_at desc limit 1) as last_job_status,
        (select started_at from job_runs order by started_at desc limit 1) as last_job_at`);
    const maintenance = await getSetting('maintenance');

    res.json({
      range: { from: r.from, to: r.to },
      amcos, users, subscriptions: { ...subs, expiringWindowDays: cfg.expiringWindowDays },
      revenue, series,
      health: { db: 'ok', dbMs, ...health, maintenance: maintenance.enabled },
    });
  }),
);
