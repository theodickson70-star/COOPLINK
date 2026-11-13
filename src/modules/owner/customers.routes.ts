// =====================================================================
//  WATEJA (v0.36) — Huduma kwa Wateja na Masoko
//   GET  /owner/customers/health                   vyama hatarini, vinavyoanza (onboarding), idadi kwa kila kundi (segment)
//   GET  /owner/customers/segments                 makundi ya kulenga matangazo + idadi
//   GET  /owner/customers/:id/profile              historia ya mteja (tiketi, mawasiliano, lead, afya) — kila sehemu kwa ruhusa yake
//   GET/POST /owner/customers/:id/notes            maelezo ya ndani ya timu (hayafutwi); PATCH .../notes/:noteId/pin
//   Msaada wa akaunti (amcos.help) — bila kuona, kuweka wala kubadilisha nenosiri:
//   GET  /owner/customers/:id/staff/:userId/diagnostics   historia ya kuingia, vifaa, sessions
//   POST /owner/customers/:id/staff/:userId/signout       kutoka kwenye vifaa vyote (simu imepotea / mtu mwingine ameingia)
//   POST /owner/customers/:id/staff/:userId/reset-guide   SMS ya maelekezo ya "Umesahau nenosiri" (mtumishi anabadilisha mwenyewe kwa OTP)
//  Wafanyakazi wa CoopLink HAWAONI data za ndani za chama (wakulima, fedha, stoo) — idadi tu.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, uuidParam } from '../../lib/http';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { activeSessionsWhere, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { sendSms } from '../../lib/notify';
import { today } from '../../lib/subscriptions';
import { getSetting } from '../../lib/settings';

