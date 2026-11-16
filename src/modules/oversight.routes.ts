// =====================================================================
//  USIMAMIZI WA SERIKALI (v0.43) — Afisa Ushirika wa Wilaya na wakaguzi wake (hadi 5, nguvu sawa)
//   Afisa (oversight.manage):  dashibodi ya wilaya, ukaguzi + hoja, maagizo rasmi, zuio la malipo
//   Chama (oversight.respond): kujibu hoja, kuthibitisha kupokea agizo, kuripoti utekelezaji
//   Kila hatua inarekodiwa (audit) na viongozi wa chama wanapata SMS (Sender ID: COOPLINK).
//   Afisa haandiki data za chama — anaelekeza kwa hoja na maagizo (officerGuard inazuia mengine yote).
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { ah, uuidParam } from '../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { requireAmcosPerm, requireReauth } from '../middleware/auth';
import { amcosScope, canAccessAmcos, districtAmcosIds } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { nextNumber, pad } from '../lib/counter';
import { enqueue } from '../lib/sms';
import { activeHold } from '../lib/holds';

export const oversightRouter = Router();
const I = schema.oversightInspections, F = schema.oversightFindings, DR = schema.oversightDirectives, H = schema.paymentHolds, A = schema.amcos;

export const SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const AREAS = ['FINANCE', 'MEMBERS', 'SALES', 'INPUTS', 'STORE', 'GOVERNANCE', 'OTHER'] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isOfficer = (req: Request) => req.auth!.role === 'COOP_OFFICER';
const userName = (col: unknown) => sql<string | null>`(select u.full_name from users u where u.id = ${col})`;

async function officerAmcos(req: Request, amcosId: string) {
  if (!(await canAccessAmcos(req, amcosId))) throw forbidden('Chama hiki hakiko kwenye wilaya yako');
  const a = await db.query.amcos.findFirst({ where: eq(A.id, amcosId) });
  if (!a) throw notFound('Chama');
  return a;
}

/** SMS kwa viongozi wa chama (Meneja; na Mhasibu kwa mambo ya fedha) */
async function notifyLeaders(tx: DbOrTx, amcosId: string, text: string, opts: { accountants?: boolean; refType: string; refId: string } ) {
  const roles: ('AMCOS_ADMIN' | 'ACCOUNTANT')[] = opts.accountants ? ['AMCOS_ADMIN', 'ACCOUNTANT'] : ['AMCOS_ADMIN'];
  const us = await tx.select({ id: schema.users.id, phone: schema.users.phone }).from(schema.users)
    .where(and(eq(schema.users.amcosId, amcosId), inArray(schema.users.role, roles), eq(schema.users.isActive, true)));
  if (!us.length) return 0;
  return enqueue(tx, us.map((u) => ({ kind: 'OVERSIGHT_NOTICE' as const, phone: u.phone, userId: u.id, amcosId, text, referenceType: opts.refType, referenceId: opts.refId })));
}

