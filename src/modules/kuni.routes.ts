// =====================================================================
//  MIKOPO YA WAKULIMA — (1) mkopo wa kuni  (2) mkopo wa grading
//   Kila aina ina mipangilio yake ya msimu (Mhasibu): riba %, kikomo kwa DOLA kwa ekari, wazi/imefungwa
//   Kikomo cha mkulima = ekari za makisio yaliyoidhinishwa x dola kwa ekari - alichokwisha kukopa (aina hiyo) msimu huu
//   Mhasibu anaandaa orodha (dola; TSh kwa kiwango cha siku hiyo) -> Meneja anaidhinisha -> pesa zinatumwa
//   -> Mhasibu anathibitisha waliolipwa: mkopo + riba vinaingia kwenye deni la dola la mkulima (pamoja na pembejeo)
//   Deni la dola linakatwa sokoni kwa kiwango cha siku ya soko. Orodha za zamani za TSh zinaendelea kama zilivyo.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, Decimal, fmt2, tshText } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import * as ledger from '../lib/ledger';
import { createApproval } from '../lib/approvals';
import { accountBalance, lockAccount, nextTxnNo } from '../lib/finance';
import { postJournal } from '../lib/gl';
import { destinationOf } from '../lib/payout';
import { assertOpen } from '../lib/periods';
import { currentRate, recordUsd, requireRate, toTzs } from '../lib/fx';
import { ACRE_TO_HA, BATCH_PREFIX, LOAN_LABEL, LOAN_TYPES, type LoanType } from '../lib/kuni';
import { currentSeason } from './seasons.routes';
import { todayStr } from './accounting.routes';
import { toCsv } from './owner/common';

