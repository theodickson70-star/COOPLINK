// =====================================================================
//  HATI RASMI ZA FEDHA (v0.42) — Stakabadhi ya Fedha (R-…) na Hati ya Malipo (PV-…)
//   Viwango vya kimataifa vya udhibiti wa ndani:
//    - namba kwa mfululizo usio na pengo, tofauti kwa risiti na vocha; chama kinaanza pale kitabu cha karatasi kilipoishia
//    - hati haifutwi: iliyokataliwa/iliyosahihishwa inabaki na namba yake na inaonyeshwa hivyo
//    - mistari mingi (Maelezo) na MGAO — kila mstari kwenye akaunti yake ya daftari kuu na kituo cha gharama
//    - chapisho la kwanza ni ASILI, zinazofuata ni NAKALA (zinahesabiwa na kurekodiwa nani alichapisha)
//    - QR ya kuhakiki hati bila kuingia kwenye mfumo
// =====================================================================
import crypto from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { badRequest } from './errors';
import { nextNumber, pad } from './counter';
import { D, fmt2 } from './money';
import { decimalSchema } from './http';

export type DocType = 'RECEIPT' | 'PAYMENT_VOUCHER';
export const DOC: Record<DocType, { key: string; prefix: string; title: string; titleEn: string }> = {
  RECEIPT: { key: 'doc_receipt', prefix: 'R-', title: 'STAKABADHI YA FEDHA', titleEn: 'OFFICIAL RECEIPT' },
  PAYMENT_VOUCHER: { key: 'doc_voucher', prefix: 'PV-', title: 'HATI YA MALIPO', titleEn: 'PAYMENT VOUCHER' },
};
export const docTypeOf = (kind: string): DocType | null =>
  kind === 'INCOME' ? 'RECEIPT' : ['EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT'].includes(kind) ? 'PAYMENT_VOUCHER' : null;

export async function nextDocNo(tx: DbOrTx, amcosId: string, type: DocType) {
  return `${DOC[type].prefix}${pad(await nextNumber(tx, amcosId, DOC[type].key))}`;
}

/** Namba ya mwisho iliyotolewa (0 = bado) */
export async function lastIssued(tx: DbOrTx, amcosId: string, type: DocType) {
  const r = await tx.execute<{ value: number }>(sql`select value from counters where amcos_id = ${amcosId} and key = ${DOC[type].key}`);
  return Number(r.rows[0]?.value ?? 0);
}

/**
 * Kuendelea kutoka kitabu cha karatasi: namba inayofuata inaweza kusogezwa MBELE tu (si nyuma) —
 * hivyo hakuna namba mbili zinazofanana, na pengo lolote linaonekana kwenye kumbukumbu.
 */
export async function setNextDocNo(tx: DbOrTx, amcosId: string, type: DocType, next: number) {
  const last = await lastIssued(tx, amcosId, type);
  if (next <= last) throw badRequest(`Namba inayofuata lazima iwe kubwa kuliko ${last} (iliyotolewa mwisho) — haiwezi kurudi nyuma`);
  await tx.execute(sql`insert into counters (amcos_id, key, value) values (${amcosId}, ${DOC[type].key}, ${next - 1})
    on conflict (amcos_id, key) do update set value = excluded.value`);
  return { previousLast: last, next };
}

// ------------------------------ MISTARI NA MGAO ------------------------------
export const linesSchema = z.array(z.object({
  description: z.string().trim().min(2, 'Kila mstari uwe na maelezo').max(200),
  amount: decimalSchema({ min: 0.01 }),
  glAccountId: z.string().uuid().nullable().optional(),
  costCenter: z.string().trim().max(60).nullable().optional(),
})).max(30, 'Mistari isizidi 30 kwenye hati moja').optional();
export type DocLine = NonNullable<z.infer<typeof linesSchema>>[number];

/**
 * Jumla ya mistari lazima ilingane na kiasi cha hati (hadi senti). Akaunti za MGAO: za chama hiki, hai, si za fedha,
 * na za aina inayofaa (malipo: matumizi/mali/madeni; mapato: mapato/madeni/mtaji).
 */
