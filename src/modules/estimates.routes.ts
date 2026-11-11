// =====================================================================
//  MAKISIO YA MSIMU kwa kila mkulima (kama fomu ya makisio ya chama, mf. NSANJO):
//   TTB · mabani (yaliyopo / yanayoongezeka) · ekari za tumbaku (kilo = ekari x kilo kwa ekari, mf. @560)
//   · ekari za mahindi na miti · pembejeo zilizokisiwa (bidhaa za chama) · trip za kuni · grading
//  Pembejeo zilizokisiwa zinalinganishwa na ugawaji; trip za kuni, grading na ekari za miti ni vikomo vya mikopo.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx, type Tx } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm, requireReauth } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2 } from '../lib/money';
import { findMemberScoped } from './members.routes';
import { currentSeason } from './seasons.routes';

export const estimatesRouter = Router();
const e = schema.estimates;
const EI = schema.estimateInputs;

async function kgPerAcreOf(amcosId: string) {
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { kgPerAcre: true } });
  return D(a?.kgPerAcre ?? 560);
}

type InputLine = { inputItemId: string; quantity: string; unit: 'PACK' | 'KG' };
/** Pembejeo zilizokisiwa: bidhaa za chama hiki tu; kwa kilo -> mifuko = kilo / kilo za mfuko */
async function normalizeInputs(amcosId: string, lines: InputLine[]) {
  const ids = lines.map((l) => l.inputItemId);
  if (new Set(ids).size !== ids.length) throw badRequest('Pembejeo moja imerudiwa kwenye makisio');
  if (!ids.length) return [];
  const its = await db.select().from(schema.inputItems).where(and(eq(schema.inputItems.amcosId, amcosId), inArray(schema.inputItems.id, ids)));
  if (its.length !== ids.length) throw badRequest('Baadhi ya pembejeo si za chama hiki');
  const by = new Map(its.map((i) => [i.id, i]));
  return lines.map((l) => {
    const it = by.get(l.inputItemId)!;
    if (l.unit === 'KG') {
      if (!it.looseKg || !it.packKg) throw badRequest(`${it.name} haikisiwi kwa kilo`);
      return { inputItemId: it.id, kg: fmt2(l.quantity), quantity: D(l.quantity).div(it.packKg).toDecimalPlaces(4).toFixed(4) };
    }
    return { inputItemId: it.id, kg: null, quantity: D(l.quantity).toFixed(4) };
  });
}
async function saveInputs(tx: Tx, estimateId: string, rows: Awaited<ReturnType<typeof normalizeInputs>>) {
  await tx.delete(EI).where(eq(EI.estimateId, estimateId));
  if (rows.length) await tx.insert(EI).values(rows.map((r) => ({ estimateId, ...r })));
}
const inputsOf = (estimateIds: string[]) => estimateIds.length
  ? db.select({ ei: EI, name: schema.inputItems.name, unit: schema.inputItems.unit, packKg: schema.inputItems.packKg }).from(EI)
    .innerJoin(schema.inputItems, eq(schema.inputItems.id, EI.inputItemId)).where(inArray(EI.estimateId, estimateIds))
  : Promise.resolve([]);

/**
 * Makisio ya pembejeo dhidi ya ugawaji (ulioidhinishwa + unaosubiri) kwa mkulima msimu huu.
 * Inatumika kwenye fomu ya ugawaji na kuonyesha Meneja ugawaji unaozidi makisio.
 */
export async function estimateCheck(tx: DbOrTx, amcosId: string, seasonId: string, memberId: string, excludeIssueId?: string) {
  const [est] = await tx.select().from(e).where(and(eq(e.amcosId, amcosId), eq(e.seasonId, seasonId), eq(e.memberId, memberId)));
  if (!est || est.status === 'REJECTED') return { estimate: null, items: new Map<string, { estimated: string; issued: string }>() };
  const lines = await tx.select().from(EI).where(eq(EI.estimateId, est.id));
  const I = schema.inputIssues, L = schema.inputIssueLines;
  const issued = await tx.select({ itemId: L.inputItemId, q: sql<string>`sum(${L.quantity})` }).from(L).innerJoin(I, eq(I.id, L.inputIssueId))
    .where(and(eq(I.memberId, memberId), eq(I.seasonId, seasonId), inArray(I.status, ['ISSUED', 'PENDING_APPROVAL']), excludeIssueId ? ne(I.id, excludeIssueId) : undefined))
    .groupBy(L.inputItemId);
  const items = new Map<string, { estimated: string; issued: string }>();
  for (const l of lines) items.set(l.inputItemId, { estimated: l.quantity, issued: '0' });
  for (const r of issued) items.set(r.itemId, { estimated: items.get(r.itemId)?.estimated ?? '0', issued: r.q });
  return { estimate: { id: est.id, status: est.status, hasInputs: lines.length > 0 }, items };
}

