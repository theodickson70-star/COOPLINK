import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export interface TokenPayload {
  sub: string;  // user id
  tv: number;   // tokenVersion
  sid?: string; // session id (user_sessions) — tokens za zamani hazina
  typ?: '2fa' | 'sms' | 'farmer';  // '2fa' / 'sms' = hatua ya pili ya kuingia; 'farmer' = portal ya mkulima (haitumiki kwa API ya watumishi)
}

export const signToken = (p: TokenPayload) =>
  jwt.sign(p, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });

/** Token fupi (dakika 5) ya kusubiri msimbo wa 2FA. */
export const signChallenge = (sub: string, tv: number) => jwt.sign({ sub, tv, typ: '2fa' }, env.JWT_SECRET, { expiresIn: '5m' });
/** Hatua ya pili ya kuingia kwa OTP ya SMS (dakika 15) */
export const signSmsChallenge = (sub: string, tv: number) => jwt.sign({ sub, tv, typ: 'sms' }, env.JWT_SECRET, { expiresIn: '15m' });

export const verifyToken = (token: string) => jwt.verify(token, env.JWT_SECRET) as TokenPayload & jwt.JwtPayload;

/** Muda wa kuisha kwa token (kwa user_sessions.expiresAt). */
export const tokenExpiry = (token: string) => new Date(((jwt.decode(token) as jwt.JwtPayload).exp ?? 0) * 1000);

// Nenosiri la muda (rahisi kusoma kwa simu, bila herufi zinazochanganya)
export function tempPassword(len = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const passwordSchemaRule = {
  min: 8,
  message: 'Nenosiri liwe na herufi 8 au zaidi, likiwa na herufi na namba',
  test: (pw: string) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw),
};
