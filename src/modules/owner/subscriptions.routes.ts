// SUBSCRIPTIONS & PRICING — mipango inabadilishwa hapa, si kwenye code
import { Router } from 'express';
import { z } from 'zod';
import { and, count, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../../lib/http';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { addDays, assignPlan, computeStatus, extendSubscription, planPrice, today } from '../../lib/subscriptions';
import { getSetting } from '../../lib/settings';
import { dateStr } from './common';

export const subscriptionsRouter = Router();
const P = schema.subscriptionPlans;
const S = schema.subscriptions;

// ------------------------------ MIPANGO ------------------------------
const planBody = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'Code iwe herufi/namba 2-20'),
  description: z.string().trim().nullable().optional(),
  monthlyPrice: decimalSchema({ min: 0 }),
  annualPrice: decimalSchema({ min: 0 }),
  currency: z.enum(['TZS', 'USD']).default('TZS'),
  trialDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(90),
  maxMembers: z.number().int().min(1).nullable().optional(),
  features: z.array(z.string().trim().min(1)).max(30).optional(),
});

subscriptionsRouter.get(
  '/plans',
  requirePermission('subscriptions.read'),
  ah(async (_req, res) => {
    const rows = await db.select({
      plan: P,
      activeSubscriptions: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = "subscription_plans"."id" and s.status in ('TRIAL','ACTIVE','PAST_DUE'))`,
      totalSubscriptions: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = "subscription_plans"."id")`,
    }).from(P).orderBy(P.monthlyPrice);
    res.json({ data: rows.map((r) => ({ ...r.plan, activeSubscriptions: r.activeSubscriptions, totalSubscriptions: r.totalSubscriptions })) });
  }),
);

subscriptionsRouter.post(
  '/plans',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const b = planBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [p] = await tx.insert(P).values(b).returning();
      await audit(tx, req, { action: 'PLAN_CREATE', entity: 'SubscriptionPlan', entityId: p.id, after: p });
      return p;
    });
    res.status(201).json({ plan: row });
  }),
);

subscriptionsRouter.patch(
  '/plans/:id',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = planBody.partial().omit({ code: true }).extend({ isActive: z.boolean().optional() }).parse(req.body);
    const before = await db.query.subscriptionPlans.findFirst({ where: eq(P.id, id) });
    if (!before) throw notFound('Mpango');
    // Bei mpya inatumika kwa subscriptions mpya tu; zilizopo zinabaki na bei yao
    const row = await db.transaction(async (tx) => {
      const [p] = await tx.update(P).set(b).where(eq(P.id, id)).returning();
      await audit(tx, req, { action: 'PLAN_UPDATE', entity: 'SubscriptionPlan', entityId: id, before, after: p });
      return p;
    });
    res.json({ plan: row });
  }),
);

subscriptionsRouter.delete(
  '/plans/:id',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await requireReauth(req);
    const before = await db.query.subscriptionPlans.findFirst({ where: eq(P.id, id) });
    if (!before) throw notFound('Mpango');
    const [{ n }] = await db.select({ n: count() }).from(S).where(eq(S.planId, id));
    if (n > 0) throw conflict('Mpango huu umeshatumiwa na chama. Hauwezi kufutwa — usitishe (isActive = false) badala yake.');
    await db.transaction(async (tx) => {
      await tx.delete(P).where(eq(P.id, id));
      await audit(tx, req, { action: 'PLAN_DELETE', entity: 'SubscriptionPlan', entityId: id, before });
    });
    res.json({ ok: true });
  }),
);

// ------------------------------ SUBSCRIPTIONS ------------------------------
subscriptionsRouter.get(
  '/',
  requirePermission('subscriptions.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({
      status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED', 'EXPIRING', 'UNPAID', 'PAID']).optional(),
      search: z.string().trim().optional(),
    }).parse(req.query);
    const cfg = await getSetting('config');
    const t = today();
    const paidSql = sql`exists (select 1 from platform_payments pp where pp.subscription_id = "subscriptions"."id" and pp.status = 'VERIFIED')`;
    const statusFilter = !q.status ? sql`${S.status} <> 'CANCELLED'`
      : q.status === 'EXPIRING' ? sql`${S.status} in ('TRIAL','ACTIVE') and ${S.endDate} between ${t} and ${addDays(t, cfg.expiringWindowDays)}`
      : q.status === 'UNPAID' ? sql`${S.status} in ('PAST_DUE','EXPIRED') or (${S.cycle} <> 'TRIAL' and ${S.status} <> 'CANCELLED' and not ${paidSql})`
      : q.status === 'PAID' ? sql`${S.status} <> 'CANCELLED' and ${paidSql}`
      : eq(S.status, q.status);
    const s = q.search ? `%${q.search}%` : null;
    const where = and(statusFilter, s ? or(ilike(schema.amcos.name, s), ilike(schema.amcos.code, s)) : undefined);
    const base = db.select({
      sub: S,
      amcos: { id: schema.amcos.id, name: schema.amcos.name, code: schema.amcos.code, status: schema.amcos.status },
      plan: { id: P.id, name: P.name, code: P.code },
      paid: sql<string>`coalesce((select sum(amount) from platform_payments pp where pp.subscription_id = "subscriptions"."id" and pp.status = 'VERIFIED'), 0)`,
      pending: sql<string>`coalesce((select sum(amount) from platform_payments pp where pp.subscription_id = "subscriptions"."id" and pp.status = 'PENDING'), 0)`,
    }).from(S).innerJoin(schema.amcos, eq(schema.amcos.id, S.amcosId)).innerJoin(P, eq(P.id, S.planId));
    const rows = await base.where(where).orderBy(S.endDate).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(S).innerJoin(schema.amcos, eq(schema.amcos.id, S.amcosId)).where(where);
    res.json(paged(rows.map((r) => ({ ...r.sub, amcos: r.amcos, plan: r.plan, paidTotal: r.paid, pendingTotal: r.pending })), total, q.page, q.pageSize));
  }),
);

