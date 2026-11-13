// =====================================================================
//  LEADS / CRM (v0.36) — Huduma kwa Wateja na Masoko
//   Kila ombi la maonyesho kutoka tovuti (na lead inayoongezwa kwa mkono) inafuatiliwa hatua kwa hatua:
//   NEW -> CONTACTED -> DEMO_SCHEDULED -> DEMO_DONE -> NEGOTIATION -> WON (chama kimesajiliwa) / LOST (na sababu)
//   Historia (simu, vikao, SMS, mabadiliko) haifutwi. Safu ya zamani `status` inafuata hatua (kwa uoanifu).
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { effectivePermissions, PLATFORM_ROLES } from '../../lib/permissions';
import { sendSms } from '../../lib/notify';

export const leadsRouter = Router();
const L = schema.demoRequests;
const A = schema.leadActivities;
const U = schema.users;
type Stage = (typeof schema.leadStageEnum.enumValues)[number];
const OPEN: Stage[] = ['NEW', 'CONTACTED', 'DEMO_SCHEDULED', 'DEMO_DONE', 'NEGOTIATION'];
export const STAGE_LABEL: Record<Stage, string> = {
  NEW: 'Mpya', CONTACTED: 'Amepigiwa', DEMO_SCHEDULED: 'Demo imepangwa', DEMO_DONE: 'Demo imefanyika', NEGOTIATION: 'Mazungumzo', WON: 'Amekuwa mteja', LOST: 'Amepotea',
};
const legacyStatus = (s: Stage) => (s === 'NEW' ? 'NEW' : s === 'WON' || s === 'LOST' ? 'CLOSED' : 'CONTACTED');
const endOfToday = () => sql`(date_trunc('day', now() at time zone 'Africa/Dar_es_Salaam') + interval '1 day') at time zone 'Africa/Dar_es_Salaam'`;

/** Wafanyakazi wanaoweza kupewa leads (wenye leads.manage, walio hai). */
async function team() {
  const rows = await db.select({ id: U.id, fullName: U.fullName, role: U.role, permissions: U.permissions })
    .from(U).where(and(inArray(U.role, PLATFORM_ROLES), eq(U.isActive, true))).orderBy(asc(U.fullName));
  return rows.filter((u) => effectivePermissions(u.role, u.permissions).includes('leads.manage')).map(({ id, fullName, role }) => ({ id, fullName, role }));
}
async function assertAssignee(id: string | null | undefined) {
  if (!id) return;
  if (!(await team()).some((u) => u.id === id)) throw badRequest('Mfanyakazi huyu hana ruhusa ya kusimamia leads');
}
async function findLead(id: string) {
  const [l] = await db.select().from(L).where(eq(L.id, id));
  if (!l) throw notFound('Lead');
  return l;
}
async function log(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], req: Request, leadId: string, kind: (typeof schema.leadActivityKindEnum.enumValues)[number], body: string, meta?: object) {
  await tx.insert(A).values({ leadId, kind, body, meta: meta ?? null, createdById: req.auth!.userId });
}

const leadCols = {
  l: L, assignee: U.fullName,
  activities: sql<number>`(select count(*)::int from lead_activities x where x.lead_id = ${L.id})`,
  lastActivityAt: sql<string | null>`(select max(x.created_at) from lead_activities x where x.lead_id = ${L.id})`,
};
const clean = <T extends { ip?: unknown }>(l: T) => { const { ip: _ip, ...rest } = l; return rest; };

leadsRouter.get('/', requirePermission('leads.read'), ah(async (req, res) => {
  const q = z.object({
    stage: z.enum([...schema.leadStageEnum.enumValues, 'OPEN'] as [string, ...string[]]).optional(),
    assigned: z.string().optional(),            // me | none | <uuid>
    due: z.enum(['1']).optional(),              // wanaopaswa kupigiwa leo au wamechelewa
    source: z.enum(schema.leadSourceEnum.enumValues).optional(),
    q: z.string().trim().max(60).optional(),
  }).parse(req.query);
  const conds: (SQL | undefined)[] = [];
  if (q.stage === 'OPEN') conds.push(inArray(L.stage, OPEN)); else if (q.stage) conds.push(eq(L.stage, q.stage as Stage));
  if (q.assigned === 'me') conds.push(eq(L.assignedToId, req.auth!.userId));
  else if (q.assigned === 'none') conds.push(isNull(L.assignedToId));
  else if (q.assigned && /^[0-9a-f-]{36}$/.test(q.assigned)) conds.push(eq(L.assignedToId, q.assigned));
  if (q.due) conds.push(inArray(L.stage, OPEN), sql`${L.nextFollowUpAt} < ${endOfToday()}`);
  if (q.source) conds.push(eq(L.source, q.source));
  if (q.q) conds.push(or(ilike(L.name, `%${q.q}%`), ilike(L.amcosName, `%${q.q}%`), ilike(L.phone, `%${q.q.replace(/^0/, '')}%`), ilike(L.region, `%${q.q}%`)));
  const rows = await db.select(leadCols).from(L).leftJoin(U, eq(U.id, L.assignedToId)).where(and(...conds))
    .orderBy(sql`${L.nextFollowUpAt} asc nulls last`, desc(L.createdAt)).limit(500);
  res.json({ data: rows.map((r) => ({ ...clean(r.l), assignee: r.assignee, activities: r.activities, lastActivityAt: r.lastActivityAt })) });
}));

