// AMCOS BUSINESS MANAGEMENT — Owner anasimamia vyama kama WATEJA (si shughuli zao za kila siku)
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { assignPlan, currentSubscription, today } from '../../lib/subscriptions';
import { hashPassword, passwordSchemaRule, tempPassword } from '../../lib/security';
import { generateAmcosCode } from '../../lib/amcos-code';
import { AMCOS_STAFF_ROLES, STAFF_TITLE, type AmcosStaffRole } from '../../lib/amcos-permissions';
import { assertSlotFree } from '../../lib/amcos-staff';

export const ownerAmcosRouter = Router();
const A = schema.amcos;

const body = z.object({
  name: z.string().trim().min(3),
  // Code inatolewa na mfumo (generateAmcosCode). Ikitumwa (mf. data ya zamani), inakaguliwa tu.
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, 'Code iwe herufi/namba 2-12 bila nafasi').optional(),
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
    const b = body.extend({
      activate: z.boolean().optional(),
      trialPlanId: z.string().uuid().optional(),
      // Meneja anaundwa pamoja na chama; Owner anaweka nenosiri la kuanzia, Meneja analibadilisha akiingia mara ya kwanza
      manager: z.object({
        fullName: z.string().trim().min(3, 'Jina la Meneja angalau herufi 3'),
        phone: phoneSchema,
        email: z.string().email().nullable().optional(),
        password: z.string().refine(passwordSchemaRule.test, passwordSchemaRule.message),
      }).optional(),
    }).parse(req.body);
    if (b.manager) {
      if (!req.auth!.permissions.includes('amcos.staff')) throw forbidden('Huna ruhusa ya kuunda watumishi wa chama');
      if (await db.query.users.findFirst({ where: eq(schema.users.phone, b.manager.phone), columns: { id: true } })) {
        throw conflict('Namba ya simu ya Meneja tayari inatumika na akaunti nyingine');
      }
    }
    const managerHash = b.manager ? await hashPassword(b.manager.password) : null;
    // Bila ruhusa ya kuidhinisha, chama kipya kinasubiri idhini (PENDING)
    const canApprove = req.auth!.permissions.includes('amcos.approve');
    const activate = !!b.activate && canApprove;
    if (b.trialPlanId && !activate) throw badRequest('Trial inaanzishwa pale chama kinapoidhinishwa');
    const plan = b.trialPlanId ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.id, b.trialPlanId) }) : null;
    if (b.trialPlanId && !plan) throw badRequest('Mpango haupo');
    const { activate: _a, trialPlanId: _t, manager, ...data } = b;
    const result = await db.transaction(async (tx) => {
      const code = data.code ?? (await generateAmcosCode(tx, data.name));
      if (data.code && (await tx.query.amcos.findFirst({ where: eq(A.code, data.code), columns: { id: true } }))) throw conflict('Code hii tayari inatumika');
      const [a] = await tx.insert(A).values({
        ...data,
        code,
        status: activate ? 'ACTIVE' : 'PENDING', isActive: activate,
        registeredById: req.auth!.userId,
        approvedById: activate ? req.auth!.userId : null, approvedAt: activate ? new Date() : null,
      }).returning();
      if (plan) await assignPlan(tx, { amcosId: a.id, plan, cycle: 'TRIAL', startDate: today(), discountPercent: '0', userId: req.auth!.userId });
      await audit(tx, req, { action: 'AMCOS_REGISTER', entity: 'Amcos', entityId: a.id, amcosId: a.id, after: a });
      let mgr: { id: string; fullName: string; phone: string } | null = null;
      if (manager && managerHash) {
        const [u] = await tx.insert(schema.users).values({
          fullName: manager.fullName, phone: manager.phone, email: manager.email ?? null, role: 'AMCOS_ADMIN', amcosId: a.id,
          passwordHash: managerHash, mustChangePassword: true,
        }).returning({ id: schema.users.id, fullName: schema.users.fullName, phone: schema.users.phone });
        // Nenosiri halihifadhiwi kwenye audit log
        await audit(tx, req, { action: 'AMCOS_STAFF_ASSIGN', entity: 'User', entityId: u.id, amcosId: a.id, after: { ...u, role: 'AMCOS_ADMIN', title: 'Meneja', initialPasswordSetBy: 'owner' } });
        mgr = u;
      }
      return { amcos: a, manager: mgr };
    });
    res.status(201).json(result);
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
    const admins = await db.select({ fullName: schema.users.fullName, phone: schema.users.phone, email: schema.users.email, isActive: schema.users.isActive, role: schema.users.role })
      .from(schema.users).where(and(eq(schema.users.amcosId, id), eq(schema.users.isActive, true), inArray(schema.users.role, [...AMCOS_STAFF_ROLES])));
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


// ------------------------------ WATUMISHI WA AMCOS (nafasi 3) ------------------------------
const U = schema.users;
const staffCols = {
  id: U.id, fullName: U.fullName, phone: U.phone, email: U.email, role: U.role, isActive: U.isActive,
  mustChangePassword: U.mustChangePassword, lastLoginAt: U.lastLoginAt, createdAt: U.createdAt, updatedAt: U.updatedAt,
};