export const kuniRouter = Router();
const KS = schema.kuniSettings;
const KB = schema.kuniBatches;
const KL = schema.kuniLoans;
const M = schema.members;
const E = schema.estimates;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const typeQuery = z.object({ type: z.enum(LOAN_TYPES).default('KUNI') });
const usdText = (v: Decimal.Value) => `$${D(v).toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function season() {
  const s = await currentSeason();
  if (!s) throw badRequest('Hakuna msimu unaoendelea');
  return s;
}

async function settingsOf(amcosId: string, seasonId: string, type: LoanType) {
  const [s] = await db.select().from(KS).where(and(eq(KS.amcosId, amcosId), eq(KS.seasonId, seasonId), eq(KS.loanType, type)));
  return s ?? null;
}
// Mipangilio mipya: kuni kwa trip za makisio, grading kwa kiasi cha makisio (mipangilio ya zamani inabaki kwa ekari)
const DEFAULT_BASIS: Record<LoanType, string> = { KUNI: 'TRIP', GRADING: 'ESTIMATE', TREES: 'ESTIMATE' };
const blank = (t: LoanType) => ({ loanType: t, interestRate: '0', amountPerAcreUsd: null, areaUnit: 'HECTARE', treesPerArea: null, costPerTreeUsd: null, limitBasis: DEFAULT_BASIS[t], pricePerTripUsd: null, isOpen: false, configured: false });
type St = typeof schema.kuniSettings.$inferSelect;

/** Mkopo wa miti: miti anayostahili mkulima = eneo (hekta au ekari, kutoka ekari za makisio) x miti kwa eneo (chini, mti mzima). */
export function treeLimit(st: Pick<St, 'areaUnit' | 'treesPerArea'>, acres: Decimal.Value) {
  const area = st.areaUnit === 'ACRE' ? D(acres) : D(acres).times(ACRE_TO_HA);
  return area.times(st.treesPerArea ?? 0).floor();
}
/** Mipangilio imekamilika? (kuni/grading: dola kwa ekari; miti: idadi ya miti kwa eneo na gharama ya mti) */
const configured = (st: St | null) => !!st && (st.loanType === 'TREES' ? (st.treesPerArea ?? 0) > 0 && D(st.costPerTreeUsd ?? 0).gt(0)
  : st.limitBasis === 'TRIP' ? D(st.pricePerTripUsd ?? 0).gt(0) : st.limitBasis === 'ESTIMATE' ? true : D(st.amountPerAcreUsd ?? 0).gt(0));

/** Makisio ya mkulima yanayohusika na vikomo vya mikopo */
type EstFacts = { acres: Decimal; treeAcres: Decimal; trips: Decimal; gradingUsd: Decimal };
/**
 * Kikomo cha mkulima kwa aina ya mkopo (kutoka makisio yaliyoidhinishwa):
 *  miti = ekari za MITI x miti kwa eneo x gharama ya mti · kuni (TRIP) = trip x bei ya trip
 *  grading (ESTIMATE) = kiasi cha grading cha makisio · (ACRE) = ekari za tumbaku x dola kwa ekari
 */
function limitFor(st: St, f: EstFacts): { usd: Decimal; trees: number | null; why: string } {
  if (st.loanType === 'TREES') {
    const n = treeLimit(st, f.treeAcres).toNumber();
    const area = st.areaUnit === 'ACRE' ? `ekari ${fmt2(f.treeAcres)}` : `hekta ${f.treeAcres.times(ACRE_TO_HA).toFixed(2)}`;
    return { usd: D(st.costPerTreeUsd ?? 0).times(n).toDecimalPlaces(2), trees: n, why: `${area} za miti × miti ${st.treesPerArea} kwa ${areaText(st.areaUnit)}` };
  }
  if (st.limitBasis === 'TRIP') return { usd: f.trips.times(st.pricePerTripUsd ?? 0).toDecimalPlaces(2), trees: null, why: `trip ${f.trips.toFixed()} × ${usdText(st.pricePerTripUsd ?? 0)}` };
  if (st.limitBasis === 'ESTIMATE') return { usd: f.gradingUsd.toDecimalPlaces(2), trees: null, why: `makisio ya grading ${usdText(f.gradingUsd)}` };
  return { usd: f.acres.times(st.amountPerAcreUsd ?? 0).toDecimalPlaces(2), trees: null, why: `ekari ${fmt2(f.acres)} × ${usdText(st.amountPerAcreUsd ?? 0)}` };
}
const estFacts = {
  acres: sql<string>`sum(${schema.estimates.acresPlanted})`, treeAcres: sql<string>`coalesce(sum(${schema.estimates.treeAcres}), 0)`,
  trips: sql<string>`coalesce(sum(${schema.estimates.kuniTrips}), 0)`, gradingUsd: sql<string>`coalesce(sum(${schema.estimates.gradingUsd}), 0)`,
};
const toFacts = (r: { acres: string; treeAcres: string; trips: string; gradingUsd: string }): EstFacts => ({ acres: D(r.acres), treeAcres: D(r.treeAcres), trips: D(r.trips), gradingUsd: D(r.gradingUsd) });
const areaText = (u: string) => (u === 'ACRE' ? 'ekari' : 'hekta');

/** Mipangilio ya aina zote za mikopo kwa msimu huu + kiwango cha dola cha sasa */
kuniRouter.get('/settings', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const s = await season();
  const rows = await db.select().from(KS).where(and(eq(KS.amcosId, amcosId), eq(KS.seasonId, s.id)));
  const rate = await currentRate(db, amcosId);
  const types = Object.fromEntries(LOAN_TYPES.map((t) => [t, rows.find((r) => r.loanType === t) ?? blank(t)]));
  res.json({ season: s, types, labels: LOAN_LABEL, rate: rate ? { usdToTzs: rate.usdToTzs, createdAt: rate.createdAt } : null,
    // (kwa skrini za zamani) mipangilio ya mkopo wa kuni
    settings: types.KUNI });
}));

kuniRouter.put('/settings', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = z.object({
    loanType: z.enum(LOAN_TYPES).default('KUNI'),
    interestRate: decimalSchema({ min: 0 }).refine((v) => Number(v) <= 100, 'Riba haiwezi kuzidi 100%'),
    amountPerAcreUsd: decimalSchema({ min: 0 }).optional(),
    areaUnit: z.enum(['HECTARE', 'ACRE']).optional(),
    treesPerArea: z.coerce.number().int('Idadi ya miti iwe namba nzima').min(1, 'Weka idadi ya miti kwa eneo').max(100000).optional(),
    costPerTreeUsd: decimalSchema({ min: 0.0001 }).optional(),
    limitBasis: z.enum(['ACRE', 'TRIP', 'ESTIMATE']).optional(),
    pricePerTripUsd: decimalSchema({ min: 0.01 }).optional(),
    isOpen: z.boolean(),
  }).superRefine((b, ctx) => {
    if (b.loanType === 'TREES') {
      if (!b.treesPerArea) ctx.addIssue({ code: 'custom', path: ['treesPerArea'], message: 'Weka idadi ya miti kwa hekta (au ekari)' });
      if (!b.costPerTreeUsd) ctx.addIssue({ code: 'custom', path: ['costPerTreeUsd'], message: 'Weka gharama ya mti mmoja (USD)' });
      return;
    }
    const basis = b.limitBasis ?? 'ACRE';
    if (basis === 'TRIP' && b.loanType !== 'KUNI') ctx.addIssue({ code: 'custom', path: ['limitBasis'], message: 'Kikomo kwa trip ni cha mkopo wa kuni tu' });
    if (basis === 'ESTIMATE' && b.loanType !== 'GRADING') ctx.addIssue({ code: 'custom', path: ['limitBasis'], message: 'Kikomo cha makisio ni cha mkopo wa grading tu' });
    if (basis === 'TRIP' && !b.pricePerTripUsd) ctx.addIssue({ code: 'custom', path: ['pricePerTripUsd'], message: 'Weka bei ya trip moja ya kuni (USD)' });
    if (basis === 'ACRE' && b.amountPerAcreUsd === undefined) ctx.addIssue({ code: 'custom', path: ['amountPerAcreUsd'], message: 'Weka kikomo kwa ekari (USD)' });
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season();
  const before = await settingsOf(amcosId, s.id, body.loanType);
  const vals = body.loanType === 'TREES'
    ? { interestRate: body.interestRate, areaUnit: body.areaUnit ?? 'HECTARE', treesPerArea: body.treesPerArea!, costPerTreeUsd: D(body.costPerTreeUsd!).toFixed(4), isOpen: body.isOpen, updatedById: req.auth!.userId }
    : { interestRate: body.interestRate, limitBasis: body.limitBasis ?? 'ACRE', isOpen: body.isOpen, updatedById: req.auth!.userId,
      ...(body.amountPerAcreUsd !== undefined ? { amountPerAcreUsd: fmt2(body.amountPerAcreUsd) } : {}),
      ...(body.pricePerTripUsd !== undefined ? { pricePerTripUsd: fmt2(body.pricePerTripUsd) } : {}) };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(KS).values({ amcosId, seasonId: s.id, loanType: body.loanType, ...vals })
      .onConflictDoUpdate({ target: [KS.amcosId, KS.seasonId, KS.loanType], set: { ...vals, updatedAt: new Date() } }).returning();
    await audit(tx, req, { action: 'KUNI_SETTINGS_UPDATE', entity: 'KuniSettings', entityId: r.id, amcosId, before, after: r });
    return r;
  });
  res.json({ settings: row });
}));

/**
 * Dola ambazo kila mkulima ameshakopa msimu huu kwa aina hii (pamoja na zinazosubiri idhini/malipo).
 * Mikopo ya zamani ya TSh inabadilishwa kwa kiwango cha sasa ili ihesabiwe kwenye kikomo.
 */
async function takenBy(amcosId: string, seasonId: string, type: LoanType, rate: Decimal, memberIds?: string[]) {
  const rows = await db.select({ memberId: KL.memberId, trees: sql<number>`coalesce(sum(${KL.trees}), 0)::int`, usd: sql<string>`coalesce(sum(${KL.amountUsd}), 0)`, legacy: sql<string>`coalesce(sum(case when ${KL.amountUsd} is null then ${KL.amount} else 0 end), 0)` }).from(KL)
    .where(and(eq(KL.amcosId, amcosId), eq(KL.seasonId, seasonId), eq(KL.loanType, type), sql`${KL.status} in ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED')`, memberIds?.length ? inArray(KL.memberId, memberIds) : undefined))
    .groupBy(KL.memberId);
  return new Map(rows.map((r) => [r.memberId, Object.assign(D(r.usd).plus(D(r.legacy).gt(0) ? D(r.legacy).div(rate).toDecimalPlaces(2) : 0), { trees: r.trees })]));
}
const pos = (v: Decimal) => (v.gt(0) ? v : D(0));

