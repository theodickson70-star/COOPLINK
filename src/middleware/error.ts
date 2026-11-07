import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { db, schema } from '../db';

interface PgError { code?: string; detail?: string; constraint?: string; message?: string }

function pgErrorOf(err: unknown): PgError | null {
  // Drizzle huweka kosa la pg ndani ya .cause
  const e = err as { code?: string; cause?: unknown };
  if (e?.code && /^[0-9A-Z]{5}$/.test(e.code)) return e as PgError;
  if (e?.cause) return pgErrorOf(e.cause);
  return null;
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: `Njia ${req.method} ${req.path} haipo` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Taarifa ulizotuma si sahihi',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON si sahihi' } });
  }

  const pg = pgErrorOf(err);
  if (pg?.code === '23505') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'Rekodi hii tayari ipo', details: pg.detail } });
  }
  if (pg?.code === '23503') {
    return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'Rekodi inayohusishwa haipo', details: pg.detail } });
  }
  if (pg?.code === 'P0001' && pg.message?.startsWith('IMMUTABLE_RECORD')) {
    return res.status(409).json({ error: { code: 'IMMUTABLE_RECORD', message: 'Rekodi hii haiwezi kubadilishwa wala kufutwa' } });
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  // Kumbukumbu ya kosa kwa System Control Center (bila body ya ombi wala siri)
  const e = err as Error;
  void db.insert(schema.systemErrors).values({
    method: req.method, path: req.path.slice(0, 300), status: 500,
    message: String(e?.message ?? err).slice(0, 1000), stack: e?.stack?.slice(0, 4000) ?? null, userId: req.auth?.userId ?? null,
  }).catch(() => {});
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Hitilafu ya mfumo. Jaribu tena baadaye.' } });
}
