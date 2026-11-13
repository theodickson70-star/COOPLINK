// =====================================================================
//  MAOMBI KWA OWNER (v0.38) — wafanyakazi wa CoopLink wanaomba huduma zinazohitaji Owner
//   (kumtoa mtumishi wa chama kwenye vifaa vyote, kusamehe ada, marejesho, idhini ya chama, tatizo la kiufundi, ruhusa…)
//   - Mfanyakazi anaona maombi yake tu; Owner anaona yote.
//   - Owner anajibu, anabadilisha hali (Inashughulikiwa / Imekamilika / Imekataliwa) na, kwa "kutoa kwenye vifaa",
//     anatekeleza moja kwa moja kutoka kwenye ombi.
//   - Ombi la dharura linamfikia Owner kwa SMS.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '../../db';
import { ah, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { activeSessionsWhere, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { enqueue, sendNow } from '../../lib/sms';
import { maskPhone } from '../../lib/staff-credentials';

export const requestsRouter = Router();
const R = schema.internalRequests;
const M = schema.internalRequestMessages;
const U = schema.users;
const CATS = schema.internalRequestCategoryEnum.enumValues;
export const REQUEST_CATEGORY: Record<(typeof CATS)[number], string> = {
  ACCOUNT_SIGNOUT: 'Kumtoa mtumishi wa chama kwenye vifaa vyote', FEE_WAIVER: 'Kusamehe / kupunguza ada', REFUND: 'Marejesho ya malipo',
  AMCOS_APPROVAL: 'Idhini ya chama', TECHNICAL: 'Tatizo la kiufundi', ACCESS: 'Ruhusa / akaunti yangu', OTHER: 'Mengineyo',
};
const isOwner = (req: Request) => req.auth!.role === 'SUPER_ADMIN';

async function ownerPhones() {
  return (await db.select({ phone: U.phone }).from(U).where(and(eq(U.role, 'SUPER_ADMIN'), eq(U.isActive, true)))).map((r) => r.phone);
}

async function load(req: Request, id: string) {
  const [r] = await db.select().from(R).where(eq(R.id, id));
  if (!r) throw notFound('Ombi');
  if (!isOwner(req) && r.createdById !== req.auth!.userId) throw notFound('Ombi');
  return r;
}

requestsRouter.get('/', ah(async (req, res) => {
  const q = z.object({ status: z.enum([...schema.internalRequestStatusEnum.enumValues, 'ACTIVE'] as [string, ...string[]]).optional() }).parse(req.query);
  const By = alias(U, 'by');
  const conds = [
    isOwner(req) ? undefined : eq(R.createdById, req.auth!.userId),
    q.status === 'ACTIVE' ? inArray(R.status, ['OPEN', 'IN_PROGRESS']) : q.status ? eq(R.status, q.status as 'OPEN') : undefined,
  ];
  const rows = await db.select({
    r: R, by: By.fullName, byRole: By.role, amcos: schema.amcos.name,
    messages: sql<number>`(select count(*)::int from internal_request_messages m where m.request_id = ${R.id})`,
    lastAt: sql<string>`coalesce((select max(m.created_at) from internal_request_messages m where m.request_id = ${R.id}), ${R.createdAt})`,
    // Jibu la Owner ambalo mwombaji hajaliona bado
    unseen: sql<boolean>`exists (select 1 from internal_request_messages m where m.request_id = ${R.id} and m.author_id <> ${R.createdById}
      and m.created_at > coalesce(${R.creatorSeenAt}, 'epoch'::timestamptz)) or (${R.resolvedAt} is not null and ${R.resolvedAt} > coalesce(${R.creatorSeenAt}, 'epoch'::timestamptz))`,
  }).from(R).leftJoin(By, eq(By.id, R.createdById)).leftJoin(schema.amcos, eq(schema.amcos.id, R.amcosId))
    .where(and(...conds)).orderBy(sql`case when ${R.status} in ('OPEN','IN_PROGRESS') then 0 else 1 end`, sql`case when ${R.priority} = 'URGENT' then 0 else 1 end`, desc(R.createdAt)).limit(300);
  res.json({ data: rows.map((x) => ({ ...x.r, by: x.by, byRole: x.byRole, amcosName: x.amcos, messages: x.messages, lastAt: x.lastAt, unseen: !isOwner(req) && x.unseen })), categories: REQUEST_CATEGORY });
}));

requestsRouter.post('/', ah(async (req, res) => {
  if (isOwner(req)) throw badRequest('Maombi yanatumwa na wafanyakazi kwa Owner');
  const b = z.object({
    category: z.enum(CATS),
    priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    subject: z.string().trim().min(5, 'Andika kichwa kinachoeleweka').max(140),
    body: z.string().trim().min(10, 'Eleza ombi lako kwa ufupi').max(3000),
    amcosId: z.string().uuid().nullable().optional(),
    targetUserId: z.string().uuid().nullable().optional(),
  }).parse(req.body);
  if (b.category === 'ACCOUNT_SIGNOUT' && (!b.amcosId || !b.targetUserId)) throw badRequest('Chagua chama na mtumishi anayehusika');
  if (b.amcosId && !(await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId), columns: { id: true } }))) throw notFound('Chama');
  if (b.targetUserId) {
    const t = await db.query.users.findFirst({ where: eq(U.id, b.targetUserId), columns: { amcosId: true } });
    if (!t || (b.amcosId && t.amcosId !== b.amcosId)) throw badRequest('Mtumishi huyu si wa chama hiki');
  }
  if (b.category === 'ACCOUNT_SIGNOUT') {
    const dup = await db.query.internalRequests.findFirst({ where: and(eq(R.targetUserId, b.targetUserId!), eq(R.category, 'ACCOUNT_SIGNOUT'), inArray(R.status, ['OPEN', 'IN_PROGRESS'])) });
    if (dup) throw conflict(`Ombi #${dup.requestNo} la mtumishi huyu tayari linasubiri Owner`);
  }
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(R).values({ category: b.category, priority: b.priority, subject: b.subject, amcosId: b.amcosId ?? null,
      targetUserId: b.targetUserId ?? null, createdById: req.auth!.userId, creatorSeenAt: new Date() }).returning();
    await tx.insert(M).values({ requestId: r.id, authorId: req.auth!.userId, body: b.body });
    await audit(tx, req, { action: 'INTERNAL_REQUEST_CREATE', entity: 'InternalRequest', entityId: r.id, amcosId: r.amcosId, after: { ...r, body: b.body } });
    // Arifa kwa Owner: dharura mara moja (hata saa za kimya); nyingine kwenye foleni (inaheshimu saa za kimya)
    const me = await tx.query.users.findFirst({ where: eq(U.id, req.auth!.userId), columns: { fullName: true } });
    const text = `CoopLink: Ombi jipya #${r.requestNo} kutoka ${me?.fullName ?? 'mfanyakazi'}${b.priority === 'URGENT' ? ' (DHARURA)' : ''}: ${b.subject}. Fungua Owner Panel > Maombi ya timu.`;
    if (b.priority !== 'URGENT') await enqueue(tx, (await ownerPhones()).map((phone) => ({ kind: 'STAFF_ALERT' as const, phone, text })));
    return { r, text };
  });
  if (b.priority === 'URGENT') for (const phone of await ownerPhones()) void sendNow({ kind: 'SYSTEM_ALERT', phone, text: row.text }).catch(() => {});
  res.status(201).json({ request: row.r });
}));

