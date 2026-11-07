import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';

// Inazuia kuandika try/catch kila mahali — makosa yanaenda kwenye error middleware
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export function paged<T>(data: T[], total: number, page: number, pageSize: number) {
  return { data, meta: { page, pageSize, total, pages: Math.ceil(total / pageSize) } };
}

export const uuidParam = z.object({ id: z.string().uuid('ID si sahihi') });

// Namba za simu za Tanzania -> 2557XXXXXXXX / 2556XXXXXXXX
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  let n = digits;
  if (n.startsWith('0') && n.length === 10) n = '255' + n.slice(1);
  else if (n.length === 9) n = '255' + n;
  return /^255[67]\d{8}$/.test(n) ? n : null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Namba ya simu si sahihi (mf. 0712345678)' });
      return z.NEVER;
    }
    return n;
  });

// Kiasi cha fedha / idadi kama string au namba -> string yenye desimali 2
export const decimalSchema = (opts: { min?: number; allowNegative?: boolean } = {}) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = String(v).trim();
    if (!/^-?\d+(\.\d{1,4})?$/.test(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Namba si sahihi' });
      return z.NEVER;
    }
    const num = Number(s);
    if (!opts.allowNegative && num < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Namba haiwezi kuwa hasi' });
      return z.NEVER;
    }
    if (opts.min !== undefined && num < opts.min) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Namba iwe angalau ${opts.min}` });
      return z.NEVER;
    }
    return s;
  });
