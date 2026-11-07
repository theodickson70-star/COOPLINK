import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, phoneSchema } from '../lib/http';
import { hashPassword, passwordSchemaRule, signToken, verifyPassword } from '../lib/security';
import { AppError, badRequest } from '../lib/errors';
import { authenticateAllowPending as authenticate } from '../middleware/auth';
import { audit } from '../lib/audit';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Makosa 10 kwa dakika 15. Kuingia kwa mafanikio hakuhesabiwi, ili ofisi
  // yenye wafanyakazi wengi wanaotumia mtandao mmoja (IP moja) isizuiwe.
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Majaribio mengi. Subiri dakika 15.' } },
});

function publicUser(u: typeof schema.users.$inferSelect) {
  const { passwordHash, tokenVersion, ...rest } = u;
  return rest;
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = z.object({ phone: phoneSchema, password: z.string().min(1) }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.phone, body.phone) });
    // Ujumbe mmoja kwa makosa yote — usimwambie mshambuliaji kama namba ipo
    const ok = user && user.isActive && (await verifyPassword(body.password, user.passwordHash));
    if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Namba ya simu au nenosiri si sahihi');

    await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    const token = signToken({ sub: user.id, tv: user.tokenVersion });
    res.json({ token, user: publicUser(user) });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) });
    const amcos = user?.amcosId
      ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, user.amcosId) })
      : null;
    res.json({ user: publicUser(user!), amcos });
  }),
);

authRouter.post(
  '/change-password',
  authenticate,
  ah(async (req, res) => {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().refine(passwordSchemaRule.test, passwordSchemaRule.message),
      })
      .parse(req.body);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) }))!;
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new AppError(400, 'WRONG_PASSWORD', 'Nenosiri la sasa si sahihi');
    }
    if (body.currentPassword === body.newPassword) throw badRequest('Nenosiri jipya lisifanane na la zamani');

    const [updated] = await db.transaction(async (tx) => {
      const r = await tx
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(body.newPassword),
          mustChangePassword: false,
          tokenVersion: sql`${schema.users.tokenVersion} + 1`,
        })
        .where(eq(schema.users.id, user.id))
        .returning();
      await audit(tx, req, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: user.id });
      return r;
    });
    // Tokens za zamani zimekufa — mpe token mpya
    res.json({ token: signToken({ sub: updated.id, tv: updated.tokenVersion }), user: publicUser(updated) });
  }),
);

// Toka kwenye vifaa vyote
authRouter.post(
  '/logout-all',
  authenticate,
  ah(async (req, res) => {
    await db
      .update(schema.users)
      .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
      .where(eq(schema.users.id, req.auth!.userId));
    res.json({ ok: true });
  }),
);
