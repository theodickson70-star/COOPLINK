import type { Request, Response, NextFunction } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { verifyPassword, verifyToken } from '../lib/security';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { effectivePermissions, isPlatformRole, isStaffRole, type Permission } from '../lib/permissions';
import { getSetting } from '../lib/settings';
import { hasAmcosPerm, type AmcosPermission } from '../lib/amcos-permissions';
import { decryptSecret, verifyTotp } from '../lib/totp';

export type Role = (typeof schema.roleEnum.enumValues)[number];

export interface AuthContext {
  userId: string;
  role: Role;
  fullName: string;
  unionId: string | null;
  amcosId: string | null;
  permissions: Permission[];
  sessionId: string | null;
}

// Makundi ya roles yanayotumika mara kwa mara
export const ROLES = {
  ALL: ['SUPER_ADMIN', 'UNION_ADMIN', 'UNION_VIEWER', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'] as Role[],
  AMCOS_STAFF: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] as Role[],      // kuandika kazi za kila siku
  AMCOS_MANAGERS: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT'] as Role[],           // kuidhinisha, bei, kufuta
  ADMINS: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] as Role[],                  // watumiaji
  SUPER: ['SUPER_ADMIN'] as Role[],
};

const INVALID = () => new AppError(401, 'TOKEN_INVALID', 'Muda wa kuingia umeisha, tafadhali ingia tena');
const SEEN_EVERY_MS = 5 * 60 * 1000;

/** Kwa /auth/me, /auth/change-password, /auth/logout-all — zinaruhusiwa hata kama nenosiri halijabadilishwa. */
export const authenticateAllowPending = (req: Request, res: Response, next: NextFunction) =>
  authenticateImpl(req, res, next, true);

export const authenticate = (req: Request, res: Response, next: NextFunction) =>
  authenticateImpl(req, res, next, false);

async function authenticateImpl(req: Request, _res: Response, next: NextFunction, allowPendingPassword: boolean) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    let payload;
    try {
      payload = verifyToken(header.slice(7));
    } catch {
      throw INVALID();
    }
    if (payload.typ === '2fa') throw INVALID(); // token ya hatua ya 2FA si token ya kuingia

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, payload.sub) });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw INVALID();

    // Session: ikifutwa (revoked) token inakufa mara moja
    if (payload.sid) {
      const s = await db.query.userSessions.findFirst({ where: and(eq(schema.userSessions.id, payload.sid), eq(schema.userSessions.userId, user.id)) });
      if (!s || s.revokedAt) throw INVALID();
      if (Date.now() - s.lastSeenAt.getTime() > SEEN_EVERY_MS) {
        await db.update(schema.userSessions).set({ lastSeenAt: new Date(), ip: req.ip ?? s.ip }).where(eq(schema.userSessions.id, s.id));
      }
    }

    if (user.amcosId) {
      const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, user.amcosId), columns: { isActive: true } });
      if (!a?.isActive) throw forbidden('Chama chako kimesitishwa kwenye mfumo');
    }

    if (user.mustChangePassword && !allowPendingPassword) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Badilisha nenosiri lako kwanza');
    }

    req.auth = {
      userId: user.id,
      role: user.role,
      fullName: user.fullName,
      unionId: user.unionId,
      amcosId: user.amcosId,
      permissions: effectivePermissions(user.role, user.permissions),
      sessionId: payload.sid ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole =
  (...allowed: Role[][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const roles = allowed.flat();
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

/** Ruhusa ya ndani ya chama (Meneja/Mhasibu/Stokipa). Inahitaji angalau moja kati ya hizi. */
export const requireAmcosPerm =
  (...perms: AmcosPermission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!perms.some((p) => hasAmcosPerm(req.auth!.role, p))) return next(forbidden('Cheo chako hakiruhusiwi kufanya hivi'));
    next();
  };

/** Watumiaji wa jukwaa tu (Owner na wafanyakazi wa NAYA). */
export function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (!isPlatformRole(req.auth.role)) return next(forbidden('Eneo hili ni la wasimamizi wa CoopLink tu'));
  next();
}

/** Lazima awe na angalau ruhusa moja kati ya hizi. */
export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!perms.some((p) => req.auth!.permissions.includes(p))) return next(forbidden('Huna ruhusa ya kufanya hivi'));
    next();
  };

/** Wafanyakazi wa jukwaa (si Owner) hawaruhusiwi kugusa data za vyama. */
export function blockPlatformStaff(req: Request, _res: Response, next: NextFunction) {
  if (req.auth && isStaffRole(req.auth.role)) return next(forbidden('Wafanyakazi wa CoopLink hawaruhusiwi kuona data za vyama'));
  next();
}

/** Maintenance mode: watumiaji wa vyama wanazuiwa; wasimamizi wa jukwaa wanaendelea. */
export async function maintenanceGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.auth && isPlatformRole(req.auth.role)) return next();
    const m = await getSetting('maintenance');
    if (m.enabled) return next(new AppError(503, 'MAINTENANCE', m.message));
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Uthibitisho wa ziada kwa vitendo nyeti (kuthibitisha/kurudisha malipo, maintenance, export, restore...).
 * Body lazima iwe na confirmPassword (na confirmCode ikiwa 2FA imewashwa).
 */
export async function requireReauth(req: Request) {
  const body = (req.body ?? {}) as { confirmPassword?: string; confirmCode?: string };
  if (!body.confirmPassword) throw new AppError(403, 'REAUTH_REQUIRED', 'Thibitisha kwa nenosiri lako ili kuendelea');
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) });
  if (!user || !(await verifyPassword(body.confirmPassword, user.passwordHash))) {
    throw new AppError(403, 'REAUTH_FAILED', 'Nenosiri la uthibitisho si sahihi');
  }
  if (user.totpEnabled && user.totpSecret) {
    if (!body.confirmCode || !verifyTotp(decryptSecret(user.totpSecret), body.confirmCode)) {
      throw new AppError(403, 'REAUTH_FAILED', 'Msimbo wa 2FA si sahihi');
    }
  }
}

export const activeSessionsWhere = (userId: string) => and(eq(schema.userSessions.userId, userId), isNull(schema.userSessions.revokedAt));