export const customersRouter = Router();
const U = schema.users;
const AMCOS_STAFF = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'] as const;
const ROLE_SW: Record<string, string> = { AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Storekeeper', AMCOS_VIEWER: 'Mtazamaji' };

// ------------------------------ MAKUNDI (SEGMENTS) ------------------------------
export const SEGMENTS = {
  ACTIVE: { label: 'Vyama vyote vilivyo hai', desc: 'Vyama vinavyotumia mfumo sasa' },
  FEES_OVERDUE: { label: 'Ada imepita muda', desc: 'Vina ada ya CoopLink ambayo haijalipwa baada ya tarehe ya mwisho' },
  FEES_DUE_SOON: { label: 'Ada inakaribia (siku 14)', desc: 'Ada inaisha ndani ya siku 14 na bado haijalipwa' },
  DORMANT: { label: 'Havitumii mfumo (siku 14)', desc: 'Hakuna mtumishi aliyeingia ndani ya siku 14' },
  NEW_30: { label: 'Wateja wapya (siku 30)', desc: 'Vimejiunga ndani ya siku 30 — wanahitaji kuongozwa' },
  TRAINING: { label: 'Wako kwenye mafunzo', desc: 'Vyama vilivyo kwenye hali ya mafunzo' },
} as const;
export type Segment = keyof typeof SEGMENTS;

export function segmentWhere(s: Segment): SQL {
  const t = today();
  switch (s) {
    case 'ACTIVE': return sql`a.status = 'ACTIVE'`;
    case 'FEES_OVERDUE': return sql`a.status in ('ACTIVE','SUSPENDED') and exists (select 1 from platform_fees f where f.amcos_id = a.id and f.status in ('UNPAID','PARTIAL') and f.due_date < ${t}::date)`;
    case 'FEES_DUE_SOON': return sql`a.status = 'ACTIVE' and exists (select 1 from platform_fees f where f.amcos_id = a.id and f.status in ('UNPAID','PARTIAL') and f.due_date between ${t}::date and ${t}::date + 14)`;
    case 'DORMANT': return sql`a.status = 'ACTIVE' and coalesce((select max(u.last_login_at) from users u where u.amcos_id = a.id), a.created_at) < now() - interval '14 days'`;
    case 'NEW_30': return sql`a.status = 'ACTIVE' and a.created_at > now() - interval '30 days'`;
    case 'TRAINING': return sql`a.status = 'ACTIVE' and a.training`;
  }
}
export async function segmentIds(s: Segment) {
  return (await db.execute<{ id: string }>(sql`select a.id from amcos a where ${segmentWhere(s)}`)).rows.map((r) => r.id);
}

customersRouter.get('/segments', requirePermission('comms.read', 'leads.read'), ah(async (_req, res) => {
  const counts = await Promise.all((Object.keys(SEGMENTS) as Segment[]).map(async (k) => {
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from amcos a where ${segmentWhere(k)}`)).rows;
    return { key: k, ...SEGMENTS[k], count: n };
  }));
  res.json({ data: counts });
}));

// ------------------------------ AFYA YA WATEJA ------------------------------
customersRouter.get('/health', requirePermission('amcos.read'), ah(async (_req, res) => {
  const t = today();
  // Alama ya hatari (0-100): kutotumia mfumo, ada iliyopita muda, tiketi zilizochelewa, kuingia kulikoshindwa
  const atRisk = (await db.execute<Record<string, unknown>>(sql`
    with x as (
      select a.id, a.name, a.code, a.region, a.district, a.created_at,
        (select max(u.last_login_at) from users u where u.amcos_id = a.id) as last_login,
        (select count(*)::int from members m where m.amcos_id = a.id) as members,
        exists (select 1 from platform_fees f where f.amcos_id = a.id and f.status in ('UNPAID','PARTIAL') and f.due_date < ${t}::date) as fee_overdue,
        (select count(*)::int from support_tickets s where s.amcos_id = a.id and s.status <> 'CLOSED') as open_tickets,
        (select count(*)::int from login_events l join users u on u.id = l.user_id where u.amcos_id = a.id and not l.success and l.created_at > now() - interval '7 days') as failed_logins
      from amcos a where a.status = 'ACTIVE'
    )
    select *, extract(day from now() - coalesce(last_login, created_at))::int as idle_days,
      least(100, (case when coalesce(last_login, created_at) < now() - interval '30 days' then 45 when coalesce(last_login, created_at) < now() - interval '14 days' then 30
        when coalesce(last_login, created_at) < now() - interval '7 days' then 15 else 0 end)
        + (case when fee_overdue then 30 else 0 end) + least(open_tickets * 8, 16) + (case when failed_logins >= 5 then 10 else 0 end)
        + (case when members < 10 and created_at < now() - interval '21 days' then 10 else 0 end))::int as risk
    from x order by risk desc, idle_days desc limit 25`)).rows.filter((r) => Number(r.risk) >= 25);
  const onboarding = (await db.execute<Record<string, unknown>>(sql`
    select a.id, a.name, a.code, a.status, a.created_at, a.region,
      (select count(*)::int from users u where u.amcos_id = a.id and u.is_active and u.role in ('AMCOS_ADMIN','ACCOUNTANT','CLERK')) as staff,
      (select count(*)::int from members m where m.amcos_id = a.id) as members,
      (select max(u.last_login_at) from users u where u.amcos_id = a.id) as last_login,
      exists (select 1 from platform_fees f where f.amcos_id = a.id and f.kind = 'ENTRANCE' and f.status in ('PAID','WAIVED')) as entrance_paid
    from amcos a where a.status = 'PENDING' or (a.status = 'ACTIVE' and a.created_at > now() - interval '45 days')
    order by a.created_at desc limit 20`)).rows.map((r) => {
    // Hatua za kuanza: kuidhinishwa -> watumishi 3 -> kingilio -> wakulima wa kwanza (10+) -> kutumia kila wiki
    const steps = [r.status === 'ACTIVE', Number(r.staff) >= 3, !!r.entrance_paid, Number(r.members) >= 10,
      !!r.last_login && new Date(String(r.last_login)).getTime() > Date.now() - 7 * 864e5];
    return { ...r, steps, progress: Math.round((steps.filter(Boolean).length / steps.length) * 100) };
  });
  const [totals] = (await db.execute<Record<string, number>>(sql`select
    count(*) filter (where status = 'ACTIVE')::int as active, count(*) filter (where status = 'PENDING')::int as pending,
    count(*) filter (where status = 'SUSPENDED')::int as suspended,
    count(*) filter (where status = 'ACTIVE' and coalesce((select max(u.last_login_at) from users u where u.amcos_id = amcos.id), created_at) > now() - interval '7 days')::int as weekly_active
    from amcos`)).rows;
  res.json({ atRisk, onboarding, totals });
}));

// ------------------------------ HISTORIA YA MTEJA ------------------------------
async function findAmcos(id: string) {
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, id), columns: { id: true, name: true, code: true, status: true, phone: true, createdAt: true } });
  if (!a) throw notFound('Chama');
  return a;
}

customersRouter.get('/:id/profile', requirePermission('amcos.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const a = await findAmcos(id);
  const perms = req.auth!.permissions;
  const [health] = (await db.execute<Record<string, unknown>>(sql`select
    (select max(u.last_login_at) from users u where u.amcos_id = ${id}) as last_login,
    (select count(*)::int from login_events l join users u on u.id = l.user_id where u.amcos_id = ${id} and not l.success and l.created_at > now() - interval '7 days') as failed_logins_7d,
    (select count(*)::int from login_events l join users u on u.id = l.user_id where u.amcos_id = ${id} and l.success and l.created_at > now() - interval '30 days') as logins_30d,
    (select count(*)::int from sms_logs s where s.amcos_id = ${id} and s.status = 'FAILED' and s.created_at > now() - interval '30 days') as sms_failed_30d,
    (select count(*)::int from members m where m.amcos_id = ${id}) as members`)).rows;
  const tickets = perms.includes('support.read')
    ? await db.select({ id: schema.supportTickets.id, ticketNo: schema.supportTickets.ticketNo, subject: schema.supportTickets.subject, status: schema.supportTickets.status,
      priority: schema.supportTickets.priority, createdAt: schema.supportTickets.createdAt }).from(schema.supportTickets)
      .where(eq(schema.supportTickets.amcosId, id)).orderBy(desc(schema.supportTickets.createdAt)).limit(10)
    : null;
  const comms = perms.includes('comms.read')
    ? (await db.execute<Record<string, unknown>>(sql`select an.id, an.title, an.kind, max(d.created_at) as at,
        count(*) filter (where d.status in ('SENT','DELIVERED'))::int as ok, count(*) filter (where d.status = 'FAILED')::int as failed
        from announcement_deliveries d join announcements an on an.id = d.announcement_id where d.amcos_id = ${id}
        group by an.id, an.title, an.kind order by max(d.created_at) desc limit 10`)).rows
    : null;
  const lead = perms.includes('leads.read')
    ? await db.query.demoRequests.findFirst({ where: eq(schema.demoRequests.amcosId, id), columns: { id: true, name: true, source: true, createdAt: true, wonAt: true } })
    : null;
  res.json({ amcos: a, health, tickets, comms, lead: lead ?? null, can: { help: perms.includes('amcos.help') } });
}));

customersRouter.get('/:id/notes', requirePermission('amcos.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  await findAmcos(id);
  const N = schema.amcosNotes;
  const rows = await db.select({ n: N, by: U.fullName, role: U.role }).from(N).leftJoin(U, eq(U.id, N.createdById))
    .where(eq(N.amcosId, id)).orderBy(desc(N.pinned), desc(N.createdAt)).limit(100);
  res.json({ data: rows.map((r) => ({ ...r.n, by: r.by, role: r.role, mine: r.n.createdById === req.auth!.userId })) });
}));

customersRouter.post('/:id/notes', requirePermission('amcos.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { body } = z.object({ body: z.string().trim().min(3, 'Andika maelezo').max(1000) }).parse(req.body);
  await findAmcos(id);
  const row = await db.transaction(async (tx) => {
    const [n] = await tx.insert(schema.amcosNotes).values({ amcosId: id, body, createdById: req.auth!.userId }).returning();
    await audit(tx, req, { action: 'CUSTOMER_NOTE_ADD', entity: 'AmcosNote', entityId: n.id, amcosId: id });
    return n;
  });
  res.status(201).json({ note: row });
}));

customersRouter.patch('/:id/notes/:noteId/pin', requirePermission('amcos.read'), ah(async (req, res) => {
  const { id, noteId } = z.object({ id: z.string().uuid(), noteId: z.string().uuid() }).parse(req.params);
  const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
  const N = schema.amcosNotes;
  const [n] = await db.select().from(N).where(and(eq(N.id, noteId), eq(N.amcosId, id)));
  if (!n) throw notFound('Maelezo');
  if (n.createdById !== req.auth!.userId && req.auth!.role !== 'SUPER_ADMIN') throw forbidden('Unaweza kubandika maelezo yako tu');
  await db.update(N).set({ pinned }).where(eq(N.id, noteId));
  res.json({ ok: true });
}));

// ------------------------------ MSAADA WA AKAUNTI ------------------------------
async function scopedStaff(amcosId: string, userId: string) {
  const u = await db.query.users.findFirst({ where: and(eq(U.id, userId), eq(U.amcosId, amcosId)) });
  if (!u || !(AMCOS_STAFF as readonly string[]).includes(u.role)) throw notFound('Mtumishi');
  return u;
}
const helpBody = z.object({
  reason: z.string().trim().min(5, 'Andika sababu (mf. "Simu imepotea" au namba ya tiketi)').max(300),
  ticketNo: z.number().int().positive().optional(),
});

customersRouter.get('/:id/staff/:userId/diagnostics', requirePermission('amcos.help'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const u = await scopedStaff(id, userId);
  const logins = await db.select({ success: schema.loginEvents.success, reason: schema.loginEvents.reason, ip: schema.loginEvents.ip,
    userAgent: schema.loginEvents.userAgent, suspicious: schema.loginEvents.suspicious, createdAt: schema.loginEvents.createdAt })
    .from(schema.loginEvents).where(eq(schema.loginEvents.userId, userId)).orderBy(desc(schema.loginEvents.createdAt)).limit(20);
  const [counts] = (await db.execute<Record<string, number>>(sql`select
    (select count(*)::int from user_sessions where user_id = ${userId} and revoked_at is null and expires_at > now()) as sessions,
    (select count(*)::int from trusted_devices where user_id = ${userId} and expires_at > now()) as devices,
    (select count(*)::int from login_events where user_id = ${userId} and not success and created_at > now() - interval '24 hours') as failed24h`)).rows;
  const helps = (await db.execute<Record<string, unknown>>(sql`select l.action, l.created_at, l.after, u.full_name as by from audit_logs l
    left join users u on u.id = l.user_id where l.entity_id = ${userId} and l.action in ('ACCOUNT_HELP_SIGNOUT','ACCOUNT_HELP_RESET_GUIDE')
    order by l.created_at desc limit 10`)).rows;
  // Simu inafichwa sehemu (huduma inajua ni ipi bila kuiona yote)
  const masked = u.phone.replace(/^255(\d{2})\d{4}(\d{3})$/, '0$1••••$2');
  res.json({
    user: { id: u.id, fullName: u.fullName, role: u.role, roleLabel: ROLE_SW[u.role], phone: masked, isActive: u.isActive,
      mustChangePassword: u.mustChangePassword, totpEnabled: u.totpEnabled, lastLoginAt: u.lastLoginAt },
    ...counts, logins, history: helps,
  });
}));

customersRouter.post('/:id/staff/:userId/signout', requirePermission('amcos.help'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const b = helpBody.parse(req.body);
  const u = await scopedStaff(id, userId);
  const a = await findAmcos(id);
  const out = await db.transaction(async (tx) => {
    const s = await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(userId)).returning({ id: schema.userSessions.id });
    const d = await tx.update(schema.trustedDevices).set({ expiresAt: new Date() }).where(and(eq(schema.trustedDevices.userId, userId), gt(schema.trustedDevices.expiresAt, new Date()))).returning({ id: schema.trustedDevices.id });
    await tx.update(U).set({ tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, userId));
    await audit(tx, req, { action: 'ACCOUNT_HELP_SIGNOUT', entity: 'User', entityId: userId, amcosId: id, after: { reason: b.reason, ticketNo: b.ticketNo ?? null, sessions: s.length, devices: d.length } });
    return { sessions: s.length, devices: d.length };
  });
  void sendSms(u.phone, `CoopLink: ${u.fullName}, akaunti yako ya ${a.name} imetolewa kwenye vifaa vyote kwa usalama (ombi la msaada). Ingia tena kwa nenosiri lako na OTP. Kama hukuomba, wasiliana nasi.`, 'SECURITY_ALERT', { amcosId: id, userId }).catch(() => {});
  res.json(out);
}));

customersRouter.post('/:id/staff/:userId/reset-guide', requirePermission('amcos.help'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const b = helpBody.parse(req.body);
  const u = await scopedStaff(id, userId);
  if (!u.isActive) throw badRequest('Akaunti hii imezimwa — Owner aiwashe kwanza');
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where entity_id = ${userId}
    and action = 'ACCOUNT_HELP_RESET_GUIDE' and created_at > now() - interval '24 hours'`)).rows;
  if (n >= 3) throw badRequest('Maelekezo yametumwa mara 3 ndani ya saa 24 — mpigie simu mtumishi umwongoze');
  const site = (await getSetting('business.profile')).website || 'mfumo wa CoopLink';
  const r = await sendSms(u.phone, `CoopLink: ${u.fullName}, kubadilisha nenosiri: fungua ${site}, bonyeza "Umesahau nenosiri?", weka namba yako ya simu, kisha weka OTP utakayotumiwa na nenosiri jipya. Usimpe mtu yeyote OTP yako.`,
    'PASSWORD_RESET_OTP', { amcosId: id, userId });
  await audit(db, req, { action: 'ACCOUNT_HELP_RESET_GUIDE', entity: 'User', entityId: userId, amcosId: id, after: { reason: b.reason, ticketNo: b.ticketNo ?? null, sms: r.status } });
  if (r.status === 'FAILED' || r.status === 'SKIPPED') throw badRequest(`SMS haikutumwa: ${r.error ?? 'hitilafu ya mtoa huduma'}`);
  res.json({ status: r.status });
}));
