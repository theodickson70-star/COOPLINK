// =====================================================================
//  SMS ZA CHAMA — matangazo na taarifa za vikao kwa wakulima (Meneja), deni la kikundi kwa SMS
//   Gharama inabebwa na CoopLink: Owner anawasha huduma na kuweka kikomo cha SMS za matangazo kwa mwezi.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, uuidParam } from '../lib/http';
import { AppError, badRequest, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { getSetting } from '../lib/settings';
import { broadcastUsedThisMonth, enqueue, segments, smsConfigured, smsEnabled, toGsm, type SmsMessage } from '../lib/sms';
import { farmerPhone, smsGroupDebt } from '../lib/sms-events';

export const smsRouter = Router();
const M = schema.members;
const KIND_LABEL = { MEETING: 'KIKAO', ANNOUNCEMENT: 'TANGAZO' } as const;
const audience = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }),
  z.object({ type: z.literal('VILLAGE'), village: z.string().trim().min(1) }),
  z.object({ type: z.literal('GROUP'), groupId: z.string().uuid() }),
]);
const body = z.object({ kind: z.enum(['MEETING', 'ANNOUNCEMENT']), message: z.string().trim().min(5, 'Andika ujumbe').max(450, 'Ujumbe ni mrefu mno (herufi 450 mwisho = SMS 3)'), audience });

async function chamaName(amcosId: string) {
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { name: true } });
  return (a?.name ?? 'Chama').slice(0, 30);
}
async function recipients(amcosId: string, a: z.infer<typeof audience>) {
  if (a.type === 'GROUP') {
    const g = await db.query.memberGroups.findFirst({ where: and(eq(schema.memberGroups.id, a.groupId), eq(schema.memberGroups.amcosId, amcosId)) });
    if (!g) throw notFound('Kikundi');
    const ids = (await db.select({ id: schema.memberGroupMembers.memberId }).from(schema.memberGroupMembers).where(and(eq(schema.memberGroupMembers.groupId, g.id), isNull(schema.memberGroupMembers.leftAt)))).map((r) => r.id);
    return ids.length ? db.select().from(M).where(and(inArray(M.id, ids), eq(M.status, 'ACTIVE'))) : [];
  }
  return db.select().from(M).where(and(eq(M.amcosId, amcosId), eq(M.status, 'ACTIVE'), a.type === 'VILLAGE' ? ilike(M.village, a.village) : undefined));
}
const fullText = (chama: string, kind: 'MEETING' | 'ANNOUNCEMENT', message: string) => toGsm(`${chama} - ${KIND_LABEL[kind]}: ${message}`);

async function quota(amcosId: string) {
  const [L, used, on] = await Promise.all([getSetting('sms.limits'), broadcastUsedThisMonth(amcosId), smsEnabled('CHAMA_BROADCAST')]);
  return { enabled: on && smsConfigured(), limit: L.broadcastPerMonth, used, remaining: Math.max(L.broadcastPerMonth - used, 0) };
}

smsRouter.get('/broadcasts', requireAmcosPerm('members.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const B = schema.smsBroadcasts;
  const rows = await db.select({ b: B, by: schema.users.fullName,
    sent: sql<number>`(select count(*)::int from sms_logs l where l.reference_type = 'SmsBroadcast' and l.reference_id = "sms_broadcasts"."id" and l.status in ('SENT','DELIVERED'))`,
    failed: sql<number>`(select count(*)::int from sms_logs l where l.reference_type = 'SmsBroadcast' and l.reference_id = "sms_broadcasts"."id" and l.status = 'FAILED')` })
    .from(B).leftJoin(schema.users, eq(schema.users.id, B.createdById)).where(amcosScope(req, B.amcosId)).orderBy(desc(B.createdAt)).limit(50);
  const villages = (await db.selectDistinct({ v: M.village }).from(M).where(and(eq(M.amcosId, amcosId), eq(M.status, 'ACTIVE'), sql`${M.village} is not null`))).map((r) => r.v!).sort();
  const groups = await db.select({ id: schema.memberGroups.id, name: schema.memberGroups.name }).from(schema.memberGroups).where(and(eq(schema.memberGroups.amcosId, amcosId), eq(schema.memberGroups.status, 'ACTIVE')));
  res.json({ quota: await quota(amcosId), villages, groups, chama: await chamaName(amcosId), data: rows.map((r) => ({ ...r.b, createdBy: r.by, sent: r.sent, failed: r.failed })) });
}));

