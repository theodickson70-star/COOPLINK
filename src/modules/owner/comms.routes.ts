// MARKETING & COMMUNICATION — matangazo kwa vyama (ndani ya mfumo, SMS, email)
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, uuidParam } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { sendEmail, sendSms, type DeliveryResult } from '../../lib/notify';
import { getSetting } from '../../lib/settings';
import { addDays, today } from '../../lib/subscriptions';
import { SEGMENTS, segmentIds, type Segment } from './customers.routes';

export const commsRouter = Router();
const AN = schema.announcements;
const DL = schema.announcementDeliveries;
const CHANNELS = ['IN_APP', 'SMS', 'EMAIL'] as const;
const MAX_SMS = 1000;

commsRouter.get(
  '/announcements',
  requirePermission('comms.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({ kind: z.enum(schema.announcementKindEnum.enumValues).optional() }).parse(req.query);
    const where = q.kind ? eq(AN.kind, q.kind) : undefined;
    const rows = await db.select({
      a: AN,
      stats: sql<Record<string, number>>`(select coalesce(json_object_agg(status, n), '{}'::json) from (
        select status, count(*)::int as n from announcement_deliveries d where d.announcement_id = "announcements"."id" group by status) x)`,
      by: schema.users.fullName,
    }).from(AN).leftJoin(schema.users, eq(schema.users.id, AN.createdById))
      .where(where).orderBy(desc(AN.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(AN).where(where);
    res.json(paged(rows.map((r) => ({ ...r.a, deliveryStats: r.stats, createdBy: r.by })), total, q.page, q.pageSize));
  }),
);

commsRouter.get(
  '/announcements/:id',
  requirePermission('comms.read'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const a = await db.query.announcements.findFirst({ where: eq(AN.id, id) });
    if (!a) throw notFound('Tangazo');
    const deliveries = await db.select({ d: DL, amcos: schema.amcos.name }).from(DL).leftJoin(schema.amcos, eq(schema.amcos.id, DL.amcosId))
      .where(eq(DL.announcementId, id)).orderBy(DL.channel, schema.amcos.name).limit(2000);
    res.json({ announcement: a, deliveries: deliveries.map((x) => ({ ...x.d, amcosName: x.amcos })) });
  }),
);

export type Target = { id: string; name: string; phone: string | null; email: string | null };

export async function resolveTargets(audience: 'ALL' | 'SELECTED', amcosIds?: string[]): Promise<Target[]> {
  const where = audience === 'ALL'
    ? inArray(schema.amcos.status, ['ACTIVE', 'SUSPENDED'])
    : inArray(schema.amcos.id, amcosIds ?? []);
  return db.select({ id: schema.amcos.id, name: schema.amcos.name, phone: schema.amcos.phone, email: schema.amcos.email }).from(schema.amcos).where(where);
}

/** Namba za kupokea SMS za chama: simu ya chama + Makatibu/Mameneja wake walio hai. */
async function smsRecipients(amcosId: string, amcosPhone: string | null) {
  const admins = await db.select({ phone: schema.users.phone }).from(schema.users)
    .where(and(eq(schema.users.amcosId, amcosId), eq(schema.users.role, 'AMCOS_ADMIN'), eq(schema.users.isActive, true)));
  return [...new Set([amcosPhone, ...admins.map((a) => a.phone)].filter(Boolean) as string[])];
}

export async function deliver(announcementId: string, targets: Target[], channels: string[], message: (t: Target) => string, subject: string) {
  const counts: Record<string, number> = {};
  const bump = (s: string) => { counts[s] = (counts[s] ?? 0) + 1; };
  let smsSent = 0;
  for (const t of targets) {
    if (channels.includes('IN_APP')) {
      await db.insert(DL).values({ announcementId, amcosId: t.id, channel: 'IN_APP', recipient: t.name, status: 'SENT' });
      bump('SENT');
    }
    if (channels.includes('SMS')) {
      const phones = await smsRecipients(t.id, t.phone);
      if (!phones.length) {
        await db.insert(DL).values({ announcementId, amcosId: t.id, channel: 'SMS', status: 'SKIPPED', error: 'Hakuna namba ya simu' });
        bump('SKIPPED');
      }
      for (const ph of phones) {
        const r: DeliveryResult = smsSent >= MAX_SMS ? { status: 'SKIPPED', error: `Kikomo cha SMS ${MAX_SMS} kwa tangazo moja` } : await sendSms(ph, message(t), 'OWNER_ANNOUNCEMENT', { amcosId: t.id });
        if (r.status === 'SENT') smsSent++;
        await db.insert(DL).values({ announcementId, amcosId: t.id, channel: 'SMS', recipient: ph, status: r.status, providerRef: r.providerRef, error: r.error });
        bump(r.status);
      }
    }
    if (channels.includes('EMAIL')) {
      const r: DeliveryResult = t.email ? await sendEmail(t.email, subject, message(t)) : { status: 'SKIPPED', error: 'Hakuna email' };
      await db.insert(DL).values({ announcementId, amcosId: t.id, channel: 'EMAIL', recipient: t.email, status: r.status, error: r.error });
      bump(r.status);
    }
  }
  await db.update(AN).set({ sentAt: new Date() }).where(eq(AN.id, announcementId));
  return counts;
}

