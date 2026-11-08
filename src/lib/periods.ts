// =====================================================================
//  VIPINDI VILIVYOFUNGWA — baada ya kukaguliwa, hakuna kinachoandikwa kwa tarehe ya nyuma
//  (trigger za DB zinakagua pia: journal_entries na finance_transactions)
// =====================================================================
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { badRequest } from './errors';

export async function lockedThrough(tx: DbOrTx, amcosId: string): Promise<string | null> {
  const r = await tx.execute<{ d: string | null }>(sql`select max(locked_through)::text as d from period_locks where amcos_id = ${amcosId}`);
  return r.rows[0]?.d ?? null;
}

export const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);

/** Kataa tarehe iliyo ndani ya kipindi kilichofungwa (ujumbe unaoeleweka kabla ya trigger ya DB). */
export async function assertOpen(tx: DbOrTx, amcosId: string, date: string) {
  const l = await lockedThrough(tx, amcosId);
  if (l && date <= l) throw badRequest(`Kipindi kimefungwa hadi ${l}. Tumia tarehe ya ${nextDay(l)} au baadaye.`);
}