/** Hakiki kabla ya kutuma: wakulima wangapi, wangapi wana simu, SMS ngapi */
smsRouter.post('/broadcasts/preview', requireAmcosPerm('members.approve'), ah(async (req, res) => {
  const b = body.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const list = await recipients(amcosId, b.audience);
  const withPhone = list.filter((m) => farmerPhone(m));
  const text = fullText(await chamaName(amcosId), b.kind, b.message);
  const seg = segments(text);
  res.json({ farmers: list.length, withPhone: withPhone.length, segments: seg, total: withPhone.length * seg, text, quota: await quota(amcosId) });
}));

/** Meneja anatuma tangazo / taarifa ya kikao (ndani ya kikomo cha mwezi) */
smsRouter.post('/broadcasts', requireAmcosPerm('members.approve'), ah(async (req, res) => {
  const b = body.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const q = await quota(amcosId);
  if (!q.enabled) throw badRequest('Huduma ya matangazo kwa SMS haijawashwa na CoopLink');
  const list = (await recipients(amcosId, b.audience)).filter((m) => farmerPhone(m));
  if (!list.length) throw badRequest('Hakuna mkulima mwenye namba ya simu kwenye kundi hili');
  const text = fullText(await chamaName(amcosId), b.kind, b.message);
  const total = list.length * segments(text);
  if (total > q.remaining) throw new AppError(400, 'SMS_QUOTA', `SMS ${total} zinazidi kikomo kilichobaki mwezi huu (${q.remaining} kati ya ${q.limit}). Punguza wapokeaji au ufupishe ujumbe.`);
  const out = await db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.smsBroadcasts).values({ amcosId, kind: b.kind, message: b.message, audience: b.audience, recipients: list.length, segments: segments(text), createdById: req.auth!.userId }).returning();
    const n = await enqueue(tx, list.map((m): SmsMessage => ({ kind: 'CHAMA_BROADCAST', phone: farmerPhone(m), text, amcosId, memberId: m.id, userId: req.auth!.userId, referenceType: 'SmsBroadcast', referenceId: row.id })));
    await audit(tx, req, { action: 'SMS_BROADCAST', entity: 'SmsBroadcast', entityId: row.id, amcosId, after: { kind: b.kind, audience: b.audience, recipients: n, sms: total } });
    return { broadcast: row, queued: n };
  });
  res.status(201).json(out);
}));

/** Deni la kikundi kwa SMS (Meneja / Mhasibu) — mara moja kwa siku kwa kikundi */
smsRouter.post('/groups/:id/debt', requireAmcosPerm('members.approve', 'finance.record'), ah(async (req: Request, res) => {
  const { id } = uuidParam.parse(req.params);
  const [g] = await db.select().from(schema.memberGroups).where(and(eq(schema.memberGroups.id, id), amcosScope(req, schema.memberGroups.amcosId)));
  if (!g) throw notFound('Kikundi');
  if (g.status !== 'ACTIVE') throw badRequest('Kikundi hiki hakiko hai');
  if (!smsConfigured() || !(await smsEnabled('GROUP_DEBT'))) throw badRequest('Huduma ya deni la kikundi kwa SMS haijawashwa na CoopLink');
  const [recent] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from sms_logs where kind = 'GROUP_DEBT' and reference_id = ${id} and created_at > now() - interval '24 hours'`)).rows;
  if (recent.n > 0) throw new AppError(429, 'SMS_RECENT', 'Deni la kikundi hiki limeshatumwa kwa SMS ndani ya saa 24');
  const n = await db.transaction(async (tx) => {
    const k = await smsGroupDebt(tx, id, req.auth!.userId);
    await audit(tx, req, { action: 'SMS_GROUP_DEBT', entity: 'MemberGroup', entityId: id, amcosId: g.amcosId, after: { queued: k } });
    return k;
  });
  res.json({ queued: n });
}));
