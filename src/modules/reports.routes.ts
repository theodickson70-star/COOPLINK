import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, paged, paginationQuery } from '../lib/http';
import { notFound } from '../lib/errors';
import { requireRole } from '../middleware/auth';
import { amcosScope } from '../middleware/tenant';
import { currentSeason } from './seasons.routes';

export const reportsRouter = Router();
export const auditRouter = Router();

async function seasonOrCurrent(seasonId?: string) {
  const s = seasonId ? await db.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) }) : await currentSeason();
  if (!s) throw notFound('Msimu');
  return s;
}

// Muhtasari wa msimu kwa chama (au vyama vyote vya Chama Kikuu)
reportsRouter.get(
  '/season-summary',
  ah(async (req, res) => {
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const season = await seasonOrCurrent(seasonId);
    const m = schema.members, e = schema.estimates, i = schema.inputIssues, l = schema.memberLedgerEntries;

    const [members] = await db.select({
      total: count(),
      active: sql<number>`count(*) filter (where ${m.status} = 'ACTIVE')::int`,
      female: sql<number>`count(*) filter (where ${m.gender} = 'FEMALE')::int`,
    }).from(m).where(amcosScope(req, m.amcosId));

    const [estimates] = await db.select({
      count: count(),
      approvedKg: sql<string>`coalesce(sum(${e.estimatedKg}) filter (where ${e.status} = 'APPROVED'), 0)`,
      totalKg: sql<string>`coalesce(sum(${e.estimatedKg}), 0)`,
      acres: sql<string>`coalesce(sum(${e.acresPlanted}), 0)`,
    }).from(e).where(and(amcosScope(req, e.amcosId), eq(e.seasonId, season.id)));

    const [inputs] = await db.select({
      issues: count(),
      value: sql<string>`coalesce(sum(${i.totalAmount}), 0)`,
      farmers: sql<number>`count(distinct ${i.memberId})::int`,
    }).from(i).where(and(amcosScope(req, i.amcosId), eq(i.seasonId, season.id), eq(i.status, 'ISSUED')));

    const [ledgerTotals] = await db.select({
      debit: sql<string>`coalesce(sum(${l.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${l.credit}), 0)`,
    }).from(l).where(and(amcosScope(req, l.amcosId), eq(l.seasonId, season.id)));

    res.json({ season: { id: season.id, name: season.name, status: season.status }, members, estimates, inputs, ledger: ledgerTotals });
  }),
);

// Salio la kila mwanachama (deni / anachodai) — kwa ukusanyaji wa madeni na maandalizi ya malipo
reportsRouter.get(
  '/member-balances',
  ah(async (req, res) => {
    const q = paginationQuery.extend({ seasonId: z.string().uuid().optional(), onlyOwing: z.enum(['true', 'false']).optional() }).parse(req.query);
    const l = schema.memberLedgerEntries, m = schema.members;
    const balance = sql<string>`coalesce(sum(${l.credit}), 0) - coalesce(sum(${l.debit}), 0)`;
    const base = db
      .select({
        memberId: m.id, memberNo: m.memberNo, firstName: m.firstName, lastName: m.lastName, village: m.village,
        totalDebit: sql<string>`coalesce(sum(${l.debit}), 0)`,
        totalCredit: sql<string>`coalesce(sum(${l.credit}), 0)`,
        balance,
      })
      .from(l).innerJoin(m, eq(m.id, l.memberId))
      .where(and(amcosScope(req, l.amcosId), q.seasonId ? eq(l.seasonId, q.seasonId) : undefined))
      .groupBy(m.id)
      .having(q.onlyOwing === 'true' ? sql`${balance} < 0` : undefined)
      .$dynamic();

    const sub = base.as('b');
    const [rows, [{ total }]] = await Promise.all([
      base.orderBy(asc(balance)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(sub),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

// ------------------------------ AUDIT LOG ------------------------------
auditRouter.get(
  '/',
  requireRole(['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT', 'AMCOS_VIEWER']),
  ah(async (req, res) => {
    const q = paginationQuery
      .extend({ entity: z.string().optional(), entityId: z.string().optional(), action: z.string().optional(), userId: z.string().uuid().optional() })
      .parse(req.query);
    const a = schema.auditLogs;
    const scope = req.auth!.role === 'SUPER_ADMIN' && !req.query.amcosId ? undefined : amcosScope(req, a.amcosId);
    const where = and(
      scope,
      q.entity ? eq(a.entity, q.entity) : undefined,
      q.entityId ? eq(a.entityId, q.entityId) : undefined,
      q.action ? eq(a.action, q.action) : undefined,
      q.userId ? eq(a.userId, q.userId) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select({ log: a, user: { fullName: schema.users.fullName, role: schema.users.role } })
        .from(a).leftJoin(schema.users, eq(schema.users.id, a.userId))
        .where(where).orderBy(desc(a.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(a).where(where),
    ]);
    res.json(paged(rows.map((r) => ({ ...r.log, user: r.user })), total, q.page, q.pageSize));
  }),
);
