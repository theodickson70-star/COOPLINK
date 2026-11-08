// =====================================================================
//  MAUZO YA TUMBAKU — hesabu ya malipo ya wakulima (settlement) na makato
//   Soko -> mabelo (kilo x bei USD) -> kwa kila mkulima: jumla, makato kwa kanuni za msimu, deni la pembejeo, malipo halisi
//   Meneja anaidhinisha -> ledger ya mkulima + daftari kuu (journal moja kwa soko)
// =====================================================================
import type { Request } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { D, Decimal, fmt2, tshText } from './money';
import { conflict } from './errors';
import { audit } from './audit';
import * as ledger from './ledger';
import { postJournal, type JLine } from './gl';

type Rule = typeof schema.deductionRules.$inferSelect;

/** Akaunti ya daftari kuu ya kanuni ya makato (kama haijawekwa: inakisiwa kwa jina/code). */
export function ruleGlCode(r: Pick<Rule, 'glAccountCode' | 'basis' | 'code' | 'name'>) {
  if (r.glAccountCode) return r.glAccountCode;
  if (r.basis === 'OUTSTANDING_LOAN') return '1200';
  const s = `${r.code} ${r.name}`.toUpperCase();
  if (/LGA|CESS|HALMASHAURI|COUNCIL/.test(s)) return '2310';
  if (/UNION|KIKUU|ACU|WETCU|TCJE/.test(s)) return '2300';
  if (/AMCOS|CHAMA/.test(s)) return '4100';
  return '2320';
}

export interface DeductionCalc { ruleId: string; code: string; description: string; basis: Rule['basis']; glCode: string; amount: string }
export interface SettlementCalc { totalKg: string; grossUsd: string; grossTzs: string; deductions: DeductionCalc[]; totalDeductions: string; netTzs: string; debtBefore: string }

/** Hesabu ya mkulima mmoja. Makato hayazidi jumla ya mauzo (malipo halisi hayawi hasi). */
export function computeSettlement(bales: { netKg: string | null; grossKg: string; valueUsd: string | null }[], rate: Decimal.Value, rules: Rule[], debt: Decimal.Value): SettlementCalc {
  const kg = bales.reduce((s, b) => s.plus(b.netKg ?? b.grossKg), D(0));
  const usd = bales.reduce((s, b) => s.plus(b.valueUsd ?? 0), D(0));
  const gross = usd.times(rate).toDecimalPlaces(2);
  let remaining = gross;
  const out: DeductionCalc[] = [];
  for (const r of [...rules].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))) {
    const fx = r.currency === 'USD' ? D(rate) : D(1);
    let amt: Decimal;
    switch (r.basis) {
      case 'PERCENT_OF_GROSS': amt = gross.times(r.rate).div(100); break;
      case 'PER_KG': amt = kg.times(r.rate).times(fx); break;
      case 'FIXED': amt = D(r.rate).times(fx); break;
      case 'OUTSTANDING_LOAN': amt = D(debt).gt(0) ? D(debt) : D(0); break;
    }
    amt = Decimal.min(amt.toDecimalPlaces(2), remaining);
    if (amt.lte(0)) continue;
    remaining = remaining.minus(amt);
    out.push({ ruleId: r.id, code: r.code, basis: r.basis, glCode: ruleGlCode(r), amount: fmt2(amt),
      description: r.basis === 'OUTSTANDING_LOAN' ? `${r.name} (deni lilikuwa ${tshText(debt)})` : r.name });
  }
  const total = gross.minus(remaining);
  return { totalKg: fmt2(kg), grossUsd: fmt2(usd), grossTzs: fmt2(gross), deductions: out, totalDeductions: fmt2(total), netTzs: fmt2(remaining), debtBefore: fmt2(debt) };
}

/** Deni la mkulima sasa hivi (kutoka ledger yake): chanya = anadaiwa. */
export async function memberDebts(tx: Tx, amcosId: string, memberIds: string[]) {
  if (!memberIds.length) return new Map<string, Decimal>();
  const L = schema.memberLedgerEntries;
  const rows = await tx.select({ memberId: L.memberId, bal: sql<string>`sum(${L.credit}) - sum(${L.debit})` })
    .from(L).where(and(eq(L.amcosId, amcosId), inArray(L.memberId, memberIds))).groupBy(L.memberId);
  return new Map(rows.map((r) => [r.memberId, D(r.bal).isNeg() ? D(r.bal).neg() : D(0)]));
}

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;