/** Wakulima wenye makisio yaliyoidhinishwa msimu huu na kikomo chao (dola) kwa aina ya mkopo. */
kuniRouter.get('/eligible', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { search, type } = typeQuery.extend({ search: z.string().trim().optional() }).parse(req.query);
  const amcosId = await readAmcosId(req);
  const s = await season();
  const st = await settingsOf(amcosId, s.id, type);
  const rate = await currentRate(db, amcosId);
  const like = search ? `%${search}%` : null;
  const rows = await db.select({ m: M, ...estFacts, kg: sql<string>`sum(${E.estimatedKg})`,
    group: sql<string | null>`(select g.name from member_group_members x join member_groups g on g.id = x.group_id where x.member_id = "members"."id" and x.left_at is null and g.status = 'ACTIVE' limit 1)`,
    balance: sql<string>`(select coalesce(sum(l.credit) - sum(l.debit), 0) from member_ledger_entries l where l.member_id = "members"."id")`,
    usdDebt: sql<string>`(select coalesce(sum(u.usd), 0) from member_usd_ledger u where u.member_id = "members"."id")` })
    .from(E).innerJoin(M, eq(M.id, E.memberId))
    .where(and(eq(E.amcosId, amcosId), eq(E.seasonId, s.id), eq(E.status, 'APPROVED'), eq(M.status, 'ACTIVE'),
      like ? sql`(${M.firstName} ilike ${like} or ${M.lastName} ilike ${like} or ${M.memberNo} ilike ${like})` : undefined))
    .groupBy(M.id).orderBy(asc(M.memberNo));
  const taken = rate ? await takenBy(amcosId, s.id, type, D(rate.usdToTzs)) : new Map<string, Decimal & { trees: number }>();
  res.json({
    settings: st, season: s, type, rate: rate?.usdToTzs ?? null,
    data: rows.map((r) => {
      const d = destinationOf(r.m);
      const t = taken.get(r.m.id) ?? Object.assign(D(0), { trees: 0 });
      // Miti: kikomo ni idadi ya miti; dola = miti x gharama ya mti
      const f = toFacts(r);
      const lim = st ? limitFor(st, f) : { usd: D(0), trees: null, why: '' };
      const trees = type === 'TREES' && st ? (() => {
        const n = lim.trees ?? 0;
        const avail = Math.max(n - t.trees, 0);
        return { limitTrees: n, takenTrees: t.trees, availableTrees: avail, hectares: f.treeAcres.times(ACRE_TO_HA).toFixed(2), availUsd: D(st.costPerTreeUsd ?? 0).times(avail).toDecimalPlaces(2) };
      })() : null;
      const limit = lim.usd;
      return { memberId: r.m.id, memberNo: r.m.memberNo, name: `${r.m.firstName} ${r.m.lastName}`, village: r.m.village, group: r.group,
        acres: fmt2(r.acres), treeAcres: fmt2(f.treeAcres), kuniTrips: f.trips.toFixed(), gradingUsd: fmt2(f.gradingUsd), basis: lim.why,
        estimatedKg: fmt2(r.kg), limit: fmt2(limit), taken: fmt2(t), available: fmt2(trees ? trees.availUsd : pos(limit.minus(t))),
        ...(trees ? { hectares: trees.hectares, limitTrees: trees.limitTrees, takenTrees: trees.takenTrees, availableTrees: trees.availableTrees } : {}),
        debt: fmt2(D(r.balance).lt(0) ? D(r.balance).neg() : 0), debtUsd: fmt2(pos(D(r.usdDebt))), method: d.method, destination: d.destination };
    }),
  });
}));

