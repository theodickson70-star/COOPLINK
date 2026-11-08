// Uhakiki wa schema: kila meza na column ambayo CODE inaitarajia (src/db/schema.ts) lazima iwepo kwenye database.
// Inatumika server inapowaka (baada ya migrations) na kwenye /health. Haibadilishi kitu.
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import * as schema from './schema';

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export interface SchemaCheck { ok: boolean; tables: number; missingTables: string[]; missingColumns: string[] }

export async function verifySchema(pool: Pool): Promise<SchemaCheck> {
  const expected = new Map<string, string[]>();
  for (const v of Object.values(schema)) {
    if (!is(v, PgTable)) continue;
    const cfg = getTableConfig(v);
    // casing: 'snake_case' -> majina ya columns ni snake_case ya majina ya TypeScript
    expected.set(cfg.name, cfg.columns.map((c) => (c.keyAsName ? snake(c.name) : c.name)));
  }
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const [t, cols] of expected) {
    const have = actual.get(t);
    if (!have) { missingTables.push(t); continue; }
    for (const c of cols) if (!have.has(c)) missingColumns.push(`${t}.${c}`);
  }
  return { ok: !missingTables.length && !missingColumns.length, tables: expected.size, missingTables, missingColumns };
}
