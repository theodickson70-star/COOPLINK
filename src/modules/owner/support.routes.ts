// =====================================================================
//  TIKETI ZA MSAADA (upande wa timu ya DUKALANGU) — /api/v1/owner/support
//  Foleni ya vyama vyote, kugawa kazi, kujibu, maelezo ya ndani, na muda wa jibu (SLA).
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, uuidParam } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { effectivePermissions, PLATFORM_ROLES } from '../../lib/permissions';
import { attachmentsOf, attachmentsSchema, bodySchema, dueFrom, saveAttachments, ticketNo } from '../../lib/support';

export const ownerSupportRouter = Router();
const T = schema.supportTickets, M = schema.supportMessages, A = schema.supportAttachments, U = schema.users, AM = schema.amcos;

const overdueSql = sql<boolean>`(${T.firstResponseAt} is null and ${T.status} <> 'CLOSED' and ${T.dueAt} < now())`;
/** Tiketi inasubiri jibu la timu: chama kimeandika baada ya jibu la mwisho la timu */
const waitingSql = sql<boolean>`(${T.status} <> 'CLOSED' and (${T.lastPlatformAt} is null or ${T.lastAmcosAt} > ${T.lastPlatformAt}))`;

ownerSupportRouter.get('/summary', requirePermission('support.read'), ah(async (req, res) => {
  const [r] = await db.select({
    open: sql<number>`count(*) filter (where ${T.status} <> 'CLOSED')::int`,
    waiting: sql<number>`count(*) filter (where ${waitingSql})::int`,
    overdue: sql<number>`count(*) filter (where ${overdueSql})::int`,
    unassigned: sql<number>`count(*) filter (where ${T.status} <> 'CLOSED' and ${T.assignedToId} is null)::int`,
    mine: sql<number>`count(*) filter (where ${T.status} <> 'CLOSED' and ${T.assignedToId} = ${req.auth!.userId})::int`,
    closed30: sql<number>`count(*) filter (where ${T.closedAt} > now() - interval '30 days')::int`,
    avgFirstHours: sql<string | null>`round((avg(extract(epoch from (${T.firstResponseAt} - ${T.createdAt}))) filter (where ${T.createdAt} > now() - interval '30 days')) / 3600, 1)::text`,
  }).from(T);
  res.json(r);
}));

ownerSupportRouter.get('/tickets', requirePermission('support.read'), ah(async (req, res) => {
  const q = z.object({
    view: z.enum(['active', 'waiting', 'overdue', 'unassigned', 'mine', 'closed', 'all']).default('active'),
    amcosId: z.string().uuid().optional(),
    q: z.string().trim().max(80).optional(),
  }).parse(req.query);
  const conds: SQL[] = [];
  if (q.view === 'active') conds.push(sql`${T.status} <> 'CLOSED'`);
  if (q.view === 'waiting') conds.push(waitingSql);
  if (q.view === 'overdue') conds.push(overdueSql);
  if (q.view === 'unassigned') conds.push(sql`${T.status} <> 'CLOSED'`, isNull(T.assignedToId));
  if (q.view === 'mine') conds.push(sql`${T.status} <> 'CLOSED'`, eq(T.assignedToId, req.auth!.userId));
  if (q.view === 'closed') conds.push(eq(T.status, 'CLOSED'));
  if (q.amcosId) conds.push(eq(T.amcosId, q.amcosId));
  if (q.q) {
    const n = Number(q.q.replace(/^TK-?/i, ''));
    conds.push(Number.isInteger(n) && n > 0 ? sql`(${T.ticketNo} = ${n} or ${T.subject} ilike ${'%' + q.q + '%'})` : sql`(${T.subject} ilike ${'%' + q.q + '%'} or ${AM.name} ilike ${'%' + q.q + '%'})`);
  }
  const assignee = sql<string | null>`(select full_name from users where id = ${T.assignedToId})`;
  const rows = await db.select({
    id: T.id, ticketNo: T.ticketNo, subject: T.subject, category: T.category, priority: T.priority, status: T.status,
    createdAt: T.createdAt, dueAt: T.dueAt, firstResponseAt: T.firstResponseAt, lastAmcosAt: T.lastAmcosAt, lastPlatformAt: T.lastPlatformAt,
    amcosId: T.amcosId, amcosName: AM.name, createdBy: U.fullName, createdByRole: U.role, assignedToId: T.assignedToId, assignee,
    overdue: overdueSql, waiting: waitingSql,
  }).from(T).innerJoin(AM, eq(AM.id, T.amcosId)).innerJoin(U, eq(U.id, T.createdById))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      sql`case when ${T.status} = 'CLOSED' then 1 else 0 end`,
      sql`case ${T.priority} when 'URGENT' then 0 when 'HIGH' then 1 else 2 end`,
      sql`case when ${T.firstResponseAt} is null then ${T.dueAt} end asc nulls last`,
      desc(T.lastAmcosAt),
    ).limit(300);
  res.json({ data: rows.map((r) => ({ ...r, number: ticketNo(r.ticketNo) })) });
}));

