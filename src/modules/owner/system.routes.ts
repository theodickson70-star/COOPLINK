// SYSTEM CONTROL CENTER — hali ya mfumo. Hakuna siri (passwords, URLs za DB, API keys) inayorudishwa.
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { count, desc, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery } from '../../lib/http';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { getSetting, setSetting } from '../../lib/settings';
import { emailConfigured, smsConfigured } from '../../lib/notify';
import { JOBS, latestJobRuns } from '../../lib/jobs';

export const systemRouter = Router();
const STARTED_AT = new Date();
const ROOT = path.resolve(__dirname, '..', '..', '..');

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}

export async function migrationStatus() {
  const journal = readJson<{ entries: { tag: string }[] }>(path.join(ROOT, 'drizzle', 'meta', '_journal.json'));
  let applied = 0;
  try {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = r.rows[0].n;
  } catch { applied = 0; }
  const total = journal?.entries.length ?? 0;
  return { applied, total, latest: journal?.entries.at(-1)?.tag ?? null, upToDate: applied >= total && total > 0 };
}

systemRouter.get(
  '/health',
  requirePermission('system.read'),
  ah(async (_req, res) => {
    const t0 = Date.now();
    let dbOk = true;
    try { await db.execute(sql`select 1`); } catch { dbOk = false; }
    const dbMs = Date.now() - t0;
    const pkg = readJson<{ version: string }>(path.join(ROOT, 'package.json'));
    const size = dbOk ? (await db.execute<{ bytes: string; pretty: string }>(sql`select pg_database_size(current_database())::text as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`)).rows[0] : null;
    const [errs] = (await db.execute<{ h24: number; d7: number }>(sql`
      select count(*) filter (where created_at > now() - interval '24 hours')::int as h24,
             count(*) filter (where created_at > now() - interval '7 days')::int as d7 from system_errors`)).rows;
    const env = process.env;
    const mem = process.memoryUsage();
    res.json({
      backend: { status: 'ok', version: pkg?.version ?? 'unknown', node: process.version, uptimeSec: Math.round(process.uptime()), startedAt: STARTED_AT, memoryMb: Math.round(mem.rss / 1048576) },
      frontend: { built: fs.existsSync(path.join(ROOT, 'admin', 'dist', 'index.html')) },
      api: { status: 'ok' },
      database: { status: dbOk ? 'ok' : 'down', latencyMs: dbMs, size },
      migrations: await migrationStatus(),
      deployment: {
        platform: env.RAILWAY_ENVIRONMENT_NAME ? 'Railway' : 'local',
        environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? null,
        service: env.RAILWAY_SERVICE_NAME ?? null,
        deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? null,
        commit: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        branch: env.RAILWAY_GIT_BRANCH ?? null,
        replica: env.RAILWAY_REPLICA_ID ?? null,
      },
      jobs: (await latestJobRuns()).rows,
      errors: errs,
      integrations: {
        sms: smsConfigured() ? 'configured' : 'not_configured',
        email: emailConfigured() ? 'configured' : 'not_configured',
        payments: 'manual_verification',
      },
      maintenance: await getSetting('maintenance', { fresh: true }),
      banner: await getSetting('banner', { fresh: true }),
    });
  }),
);

systemRouter.get(
  '/errors',
  requirePermission('system.read'),
  ah(async (req, res) => {
    const q = paginationQuery.parse(req.query);
    const rows = await db.select().from(schema.systemErrors).orderBy(desc(schema.systemErrors.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(schema.systemErrors);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

systemRouter.get(
  '/settings',
  requirePermission('system.read'),
  ah(async (_req, res) => {
    res.json({ config: await getSetting('config', { fresh: true }), maintenance: await getSetting('maintenance', { fresh: true }), banner: await getSetting('banner', { fresh: true }) });
  }),
);

systemRouter.put(
  '/settings/config',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({
      defaultTrialDays: z.number().int().min(0).max(365),
      defaultGraceDays: z.number().int().min(0).max(90),
      expiringWindowDays: z.number().int().min(1).max(90),
      enforceSubscriptions: z.boolean(),
      currency: z.enum(['TZS', 'USD']),
    }).parse(req.body);
    const before = await getSetting('config', { fresh: true });
    await db.transaction(async (tx) => {
      await setSetting(tx, 'config', b, req.auth!.userId);
      await audit(tx, req, { action: 'SETTINGS_CONFIG_UPDATE', entity: 'PlatformSetting', entityId: 'config', before, after: b });
    });
    res.json({ config: b });
  }),
);

systemRouter.put(
  '/maintenance',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({ enabled: z.boolean(), message: z.string().trim().min(5).max(300) }).passthrough().parse(req.body);
    await requireReauth(req);
    const value = { enabled: b.enabled, message: b.message };
    await db.transaction(async (tx) => {
      await setSetting(tx, 'maintenance', value, req.auth!.userId);
      await audit(tx, req, { action: value.enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', entity: 'PlatformSetting', entityId: 'maintenance', after: value });
    });
    res.json({ maintenance: value });
  }),
);

systemRouter.put(
  '/banner',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({ enabled: z.boolean(), message: z.string().trim().max(300), tone: z.enum(['info', 'warn']) }).parse(req.body);
    await db.transaction(async (tx) => {
      await setSetting(tx, 'banner', b, req.auth!.userId);
      await audit(tx, req, { action: 'BANNER_UPDATE', entity: 'PlatformSetting', entityId: 'banner', after: b });
    });
    res.json({ banner: b });
  }),
);

systemRouter.post(
  '/jobs/subscriptions/run',
  requirePermission('system.manage', 'subscriptions.manage'),
  ah(async (req, res) => {
    await JOBS.subscriptions();
    await audit(db, req, { action: 'JOB_RUN', entity: 'Job', entityId: 'subscriptions.sweep' });
    res.json({ jobs: (await latestJobRuns()).rows });
  }),
);