// ------------------------------ DASHIBODI YA WILAYA ------------------------------
oversightRouter.get('/overview', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const j = req.auth!.jurisdiction;
  const ids = (await districtAmcosIds(j)).map((x) => x.id);
  const officers = await db.select({ id: schema.users.id, fullName: schema.users.fullName, jobTitle: schema.users.jobTitle, lastLoginAt: schema.users.lastLoginAt })
    .from(schema.users).where(and(eq(schema.users.role, 'COOP_OFFICER'), eq(schema.users.isActive, true),
      sql`lower(trim(${schema.users.jurisdictionDistrict})) = lower(trim(${j?.district ?? ''}))`));
  if (!ids.length) return res.json({ jurisdiction: j, officers, amcos: [], totals: null });
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const rows = (await db.execute<Record<string, any>>(sql`
    select a.id, a.name, a.code, a.reg_number, a.ward, a.village, a.is_active,
      (select count(*)::int from members m where m.amcos_id = a.id and m.status = 'ACTIVE') as members,
      (select count(*)::int from users u where u.amcos_id = a.id and u.is_active) as staff,
      (select count(*)::int from approval_requests r where r.amcos_id = a.id and r.status = 'PENDING') as pending_approvals,
      (select count(*)::int from approval_requests r where r.amcos_id = a.id and r.status = 'PENDING' and r.created_at < now() - interval '7 days') as stale_approvals,
      (select max(b.statement_date) from bank_reconciliations b where b.amcos_id = a.id) as last_recon,
      locked_through(a.id) as locked_through,
      (select coalesce(sum(t.amount) filter (where t.direction = 'IN'), 0) from finance_transactions t where t.amcos_id = a.id and t.status = 'POSTED' and t.kind <> 'TRANSFER' and t.txn_date >= date_trunc('year', now())) as income_ytd,
      (select coalesce(sum(t.amount) filter (where t.direction = 'OUT'), 0) from finance_transactions t where t.amcos_id = a.id and t.status = 'POSTED' and t.kind <> 'TRANSFER' and t.txn_date >= date_trunc('year', now())) as spend_ytd,
      (select count(*)::int from finance_transactions t where t.amcos_id = a.id and t.status = 'POSTED' and t.direction = 'OUT' and t.kind in ('EXPENSE','FARMER_PAYMENT','SUPPLIER_PAYMENT') and t.approval_id is null) as unapproved_payments,
      (select count(*)::int from oversight_findings f where f.amcos_id = a.id and f.status in ('OPEN','RESPONDED','REOPENED')) as open_findings,
      (select count(*)::int from oversight_findings f where f.amcos_id = a.id and f.status in ('OPEN','REOPENED') and f.severity in ('HIGH','CRITICAL')) as serious_findings,
      (select count(*)::int from oversight_findings f where f.amcos_id = a.id and f.status in ('OPEN','REOPENED') and f.due_date < current_date) as overdue_findings,
      (select count(*)::int from oversight_directives d where d.amcos_id = a.id and d.status in ('SENT','ACKNOWLEDGED')) as open_directives,
      (select count(*)::int from oversight_directives d where d.amcos_id = a.id and d.status in ('SENT','ACKNOWLEDGED') and d.due_date < current_date) as overdue_directives,
      (select max(i.issued_at) from oversight_inspections i where i.amcos_id = a.id and i.status <> 'DRAFT') as last_inspection,
      (select h.placed_at from payment_holds h where h.amcos_id = a.id and h.lifted_at is null) as hold_since,
      (select max(l.created_at) from audit_logs l where l.amcos_id = a.id) as last_activity
    from amcos a where a.id in (${list}) order by a.name`)).rows;
  // Alama za hatari kwa kila chama (sababu zinaonyeshwa kwa afisa)
  const now = Date.now();
  const amcos = rows.map((r) => {
    const flags: { level: 'bad' | 'warn'; text: string }[] = [];
    if (r.hold_since) flags.push({ level: 'bad', text: 'Zuio la malipo liko hai' });
    if (Number(r.unapproved_payments)) flags.push({ level: 'bad', text: `Malipo ${r.unapproved_payments} yamekamilika bila idhini` });
    if (Number(r.serious_findings)) flags.push({ level: 'bad', text: `Hoja ${r.serious_findings} nzito hazijatatuliwa` });
    if (Number(r.overdue_findings)) flags.push({ level: 'warn', text: `Hoja ${r.overdue_findings} zimepita muda` });
    if (Number(r.overdue_directives)) flags.push({ level: 'warn', text: `Maagizo ${r.overdue_directives} yamepita muda` });
    if (!r.last_recon || now - new Date(String(r.last_recon)).getTime() > 62 * 864e5) flags.push({ level: 'warn', text: r.last_recon ? 'Usuluhishi wa benki umechelewa (> siku 60)' : 'Hakuna usuluhishi wa benki' });
    if (Number(r.stale_approvals)) flags.push({ level: 'warn', text: `Maombi ${r.stale_approvals} ya idhini > siku 7` });
    if (!r.last_inspection) flags.push({ level: 'warn', text: 'Hakijawahi kukaguliwa kwenye mfumo' });
    const score = flags.reduce((s, f) => s + (f.level === 'bad' ? 3 : 1), 0);
    return { ...r, flags, risk: score >= 3 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW' } as Record<string, any>;
  });
  const sum = (k: string) => amcos.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  res.json({
    jurisdiction: j, officers, amcos,
    totals: { amcos: amcos.length, members: sum('members'), openFindings: sum('open_findings'), seriousFindings: sum('serious_findings'), openDirectives: sum('open_directives'),
      holds: amcos.filter((r) => r.hold_since).length, highRisk: amcos.filter((r) => r.risk === 'HIGH').length, incomeYtd: sum('income_ytd'), spendYtd: sum('spend_ytd') },
  });
}));

