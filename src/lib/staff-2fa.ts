// 2FA ni lazima kwa wafanyakazi wa CoopLink (v0.38): wana siku `graceDays` (kuanzia toleo hili au akaunti ilipoundwa) kuiwasha.
// Muda ukiisha, hawawezi kutumia Owner Panel mpaka waiwashe (Akaunti yangu). Owner hahusiki (asijifungie nje).
import type { Request, Response, NextFunction } from 'express';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { getSetting } from './settings';
import { isStaffRole } from './permissions';
import { AppError } from './errors';
import type { Role } from '../middleware/auth';

/** v2.4: Meneja na Mhasibu wa chama — wanaidhinisha na kutoa fedha za wakulima, kwa hiyo 2FA ni lazima kwao pia. */
export const AMCOS_2FA_ROLES = ['AMCOS_ADMIN', 'ACCOUNTANT'] as const;

export async function staff2fa(u: { role: string; totpEnabled: boolean; createdAt: Date }, now = Date.now()) {
  const cfg = await getSetting('security');
  const none = { required: false, deadline: null as string | null, overdue: false };
  if (u.totpEnabled) return none;
  let sinceIso: string, days: number;
  if (isStaffRole(u.role as Role) || u.role === 'COOP_OFFICER') { if (!cfg.staff2fa) return none; sinceIso = cfg.staff2faSince; days = cfg.graceDays; }
  else if ((AMCOS_2FA_ROLES as readonly string[]).includes(u.role)) { if (!cfg.amcos2fa) return none; sinceIso = cfg.amcos2faSince; days = cfg.amcosGraceDays; }
  else return none;
  const since = Math.max(new Date(sinceIso).getTime(), u.createdAt.getTime());
  const deadline = new Date(since + days * 86_400_000);
  return { required: true, deadline: deadline.toISOString(), overdue: deadline.getTime() < now };
}

/**
 * v2.4: Meneja/Mhasibu aliyepita muda bila 2FA anazuiwa kwenye data za chama (backend — si kuficha menyu).
 * Bado anaweza: kuingia, kuwasha 2FA (/auth/*), arifa, ada ya CoopLink na tiketi za msaada (zimewekwa kabla ya kinga hii).
 */
export async function requireAmcos2fa(req: Request, _res: Response, next: NextFunction) {
  try {
    const a = req.auth;
    if (!a || !(AMCOS_2FA_ROLES as readonly string[]).includes(a.role)) return next();
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId), columns: { role: true, totpEnabled: true, createdAt: true } });
    if (u && (await staff2fa(u)).overdue) return next(new AppError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Washa 2FA (Mipangilio → Akaunti yangu) ili kuendelea kutumia mfumo.'));
    next();
  } catch (e) { next(e); }
}

/** Owner Panel: mfanyakazi aliyepita muda bila 2FA anazuiwa (anaweza tu kuiwasha kupitia /auth/2fa/*). */
export async function requireStaff2fa(req: Request, _res: Response, next: NextFunction) {
  try {
    const a = req.auth;
    if (!a || !isStaffRole(a.role)) return next();
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId), columns: { role: true, totpEnabled: true, createdAt: true } });
    if (u && (await staff2fa(u)).overdue) {
      return next(new AppError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Washa 2FA (Akaunti yangu) ili kuendelea kutumia Owner Panel.'));
    }
    next();
  } catch (e) { next(e); }
}

/**
 * v0.43 — Afisa Ushirika: (1) ANASOMA TU data za vyama — hawezi kubadilisha chochote cha chama (backend, si kuficha menyu);
 * kazi zake za kuandika ziko /oversight pekee. (2) 2FA ni lazima kama kwa wafanyakazi wa CoopLink.
 */
const OFFICER_WRITE_OK = [/^\/oversight(\/|$)/, /^\/bank\/voucher\/[0-9a-f-]{36}\/print$/];
export async function officerGuard(req: Request, _res: Response, next: NextFunction) {
  try {
    const a = req.auth;
    if (!a || a.role !== 'COOP_OFFICER') return next();
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, a.userId), columns: { role: true, totpEnabled: true, createdAt: true } });
    if (u && (await staff2fa(u)).overdue) return next(new AppError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Washa 2FA (Akaunti yangu) ili kuendelea kutumia mfumo.'));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !OFFICER_WRITE_OK.some((r) => r.test(req.path))) {
      return next(new AppError(403, 'OFFICER_READ_ONLY', 'Afisa Ushirika anaona tu data za chama. Tumia Ukaguzi au Maagizo kuelekeza chama kurekebisha.'));
    }
    next();
  } catch (e) { next(e); }
}
