// =====================================================================
//  MIGRATIONS SALAMA — zinaendeshwa na server yenyewe KABLA haijawaka (na pia na `npm run release`).
//
//  Kwa nini si migrator ya kawaida ya Drizzle peke yake?
//   - Drizzle inaangalia `created_at` ya migration ya MWISHO tu. Kama database ina rekodi yenye muda mkubwa
//     kuliko migration mpya, migration mpya INARUKWA KIMYAKIMYA (hakuna kosa).
//   - Ikiwa pre-deploy ya Railway haikuendeshwa, au iliendeshwa kwenye database nyingine (DIRECT_URL),
//     app inawaka na schema ya zamani na inaanguka.
//  Hapa: kila migration inakaguliwa kwa HASH yake, kwenye database ile ile app inayotumia (DATABASE_URL),
//  kwa advisory lock (replica/pre-deploy mbili zisigongane), na kila migration ndani ya transaction yake.
//  Hakuna DROP wala DELETE: migrations ni za kuongeza tu.
// =====================================================================
import fs from 'fs';
import path from 'path';
import type { Pool, PoolClient } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const LOCK_KEY = 815_205;
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/**
 * Alama za kila migration: vitu ambavyo migration hiyo inaviunda.
 * Vikiwepo VYOTE lakini migration haijarekodiwa (mf. ilirekodiwa kwa hash tofauti au kwa `drizzle-kit push`),
 * tunairekodi bila kuiendesha tena. Vikiwepo BAADHI tu -> schema haieleweki: tunasimama na kueleza.
 */
const MARKERS: Record<string, string[]> = {
  '0000_init': [
    "select to_regclass('public.users') is not null",
    "select to_regclass('public.amcos') is not null",
    "select to_regclass('public.member_ledger_entries') is not null",
  ],
  '0001_immutable_records': [
    "select exists (select 1 from pg_proc where proname = 'prevent_change')",
  ],
  '0002_owner_control_panel': [
    "select to_regclass('public.job_runs') is not null",
    "select to_regclass('public.subscriptions') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'totp_secret')",
  ],
  '0003_amcos_staff_roles': [
    "select to_regclass('public.approval_requests') is not null",
    "select to_regclass('public.finance_transactions') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'input_items' and column_name = 'reorder_level')",
  ],
  '0004_member_form': [
    "select to_regclass('public.member_photos') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'voter_id_number')",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'guarantor_phone')",
  ],
  '0005_accounting': [
    "select to_regclass('public.gl_accounts') is not null",
    "select to_regclass('public.journal_lines') is not null",
    "select to_regclass('public.payroll_runs') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'contra_gl_account_id')",
  ],
  '0006_closing_and_openings': [
    "select to_regclass('public.period_locks') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_transactions' and column_name = 'market_id')",
    "select exists (select 1 from pg_proc where proname = 'journal_period_guard')",
  ],
  '0007_stock_receipt_approval': [
    "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'approval_type' and e.enumlabel = 'STOCK_RECEIPT')",
  ],
  '0008_member_groups': [
    "select to_regclass('public.member_groups') is not null",
    "select to_regclass('public.member_group_members') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settlement_lines' and column_name = 'beneficiary_member_id')",
  ],
  '0009_pesa_ya_kuni': [
    "select to_regclass('public.kuni_settings') is not null",
    "select to_regclass('public.kuni_loans') is not null",
  ],
  '0010_cooplink_fees': [
    "select to_regclass('public.platform_fees') is not null",
    "select to_regclass('public.platform_control_numbers') is not null",
    "select to_regclass('public.teepay_events') is not null",
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_payments' and column_name = 'fee_id')",
  ],
};

interface JournalEntry { tag: string; when: number }
export interface MigrationReport { applied: string[]; recorded: string[]; alreadyDone: number; total: number }

async function markerState(client: PoolClient, tag: string): Promise<'all' | 'none' | 'partial' | 'unknown'> {
  const checks = MARKERS[tag];
  if (!checks) return 'unknown';
  let present = 0;
  for (const q of checks) {
    const r = await client.query<{ [k: string]: boolean }>(q);
    if (Object.values(r.rows[0])[0]) present++;
  }
  return present === checks.length ? 'all' : present === 0 ? 'none' : 'partial';
}

/** Endesha migrations zote ambazo hazijaendeshwa. Inarusha kosa (na kueleza) ikishindwa. */
export async function runMigrations(pool: Pool, log: (m: string) => void = console.log): Promise<MigrationReport> {
  // Faili zile zile, mgawanyo ule ule na hash ile ile kama Drizzle (rekodi zinaendana na drizzle-kit)
  const files = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] };
  const entries = journal.entries.map((e, i) => ({ ...e, ...files[i] }));

  const client = await pool.connect();
  const report: MigrationReport = { applied: [], recorded: [], alreadyDone: 0, total: entries.length };
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('create schema if not exists drizzle');
    await client.query('create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)');
    const done = new Set((await client.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations')).rows.map((r) => r.hash));

    for (const m of entries) {
      if (done.has(m.hash)) { report.alreadyDone++; continue; }
      const state = await markerState(client, m.tag);
      if (state === 'partial') {
        throw new Error(`Migration ${m.tag}: baadhi ya vitu vyake vipo na vingine havipo. Schema haieleweki — hakuna kilichobadilishwa. Kagua database kabla ya kuendelea.`);
      }
      await client.query('begin');
      try {
        if (state === 'all') {
          report.recorded.push(m.tag); // ipo tayari (mf. ilirekodiwa kwa hash ya zamani) — irekodi tu
        } else {
          for (const stmt of m.sql) if (stmt.trim()) await client.query(stmt);
          report.applied.push(m.tag);
        }
        await client.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [m.hash, m.folderMillis]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        const err = e as { message: string; code?: string };
        throw new Error(`Migration ${m.tag} imeshindwa (${err.code ?? 'kosa'}): ${err.message}. Imerudishwa nyuma (rollback) — data haijaguswa.`);
      }
      log(state === 'all' ? `   ↺ ${m.tag}: ipo tayari kwenye database — imerekodiwa` : `   ✓ ${m.tag}: imeendeshwa`);
    }
    return report;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Jina la host/database bila nenosiri wala mtumiaji — kwa logs. */
export function describeDb(url: string | undefined) {
  if (!url) return '(haijawekwa)';
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? ':' + u.port : ''}/${u.pathname.replace(/^\//, '') || '?'}`;
  } catch {
    return '(URL isiyosomeka)';
  }
}
