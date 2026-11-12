// =====================================================================
//  SMS CENTER (Owner) — mtoa huduma, swichi za kila aina ya SMS, vikomo, kumbukumbu na gharama
//   Gharama ya SMS inabebwa na CoopLink, kwa hiyo Owner (SUPER_ADMIN) pekee ndiye anaamua aina zipi zitumike.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery } from '../../lib/http';
import { badRequest, forbidden } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { clearSettingsCache, getSetting, setSetting } from '../../lib/settings';
import { flushSms, providerStatus, sendNow, SMS_GROUPS, SMS_KINDS, type SmsKind } from '../../lib/sms';

export const ownerSmsRouter = Router();
const L = schema.smsLogs;
const KINDS = Object.keys(SMS_KINDS) as SmsKind[];
const ownerOnly = (req: Request) => { if (req.auth!.role !== 'SUPER_ADMIN') throw forbidden('Owner pekee ndiye anapanga matumizi ya SMS'); };
const monthStart = () => sql`date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') at time zone 'Africa/Dar_es_Salaam'`;

ownerSmsRouter.get('/', requirePermission('system.read'), ah(async (_req, res) => {
  const [sw, ev, limits, status] = await Promise.all([getSetting('switches'), getSetting('sms.events'), getSetting('sms.limits'), providerStatus()]);
  const byKind = (await db.execute<{ kind: string | null; sent: number; failed: number; skipped: number; queued: number; segments: number }>(sql`
    select kind, count(*) filter (where status in ('SENT','DELIVERED'))::int as sent, count(*) filter (where status = 'FAILED')::int as failed,
      count(*) filter (where status = 'SKIPPED')::int as skipped, count(*) filter (where status = 'QUEUED')::int as queued,
      coalesce(sum(segments) filter (where status in ('SENT','DELIVERED')), 0)::int as segments
    from sms_logs where created_at >= ${monthStart()} group by kind`)).rows;
  const byAmcos = (await db.execute<{ amcos_id: string | null; name: string | null; code: string | null; sent: number; segments: number }>(sql`
    select l.amcos_id, a.name, a.code, count(*)::int as sent, coalesce(sum(l.segments), 0)::int as segments
    from sms_logs l left join amcos a on a.id = l.amcos_id
    where l.created_at >= ${monthStart()} and l.status in ('SENT','DELIVERED') group by l.amcos_id, a.name, a.code order by segments desc limit 15`)).rows;
  const segs = byKind.reduce((t, k) => t + k.segments, 0);
  res.json({
    provider: status, masterOn: sw.sms, limits,
    kinds: KINDS.map((k) => ({ key: k, ...SMS_KINDS[k], on: !!ev[k], month: byKind.find((b) => b.kind === k) ?? null })),
    groups: SMS_GROUPS,
    month: { sent: byKind.reduce((t, k) => t + k.sent, 0), failed: byKind.reduce((t, k) => t + k.failed, 0), queued: byKind.reduce((t, k) => t + k.queued, 0), segments: segs, cost: segs * limits.pricePerSms },
    byAmcos: byAmcos.map((r) => ({ amcosId: r.amcos_id, name: r.name ?? 'CoopLink (jukwaa)', code: r.code, sent: r.sent, segments: r.segments, cost: r.segments * limits.pricePerSms })),
  });
}));

/** Owner anawasha / kuzima aina za SMS (nenosiri). Kila badiliko kwenye audit. */
ownerSmsRouter.put('/events', requirePermission('system.manage'), ah(async (req, res) => {
  ownerOnly(req);
  const b = z.object({ events: z.record(z.string(), z.boolean()) }).passthrough().parse(req.body);
  const bad = Object.keys(b.events).find((k) => !KINDS.includes(k as SmsKind));
  if (bad) throw badRequest(`Aina ya SMS "${bad}" haijulikani`);
  await requireReauth(req);
  const before = await getSetting('sms.events', { fresh: true });
  const after = { ...before, ...(b.events as Record<SmsKind, boolean>) };
  await db.transaction(async (tx) => {
    await setSetting(tx, 'sms.events', after, req.auth!.userId);
    const changed = KINDS.filter((k) => before[k] !== after[k]).map((k) => `${k}: ${after[k] ? 'ON' : 'OFF'}`);
    await audit(tx, req, { action: 'SMS_EVENTS_SET', entity: 'PlatformSettings', after: { changed } });
  });
  clearSettingsCache(); // baada ya commit: swichi mpya zinatumika mara moja
  res.json({ events: after });
}));

