// =====================================================================
//  PORTAL YA MKULIMA — mkulima anaona taarifa zake mwenyewe (kusoma tu).
//   - Anaingia kwa namba ya uanachama + PIN (tarakimu 4–6). PIN ya kwanza inatolewa ofisini (Mhasibu/Stokipa)
//     na lazima aibadilishe akiingia mara ya kwanza.
//   - Token yake ina typ:'farmer' — haikubaliwi na API ya watumishi, na token ya mtumishi haikubaliwi hapa.
//   - Anaona rekodi ZAKE tu, zilizoidhinishwa tu. Hakuna kitu anachoweza kubadilisha isipokuwa PIN yake.
//   - Portal inafanya kazi tu kama Meneja ameiwasha, chama kiko hai, na ada ya CoopLink haijapitwa.
// =====================================================================
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema, type Member } from '../db';
import { env } from '../config/env';
import { ah } from '../lib/http';
import { AppError } from '../lib/errors';
import { feeLock } from '../lib/fees';
import { getSetting } from '../lib/settings';
import { farmerStatement } from './finance.routes';

export const farmerRouter = Router();
const M = schema.members;

export const PORTAL_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
const LOCK_EVERY = 5;                 // kila makosa 5 mfululizo -> anafungiwa kwa muda
const TOKEN_TTL = '7d';

const WRONG = () => new AppError(401, 'BAD_CREDENTIALS', 'Namba ya uanachama au PIN si sahihi');
const INVALID = () => new AppError(401, 'TOKEN_INVALID', 'Muda wa kuingia umeisha, tafadhali ingia tena');
const CLOSED = () => new AppError(403, 'PORTAL_CLOSED', 'Huduma ya portal haipatikani kwa sasa. Wasiliana na ofisi ya chama chako.');

/** Dakika za kufungiwa: 15, 30, 60 … hadi saa 24. */
export const lockMinutes = (failed: number) => Math.min(15 * 2 ** (Math.floor(failed / LOCK_EVERY) - 1), 24 * 60);

/** PIN dhaifu inakataliwa: tarakimu zote sawa, mfululizo (1234, 9876…). */
export function weakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const step = d[1] - d[0];
  return Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step);
}
export const normalizeMemberNo = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');

const signFarmer = (m: Member) => jwt.sign({ sub: m.id, tv: m.portalTokenVersion, typ: 'farmer' }, env.JWT_SECRET, { expiresIn: TOKEN_TTL });

/** Portal iko wazi kwa chama hiki? (Meneja ameiwasha, chama hai, hakuna ada iliyopitwa, si maintenance) */
async function portalOpen(amcosId: string) {
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { farmerPortal: true, isActive: true, name: true } });
  if (!a?.farmerPortal || !a.isActive) return null;
  if (await feeLock(amcosId)) return null;
  if ((await getSetting('maintenance')).enabled) return null;
  return a;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Majaribio mengi. Subiri dakika 15.' } },
});

// Hash ya bandia: hata namba isipokuwepo, jibu linachukua muda sawa (mtu hawezi kujua namba zipi zipo)
const DUMMY_HASH = bcrypt.hashSync('dummy-pin-000000', 10);

farmerRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const b = z.object({ memberNo: z.string().trim().min(1).max(40), pin: z.string().regex(/^\d{4,6}$/, 'PIN ni tarakimu 4 hadi 6') }).parse(req.body);
  const no = normalizeMemberNo(b.memberNo);
  const candidates = await db.select().from(M)
    .where(and(sql`upper(${M.memberNo}) = ${no}`, isNotNull(M.portalPinHash), inArray(M.status, [...PORTAL_STATUSES])));
  if (!candidates.length) { await bcrypt.compare(b.pin, DUMMY_HASH); throw WRONG(); }

  let lockedFor = 0;
  for (const m of candidates) {
    if (m.portalLockedUntil && m.portalLockedUntil > new Date()) {
      lockedFor = Math.max(lockedFor, Math.ceil((m.portalLockedUntil.getTime() - Date.now()) / 60_000));
      continue;
    }
    if (await bcrypt.compare(b.pin, m.portalPinHash!)) {
      if (!(await portalOpen(m.amcosId))) throw CLOSED();
      const [u] = await db.update(M).set({ portalFailed: 0, portalLockedUntil: null, portalLastLoginAt: new Date() }).where(eq(M.id, m.id)).returning();
      await db.insert(schema.auditLogs).values({ amcosId: m.amcosId, action: 'FARMER_PORTAL_LOGIN', entity: 'Member', entityId: m.id, ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null });
      res.json({ token: signFarmer(u), mustChange: u.portalMustChange });
      return;
    }
    const failed = m.portalFailed + 1;
    const lock = failed % LOCK_EVERY === 0 ? new Date(Date.now() + lockMinutes(failed) * 60_000) : null;
    await db.update(M).set({ portalFailed: failed, ...(lock ? { portalLockedUntil: lock } : {}) }).where(eq(M.id, m.id));
    if (lock) lockedFor = Math.max(lockedFor, lockMinutes(failed));
  }
  if (lockedFor) throw new AppError(429, 'PORTAL_LOCKED', `PIN imekosewa mara nyingi. Jaribu tena baada ya dakika ${lockedFor}, au omba PIN mpya ofisini.`);
  throw WRONG();
}));

