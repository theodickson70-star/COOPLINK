// SECURITY & AUDIT CENTER
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, uuidParam } from '../../lib/http';
import { forbidden, notFound } from '../../lib/errors';
import { activeSessionsWhere, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { PLATFORM_ROLES } from '../../lib/permissions';
import { rangeQuery } from './common';

export const securityRouter = Router();
const L = schema.loginEvents;
const AU = schema.auditLogs;

securityRouter.get(
  '/logins',
  requirePermission('security.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({
      success: z.enum(['true', 'false']).optional(), suspicious: z.enum(['true']).optional(),
      userId: z.string().uuid().optional(), from: z.string().optional(), to: z.string().optional(),
    }).parse(req.query);
    const r = q.from || q.to ? rangeQuery.parse({ from: q.from, to: q.to }) : null;
    const where = and(
      q.success ? eq(L.success, q.success === 'true') : undefined,
      q.suspicious ? eq(L.suspicious, true) : undefined,
      q.userId ? eq(L.userId, q.userId) : undefined,
      r ? and(gte(L.createdAt, r.fromTs), lt(L.createdAt, r.toTs)) : undefined,
    );
    const rows = await db.select({ e: L, user: { fullName: schema.users.fullName, role: schema.users.role } })
      .from(L).leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(where).orderBy(desc(L.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(L).where(where);
    res.json(paged(rows.map((x) => ({ ...x.e, user: x.user })), total, q.page, q.pageSize));
  }),
);

securityRouter.get(
  '/alerts',
  requirePermission('security.read'),
  ah(async (_req, res) => {
    const suspicious = await db.select({ e: L, user: { fullName: schema.users.fullName, role: schema.users.role } })
      .from(L).leftJoin(schema.users, eq(schema.users.id, L.userId))
      .where(and(eq(L.suspicious, true), gte(L.createdAt, sql`now() - interval '30 days'`))).orderBy(desc(L.createdAt)).limit(50);
    const failedBursts = (await db.execute(sql`
      select phone, count(*)::int as attempts, max(created_at) as last_attempt, count(distinct ip)::int as ips
      from login_events where success = false and created_at > now() - interval '24 hours'
      group by phone having count(*) >= 5 order by attempts desc limit 50`)).rows;
    const [summary] = (await db.execute(sql`
      select count(*) filter (where success = false and created_at > now() - interval '24 hours')::int as failed_24h,
             count(*) filter (where success and created_at > now() - interval '24 hours')::int as success_24h,
             count(*) filter (where suspicious and created_at > now() - interval '7 days')::int as suspicious_7d
      from login_events`)).rows;
    res.json({ summary, suspicious: suspicious.map((x) => ({ ...x.e, user: x.user })), failedBursts });
  }),
);

securityRouter.get(
  '/sessions',
  requirePermission('security.read'),
  ah(async (req, res) => {
    const q = z.object({ platformOnly: z.enum(['true', 'false']).optional() }).parse(req.query);
    const rows = await db.select({
      s: schema.userSessions,
      user: { id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role, phone: schema.users.phone },
    }).from(schema.userSessions).innerJoin(schema.users, eq(schema.users.id, schema.userSessions.userId))
      .where(and(isNull(schema.userSessions.revokedAt), gte(schema.userSessions.expiresAt, new Date()),
        q.platformOnly === 'true' ? inArray(schema.users.role, PLATFORM_ROLES) : undefined))
      .orderBy(desc(schema.userSessions.lastSeenAt)).limit(500);
    res.json({ data: rows.map((x) => ({ ...x.s, user: x.user, current: x.s.id === req.auth!.sessionId })) });
  }),
);

securityRouter.delete(
  '/sessions/:id',
  requirePermission('security.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const s = await db.query.userSessions.findFirst({ where: eq(schema.userSessions.id, id) });
    if (!s) throw notFound('Session');
    const owner = await db.query.users.findFirst({ where: eq(schema.users.id, s.userId), columns: { role: true } });
    if (owner?.role === 'SUPER_ADMIN' && s.userId !== req.auth!.userId) throw forbidden('Vikao vya Owner vinasimamiwa na Owner mwenyewe');
    await db.transaction(async (tx) => {
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(and(eq(schema.userSessions.id, id), isNull(schema.userSessions.revokedAt)));
      await audit(tx, req, { action: 'SESSION_REVOKE', entity: 'UserSession', entityId: id, after: { userId: s.userId } });
    });
    res.json({ ok: true });
  }),
);

securityRouter.post(
  '/users/:id/revoke-all',
  requirePermission('security.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, id), columns: { role: true } });
    if (!u) throw notFound('Mtumiaji');
    if (u.role === 'SUPER_ADMIN' && id !== req.auth!.userId) throw forbidden();
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` }).where(eq(schema.users.id, id));
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: 'SESSIONS_REVOKE_ALL', entity: 'User', entityId: id });
    });
    res.json({ ok: true });
  }),
);

securityRouter.get(
  '/audit',
  requirePermission('security.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({
      action: z.string().trim().optional(), entity: z.string().trim().optional(), userId: z.string().uuid().optional(),
      role: z.string().trim().optional(), amcosId: z.string().uuid().optional(),
      scope: z.enum(['platform', 'all']).optional(), from: z.string().optional(), to: z.string().optional(),
    }).parse(req.query);
    const r = q.from || q.to ? rangeQuery.parse({ from: q.from, to: q.to }) : null;
    const where = and(
      q.action ? eq(AU.action, q.action) : undefined,
      q.entity ? eq(AU.entity, q.entity) : undefined,
      q.userId ? eq(AU.userId, q.userId) : undefined,
      q.role ? eq(AU.userRole, q.role) : undefined,
      q.amcosId ? eq(AU.amcosId, q.amcosId) : undefined,
      q.scope === 'platform' ? inArray(AU.userRole, [...PLATFORM_ROLES, 'SYSTEM']) : undefined,
      r ? and(gte(AU.createdAt, r.fromTs), lt(AU.createdAt, r.toTs)) : undefined,
    );
    const rows = await db.select({ log: AU, user: { fullName: schema.users.fullName, role: schema.users.role }, amcos: schema.amcos.name })
      .from(AU).leftJoin(schema.users, eq(schema.users.id, AU.userId)).leftJoin(schema.amcos, eq(schema.amcos.id, AU.amcosId))
      .where(where).orderBy(desc(AU.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(AU).where(where);
    res.json(paged(rows.map((x) => ({ ...x.log, user: x.user, amcosName: x.amcos })), total, q.page, q.pageSize));
  }),
);