/** Mhasibu anaandaa orodha ya mkopo (kwa dola) -> Meneja anaidhinisha. */
kuniRouter.post('/batches', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const body = z.object({
    loanType: z.enum(LOAN_TYPES).default('KUNI'),
    loans: z.array(z.object({ memberId: z.string().uuid(), amountUsd: decimalSchema({ min: 0.01 }).optional(), trees: z.coerce.number().int('Idadi ya miti iwe namba nzima').min(1).optional() })).min(1, 'Chagua angalau mkulima mmoja').max(2000),
    notes: z.string().trim().nullable().optional(),
  }).parse(req.body);
  const label = LOAN_LABEL[body.loanType];
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season();
  const st = await settingsOf(amcosId, s.id, body.loanType);
  const isTrees = body.loanType === 'TREES';
  if (!st || !st.isOpen) throw badRequest(`${label} haujafunguliwa msimu huu — weka mipangilio kwanza`);
  if (!configured(st)) throw badRequest(isTrees ? 'Weka idadi ya miti kwa eneo na gharama ya mti mmoja kwenye mipangilio' : st.limitBasis === 'TRIP' ? 'Weka bei ya trip moja ya kuni kwenye mipangilio' : `Weka kikomo cha ${label.toLowerCase()} kwa dola kwa ekari kwenye mipangilio`);
  const rate = await requireRate(db, amcosId);
  const ids = body.loans.map((l) => l.memberId);
  if (new Set(ids).size !== ids.length) throw badRequest('Mkulima amerudiwa kwenye orodha');
  const mems = await db.select().from(M).where(and(eq(M.amcosId, amcosId), inArray(M.id, ids)));
  if (mems.length !== ids.length) throw badRequest('Baadhi ya wakulima si wa chama hiki');
  const facts = await db.select({ memberId: E.memberId, ...estFacts }).from(E)
    .where(and(eq(E.seasonId, s.id), eq(E.status, 'APPROVED'), inArray(E.memberId, ids))).groupBy(E.memberId);
  const factsOf = new Map(facts.map((a) => [a.memberId, toFacts(a)]));
  const taken = await takenBy(amcosId, s.id, body.loanType, rate, ids);
  const byId = new Map(mems.map((m) => [m.id, m]));
  const pct = D(st.interestRate);
  const rows = body.loans.map((l) => {
    const m = byId.get(l.memberId)!;
    if (m.status !== 'ACTIVE') throw badRequest(`${m.memberNo}: mkulima hayuko hai`);
    const f = factsOf.get(m.id);
    if (!f || f.acres.lte(0)) throw badRequest(`${m.firstName} ${m.lastName} (${m.memberNo}) hana makisio yaliyoidhinishwa msimu huu`);
    const lim = limitFor(st, f);
    const who = `${m.firstName} ${m.lastName} (${m.memberNo})`;
    let usd: Decimal;
    let trees: number | null = null;
    if (isTrees) {
      if (!l.trees) throw badRequest(`${m.firstName} ${m.lastName} (${m.memberNo}): weka idadi ya miti`);
      if (f.treeAcres.lte(0)) throw badRequest(`${who}: makisio yake hayana ekari za miti`);
      const left = (lim.trees ?? 0) - (taken.get(m.id)?.trees ?? 0);
      if (l.trees > left) throw badRequest(`${who}: miti iliyobaki ni ${Math.max(left, 0)} (${lim.why})`);
      trees = l.trees;
      usd = D(st.costPerTreeUsd!).times(trees).toDecimalPlaces(2);
    } else {
      if (!l.amountUsd) throw badRequest(`${m.firstName} ${m.lastName} (${m.memberNo}): weka kiasi`);
      const available = lim.usd.minus(taken.get(m.id) ?? 0);
      usd = D(l.amountUsd).toDecimalPlaces(2);
      if (usd.gt(available)) throw badRequest(`${who}: kikomo kilichobaki ni ${usdText(pos(available))} (${lim.why})`);
    }
    const interestUsd = usd.times(pct).div(100).toDecimalPlaces(2);
    return { m, trees, amountUsd: fmt2(usd), interestUsd: fmt2(interestUsd), amount: fmt2(toTzs(usd, rate)), interest: fmt2(toTzs(interestUsd, rate)), ...destinationOf(m) };
  });
  const sum = (k: 'amount' | 'interest' | 'amountUsd' | 'interestUsd') => rows.reduce((t, r) => t.plus(r[k]), D(0));
  const [total, interest, totalUsd, interestUsd] = [sum('amount'), sum('interest'), sum('amountUsd'), sum('interestUsd')];
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const out = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, amcosId, 'kuni_batch');
    const prefix = BATCH_PREFIX[body.loanType];
    const totalTrees = isTrees ? rows.reduce((t, r) => t + (r.trees ?? 0), 0) : null;
    const [b] = await tx.insert(KB).values({ amcosId, seasonId: s.id, loanType: body.loanType, batchNo: `${amcos.code}-${prefix}-${pad(n, 4)}`, interestRate: st.interestRate,
      totalAmount: fmt2(total), totalInterest: fmt2(interest), currency: 'USD', fxRate: rate.toFixed(4), totalUsd: fmt2(totalUsd), totalInterestUsd: fmt2(interestUsd), totalTrees, notes: body.notes ?? null, createdById: req.auth!.userId }).returning();
    await tx.insert(KL).values(rows.map((r) => ({ amcosId, batchId: b.id, seasonId: s.id, memberId: r.m.id, loanType: body.loanType, trees: r.trees, amount: r.amount, interest: r.interest, amountUsd: r.amountUsd, interestUsd: r.interestUsd, method: r.method, provider: r.provider, destination: r.destination })));
    const approval = await createApproval(tx, req, {
      amcosId, type: 'KUNI_BATCH', entityType: 'KuniBatch', entityId: b.id, amount: fmt2(total),
      title: `${label} ${b.batchNo}: wakulima ${rows.length}${totalTrees ? `, miti ${totalTrees.toLocaleString('en-US')}` : ''}, ${usdText(totalUsd)} (${tshText(total)}) · riba ${fmt2(pct)}%: ${usdText(interestUsd)}`,
      reason: body.notes ?? `${isTrees ? `Miti ${st.treesPerArea} kwa ${areaText(st.areaUnit)} ya miti × $${D(st.costPerTreeUsd!).toFixed()} kwa mti` : st.limitBasis === 'TRIP' ? `Kikomo: trip za kuni za makisio × ${usdText(st.pricePerTripUsd!)}` : st.limitBasis === 'ESTIMATE' ? 'Kikomo: grading ya makisio' : `Kikomo: ${usdText(st.amountPerAcreUsd!)} kwa ekari`} · 1 USD = TSh ${rate.toFixed()}`,
      payload: { loanType: body.loanType, totalTrees, limitBasis: st.limitBasis, pricePerTripUsd: st.pricePerTripUsd, treesPerArea: st.treesPerArea, areaUnit: st.areaUnit, costPerTreeUsd: st.costPerTreeUsd, farmers: rows.length, totalUsd: fmt2(totalUsd), interestUsd: fmt2(interestUsd), total: fmt2(total), interest: fmt2(interest), rate: st.interestRate, fxRate: rate.toFixed(), amountPerAcreUsd: st.amountPerAcreUsd },
    });
    const [upd] = await tx.update(KB).set({ approvalId: approval.id }).where(eq(KB.id, b.id)).returning();
    await audit(tx, req, { action: 'KUNI_BATCH_PREPARE', entity: 'KuniBatch', entityId: b.id, amcosId, after: { ...upd, farmers: rows.length } });
    return { batch: upd, approval };
  });
  res.status(201).json(out);
}));

