// =====================================================================
//  PEMBEJEO KWA DOLA (USD)
//   - Chama cha USD: bei za pembejeo, mikopo ya pembejeo kwa wakulima na manunuzi kwa wazabuni ni za dola.
//   - Vitabu (ledger ya mkulima, daftari kuu, fedha) vinabaki TSh: kila kiasi cha dola kinabadilishwa kwa kiwango
//     cha siku husika, na dola zenyewe zinahifadhiwa kando (deni la dola la mkulima = member_usd_ledger).
//   - Siku ya kulipa (soko au marejesho ya fedha taslimu) deni la dola linabadilishwa kwa kiwango cha siku hiyo:
//     tofauti inaandikwa kama FX_ADJUSTMENT kwa mkulima na faida/hasara ya kubadilisha fedha kwenye daftari kuu.
// =====================================================================
import type { Request } from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx, type Tx } from '../db';
import { D, Decimal, fmt2 } from './money';
import { badRequest } from './errors';
import * as ledger from './ledger';
import type { JLine } from './gl';

export const FX_GAIN = '4700';
export const FX_LOSS = '5700';
export const RATE_LIMITS = { min: 1000, max: 10000 } as const;

export function rateProblem(rate: Decimal.Value | null | undefined) {
  if (rate === null || rate === undefined || rate === '') return 'Weka kiwango cha dola (TSh kwa USD 1)';
  const r = D(rate);
  if (r.lt(RATE_LIMITS.min) || r.gt(RATE_LIMITS.max)) return `Kiwango ${r.toFixed()} si halisi — weka shilingi ngapi kwa dola 1 (mf. 2,550)`;
  return null;
}

export async function inputCurrency(tx: DbOrTx, amcosId: string): Promise<'TZS' | 'USD'> {
  const a = await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { inputCurrency: true } });
  return a?.inputCurrency ?? 'TZS';
}

/** Kiwango cha sasa cha chama (cha karibuni kilichowekwa na Mhasibu) */
export async function currentRate(tx: DbOrTx, amcosId: string) {
  const [r] = await tx.select().from(schema.fxRates).where(eq(schema.fxRates.amcosId, amcosId)).orderBy(desc(schema.fxRates.createdAt)).limit(1);
  return r ?? null;
}
export async function requireRate(tx: DbOrTx, amcosId: string) {
  const r = await currentRate(tx, amcosId);
  if (!r) throw badRequest('Kiwango cha dola hakijawekwa. Mhasibu aweke kiwango (Fedha → Kiwango cha dola) kwanza.');
  return D(r.usdToTzs);
}

/** Dola -> TSh (senti 2) */
export const toTzs = (usd: Decimal.Value, rate: Decimal.Value) => D(usd).times(rate).toDecimalPlaces(2);

/** Deni la dola la wakulima: usd (dola zinazodaiwa) na tzs (thamani yake kwenye vitabu). */
export async function usdPositions(tx: DbOrTx, amcosId: string, memberIds: string[]) {
  const out = new Map<string, { usd: Decimal; tzs: Decimal }>();
  if (!memberIds.length) return out;
  const U = schema.memberUsdLedger;
  const rows = await tx.select({ m: U.memberId, usd: sql<string>`sum(${U.usd})`, tzs: sql<string>`sum(${U.tzs})` })
    .from(U).where(and(eq(U.amcosId, amcosId), inArray(U.memberId, memberIds))).groupBy(U.memberId);
  for (const r of rows) out.set(r.m, { usd: D(r.usd), tzs: D(r.tzs) });
  return out;
}

/** Tofauti ya kiwango: deni la dola likibadilishwa kwa `rate`, vitabu vinaongezeka (chanya) au kupungua (hasi) kwa kiasi hiki. */
export function revaluationDiff(p: { usd: Decimal; tzs: Decimal } | undefined, rate: Decimal.Value) {
  if (!p) return D(0);
  const target = p.usd.gt(0) ? toTzs(p.usd, rate) : D(0);
  return target.minus(p.tzs);
}

export async function recordUsd(tx: Tx, e: { amcosId: string; memberId: string; seasonId?: string | null; kind: 'ISSUE' | 'CANCEL' | 'REVALUE' | 'REPAY'; usd: Decimal.Value; tzs: Decimal.Value; rate?: Decimal.Value | null; description: string; referenceType?: string; referenceId?: string; createdById?: string }) {
  await tx.insert(schema.memberUsdLedger).values({
    amcosId: e.amcosId, memberId: e.memberId, seasonId: e.seasonId ?? null, kind: e.kind, usd: fmt2(e.usd), tzs: fmt2(e.tzs),
    rate: e.rate == null ? null : D(e.rate).toFixed(4), description: e.description, referenceType: e.referenceType, referenceId: e.referenceId, createdById: e.createdById,
  });
}

/**
 * Mkulima analipa deni kwa `paidTzs` siku yenye kiwango `rate`:
 *  1) deni la dola linabadilishwa kwa kiwango hicho (FX_ADJUSTMENT kwenye ledger yake + mistari ya daftari kuu)
 *  2) malipo yanapunguza deni la dola kwanza (REPAY).
 * Inarudisha mistari ya journal (1200 dhidi ya 4700/5700) ili iingie kwenye journal ya tukio husika.
 */
