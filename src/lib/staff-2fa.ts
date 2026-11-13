// 2FA ni lazima kwa wafanyakazi wa CoopLink (v0.38): wana siku `graceDays` (kuanzia toleo hili au akaunti ilipoundwa) kuiwasha.
// Muda ukiisha, hawawezi kutumia Owner Panel mpaka waiwashe (Akaunti yangu). Owner hahusiki (asijifungie nje).
import type { Request, Response, NextFunction } from 'express';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { getSetting } from './settings';
import { isStaffRole } from './permissions';
import { AppError } from './errors';
import type { Role } from '../middleware/auth';

export async function staff2fa(u: { role: string; totpEnabled: boolean; createdAt: Date }) {
  const cfg = await getSetting('security');
  if (!cfg.staff2fa || !isStaffRole(u.role as Role) || u.totpEnabled) return { required: false, deadline: null as string | null, overdue: false };
  const since = Math.max(new Date(cfg.staff2faSince).getTime(), u.createdAt.getTime());
  const deadline = new Date(since + cfg.graceDays * 86_400_000);
  return { required: true, deadline: deadline.toISOString(), overdue: deadline.getTime() < Date.now() };
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
