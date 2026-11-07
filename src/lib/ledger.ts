// =====================================================================
//  LEDGER YA MWANACHAMA — njia PEKEE ya kuandika fedha za mwanachama.
//  Rekodi haibadilishwi; kosa linasahihishwa kwa reverse().
// =====================================================================
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import { schema } from '../db';
import { D, fmt2 } from './money';
import { conflict, notFound } from './errors';

type EntryType = (typeof schema.ledgerEntryTypeEnum.enumValues)[number];

export async function post(
  db: DbOrTx,
  e: {
    amcosId: string;
    memberId: string;
    seasonId?: string | null;
    type: EntryType;
    debit?: string;
    credit?: string;
    description: string;
    referenceType?: string;
    referenceId?: string;
    createdById?: string;
  },
) {
  const debit = D(e.debit);
  const credit = D(e.credit);
  if (debit.isNeg() || credit.isNeg() || debit.plus(credit).isZero() || (!debit.isZero() && !credit.isZero())) {
    throw new Error('Ledger: rekodi iwe debit AU credit, kiasi chanya');
  }
  const [row] = await db
    .insert(schema.memberLedgerEntries)
    .values({
      amcosId: e.amcosId,
      memberId: e.memberId,
      seasonId: e.seasonId ?? null,
      type: e.type,
      debit: fmt2(debit),
      credit: fmt2(credit),
      description: e.description,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      createdById: e.createdById,
    })
    .returning();
  return row;
}

/** Futa rekodi kwa kuandika rekodi kinyume (debit <-> credit). */
export async function reverse(db: DbOrTx, entryId: string, description: string, createdById?: string) {
  const original = await db.query.memberLedgerEntries.findFirst({ where: eq(schema.memberLedgerEntries.id, entryId) });
  if (!original) throw notFound('Rekodi ya ledger');
  if (original.type === 'REVERSAL') throw conflict('Rekodi ya REVERSAL haiwezi kufutwa');
  const [row] = await db
    .insert(schema.memberLedgerEntries)
    .values({
      amcosId: original.amcosId,
      memberId: original.memberId,
      seasonId: original.seasonId,
      type: 'REVERSAL',
      debit: original.credit,
      credit: original.debit,
      description,
      referenceType: original.referenceType,
      referenceId: original.referenceId,
      reversalOfId: original.id, // UNIQUE: rekodi moja haiwezi kufutwa mara mbili
      createdById,
    })
    .returning();
  return row;
}

/** Salio la mwanachama. balance = credit - debit (hasi = ana deni). */
export async function memberBalance(db: DbOrTx, amcosId: string, memberId: string, seasonId?: string) {
  const where: SQL[] = [
    eq(schema.memberLedgerEntries.amcosId, amcosId),
    eq(schema.memberLedgerEntries.memberId, memberId),
  ];
  if (seasonId) where.push(eq(schema.memberLedgerEntries.seasonId, seasonId));
  const [r] = await db
    .select({
      debit: sql<string>`coalesce(sum(${schema.memberLedgerEntries.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${schema.memberLedgerEntries.credit}), 0)`,
    })
    .from(schema.memberLedgerEntries)
    .where(and(...where));
  const balance = D(r.credit).minus(r.debit);
  return {
    totalDebit: fmt2(r.debit),
    totalCredit: fmt2(r.credit),
    balance: fmt2(balance),
    amountOwed: fmt2(balance.isNeg() ? balance.neg() : 0), // deni analodaiwa
  };
}
