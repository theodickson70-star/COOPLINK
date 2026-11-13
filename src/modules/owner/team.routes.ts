// =====================================================================
//  TIMU YA COOPLINK (v0.38)
//   GET /owner/notifications       kengele ya kazi: kila mfanyakazi anaona kazi zinazomsubiri (kulingana na ruhusa zake)
//   GET /owner/team/performance    utendaji wa kila mfanyakazi (Owner pekee)
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah } from '../../lib/http';
import { forbidden } from '../../lib/errors';
import { PLATFORM_ROLES, effectivePermissions } from '../../lib/permissions';
import { staff2fa } from '../../lib/staff-2fa';
import { rangeQuery } from './common';

export const notificationsRouter = Router();
export const performanceRouter = Router();
type Item = { key: string; title: string; detail: string; count: number; to: string; tone: 'bad' | 'warn' | 'info' };
const one = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as T;

notificationsRouter.get('/', ah(async (req, res) => {
  const me = req.auth!;
  const has = (p: string) => me.permissions.includes(p as never);
  const owner = me.role === 'SUPER_ADMIN';
  const items: Item[] = [];
  const add = (i: Item) => { if (i.count > 0) items.push(i); };

  const u = await db.query.users.findFirst({ where: eq(schema.users.id, me.userId), columns: { role: true, totpEnabled: true, createdAt: true } });
  if (u) {
    const t = await staff2fa(u);
    if (t.required) {
      const days = Math.max(0, Math.ceil((new Date(t.deadline!).getTime() - Date.now()) / 864e5));
      items.push({ key: '2fa', title: 'Washa 2FA', detail: t.overdue ? 'Muda umeisha — huwezi kuendelea mpaka uiwashe' : `Zimebaki siku ${days}`, count: 1, to: '/owner/settings', tone: t.overdue ? 'bad' : 'warn' });
    }
  }
  if (owner) {
    const r = await one<{ open: number; urgent: number }>(sql`select count(*) filter (where status in ('OPEN','IN_PROGRESS'))::int as open,
      count(*) filter (where status in ('OPEN','IN_PROGRESS') and priority = 'URGENT')::int as urgent from internal_requests`);
    add({ key: 'requests', title: 'Maombi ya timu', detail: r.urgent ? `${r.urgent} ya dharura` : 'Yanasubiri uamuzi wako', count: r.open, to: '/owner/requests', tone: r.urgent ? 'bad' : 'warn' });
  } else {
    const r = await one<{ n: number }>(sql`select count(*)::int as n from internal_requests r where r.created_by_id = ${me.userId}
      and (exists (select 1 from internal_request_messages m where m.request_id = r.id and m.author_id <> r.created_by_id and m.created_at > coalesce(r.creator_seen_at, 'epoch'::timestamptz))
        or (r.resolved_at is not null and r.resolved_at > coalesce(r.creator_seen_at, 'epoch'::timestamptz)))`);
    add({ key: 'requests', title: 'Majibu ya Owner', detail: 'Maombi yako yana majibu mapya', count: r.n, to: '/owner/requests', tone: 'info' });
  }
  if (has('support.read')) {
    const s = await one<{ overdue: number; unassigned: number; mine: number }>(sql`select
      count(*) filter (where first_response_at is null and status <> 'CLOSED' and due_at < now())::int as overdue,
      count(*) filter (where status <> 'CLOSED' and assigned_to_id is null)::int as unassigned,
      count(*) filter (where status <> 'CLOSED' and assigned_to_id = ${me.userId} and (last_platform_at is null or last_amcos_at > last_platform_at))::int as mine
      from support_tickets`);
    add({ key: 'tickets-overdue', title: 'Tiketi zilizochelewa', detail: 'Jibu la kwanza limepita muda', count: s.overdue, to: '/owner/support', tone: 'bad' });
    add({ key: 'tickets-mine', title: 'Tiketi zangu zinasubiri jibu', detail: 'Chama kimeandika', count: s.mine, to: '/owner/support', tone: 'warn' });
    add({ key: 'tickets-unassigned', title: 'Tiketi bila mhusika', detail: 'Chukua au gawa', count: s.unassigned, to: '/owner/support', tone: 'info' });
  }
  if (has('leads.read')) {
    const l = await one<{ due: number; fresh: number }>(sql`select
      count(*) filter (where stage in ('NEW','CONTACTED','DEMO_SCHEDULED','DEMO_DONE','NEGOTIATION') and assigned_to_id = ${me.userId}
        and next_follow_up_at < (date_trunc('day', now() at time zone 'Africa/Dar_es_Salaam') + interval '1 day') at time zone 'Africa/Dar_es_Salaam')::int as due,
      count(*) filter (where stage = 'NEW' and assigned_to_id is null)::int as fresh from demo_requests`);
    add({ key: 'leads-due', title: 'Leads za kufuatilia leo', detail: 'Piga simu au panga demo', count: l.due, to: '/owner/leads?due=1', tone: 'warn' });
    add({ key: 'leads-new', title: 'Leads mpya bila mhusika', detail: 'Kutoka tovuti', count: l.fresh, to: '/owner/leads?assigned=none', tone: 'info' });
  }
  if (has('finance.manage')) {
    const f = await one<{ pay: number; old: number; exp: number }>(sql`select
      (select count(*)::int from platform_payments where status = 'PENDING' and (${owner} or created_by_id is distinct from ${me.userId})) as pay,
      (select count(*)::int from platform_payments where status = 'PENDING' and created_at < now() - interval '24 hours' and (${owner} or created_by_id is distinct from ${me.userId})) as old,
      (select count(*)::int from platform_expenses where status = 'PENDING' and (${owner} or created_by_id is distinct from ${me.userId})) as exp`);
    add({ key: 'payments', title: 'Malipo ya kuthibitisha', detail: f.old ? `${f.old} yamesubiri zaidi ya saa 24` : 'Thibitisha pesa imeingia', count: f.pay, to: '/owner/finance?tab=payments&status=PENDING', tone: f.old ? 'bad' : 'warn' });
    add({ key: 'expenses', title: 'Matumizi ya kuidhinisha', detail: 'Yaliyorekodiwa na mwenzako', count: f.exp, to: '/owner/finance?tab=expenses&status=PENDING', tone: 'warn' });
  }
  res.json({ total: items.reduce((s, i) => s + i.count, 0), items });
}));