async function resolveSeason(seasonId?: string) {
  const s = seasonId ? await db.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) }) : await currentSeason();
  if (!s) throw notFound('Msimu');
  return s;
}

async function findEstimateScoped(req: Request, id: string) {
  const [row] = await db.select().from(e).where(and(eq(e.id, id), amcosScope(req, e.amcosId)));
  if (!row) throw notFound('Makisio');
  return row;
}

estimatesRouter.get(
  '/',
  requireAmcosPerm('members.read'),
  ah(async (req, res) => {
    const q = paginationQuery
      .extend({ seasonId: z.string().uuid().optional(), status: z.enum(schema.estimateStatusEnum.enumValues).optional(), memberId: z.string().uuid().optional() })
      .parse(req.query);
    const where = and(
      amcosScope(req, e.amcosId),
      q.seasonId ? eq(e.seasonId, q.seasonId) : undefined,
      q.status ? eq(e.status, q.status) : undefined,
      q.memberId ? eq(e.memberId, q.memberId) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select({
        estimate: e,
        member: { id: schema.members.id, memberNo: schema.members.memberNo, firstName: schema.members.firstName, lastName: schema.members.lastName },
      })
        .from(e).innerJoin(schema.members, eq(schema.members.id, e.memberId))
        .where(where).orderBy(desc(e.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(e).where(where),
    ]);
    const ins = await inputsOf(rows.map((r) => r.estimate.id));
    res.json(paged(rows.map((r) => ({ ...r.estimate, member: r.member, inputs: ins.filter((x) => x.ei.estimateId === r.estimate.id).map((x) => ({ inputItemId: x.ei.inputItemId, name: x.name, unit: x.unit, quantity: x.ei.quantity, kg: x.ei.kg })) })), total, q.page, q.pageSize));
  }),
);

estimatesRouter.get(
  '/summary',
  requireAmcosPerm('members.read'),
  ah(async (req, res) => {
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const season = await resolveSeason(seasonId);
    const rows = await db
      .select({
        status: e.status,
        members: count(),
        acres: sql<string>`coalesce(sum(${e.acresPlanted}), 0)`,
        kg: sql<string>`coalesce(sum(${e.estimatedKg}), 0)`,
        barns: sql<number>`coalesce(sum(coalesce(${e.barnsExisting}, 0) + coalesce(${e.barnsNew}, 0)), 0)::int`,
        trips: sql<string>`coalesce(sum(${e.kuniTrips}), 0)`,
      })
      .from(e)
      .where(and(amcosScope(req, e.amcosId), eq(e.seasonId, season.id)))
      .groupBy(e.status);
    const amcosId = await readAmcosId(req).catch(() => null);
    res.json({ season: { id: season.id, name: season.name }, byStatus: rows, kgPerAcre: amcosId ? (await kgPerAcreOf(amcosId)).toFixed() : null });
  }),
);

const optNum = decimalSchema({ min: 0 }).nullable().optional();
const optInt = z.coerce.number().int('Weka namba nzima').min(0).max(1000).nullable().optional();
const estimateBody = z.object({
  acresPlanted: decimalSchema({ min: 0.01 }),
  // Isipowekwa: kilo = ekari x kilo kwa ekari za chama (mf. 560)
  estimatedKg: decimalSchema({ min: 1 }).optional(),
  farmId: z.string().uuid().nullable().optional(),
  buyerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  ttbNo: z.string().trim().max(40).nullable().optional(),
  barnsExisting: optInt, barnsNew: optInt,
  maizeAcres: optNum, treeAcres: optNum, kuniTrips: optNum, gradingUsd: optNum,
  inputs: z.array(z.object({ inputItemId: z.string().uuid(), quantity: decimalSchema({ min: 0.0001 }), unit: z.enum(['PACK', 'KG']).default('PACK') })).max(60).optional(),
});

/** Mipangilio ya makisio: kilo za tumbaku kwa ekari (Meneja) */
estimatesRouter.get('/settings', requireAmcosPerm('members.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const a = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { kgPerAcre: true, postalAddress: true } }))!;
  res.json(a);
}));
estimatesRouter.put('/settings', requireAmcosPerm('estimates.approve'), ah(async (req, res) => {
  const b = z.object({ kgPerAcre: decimalSchema({ min: 1 }).refine((v) => Number(v) <= 5000, 'Kilo kwa ekari si halisi'), postalAddress: z.string().trim().max(120).nullable().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const before = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { kgPerAcre: true, postalAddress: true } });
  const after = { kgPerAcre: fmt2(b.kgPerAcre), ...(b.postalAddress !== undefined ? { postalAddress: b.postalAddress || null } : {}) };
  await db.transaction(async (tx) => {
    await tx.update(schema.amcos).set(after).where(eq(schema.amcos.id, amcosId));
    await audit(tx, req, { action: 'ESTIMATE_SETTINGS_UPDATE', entity: 'Amcos', entityId: amcosId, amcosId, before, after });
  });
  res.json(after);
}));