/** Idhini ya mauzo ya soko: malipo ya wakulima yanaingia ledger zao na daftari kuu. */
export async function onTobaccoSale(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const S = schema.settlements;
  const MK = schema.markets;
  const [market] = await tx.select().from(MK).where(eq(MK.id, a.entityId!)).for('update');
  if (!market) throw conflict('Soko halipo');
  const drafts = await tx.select().from(S).where(and(eq(S.marketId, market.id), eq(S.status, 'DRAFT'), eq(S.approvalId, a.id)));
  if (!drafts.length) throw conflict('Hakuna hesabu za wakulima zinazosubiri idhini kwenye soko hili');
  if (o !== 'APPROVED') {
    await tx.update(S).set({ status: 'CANCELLED' }).where(and(eq(S.marketId, market.id), eq(S.status, 'DRAFT'), eq(S.approvalId, a.id)));
    await audit(tx, req, { action: `TOBACCO_SALE_${o}`, entity: 'Market', entityId: market.id, amcosId: a.amcosId, after: { settlements: drafts.length, note } });
    return;
  }
  const lines = await tx.select().from(schema.settlementLines).where(inArray(schema.settlementLines.settlementId, drafts.map((d) => d.id)));
  const rules = await tx.select().from(schema.deductionRules).where(eq(schema.deductionRules.amcosId, a.amcosId));
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const date = market.marketDate <= today ? market.marketDate : today;

  let gross = D(0);
  const credits = new Map<string, Decimal>(); // glCode -> kiasi (makato yasiyo ya deni)
  const jl: JLine[] = [];
  for (const s of drafts) {
    gross = gross.plus(s.grossTzs);
    await ledger.post(tx, {
      amcosId: a.amcosId, memberId: s.memberId, seasonId: s.seasonId, type: 'TOBACCO_SALE', credit: s.grossTzs,
      description: `Mauzo ya tumbaku ${market.marketNo} (${s.settlementNo}): kilo ${s.totalKg}`, referenceType: 'SETTLEMENT', referenceId: s.id, createdById: req.auth!.userId,
    });
    for (const l of lines.filter((x) => x.settlementId === s.id)) {
      const rule = l.deductionRuleId ? ruleById.get(l.deductionRuleId) : undefined;
      const code = rule ? ruleGlCode(rule) : '2320';
      if (code === '1200') {
        // Deni la pembejeo linalipwa kwa mauzo: ledger ya mkulima tayari inaonyesha deni, salio linajipunguza lenyewe
        jl.push({ code: '1200', credit: l.amount, memberId: s.memberId, memo: `Deni limerejeshwa ${s.settlementNo}` });
      } else {
        await ledger.post(tx, {
          amcosId: a.amcosId, memberId: s.memberId, seasonId: s.seasonId, type: 'DEDUCTION', debit: l.amount,
          description: `${l.description} (${s.settlementNo})`, referenceType: 'SETTLEMENT', referenceId: s.id, createdById: req.auth!.userId,
        });
        credits.set(code, (credits.get(code) ?? D(0)).plus(l.amount));
      }
    }
  }
  const totalDed = drafts.reduce((s, d) => s.plus(d.totalDeductions), D(0));
  await postJournal(tx, {
    amcosId: a.amcosId, date, description: `Mauzo ya tumbaku soko ${market.marketNo}${market.buyerName ? ` (${market.buyerName})` : ''}: wakulima ${drafts.length}`,
    source: 'TOBACCO_SALE', sourceId: a.id, reference: market.marketNo, approvalId: a.id, createdById: req.auth!.userId,
    lines: [
      { code: '1220', debit: gross, memo: `Mnunuzi anadaiwa — ${market.buyerName ?? market.marketNo}` },
      { code: '2200', credit: gross, memo: 'Thamani ya mauzo ya wakulima' },
      { code: '2200', debit: totalDed, memo: 'Makato ya wakulima' },
      ...[...credits].map(([code, v]) => ({ code, credit: v })),
      ...jl,
    ],
  });
  await tx.update(S).set({ status: 'APPROVED', approvedById: req.auth!.userId, approvedAt: new Date() })
    .where(and(eq(S.marketId, market.id), eq(S.status, 'DRAFT'), eq(S.approvalId, a.id)));
  await tx.update(MK).set({ status: 'CLOSED' }).where(eq(MK.id, market.id));
  await audit(tx, req, { action: 'TOBACCO_SALE_APPROVED', entity: 'Market', entityId: market.id, amcosId: a.amcosId,
    after: { settlements: drafts.length, grossTzs: fmt2(gross), deductions: fmt2(totalDed), note } });
}

/** Idhini ya orodha ya malipo ya wakulima. Fedha HAZITOKI hapa: Mhasibu anathibitisha kila malipo yaliyofanyika kweli. */
export async function onPaymentBatch(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const B = schema.paymentBatches;
  const [batch] = await tx.select().from(B).where(eq(B.id, a.entityId!)).for('update');
  if (!batch || batch.status !== 'DRAFT') throw conflict('Orodha hii ya malipo haisubiri idhini');
  if (o === 'APPROVED') {
    await tx.update(B).set({ status: 'APPROVED', approvedById: req.auth!.userId, approvedAt: new Date() }).where(eq(B.id, batch.id));
  } else {
    await tx.update(B).set({ status: 'CANCELLED' }).where(eq(B.id, batch.id));
    await tx.update(schema.payments).set({ status: 'CANCELLED', failureReason: note }).where(and(eq(schema.payments.batchId, batch.id), eq(schema.payments.status, 'PENDING')));
  }
  await audit(tx, req, { action: `PAYMENT_BATCH_${o}`, entity: 'PaymentBatch', entityId: batch.id, amcosId: a.amcosId, before: { status: batch.status }, after: { note } });
}