/** Wafanyakazi wa DUKALANGU wanaoweza kupewa tiketi */
async function assignees() {
  const rows = await db.select({ id: U.id, fullName: U.fullName, role: U.role, permissions: U.permissions })
    .from(U).where(and(inArray(U.role, PLATFORM_ROLES), eq(U.isActive, true))).orderBy(asc(U.fullName));
  return rows.filter((u) => effectivePermissions(u.role, u.permissions).includes('support.manage')).map(({ id, fullName, role }) => ({ id, fullName, role }));
}
ownerSupportRouter.get('/assignees', requirePermission('support.read'), ah(async (_req, res) => { res.json({ data: await assignees() }); }));

async function findTicket(id: string) {
  const [t] = await db.select().from(T).where(eq(T.id, id));
  if (!t) throw notFound('Tiketi');
  return t;
}

ownerSupportRouter.get('/tickets/:id', requirePermission('support.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const t = await findTicket(id);
  const msgs = await db.select({ id: M.id, side: M.side, internal: M.internal, body: M.body, createdAt: M.createdAt, author: U.fullName, authorRole: U.role })
    .from(M).innerJoin(U, eq(U.id, M.authorId)).where(eq(M.ticketId, id)).orderBy(asc(M.createdAt));
  const att = await attachmentsOf(db, msgs.map((m) => m.id));
  const [a] = await db.select({ id: AM.id, name: AM.name, code: AM.code, phone: AM.phone }).from(AM).where(eq(AM.id, t.amcosId));
  const [by] = await db.select({ fullName: U.fullName, role: U.role, phone: U.phone }).from(U).where(eq(U.id, t.createdById));
  const [{ others }] = await db.select({ others: sql<number>`count(*)::int` }).from(T).where(and(eq(T.amcosId, t.amcosId), sql`${T.id} <> ${id}`));
  res.json({
    ticket: { ...t, number: ticketNo(t.ticketNo), overdue: !t.firstResponseAt && t.status !== 'CLOSED' && t.dueAt < new Date() },
    amcos: a, createdBy: by, otherTickets: others,
    messages: msgs.map((m) => ({ ...m, attachments: att.get(m.id) ?? [] })),
  });
}));

ownerSupportRouter.post('/tickets/:id/messages', requirePermission('support.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({ body: bodySchema, internal: z.boolean().default(false), attachments: attachmentsSchema }).parse(req.body);
  const t = await findTicket(id);
  const now = new Date();
  await db.transaction(async (tx) => {
    const [m] = await tx.insert(M).values({ ticketId: id, authorId: req.auth!.userId, side: 'PLATFORM', internal: b.internal, body: b.body }).returning();
    await saveAttachments(tx, id, m.id, b.attachments);
    if (!b.internal) {
      // jibu kwa chama: muda wa jibu la kwanza unarekodiwa; tiketi inasubiri chama
      await tx.update(T).set({
        lastPlatformAt: now, firstResponseAt: t.firstResponseAt ?? now,
        status: t.status === 'CLOSED' ? 'CLOSED' : 'ANSWERED',
        assignedToId: t.assignedToId ?? req.auth!.userId,
      }).where(eq(T.id, id));
    }
  });
  res.status(201).json({ ok: true });
}));

const PRIORITY = ['URGENT', 'HIGH', 'NORMAL'] as const;
ownerSupportRouter.patch('/tickets/:id', requirePermission('support.manage'), ah(async (req: Request, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED']).optional(),
    priority: z.enum(PRIORITY).optional(),
    assignedToId: z.string().uuid().nullable().optional(),
  }).parse(req.body);
  const t = await findTicket(id);
  if (b.assignedToId && !(await assignees()).some((u) => u.id === b.assignedToId)) throw badRequest('Mfanyakazi huyu hana ruhusa ya kushughulikia tiketi');
  const set: Partial<typeof T.$inferInsert> = {};
  if (b.status && b.status !== t.status) {
    set.status = b.status;
    if (b.status === 'CLOSED') { set.closedAt = new Date(); set.closedById = req.auth!.userId; }
    else if (t.status === 'CLOSED') { set.closedAt = null; set.closedById = null; }
  }
  // kipaumbele kikibadilika kabla ya jibu la kwanza, muda wa jibu unahesabiwa upya kuanzia tiketi ilipofunguliwa
  if (b.priority && b.priority !== t.priority) { set.priority = b.priority; if (!t.firstResponseAt) set.dueAt = dueFrom(t.createdAt, b.priority); }
  if (b.assignedToId !== undefined && b.assignedToId !== t.assignedToId) set.assignedToId = b.assignedToId;
  if (!Object.keys(set).length) return res.json({ ok: true });
  await db.update(T).set(set).where(eq(T.id, id));
  await audit(db, req, { action: 'SUPPORT_TICKET_UPDATE', entity: 'support_ticket', entityId: id, amcosId: t.amcosId,
    before: { status: t.status, priority: t.priority, assignedToId: t.assignedToId }, after: b });
  res.json({ ok: true });
}));

ownerSupportRouter.get('/attachments/:id', requirePermission('support.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [a] = await db.select({ mimeType: A.mimeType, data: A.data }).from(A).where(eq(A.id, id));
  if (!a) throw notFound('Picha');
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(a.data, 'base64'));
}));