/** Nafasi tatu (Meneja, Mhasibu, Stokipa) na historia ya waliowahi kushika nafasi hizo. */
ownerAmcosRouter.get('/:id/staff', requirePermission('amcos.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  await findAmcos(id);
  const rows = await db.select(staffCols).from(U).where(and(eq(U.amcosId, id), inArray(U.role, ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'])))
    .orderBy(desc(U.isActive), desc(U.updatedAt));
  res.json({
    slots: AMCOS_STAFF_ROLES.map((role) => ({ role, title: STAFF_TITLE[role], holder: rows.find((r) => r.role === role && r.isActive) ?? null })),
    history: rows.filter((r) => !r.isActive),
  });
}));

/** Kuweka mtumishi kwenye nafasi. replace=true: aliyepo anazimwa (HAFUTWI) na mpya anaingia — inahitaji nenosiri la Owner. */
ownerAmcosRouter.post('/:id/staff', requirePermission('amcos.staff'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    role: z.enum(AMCOS_STAFF_ROLES),
    fullName: z.string().trim().min(3),
    phone: phoneSchema,
    email: z.string().email().nullable().optional(),
    replace: z.boolean().optional(),
    // Hiari: nenosiri la kuanzia lililowekwa na Owner. Lisipowekwa, mfumo unatoa la muda.
    password: z.string().refine(passwordSchemaRule.test, passwordSchemaRule.message).optional(),
  }).parse(req.body);
  const a = await findAmcos(id);
  if (a.status === 'REJECTED') throw badRequest('Chama hiki kimekataliwa');
  const holder = await db.query.users.findFirst({ where: and(eq(U.amcosId, id), eq(U.role, body.role), eq(U.isActive, true)) });
  if (holder && !body.replace) await assertSlotFree(db, id, body.role);
  if (holder) await requireReauth(req);
  if (await db.query.users.findFirst({ where: eq(U.phone, body.phone) })) throw conflict('Namba hii ya simu tayari inatumika na akaunti nyingine');
  const ownPassword = !!body.password;
  const password = body.password ?? tempPassword();
  const user = await db.transaction(async (tx) => {
    if (holder) {
      await tx.update(U).set({ isActive: false, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, holder.id));
      await audit(tx, req, { action: 'AMCOS_STAFF_REPLACED', entity: 'User', entityId: holder.id, amcosId: id, before: { isActive: true, role: holder.role, fullName: holder.fullName }, after: { isActive: false } });
    }
    const [u] = await tx.insert(U).values({
      fullName: body.fullName, phone: body.phone, email: body.email ?? null, role: body.role, amcosId: id,
      passwordHash: await hashPassword(password), mustChangePassword: true,
    }).returning(staffCols);
    await audit(tx, req, { action: 'AMCOS_STAFF_ASSIGN', entity: 'User', entityId: u.id, amcosId: id, after: { ...u, title: STAFF_TITLE[body.role as AmcosStaffRole], replaced: holder?.id ?? null } });
    return u;
  });
  // Nenosiri la muda linaonyeshwa MARA MOJA tu; nenosiri alilochagua Owner halirudishwi
  res.status(201).json({ user, temporaryPassword: ownPassword ? null : password });
}));

async function scopedStaff(amcosId: string, userId: string) {
  const u = await db.query.users.findFirst({ where: and(eq(U.id, userId), eq(U.amcosId, amcosId)) });
  if (!u || !(['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'] as string[]).includes(u.role)) throw notFound('Mtumishi');
  return u;
}

ownerAmcosRouter.post('/:id/staff/:userId/reset-password', requirePermission('amcos.staff'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const u = await scopedStaff(id, userId);
  if (!u.isActive) throw badRequest('Akaunti hii imezimwa');
  const password = tempPassword();
  await db.transaction(async (tx) => {
    await tx.update(U).set({ passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, userId));
    await audit(tx, req, { action: 'AMCOS_STAFF_PASSWORD_RESET', entity: 'User', entityId: userId, amcosId: id });
  });
  res.json({ temporaryPassword: password });
}));

ownerAmcosRouter.post('/:id/staff/:userId/active', requirePermission('amcos.staff'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const u = await scopedStaff(id, userId);
  if (u.isActive === isActive) throw badRequest(isActive ? 'Akaunti tayari iko hai' : 'Akaunti tayari imezimwa');
  if (!isActive) await requireReauth(req);
  if (isActive) {
    if (u.role === 'AMCOS_VIEWER') throw badRequest('AMCOS ina watumishi watatu tu: Meneja, Mhasibu na Stokipa');
    await assertSlotFree(db, id, u.role, u.id);
  }
  const user = await db.transaction(async (tx) => {
    const [r] = await tx.update(U).set({ isActive, ...(isActive ? {} : { tokenVersion: sql`${U.tokenVersion} + 1` }) }).where(eq(U.id, userId)).returning(staffCols);
    await audit(tx, req, { action: isActive ? 'AMCOS_STAFF_ACTIVATE' : 'AMCOS_STAFF_DEACTIVATE', entity: 'User', entityId: userId, amcosId: id, before: { isActive: u.isActive }, after: { isActive } });
    return r;
  });
  res.json({ user });
}));