/** Muhtasari (kengele / bango): afisa — wilaya; chama — chama chake */
oversightRouter.get('/summary', requireAmcosPerm('oversight.read'), ah(async (req, res) => {
  const scopeF = amcosScope(req, F.amcosId), scopeD = amcosScope(req, DR.amcosId), scopeH = amcosScope(req, H.amcosId);
  const [f] = await db.select({ open: sql<number>`count(*) filter (where ${F.status} in ('OPEN','REOPENED'))::int`, responded: sql<number>`count(*) filter (where ${F.status} = 'RESPONDED')::int` })
    .from(F).innerJoin(I, eq(I.id, F.inspectionId)).where(and(scopeF, sql`${I.status} <> 'DRAFT'`));
  const [d] = await db.select({ open: sql<number>`count(*) filter (where ${DR.status} = 'SENT')::int`, inProgress: sql<number>`count(*) filter (where ${DR.status} = 'ACKNOWLEDGED')::int`, complied: sql<number>`count(*) filter (where ${DR.status} = 'COMPLIED')::int` }).from(DR).where(scopeD);
  const holds = await db.select({ id: H.id, amcosId: H.amcosId, reason: H.reason, placedAt: H.placedAt, amcos: A.name, by: userName(H.placedById) })
    .from(H).innerJoin(A, eq(A.id, H.amcosId)).where(and(scopeH, isNull(H.liftedAt)));
  res.json({ findings: f, directives: d, holds });
}));

// ------------------------------ UKAGUZI NA HOJA ------------------------------
const inspBody = z.object({
  amcosId: z.string().uuid(), title: z.string().trim().min(5).max(160), kind: z.enum(['ROUTINE', 'SPECIAL', 'INVESTIGATION', 'FOLLOW_UP']),
  periodFrom: dateStr.nullable().optional(), periodTo: dateStr.nullable().optional(), summary: z.string().trim().max(4000).nullable().optional(),
});
const findingBody = z.object({
  area: z.enum(AREAS), title: z.string().trim().min(5).max(200), detail: z.string().trim().min(10).max(4000), severity: z.enum(SEVERITY),
  recommendation: z.string().trim().max(2000).nullable().optional(), dueDate: dateStr.nullable().optional(),
});

oversightRouter.get('/inspections', requireAmcosPerm('oversight.read'), ah(async (req, res) => {
  const q = z.object({ amcosId: z.string().uuid().optional(), status: z.enum(['DRAFT', 'ISSUED', 'CLOSED']).optional() }).parse(req.query);
  const rows = await db.select({
    i: I, amcos: A.name, code: A.code, by: userName(I.createdById),
    findings: sql<number>`(select count(*)::int from oversight_findings f where f.inspection_id = ${I.id})`,
    open: sql<number>`(select count(*)::int from oversight_findings f where f.inspection_id = ${I.id} and f.status <> 'RESOLVED')`,
    critical: sql<number>`(select count(*)::int from oversight_findings f where f.inspection_id = ${I.id} and f.status <> 'RESOLVED' and f.severity in ('HIGH','CRITICAL'))`,
  }).from(I).innerJoin(A, eq(A.id, I.amcosId)).where(and(amcosScope(req, I.amcosId), q.amcosId ? eq(I.amcosId, q.amcosId) : undefined, q.status ? eq(I.status, q.status) : undefined,
    isOfficer(req) ? undefined : sql`${I.status} <> 'DRAFT'`)).orderBy(desc(I.createdAt)).limit(200);
  res.json({ data: rows.map((r) => ({ ...r.i, amcosName: r.amcos, amcosCode: r.code, createdBy: r.by, findings: r.findings, open: r.open, critical: r.critical })) });
}));

