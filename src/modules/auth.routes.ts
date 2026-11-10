import crypto from 'crypto';
import { amcosPermissions } from '../lib/amcos-permissions';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { ah, phoneSchema, uuidParam } from '../lib/http';
import { hashPassword, passwordSchemaRule, signChallenge, signToken, tokenExpiry, verifyPassword, verifyToken } from '../lib/security';
import { AppError, badRequest, notFound } from '../lib/errors';
import { activeSessionsWhere, authenticateAllowPending as authenticate, requireReauth } from '../middleware/auth';
import { audit } from '../lib/audit';
import { effectivePermissions, isPlatformRole } from '../lib/permissions';
import { getSetting } from '../lib/settings';
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../lib/totp';
import { feeLock, feePayerRole, PAYER_LABEL } from '../lib/fees';
import { LEGAL_VERSION } from '../lib/legal';
import { verifiedName } from '../lib/name-lookup';
import { sendSms } from '../lib/notify';

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

type User = typeof schema.users.$inferSelect;

function publicUser(u: User) {
  const { passwordHash, tokenVersion, totpSecret, permissions, ...rest } = u;
  return { ...rest, permissions: effectivePermissions(u.role, permissions), amcosPermissions: amcosPermissions(u.role), termsRequired: u.termsVersion !== LEGAL_VERSION, legalVersion: LEGAL_VERSION };
}

const ua = (req: Request) => req.headers['user-agent']?.slice(0, 300) ?? null;

async function logLogin(req: Request, e: { userId?: string | null; phone?: string | null; success: boolean; reason: string; suspicious?: boolean }) {
  await db.insert(schema.loginEvents).values({
    userId: e.userId ?? null, phone: e.phone ?? null, success: e.success, reason: e.reason,
    suspicious: e.suspicious ?? false, ip: req.ip ?? null, userAgent: ua(req),
  });
}

/** Kuingia kwa wasimamizi wa jukwaa kutoka IP mpya, au baada ya makosa mengi, kunaalamishwa. */
async function isSuspicious(req: Request, user: User) {
  if (!isPlatformRole(user.role)) return false;
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const [prev] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginEvents)
    .where(and(eq(schema.loginEvents.userId, user.id), eq(schema.loginEvents.success, true), gte(schema.loginEvents.createdAt, since)));
  const [sameIp] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginEvents)
    .where(and(eq(schema.loginEvents.userId, user.id), eq(schema.loginEvents.success, true), eq(schema.loginEvents.ip, req.ip ?? ''), gte(schema.loginEvents.createdAt, since)));
  const [fails] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginEvents)
    .where(and(eq(schema.loginEvents.phone, user.phone), eq(schema.loginEvents.success, false), gte(schema.loginEvents.createdAt, new Date(Date.now() - 30 * 60 * 1000))));
  return (prev.n > 0 && sameIp.n === 0) || fails.n >= 5;
}

/** Unda session + token. */
async function startSession(tx: DbOrTx, req: Request, user: User) {
  const sid = crypto.randomUUID();
  const token = signToken({ sub: user.id, tv: user.tokenVersion, sid });
  await tx.insert(schema.userSessions).values({ id: sid, userId: user.id, ip: req.ip ?? null, userAgent: ua(req), expiresAt: tokenExpiry(token) });
  return token;
}