kuniRouter.get('/batches', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { type } = z.object({ type: z.enum(LOAN_TYPES).optional() }).parse(req.query);
  const rows = await db.select({ b: KB, farmers: sql<number>`(select count(*)::int from kuni_loans l where l.batch_id = "kuni_batches"."id")`,
    paid: sql<string>`(select coalesce(sum(l.amount), 0) from kuni_loans l where l.batch_id = "kuni_batches"."id" and l.status = 'SUCCESS')`,
    paidUsd: sql<string>`(select coalesce(sum(l.amount_usd), 0) from kuni_loans l where l.batch_id = "kuni_batches"."id" and l.status = 'SUCCESS')` })
    .from(KB).where(and(amcosScope(req, KB.amcosId), type ? eq(KB.loanType, type) : undefined)).orderBy(desc(KB.createdAt));
  res.json({ data: rows.map((r) => ({ ...r.b, label: LOAN_LABEL[r.b.loanType], farmers: r.farmers, paid: fmt2(r.paid), paidUsd: fmt2(r.paidUsd) })) });
}));

async function findBatch(req: Request, id: string) {
  const [b] = await db.select().from(KB).where(and(eq(KB.id, id), amcosScope(req, KB.amcosId)));
  if (!b) throw notFound('Orodha ya mkopo');
  return b;
}
const loanRows = (batchId: string) => db.select({ l: KL, memberNo: M.memberNo, name: sql<string>`${M.firstName} || ' ' || ${M.lastName}`,
  txnNo: sql<string | null>`(select t.txn_no from finance_transactions t where t.id = "kuni_loans"."finance_txn_id")` })
  .from(KL).innerJoin(M, eq(M.id, KL.memberId)).where(eq(KL.batchId, batchId)).orderBy(asc(KL.method), asc(M.memberNo));