export async function settleUsdDebt(tx: Tx, req: Request, o: { amcosId: string; memberId: string; seasonId?: string | null; rate: Decimal.Value; paidTzs: Decimal.Value; ref: string; referenceType: string; referenceId: string; revalueOnly?: boolean }): Promise<JLine[]> {
  const pos = (await usdPositions(tx, o.amcosId, [o.memberId])).get(o.memberId);
  if (!pos || (pos.usd.isZero() && pos.tzs.isZero())) return [];
  const jl: JLine[] = [];
  const diff = revaluationDiff(pos, o.rate);
  if (!diff.isZero()) {
    const gain = diff.isPos();
    await ledger.post(tx, {
      amcosId: o.amcosId, memberId: o.memberId, seasonId: o.seasonId ?? null, type: 'FX_ADJUSTMENT', ...(gain ? { debit: fmt2(diff) } : { credit: fmt2(diff.neg()) }),
      description: `Deni la pembejeo $${fmt2(pos.usd)} kwa kiwango cha ${D(o.rate).toFixed()} (${o.ref})`, referenceType: o.referenceType, referenceId: o.referenceId, createdById: req.auth!.userId,
    });
    await recordUsd(tx, { amcosId: o.amcosId, memberId: o.memberId, seasonId: o.seasonId, kind: 'REVALUE', usd: 0, tzs: diff, rate: o.rate, description: `Kiwango ${D(o.rate).toFixed()} (${o.ref})`, referenceType: o.referenceType, referenceId: o.referenceId, createdById: req.auth!.userId });
    jl.push(...(gain
      ? [{ code: '1200', debit: diff, memberId: o.memberId, memo: `Tofauti ya kiwango cha dola — ${o.ref}` }, { code: FX_GAIN, credit: diff, memo: `Faida ya kiwango cha dola — ${o.ref}` }]
      : [{ code: FX_LOSS, debit: diff.neg(), memo: `Hasara ya kiwango cha dola — ${o.ref}` }, { code: '1200', credit: diff.neg(), memberId: o.memberId, memo: `Tofauti ya kiwango cha dola — ${o.ref}` }]));
  }
  if (o.revalueOnly || !pos.usd.gt(0)) return jl;
  const carrying = toTzs(pos.usd, o.rate);
  const pay = Decimal.min(D(o.paidTzs), carrying);
  if (pay.lte(0)) return jl;
  const usdPaid = pay.eq(carrying) ? pos.usd : pay.div(o.rate).toDecimalPlaces(2);
  await recordUsd(tx, { amcosId: o.amcosId, memberId: o.memberId, seasonId: o.seasonId, kind: 'REPAY', usd: usdPaid.neg(), tzs: pay.neg(), rate: o.rate, description: `Deni la dola limelipwa $${fmt2(usdPaid)} (${o.ref})`, referenceType: o.referenceType, referenceId: o.referenceId, createdById: req.auth!.userId });
  return jl;
}

/** Kwa taarifa (statement/portal): deni la dola la mkulima na thamani yake kwa kiwango cha sasa. */
export async function usdSummary(amcosId: string, memberId: string) {
  const pos = (await usdPositions(db, amcosId, [memberId])).get(memberId);
  if (!pos) return null;
  const rate = await currentRate(db, amcosId);
  // Mgawanyo: dola zilizotolewa kwa pembejeo, mkopo wa kuni na mkopo wa grading (neti ya zilizofutwa)
  const [b] = (await db.execute<{ inputs: string; kuni: string; grading: string; trees: string; repaid: string }>(sql`
    select coalesce(sum(case when u.reference_type = 'INPUT_ISSUE' and u.kind in ('ISSUE', 'CANCEL') then u.usd end), 0)::numeric(14,2)::text as inputs,
      coalesce(sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'KUNI' then u.usd end), 0)::numeric(14,2)::text as kuni,
      coalesce(sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'GRADING' then u.usd end), 0)::numeric(14,2)::text as grading,
      coalesce(sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'TREES' then u.usd end), 0)::numeric(14,2)::text as trees,
      coalesce(-sum(case when u.kind = 'REPAY' then u.usd end), 0)::numeric(14,2)::text as repaid
    from member_usd_ledger u left join kuni_loans kl on u.reference_type = 'KUNI_LOAN' and kl.id = u.reference_id
    where u.amcos_id = ${amcosId} and u.member_id = ${memberId}`)).rows;
  return {
    breakdown: { inputsUsd: b.inputs, kuniUsd: b.kuni, gradingUsd: b.grading, treesUsd: b.trees, repaidUsd: b.repaid },
    debtUsd: fmt2(Decimal.max(pos.usd, 0)), bookTzs: fmt2(pos.tzs),
    rate: rate?.usdToTzs ?? null, rateAt: rate?.createdAt ?? null, atCurrentTzs: rate && pos.usd.gt(0) ? fmt2(toTzs(pos.usd, rate.usdToTzs)) : null,
  };
}
