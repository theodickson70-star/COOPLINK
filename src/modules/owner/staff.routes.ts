// STAFF MANAGEMENT — wafanyakazi wa DUKALANGU SOLUTION / CoopLink. Owner pekee (staff.manage).
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { sendNow } from '../../lib/sms';
import { getSetting } from '../../lib/settings';
import { ROLE_TITLE_SW, TEMP_PASSWORD_HOURS } from '../../lib/staff-credentials';
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
 * Nenosiri la muda linatumwa kwa SMS kwa mfanyakazi mwenyewe (Owner haoni nenosiri).
 * Kumbukumbu ya SMS inahifadhiwa BILA nenosiri. SMS ikishindwa, nenosiri linarudishwa kwa Owner mara moja tu ili ampe kwa mkono.
 */
async function sendCredentials(u: { id: string; fullName: string; phone: string; role: string }, password: string, kind: 'NEW' | 'RESET') {
  const site = (await getSetting('business.profile')).website || 'cooplink';
  const local = u.phone.replace(/^255/, '0');
  const head = kind === 'NEW'
    ? `CoopLink: Karibu ${u.fullName.split(' ')[0]}! Umesajiliwa kama ${ROLE_TITLE_SW[u.role] ?? 'mfanyakazi'}.`
    : `CoopLink: ${u.fullName.split(' ')[0]}, nenosiri jipya la muda limetolewa kwa akaunti yako.`;
  const tail = `Ingia: ${site}/login Simu: ${local} Nenosiri la muda: ${password} (linaisha baada ya saa ${TEMP_PASSWORD_HOURS}). Utaweka nenosiri lako. Usimpe mtu yeyote.`;
  const r = await sendNow({ kind: 'STAFF_CREDENTIALS', phone: u.phone, userId: u.id, text: `${head} ${tail}`,
    logText: `${head} ${tail.replace(password, '••••••••')}` });
  const masked = local.replace(/^(\d{4})\d{3}(\d{3})$/, '$1•••$2');
  return { status: r.status, phone: masked, error: r.status === 'SENT' ? null : r.error ?? null };
}
const tempExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000);

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
    }).parse(req.body);
    const taken = await db.query.users.findFirst({ where: eq(U.phone, b.phone), columns: { id: true, role: true } });
    if (taken) throw conflict('Namba hii ya simu tayari ina akaunti kwenye CoopLink');
    b.fullName = (await verifiedName(b.phone, b.fullName))!; // jina kutoka usajili wa mobile money
    const password = tempPassword();
    const user = await db.transaction(async (tx) => {
      const [u] = await tx.insert(U).values({
        fullName: b.fullName, phone: b.phone, email: b.email ?? null, role: b.role, jobTitle: b.jobTitle ?? null,
        permissions: b.permissions ? sanitizePermissions(b.permissions) : null,
        passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(),
      }).returning(cols);
      await audit(tx, req, { action: 'STAFF_CREATE', entity: 'User', entityId: u.id, after: u });
      return u;
    });
    const delivery = await sendCredentials(user, password, 'NEW');
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
    const delivery = await sendCredentials(before, password, before.lastLoginAt ? 'RESET' : 'NEW');
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
