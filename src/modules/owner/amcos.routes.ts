// AMCOS BUSINESS MANAGEMENT — Owner anasimamia vyama kama WATEJA (si shughuli zao za kila siku)
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { assignPlan, currentSubscription, today } from '../../lib/subscriptions';

export const ownerAmcosRouter = Router();
const A = schema.amcos;

const body = z.object({
  name: z.string().trim().min(3),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, 'Code iwe herufi/namba 2-12 bila nafasi'),
  unionId: z.string().uuid().nullable().optional(),
  regNumber: z.string().trim().nullable().optional(),
  region: z.string().trim().nullable().optional(),
  district: z.string().trim().nullable().optional(),
  ward: z.string().trim().nullable().optional(),
  village: z.string().trim().nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  contactName: z.string().trim().nullable().optional(),
  contactPhone: phoneSchema.nullable().optional(),
});

async function findAmcos(id: string) {
  const a = await db.query.amcos.findFirst({ where: eq(A.id, id) });
  if (!a) throw notFound('Chama');
  return a;
}

ownerAmcosRouter.get(
  '/',
  requirePermission('amcos.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({
      search: z.string().trim().optional(),
      status: z.enum(schema.amcosStatusEnum.enumValues).optional(),
      subscription: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'NONE']).optional(),
    }).parse(req.query);
    const s = q.search ? `%${q.search}%` : null;
    const subFilter: SQL | undefined = q.subscription === 'NONE'
      ? sql`not exists (select 1 from subscriptions x where x.amcos_id = "amcos"."id" and x.status <> 'CANCELLED')`
      : q.subscription
        ? sql`exists (select 1 from subscriptions x where x.amcos_id = "amcos"."id" and x.status = ${q.subscription})`
        : undefined;
    const where = and(
      q.status ? eq(A.status, q.status) : undefined,
      s ? or(ilike(A.name, s), ilike(A.code, s), ilike(A.district, s), ilike(A.region, s)) : undefined,
      subFilter,
    );
    const rows = await db.select({
      id: A.id, name: A.name, code: A.code, region: A.region, district: A.district, status: A.status,
      statusReason: A.statusReason, createdAt: A.createdAt, approvedAt: A.approvedAt,
      sub: sql<{ status: string; endDate: string; cycle: string; plan: string } | null>`(
        select json_build_object('status', s.status, 'endDate', s.end_date, 'cycle', s.cycle, 'plan', p.name)
        from subscriptions s join subscription_plans p on p.id = s.plan_id
        where s.amcos_id = "amcos"."id" and s.status <> 'CANCELLED' order by s.created_at desc limit 1)`,
      users: sql<number>`(select count(*)::int from users u where u.amcos_id = "amcos"."id")`,
      members: sql<number>`(select count(*)::int from members m where m.amcos_id = "amcos"."id")`,
    }).from(A).where(where).orderBy(desc(A.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(A).where(where);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

ownerAmcosRouter.post(
  '/',
  requirePermission('amcos.create'),
  ah(async (req, res) => {
    const b = body.extend({ activate: z.boolean().optional(), trialPlanId: z.string().uuid().optional() }).parse(req.body);
    // Bila ruhusa ya kuidhinisha, chama kipya kinasubiri idhini (PENDING)
    const canApprove = req.auth!.permissions.includes('amcos.approve');
    const activate = !!b.activate && canApprove;
    if (b.trialPlanId && !activate) throw badRequest('Trial inaanzishwa pale chama kinapoidhinishwa');
    const plan = b.trialPlanId ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.id, b.trialPlanId) }) : null;
    if (b.trialPlanId && !plan) throw badRequest('Mpango haupo');
    const { activate: _a, trialPlanId: _t, ...data } = b;
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.insert(A).values({
        ...data,
        status: activate ? 'ACTIVE' : 'PENDING', isActive: activate,
        registeredById: req.auth!.userId,
        approvedById: activate ? req.auth!.userId : null, approvedAt: activate ? new Date() : null,
      }).returning();
      if (plan) await assignPlan(tx, { amcosId: a.id, plan, cycle: 'TRIAL', startDate: today(), discountPercent: '0', userId: req.auth!.userId });
      await audit(tx, req, { action: 'AMCOS_REGISTER', entity: 'Amcos', entityId: a.id, amcosId: a.id, after: a });
      return a;
    });
    res.status(201).json({ amcos: row });
  }),
);