ownerSmsRouter.put('/limits', requirePermission('system.manage'), ah(async (req, res) => {
  ownerOnly(req);
  const b = z.object({
    broadcastPerMonth: z.coerce.number().int().min(0).max(1_000_000),
    pricePerSms: z.coerce.number().min(0).max(1000),
    quietStart: z.coerce.number().int().min(0).max(23),
    quietEnd: z.coerce.number().int().min(0).max(23),
  }).passthrough().parse(req.body);
  await requireReauth(req);
  const before = await getSetting('sms.limits', { fresh: true });
  const after = { broadcastPerMonth: b.broadcastPerMonth, pricePerSms: b.pricePerSms, quietStart: b.quietStart, quietEnd: b.quietEnd };
  await db.transaction(async (tx) => {
    await setSetting(tx, 'sms.limits', after, req.auth!.userId);
    await audit(tx, req, { action: 'SMS_LIMITS_SET', entity: 'PlatformSettings', before, after });
  });
  clearSettingsCache();
  res.json({ limits: after });
}));

ownerSmsRouter.get('/logs', requirePermission('system.read'), ah(async (req, res) => {
  const q = paginationQuery.extend({
    amcosId: z.string().uuid().optional(), kind: z.string().optional(), status: z.enum(schema.smsStatusEnum.enumValues).optional(),
    phone: z.string().trim().optional(), days: z.coerce.number().int().min(1).max(366).default(30),
  }).parse(req.query);
  const where: SQL | undefined = and(
    gte(L.createdAt, new Date(Date.now() - q.days * 86_400_000)),
    q.amcosId ? eq(L.amcosId, q.amcosId) : undefined, q.kind ? eq(L.kind, q.kind) : undefined, q.status ? eq(L.status, q.status) : undefined,
    q.phone ? sql`${L.phone} like ${'%' + q.phone.replace(/\D/g, '').replace(/^0/, '') + '%'}` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({ l: L, amcos: schema.amcos.name }).from(L).leftJoin(schema.amcos, eq(schema.amcos.id, L.amcosId)).where(where).orderBy(desc(L.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(L).where(where),
  ]);
  res.json(paged(rows.map((r) => ({ ...r.l, amcosName: r.amcos, kindLabel: r.l.kind ? SMS_KINDS[r.l.kind as SmsKind]?.label ?? r.l.kind : '—' })), total, q.page, q.pageSize));
}));

/** SMS ya majaribio kwa namba ya Owner (au namba nyingine) — inapita swichi za aina */
ownerSmsRouter.post('/test', requirePermission('system.manage'), ah(async (req, res) => {
  ownerOnly(req);
  const b = z.object({ phone: z.string().trim().optional(), message: z.string().trim().max(300).optional() }).parse(req.body);
  const me = (await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId), columns: { phone: true, id: true } }))!;
  const r = await sendNow({ kind: 'SYSTEM_ALERT', phone: b.phone || me.phone, text: b.message || 'CoopLink: SMS ya majaribio kutoka SMS Center.', userId: me.id }, { force: true });
  await audit(db, req, { action: 'SMS_TEST', entity: 'PlatformSettings', after: { status: r.status, error: r.error ?? null } });
  res.json(r);
}));

/** Tuma foleni sasa hivi (badala ya kusubiri kazi ya nyuma) */
ownerSmsRouter.post('/flush', requirePermission('system.manage'), ah(async (_req, res) => {
  res.json(await flushSms());
}));
