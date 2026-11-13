// AMCOS BUSINESS MANAGEMENT — Owner anasimamia vyama kama WATEJA (si shughuli zao za kila siku)
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { sendTempCredentials, tempExpiry } from '../../lib/staff-credentials';
import { assertPhoneFree } from '../../lib/user-phone';
import { assignPlan, currentSubscription, today } from '../../lib/subscriptions';
import { ensureEntranceFee } from '../../lib/fees';
import { hashPassword, passwordSchemaRule, tempPassword } from '../../lib/security';
import { generateAmcosCode } from '../../lib/amcos-code';
import { AMCOS_STAFF_ROLES, STAFF_TITLE, type AmcosStaffRole } from '../../lib/amcos-permissions';
import { lookupNameOrNull, verifiedName } from '../../lib/name-lookup';
import { assertSlotFree } from '../../lib/amcos-staff';
import { PREVIEW_GROUPS, resetBackup, resetCounts, runTrainingReset } from '../../lib/training-reset';

import { clearStaffingCache, missingRoles } from '../../lib/amcos-permissions';
export const ownerAmcosRouter = Router();
// Watumishi wakiongezwa/wakizimwa: hali ya "Meneja pekee" inahesabiwa upya baada ya jibu
ownerAmcosRouter.use((req, res, next) => { if (req.method !== 'GET') res.on('finish', clearStaffingCache); next(); });
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
  inputCurrency: z.enum(['TZS', 'USD']).optional(), // sarafu ya pembejeo (vyama vya tumbaku: USD)
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
      statusReason: A.statusReason, createdAt: A.createdAt, approvedAt: A.approvedAt, training: A.training,
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
        // Hiari: bila nenosiri, Meneja anatumiwa nenosiri la muda kwa SMS (inapendekezwa — Owner halioni)
        password: z.string().refine(passwordSchemaRule.test, passwordSchemaRule.message).optional(),
      }).optional(),
    }).parse(req.body);
    if (b.contactPhone) b.contactName = (await lookupNameOrNull(b.contactPhone, 'Simu ya mawasiliano')) ?? b.contactName ?? null;
    if (b.manager) {
      if (!req.auth!.permissions.includes('amcos.staff')) throw forbidden('Huna ruhusa ya kuunda watumishi wa chama');
      await assertPhoneFree(b.manager.phone); // akaunti zilizozimwa haziizuii namba
    }
    const managerTemp = b.manager && !b.manager.password ? tempPassword() : null;
    const managerHash = b.manager ? await hashPassword(b.manager.password ?? managerTemp!) : null;
    // Bila ruhusa ya kuidhinisha, chama kipya kinasubiri idhini (PENDING)
    const canApprove = req.auth!.permissions.includes('amcos.approve');
    const activate = !!b.activate && canApprove;
    if (b.trialPlanId && !activate) throw badRequest('Trial inaanzishwa pale chama kinapoidhinishwa');
    const plan = b.trialPlanId ? await db.query.subscriptionPlans.findFirst({ where: eq(schema.subscriptionPlans.id, b.trialPlanId) }) : null;
    if (b.trialPlanId && !plan) throw badRequest('Mpango haupo');
    const { activate: _a, trialPlanId: _t, manager, ...data } = b;
    if (manager) manager.fullName = (await verifiedName(manager.phone, manager.fullName, 'Simu ya Meneja'))!; // jina kutoka mobile money
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
      if (activate) await ensureEntranceFee(tx, a.id, req.auth!.userId); // ada ya kingilio inaanza kuhesabiwa chama kikifunguliwa
      await audit(tx, req, { action: 'AMCOS_REGISTER', entity: 'Amcos', entityId: a.id, amcosId: a.id, after: a });
      let mgr: { id: string; fullName: string; phone: string; role: string; amcosId: string | null } | null = null;
      if (manager && managerHash) {
        const [u] = await tx.insert(schema.users).values({
          fullName: manager.fullName, phone: manager.phone, email: manager.email ?? null, role: 'AMCOS_ADMIN', amcosId: a.id,
          passwordHash: managerHash, mustChangePassword: true, tempPasswordExpiresAt: managerTemp && activate ? tempExpiry() : null,
        }).returning({ id: schema.users.id, fullName: schema.users.fullName, phone: schema.users.phone, role: schema.users.role, amcosId: schema.users.amcosId });
        // Nenosiri halihifadhiwi kwenye audit log
        await audit(tx, req, { action: 'AMCOS_STAFF_ASSIGN', entity: 'User', entityId: u.id, amcosId: a.id, after: { ...u, role: 'AMCOS_ADMIN', title: 'Meneja', initialPasswordSetBy: managerTemp ? 'sms' : 'owner' } });
        mgr = u;
      }
      return { amcos: a, manager: mgr };
    });
    let managerDelivery = null;
    if (result.manager && managerTemp) {
      managerDelivery = await sendTempCredentials(result.manager, managerTemp, { kind: 'NEW', amcosName: result.amcos.name, pending: !activate });
      await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: result.manager.id, amcosId: result.amcos.id, after: { channel: 'SMS', status: managerDelivery.status, kind: 'NEW' } });
    }
    res.status(201).json({ ...result, managerDelivery, managerTemporaryPassword: managerTemp && managerDelivery?.status !== 'SENT' ? managerTemp : null });
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
    // Meneja pekee: vyeo visivyokuwepo + idhini alizojiidhinisha (siku 90)
    const covering = await missingRoles(a.id);
    const [{ n: selfApprovals }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where amcos_id = ${a.id} and action = 'APPROVAL_SELF_APPROVED' and created_at > now() - interval '90 days'`)).rows;
    res.json({ amcos: a, union, subscriptions, payments, counts, admins, staffing: { covering, selfApprovals90d: selfApprovals } });
  }),
);

ownerAmcosRouter.patch(
  '/:id',
  requirePermission('amcos.create'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = body.partial().omit({ code: true }).parse(req.body);
    const before = await findAmcos(id);
    const cph = b.contactPhone !== undefined ? b.contactPhone : before.contactPhone;
    if (cph && (b.contactPhone !== undefined || b.contactName !== undefined)) b.contactName = (await lookupNameOrNull(cph, 'Simu ya mawasiliano')) ?? b.contactName ?? before.contactName;
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
      await ensureEntranceFee(tx, id, req.auth!.userId);
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


// ------------------------------ CHAMA CHA MAFUNZO: KUFUTA DATA NA KUANZA UPYA (Owner pekee) ------------------------------
const ownerOnly = (req: Parameters<typeof requireReauth>[0]) => { if (req.auth!.role !== 'SUPER_ADMIN') throw forbidden('Owner pekee ndiye anaweza kufanya hili'); };

/** Owner anakiwekea chama alama ya "Mafunzo" (au kuiondoa). Ni chama cha mafunzo tu kinachoweza kufutiwa data. */
ownerAmcosRouter.put('/:id/training', requirePermission('amcos.suspend'), ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const { training } = z.object({ training: z.boolean() }).passthrough().parse(req.body);
  await requireReauth(req);
  const before = await findAmcos(id);
  if (training && before.trainingResetAt) throw conflict('Data ya mafunzo ya chama hiki ilishafutwa — chama sasa kinatumika kwa kweli na hakiwezi kurudishwa kwenye mafunzo');
  const row = await db.transaction(async (tx) => {
    const [a] = await tx.update(A).set({ training }).where(eq(A.id, id)).returning();
    await audit(tx, req, { action: training ? 'AMCOS_TRAINING_ON' : 'AMCOS_TRAINING_OFF', entity: 'Amcos', entityId: id, amcosId: id, before: { training: before.training }, after: { training } });
    return a;
  });
  res.json({ amcos: row });
}));

/** Kitakachofutwa (idadi) kabla ya kufuta */
ownerAmcosRouter.get('/:id/training-reset', requirePermission('amcos.read'), ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const a = await findAmcos(id);
  const counts = await resetCounts(db, id);
  const staff = await db.select({ n: count() }).from(schema.users).where(eq(schema.users.amcosId, id));
  res.json({
    amcos: { id: a.id, name: a.name, code: a.code, training: a.training, trainingResetAt: a.trainingResetAt },
    groups: PREVIEW_GROUPS.map((g) => ({ label: g.label, count: g.keys.reduce((t, k) => t + (counts[k] ?? 0), 0) })),
    total: Object.values(counts).reduce((t, n) => t + n, 0), staffKept: staff[0].n,
  });
}));

/** Nakala (JSON) ya data yote itakayofutwa — Owner anaipakua kwanza */
ownerAmcosRouter.get('/:id/training-reset/backup', requirePermission('amcos.read'), ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const a = await findAmcos(id);
  const data = await resetBackup(db, id);
  await audit(db, req, { action: 'AMCOS_TRAINING_BACKUP', entity: 'Amcos', entityId: id, amcosId: id });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mafunzo-${a.code}-${today()}.json"`);
  res.send(JSON.stringify({ amcos: { id: a.id, name: a.name, code: a.code }, exportedAt: new Date().toISOString(), tables: data }));
}));