oversightRouter.post('/inspections', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const b = inspBody.parse(req.body);
  const a = await officerAmcos(req, b.amcosId);
  const row = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, a.id, 'oversight_inspection');
    const [r] = await tx.insert(I).values({ ...b, periodFrom: b.periodFrom ?? null, periodTo: b.periodTo ?? null, summary: b.summary ?? null, inspNo: `UK-${a.code}-${pad(n, 4)}`, createdById: req.auth!.userId }).returning();
    await audit(tx, req, { action: 'OVERSIGHT_INSPECTION_CREATE', entity: 'OversightInspection', entityId: r.id, amcosId: a.id, after: r });
    return r;
  });
  res.status(201).json({ inspection: row });
}));

async function findInspection(req: Request, id: string) {
  const [r] = await db.select().from(I).where(and(eq(I.id, id), amcosScope(req, I.amcosId)));
  if (!r || (r.status === 'DRAFT' && !isOfficer(req))) throw notFound('Ukaguzi');
  return r;
}

oversightRouter.get('/inspections/:id', requireAmcosPerm('oversight.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const i = await findInspection(req, id);
  const a = await db.query.amcos.findFirst({ where: eq(A.id, i.amcosId) });
  const findings = await db.select({ f: F, respondedBy: userName(F.respondedById), resolvedBy: userName(F.resolvedById) }).from(F).where(eq(F.inspectionId, id)).orderBy(asc(F.findingNo));
  const [names] = await db.select({ createdBy: userName(I.createdById), issuedBy: userName(I.issuedById), closedBy: userName(I.closedById) }).from(I).where(eq(I.id, id));
  res.json({
    inspection: { ...i, ...names }, amcos: a && { id: a.id, name: a.name, code: a.code, regNumber: a.regNumber, region: a.region, district: a.district, ward: a.ward, village: a.village },
    findings: findings.map((r) => ({ ...r.f, respondedBy: r.respondedBy, resolvedBy: r.resolvedBy })),
    can: { manage: isOfficer(req) && i.status !== 'CLOSED', respond: !isOfficer(req) && req.auth!.amcosId === i.amcosId && i.status === 'ISSUED' },
  });
}));

oversightRouter.patch('/inspections/:id', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const i = await findInspection(req, id);
  if (i.status !== 'DRAFT') throw badRequest('Ukaguzi uliotolewa haubadilishwi — ongeza hoja au funga');
  const b = inspBody.omit({ amcosId: true }).partial().parse(req.body);
  const [r] = await db.update(I).set({ ...b, updatedAt: new Date() }).where(eq(I.id, id)).returning();
  await audit(db, req, { action: 'OVERSIGHT_INSPECTION_EDIT', entity: 'OversightInspection', entityId: id, amcosId: i.amcosId, before: i, after: r });
  res.json({ inspection: r });
}));

oversightRouter.post('/inspections/:id/findings', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const i = await findInspection(req, id);
  if (i.status === 'CLOSED') throw badRequest('Ukaguzi umefungwa');
  const b = findingBody.parse(req.body);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'insp:' + id}))`);
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${F.findingNo}), 0)::int` }).from(F).where(eq(F.inspectionId, id));
    const [f] = await tx.insert(F).values({ ...b, recommendation: b.recommendation ?? null, dueDate: b.dueDate ?? null, inspectionId: id, amcosId: i.amcosId, findingNo: n + 1 }).returning();
    await audit(tx, req, { action: 'OVERSIGHT_FINDING_ADD', entity: 'OversightFinding', entityId: f.id, amcosId: i.amcosId, after: f });
    if (i.status === 'ISSUED') await notifyLeaders(tx, i.amcosId, `CoopLink: Afisa Ushirika ameongeza hoja mpya #${f.findingNo} kwenye ukaguzi ${i.inspNo} (${b.severity}). Jibu kwenye mfumo: Ukaguzi na Maagizo.`, { accountants: b.area === 'FINANCE', refType: 'OversightFinding', refId: f.id });
    return f;
  });
  res.status(201).json({ finding: row });
}));