leadsRouter.get('/summary', requirePermission('leads.read'), ah(async (req, res) => {
  const me = req.auth!.userId;
  const [s] = (await db.execute<Record<string, number | string | null>>(sql`select
      count(*) filter (where stage = 'NEW')::int as new, count(*) filter (where stage = 'NEW' and assigned_to_id is null)::int as unassigned,
      count(*) filter (where stage in ('NEW','CONTACTED','DEMO_SCHEDULED','DEMO_DONE','NEGOTIATION'))::int as open,
      count(*) filter (where stage in ('NEW','CONTACTED','DEMO_SCHEDULED','DEMO_DONE','NEGOTIATION') and assigned_to_id = ${me})::int as mine,
      count(*) filter (where stage in ('NEW','CONTACTED','DEMO_SCHEDULED','DEMO_DONE','NEGOTIATION') and next_follow_up_at < ${endOfToday()})::int as due,
      count(*) filter (where stage in ('NEW','CONTACTED','DEMO_SCHEDULED','DEMO_DONE','NEGOTIATION') and next_follow_up_at < now() - interval '1 day')::int as overdue,
      count(*) filter (where stage = 'WON' and won_at > now() - interval '90 days')::int as won90,
      count(*) filter (where stage = 'LOST' and coalesce(updated_at, created_at) > now() - interval '90 days')::int as lost90,
      count(*) filter (where created_at > now() - interval '30 days')::int as created30,
      round(avg(extract(epoch from (won_at - created_at)) / 86400) filter (where stage = 'WON' and won_at > now() - interval '180 days'))::int as days_to_win
    from demo_requests`)).rows;
  const byStage = (await db.execute<{ stage: Stage; n: number }>(sql`select stage, count(*)::int as n from demo_requests group by stage`)).rows;
  const bySource = (await db.execute<{ source: string; n: number; won: number }>(sql`select source, count(*)::int as n,
    count(*) filter (where stage = 'WON')::int as won from demo_requests where created_at > now() - interval '180 days' group by source order by n desc`)).rows;
  const won = Number(s.won90), lost = Number(s.lost90);
  res.json({ ...s, conversion90: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null, byStage, bySource, stages: STAGE_LABEL });
}));

leadsRouter.get('/team', requirePermission('leads.read'), ah(async (_req, res) => { res.json({ data: await team() }); }));

const leadBody = z.object({
  name: z.string().trim().min(3, 'Andika jina la mhusika').max(80),
  phone: phoneSchema,
  amcosName: z.string().trim().min(3, 'Andika jina la chama').max(120),
  region: z.string().trim().max(80).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  email: z.union([z.literal(''), z.string().trim().email('Email si sahihi')]).nullable().optional().transform((v) => v || null),
  members: z.number().int().min(1).max(200000).nullable().optional(),
  source: z.enum(schema.leadSourceEnum.enumValues).optional(),
  message: z.string().trim().max(600).nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
});