export async function validateLines(amcosId: string, lines: DocLine[] | undefined, total: string, direction: 'IN' | 'OUT', allowGl: boolean) {
  if (!lines?.length) return [];
  const sum = lines.reduce((s, l) => s.plus(l.amount), D(0));
  if (!sum.toDecimalPlaces(2).eq(D(total).toDecimalPlaces(2))) {
    throw badRequest(`Jumla ya mistari (TSh ${fmt2(sum)}) hailingani na kiasi cha hati (TSh ${fmt2(total)})`);
  }
  const ids = [...new Set(lines.map((l) => l.glAccountId).filter((x): x is string => !!x))];
  if (ids.length && !allowGl) throw badRequest('Aina hii ya muamala haina MGAO wa akaunti (inaingia kwenye akaunti yake yenyewe)');
  if (ids.length) {
    const gs = await db.select().from(schema.glAccounts).where(and(inArray(schema.glAccounts.id, ids), eq(schema.glAccounts.amcosId, amcosId)));
    const ok = direction === 'OUT' ? ['EXPENSE', 'ASSET', 'LIABILITY'] : ['INCOME', 'LIABILITY', 'EQUITY'];
    for (const id of ids) {
      const g = gs.find((x) => x.id === id);
      if (!g || !g.isActive) throw badRequest('Akaunti ya MGAO si sahihi');
      if (['CASH', 'CASH_GROUP', 'TRANSFER'].includes(g.subtype ?? '')) throw badRequest(`${g.code} ${g.name} ni akaunti ya fedha — chagua akaunti ya ${direction === 'OUT' ? 'matumizi' : 'mapato'}`);
      if (!ok.includes(g.type)) throw badRequest(`${g.code} ${g.name} haifai kwa ${direction === 'OUT' ? 'malipo' : 'mapato'}`);
    }
  }
  return lines;
}

export async function insertLines(tx: DbOrTx, amcosId: string, txnId: string, lines: DocLine[]) {
  if (!lines.length) return;
  await tx.insert(schema.financeTxnLines).values(lines.map((l, i) => ({
    amcosId, txnId, lineNo: i + 1, description: l.description, amount: fmt2(l.amount), glAccountId: l.glAccountId ?? null, costCenter: l.costCenter?.trim() || null,
  })));
}

/** Mistari ya miamala mingi kwa pamoja (kwa daftari kuu) */
export async function linesByTxn(tx: DbOrTx, txnIds: string[]) {
  const out = new Map<string, (typeof schema.financeTxnLines.$inferSelect)[]>();
  if (!txnIds.length) return out;
  const rows = await tx.select().from(schema.financeTxnLines).where(inArray(schema.financeTxnLines.txnId, txnIds)).orderBy(asc(schema.financeTxnLines.lineNo));
  for (const r of rows) out.set(r.txnId, [...(out.get(r.txnId) ?? []), r]);
  return out;
}

// ------------------------------ QR NA NAKALA ------------------------------
export async function ensureDocToken(tx: DbOrTx, amcosId: string, txnId: string) {
  const existing = await tx.query.financeDocuments.findFirst({ where: eq(schema.financeDocuments.txnId, txnId) });
  if (existing) return existing.verifyToken;
  const token = crypto.randomBytes(15).toString('base64url');
  await tx.insert(schema.financeDocuments).values({ txnId, amcosId, verifyToken: token }).onConflictDoNothing();
  return (await tx.query.financeDocuments.findFirst({ where: eq(schema.financeDocuments.txnId, txnId) }))!.verifyToken;
}

/** Kuchapisha: la kwanza ni ASILI (0), kisha NAKALA 1, 2… — kila chapisho linarekodiwa */
export async function recordPrint(amcosId: string, txnId: string, userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'docprint:' + txnId}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.financeDocPrints).where(eq(schema.financeDocPrints.txnId, txnId));
    await tx.insert(schema.financeDocPrints).values({ amcosId, txnId, copyNo: n, printedById: userId });
    return n;
  });
}

/** Jina la mlipwaji kwa ukurasa wa umma: jina la kwanza + herufi ya kwanza ya mengine (faragha) */
export const maskName = (n: string | null) => {
  if (!n) return null;
  const parts = n.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return [parts[0], ...parts.slice(1).map((p) => `${p[0]}.`)].join(' ');
};
