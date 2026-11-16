// =====================================================================
//  BACKUP & DATABASE
//  - Hali ya database, ukubwa, migrations, historia ya backup.
//  - Export ya data (JSON) — BILA nenosiri, hash wala siri za 2FA.
//  - Restore: ombi + idhini tu. Hakuna operesheni ya kufuta/kuandika upya database inayofanywa
//    kutoka kwenye app; restore halisi inafanywa kupitia Railway baada ya idhini.
// =====================================================================
import { Router } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, ne, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../../db';
import { ah, paged, paginationQuery, uuidParam } from '../../lib/http';
import { conflict, notFound } from '../../lib/errors';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { migrationStatus } from './system.routes';

export const backupRouter = Router();
const B = schema.backupRecords;
const R = schema.restoreRequests;

/**
 * v2.4: export inachukua meza ZOTE za data (orodha inasomwa kutoka database, kwa hiyo meza mpya haisahauliki),
 * isipokuwa hizi — kwa sababu ya usalama (siri za kuingia) au ni kumbukumbu za muda za mfumo.
 */
export const EXPORT_EXCLUDED: Record<string, string> = {
  otp_codes: 'Namba za uthibitisho za muda (siri)',
  trusted_devices: 'Vifaa vinavyoaminika (siri za kuingia)',
  user_sessions: 'Vipindi vya kuingia (siri)',
  sms_logs: 'Kumbukumbu za SMS (zinaweza kuwa na viungo vya siri)',
  teepay_events: 'Matukio ghafi ya webhook',
  phone_name_lookups: 'Kumbukumbu ya muda ya majina',
  job_runs: 'Kumbukumbu za kazi za nyuma', system_uptime: 'Takwimu za uptime', system_errors: 'Makosa ya mfumo', login_events: 'Historia ya kuingia',
  member_photos: 'Picha (kubwa) — ziko kwenye backup ya Railway', support_attachments: 'Viambatisho (vikubwa) — viko kwenye backup ya Railway',
  backup_records: 'Historia ya backup yenyewe', restore_requests: 'Maombi ya restore',
};
/** Safu za siri zinazoondolewa kwenye export (baada ya restore: watumishi wanaweka nenosiri/2FA upya, wakulima PIN mpya) */
export const SECRET_COLUMNS: Record<string, string[]> = {
  users: ['password_hash', 'totp_secret', 'token_version'],
  members: ['portal_pin_hash', 'portal_token_version'],
  farmer_statement_links: ['token_hash'],
};

async function exportTables(tx: DbOrTx) {
  const all = (await tx.execute<{ t: string }>(sql`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and left(table_name, 2) <> '__' order by 1`)).rows.map((r) => r.t);
  return all.filter((t) => !(t in EXPORT_EXCLUDED));
}
async function buildExport(tx: DbOrTx) {
  const tables = await exportTables(tx);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = (await tx.execute(sql.raw(`select * from "${t}"`))).rows as Record<string, unknown>[];
    const hide = SECRET_COLUMNS[t] ?? [];
    out[t] = hide.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.includes(k)))) : rows;
  }
  return { tables, payload: JSON.stringify({ product: 'CoopLink', exportedAt: new Date().toISOString(), tables: out }) };
}

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
    const [last] = await db.select().from(B).where(and(eq(B.status, 'SUCCESS'), ne(B.kind, 'VERIFY'))).orderBy(desc(B.takenAt)).limit(1);
    const [lastVerify] = await db.select().from(B).where(eq(B.kind, 'VERIFY')).orderBy(desc(B.takenAt)).limit(1);
    res.json({ database: { status: 'ok', latencyMs: latency, ...size }, tables, migrations: await migrationStatus(), lastSuccessfulBackup: last ?? null, lastRestoreVerify: lastVerify ?? null });
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
    // Picha moja thabiti ya database (meza zote kwa wakati mmoja)
    const { tables, payload } = await db.transaction((tx) => buildExport(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
    const bytes = Buffer.byteLength(payload);
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(B).values({ kind: 'EXPORT', status: 'SUCCESS', sizeBytes: bytes, location: 'Imepakuliwa na mtumiaji', notes: `Meza ${tables.length}`, createdById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'DATA_EXPORT', entity: 'BackupRecord', entityId: r.id, after: { bytes, tables: tables.length } });
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cooplink-export-${stamp}.json"`);
    res.send(payload);
  }),
);

// ------------------------------ JARIBIO LA RESTORE (v2.4) ------------------------------
/**
 * Inathibitisha kwamba backup INAWEZA kurudishwa — bila kugusa data halisi:
 *  1. picha thabiti ya database -> JSON (kama export halisi) -> inasomwa upya kutoka JSON
 *  2. kila meza inarudishwa kwenye meza ya MUDA (pg_temp, inafutwa yenyewe muamala ukiisha)
 *  3. idadi ya rekodi na kila `id` vinalinganishwa na database halisi
 *  4. foreign keys zinakaguliwa ndani ya data iliyorudishwa (hakuna rekodi yatima)
 * Hakuna INSERT/UPDATE/DELETE kwenye meza halisi (isipokuwa kumbukumbu ya jaribio lenyewe).
 */
