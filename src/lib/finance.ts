// Fedha za chama (AMCOS) — akaunti, namba za miamala, makundi. HAZICHANGANYWI na fedha za CoopLink.
import { and, eq, sql } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { D } from './money';
import { nextNumber, pad } from './counter';

export const INCOME_CATEGORIES: Record<string, string> = {
  TOBACCO_SALES: 'Mauzo ya tumbaku',
  MEMBER_FEES: 'Ada za uanachama',
  SHARE_CAPITAL: 'Hisa za wanachama',
  LEVY: 'Ushuru / tozo',
  FARMER_REPAYMENT: 'Marejesho ya deni la mkulima',
  LOAN_RECEIVED: 'Mkopo uliopokelewa',
  GRANT: 'Ruzuku / msaada',
  INTEREST: 'Riba ya benki',
  ASSET_SALE: 'Mauzo ya mali za chama',
  OTHER_INCOME: 'Mapato mengine',
};
export const EXPENSE_CATEGORIES: Record<string, string> = {
  SALARIES: 'Mishahara na posho',
  TRANSPORT: 'Usafiri',
  OFFICE: 'Ofisi na vifaa',
  UTILITIES: 'Umeme, maji na mawasiliano',
  MEETINGS: 'Mikutano',
  REPAIRS: 'Matengenezo',
  TAXES: 'Kodi na ada za serikali',
  BANK_CHARGES: 'Gharama za benki',
  INPUT_HANDLING: 'Upakiaji na usafirishaji wa pembejeo',
  TRAINING: 'Mafunzo',
  REMITTANCE: 'Kulipa madeni (Chama Kikuu, ushuru, kodi, NSSF)',
  OTHER_EXPENSE: 'Matumizi mengine',
};
export const FARMER_PAYMENT_CATEGORIES: Record<string, string> = {
  PAYMENT: 'Malipo kwa mkulima',
  CASH_LOAN: 'Mkopo wa fedha kwa mkulima',
};
export const SUPPLIER_PAYMENT_CATEGORIES: Record<string, string> = { SUPPLIER: 'Malipo kwa mzabuni' };

const T = schema.financeTransactions;

/** Salio la akaunti = salio la kuanzia + miamala iliyokamilika (IN - OUT). */
export async function accountBalance(tx: DbOrTx, accountId: string) {
  const acc = await tx.query.financeAccounts.findFirst({ where: eq(schema.financeAccounts.id, accountId) });
  if (!acc) return D(0);
  const [r] = await tx.select({
    net: sql<string>`coalesce(sum(case when ${T.direction} = 'IN' then ${T.amount} else -${T.amount} end), 0)`,
  }).from(T).where(and(eq(T.accountId, accountId), eq(T.status, 'POSTED')));
  return D(acc.openingBalance).plus(r.net);
}

export async function lockAccount(tx: DbOrTx, accountId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'acc:' + accountId}))`);
}

export async function nextTxnNo(tx: DbOrTx, amcosId: string, code: string) {
  return `${code}-FN-${pad(await nextNumber(tx, amcosId, 'finance_txn'))}`;
}
