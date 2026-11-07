import type { Request } from 'express';
import type { DbOrTx } from '../db';
import { schema } from '../db';

const SENSITIVE = new Set(['passwordHash', 'tokenVersion', 'totpSecret', 'confirmPassword', 'confirmCode', 'password']);

function clean(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  return Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([k]) => !SENSITIVE.has(k)));
}

/** Andika kumbukumbu ya ukaguzi. Iitwe NDANI ya transaction ile ile ya kitendo. */
export async function audit(
  db: DbOrTx,
  req: Request,
  e: { action: string; entity: string; entityId?: string | null; amcosId?: string | null; before?: unknown; after?: unknown },
) {
  await db.insert(schema.auditLogs).values({
    amcosId: e.amcosId ?? req.auth?.amcosId ?? null,
    unionId: req.auth?.unionId ?? null,
    userId: req.auth?.userId ?? null,
    userRole: req.auth?.role ?? null,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: clean(e.before),
    after: clean(e.after),
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  });
}
