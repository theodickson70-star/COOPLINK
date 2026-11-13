// STAFF MANAGEMENT — wafanyakazi wa DUKALANGU SOLUTION / CoopLink. Owner pekee (staff.manage).
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { ROLE_TITLE_SW, sendTempCredentials, tempExpiry } from '../../lib/staff-credentials';
import { activeHolder, assertPhoneFree } from '../../lib/user-phone';
import { activeSessionsWhere, requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { hashPassword, tempPassword } from '../../lib/security';
import { verifiedName } from '../../lib/name-lookup';
import { effectivePermissions, HIRABLE_ROLES, PERMISSIONS, PLATFORM_ROLES, ROLE_DEFAULTS, sanitizePermissions, STAFF_ROLES } from '../../lib/permissions';

export const staffRouter = Router();
staffRouter.use(requirePermission('staff.manage'));
const U = schema.users;

const cols = {
  id: U.id, fullName: U.fullName, phone: U.phone, email: U.email, role: U.role, jobTitle: U.jobTitle,
  permissions: U.permissions, isActive: U.isActive, mustChangePassword: U.mustChangePassword, totpEnabled: U.totpEnabled,
  lastLoginAt: U.lastLoginAt, createdAt: U.createdAt, tempPasswordExpiresAt: U.tempPasswordExpiresAt,
};
const withPerms = <T extends { role: (typeof schema.roleEnum.enumValues)[number]; permissions: string[] | null }>(u: T) =>
  ({ ...u, customPermissions: u.permissions !== null, permissions: effectivePermissions(u.role, u.permissions) });

/**
 * Namba ya simu ina akaunti tayari? (namba moja = akaunti moja kwenye CoopLink)
 * reusable = mfanyakazi wa CoopLink aliyezimwa — anaweza kurejeshwa na kupewa cheo kipya bila kuunda akaunti mpya.
 */
async function phoneHolder(phoneNo: string, me: string) {
  // Akaunti iliyo hai ndiyo inazuia; iliyozimwa haizuii (akaunti mpya inaundwa, ya zamani inabaki na historia yake)
  const active = await activeHolder(phoneNo);
  if (active) {
    return { blocked: true, reusable: false, id: active.id, fullName: active.fullName, title: active.title, isMe: active.id === me,
      message: active.id === me ? 'Hii ni namba ya akaunti yako ya Owner — mfanyakazi apewe namba yake mwenyewe'
        : `Namba hii inatumika na akaunti iliyo hai ya ${active.fullName} — ${active.title}. Izime kwanza au tumia namba nyingine.` };
  }
  const old = await db.query.users.findFirst({ where: and(eq(U.phone, phoneNo), eq(U.isActive, false)), orderBy: desc(U.updatedAt),
    columns: { id: true, fullName: true, role: true, amcosId: true } });
  if (!old) return null;
  const amcos = old.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, old.amcosId), columns: { name: true } }) : null;
  const title = `${ROLE_TITLE_SW[old.role] ?? old.role}${amcos ? ` wa ${amcos.name}` : ''}`;
  const reusable = (STAFF_ROLES as string[]).includes(old.role);
  return { blocked: false, reusable, id: old.id, fullName: old.fullName, title, isMe: false,
    message: reusable
      ? `Namba hii ilikuwa ya ${old.fullName} (${title}, amezimwa). Unaweza kumrejesha kwenye akaunti yake ya zamani, au kuunda akaunti mpya.`
      : `Namba hii ilikuwa ya ${old.fullName} (${title}, amezimwa). Akaunti mpya itaundwa kwa namba ile ile; ya zamani inabaki na historia yake.` };
}

async function findStaff(id: string) {
  const [u] = await db.select(cols).from(U).where(and(eq(U.id, id), inArray(U.role, PLATFORM_ROLES)));
  if (!u) throw notFound('Mfanyakazi');
  return u;
}

staffRouter.get(
  '/permissions',
  ah(async (_req, res) => {
    res.json({ permissions: PERMISSIONS, roleDefaults: ROLE_DEFAULTS, roles: HIRABLE_ROLES, legacyRoles: STAFF_ROLES.filter((r) => !HIRABLE_ROLES.includes(r)) });
  }),
);

staffRouter.get(
  '/phone-check',
  ah(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.query);
    const holder = await phoneHolder(phone, req.auth!.userId);
    res.json({ phone, available: !holder?.blocked, holder });
  }),
);

staffRouter.get(
  '/',
  ah(async (_req, res) => {
    const rows = await db.select(cols).from(U).where(inArray(U.role, PLATFORM_ROLES)).orderBy(U.role, U.fullName);
    res.json({ data: rows.map(withPerms) });
  }),
);

