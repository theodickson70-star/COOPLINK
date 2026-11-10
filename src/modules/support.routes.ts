// =====================================================================
//  MSAADA (upande wa chama) — /api/v1/support
//  Kila mtumishi wa chama anafungua tiketi na kufuatilia majibu ya timu ya DUKALANGU.
//  Meneja anaona tiketi zote za chama; mtumishi mwingine anaona zake tu.
//  Iko KABLA ya mlinzi wa ada: chama kikifungwa, Mhasibu bado anaweza kuomba msaada (mf. malipo yamekwama).
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, uuidParam } from '../lib/http';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { attachmentsOf, attachmentsSchema, bodySchema, dueFrom, saveAttachments, ticketNo } from '../lib/support';

export const supportRouter = Router();
const T = schema.supportTickets, M = schema.supportMessages, A = schema.supportAttachments, U = schema.users;

const amcosOf = (req: Request) => {
  const a = req.auth!.amcosId;
  if (!a) throw forbidden('Msaada huu ni wa watumishi wa vyama');
  return a;
};
const isManager = (req: Request) => req.auth!.role === 'AMCOS_ADMIN';
/** Meneja anaona tiketi zote za chama; wengine zao tu */
const visible = (req: Request) => (isManager(req) ? eq(T.amcosId, amcosOf(req)) : and(eq(T.amcosId, amcosOf(req)), eq(T.createdById, req.auth!.userId)));
const unreadSql = sql<boolean>`(${T.lastPlatformAt} is not null and (${T.amcosSeenAt} is null or ${T.lastPlatformAt} > ${T.amcosSeenAt}))`;

async function findTicket(req: Request, id: string) {
  const [t] = await db.select().from(T).where(and(eq(T.id, id), visible(req)));
  if (!t) throw notFound('Tiketi');
  return t;
}

supportRouter.get('/tickets', ah(async (req, res) => {
  const q = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED', 'ACTIVE']).optional() }).parse(req.query);
  const where = q.status === 'ACTIVE' ? and(visible(req), sql`${T.status} <> 'CLOSED'`) : q.status ? and(visible(req), eq(T.status, q.status)) : visible(req);
  const rows = await db.select({
    id: T.id, ticketNo: T.ticketNo, subject: T.subject, category: T.category, priority: T.priority, status: T.status,
    createdAt: T.createdAt, lastAmcosAt: T.lastAmcosAt, lastPlatformAt: T.lastPlatformAt, closedAt: T.closedAt,
    createdBy: U.fullName, unread: unreadSql,
  }).from(T).innerJoin(U, eq(U.id, T.createdById)).where(where)
    .orderBy(sql`case when ${T.status} = 'CLOSED' then 1 else 0 end`, desc(sql`greatest(${T.lastAmcosAt}, coalesce(${T.lastPlatformAt}, ${T.lastAmcosAt}))`)).limit(200);
  res.json({ data: rows.map((r) => ({ ...r, number: ticketNo(r.ticketNo) })) });
}));

/** Idadi ya tiketi zenye majibu mapya (kwa alama kwenye menyu) */
supportRouter.get('/unread', ah(async (req, res) => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(T).where(and(visible(req), unreadSql));
  res.json({ count: r.n });
}));

const createBody = z.object({
  category: z.enum(['PAYMENT', 'BUG', 'TRAINING', 'FEATURE', 'OTHER']),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL']).default('NORMAL'),
  subject: z.string().trim().min(4, 'Andika kichwa kifupi cha tatizo').max(140),
  body: bodySchema,
  context: z.object({ page: z.string().max(300).optional(), version: z.string().max(40).optional(), userAgent: z.string().max(400).optional() }).partial().optional(),
  attachments: attachmentsSchema,
});