/**
 * Fomu ya makisio ya chama kwa msimu (kwa kuchapisha): mkulima mmoja kila mstari, safu ya kila pembejeo ya chama.
 */
estimatesRouter.get('/sheet', requireAmcosPerm('members.read'), ah(async (req, res) => {
  const { seasonId, status } = z.object({ seasonId: z.string().uuid().optional(), status: z.enum(['ALL', 'APPROVED', 'DRAFT']).default('ALL') }).parse(req.query);
  const amcosId = await readAmcosId(req);
  const season = await resolveSeason(seasonId);
  const rows = await db.select({ e, memberNo: schema.members.memberNo, name: sql<string>`${schema.members.firstName} || ' ' || ${schema.members.lastName}`, village: schema.members.village })
    .from(e).innerJoin(schema.members, eq(schema.members.id, e.memberId))
    .where(and(eq(e.amcosId, amcosId), eq(e.seasonId, season.id), status === 'ALL' ? ne(e.status, 'REJECTED') : eq(e.status, status)))
    .orderBy(asc(schema.members.memberNo));
  const ins = await inputsOf(rows.map((r) => r.e.id));
  // Safu: bidhaa hai za chama + zilizokisiwa (hata kama zimesitishwa)
  const used = new Set(ins.map((x) => x.ei.inputItemId));
  // Mpangilio wa fomu: mbolea, mbegu, dawa, vifungashio, vifaa, mengine — kisha jina
  const items = (await db.select({ id: schema.inputItems.id, name: schema.inputItems.name, unit: schema.inputItems.unit, isActive: schema.inputItems.isActive, looseKg: schema.inputItems.looseKg })
    .from(schema.inputItems).where(eq(schema.inputItems.amcosId, amcosId))
    .orderBy(sql`array_position(array['FERTILIZER','SEED','CHEMICAL','PACKAGING','EQUIPMENT','OTHER']::text[], ${schema.inputItems.category}::text)`, asc(schema.inputItems.name))).filter((i) => i.isActive || used.has(i.id));
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const tot: Record<string, ReturnType<typeof D>> = {};
  const add = (k: string, v: unknown) => { if (v != null) tot[k] = (tot[k] ?? D(0)).plus(v as string); };
  const data = rows.map((r) => {
    for (const k of ['acresPlanted', 'estimatedKg', 'maizeAcres', 'treeAcres', 'kuniTrips', 'gradingUsd', 'barnsExisting', 'barnsNew'] as const) add(k, r.e[k]);
    const mine = ins.filter((x) => x.ei.estimateId === r.e.id);
    for (const x of mine) add(`item:${x.ei.inputItemId}`, x.ei.kg ?? x.ei.quantity);
    return { ...r.e, memberNo: r.memberNo, name: r.name, village: r.village,
      inputs: Object.fromEntries(mine.map((x) => [x.ei.inputItemId, { quantity: x.ei.quantity, kg: x.ei.kg }])) };
  });
  res.json({
    amcos: { name: amcos.name, code: amcos.code, regNumber: amcos.regNumber, postalAddress: amcos.postalAddress, district: amcos.district, village: amcos.village },
    season: { id: season.id, name: season.name }, kgPerAcre: amcos.kgPerAcre, items, data,
    totals: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, v.toFixed()])),
  });
}));

/** Pembejeo zilizokisiwa dhidi ya ugawaji kwa mkulima (fomu ya ugawaji) */
estimatesRouter.get('/check', requireAmcosPerm('issues.request', 'stock.read', 'members.read'), ah(async (req, res) => {
  const { memberId } = z.object({ memberId: z.string().uuid() }).parse(req.query);
  const member = await findMemberScoped(req, memberId);
  const season = await resolveSeason();
  const c = await estimateCheck(db, member.amcosId, season.id, member.id);
  res.json({ estimate: c.estimate, items: Object.fromEntries(c.items) });
}));

estimatesRouter.get('/:id', requireAmcosPerm('members.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const est = await findEstimateScoped(req, id);
  const ins = await inputsOf([id]);
  const m = (await db.query.members.findFirst({ where: eq(schema.members.id, est.memberId), columns: { id: true, memberNo: true, firstName: true, lastName: true } }))!;
  res.json({ estimate: { ...est, member: m, inputs: ins.map((x) => ({ inputItemId: x.ei.inputItemId, name: x.name, unit: x.unit, packKg: x.packKg, quantity: x.ei.quantity, kg: x.ei.kg })) } });
}));