oversightRouter.post('/inspections/:id/issue', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const i = await findInspection(req, id);
  if (i.status !== 'DRAFT') throw badRequest('Ukaguzi huu tayari umetolewa');
  const [{ n, serious }] = await db.select({ n: sql<number>`count(*)::int`, serious: sql<number>`count(*) filter (where ${F.severity} in ('HIGH','CRITICAL'))::int` }).from(F).where(eq(F.inspectionId, id));
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.update(I).set({ status: 'ISSUED', issuedAt: new Date(), issuedById: req.auth!.userId, updatedAt: new Date() }).where(and(eq(I.id, id), eq(I.status, 'DRAFT'))).returning();
    if (!r) throw conflict('Ukaguzi umebadilishwa na mtu mwingine');
    await audit(tx, req, { action: 'OVERSIGHT_INSPECTION_ISSUE', entity: 'OversightInspection', entityId: id, amcosId: i.amcosId, after: { findings: n } });
    await notifyLeaders(tx, i.amcosId, `CoopLink: Ripoti ya ukaguzi ${i.inspNo} ("${i.title.slice(0, 60)}") imetolewa na Afisa Ushirika: hoja ${n}${serious ? ` (${serious} nzito)` : ''}. Jibu kila hoja kwenye mfumo ndani ya muda.`, { accountants: true, refType: 'OversightInspection', refId: id });
    return r;
  });
  res.json({ inspection: row });
}));

oversightRouter.post('/inspections/:id/close', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { conclusion } = z.object({ conclusion: z.string().trim().min(10, 'Andika hitimisho la ukaguzi') }).parse(req.body);
  const i = await findInspection(req, id);
  if (i.status !== 'ISSUED') throw badRequest('Ni ukaguzi uliotolewa tu unaofungwa');
  const [{ open }] = await db.select({ open: sql<number>`count(*) filter (where ${F.status} <> 'RESOLVED')::int` }).from(F).where(eq(F.inspectionId, id));
  if (open) throw badRequest(`Hoja ${open} bado hazijatatuliwa — zitatue kwanza`);
  const [r] = await db.update(I).set({ status: 'CLOSED', conclusion, closedAt: new Date(), closedById: req.auth!.userId, updatedAt: new Date() }).where(eq(I.id, id)).returning();
  await audit(db, req, { action: 'OVERSIGHT_INSPECTION_CLOSE', entity: 'OversightInspection', entityId: id, amcosId: i.amcosId, after: { conclusion } });
  res.json({ inspection: r });
}));

async function findFinding(req: Request, id: string) {
  const [r] = await db.select({ f: F, i: I }).from(F).innerJoin(I, eq(I.id, F.inspectionId)).where(and(eq(F.id, id), amcosScope(req, F.amcosId)));
  if (!r || (r.i.status === 'DRAFT' && !isOfficer(req))) throw notFound('Hoja');
  return r;
}