// Vyeo vipya: Finance Manager na Huduma kwa Wateja na Masoko pekee (Tech Support ni ya Owner)
const staffRole = z.string().refine((r) => (HIRABLE_ROLES as string[]).includes(r), 'Chagua cheo: Finance Manager au Huduma kwa Wateja na Masoko')
  .transform((r) => r as (typeof STAFF_ROLES)[number]);

staffRouter.post(
  '/',
  ah(async (req, res) => {
    const b = z.object({
      fullName: z.string().trim().min(3), phone: phoneSchema, email: z.string().trim().email('Email si sahihi').nullable().optional(),
      role: staffRole, jobTitle: z.string().trim().max(80).nullable().optional(),
      permissions: z.array(z.string()).nullable().optional(),
      reactivate: z.boolean().optional(),  // rejesha mfanyakazi wa CoopLink aliyezimwa (namba ile ile)
    }).parse(req.body);
    const holder = await phoneHolder(b.phone, req.auth!.userId);
    if (holder?.blocked) throw conflict(holder.message, { code: 'PHONE_TAKEN', holder });
    b.fullName = (await verifiedName(b.phone, b.fullName))!; // jina kutoka usajili wa mobile money
    const password = tempPassword();
    if (holder?.reusable && b.reactivate) {
      // Mfanyakazi wa zamani anarejeshwa: akaunti ile ile (historia yake inabaki), cheo/ruhusa mpya, nenosiri jipya kwa SMS
      const before = await findStaff(holder.id);
      const user = await db.transaction(async (tx) => {
        const [u] = await tx.update(U).set({
          fullName: b.fullName, email: b.email ?? null, role: b.role, jobTitle: b.jobTitle ?? null,
          permissions: b.permissions ? sanitizePermissions(b.permissions) : null, isActive: true,
          passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(), tokenVersion: sql`${U.tokenVersion} + 1`,
        }).where(eq(U.id, holder.id)).returning(cols);
        await audit(tx, req, { action: 'STAFF_REACTIVATE', entity: 'User', entityId: u.id, before, after: u });
        return u;
      });
      const delivery = await sendTempCredentials(user, password, { kind: 'NEW' });
      await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: user.id, after: { channel: 'SMS', status: delivery.status, kind: 'NEW' } });
      return res.status(201).json({ staff: withPerms(user), delivery, reactivated: true, temporaryPassword: delivery.status === 'SENT' ? null : password });
    }
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(U).values({
        fullName: b.fullName, phone: b.phone, email: b.email ?? null, role: b.role, jobTitle: b.jobTitle ?? null,
        permissions: b.permissions ? sanitizePermissions(b.permissions) : null,
        passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(),
      }).returning(cols);
      await audit(tx, req, { action: 'STAFF_CREATE', entity: 'User', entityId: u.id, after: u });
      return u;
    });
    const delivery = await sendTempCredentials(user, password, { kind: 'NEW' });
    await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: user.id, after: { channel: 'SMS', status: delivery.status, kind: 'NEW' } });
    // Nenosiri linarudishwa kwa Owner TU kama SMS haikutumwa (ili ampe kwa mkono)
    res.status(201).json({ staff: withPerms(user), delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
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
    if (b.fullName !== undefined) b.fullName = (await verifiedName(before.phone, b.fullName))!;
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
    if (isActive && !before.isActive) await assertPhoneFree(before.phone, id);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(U).set({ isActive, ...(isActive ? {} : { tokenVersion: sql`${U.tokenVersion} + 1` }) }).where(eq(U.id, id)).returning(cols);
      if (!isActive) await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: isActive ? 'STAFF_ACTIVATE' : 'STAFF_DEACTIVATE', entity: 'User', entityId: id, before: { isActive: before.isActive }, after: { isActive } });
      return u;
    });
    res.json({ staff: withPerms(row) });
  }),
);

/** Nenosiri jipya la muda (mfanyakazi amesahau, au la mwanzo limeisha) — linatumwa kwa SMS. */
staffRouter.post(
  '/:id/reset-password',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const before = await findStaff(id);
    if (before.role === 'SUPER_ADMIN') throw badRequest('Owner anabadilisha nenosiri lake kwenye Akaunti yangu');
    if (!before.isActive) throw badRequest('Akaunti hii imezimwa — iwashe kwanza');
    const password = tempPassword();
    await db.transaction(async (tx) => {
      await tx.update(U).set({ passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(), tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, id));
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
      await audit(tx, req, { action: 'STAFF_PASSWORD_RESET', entity: 'User', entityId: id });
    });
    const delivery = await sendTempCredentials(before, password, { kind: before.lastLoginAt ? 'RESET' : 'NEW' });
    await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: id, after: { channel: 'SMS', status: delivery.status, kind: 'RESET' } });
    res.json({ delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
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
