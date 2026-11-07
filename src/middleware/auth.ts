import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { verifyToken } from '../lib/security';
import { AppError, forbidden, unauthorized } from '../lib/errors';

export type Role = (typeof schema.roleEnum.enumValues)[number];

export interface AuthContext {
  userId: string;
  role: Role;
  fullName: string;
  unionId: string | null;
  amcosId: string | null;
}

// Makundi ya roles yanayotumika mara kwa mara
export const ROLES = {
  ALL: ['SUPER_ADMIN', 'UNION_ADMIN', 'UNION_VIEWER', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'] as Role[],
  AMCOS_STAFF: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] as Role[],      // kuandika kazi za kila siku
  AMCOS_MANAGERS: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT'] as Role[],           // kuidhinisha, bei, kufuta
  ADMINS: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] as Role[],                  // watumiaji
  SUPER: ['SUPER_ADMIN'] as Role[],
};

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
      throw new AppError(401, 'TOKEN_INVALID', 'Muda wa kuingia umeisha, tafadhali ingia tena');
    }

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, payload.sub) });
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) {
      throw new AppError(401, 'TOKEN_INVALID', 'Muda wa kuingia umeisha, tafadhali ingia tena');
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