ownerAmcosRouter.get(
  '/:id',
  requirePermission('amcos.read'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const a = await findAmcos(id);
    const perms = req.auth!.permissions;
    const union = a.unionId ? await db.query.unions.findFirst({ where: eq(schema.unions.id, a.unionId) }) : null;
    const subsVisible = perms.includes('subscriptions.read') || perms.includes('finance.read');
    const subscriptions = subsVisible ? (await db.execute(sql`
      select s.*, p.name as plan_name, p.code as plan_code from subscriptions s join subscription_plans p on p.id = s.plan_id
      where s.amcos_id = ${id} order by s.created_at desc`)).rows : [];
    const payments = perms.includes('finance.read')
      ? await db.select().from(schema.platformPayments).where(eq(schema.platformPayments.amcosId, id)).orderBy(desc(schema.platformPayments.paidAt)).limit(50)
      : [];
    const [counts] = (await db.execute(sql`
      select (select count(*) from users where amcos_id = ${id})::int as users,
             (select count(*) from users where amcos_id = ${id} and is_active)::int as active_users,
             (select count(*) from members where amcos_id = ${id})::int as members,
             (select max(last_login_at) from users where amcos_id = ${id}) as last_activity`)).rows as Record<string, unknown>[];
    const admins = await db.select({ fullName: schema.users.fullName, phone: schema.users.phone, email: schema.users.email, isActive: schema.users.isActive })
      .from(schema.users).where(and(eq(schema.users.amcosId, id), eq(schema.users.role, 'AMCOS_ADMIN')));
    res.json({ amcos: a, union, subscriptions, payments, counts, admins });
  }),
);

ownerAmcosRouter.patch(
  '/:id',
  requirePermission('amcos.create'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = body.partial().omit({ code: true }).parse(req.body);
    const before = await findAmcos(id);
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(A).set(b).where(eq(A.id, id)).returning();
      await audit(tx, req, { action: 'AMCOS_BUSINESS_UPDATE', entity: 'Amcos', entityId: id, amcosId: id, before, after: a });
      return a;
    });
    res.json({ amcos: row });
  }),
);

ownerAmcosRouter.post(
  '/:id/approve',
  requirePermission('amcos.approve'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { trialPlanId } = z.object({ trialPlanId: z.string().uuid().optional() }).parse(req.body ?? {});
    const before = await findAmcos(id);
    if (before.status !== 'PENDING') throw conflict('Chama hiki hakisubiri idhini');
    const plan = trialPlanId ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.id, trialPlanId) }) : null;
    if (trialPlanId && !plan) throw badRequest('Mpango haupo');
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(A).set({ status: 'ACTIVE', isActive: true, statusReason: null, approvedById: req.auth!.userId, approvedAt: new Date() })
        .where(and(eq(A.id, id), eq(A.status, 'PENDING'))).returning();
      if (!a) throw conflict('Imebadilishwa na mtu mwingine, jaribu tena');
      if (plan) await assignPlan(tx, { amcosId: id, plan, cycle: 'TRIAL', startDate: today(), discountPercent: '0', userId: req.auth!.userId });
      await audit(tx, req, { action: 'AMCOS_APPROVE', entity: 'Amcos', entityId: id, amcosId: id, before: { status: before.status }, after: { status: 'ACTIVE', trialPlanId } });
      return a;
    });
    res.json({ amcos: row });
  }),
);

ownerAmcosRouter.post(
  '/:id/reject',
  requirePermission('amcos.approve'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
    const before = await findAmcos(id);
    if (before.status !== 'PENDING') throw conflict('Chama hiki hakisubiri idhini');
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(A).set({ status: 'REJECTED', isActive: false, statusReason: reason }).where(eq(A.id, id)).returning();
      await audit(tx, req, { action: 'AMCOS_REJECT', entity: 'Amcos', entityId: id, amcosId: id, before: { status: before.status }, after: { status: 'REJECTED', reason } });
      return a;
    });
    res.json({ amcos: row });
  }),
);

ownerAmcosRouter.post(
  '/:id/suspend',
  requirePermission('amcos.suspend'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3) }).passthrough().parse(req.body);
    await requireReauth(req);
    const before = await findAmcos(id);
    if (before.status !== 'ACTIVE') throw conflict('Chama hiki si hai');
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(A).set({ status: 'SUSPENDED', isActive: false, statusReason: reason }).where(eq(A.id, id)).returning();
      await audit(tx, req, { action: 'AMCOS_SUSPEND', entity: 'Amcos', entityId: id, amcosId: id, before: { status: before.status }, after: { status: 'SUSPENDED', reason } });
      return a;
    });
    res.json({ amcos: row });
  }),
);

ownerAmcosRouter.post(
  '/:id/reactivate',
  requirePermission('amcos.suspend'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await requireReauth(req);
    const before = await findAmcos(id);
    if (before.status !== 'SUSPENDED' && before.status !== 'REJECTED') throw conflict('Chama hiki hakijasitishwa');
    const sub = await currentSubscription(db, id);
    if (sub?.status === 'EXPIRED') throw conflict('Subscription ya chama hiki imeisha. Thibitisha malipo au ongeza muda wa subscription kwanza.');
    if (before.status === 'REJECTED' && !req.auth!.permissions.includes('amcos.approve')) throw forbidden();
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(A).set({ status: 'ACTIVE', isActive: true, statusReason: null }).where(eq(A.id, id)).returning();
      await audit(tx, req, { action: 'AMCOS_REACTIVATE', entity: 'Amcos', entityId: id, amcosId: id, before: { status: before.status, reason: before.statusReason }, after: { status: 'ACTIVE' } });
      return a;
    });
    res.json({ amcos: row });
  }),
);
