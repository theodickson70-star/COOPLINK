// Makisio ya uzalishaji (kilo) kwa kila mwanachama kwa msimu
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { findMemberScoped } from './members.routes';
import { currentSeason } from './seasons.routes';

export const estimatesRouter = Router();
const e = schema.estimates;

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
    res.json(paged(rows.map((r) => ({ ...r.estimate, member: r.member })), total, q.page, q.pageSize));
  }),
);

estimatesRouter.get(
  '/summary',
  ah(async (req, res) => {
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const season = await resolveSeason(seasonId);
    const rows = await db
      .select({
        status: e.status,
        members: count(),
        acres: sql<string>`coalesce(sum(${e.acresPlanted}), 0)`,
        kg: sql<string>`coalesce(sum(${e.estimatedKg}), 0)`,
      })
      .from(e)
      .where(and(amcosScope(req, e.amcosId), eq(e.seasonId, season.id)))
      .groupBy(e.status);
    res.json({ season: { id: season.id, name: season.name }, byStatus: rows });
  }),
);

const estimateBody = z.object({
  acresPlanted: decimalSchema({ min: 0.01 }),
  estimatedKg: decimalSchema({ min: 1 }),
  farmId: z.string().uuid().nullable().optional(),
  buyerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

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

    const estimate = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(e)
        .values({ ...body, seasonId: season.id, amcosId: member.amcosId, createdById: req.auth!.userId })
        .returning();
      await audit(tx, req, { action: 'ESTIMATE_CREATE', entity: 'Estimate', entityId: row.id, amcosId: member.amcosId, after: row });
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
    const estimate = await db.transaction(async (tx) => {
      const [row] = await tx.update(e).set(body).where(eq(e.id, id)).returning();
      await audit(tx, req, { action: 'ESTIMATE_UPDATE', entity: 'Estimate', entityId: id, amcosId: before.amcosId, before, after: row });
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