/** Chama kinajibu hoja (Meneja / Mhasibu) */
oversightRouter.post('/findings/:id/respond', requireAmcosPerm('oversight.respond'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { response } = z.object({ response: z.string().trim().min(10, 'Eleza hatua zilizochukuliwa (herufi 10+)').max(4000) }).parse(req.body);
  const { f, i } = await findFinding(req, id);
  if (req.auth!.amcosId !== f.amcosId) throw forbidden();
  if (i.status !== 'ISSUED') throw badRequest('Ukaguzi huu haupokei majibu');
  if (!['OPEN', 'REOPENED', 'RESPONDED'].includes(f.status)) throw badRequest('Hoja hii imeshatatuliwa');
  const [r] = await db.update(F).set({ status: 'RESPONDED', response, respondedById: req.auth!.userId, respondedAt: new Date(), updatedAt: new Date() }).where(eq(F.id, id)).returning();
  await audit(db, req, { action: 'OVERSIGHT_FINDING_RESPOND', entity: 'OversightFinding', entityId: id, amcosId: f.amcosId, before: { status: f.status }, after: { status: 'RESPONDED', response } });
  res.json({ finding: r });
}));

/** Afisa: kukubali majibu (imetatuliwa) au kurudisha (haijatosheleza) */
oversightRouter.post('/findings/:id/review', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({ decision: z.enum(['RESOLVED', 'REOPENED']), note: z.string().trim().min(5, 'Andika maoni').max(2000), dueDate: dateStr.nullable().optional() }).parse(req.body);
  const { f, i } = await findFinding(req, id);
  if (i.status === 'CLOSED') throw badRequest('Ukaguzi umefungwa');
  if (f.status === 'RESOLVED' && b.decision === 'RESOLVED') throw badRequest('Tayari imetatuliwa');
  const r = await db.transaction(async (tx) => {
    const [x] = await tx.update(F).set({ status: b.decision, resolutionNote: b.note, resolvedById: req.auth!.userId, resolvedAt: b.decision === 'RESOLVED' ? new Date() : null,
      ...(b.dueDate ? { dueDate: b.dueDate } : {}), updatedAt: new Date() }).where(eq(F.id, id)).returning();
    await audit(tx, req, { action: `OVERSIGHT_FINDING_${b.decision}`, entity: 'OversightFinding', entityId: id, amcosId: f.amcosId, before: { status: f.status }, after: { status: b.decision, note: b.note } });
    if (b.decision === 'REOPENED') await notifyLeaders(tx, f.amcosId, `CoopLink: Hoja #${f.findingNo} ya ukaguzi ${i.inspNo} imerudishwa na Afisa Ushirika: ${b.note.slice(0, 90)}`, { refType: 'OversightFinding', refId: id, accountants: f.area === 'FINANCE' });
    return x;
  });
  res.json({ finding: r });
}));

// ------------------------------ MAAGIZO RASMI ------------------------------
oversightRouter.get('/directives', requireAmcosPerm('oversight.read'), ah(async (req, res) => {
  const q = z.object({ amcosId: z.string().uuid().optional(), status: z.string().optional() }).parse(req.query);
  const rows = await db.select({ d: DR, amcos: A.name, code: A.code, by: userName(DR.issuedById), ackBy: userName(DR.ackById), compliedBy: userName(DR.compliedById) })
    .from(DR).innerJoin(A, eq(A.id, DR.amcosId))
    .where(and(amcosScope(req, DR.amcosId), q.amcosId ? eq(DR.amcosId, q.amcosId) : undefined, q.status ? eq(DR.status, q.status) : undefined))
    .orderBy(desc(DR.createdAt)).limit(300);
  res.json({ data: rows.map((r) => ({ ...r.d, amcosName: r.amcos, amcosCode: r.code, issuedBy: r.by, ackBy: r.ackBy, compliedBy: r.compliedBy })),
    can: { manage: isOfficer(req), respond: !isOfficer(req) && !!req.auth!.amcosId } });
}));