supportRouter.post('/tickets', ah(async (req, res) => {
  const b = createBody.parse(req.body);
  const amcosId = amcosOf(req);
  // kuzuia tiketi nyingi kwa wakati mmoja (mf. kubonyeza mara mbili)
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(T)
    .where(and(eq(T.createdById, req.auth!.userId), sql`${T.createdAt} > now() - interval '1 hour'`));
  if (recent.n >= 10) throw badRequest('Umefungua tiketi nyingi ndani ya saa moja. Ongeza maelezo kwenye tiketi iliyopo.');
  const now = new Date();
  const out = await db.transaction(async (tx) => {
    const [t] = await tx.insert(T).values({
      amcosId, createdById: req.auth!.userId, category: b.category, priority: b.priority, subject: b.subject,
      context: { ...b.context, role: req.auth!.role }, dueAt: dueFrom(now, b.priority), lastAmcosAt: now, amcosSeenAt: now,
    }).returning();
    const [m] = await tx.insert(M).values({ ticketId: t.id, authorId: req.auth!.userId, side: 'AMCOS', body: b.body }).returning();
    await saveAttachments(tx, t.id, m.id, b.attachments);
    await audit(tx, req, { action: 'SUPPORT_TICKET_CREATE', entity: 'support_ticket', entityId: t.id, amcosId, after: { number: ticketNo(t.ticketNo), category: t.category, priority: t.priority, subject: t.subject } });
    return t;
  });
  res.status(201).json({ ticket: { ...out, number: ticketNo(out.ticketNo) } });
}));

supportRouter.get('/tickets/:id', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const t = await findTicket(req, id);
  const msgs = await db.select({ id: M.id, side: M.side, body: M.body, createdAt: M.createdAt, author: U.fullName, authorId: M.authorId })
    .from(M).innerJoin(U, eq(U.id, M.authorId)).where(and(eq(M.ticketId, id), eq(M.internal, false))).orderBy(asc(M.createdAt));
  const att = await attachmentsOf(db, msgs.map((m) => m.id));
  // timu ya DUKALANGU inaonekana kama "Timu ya CoopLink" pamoja na jina la kwanza tu
  const messages = msgs.map((m) => ({ ...m, author: m.side === 'PLATFORM' ? `${m.author.split(' ')[0]} · Timu ya CoopLink` : m.author, attachments: att.get(m.id) ?? [] }));
  const [by] = await db.select({ fullName: U.fullName }).from(U).where(eq(U.id, t.createdById));
  await db.update(T).set({ amcosSeenAt: new Date() }).where(eq(T.id, id));
  res.json({ ticket: { ...t, number: ticketNo(t.ticketNo), createdBy: by?.fullName, assignedToId: undefined }, messages });
}));

supportRouter.post('/tickets/:id/messages', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({ body: bodySchema, attachments: attachmentsSchema }).parse(req.body);
  const t = await findTicket(req, id);
  const now = new Date();
  await db.transaction(async (tx) => {
    const [m] = await tx.insert(M).values({ ticketId: id, authorId: req.auth!.userId, side: 'AMCOS', body: b.body }).returning();
    await saveAttachments(tx, id, m.id, b.attachments);
    // jibu la chama: tiketi inarudi kwa timu (iliyofungwa inafunguliwa upya)
    await tx.update(T).set({
      lastAmcosAt: now, amcosSeenAt: now,
      status: t.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'OPEN',
      ...(t.status === 'CLOSED' ? { closedAt: null, closedById: null } : {}),
    }).where(eq(T.id, id));
    if (t.status === 'CLOSED') await audit(tx, req, { action: 'SUPPORT_TICKET_REOPEN', entity: 'support_ticket', entityId: id, amcosId: t.amcosId });
  });
  res.status(201).json({ ok: true });
}));

supportRouter.post('/tickets/:id/close', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const t = await findTicket(req, id);
  if (t.status === 'CLOSED') return res.json({ ok: true });
  await db.update(T).set({ status: 'CLOSED', closedAt: new Date(), closedById: req.auth!.userId }).where(eq(T.id, id));
  await audit(db, req, { action: 'SUPPORT_TICKET_CLOSE', entity: 'support_ticket', entityId: id, amcosId: t.amcosId });
  res.json({ ok: true });
}));

supportRouter.get('/attachments/:id', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [a] = await db.select({ mimeType: A.mimeType, data: A.data, ticketId: A.ticketId, internal: M.internal })
    .from(A).innerJoin(M, eq(M.id, A.messageId)).where(eq(A.id, id));
  if (!a || a.internal) throw notFound('Picha');
  await findTicket(req, a.ticketId); // ruhusa ya kuona tiketi hiyo
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(a.data, 'base64'));
}));