subscriptionsRouter.post(
  '/assign',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const b = z.object({
      amcosId: z.string().uuid(), planId: z.string().uuid(),
      cycle: z.enum(schema.billingCycleEnum.enumValues),
      startDate: dateStr.optional(),
      discountPercent: decimalSchema({ min: 0 }).refine((v) => Number(v) <= 100, 'Punguzo lisizidi 100%').default('0'),
      notes: z.string().trim().nullable().optional(),
    }).parse(req.body);
    const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId) });
    if (!a) throw notFound('Chama');
    if (a.status === 'REJECTED' || a.status === 'PENDING') throw badRequest('Idhinisha chama kwanza');
    const plan = await db.query.subscriptionPlans.findFirst({ where: eq(P.id, b.planId) });
    if (!plan) throw notFound('Mpango');
    if (!plan.isActive) throw badRequest('Mpango huu umesitishwa');
    const result = await db.transaction(async (tx) => {
      const r = await assignPlan(tx, { amcosId: a.id, plan, cycle: b.cycle, startDate: b.startDate ?? today(), discountPercent: b.discountPercent, notes: b.notes, userId: req.auth!.userId });
      await audit(tx, req, { action: 'SUBSCRIPTION_ASSIGN', entity: 'Subscription', entityId: r.sub.id, amcosId: a.id, after: { ...r.sub, access: r.access } });
      return r;
    });
    res.status(201).json({ subscription: result.sub, access: result.access });
  }),
);

async function findSub(id: string) {
  const s = await db.query.subscriptions.findFirst({ where: eq(S.id, id) });
  if (!s) throw notFound('Subscription');
  return s;
}

// Nyongeza ya muda bila malipo (mf. fidia) — inahitaji sababu na uthibitisho wa nenosiri
subscriptionsRouter.post(
  '/:id/extend',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = z.object({ days: z.number().int().min(1).max(366), reason: z.string().trim().min(3) }).passthrough().parse(req.body);
    await requireReauth(req);
    const sub = await findSub(id);
    if (sub.status === 'CANCELLED') throw badRequest('Subscription hii imefutwa');
    const r = await db.transaction(async (tx) => {
      const out = await extendSubscription(tx, sub, { days: b.days });
      await audit(tx, req, { action: 'SUBSCRIPTION_EXTEND', entity: 'Subscription', entityId: id, amcosId: sub.amcosId,
        before: { endDate: sub.endDate, status: sub.status }, after: { endDate: out.sub.endDate, status: out.sub.status, days: b.days, reason: b.reason } });
      return out;
    });
    res.json({ subscription: r.sub, access: r.access });
  }),
);

subscriptionsRouter.patch(
  '/:id',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = z.object({
      discountPercent: decimalSchema({ min: 0 }).refine((v) => Number(v) <= 100, 'Punguzo lisizidi 100%').optional(),
      graceDays: z.number().int().min(0).max(90).optional(),
      notes: z.string().trim().nullable().optional(),
      reason: z.string().trim().min(3),
    }).parse(req.body);
    const sub = await findSub(id);
    const plan = (await db.query.subscriptionPlans.findFirst({ where: eq(P.id, sub.planId) }))!;
    const discountPercent = b.discountPercent ?? sub.discountPercent;
    const graceDays = b.graceDays ?? sub.graceDays;
    const status = computeStatus({ ...sub, graceDays });
    const row = await db.transaction(async (tx) => {
      const [s] = await tx.update(S).set({
        discountPercent, graceDays, status, notes: b.notes === undefined ? sub.notes : b.notes,
        price: planPrice(plan, sub.cycle, discountPercent),
      }).where(eq(S.id, id)).returning();
      await audit(tx, req, { action: 'SUBSCRIPTION_UPDATE', entity: 'Subscription', entityId: id, amcosId: sub.amcosId,
        before: { discountPercent: sub.discountPercent, graceDays: sub.graceDays, price: sub.price }, after: { discountPercent, graceDays, price: s.price, reason: b.reason } });
      return s;
    });
    res.json({ subscription: row });
  }),
);

subscriptionsRouter.post(
  '/:id/cancel',
  requirePermission('subscriptions.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3) }).passthrough().parse(req.body);
    await requireReauth(req);
    const sub = await findSub(id);
    if (sub.status === 'CANCELLED') throw conflict('Tayari imefutwa');
    const row = await db.transaction(async (tx) => {
      const [s] = await tx.update(S).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(and(eq(S.id, id), inArray(S.status, ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED']))).returning();
      await audit(tx, req, { action: 'SUBSCRIPTION_CANCEL', entity: 'Subscription', entityId: id, amcosId: sub.amcosId, before: { status: sub.status }, after: { status: 'CANCELLED', reason } });
      return s;
    });
    res.json({ subscription: row });
  }),
);