/** Agizo moja kwa chama kimoja au vingi (mf. agizo kwa vyama vyote vya wilaya) */
oversightRouter.post('/directives', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const b = z.object({
    amcosIds: z.array(z.string().uuid()).min(1).max(200), subject: z.string().trim().min(5).max(160), body: z.string().trim().min(10).max(6000),
    priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'), dueDate: dateStr.nullable().optional(),
  }).parse(req.body);
  const list: (typeof schema.amcos.$inferSelect)[] = [];
  for (const id of [...new Set(b.amcosIds)]) list.push(await officerAmcos(req, id));
  const rows = await db.transaction(async (tx) => {
    const out = [];
    for (const a of list) {
      const n = await nextNumber(tx, a.id, 'oversight_directive');
      const [d] = await tx.insert(DR).values({ amcosId: a.id, dirNo: `AG-${a.code}-${pad(n, 4)}`, subject: b.subject, body: b.body, priority: b.priority, dueDate: b.dueDate ?? null, issuedById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'OVERSIGHT_DIRECTIVE_ISSUE', entity: 'OversightDirective', entityId: d.id, amcosId: a.id, after: d });
      await notifyLeaders(tx, a.id, `CoopLink: ${b.priority === 'URGENT' ? 'AGIZO LA HARAKA' : 'Agizo'} ${d.dirNo} kutoka Afisa Ushirika: "${b.subject.slice(0, 70)}"${b.dueDate ? `, litekelezwe kabla ya ${b.dueDate}` : ''}. Thibitisha kupokea kwenye mfumo.`, { refType: 'OversightDirective', refId: d.id });
      out.push(d);
    }
    return out;
  });
  res.status(201).json({ directives: rows });
}));

async function findDirective(req: Request, id: string) {
  const [d] = await db.select().from(DR).where(and(eq(DR.id, id), amcosScope(req, DR.amcosId)));
  if (!d) throw notFound('Agizo');
  return d;
}
/** Chama: kuthibitisha kupokea, kisha kuripoti utekelezaji */
oversightRouter.post('/directives/:id/ack', requireAmcosPerm('oversight.respond'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const d = await findDirective(req, id);
  if (req.auth!.amcosId !== d.amcosId) throw forbidden();
  if (d.status !== 'SENT') throw badRequest('Agizo hili tayari limethibitishwa');
  const [r] = await db.update(DR).set({ status: 'ACKNOWLEDGED', ackById: req.auth!.userId, ackAt: new Date(), updatedAt: new Date() }).where(eq(DR.id, id)).returning();
  await audit(db, req, { action: 'OVERSIGHT_DIRECTIVE_ACK', entity: 'OversightDirective', entityId: id, amcosId: d.amcosId });
  res.json({ directive: r });
}));
oversightRouter.post('/directives/:id/comply', requireAmcosPerm('oversight.respond'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { note } = z.object({ note: z.string().trim().min(10, 'Eleza utekelezaji (herufi 10+)').max(4000) }).parse(req.body);
  const d = await findDirective(req, id);
  if (req.auth!.amcosId !== d.amcosId) throw forbidden();
  if (!['SENT', 'ACKNOWLEDGED'].includes(d.status)) throw badRequest('Agizo hili haliko wazi');
  const [r] = await db.update(DR).set({ status: 'COMPLIED', complianceNote: note, compliedById: req.auth!.userId, compliedAt: new Date(), ackById: d.ackById ?? req.auth!.userId, ackAt: d.ackAt ?? new Date(), updatedAt: new Date() }).where(eq(DR.id, id)).returning();
  await audit(db, req, { action: 'OVERSIGHT_DIRECTIVE_COMPLY', entity: 'OversightDirective', entityId: id, amcosId: d.amcosId, after: { note } });
  res.json({ directive: r });
}));
/** Afisa: kufunga (utekelezaji umekubaliwa), kurudisha, au kufuta agizo */
oversightRouter.post('/directives/:id/review', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = z.object({ decision: z.enum(['CLOSED', 'REOPEN', 'WITHDRAWN']), note: z.string().trim().min(5).max(2000) }).parse(req.body);
  const d = await findDirective(req, id);
  if (['CLOSED', 'WITHDRAWN'].includes(d.status)) throw badRequest('Agizo hili limeshafungwa');
  if (b.decision === 'CLOSED' && d.status !== 'COMPLIED') throw badRequest('Agizo linafungwa baada ya chama kuripoti utekelezaji');
  const status = b.decision === 'REOPEN' ? 'ACKNOWLEDGED' : b.decision;
  const r = await db.transaction(async (tx) => {
    const [x] = await tx.update(DR).set({ status, closeNote: b.note, ...(b.decision === 'REOPEN' ? {} : { closedById: req.auth!.userId, closedAt: new Date() }), updatedAt: new Date() }).where(eq(DR.id, id)).returning();
    await audit(tx, req, { action: `OVERSIGHT_DIRECTIVE_${b.decision}`, entity: 'OversightDirective', entityId: id, amcosId: d.amcosId, after: { note: b.note } });
    if (b.decision === 'REOPEN') await notifyLeaders(tx, d.amcosId, `CoopLink: Utekelezaji wa agizo ${d.dirNo} haujakamilika kwa mujibu wa Afisa Ushirika: ${b.note.slice(0, 90)}`, { refType: 'OversightDirective', refId: id });
    return x;
  });
  res.json({ directive: r });
}));

