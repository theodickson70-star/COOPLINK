// Stoo: salio na kufunga bidhaa wakati wa kuandika (watu wawili wasitumie salio lilelile kwa wakati mmoja)
import { and, eq, sql } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { D } from './money';

const moves = schema.stockMovements;

/** Salio la stoo la bidhaa moja kwa msimu. */
export async function stockBalance(tx: DbOrTx, amcosId: string, seasonId: string, inputItemId: string) {
  const [r] = await tx
    .select({ qty: sql<string>`coalesce(sum(${moves.quantity}), 0)` })
    .from(moves)
    .where(and(eq(moves.amcosId, amcosId), eq(moves.seasonId, seasonId), eq(moves.inputItemId, inputItemId)));
  return D(r.qty);
}

/** Funga bidhaa hizi kwa muda wa transaction. */
export async function lockItems(tx: DbOrTx, amcosId: string, itemIds: string[]) {
  for (const id of [...new Set(itemIds)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${amcosId + ':' + id}))`);
  }
}