kuniRouter.get('/batches/:id', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await loanRows(id);
  const approval = b.approvalId ? await db.select({ a: schema.approvalRequests, by: sql<string | null>`(select u.full_name from users u where u.id = "approval_requests"."decided_by_id")` })
    .from(schema.approvalRequests).where(eq(schema.approvalRequests.id, b.approvalId)) : [];
  const sum = (k: string) => fmt2(rows.filter((r) => r.l.method === k).reduce((t, r) => t.plus(r.l.amount), D(0)));
  const ok = rows.filter((r) => r.l.status === 'SUCCESS');
  res.json({
    batch: { ...b, label: LOAN_LABEL[b.loanType] }, approval: approval[0] ? { ...approval[0].a, decidedBy: approval[0].by } : null,
    loans: rows.map((r) => ({ ...r.l, memberNo: r.memberNo, memberName: r.name, txnNo: r.txnNo })),
    summary: { MOBILE_MONEY: sum('MOBILE_MONEY'), BANK: sum('BANK'), CASH: sum('CASH'),
      paid: fmt2(ok.reduce((t, r) => t.plus(r.l.amount), D(0))), paidUsd: fmt2(ok.reduce((t, r) => t.plus(r.l.amountUsd ?? 0), D(0))), pending: rows.filter((r) => r.l.status === 'PENDING' || r.l.status === 'FAILED').length },
  });
}));

kuniRouter.get('/batches/:id/csv', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await loanRows(id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${({ KUNI: 'mkopo-wa-kuni', GRADING: 'mkopo-wa-grading', TREES: 'mkopo-wa-miti' } as const)[b.loanType]}-${b.batchNo}.csv"`);
  res.send(toCsv([['Namba ya mkulima', 'Jina', 'Njia', 'Mtoa huduma', 'Namba ya simu / akaunti', 'Kiasi (TSh)', 'Kiasi (USD)', ...(b.loanType === 'TREES' ? ['Miti'] : []), 'Hali'],
    ...rows.map((r) => [r.memberNo, r.name, r.l.method, r.l.provider, r.l.destination, r.l.amount, r.l.amountUsd ?? '', ...(b.loanType === 'TREES' ? [r.l.trees ?? ''] : []), r.l.status])]));
}));