// ------------------------------ UTENDAJI WA TIMU (Owner) ------------------------------
performanceRouter.get('/performance', ah(async (req, res) => {
  if (req.auth!.role !== 'SUPER_ADMIN') throw forbidden('Ripoti ya utendaji ni ya Owner pekee');
  const r = rangeQuery.parse(req.query);
  const { includeInactive } = z.object({ includeInactive: z.enum(['1']).optional() }).parse(req.query);
  const staff = await db.select({ id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role, permissions: schema.users.permissions, jobTitle: schema.users.jobTitle,
    isActive: schema.users.isActive, lastLoginAt: schema.users.lastLoginAt, totpEnabled: schema.users.totpEnabled })
    .from(schema.users).where(and(inArray(schema.users.role, PLATFORM_ROLES.filter((x) => x !== 'SUPER_ADMIN')), includeInactive ? undefined : eq(schema.users.isActive, true)));
  const ids = staff.map((s) => s.id);
  if (!ids.length) return res.json({ range: { from: r.from, to: r.to }, data: [] });
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const rows = (await db.execute<Record<string, unknown>>(sql`
    select u.id,
      (select count(*)::int from support_tickets t where t.closed_by_id = u.id and t.closed_at >= ${r.fromTs} and t.closed_at < ${r.toTs}) as tickets_closed,
      (select count(*)::int from support_messages m where m.author_id = u.id and m.side = 'PLATFORM' and not m.internal and m.created_at >= ${r.fromTs} and m.created_at < ${r.toTs}) as replies,
      (select round(avg(extract(epoch from (t.first_response_at - t.created_at)) / 3600)::numeric, 1) from support_tickets t
        where t.assigned_to_id = u.id and t.first_response_at >= ${r.fromTs} and t.first_response_at < ${r.toTs}) as first_response_h,
      (select count(*)::int from support_tickets t where t.assigned_to_id = u.id and t.first_response_at is null and t.status <> 'CLOSED' and t.due_at < now()) as overdue_now,
      (select count(*) filter (where t.rating = 1)::int from support_tickets t where t.assigned_to_id = u.id and t.rated_at >= ${r.fromTs} and t.rated_at < ${r.toTs}) as csat_up,
      (select count(*) filter (where t.rating = -1)::int from support_tickets t where t.assigned_to_id = u.id and t.rated_at >= ${r.fromTs} and t.rated_at < ${r.toTs}) as csat_down,
      (select count(*)::int from demo_requests l where l.created_by_id = u.id and l.created_at >= ${r.fromTs} and l.created_at < ${r.toTs}) as leads_added,
      (select count(*)::int from lead_activities a where a.created_by_id = u.id and a.kind in ('CALL','MEETING','SMS') and a.created_at >= ${r.fromTs} and a.created_at < ${r.toTs}) as lead_contacts,
      (select count(*)::int from demo_requests l where l.assigned_to_id = u.id and l.stage = 'WON' and l.won_at >= ${r.fromTs} and l.won_at < ${r.toTs}) as leads_won,
      (select count(*)::int from platform_payments p where p.created_by_id = u.id and p.created_at >= ${r.fromTs} and p.created_at < ${r.toTs}) as payments_recorded,
      (select coalesce(sum(p.amount), 0) from platform_payments p where p.verified_by_id = u.id and p.verified_at >= ${r.fromTs} and p.verified_at < ${r.toTs}) as verified_amount,
      (select count(*)::int from platform_payments p where p.verified_by_id = u.id and p.verified_at >= ${r.fromTs} and p.verified_at < ${r.toTs}) as payments_verified,
      (select count(*)::int from platform_expenses e where e.created_by_id = u.id and e.created_at >= ${r.fromTs} and e.created_at < ${r.toTs}) as expenses_recorded,
      (select count(*)::int from internal_requests q where q.created_by_id = u.id and q.created_at >= ${r.fromTs} and q.created_at < ${r.toTs}) as requests,
      (select count(distinct date_trunc('day', l.created_at))::int from login_events l where l.user_id = u.id and l.success and l.created_at >= ${r.fromTs} and l.created_at < ${r.toTs}) as active_days
    from users u where u.id in (${list})`)).rows;
  res.json({
    range: { from: r.from, to: r.to },
    data: staff.map((s) => {
      const m = rows.find((x) => x.id === s.id) ?? {};
      const up = Number(m.csat_up ?? 0), down = Number(m.csat_down ?? 0);
      return { ...s, permissions: effectivePermissions(s.role, s.permissions), ...m, csat: up + down ? Math.round((up / (up + down)) * 100) : null };
    }),
  });
}));
