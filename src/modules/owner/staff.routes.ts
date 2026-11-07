// STAFF MANAGEMENT — wafanyakazi wa NAYA GROUP / CoopLink. Owner pekee (staff.manage).
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { activeSessionsWhere, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { hashPassword, tempPassword } from '../../lib/security';
import { effectivePermissions, PERMISSIONS, PLATFORM_ROLES, ROLE_DEFAULTS, sanitizePermissions, STAFF_ROLES } from '../../lib/permissions';

export const staffRouter = Router();
staffRouter.use(requirePermission('staff.manage'));
const U = schema.users;

const cols = {
  id: U.id, fullName: U.fullName, phone: U.phone, email: U.email, role: U.role, jobTitle: U.jobTitle,
  permissions: U.permissions, isActive: U.isActive, mustChangePassword: U.mustChangePassword, totpEnabled: U.totpEnabled,
  lastLoginAt: U.lastLoginAt, createdAt: U.createdAt,
};
const withPerms = <T extends { role: (typeof schema.roleEnum.enumValues)[number]; permissions: string[] | null }>(u: T) =>
  ({ ...u, customPermissions: u.permissions !== null, permissions: effectivePermissions(u.role, u.permissions) });

async function findStaff(id: string) {
  const [u] = await db.select(cols).from(U).where(and(eq(U.id, id), inArray(U.role, PLATFORM_ROLES)));
  if (!u) throw notFound('Mfanyakazi');
  return u;
}

staffRouter.get(
  '/permissions',
  ah(async (_req, res) => {
    res.json({ permissions: PERMISSIONS, roleDefaults: ROLE_DEFAULTS, roles: STAFF_ROLES });
  }),
);

staffRouter.get(
  '/',
  ah(async (_req, res) => {
    const rows = await db.select(cols).from(U).where(inArray(U.role, PLATFORM_ROLES)).orderBy(U.role, U.fullName);
    res.json({ data: rows.map(withPerms) });
  }),
);

const staffRole = z.enum(STAFF_ROLES as [string, ...string[]]).transform((r) => r as (typeof STAFF_ROLES)[number]);

staffRouter.post(
  '/',
  ah(async (req, res) => {
    const b = z.object({
      fullName: z.string().trim().min(3), phone: phoneSchema, email: z.string().email().nullable().optional(),
      role: staffRole, jobTitle: z.string().trim().nullable().optional(),
      permissions: z.array(z.string()).nullable().optional(),
    }).parse(req.body);
    const password = tempPassword();
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(U).values({
        fullName: b.fullName, phone: b.phone, email: b.email ?? null, role: b.role, jobTitle: b.jobTitle ?? null,
        permissions: b.permissions ? sanitizePermissions(b.permissions) : null,
        passwordHash: await hashPassword(password), mustChangePassword: true,
      }).returning(cols);
      await audit(tx, req, { action: 'STAFF_CREATE', entity: 'User', entityId: u.id, after: u });
      return u;
    });
    res.status(201).json({ staff: withPerms(user), temporaryPassword: password });
  }),
);

staffRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = z.object({
      fullName: z.string().trim().min(3).optional(), email: z.string().email().nullable().optional(),
      jobTitle: z.string().trim().nullable().optional(), role: staffRole.optional(),
      permissions: z.array(z.string()).nullable().optional(), // null = rudi kwenye ruhusa za role
    }).parse(req.body);
    const before = await findStaff(id);
    if (before.role === 'SUPER_ADMIN') throw forbidden('Akaunti ya Owner inahaririwa kwenye Owner Settings');
    const data: Partial<typeof U.$inferInsert> = { fullName: b.fullName, email: b.email, jobTitle: b.jobTitle, role: b.role };
    if (b.permissions !== undefined) data.permissions = b.permissions === null ? null : sanitizePermissions(b.permissions);
    const changedAccess = (b.role && b.role !== before.role) || b.permissions !== undefined;
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(U).set({ ...data, ...(changedAccess ? { tokenVersion: sql`${U.tokenVersion} + 1` } : {}) }).where(eq(U.id, id)).returning(cols);
      if (changedAccess) await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: 'STAFF_UPDATE', entity: 'User', entityId: id, before, after: u });
      return u;
    });
    res.json({ staff: withPerms(row) });
  }),
);

staffRouter.post(
  '/:id/active',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    const before = await findStaff(id);
    if (before.role === 'SUPER_ADMIN') throw forbidden('Huwezi kuzima akaunti ya Owner hapa');
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(U).set({ isActive, ...(isActive ? {} : { tokenVersion: sql`${U.tokenVersion} + 1` }) }).where(eq(U.id, id)).returning(cols);
      if (!isActive) await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: isActive ? 'STAFF_ACTIVATE' : 'STAFF_DEACTIVATE', entity: 'User', entityId: id, before: { isActive: before.isActive }, after: { isActive } });
      return u;
    });
    res.json({ staff: withPerms(row) });
  }),
);

staffRouter.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const before = await findStaff(id);
    if (before.role === 'SUPER_ADMIN') throw badRequest('Owner anabadilisha nenosiri lake kwenye Owner Settings');
    const password = tempPassword();
    await db.transaction(async (tx) => {
      await tx.update(U).set({ passwordHash: await hashPassword(password), mustChangePassword: true, tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, id));
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: 'STAFF_PASSWORD_RESET', entity: 'User', entityId: id });
    });
    res.json({ temporaryPassword: password });
  }),
);

staffRouter.get(
  '/:id/logins',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await findStaff(id);
    const rows = await db.select().from(schema.loginEvents).where(eq(schema.loginEvents.userId, id)).orderBy(desc(schema.loginEvents.createdAt)).limit(50);
    res.json({ data: rows });
  }),
);

staffRouter.get(
  '/:id/activity',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await findStaff(id);
    const rows = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, id)).orderBy(desc(schema.auditLogs.createdAt)).limit(100);
    res.json({ data: rows });
  }),
);