leadsRouter.post('/', requirePermission('leads.manage'), ah(async (req, res) => {
  const b = leadBody.parse(req.body);
  const assignedToId = b.assignedToId === undefined ? req.auth!.userId : b.assignedToId;
  await assertAssignee(assignedToId);
  const dup = await db.query.demoRequests.findFirst({ where: and(eq(L.phone, b.phone), inArray(L.stage, OPEN)) });
  if (dup) throw conflict(`Lead ya namba hii tayari ipo na inafuatiliwa: ${dup.amcosName}`);
  const lead = await db.transaction(async (tx) => {
    const [l] = await tx.insert(L).values({
      name: b.name, phone: b.phone, amcosName: b.amcosName, region: b.region ?? null, district: b.district ?? null, email: b.email,
      members: b.members ?? null, source: b.source ?? 'PHONE', message: b.message ?? null, assignedToId,
      nextFollowUpAt: b.nextFollowUpAt ? new Date(b.nextFollowUpAt) : null, createdById: req.auth!.userId, updatedAt: new Date(),
    }).returning();
    await log(tx, req, l.id, 'NOTE', 'Lead imeongezwa kwenye mfumo');
    await audit(tx, req, { action: 'LEAD_CREATE', entity: 'Lead', entityId: l.id, after: clean(l) });
    return l;
  });
  res.status(201).json({ lead: clean(lead) });
}));

leadsRouter.get('/:id', requirePermission('leads.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [r] = await db.select(leadCols).from(L).leftJoin(U, eq(U.id, L.assignedToId)).where(eq(L.id, id));
  if (!r) throw notFound('Lead');
  const acts = await db.select({ a: A, by: U.fullName }).from(A).leftJoin(U, eq(U.id, A.createdById)).where(eq(A.leadId, id)).orderBy(desc(A.createdAt)).limit(200);
  const amcos = r.l.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, r.l.amcosId), columns: { id: true, name: true, code: true, status: true } }) : null;
  res.json({ lead: { ...clean(r.l), assignee: r.assignee }, activities: acts.map((x) => ({ ...x.a, by: x.by ?? 'Tovuti' })), amcos, stages: STAGE_LABEL });
}));

leadsRouter.patch('/:id', requirePermission('leads.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = leadBody.partial().extend({
    stage: z.enum(schema.leadStageEnum.enumValues).optional(),
    lostReason: z.string().trim().min(3, 'Andika sababu').max(300).optional(),
  }).parse(req.body);
  const before = await findLead(id);
  if (b.stage === 'WON') throw badRequest('Lead inakuwa mteja kwa kusajili chama (kitufe "Sajili chama")');
  if (b.stage === 'LOST' && !b.lostReason) throw badRequest('Andika sababu ya kupotea kwa lead hii');
  if (before.stage === 'WON' && b.stage) throw conflict('Lead hii imeshakuwa mteja');
  if (b.assignedToId !== undefined) await assertAssignee(b.assignedToId);
  const patch: Partial<typeof L.$inferInsert> = {
    ...(b.name !== undefined ? { name: b.name } : {}), ...(b.phone !== undefined ? { phone: b.phone } : {}),
    ...(b.amcosName !== undefined ? { amcosName: b.amcosName } : {}), ...(b.region !== undefined ? { region: b.region } : {}),
    ...(b.district !== undefined ? { district: b.district } : {}), ...(b.email !== undefined ? { email: b.email } : {}),
    ...(b.members !== undefined ? { members: b.members } : {}), ...(b.source !== undefined ? { source: b.source } : {}),
    ...(b.assignedToId !== undefined ? { assignedToId: b.assignedToId } : {}),
    ...(b.nextFollowUpAt !== undefined ? { nextFollowUpAt: b.nextFollowUpAt ? new Date(b.nextFollowUpAt) : null } : {}),
    ...(b.stage ? { stage: b.stage, status: legacyStatus(b.stage), lostReason: b.stage === 'LOST' ? b.lostReason! : null, handledById: req.auth!.userId, handledAt: new Date() } : {}),
    ...(b.stage === 'LOST' ? { nextFollowUpAt: null } : {}),
    updatedAt: new Date(),
  };
  const row = await db.transaction(async (tx) => {
    const [l] = await tx.update(L).set(patch).where(eq(L.id, id)).returning();
    if (b.stage && b.stage !== before.stage) {
      await log(tx, req, id, 'STAGE', `${STAGE_LABEL[before.stage]} → ${STAGE_LABEL[b.stage]}${b.stage === 'LOST' ? ` (${b.lostReason})` : ''}`, { from: before.stage, to: b.stage });
    }
    if (b.assignedToId !== undefined && b.assignedToId !== before.assignedToId) {
      const who = b.assignedToId ? (await tx.query.users.findFirst({ where: eq(U.id, b.assignedToId), columns: { fullName: true } }))?.fullName : null;
      await log(tx, req, id, 'ASSIGN', who ? `Amepewa ${who}` : 'Ameondolewa mhusika', { to: b.assignedToId });
    }
    await audit(tx, req, { action: 'LEAD_UPDATE', entity: 'Lead', entityId: id, before: clean(before), after: clean(l) });
    return l;
  });
  res.json({ lead: clean(row) });
}));

