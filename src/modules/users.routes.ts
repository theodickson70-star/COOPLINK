import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, paged, paginationQuery, phoneSchema, uuidParam } from '../lib/http';
import { hashPassword, tempPassword } from '../lib/security';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { requireRole, ROLES, type Role } from '../middleware/auth';
import { canAccessAmcos } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { sendTempCredentials, tempExpiry } from '../lib/staff-credentials';
import { assertPhoneFree } from '../lib/user-phone';
import { isPlatformRole, isStaffRole } from '../lib/permissions';
import { verifiedName } from '../lib/name-lookup';
import { assertSlotFree } from '../lib/amcos-staff';

import { clearStaffingCache } from '../lib/amcos-permissions';
export const usersRouter = Router();
// Mtumishi akiongezwa/akibadilishwa: hali ya "Meneja pekee" inahesabiwa upya mara moja
usersRouter.use((req, res, next) => { if (req.method !== 'GET') res.on('finish', clearStaffingCache); next(); });

const UNION_ROLES: Role[] = ['UNION_ADMIN', 'UNION_VIEWER'];
const AMCOS_ROLES: Role[] = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'];
// Watumishi wa AMCOS (Meneja, Mhasibu, Storekeeper) wanasimamiwa na Owner wa CoopLink tu — nafasi moja kwa kila cheo.

const userCols = {
  id: schema.users.id, fullName: schema.users.fullName, phone: schema.users.phone, email: schema.users.email,
  role: schema.users.role, unionId: schema.users.unionId, amcosId: schema.users.amcosId,
  isActive: schema.users.isActive, mustChangePassword: schema.users.mustChangePassword,
  lastLoginAt: schema.users.lastLoginAt, createdAt: schema.users.createdAt,
};

/** Nani anaweza kuunda/kusimamia role gani, wapi. */
async function assertCanManage(req: Request, target: { role: Role; unionId?: string | null; amcosId?: string | null }) {
  const me = req.auth!;
  if (me.role === 'SUPER_ADMIN') return;
  if (target.role === 'SUPER_ADMIN') throw forbidden();

  if (me.role === 'UNION_ADMIN') {
    if (UNION_ROLES.includes(target.role)) {
      if (target.unionId !== me.unionId) throw forbidden();
      return;
    }
    throw forbidden('Watumishi wa AMCOS wanasimamiwa na Owner wa CoopLink');
  }
  if (me.role === 'AMCOS_ADMIN') throw forbidden('Watumishi wa AMCOS wanasimamiwa na Owner wa CoopLink');
  void canAccessAmcos;
  throw forbidden();
}

function scopeUsers(req: Request): SQL | undefined {
  const me = req.auth!;
  if (me.role === 'SUPER_ADMIN') return undefined;
  if (me.role === 'UNION_ADMIN') {
    return or(
      eq(schema.users.unionId, me.unionId!),
      inArray(schema.users.amcosId, db.select({ id: schema.amcos.id }).from(schema.amcos).where(eq(schema.amcos.unionId, me.unionId!))),
    );
  }
  return eq(schema.users.amcosId, me.amcosId!);
}