/** Mhasibu anathibitisha pesa zilizotumwa KWELI. Mkopo + riba vinaingia kwenye deni la mkulima na daftari kuu. */
kuniRouter.post('/batches/:id/confirm', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    accountId: z.string().uuid(), loanIds: z.array(z.string().uuid()).min(1, 'Chagua waliotumiwa pesa').max(2000),
    reference: z.string().trim().min(2, 'Weka kumbukumbu ya malipo (mf. namba ya bulk payment)'), txnDate: dateStr.optional(),
  }).parse(req.body);
  const b = await findBatch(req, id);
  if (!['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status)) throw badRequest(b.status === 'DRAFT' ? 'Orodha hii bado inasubiri idhini ya Meneja' : 'Orodha hii haipokei malipo tena');
  const date = body.txnDate ?? todayStr();
  await assertOpen(db, b.amcosId, date);
  const [acc] = await db.select().from(schema.financeAccounts).where(and(eq(schema.financeAccounts.id, body.accountId), eq(schema.financeAccounts.amcosId, b.amcosId)));
  if (!acc || !acc.isActive) throw badRequest('Akaunti ya fedha si sahihi');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId) }))!;
  const label = LOAN_LABEL[b.loanType];
  const usdBatch = b.currency === 'USD';
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from kuni_batches where id = ${id} for update`);
    const loans = await tx.select().from(KL).where(and(eq(KL.batchId, id), inArray(KL.id, body.loanIds)));
    if (loans.length !== new Set(body.loanIds).size) throw badRequest('Baadhi ya mikopo haiko kwenye orodha hii');
    if (loans.some((l) => l.status !== 'PENDING' && l.status !== 'FAILED')) throw badRequest('Baadhi ya mikopo tayari imethibitishwa au imesitishwa');
    const total = loans.reduce((t, l) => t.plus(l.amount), D(0));
    await lockAccount(tx, acc.id);
    const bal = await accountBalance(tx, acc.id);
    if (bal.lessThan(total)) throw badRequest(`Salio la ${acc.name} halitoshi: linahitajika ${tshText(total)}, lipo TSh ${fmt2(bal)}`);
    for (const l of loans) {
      const m = (await tx.query.members.findFirst({ where: eq(M.id, l.memberId) }))!;
      const [t] = await tx.insert(schema.financeTransactions).values({
        amcosId: b.amcosId, seasonId: b.seasonId, txnNo: await nextTxnNo(tx, b.amcosId, amcos.code), kind: 'FARMER_PAYMENT', direction: 'OUT', category: 'CASH_LOAN',
        accountId: acc.id, amount: l.amount, txnDate: date, description: `${label} (${b.batchNo})`, reference: body.reference,
        ...(usdBatch ? { amountUsd: l.amountUsd, fxRate: b.fxRate } : {}),
        payee: `${m.firstName} ${m.lastName} (${m.memberNo})`, memberId: m.id, status: 'POSTED', approvalId: b.approvalId,
        createdById: req.auth!.userId, postedById: req.auth!.userId, postedAt: new Date(),
      }).returning();
      await ledger.post(tx, { amcosId: b.amcosId, memberId: m.id, seasonId: b.seasonId, type: 'CASH_LOAN', debit: l.amount,
        description: `${label} ${t.txnNo}${usdBatch ? ` ($${fmt2(l.amountUsd!)}${l.trees ? `, miti ${l.trees}` : ''})` : ''}`, referenceType: 'FINANCE_TXN', referenceId: t.id, createdById: req.auth!.userId });
      if (D(l.interest).gt(0)) {
        await ledger.post(tx, { amcosId: b.amcosId, memberId: m.id, seasonId: b.seasonId, type: 'LOAN_INTEREST', debit: l.interest,
          description: `Riba ya ${label.toLowerCase()} ${fmt2(b.interestRate)}% (${t.txnNo})`, referenceType: 'KUNI_LOAN', referenceId: l.id, createdById: req.auth!.userId });
        await postJournal(tx, { amcosId: b.amcosId, date, description: `Riba ya ${label.toLowerCase()} ${m.memberNo} (${t.txnNo})`, source: 'KUNI_INTEREST', sourceId: l.id, reference: b.batchNo,
          approvalId: b.approvalId, createdById: req.auth!.userId, lines: [{ code: '1200', debit: l.interest, memberId: m.id }, { code: '4450', credit: l.interest }] });
      }
      // Deni la dola: mkopo + riba vinaongezwa kwenye deni la dola la mkulima (pamoja na pembejeo)
      if (usdBatch && l.amountUsd) {
        await recordUsd(tx, { amcosId: b.amcosId, memberId: m.id, seasonId: b.seasonId, kind: 'ISSUE', usd: D(l.amountUsd).plus(l.interestUsd ?? 0), tzs: D(l.amount).plus(l.interest), rate: b.fxRate,
          description: `${label} ${t.txnNo}`, referenceType: 'KUNI_LOAN', referenceId: l.id, createdById: req.auth!.userId });
      }
      await tx.update(KL).set({ status: 'SUCCESS', providerRef: body.reference, paidAt: new Date(), financeTxnId: t.id, failureReason: null }).where(eq(KL.id, l.id));
    }
    const all = await tx.select({ status: KL.status }).from(KL).where(eq(KL.batchId, id));
    const status = all.every((x) => x.status === 'SUCCESS' || x.status === 'CANCELLED') ? 'COMPLETED' : all.some((x) => x.status === 'FAILED') ? 'PARTIAL' : 'PROCESSING';
    await tx.update(KB).set({ status }).where(eq(KB.id, id));
    await audit(tx, req, { action: 'KUNI_PAYMENTS_CONFIRMED', entity: 'KuniBatch', entityId: id, amcosId: b.amcosId, after: { count: loans.length, total: fmt2(total), reference: body.reference, account: acc.name } });
    return { confirmed: loans.length, total: fmt2(total), status };
  });
  res.json(result);
}));

kuniRouter.post('/batches/:id/fail', requireAmcosPerm('finance.record'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ loanIds: z.array(z.string().uuid()).min(1), reason: z.string().trim().min(3, 'Eleza sababu') }).parse(req.body);
  const b = await findBatch(req, id);
  const rows = await db.transaction(async (tx) => {
    const r = await tx.update(KL).set({ status: 'FAILED', failureReason: body.reason }).where(and(eq(KL.batchId, b.id), inArray(KL.id, body.loanIds), eq(KL.status, 'PENDING'))).returning();
    if (r.length) await tx.update(KB).set({ status: 'PARTIAL' }).where(eq(KB.id, b.id));
    await audit(tx, req, { action: 'KUNI_PAYMENTS_FAILED', entity: 'KuniBatch', entityId: b.id, amcosId: b.amcosId, after: { count: r.length, reason: body.reason } });
    return r;
  });
  res.json({ failed: rows.length });
}));

/**
 * Madeni ya dola yamejumlishwa: kwa kila mkulima (pembejeo + kuni + grading, alicholipa, deni lililobaki)
 * na kwa kila kikundi (jumla ya wanachama wake walio hai kwenye kikundi). Deni la TSh kwenye vitabu linaonyeshwa pia.
 */
kuniRouter.get('/debts', requireAmcosPerm('finance.read'), ah(async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(60).optional() }).parse(req.query);
  const amcosId = await readAmcosId(req);
  const rate = await currentRate(db, amcosId);
  const like = search ? `%${search}%` : null;
  const rows = (await db.execute<{ member_id: string; member_no: string; name: string; village: string | null; group_id: string | null; group_name: string | null;
    inputs: string; kuni: string; grading: string; trees: string; repaid: string; debt: string; book: string }>(sql`
    with u as (
      select u.member_id,
        sum(case when u.reference_type = 'INPUT_ISSUE' and u.kind in ('ISSUE', 'CANCEL') then u.usd else 0 end) as inputs,
        sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'KUNI' then u.usd else 0 end) as kuni,
        sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'GRADING' then u.usd else 0 end) as grading,
        sum(case when u.reference_type = 'KUNI_LOAN' and u.kind in ('ISSUE', 'CANCEL') and kl.loan_type = 'TREES' then u.usd else 0 end) as trees,
        -sum(case when u.kind = 'REPAY' then u.usd else 0 end) as repaid,
        sum(u.usd) as debt
      from member_usd_ledger u left join kuni_loans kl on u.reference_type = 'KUNI_LOAN' and kl.id = u.reference_id
      where u.amcos_id = ${amcosId} group by u.member_id
    ), b as (
      select l.member_id, sum(l.debit) - sum(l.credit) as book from member_ledger_entries l where l.amcos_id = ${amcosId} group by l.member_id
    )
    select m.id as member_id, m.member_no, m.first_name || ' ' || m.last_name as name, m.village,
      g.id as group_id, g.name as group_name,
      coalesce(u.inputs, 0)::numeric(14,2)::text as inputs, coalesce(u.kuni, 0)::numeric(14,2)::text as kuni, coalesce(u.grading, 0)::numeric(14,2)::text as grading, coalesce(u.trees, 0)::numeric(14,2)::text as trees,
      coalesce(u.repaid, 0)::numeric(14,2)::text as repaid, greatest(coalesce(u.debt, 0), 0)::numeric(14,2)::text as debt, greatest(coalesce(b.book, 0), 0)::numeric(18,2)::text as book
    from members m
    left join u on u.member_id = m.id
    left join b on b.member_id = m.id
    left join lateral (select gg.id, gg.name from member_group_members x join member_groups gg on gg.id = x.group_id
      where x.member_id = m.id and x.left_at is null and gg.status = 'ACTIVE' limit 1) g on true
    where m.amcos_id = ${amcosId} and (u.member_id is not null or coalesce(b.book, 0) > 0)
      ${like ? sql`and (m.first_name ilike ${like} or m.last_name ilike ${like} or m.member_no ilike ${like} or g.name ilike ${like})` : sql``}
    order by coalesce(u.debt, 0) desc, m.member_no
    limit 2000`)).rows;
  const r = rate ? D(rate.usdToTzs) : null;
  const farmers = rows.map((x) => ({ memberId: x.member_id, memberNo: x.member_no, name: x.name, village: x.village, groupId: x.group_id, group: x.group_name,
    inputsUsd: x.inputs, kuniUsd: x.kuni, gradingUsd: x.grading, treesUsd: x.trees, repaidUsd: x.repaid, debtUsd: x.debt, bookTzs: x.book,
    atCurrentTzs: r && D(x.debt).gt(0) ? fmt2(toTzs(x.debt, r)) : null }));
  const keys = ['inputsUsd', 'kuniUsd', 'gradingUsd', 'treesUsd', 'repaidUsd', 'debtUsd', 'bookTzs'] as const;
  const add = (acc: Record<string, Decimal>, f: (typeof farmers)[number]) => { for (const k of keys) acc[k] = (acc[k] ?? D(0)).plus(f[k]); return acc; };
  const out = (acc: Record<string, Decimal>) => Object.fromEntries(keys.map((k) => [k, fmt2(acc[k] ?? 0)])) as Record<(typeof keys)[number], string>;
  const byGroup = new Map<string, { id: string; name: string; members: number; owing: number; acc: Record<string, Decimal> }>();
  for (const f of farmers) {
    if (!f.groupId) continue;
    const g = byGroup.get(f.groupId) ?? { id: f.groupId, name: f.group!, members: 0, owing: 0, acc: {} };
    g.members += 1; if (D(f.debtUsd).gt(0) || D(f.bookTzs).gt(0)) g.owing += 1;
    add(g.acc, f); byGroup.set(f.groupId, g);
  }
  const groups = [...byGroup.values()].map((g) => ({ id: g.id, name: g.name, members: g.members, owing: g.owing, ...out(g.acc),
    atCurrentTzs: r && (g.acc.debtUsd ?? D(0)).gt(0) ? fmt2(toTzs(g.acc.debtUsd, r)) : null })).sort((a, b) => Number(b.debtUsd) - Number(a.debtUsd));
  const totals = farmers.reduce(add, {} as Record<string, Decimal>);
  res.json({ rate: rate ? { usdToTzs: rate.usdToTzs, createdAt: rate.createdAt } : null, farmers, groups,
    totals: { ...out(totals), farmers: farmers.length, atCurrentTzs: r && (totals.debtUsd ?? D(0)).gt(0) ? fmt2(toTzs(totals.debtUsd, r)) : null } });
}));