type VerifyRow = { table: string; rows: number; restored: number; missing: number; ok: boolean; note?: string };
async function verifyRestore(tx: DbOrTx) {
  const t0 = Date.now();
  const { tables, payload } = await buildExport(tx);
  const parsed = JSON.parse(payload) as { tables: Record<string, unknown[]> };
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const tmp = (t: string) => q(`rv_${t}`);
  const out: VerifyRow[] = [];
  for (const t of tables) {
    const rows = parsed.tables[t] ?? [];
    await tx.execute(sql.raw(`create temp table ${tmp(t)} (like public.${q(t)} including defaults) on commit drop`));
    for (const c of SECRET_COLUMNS[t] ?? []) await tx.execute(sql.raw(`alter table ${tmp(t)} alter column ${q(c)} drop not null`));
    // Kwa vipande (rekodi 2,000) ili jaribio lisizidishe kumbukumbu ya database
    for (let i = 0; i < rows.length; i += 2000) {
      await tx.execute(sql`insert into ${sql.raw(tmp(t))} select * from json_populate_recordset(null::${sql.raw(`pg_temp.${tmp(t)}`)}, ${JSON.stringify(rows.slice(i, i + 2000))}::json)`);
    }
    const [{ live, restored }] = (await tx.execute<{ live: number; restored: number }>(sql.raw(`select (select count(*)::int from public.${q(t)}) as live, (select count(*)::int from ${tmp(t)}) as restored`))).rows;
    const hasId = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = ${t} and column_name = 'id'`)).rows[0].n > 0;
    const missing = hasId ? (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from (select id from public.${q(t)} except select id from ${tmp(t)}) x`))).rows[0].n : 0;
    out.push({ table: t, rows: live, restored, missing, ok: live === restored && rows.length === live && missing === 0,
      note: SECRET_COLUMNS[t] ? `Bila: ${SECRET_COLUMNS[t].join(', ')}` : undefined });
  }
  // Foreign keys: kila rekodi inayorejelea meza nyingine iliyorudishwa lazima ikute mzazi wake
  const fks = (await tx.execute<{ child: string; ccol: string; parent: string; pcol: string }>(sql`
    select cl.relname as child, a.attname as ccol, pl.relname as parent, pa.attname as pcol
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
    join pg_class pl on pl.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 order by 1, 2`)).rows;
  const set = new Set(tables);
  const orphans: { child: string; column: string; parent: string; count: number }[] = [];
  let fkChecked = 0;
  for (const f of fks) {
    if (!set.has(f.child) || !set.has(f.parent)) continue;
    fkChecked++;
    const [{ n }] = (await tx.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${tmp(f.child)} c where c.${q(f.ccol)} is not null and not exists (select 1 from ${tmp(f.parent)} p where p.${q(f.pcol)} = c.${q(f.ccol)})`))).rows;
    if (n) orphans.push({ child: f.child, column: f.ccol, parent: f.parent, count: n });
  }
  const failed = out.filter((r) => !r.ok);
  return {
    ok: !failed.length && !orphans.length, ms: Date.now() - t0, bytes: Buffer.byteLength(payload),
    tables: out, totals: { tables: out.length, rows: out.reduce((s, r) => s + r.rows, 0), failed: failed.length },
    foreignKeys: { checked: fkChecked, orphans },
    excluded: Object.entries(EXPORT_EXCLUDED).map(([table, reason]) => ({ table, reason })),
  };
}

backupRouter.post(
  '/verify-restore',
  requirePermission('backup.manage'),
  ah(async (req, res) => {
    await requireReauth(req);
    const r = await db.transaction((tx) => verifyRestore(tx), { isolationLevel: 'repeatable read' });
    const notes = r.ok
      ? `Jaribio la restore limefaulu: meza ${r.totals.tables}, rekodi ${r.totals.rows}, FK ${r.foreignKeys.checked} (${Math.round(r.ms / 1000)}s)`
      : `Jaribio la restore limeshindwa: meza ${r.totals.failed} hazilingani, rekodi yatima ${r.foreignKeys.orphans.length}`;
    const rec = await db.transaction(async (tx) => {
      const [row] = await tx.insert(B).values({ kind: 'VERIFY', status: r.ok ? 'SUCCESS' : 'FAILED', sizeBytes: r.bytes, location: 'Jaribio ndani ya database (meza za muda)', notes: notes.slice(0, 500), createdById: req.auth!.userId }).returning();
      await audit(tx, req, { action: 'BACKUP_RESTORE_VERIFIED', entity: 'BackupRecord', entityId: row.id, after: { ok: r.ok, tables: r.totals.tables, rows: r.totals.rows, failed: r.tables.filter((x) => !x.ok).map((x) => x.table), orphans: r.foreignKeys.orphans } });
      return row;
    });
    res.json({ ...r, record: rec });
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