usersRouter.get(
  '/',
  requireRole(ROLES.ADMINS),
  ah(async (req, res) => {
    const q = paginationQuery.extend({ search: z.string().optional(), amcosId: z.string().uuid().optional() }).parse(req.query);
    const where = and(
      scopeUsers(req),
      q.amcosId ? eq(schema.users.amcosId, q.amcosId) : undefined,
      q.search ? or(ilike(schema.users.fullName, `%${q.search}%`), ilike(schema.users.phone, `%${q.search}%`)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select(userCols).from(schema.users).where(where).orderBy(desc(schema.users.createdAt))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(schema.users).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

usersRouter.post(
  '/',
  requireRole(ROLES.ADMINS),
  ah(async (req, res) => {
    const body = z
      .object({
        fullName: z.string().trim().min(3),
        phone: phoneSchema,
        email: z.string().email().optional(),
        role: z.enum(schema.roleEnum.enumValues),
        unionId: z.string().uuid().optional(),
        amcosId: z.string().uuid().optional(),
      })
      .parse(req.body);
    // Jina linatoka kwenye usajili wa mobile money wa namba hii (haliandikwi kwa mkono)
    body.fullName = (await verifiedName(body.phone, body.fullName))!;

    // Wafanyakazi wa jukwaa wanasimamiwa kwenye Owner > Staff Management
    if (isStaffRole(body.role)) throw badRequest('Tumia Staff Management kuunda wafanyakazi wa CoopLink');
    // Watumiaji wa chama hawahitaji kutaja amcosId — ni chama chao
    if (req.auth!.role === 'AMCOS_ADMIN') body.amcosId = req.auth!.amcosId!;
    if (req.auth!.role === 'UNION_ADMIN' && UNION_ROLES.includes(body.role)) body.unionId = req.auth!.unionId!;

    if (UNION_ROLES.includes(body.role)) {
      if (!body.unionId) throw badRequest('Chagua Chama Kikuu (unionId)');
      body.amcosId = undefined;
    } else if (AMCOS_ROLES.includes(body.role)) {
      if (!body.amcosId) throw badRequest('Chagua chama (amcosId)');
      body.unionId = undefined;
    } else {
      body.unionId = undefined;
      body.amcosId = undefined;
    }
    await assertCanManage(req, body);
    if (body.role === 'AMCOS_VIEWER') throw badRequest('AMCOS ina watumishi watatu tu: Meneja, Mhasibu na Storekeeper');
    if (body.amcosId) await assertSlotFree(db, body.amcosId, body.role);
    await assertPhoneFree(body.phone);

    const password = tempPassword();
    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.users)
        .values({ ...body, passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry() })
        .returning(userCols);
      await audit(tx, req, { action: 'USER_CREATE', entity: 'User', entityId: u.id, amcosId: u.amcosId, after: u });
      return u;
    });
    // Nenosiri la muda linatumwa kwa SMS kwa mtumiaji mwenyewe; SMS ikishindwa, linaonyeshwa MARA MOJA tu
    const a = user.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, user.amcosId), columns: { name: true } }) : null;
    const delivery = await sendTempCredentials(user, password, { kind: 'NEW', amcosName: a?.name });
    await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: user.id, amcosId: user.amcosId, after: { channel: 'SMS', status: delivery.status, kind: 'NEW' } });
    res.status(201).json({ user, delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
  }),
);

usersRouter.patch(
  '/:id',
  requireRole(ROLES.ADMINS),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = z
      .object({
        fullName: z.string().trim().min(3).optional(),
        email: z.string().email().nullable().optional(),
        role: z.enum(schema.roleEnum.enumValues).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);

    const existing = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!existing) throw notFound('Mtumiaji');
    if (body.fullName !== undefined) body.fullName = (await verifiedName(existing.phone, body.fullName))!;
    if (existing.id === req.auth!.userId && (body.isActive === false || body.role)) {
      throw forbidden('Huwezi kubadilisha role au kujizima mwenyewe');
    }
    await assertCanManage(req, existing);
    if (isPlatformRole(existing.role) || (body.role && isPlatformRole(body.role))) {
      throw badRequest('Wasimamizi wa jukwaa wanasimamiwa kwenye Owner > Staff Management');
    }
    if (body.role) {
      const sameKind =
        (UNION_ROLES.includes(body.role) && UNION_ROLES.includes(existing.role)) ||
        (AMCOS_ROLES.includes(body.role) && AMCOS_ROLES.includes(existing.role)) ||
        req.auth!.role === 'SUPER_ADMIN';
      if (!sameKind) throw badRequest('Role mpya hailingani na aina ya mtumiaji');
      await assertCanManage(req, { ...existing, role: body.role });
      if (body.role === 'AMCOS_VIEWER') throw badRequest('AMCOS ina watumishi watatu tu: Meneja, Mhasibu na Storekeeper');
    }
    const willBeActive = body.isActive ?? existing.isActive;
    if (willBeActive && !existing.isActive) await assertPhoneFree(existing.phone, existing.id);
    if (existing.amcosId && willBeActive) await assertSlotFree(db, existing.amcosId, body.role ?? existing.role, existing.id);

    const updated = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(schema.users)
        .set({
          ...body,
          // Akizimwa au role ikibadilika, tokens zake za zamani zinakufa mara moja
          ...(body.isActive === false || body.role ? { tokenVersion: sql`${schema.users.tokenVersion} + 1` } : {}),
        })
        .where(eq(schema.users.id, id))
        .returning(userCols);
      await audit(tx, req, { action: 'USER_UPDATE', entity: 'User', entityId: id, amcosId: u.amcosId, before: existing, after: u });
      return u;
    });
    res.json({ user: updated });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requireRole(ROLES.ADMINS),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const existing = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
    if (!existing) throw notFound('Mtumiaji');
    await assertCanManage(req, existing);
    const password = tempPassword();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(), tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.id, id));
      await audit(tx, req, { action: 'USER_PASSWORD_RESET', entity: 'User', entityId: id, amcosId: existing.amcosId });
    });
    const a = existing.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, existing.amcosId), columns: { name: true } }) : null;
    const delivery = await sendTempCredentials(existing, password, { kind: existing.lastLoginAt ? 'RESET' : 'NEW', amcosName: a?.name });
    await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: id, amcosId: existing.amcosId, after: { channel: 'SMS', status: delivery.status, kind: 'RESET' } });
    res.json({ delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
  }),
);