requestsRouter.get('/:id', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const r = await load(req, id);
  const msgs = await db.select({ m: M, by: U.fullName, role: U.role }).from(M).leftJoin(U, eq(U.id, M.authorId)).where(eq(M.requestId, id)).orderBy(M.createdAt);
  const creator = await db.query.users.findFirst({ where: eq(U.id, r.createdById), columns: { fullName: true, role: true } });
  const amcos = r.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, r.amcosId), columns: { id: true, name: true, code: true } }) : null;
  const target = r.targetUserId ? await db.query.users.findFirst({ where: eq(U.id, r.targetUserId), columns: { id: true, fullName: true, role: true, phone: true, isActive: true, lastLoginAt: true } }) : null;
  if (!isOwner(req) && r.createdById === req.auth!.userId) await db.update(R).set({ creatorSeenAt: new Date() }).where(eq(R.id, id));
  res.json({
    request: r, creator, amcos, categories: REQUEST_CATEGORY,
    target: target ? { ...target, phone: maskPhone(target.phone) } : null,
    messages: msgs.map((x) => ({ ...x.m, by: x.by, role: x.role, mine: x.m.authorId === req.auth!.userId })),
    can: { manage: isOwner(req), execute: isOwner(req) && r.category === 'ACCOUNT_SIGNOUT' && ['OPEN', 'IN_PROGRESS'].includes(r.status) && !!target },
  });
}));

requestsRouter.post('/:id/messages', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { body } = z.object({ body: z.string().trim().min(2).max(3000) }).parse(req.body);
  const r = await load(req, id);
  if (r.status === 'DONE' || r.status === 'DECLINED') {
    if (isOwner(req)) throw badRequest('Ombi limefungwa');
    // Mwombaji akijibu ombi lililofungwa, linafunguka tena
    await db.update(R).set({ status: 'OPEN', resolvedAt: null, resolvedById: null }).where(eq(R.id, id));
  }
  await db.transaction(async (tx) => {
    await tx.insert(M).values({ requestId: id, authorId: req.auth!.userId, body });
    await tx.update(R).set({ updatedAt: new Date(), ...(isOwner(req) ? { status: r.status === 'OPEN' ? 'IN_PROGRESS' : r.status } : { creatorSeenAt: new Date() }) }).where(eq(R.id, id));
  });
  res.status(201).json({ ok: true });
}));

