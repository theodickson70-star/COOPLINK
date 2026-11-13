// =====================================================================
//  OTP (namba za uthibitisho kwa SMS)
//   - Tarakimu 6, zinadumu dakika 10, makosa 5 tu kisha namba inakufa.
//   - Namba haihifadhiwi — HMAC yake tu (kwa siri ya mfumo). SMS iliyorekodiwa inaficha namba.
//   - Kutuma upya: baada ya sekunde 60; si zaidi ya 6 kwa saa kwa jambo moja (gharama + usalama).
// =====================================================================
import crypto from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../config/env';
import { AppError } from './errors';
import { maskPhone, normPhone, sendNow, type SmsKind } from './sms';

export type OtpPurpose = 'LOGIN' | 'PASSWORD_RESET' | 'PHONE_CHANGE' | 'ISSUE_HANDOVER' | 'MEMBER_REGISTER' | 'CASH_PAYOUT' | 'GROUP_CONSENT';
const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SEC = 60;
const PER_HOUR = 6;
const O = schema.otpCodes;

const hash = (subjectId: string, code: string) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${subjectId}:${code}`).digest('hex');

/**
 * Inaunda na kutuma OTP. text(code) inaandika ujumbe wa SMS. Inarudisha simu iliyofichwa na muda wa kuisha.
 * Ikiwa SMS imeshindwa kutumwa, namba inafutwa na kosa OTP_SMS_FAILED linarudishwa.
 */
export async function issueOtp(o: {
  purpose: OtpPurpose; kind: SmsKind; subjectId: string; phone: string | null | undefined; text: (code: string) => string;
  amcosId?: string | null; memberId?: string | null; userId?: string | null; payload?: unknown; createdById?: string | null; ip?: string | null;
}) {
  const phone = normPhone(o.phone);
  if (!phone) throw new AppError(400, 'OTP_NO_PHONE', 'Hakuna namba sahihi ya simu ya kutuma namba ya uthibitisho');
  const recent = await db.select({ createdAt: O.createdAt }).from(O)
    .where(and(eq(O.purpose, o.purpose), eq(O.subjectId, o.subjectId), gte(O.createdAt, new Date(Date.now() - 3600_000)))).orderBy(desc(O.createdAt));
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_SEC * 1000) {
    const wait = Math.ceil((RESEND_SEC * 1000 - (Date.now() - recent[0].createdAt.getTime())) / 1000);
    throw new AppError(429, 'OTP_RESEND_WAIT', `Subiri sekunde ${wait} kabla ya kutuma namba nyingine`);
  }
  if (recent.length >= PER_HOUR) throw new AppError(429, 'OTP_TOO_MANY', 'Namba nyingi zimetumwa ndani ya saa moja. Jaribu tena baadaye.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // Namba za zamani za jambo hili zinakufa
  await db.update(O).set({ consumedAt: new Date() }).where(and(eq(O.purpose, o.purpose), eq(O.subjectId, o.subjectId), isNull(O.consumedAt)));
  const [row] = await db.insert(O).values({
    purpose: o.purpose, subjectId: o.subjectId, amcosId: o.amcosId ?? null, phone, codeHash: hash(o.subjectId, code), payload: (o.payload ?? null) as never,
    expiresAt: new Date(Date.now() + TTL_MIN * 60_000), createdById: o.createdById ?? null, ip: o.ip ?? null,
  }).returning();
  const text = o.text(code);
  const r = await sendNow({ kind: o.kind, phone, text, logText: text.replace(code, '******'), amcosId: o.amcosId, memberId: o.memberId, userId: o.userId, referenceType: 'OTP', referenceId: row.id });
  if (r.status !== 'SENT') {
    await db.update(O).set({ consumedAt: new Date() }).where(eq(O.id, row.id));
    throw new AppError(502, 'OTP_SMS_FAILED', `SMS ya namba ya uthibitisho haikutumwa (${r.error ?? r.status}). Jaribu tena au tumia njia mbadala.`);
  }
  return { id: row.id, phoneMasked: maskPhone(phone), expiresAt: row.expiresAt, resendIn: RESEND_SEC };
}

/** Inahakiki namba. Ikifaulu, namba inatumika (haiwezi kutumika tena) na rekodi inarudishwa (payload). */
export async function verifyOtp(purpose: OtpPurpose, subjectId: string, code: string) {
  const c = code.replace(/\D/g, '');
  const [row] = await db.select().from(O).where(and(eq(O.purpose, purpose), eq(O.subjectId, subjectId), isNull(O.consumedAt))).orderBy(desc(O.createdAt)).limit(1);
  if (!row) throw new AppError(400, 'OTP_INVALID', 'Hakuna namba ya uthibitisho inayosubiri — tuma namba mpya');
  if (row.expiresAt < new Date()) throw new AppError(400, 'OTP_EXPIRED', 'Muda wa namba ya uthibitisho umeisha — tuma namba mpya');
  if (row.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'OTP_LOCKED', 'Namba imekosewa mara nyingi — tuma namba mpya');
  const ok = c.length === 6 && crypto.timingSafeEqual(Buffer.from(hash(subjectId, c)), Buffer.from(row.codeHash));
  if (!ok) {
    const [u] = await db.update(O).set({ attempts: sql`${O.attempts} + 1` }).where(eq(O.id, row.id)).returning({ attempts: O.attempts });
    const left = MAX_ATTEMPTS - u.attempts;
    throw new AppError(400, 'OTP_INVALID', left > 0 ? `Namba ya uthibitisho si sahihi. Umebakiza majaribio ${left}.` : 'Namba imekosewa mara nyingi — tuma namba mpya');
  }
  const [used] = await db.update(O).set({ consumedAt: new Date(), verifiedAt: new Date() }).where(and(eq(O.id, row.id), isNull(O.consumedAt))).returning();
  if (!used) throw new AppError(400, 'OTP_INVALID', 'Namba hii imeshatumika');
  return used;
}

/** Kitambulisho thabiti (uuid) cha jambo lisilo na rekodi bado — mf. namba ya simu kabla mkulima hajasajiliwa. */
export function subjectUuid(key: string) {
  const h = crypto.createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Je, jambo hili limethibitishwa kwa OTP ndani ya dakika hizi? (inarudisha rekodi au null) */
export async function recentlyVerified(purpose: OtpPurpose, subjectId: string, minutes = 60) {
  const [row] = await db.select().from(O).where(and(eq(O.purpose, purpose), eq(O.subjectId, subjectId),
    sql`${O.verifiedAt} > now() - make_interval(mins => ${minutes})`)).orderBy(desc(O.verifiedAt)).limit(1);
  return row ?? null;
}

/** Vingi kwa pamoja: subjectIds zilizothibitishwa ndani ya dakika hizi. */
export async function verifiedSet(purpose: OtpPurpose, subjectIds: string[], minutes = 60) {
  if (!subjectIds.length) return new Set<string>();
  const rows = await db.select({ s: O.subjectId }).from(O).where(and(eq(O.purpose, purpose), inArray(O.subjectId, subjectIds),
    sql`${O.verifiedAt} > now() - make_interval(mins => ${minutes})`));
  return new Set(rows.map((r) => r.s));
}