async function completeLogin(req: Request, user: User) {
  const suspicious = await isSuspicious(req, user);
  const token = await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
    return startSession(tx, req, user);
  });
  await logLogin(req, { userId: user.id, phone: user.phone, success: true, reason: 'OK', suspicious });
  if (suspicious) {
    void sendSms(user.phone, `CoopLink: akaunti yako imeingiwa kutoka kifaa/mtandao mpya (${req.ip ?? '?'}). Kama si wewe, badilisha nenosiri mara moja.`);
  }
  return { token, user: publicUser(user) };
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = z.object({ phone: phoneSchema, password: z.string().min(1) }).parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(schema.users.phone, body.phone) });
    // Ujumbe mmoja kwa makosa yote — usimwambie mshambuliaji kama namba ipo
    const fail = async (reason: string) => {
      await logLogin(req, { userId: user?.id, phone: body.phone, success: false, reason });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Namba ya simu au nenosiri si sahihi');
    };
    if (!user) return fail('UNKNOWN_PHONE');
    if (!(await verifyPassword(body.password, user.passwordHash))) return fail('BAD_PASSWORD');
    if (!user.isActive) return fail('INACTIVE');

    if (user.amcosId) {
      const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, user.amcosId), columns: { isActive: true } });
      if (!a?.isActive) {
        await logLogin(req, { userId: user.id, phone: user.phone, success: false, reason: 'AMCOS_SUSPENDED' });
        throw new AppError(403, 'AMCOS_SUSPENDED', 'Chama chako kimesitishwa kwenye mfumo. Wasiliana na CoopLink.');
      }
      // Chama kimefungwa kwa ada ya CoopLink: mlipaji pekee anaingia (Mhasibu; Meneja kama chama hakina Mhasibu)
      const lock = await feeLock(user.amcosId, { fresh: true });
      if (lock) {
        const payer = await feePayerRole(user.amcosId);
        if (user.role !== payer) {
          await logLogin(req, { userId: user.id, phone: user.phone, success: false, reason: 'FEES_LOCKED' });
          throw new AppError(403, 'FEES_LOCKED', `Chama chako kimefungwa kwa muda kwa sababu ${lock.label.toLowerCase()} ya CoopLink haijalipwa. ${PAYER_LABEL[payer]} aingie alipie — kitafunguka papo hapo.`);
        }
      }
    }
    if (!isPlatformRole(user.role)) {
      const m = await getSetting('maintenance');
      if (m.enabled) throw new AppError(503, 'MAINTENANCE', m.message);
    }

    if (user.totpEnabled && user.totpSecret) {
      return res.json({ twoFactorRequired: true, challenge: signChallenge(user.id, user.tokenVersion) });
    }
    res.json(await completeLogin(req, user));
  }),
);

// Hatua ya pili ya kuingia (2FA)
authRouter.post(
  '/2fa/verify',
  loginLimiter,
  ah(async (req, res) => {
    const body = z.object({ challenge: z.string().min(10), code: z.string().min(6).max(8) }).parse(req.body);
    let p;
    try {
      p = verifyToken(body.challenge);
    } catch {
      throw new AppError(401, 'CHALLENGE_EXPIRED', 'Muda wa kuweka msimbo umeisha. Ingia tena.');
    }
    if (p.typ !== '2fa') throw new AppError(401, 'CHALLENGE_EXPIRED', 'Ingia tena.');
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, p.sub) });
    if (!user || !user.isActive || user.tokenVersion !== p.tv || !user.totpSecret) throw new AppError(401, 'CHALLENGE_EXPIRED', 'Ingia tena.');
    if (!verifyTotp(decryptSecret(user.totpSecret), body.code)) {
      await logLogin(req, { userId: user.id, phone: user.phone, success: false, reason: 'BAD_2FA' });
      throw new AppError(401, 'INVALID_2FA', 'Msimbo wa 2FA si sahihi');
    }
    res.json(await completeLogin(req, user));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) });
    const amcos = user?.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, user.amcosId) }) : null;
    res.json({ user: publicUser(user!), amcos });
  }),
);

authRouter.patch(
  '/me',
  authenticate,
  ah(async (req, res) => {
    const body = z.object({ fullName: z.string().trim().min(3).optional(), email: z.string().email().nullable().optional() }).parse(req.body);
    const before = await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) });
    if (body.fullName !== undefined && before) body.fullName = (await verifiedName(before.phone, body.fullName))!; // jina kutoka mobile money
    const [u] = await db.transaction(async (tx) => {
      const r = await tx.update(schema.users).set(body).where(eq(schema.users.id, req.auth!.userId)).returning();
      await audit(tx, req, { action: 'PROFILE_UPDATE', entity: 'User', entityId: req.auth!.userId, before: { fullName: before?.fullName, email: before?.email }, after: body });
      return r;
    });
    res.json({ user: publicUser(u) });
  }),
);