// ------------------------------ ZUIO LA MALIPO ------------------------------
oversightRouter.get('/holds', requireAmcosPerm('oversight.read'), ah(async (req, res) => {
  const rows = await db.select({ h: H, amcos: A.name, code: A.code, placedBy: userName(H.placedById), liftedBy: userName(H.liftedById) })
    .from(H).innerJoin(A, eq(A.id, H.amcosId)).where(amcosScope(req, H.amcosId)).orderBy(desc(H.placedAt)).limit(200);
  res.json({ data: rows.map((r) => ({ ...r.h, amcosName: r.amcos, amcosCode: r.code, placedBy: r.placedBy, liftedBy: r.liftedBy })) });
}));

oversightRouter.post('/holds', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const b = z.object({ amcosId: z.string().uuid(), reason: z.string().trim().min(15, 'Eleza sababu ya zuio kikamilifu (herufi 15+)').max(2000) }).parse(req.body);
  await requireReauth(req);
  const a = await officerAmcos(req, b.amcosId);
  if (await activeHold(db, a.id)) throw conflict('Chama hiki tayari kina zuio la malipo');
  const h = await db.transaction(async (tx) => {
    const [x] = await tx.insert(H).values({ amcosId: a.id, reason: b.reason, placedById: req.auth!.userId }).returning();
    await audit(tx, req, { action: 'PAYMENT_HOLD_PLACE', entity: 'PaymentHold', entityId: x.id, amcosId: a.id, after: x });
    await notifyLeaders(tx, a.id, `CoopLink: ZUIO LA MALIPO limewekwa na Afisa Ushirika kwa ${a.name}. Hakuna malipo, mikopo, mishahara wala uhamisho utakaofanyika mpaka liondolewe. Sababu: ${b.reason.slice(0, 80)}`, { accountants: true, refType: 'PaymentHold', refId: x.id });
    return x;
  });
  res.status(201).json({ hold: h });
}));

oversightRouter.post('/holds/:id/lift', requireAmcosPerm('oversight.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().min(10, 'Eleza kwa nini zuio linaondolewa').max(2000) }).parse(req.body);
  await requireReauth(req);
  const [h] = await db.select().from(H).where(and(eq(H.id, id), amcosScope(req, H.amcosId)));
  if (!h) throw notFound('Zuio');
  if (h.liftedAt) throw badRequest('Zuio hili limeshaondolewa');
  const r = await db.transaction(async (tx) => {
    const [x] = await tx.update(H).set({ liftedAt: new Date(), liftedById: req.auth!.userId, liftReason: reason }).where(and(eq(H.id, id), isNull(H.liftedAt))).returning();
    await audit(tx, req, { action: 'PAYMENT_HOLD_LIFT', entity: 'PaymentHold', entityId: id, amcosId: h.amcosId, after: { reason } });
    await notifyLeaders(tx, h.amcosId, `CoopLink: Zuio la malipo limeondolewa na Afisa Ushirika. Malipo yanaweza kuendelea kwa taratibu za kawaida.`, { accountants: true, refType: 'PaymentHold', refId: id });
    return x;
  });
  res.json({ hold: r });
}));
