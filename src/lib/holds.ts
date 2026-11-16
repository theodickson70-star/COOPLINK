// Zuio la malipo (v0.43): Afisa Ushirika akiweka zuio, hakuna fedha inayotoka kwenye chama
// (malipo ya mauzo, mikopo, mishahara, matumizi, malipo kwa wazabuni, uhamisho kati ya akaunti).
// Mapato bado yanapokelewa. Linakaguliwa kwenye backend wakati wa KUKAMILISHA malipo.
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { AppError } from './errors';

export async function activeHold(tx: DbOrTx, amcosId: string) {
  const [h] = await tx.select().from(schema.paymentHolds).where(and(eq(schema.paymentHolds.amcosId, amcosId), isNull(schema.paymentHolds.liftedAt)));
  return h ?? null;
}
export async function assertNoHold(tx: DbOrTx, amcosId: string) {
  const h = await activeHold(tx, amcosId);
  if (h) throw new AppError(423, 'PAYMENT_HOLD', `Malipo yamezuiwa na Afisa Ushirika tangu ${h.placedAt.toISOString().slice(0, 10)}: ${h.reason}. Wasiliana na Afisa Ushirika wa Wilaya.`, { holdId: h.id });
}