estimatesRouter.post(
  '/',
  requireAmcosPerm('estimates.write'),
  ah(async (req, res) => {
    const body = estimateBody.extend({ memberId: z.string().uuid(), seasonId: z.string().uuid().optional() }).parse(req.body);
    const member = await findMemberScoped(req, body.memberId);
    if (member.status !== 'ACTIVE') throw badRequest('Mwanachama hayuko hai (ACTIVE)');
    const season = await resolveSeason(body.seasonId);
    if (season.status === 'CLOSED') throw badRequest('Msimu umefungwa');
    if (body.farmId) {
      const f = await db.query.farms.findFirst({ where: and(eq(schema.farms.id, body.farmId), eq(schema.farms.memberId, member.id)) });
      if (!f) throw badRequest('Shamba si la mwanachama huyu');
    }
    const existing = await db.query.estimates.findFirst({ where: and(eq(e.seasonId, season.id), eq(e.memberId, member.id)) });
    if (existing) throw conflict('Mwanachama tayari ana makisio kwa msimu huu', { estimateId: existing.id });
    const { inputs, ...fields } = body;
    const lines = await normalizeInputs(member.amcosId, inputs ?? []);
    const estimatedKg = fields.estimatedKg ?? fmt2(D(fields.acresPlanted).times(await kgPerAcreOf(member.amcosId)));

    const estimate = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(e)
        .values({ ...fields, estimatedKg, seasonId: season.id, amcosId: member.amcosId, createdById: req.auth!.userId })
        .returning();
      await saveInputs(tx, row.id, lines);
      await audit(tx, req, { action: 'ESTIMATE_CREATE', entity: 'Estimate', entityId: row.id, amcosId: member.amcosId, after: { ...row, inputs: lines } });
      return row;
    });
    res.status(201).json({ estimate });
  }),
);

estimatesRouter.patch(
  '/:id',
  requireAmcosPerm('estimates.write'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = estimateBody.partial().parse(req.body);
    const before = await findEstimateScoped(req, id);
    if (before.status !== 'DRAFT') throw badRequest('Makisio yaliyoidhinishwa/kukataliwa hayabadilishwi');
    if (body.farmId) {
      // Shamba lazima liwe la mwanachama huyu (lisitoke chama kingine)
      const f = await db.query.farms.findFirst({ where: and(eq(schema.farms.id, body.farmId), eq(schema.farms.memberId, before.memberId)) });
      if (!f) throw badRequest('Shamba si la mwanachama huyu');
    }
    const { inputs, ...fields } = body;
    const lines = inputs ? await normalizeInputs(before.amcosId, inputs) : null;
    // Ekari zikibadilika bila kilo kuwekwa: kilo zinahesabiwa upya kwa kilo kwa ekari
    if (fields.acresPlanted && !fields.estimatedKg) fields.estimatedKg = fmt2(D(fields.acresPlanted).times(await kgPerAcreOf(before.amcosId)));
    const estimate = await db.transaction(async (tx) => {
      const [row] = Object.keys(fields).length ? await tx.update(e).set({ ...fields, updatedAt: new Date() }).where(eq(e.id, id)).returning() : [before];
      if (lines) await saveInputs(tx, id, lines);
      await audit(tx, req, { action: 'ESTIMATE_UPDATE', entity: 'Estimate', entityId: id, amcosId: before.amcosId, before, after: { ...row, ...(lines ? { inputs: lines } : {}) } });
      return row;
    });
    res.json({ estimate });
  }),
);

for (const action of ['approve', 'reject'] as const) {
  estimatesRouter.post(
    `/:id/${action}`,
    requireAmcosPerm('estimates.approve'),
    ah(async (req, res) => {
      const { id } = uuidParam.parse(req.params);
      const before = await findEstimateScoped(req, id);
      if (before.status !== 'DRAFT') throw badRequest('Makisio haya tayari yameshughulikiwa');
      if (action === 'approve') await requireReauth(req); // kuidhinisha makisio kunahitaji nenosiri la Meneja
      const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
      const estimate = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(e)
          .set({ status, approvedById: req.auth!.userId, approvedAt: new Date() })
          .where(and(eq(e.id, id), eq(e.status, 'DRAFT')))
          .returning();
        if (!row) throw conflict('Makisio yamebadilishwa na mtu mwingine, jaribu tena');
        await audit(tx, req, { action: `ESTIMATE_${status}`, entity: 'Estimate', entityId: id, amcosId: before.amcosId, before, after: row });
        return row;
      });
      res.json({ estimate });
    }),
  );
}