/**
 * Kufuta data ya mafunzo: chama cha "Mafunzo" tu, Owner pekee, code ya chama + nenosiri (+2FA).
 * Watumishi, chama, ada/subscription za CoopLink na chati ya GL vinabaki. Baada ya hapo chama kinakuwa hai (si mafunzo).
 */
ownerAmcosRouter.post('/:id/training-reset', requirePermission('amcos.suspend'), ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const { confirmAmcosCode } = z.object({ confirmAmcosCode: z.string().trim() }).passthrough().parse(req.body);
  const a = await findAmcos(id);
  if (!a.training) throw conflict('Chama hiki hakina alama ya "Mafunzo" — data yake haiwezi kufutwa');
  if (confirmAmcosCode.toUpperCase() !== a.code.toUpperCase()) throw badRequest(`Andika code ya chama (${a.code}) kuthibitisha`);
  await requireReauth(req);
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from amcos where id = ${id} for update`);
    const deleted = await runTrainingReset(tx, id);
    const total = Object.values(deleted).reduce((t, n) => t + n, 0);
    await tx.update(A).set({ training: false, trainingResetAt: new Date(), trainingResetById: req.auth!.userId }).where(eq(A.id, id));
    await audit(tx, req, { action: 'AMCOS_TRAINING_RESET', entity: 'Amcos', entityId: id, amcosId: id, after: { total, deleted: Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0)) } });
    return { total, deleted };
  });
  res.json({ ok: true, total: out.total, groups: PREVIEW_GROUPS.map((g) => ({ label: g.label, count: g.keys.reduce((t, k) => t + (out.deleted[k] ?? 0), 0) })) });
}));

// ------------------------------ WATUMISHI WA AMCOS (nafasi 3) ------------------------------
const U = schema.users;
const staffCols = {
  id: U.id, fullName: U.fullName, phone: U.phone, email: U.email, role: U.role, isActive: U.isActive,
  mustChangePassword: U.mustChangePassword, lastLoginAt: U.lastLoginAt, createdAt: U.createdAt, updatedAt: U.updatedAt,
};

/** Nafasi tatu (Meneja, Mhasibu, Storekeeper) na historia ya waliowahi kushika nafasi hizo. */
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
  body.fullName = (await verifiedName(body.phone, body.fullName))!; // jina kutoka mobile money
  const a = await findAmcos(id);
  if (a.status === 'REJECTED') throw badRequest('Chama hiki kimekataliwa');
  const holder = await db.query.users.findFirst({ where: and(eq(U.amcosId, id), eq(U.role, body.role), eq(U.isActive, true)) });
  if (holder && !body.replace) await assertSlotFree(db, id, body.role);
  if (holder) await requireReauth(req);
  await assertPhoneFree(body.phone);
  const ownPassword = !!body.password;
  const password = body.password ?? tempPassword();
  const pending = a.status !== 'ACTIVE';
  const user = await db.transaction(async (tx) => {
    if (holder) {
      await tx.update(U).set({ isActive: false, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, holder.id));
      await audit(tx, req, { action: 'AMCOS_STAFF_REPLACED', entity: 'User', entityId: holder.id, amcosId: id, before: { isActive: true, role: holder.role, fullName: holder.fullName }, after: { isActive: false } });
    }
    const [u] = await tx.insert(U).values({
      fullName: body.fullName, phone: body.phone, email: body.email ?? null, role: body.role, amcosId: id,
      passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: ownPassword || pending ? null : tempExpiry(),
    }).returning(staffCols);
    await audit(tx, req, { action: 'AMCOS_STAFF_ASSIGN', entity: 'User', entityId: u.id, amcosId: id, after: { ...u, title: STAFF_TITLE[body.role as AmcosStaffRole], replaced: holder?.id ?? null } });
    return u;
  });
  // Nenosiri la muda linatumwa kwa SMS kwa mtumishi (Owner halioni); SMS ikishindwa, linarudishwa mara moja.
  // Nenosiri alilochagua Owner halitumwi wala halirudishwi.
  const delivery = ownPassword ? null : await sendTempCredentials({ ...user, amcosId: id }, password, { kind: 'NEW', amcosName: a.name, pending });
  if (delivery) await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: user.id, amcosId: id, after: { channel: 'SMS', status: delivery.status, kind: 'NEW' } });
  res.status(201).json({ user, delivery, temporaryPassword: ownPassword || delivery?.status === 'SENT' ? null : password });
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
  const a = await findAmcos(id);
  const pending = a.status !== 'ACTIVE';
  const password = tempPassword();
  await db.transaction(async (tx) => {
    await tx.update(U).set({ passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: pending ? null : tempExpiry(), tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, userId));
    await audit(tx, req, { action: 'AMCOS_STAFF_PASSWORD_RESET', entity: 'User', entityId: userId, amcosId: id });
  });
  const delivery = await sendTempCredentials(u, password, { kind: u.lastLoginAt ? 'RESET' : 'NEW', amcosName: a.name, pending });
  await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: userId, amcosId: id, after: { channel: 'SMS', status: delivery.status, kind: 'RESET' } });
  res.json({ delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
}));

ownerAmcosRouter.post('/:id/staff/:userId/active', requirePermission('amcos.staff'), ah(async (req, res) => {
  const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const u = await scopedStaff(id, userId);
  if (u.isActive === isActive) throw badRequest(isActive ? 'Akaunti tayari iko hai' : 'Akaunti tayari imezimwa');
  if (!isActive) await requireReauth(req);
  if (isActive) {
    await assertPhoneFree(u.phone, u.id);
    if (u.role === 'AMCOS_VIEWER') throw badRequest('AMCOS ina watumishi watatu tu: Meneja, Mhasibu na Storekeeper');
    await assertSlotFree(db, id, u.role, u.id);
  }
  const user = await db.transaction(async (tx) => {
    const [r] = await tx.update(U).set({ isActive, ...(isActive ? {} : { tokenVersion: sql`${U.tokenVersion} + 1` }) }).where(eq(U.id, userId)).returning(staffCols);
    await audit(tx, req, { action: isActive ? 'AMCOS_STAFF_ACTIVATE' : 'AMCOS_STAFF_DEACTIVATE', entity: 'User', entityId: userId, amcosId: id, before: { isActive: u.isActive }, after: { isActive } });
    return r;
  });
  res.json({ user });
}));
