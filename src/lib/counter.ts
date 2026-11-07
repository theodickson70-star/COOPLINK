import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';

// Inatoa namba inayofuata kwa usalama (atomic) hata watu wengi wakiandika kwa wakati mmoja.
export async function nextNumber(db: DbOrTx, amcosId: string, key: string): Promise<number> {
  const res = await db.execute<{ value: number }>(sql`
    INSERT INTO counters (amcos_id, key, value) VALUES (${amcosId}, ${key}, 1)
    ON CONFLICT (amcos_id, key) DO UPDATE SET value = counters.value + 1
    RETURNING value
  `);
  return Number(res.rows[0].value);
}

export const pad = (n: number, width = 6) => String(n).padStart(width, '0');
