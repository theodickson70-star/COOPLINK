// =====================================================================
//  BACKUP & DATABASE
//  - Hali ya database, ukubwa, migrations, historia ya backup.
//  - Export ya data (JSON) — BILA nenosiri, hash wala siri za 2FA.
//  - Restore: ombi + idhini tu. Hakuna operesheni ya kufuta/kuandika upya database inayofanywa
//    kutoka kwenye app; restore halisi inafanywa kupitia Railway baada ya idhini.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { count, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery, uuidParam } from '../../lib/http';
import { conflict, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { migrationStatus } from './system.routes';

export const backupRouter = Router();
const B = schema.backupRecords;
const R = schema.restoreRequests;

// Meza zinazoingia kwenye export, na safu za siri zinazoondolewa
const EXPORT_TABLES = [
  'unions', 'amcos', 'users', 'seasons', 'buyers', 'members', 'farms', 'estimates', 'input_items', 'input_prices',
  'input_issues', 'input_issue_lines', 'stock_movements', 'member_ledger_entries', 'markets', 'bales', 'exchange_rates',
  'deduction_rules', 'settlements', 'settlement_lines', 'payment_batches', 'payments', 'subscription_plans', 'subscriptions',
  'platform_payments', 'platform_expenses', 'business_targets', 'platform_settings', 'announcements', 'audit_logs',
];
const SECRET_COLUMNS: Record<string, string[]> = { users: ['password_hash', 'totp_secret', 'token_version'] };

backupRouter.get(
  '/status',
  requirePermission('backup.read'),
  ah(async (_req, res) => {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const latency = Date.now() - t0;
    const [size] = (await db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as pretty, pg_database_size(current_database())::text as bytes,
      (select count(*)::int from pg_stat_activity where datname = current_database()) as connections, version() as version`)).rows;
    const tables = (await db.execute(sql`
      select relname as table, n_live_tup::bigint::text as rows, pg_size_pretty(pg_total_relation_size(relid)) as size, pg_total_relation_size(relid)::text as bytes
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15`)).rows;
    const [last] = await db.select().from(B).where(eq(B.status, 'SUCCESS')).orderBy(desc(B.takenAt)).limit(1);
    res.json({ database: { status: 'ok', latencyMs: latency, ...size }, tables, migrations: await migrationStatus(), lastSuccessfulBackup: last ?? null });
  }),
);

backupRouter.get(
  '/records',
  requirePermission('backup.read'),
  ah(async (req, res) => {
    const q = paginationQuery.parse(req.query);
    const rows = await db.select({ b: B, by: schema.users.fullName }).from(B).leftJoin(schema.users, eq(schema.users.id, B.createdById))
      .orderBy(desc(B.takenAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(B);
    res.json(paged(rows.map((x) => ({ ...x.b, createdBy: x.by })), total, q.page, q.pageSize));
  }),
);

// Kurekodi backup iliyochukuliwa nje (mf. Railway Postgres backup)
backupRouter.post(
  '/records',
  requirePermission('backup.manage'),
  ah(async (req, res) => {
    const b = z.object({
      kind: z.enum(['RAILWAY', 'OTHER']), status: z.enum(['SUCCESS', 'FAILED']),
      takenAt: z.string().datetime({ offset: true }).optional(), location: z.string().trim().max(300).nullable().optional(),
      notes: z.string().trim().max(500).nullable().optional(),
    }).parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(B).values({ ...b, takenAt: b.takenAt ? new Date(b.takenAt) : new Date(), createdById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'BACKUP_RECORD', entity: 'BackupRecord', entityId: r.id, after: r });
      return r;
    });
    res.status(201).json({ record: row });
  }),
);

// Export ya data yote (JSON). Inahitaji nenosiri.
backupRouter.post(
  '/export',
  requirePermission('backup.manage'),
  ah(async (req, res) => {
    await requireReauth(req);
    const out: Record<string, unknown[]> = {};
    for (const t of EXPORT_TABLES) {
      const rows = (await db.execute(sql.raw(`select * from "${t}"`))).rows as Record<string, unknown>[];
      const hide = SECRET_COLUMNS[t] ?? [];
      out[t] = hide.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.includes(k)))) : rows;
    }
    const payload = JSON.stringify({ product: 'CoopLink', exportedAt: new Date().toISOString(), tables: out });
    const bytes = Buffer.byteLength(payload);
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(B).values({ kind: 'EXPORT', status: 'SUCCESS', sizeBytes: bytes, location: 'Imepakuliwa na mtumiaji', notes: `Meza ${EXPORT_TABLES.length}`, createdById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'DATA_EXPORT', entity: 'BackupRecord', entityId: r.id, after: { bytes, tables: EXPORT_TABLES.length } });
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cooplink-export-${stamp}.json"`);
    res.send(payload);
  }),
);

// ------------------------------ MAOMBI YA RESTORE ------------------------------
backupRouter.get(
  '/restore-requests',
  requirePermission('backup.read'),
  ah(async (_req, res) => {
    const rows = await db.select({ r: R, by: schema.users.fullName }).from(R).leftJoin(schema.users, eq(schema.users.id, R.requestedById)).orderBy(desc(R.createdAt)).limit(100);
    res.json({ data: rows.map((x) => ({ ...x.r, requestedBy: x.by })) });
  }),
);

backupRouter.post(
  '/restore-requests',
  requirePermission('backup.manage'),
  ah(async (req, res) => {
    const b = z.object({ backupId: z.string().uuid().nullable().optional(), reason: z.string().trim().min(10).max(1000) }).parse(req.body);
    if (b.backupId && !(await db.query.backupRecords.findFirst({ where: eq(B.id, b.backupId) }))) throw notFound('Backup');
    const row = await db.transaction(async (tx) => {
      const [r] = await tx.insert(R).values({ backupId: b.backupId ?? null, reason: b.reason, requestedById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'RESTORE_REQUEST', entity: 'RestoreRequest', entityId: r.id, after: r });
      return r;
    });
    res.status(201).json({ request: row });
  }),
);

// Uamuzi ni wa Owner pekee (staff.manage) + nenosiri. Hakuna operesheni ya database inayofanywa hapa.
backupRouter.post(
  '/restore-requests/:id/decide',
  requirePermission('staff.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const b = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'COMPLETED']), notes: z.string().trim().min(3).max(1000) }).passthrough().parse(req.body);
    await requireReauth(req);
    const r = await db.query.restoreRequests.findFirst({ where: eq(R.id, id) });
    if (!r) throw notFound('Ombi');
    const allowed = r.status === 'REQUESTED' ? ['APPROVED', 'REJECTED'] : r.status === 'APPROVED' ? ['COMPLETED'] : [];
    if (!allowed.includes(b.decision)) throw conflict(`Ombi hili ni ${r.status}`);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(R).set({ status: b.decision, decidedById: req.auth!.userId, decidedAt: new Date(), decisionNotes: b.notes }).where(eq(R.id, id)).returning();
      await audit(tx, req, { action: `RESTORE_${b.decision}`, entity: 'RestoreRequest', entityId: id, before: { status: r.status }, after: { status: b.decision, notes: b.notes } });
      return u;
    });
    res.json({ request: row });
  }),
);
