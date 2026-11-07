import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export interface TokenPayload {
  sub: string; // user id
  tv: number;  // tokenVersion
}

export const signToken = (p: TokenPayload) =>
  jwt.sign(p, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });

export const verifyToken = (token: string) => jwt.verify(token, env.JWT_SECRET) as TokenPayload & jwt.JwtPayload;

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