commsRouter.post(
  '/announcements',
  requirePermission('comms.send'),
  ah(async (req, res) => {
    const b = z.object({
      kind: z.enum(['ANNOUNCEMENT', 'SYSTEM_UPDATE', 'MARKETING']),
      title: z.string().trim().min(3).max(120),
      body: z.string().trim().min(3).max(1000),
      audience: z.enum(['ALL', 'SELECTED', 'SEGMENT']),
      amcosIds: z.array(z.string().uuid()).max(2000).optional(),
      segment: z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]]).optional(),  // v0.36: kundi la wateja (mf. ada imepita muda)
      channels: z.array(z.enum(CHANNELS)).min(1),
    }).parse(req.body);
    if (b.audience === 'SELECTED' && !b.amcosIds?.length) throw badRequest('Chagua angalau chama kimoja');
    if (b.audience === 'SEGMENT' && !b.segment) throw badRequest('Chagua kundi la wateja');
    const targets = b.audience === 'SEGMENT'
      ? await resolveTargets('SELECTED', await segmentIds(b.segment!))
      : await resolveTargets(b.audience, b.amcosIds);
    if (!targets.length) throw badRequest('Hakuna chama cha kutumiwa');
    const [a] = await db.insert(AN).values({
      kind: b.kind, title: b.title, body: b.body, audience: b.audience === 'SEGMENT' ? `SEGMENT:${b.segment}` : b.audience,
      amcosIds: b.audience === 'ALL' ? null : targets.map((t) => t.id), channels: b.channels, createdById: req.auth!.userId,
    }).returning();
    await audit(db, req, { action: 'ANNOUNCEMENT_SEND', entity: 'Announcement', entityId: a.id, after: { ...b, targets: targets.length } });
    const counts = await deliver(a.id, targets, b.channels, () => `CoopLink: ${b.title}\n${b.body}`.slice(0, 459), b.title);
    res.status(201).json({ announcement: a, targets: targets.length, deliveries: counts });
  }),
);

// Vikumbusho vya subscription zinazokaribia kuisha au zilizopita muda (grace)
commsRouter.post(
  '/expiry-reminders',
  requirePermission('comms.send'),
  ah(async (req, res) => {
    const cfg = await getSetting('config');
    const b = z.object({ days: z.number().int().min(1).max(90).default(cfg.expiringWindowDays), channels: z.array(z.enum(CHANNELS)).min(1).default(['IN_APP', 'SMS']) }).parse(req.body ?? {});
    const t = today();
    const rows = await db.select({ amcosId: schema.subscriptions.amcosId, endDate: schema.subscriptions.endDate, status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(and(ne(schema.subscriptions.status, 'CANCELLED'), sql`(${schema.subscriptions.status} in ('TRIAL','ACTIVE') and ${schema.subscriptions.endDate} between ${t} and ${addDays(t, b.days)}) or ${schema.subscriptions.status} = 'PAST_DUE'`));
    if (!rows.length) return res.json({ targets: 0, deliveries: {} });
    const endOf = new Map(rows.map((r) => [r.amcosId, r]));
    const targets = await resolveTargets('SELECTED', [...endOf.keys()]);
    const [a] = await db.insert(AN).values({
      kind: 'EXPIRY_REMINDER', title: 'Subscription yako ya CoopLink inaisha',
      body: 'Subscription ya chama chako inakaribia kuisha au imepita muda. Lipia mapema ili huduma isisitishwe.',
      audience: 'SELECTED', amcosIds: targets.map((x) => x.id), channels: b.channels, createdById: req.auth!.userId,
    }).returning();
    await audit(db, req, { action: 'EXPIRY_REMINDERS_SEND', entity: 'Announcement', entityId: a.id, after: { targets: targets.length, days: b.days } });
    const counts = await deliver(a.id, targets, b.channels, (x) => {
      const s = endOf.get(x.id)!;
      return s.status === 'PAST_DUE'
        ? `CoopLink: Subscription ya ${x.name} ilipita muda tarehe ${s.endDate}. Lipia sasa ili huduma isisitishwe.`
        : `CoopLink: Subscription ya ${x.name} inaisha tarehe ${s.endDate}. Lipia mapema ili kuendelea bila kukatizwa.`;
    }, 'Subscription ya CoopLink');
    res.status(201).json({ announcement: a, targets: targets.length, deliveries: counts });
  }),
);