/** Mtumiaji anakubali Masharti ya Huduma na Sera ya Faragha (toleo la sasa). Inarekodiwa pamoja na IP na kifaa. */
authRouter.post(
  '/accept-terms',
  authenticate,
  ah(async (req, res) => {
    const body = z.object({ version: z.string(), accept: z.literal(true) }).parse(req.body);
    if (body.version !== LEGAL_VERSION) throw badRequest('Masharti yamebadilika. Pakia ukurasa upya usome toleo jipya.');
    const [u] = await db.transaction(async (tx) => {
      const r = await tx.update(schema.users).set({ termsVersion: LEGAL_VERSION, termsAcceptedAt: new Date() }).where(eq(schema.users.id, req.auth!.userId)).returning();
      await audit(tx, req, { action: 'TERMS_ACCEPT', entity: 'User', entityId: req.auth!.userId, after: { version: LEGAL_VERSION, ip: req.ip ?? null, userAgent: ua(req) } });
      return r;
    });
    res.json({ user: publicUser(u) });
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

    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.users)
        .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, tokenVersion: sql`${schema.users.tokenVersion} + 1` })
        .where(eq(schema.users.id, user.id))
        .returning();
      // Vikao vyote vya zamani vinafutwa; kipya kinaanzishwa kwa kifaa hiki
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: user.id }).where(activeSessionsWhere(user.id));
      await audit(tx, req, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: user.id });
      return { token: await startSession(tx, req, updated), user: publicUser(updated) };
    });
    res.json(result);
  }),
);

// Toka kwenye kifaa hiki
authRouter.post(
  '/logout',
  authenticate,
  ah(async (req, res) => {
    if (req.auth!.sessionId) {
      await db.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId })
        .where(and(eq(schema.userSessions.id, req.auth!.sessionId), isNull(schema.userSessions.revokedAt)));
    }
    res.json({ ok: true });
  }),
);

// Toka kwenye vifaa vyote
authRouter.post(
  '/logout-all',
  authenticate,
  ah(async (req, res) => {
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` }).where(eq(schema.users.id, req.auth!.userId));
      await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(req.auth!.userId));
    });
    res.json({ ok: true });
  }),
);

// ------------------------------ VIKAO (SESSIONS) VYANGU ------------------------------
authRouter.get(
  '/sessions',
  authenticate,
  ah(async (req, res) => {
    const rows = await db.select().from(schema.userSessions)
      .where(and(activeSessionsWhere(req.auth!.userId), gte(schema.userSessions.expiresAt, new Date())))
      .orderBy(desc(schema.userSessions.lastSeenAt));
    res.json({ data: rows.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) });
  }),
);

authRouter.delete(
  '/sessions/:id',
  authenticate,
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const [s] = await db.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId })
      .where(and(eq(schema.userSessions.id, id), eq(schema.userSessions.userId, req.auth!.userId), isNull(schema.userSessions.revokedAt)))
      .returning();
    if (!s) throw notFound('Session');
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/login-history',
  authenticate,
  ah(async (req, res) => {
    const rows = await db.select().from(schema.loginEvents).where(eq(schema.loginEvents.userId, req.auth!.userId))
      .orderBy(desc(schema.loginEvents.createdAt)).limit(30);
    res.json({ data: rows });
  }),
);

// ------------------------------ 2FA ------------------------------
authRouter.post(
  '/2fa/setup',
  authenticate,
  ah(async (req, res) => {
    const user = (await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) }))!;
    if (user.totpEnabled) throw badRequest('2FA tayari imewashwa');
    const secret = newTotpSecret();
    await db.update(schema.users).set({ totpSecret: encryptSecret(secret) }).where(eq(schema.users.id, user.id));
    res.json({ secret, otpauthUri: otpauthUri(secret, user.phone) });
  }),
);

authRouter.post(
  '/2fa/enable',
  authenticate,
  ah(async (req, res) => {
    const { code } = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
    const user = (await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId) }))!;
    if (!user.totpSecret) throw badRequest('Anza kwa kuandaa 2FA');
    if (!verifyTotp(decryptSecret(user.totpSecret), code)) throw new AppError(400, 'INVALID_2FA', 'Msimbo si sahihi. Hakikisha saa ya simu iko sawa.');
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ totpEnabled: true }).where(eq(schema.users.id, user.id));
      await audit(tx, req, { action: 'TWO_FACTOR_ENABLE', entity: 'User', entityId: user.id });
    });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/2fa/disable',
  authenticate,
  ah(async (req, res) => {
    await requireReauth(req);
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ totpEnabled: false, totpSecret: null }).where(eq(schema.users.id, req.auth!.userId));
      await audit(tx, req, { action: 'TWO_FACTOR_DISABLE', entity: 'User', entityId: req.auth!.userId });
    });
    res.json({ ok: true });
  }),
);