/** Uthibitisho wa mkulima: token ya mkulima tu, PIN bado ipo, portal iko wazi. */
async function farmerAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw INVALID();
    let p: jwt.JwtPayload;
    try { p = jwt.verify(h.slice(7), env.JWT_SECRET) as jwt.JwtPayload; } catch { throw INVALID(); }
    if (p.typ !== 'farmer' || typeof p.sub !== 'string') throw INVALID();
    const m = await db.query.members.findFirst({ where: eq(M.id, p.sub) });
    if (!m || !m.portalPinHash || m.portalTokenVersion !== p.tv || !(PORTAL_STATUSES as readonly string[]).includes(m.status)) throw INVALID();
    if (!(await portalOpen(m.amcosId))) throw CLOSED();
    req.farmer = m;
    next();
  } catch (e) { next(e); }
}
const pinChanged = (req: Request, _res: Response, next: NextFunction) =>
  req.farmer!.portalMustChange ? next(new AppError(403, 'PIN_CHANGE_REQUIRED', 'Badilisha PIN uliyopewa ofisini kwanza')) : next();

farmerRouter.use(farmerAuth);

farmerRouter.get('/me', ah(async (req, res) => {
  const m = req.farmer!;
  const a = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, m.amcosId), columns: { name: true, code: true, phone: true } }))!;
  res.json({
    member: { memberNo: m.memberNo, firstName: m.firstName, middleName: m.middleName, lastName: m.lastName, village: m.village, status: m.status,
      sharesCount: m.sharesCount, entryFee: m.entryFee, entryFeePaid: m.entryFeePaid, joinedAt: m.joinedAt, preferredPayment: m.preferredPayment },
    amcos: a, mustChange: m.portalMustChange, lastLoginAt: m.portalLastLoginAt,
  });
}));

farmerRouter.post('/change-pin', ah(async (req, res) => {
  const b = z.object({ currentPin: z.string().regex(/^\d{4,6}$/), newPin: z.string().regex(/^\d{4,6}$/, 'PIN mpya iwe tarakimu 4 hadi 6') }).parse(req.body);
  const m = req.farmer!;
  if (!(await bcrypt.compare(b.currentPin, m.portalPinHash!))) throw new AppError(400, 'BAD_PIN', 'PIN ya sasa si sahihi');
  if (b.newPin === b.currentPin) throw new AppError(400, 'SAME_PIN', 'PIN mpya isiwe sawa na ya zamani');
  if (weakPin(b.newPin)) throw new AppError(400, 'WEAK_PIN', 'PIN hii ni rahisi kubahatisha (mf. 1111 au 1234). Chagua nyingine.');
  const [u] = await db.update(M).set({ portalPinHash: await bcrypt.hash(b.newPin, 12), portalMustChange: false, portalTokenVersion: m.portalTokenVersion + 1, portalFailed: 0 })
    .where(eq(M.id, m.id)).returning();
  await db.insert(schema.auditLogs).values({ amcosId: m.amcosId, action: 'FARMER_PORTAL_PIN_CHANGE', entity: 'Member', entityId: m.id, ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null });
  res.json({ token: signFarmer(u) });
}));

/** Taarifa ya mkulima — ile ile ya ofisi, lakini rekodi zilizoidhinishwa tu. */
farmerRouter.get('/statement', pinChanged, ah(async (req, res) => {
  const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
  res.json(await farmerStatement(req.farmer!, seasonId, { approvedOnly: true }));
}));