leadsRouter.post('/:id/activities', requirePermission('leads.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({
    kind: z.enum(['NOTE', 'CALL', 'MEETING']),
    body: z.string().trim().min(2, 'Andika maelezo').max(1000),
    nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  }).parse(req.body);
  const l = await findLead(id);
  if (l.stage === 'WON' || l.stage === 'LOST') {
    if (b.kind !== 'NOTE') throw badRequest('Lead hii imefungwa — unaweza kuongeza maelezo tu');
  }
  await db.transaction(async (tx) => {
    await log(tx, req, id, b.kind, b.body);
    const autoContact = l.stage === 'NEW' && (b.kind === 'CALL' || b.kind === 'MEETING');
    await tx.update(L).set({
      updatedAt: new Date(),
      ...(b.nextFollowUpAt !== undefined ? { nextFollowUpAt: b.nextFollowUpAt ? new Date(b.nextFollowUpAt) : null } : {}),
      ...(autoContact ? { stage: 'CONTACTED', status: 'CONTACTED', handledById: req.auth!.userId, handledAt: new Date() } : {}),
      ...(!l.assignedToId ? { assignedToId: req.auth!.userId } : {}),
    }).where(eq(L.id, id));
    if (autoContact) await log(tx, req, id, 'STAGE', `${STAGE_LABEL.NEW} → ${STAGE_LABEL.CONTACTED}`, { from: 'NEW', to: 'CONTACTED', auto: true });
  });
  res.status(201).json({ ok: true });
}));

leadsRouter.post('/:id/sms', requirePermission('leads.manage'), ah(async (req, res) => {
  if (!req.auth!.permissions.includes('comms.send')) throw forbidden('Huna ruhusa ya kutuma SMS');
  const { id } = uuidParam.parse(req.params);
  const { body } = z.object({ body: z.string().trim().min(5, 'Ujumbe ni mfupi mno').max(300) }).parse(req.body);
  const l = await findLead(id);
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from lead_activities where lead_id = ${id} and kind = 'SMS' and created_at > now() - interval '24 hours'`)).rows;
  if (n >= 3) throw badRequest('SMS 3 zimeshatumwa kwa lead hii ndani ya saa 24 — mpigie simu badala yake');
  const r = await sendSms(l.phone, `CoopLink: ${body}`, 'OWNER_ANNOUNCEMENT');
  await db.transaction(async (tx) => {
    await log(tx, req, id, 'SMS', body, { status: r.status, error: r.error ?? null });
    await tx.update(L).set({ updatedAt: new Date() }).where(eq(L.id, id));
  });
  if (r.status === 'FAILED' || r.status === 'SKIPPED') throw badRequest(`SMS haikutumwa: ${r.error ?? 'hitilafu ya mtoa huduma'}`);
  res.status(201).json({ status: r.status });
}));

/** Lead imekuwa mteja: inaunganishwa na chama kilichosajiliwa (kupitia AMCOS Management). */
leadsRouter.post('/:id/convert', requirePermission('leads.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { amcosId } = z.object({ amcosId: z.string().uuid() }).parse(req.body);
  const l = await findLead(id);
  if (l.stage === 'WON') throw conflict('Lead hii imeshakuwa mteja');
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { id: true, name: true } });
  if (!a) throw notFound('Chama');
  const other = await db.query.demoRequests.findFirst({ where: and(eq(L.amcosId, amcosId), eq(L.stage, 'WON')) });
  if (other) throw conflict(`Chama hiki tayari kimeunganishwa na lead nyingine (${other.name})`);
  const row = await db.transaction(async (tx) => {
    const [x] = await tx.update(L).set({ stage: 'WON', status: 'CLOSED', amcosId, wonAt: new Date(), nextFollowUpAt: null, lostReason: null,
      handledById: req.auth!.userId, handledAt: new Date(), updatedAt: new Date() }).where(eq(L.id, id)).returning();
    await log(tx, req, id, 'STAGE', `${STAGE_LABEL[l.stage]} → ${STAGE_LABEL.WON}: ${a.name}`, { from: l.stage, to: 'WON', amcosId });
    await audit(tx, req, { action: 'LEAD_WON', entity: 'Lead', entityId: id, amcosId, after: { amcosId, amcosName: a.name } });
    return x;
  });
  res.json({ lead: clean(row) });
}));