/** Owner: hali ya ombi (Inashughulikiwa / Imekamilika / Imekataliwa) */
requestsRouter.post('/:id/status', ah(async (req, res) => {
  if (!isOwner(req)) throw forbidden('Owner pekee anabadilisha hali ya ombi');
  const { id } = uuidParam.parse(req.params);
  const b = z.object({ status: z.enum(['IN_PROGRESS', 'DONE', 'DECLINED']), resolution: z.string().trim().max(1000).optional() })
    .refine((x) => x.status !== 'DECLINED' || (x.resolution?.length ?? 0) >= 3, { message: 'Eleza kwa nini ombi limekataliwa', path: ['resolution'] }).parse(req.body);
  const r = await load(req, id);
  const closing = b.status !== 'IN_PROGRESS';
  const [row] = await db.update(R).set({ status: b.status, updatedAt: new Date(),
    ...(closing ? { resolution: b.resolution ?? null, resolvedById: req.auth!.userId, resolvedAt: new Date() } : {}) }).where(eq(R.id, id)).returning();
  if (b.resolution) await db.insert(M).values({ requestId: id, authorId: req.auth!.userId, body: b.resolution });
  await audit(db, req, { action: 'INTERNAL_REQUEST_STATUS', entity: 'InternalRequest', entityId: id, amcosId: r.amcosId, before: { status: r.status }, after: { status: b.status, resolution: b.resolution ?? null } });
  if (closing) {
    const c = await db.query.users.findFirst({ where: eq(U.id, r.createdById), columns: { phone: true } });
    if (c) await enqueue(db, { kind: 'STAFF_ALERT', phone: c.phone, userId: r.createdById,
      text: `CoopLink: Ombi lako #${r.requestNo} (${r.subject}) ${b.status === 'DONE' ? 'limekamilika' : 'limekataliwa'}.${b.resolution ? ` ${b.resolution.slice(0, 120)}` : ''}` });
  }
  res.json({ request: row });
}));

/** Owner: kutekeleza ombi la "kumtoa mtumishi wa chama kwenye vifaa vyote" moja kwa moja (nenosiri la Owner linahitajika). */
requestsRouter.post('/:id/execute', ah(async (req, res) => {
  if (!isOwner(req)) throw forbidden('Owner pekee anatekeleza ombi hili');
  const { id } = uuidParam.parse(req.params);
  const r = await load(req, id);
  if (r.category !== 'ACCOUNT_SIGNOUT' || !r.targetUserId) throw badRequest('Ombi hili halitekelezwi moja kwa moja');
  if (!['OPEN', 'IN_PROGRESS'].includes(r.status)) throw conflict('Ombi hili limeshafungwa');
  await requireReauth(req);
  const u = await db.query.users.findFirst({ where: eq(U.id, r.targetUserId) });
  if (!u) throw notFound('Mtumishi');
  const a = u.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, u.amcosId), columns: { name: true } }) : null;
  const out = await db.transaction(async (tx) => {
    const s = await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(u.id)).returning({ id: schema.userSessions.id });
    const d = await tx.update(schema.trustedDevices).set({ expiresAt: new Date() }).where(and(eq(schema.trustedDevices.userId, u.id), gt(schema.trustedDevices.expiresAt, new Date()))).returning({ id: schema.trustedDevices.id });
    await tx.update(U).set({ tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, u.id));
    await tx.update(R).set({ status: 'DONE', resolution: 'Ametolewa kwenye vifaa vyote na Owner', resolvedById: req.auth!.userId, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(R.id, id));
    await tx.insert(M).values({ requestId: id, authorId: req.auth!.userId, body: `Imetekelezwa: ametolewa kwenye vifaa vyote (sessions ${s.length}, vifaa ${d.length}).` });
    await audit(tx, req, { action: 'ACCOUNT_HELP_SIGNOUT', entity: 'User', entityId: u.id, amcosId: u.amcosId, after: { reason: `Ombi #${r.requestNo}: ${r.subject}`, requestId: id, sessions: s.length, devices: d.length } });
    return { sessions: s.length, devices: d.length };
  });
  void sendNow({ kind: 'SECURITY_ALERT', phone: u.phone, userId: u.id, amcosId: u.amcosId,
    text: `CoopLink: ${u.fullName}, akaunti yako${a ? ` ya ${a.name}` : ''} imetolewa kwenye vifaa vyote kwa usalama. Ingia tena kwa nenosiri lako na OTP. Kama hukuomba, wasiliana nasi.` }).catch(() => {});
  const c = await db.query.users.findFirst({ where: eq(U.id, r.createdById), columns: { phone: true } });
  if (c) await enqueue(db, { kind: 'STAFF_ALERT', phone: c.phone, userId: r.createdById, text: `CoopLink: Ombi lako #${r.requestNo} limekamilika — ${u.fullName} ametolewa kwenye vifaa vyote.` });
  res.json(out);
}));
