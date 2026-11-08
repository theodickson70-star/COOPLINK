// =====================================================================
//  MAUZO YA TUMBAKU NA MAKATO (Mhasibu)
//   1. Kanuni za makato za msimu (ushuru wa halmashauri, wa chama kikuu, wa chama, deni la pembejeo ...)
//   2. Soko: mabelo ya kila mkulima (kilo, daraja, bei USD) + kiwango cha kubadilisha fedha
//   3. Hesabu ya malipo ya kila mkulima (settlement) -> idhini ya Meneja -> ledger + daftari kuu
//   4. Orodha ya malipo (payment sheet) -> idhini -> Mhasibu anathibitisha kila malipo yaliyofanyika kweli
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import * as ledger from '../lib/ledger';
import { createApproval } from '../lib/approvals';
import { accountBalance, lockAccount, nextTxnNo } from '../lib/finance';
import { computeSettlement, memberDebts, ruleGlCode } from '../lib/tobacco';
import { currentSeason } from './seasons.routes';
import { todayStr } from './accounting.routes';
import { toCsv } from './owner/common';

export const salesRouter = Router();
const MK = schema.markets;
const BL = schema.bales;
const DR = schema.deductionRules;
const S = schema.settlements;
const SL = schema.settlementLines;
const PB = schema.paymentBatches;
const PY = schema.payments;
const M = schema.members;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');

async function season(seasonId?: string) {
  const s = seasonId ? await db.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) }) : await currentSeason();
  if (!s) throw badRequest('Hakuna msimu unaoendelea — Owner aweke msimu kwanza');
  return s;
}

// ------------------------------ KANUNI ZA MAKATO ------------------------------
export const BASIS_LABEL: Record<string, string> = {
  PERCENT_OF_GROSS: '% ya mauzo', PER_KG: 'Kwa kila kilo', FIXED: 'Kiasi maalum kwa mkulima', OUTSTANDING_LOAN: 'Deni la pembejeo/mkopo',
};

salesRouter.get('/deduction-rules', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
  const s = await season(seasonId);
  const rows = await db.select().from(DR).where(and(amcosScope(req, DR.amcosId), eq(DR.seasonId, s.id))).orderBy(asc(DR.priority), asc(DR.code));
  res.json({ season: s, data: rows.map((r) => ({ ...r, basisLabel: BASIS_LABEL[r.basis], glCode: ruleGlCode(r) })) });
}));

const ruleBody = z.object({
  name: z.string().trim().min(3),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, 'Code iwe herufi kubwa/namba (mf. LGA_CESS)'),
  basis: z.enum(schema.deductionBasisEnum.enumValues),
  rate: decimalSchema({ min: 0 }),
  currency: z.enum(['TZS', 'USD']).default('TZS'),
  priority: z.coerce.number().int().min(1).max(999).default(100),
  glAccountCode: z.string().trim().regex(/^\d{4,6}$/).nullable().optional(),
});

async function checkRuleGl(amcosId: string, code: string | null | undefined) {
  if (!code) return;
  const [g] = await db.select().from(schema.glAccounts).where(and(eq(schema.glAccounts.amcosId, amcosId), eq(schema.glAccounts.code, code)));
  if (!g || !['LIABILITY', 'INCOME', 'ASSET'].includes(g.type) || g.subtype === 'CASH') throw badRequest('Akaunti ya makato iwe ya madeni, mapato au wadaiwa (mf. 2310, 4100, 1200)');
}

salesRouter.post('/deduction-rules', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const body = ruleBody.extend({ seasonId: z.string().uuid().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season(body.seasonId);
  await checkRuleGl(amcosId, body.glAccountCode);
  if (body.basis === 'PERCENT_OF_GROSS' && D(body.rate).gt(100)) throw badRequest('Asilimia haiwezi kuzidi 100');
  const [dup] = await db.select({ id: DR.id }).from(DR).where(and(eq(DR.amcosId, amcosId), eq(DR.seasonId, s.id), eq(DR.code, body.code)));
  if (dup) throw conflict('Code hii ya makato tayari ipo msimu huu');
  const rule = await db.transaction(async (tx) => {
    const [r] = await tx.insert(DR).values({ ...body, amcosId, seasonId: s.id, glAccountCode: body.glAccountCode ?? null }).returning();
    await audit(tx, req, { action: 'DEDUCTION_RULE_CREATE', entity: 'DeductionRule', entityId: r.id, amcosId, after: r });
    return r;
  });
  res.status(201).json({ rule });
}));

salesRouter.patch('/deduction-rules/:id', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = ruleBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const [before] = await db.select().from(DR).where(and(eq(DR.id, id), eq(DR.amcosId, amcosId)));
  if (!before) throw notFound('Kanuni ya makato');
  await checkRuleGl(amcosId, body.glAccountCode);
  const rule = await db.transaction(async (tx) => {
    const [r] = await tx.update(DR).set(body).where(eq(DR.id, id)).returning();
    await audit(tx, req, { action: 'DEDUCTION_RULE_UPDATE', entity: 'DeductionRule', entityId: id, amcosId, before, after: r });
    return r;
  });
  res.json({ rule });
}));

// ------------------------------ MASOKO ------------------------------
const marketStats = {
  bales: sql<number>`(select count(*)::int from bales b where b.market_id = "markets"."id" and b.status = 'SOLD')`,
  rejected: sql<number>`(select count(*)::int from bales b where b.market_id = "markets"."id" and b.status = 'REJECTED')`,
  farmers: sql<number>`(select count(distinct b.member_id)::int from bales b where b.market_id = "markets"."id" and b.status = 'SOLD')`,
  kg: sql<string>`(select coalesce(sum(coalesce(b.net_kg, b.gross_kg)), 0) from bales b where b.market_id = "markets"."id" and b.status = 'SOLD')`,
  usd: sql<string>`(select coalesce(sum(b.value_usd), 0) from bales b where b.market_id = "markets"."id" and b.status = 'SOLD')`,
  settlement: sql<string | null>`(select s.status::text from settlements s where s.market_id = "markets"."id" and s.status <> 'CANCELLED' order by s.created_at desc limit 1)`,
  grossTzs: sql<string>`(select coalesce(sum(s.gross_tzs), 0) from settlements s where s.market_id = "markets"."id" and s.status <> 'CANCELLED')`,
  netTzs: sql<string>`(select coalesce(sum(s.net_tzs), 0) from settlements s where s.market_id = "markets"."id" and s.status <> 'CANCELLED')`,
  paid: sql<string>`(select coalesce(sum(p.amount), 0) from payments p join settlements s on s.id = p.settlement_id where s.market_id = "markets"."id" and p.status = 'SUCCESS')`,
};

salesRouter.get('/markets', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
  const s = await season(seasonId);
  const rows = await db.select({ market: MK, ...marketStats }).from(MK).where(and(amcosScope(req, MK.amcosId), eq(MK.seasonId, s.id))).orderBy(desc(MK.marketDate), desc(MK.createdAt));
  const data = rows.map(({ market, ...st }) => ({ ...market, ...st, kg: fmt2(st.kg), usd: fmt2(st.usd), grossTzs: fmt2(st.grossTzs), netTzs: fmt2(st.netTzs), paid: fmt2(st.paid) }));
  const sum = (k: 'kg' | 'usd' | 'grossTzs' | 'netTzs' | 'paid') => fmt2(data.reduce((t, r) => t.plus(r[k]), D(0)));
  res.json({ season: s, data, totals: { markets: data.length, bales: data.reduce((t, r) => t + r.bales, 0), kg: sum('kg'), usd: sum('usd'), grossTzs: sum('grossTzs'), netTzs: sum('netTzs'), paid: sum('paid') } });
}));

const marketBody = z.object({
  marketDate: dateStr,
  location: z.string().trim().nullable().optional(),
  buyerName: z.string().trim().min(2, 'Weka jina la kampuni ya ununuzi'),
  exchangeRate: decimalSchema({ min: 1 }),
  notes: z.string().trim().nullable().optional(),
});

salesRouter.post('/markets', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const body = marketBody.extend({ seasonId: z.string().uuid().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const s = await season(body.seasonId);
  if (s.status === 'CLOSED') throw badRequest('Msimu umefungwa');
  const market = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, amcosId, 'market');
    const [m] = await tx.insert(MK).values({ ...body, amcosId, seasonId: s.id, marketNo: `SOKO-${pad(n, 3)}`, status: 'OPEN', createdById: req.auth!.userId }).returning();
    await audit(tx, req, { action: 'MARKET_CREATE', entity: 'Market', entityId: m.id, amcosId, after: m });
    return m;
  });
  res.status(201).json({ market });
}));

async function findMarket(req: Request, id: string) {
  const [m] = await db.select().from(MK).where(and(eq(MK.id, id), amcosScope(req, MK.amcosId)));
  if (!m) throw notFound('Soko');
  return m;
}

/** Soko linaweza kuhaririwa mpaka hesabu za wakulima ziwasilishwe kwa idhini. */
async function assertEditable(tx: Tx | typeof db, m: typeof MK.$inferSelect) {
  if (m.status !== 'OPEN') throw badRequest('Soko hili limefungwa');
  const [s] = await tx.select({ id: S.id }).from(S).where(and(eq(S.marketId, m.id), ne(S.status, 'CANCELLED'))).limit(1);
  if (s) throw badRequest('Hesabu za wakulima zimeshawasilishwa — soko haliwezi kubadilishwa');
}

salesRouter.patch('/markets/:id', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = marketBody.partial().parse(req.body);
  const m = await findMarket(req, id);
  await assertEditable(db, m);
  const market = await db.transaction(async (tx) => {
    const [r] = await tx.update(MK).set(body).where(eq(MK.id, id)).returning();
    await audit(tx, req, { action: 'MARKET_UPDATE', entity: 'Market', entityId: id, amcosId: m.amcosId, before: m, after: r });
    return r;
  });
  res.json({ market });
}));

salesRouter.get('/markets/:id', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const m = await findMarket(req, id);
  const [stats] = await db.select(marketStats).from(MK).where(eq(MK.id, id));
  const bales = await db.select({ bale: BL, memberNo: M.memberNo, name: sql<string>`${M.firstName} || ' ' || ${M.lastName}` })
    .from(BL).innerJoin(M, eq(M.id, BL.memberId)).where(eq(BL.marketId, id)).orderBy(asc(M.memberNo), asc(BL.baleNo));
  const settlements = await db.select({ s: S, memberNo: M.memberNo, name: sql<string>`${M.firstName} || ' ' || ${M.lastName}`,
    paid: sql<string>`(select coalesce(sum(p.amount), 0) from payments p where p.settlement_id = "settlements"."id" and p.status = 'SUCCESS')` })
    .from(S).innerJoin(M, eq(M.id, S.memberId)).where(and(eq(S.marketId, id), ne(S.status, 'CANCELLED'))).orderBy(asc(M.memberNo));
  const lines = settlements.length ? await db.select().from(SL).where(inArray(SL.settlementId, settlements.map((x) => x.s.id))) : [];
  const batches = await db.select({ b: PB, payments: sql<number>`(select count(*)::int from payments p where p.batch_id = "payment_batches"."id")`,
    paid: sql<string>`(select coalesce(sum(p.amount), 0) from payments p where p.batch_id = "payment_batches"."id" and p.status = 'SUCCESS')` })
    .from(PB).where(eq(PB.marketId, id)).orderBy(desc(PB.createdAt));
  const approval = m.approvalId ? await db.query.approvalRequests.findFirst({ where: eq(schema.approvalRequests.id, m.approvalId) }) : null;
  res.json({
    market: { ...m, ...stats, kg: fmt2(stats.kg), usd: fmt2(stats.usd) },
    approval,
    bales: bales.map((b) => ({ ...b.bale, memberNo: b.memberNo, memberName: b.name })),
    settlements: settlements.map((x) => ({ ...x.s, memberNo: x.memberNo, memberName: x.name, paid: fmt2(x.paid), lines: lines.filter((l) => l.settlementId === x.s.id) })),
    batches: batches.map((b) => ({ ...b.b, payments: b.payments, paid: fmt2(b.paid) })),
  });
}));

// ------------------------------ MABELO ------------------------------
const baleRow = z.object({
  memberId: z.string().uuid().optional(),
  memberNo: z.string().trim().optional(),
  baleNo: z.string().trim().min(1, 'Weka namba ya belo/tiketi'),
  grossKg: decimalSchema({ min: 0.01 }),
  netKg: decimalSchema({ min: 0 }).nullable().optional(),
  grade: z.string().trim().max(20).nullable().optional(),
  priceUsd: decimalSchema({ min: 0 }).nullable().optional(),
  rejected: z.boolean().optional(),
  rejectReason: z.string().trim().nullable().optional(),
});

salesRouter.post('/markets/:id/bales', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { bales } = z.object({ bales: z.array(baleRow).min(1).max(500) }).parse(req.body);
  const m = await findMarket(req, id);
  const nos = bales.map((b) => b.baleNo.toUpperCase());
  if (new Set(nos).size !== nos.length) throw badRequest('Namba za mabelo zinajirudia kwenye orodha');
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from markets where id = ${id} for update`);
    await assertEditable(tx, m);
    const members = await tx.select().from(M).where(and(eq(M.amcosId, m.amcosId), or2(bales)));
    const byId = new Map(members.map((x) => [x.id, x]));
    const byNo = new Map(members.map((x) => [x.memberNo.toUpperCase(), x]));
    const taken = await tx.select({ baleNo: BL.baleNo }).from(BL).where(and(eq(BL.amcosId, m.amcosId), inArray(sql`upper(${BL.baleNo})`, nos)));
    if (taken.length) throw badRequest(`Mabelo haya tayari yamesajiliwa: ${taken.map((t) => t.baleNo).join(', ')}`);
    const values = bales.map((b, i) => {
      const mem = b.memberId ? byId.get(b.memberId) : b.memberNo ? byNo.get(b.memberNo.toUpperCase()) : undefined;
      if (!mem) throw new AppError(400, 'MEMBER_NOT_FOUND', `Mstari ${i + 1}: mkulima hajapatikana (${b.memberNo ?? b.memberId ?? '-'})`);
      if (mem.status !== 'ACTIVE') throw badRequest(`Mstari ${i + 1}: ${mem.firstName} ${mem.lastName} hayuko hai (ACTIVE)`);
      if (!b.rejected && (b.priceUsd === null || b.priceUsd === undefined)) throw badRequest(`Mstari ${i + 1}: weka bei (USD kwa kilo) au weka belo kama limekataliwa`);
      const kg = D(b.netKg ?? b.grossKg);
      return {
        amcosId: m.amcosId, marketId: m.id, memberId: mem.id, baleNo: b.baleNo.toUpperCase(), grossKg: b.grossKg, netKg: b.netKg ?? null,
        grade: b.grade ? b.grade.toUpperCase() : null, priceUsd: b.rejected ? null : b.priceUsd!, valueUsd: b.rejected ? null : fmt2(kg.times(b.priceUsd!)),
        status: (b.rejected ? 'REJECTED' : 'SOLD') as 'REJECTED' | 'SOLD', rejectReason: b.rejected ? (b.rejectReason ?? 'Limekataliwa') : null, createdById: req.auth!.userId,
      };
    });
    const ins = await tx.insert(BL).values(values).returning();
    await audit(tx, req, { action: 'BALES_RECORD', entity: 'Market', entityId: m.id, amcosId: m.amcosId, after: { count: ins.length, bales: ins.map((b) => b.baleNo) } });
    return ins;
  });
  res.status(201).json({ bales: rows });
}));

function or2(bales: z.infer<typeof baleRow>[]) {
  const ids = bales.map((b) => b.memberId).filter(Boolean) as string[];
  const nos = bales.map((b) => b.memberNo?.toUpperCase()).filter(Boolean) as string[];
  return sql`(${ids.length ? sql`${M.id} in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})` : sql`false`} or ${nos.length ? sql`upper(${M.memberNo}) in (${sql.join(nos.map((x) => sql`${x}`), sql`, `)})` : sql`false`})`;
}

salesRouter.delete('/bales/:id', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [b] = await db.select().from(BL).where(and(eq(BL.id, id), amcosScope(req, BL.amcosId)));
  if (!b) throw notFound('Belo');
  const m = await findMarket(req, b.marketId);
  await db.transaction(async (tx) => {
    await assertEditable(tx, m);
    await tx.delete(BL).where(eq(BL.id, id));
    await audit(tx, req, { action: 'BALE_REMOVE', entity: 'Bale', entityId: id, amcosId: b.amcosId, before: b });
  });
  res.json({ ok: true });
}));

// ------------------------------ HESABU ZA WAKULIMA (SETTLEMENT) ------------------------------
async function computeMarket(tx: Tx | typeof db, m: typeof MK.$inferSelect) {
  if (!m.exchangeRate) throw badRequest('Weka kiwango cha kubadilisha fedha (USD → TZS) cha soko hili');
  const bales = await tx.select().from(BL).where(and(eq(BL.marketId, m.id), eq(BL.status, 'SOLD')));
  if (!bales.length) throw badRequest('Soko hili halina mabelo yaliyouzwa');
  const rules = await tx.select().from(DR).where(and(eq(DR.amcosId, m.amcosId), eq(DR.seasonId, m.seasonId), eq(DR.isActive, true)));
  const memberIds = [...new Set(bales.map((b) => b.memberId))];
  const debts = await memberDebts(tx as Tx, m.amcosId, memberIds);
  // Deni lililokwisha kukatwa kwenye hesabu nyingine zinazosubiri idhini lisikatwe mara mbili
  const pendingLoan = await tx.execute<{ member_id: string; v: string }>(sql`
    select s.member_id, sum(l.amount) as v from settlement_lines l join settlements s on s.id = l.settlement_id
    join deduction_rules r on r.id = l.deduction_rule_id
    where s.amcos_id = ${m.amcosId} and s.status = 'DRAFT' and r.basis = 'OUTSTANDING_LOAN' group by s.member_id`);
  const pend = new Map(pendingLoan.rows.map((r) => [r.member_id, D(r.v)]));
  const members = await tx.select().from(M).where(inArray(M.id, memberIds));
  return members.map((mem) => {
    const debt = D(debts.get(mem.id) ?? 0).minus(pend.get(mem.id) ?? 0);
    const calc = computeSettlement(bales.filter((b) => b.memberId === mem.id), m.exchangeRate!, rules, debt.gt(0) ? debt : 0);
    return { memberId: mem.id, memberNo: mem.memberNo, name: `${mem.firstName} ${mem.lastName}`, bales: bales.filter((b) => b.memberId === mem.id).length, ...calc };
  }).sort((a, b) => a.memberNo.localeCompare(b.memberNo));
}

const totalsOf = (rows: Awaited<ReturnType<typeof computeMarket>>) => ({
  farmers: rows.length, kg: fmt2(rows.reduce((s, r) => s.plus(r.totalKg), D(0))), grossUsd: fmt2(rows.reduce((s, r) => s.plus(r.grossUsd), D(0))),
  grossTzs: fmt2(rows.reduce((s, r) => s.plus(r.grossTzs), D(0))), deductions: fmt2(rows.reduce((s, r) => s.plus(r.totalDeductions), D(0))),
  netTzs: fmt2(rows.reduce((s, r) => s.plus(r.netTzs), D(0))),
});

salesRouter.get('/markets/:id/preview', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const m = await findMarket(req, id);
  const rows = await computeMarket(db, m);
  res.json({ rows, totals: totalsOf(rows) });
}));

/** Hesabu za wakulima zinahifadhiwa (DRAFT) na kupelekwa kwa Meneja. Baada ya idhini zinaingia ledger na daftari kuu. */
salesRouter.post('/markets/:id/settlements', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const m = await findMarket(req, id);
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, m.amcosId) }))!;
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from markets where id = ${id} for update`);
    await assertEditable(tx, m);
    const rows = await computeMarket(tx, m);
    const totals = totalsOf(rows);
    const approval = await createApproval(tx, req, {
      amcosId: m.amcosId, type: 'TOBACCO_SALE', entityType: 'Market', entityId: m.id, amount: totals.grossTzs,
      title: `Mauzo ${m.marketNo}: wakulima ${totals.farmers}, kilo ${Number(totals.kg).toLocaleString('en-US')}, jumla ${tshText(totals.grossTzs)}, malipo halisi ${tshText(totals.netTzs)}`,
      reason: `Mnunuzi: ${m.buyerName ?? '-'} · Kiwango: ${m.exchangeRate} TZS/USD · Makato ${tshText(totals.deductions)}`,
      payload: { totals, exchangeRate: m.exchangeRate },
    });
    for (const r of rows) {
      const n = await nextNumber(tx, m.amcosId, 'settlement');
      const [s] = await tx.insert(S).values({
        amcosId: m.amcosId, seasonId: m.seasonId, memberId: r.memberId, marketId: m.id, approvalId: approval.id, settlementNo: `${amcos.code}-ST-${pad(n)}`,
        totalKg: r.totalKg, grossUsd: r.grossUsd, exchangeRate: m.exchangeRate!, grossTzs: r.grossTzs, totalDeductions: r.totalDeductions, netTzs: r.netTzs,
        status: 'DRAFT', createdById: req.auth!.userId,
      }).returning();
      if (r.deductions.length) await tx.insert(SL).values(r.deductions.map((d) => ({ settlementId: s.id, deductionRuleId: d.ruleId, description: d.description, amount: d.amount })));
    }
    await tx.update(MK).set({ approvalId: approval.id }).where(eq(MK.id, m.id));
    await audit(tx, req, { action: 'SETTLEMENTS_PREPARE', entity: 'Market', entityId: m.id, amcosId: m.amcosId, after: totals });
    return { approval, totals };
  });
  res.status(201).json(out);
}));

salesRouter.get('/settlements/:id', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [s] = await db.select().from(S).where(and(eq(S.id, id), amcosScope(req, S.amcosId)));
  if (!s) throw notFound('Hesabu ya mkulima');
  const member = await db.query.members.findFirst({ where: eq(M.id, s.memberId) });
  const market = s.marketId ? await db.query.markets.findFirst({ where: eq(MK.id, s.marketId) }) : null;
  const bales = s.marketId ? await db.select().from(BL).where(and(eq(BL.marketId, s.marketId), eq(BL.memberId, s.memberId))).orderBy(asc(BL.baleNo)) : [];
  const lines = await db.select().from(SL).where(eq(SL.settlementId, id));
  const pays = await db.select().from(PY).where(eq(PY.settlementId, id)).orderBy(asc(PY.createdAt));
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, s.amcosId) }))!;
  res.json({ settlement: s, member, market, bales, lines, payments: pays, amcos: { name: amcos.name, code: amcos.code, district: amcos.district, region: amcos.region } });
}));

// ------------------------------ ORODHA YA MALIPO (PAYMENT SHEET) ------------------------------
function destinationOf(m: typeof M.$inferSelect): { method: 'MOBILE_MONEY' | 'BANK' | 'CASH'; destination: string; provider: string | null } {
  if (m.preferredPayment === 'BANK' && m.bankAccountNumber) return { method: 'BANK', destination: `${m.bankName ?? ''} ${m.bankAccountNumber}`.trim(), provider: m.bankName };
  if (m.preferredPayment !== 'CASH' && m.mobileMoneyNumber) return { method: 'MOBILE_MONEY', destination: m.mobileMoneyNumber, provider: m.mobileMoneyProvider };
  return { method: 'CASH', destination: 'Taslimu', provider: null };
}

salesRouter.post('/markets/:id/payment-batch', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const m = await findMarket(req, id);
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, m.amcosId) }))!;
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from markets where id = ${id} for update`);
    const due = await tx.select({ s: S, member: M }).from(S).innerJoin(M, eq(M.id, S.memberId)).where(and(eq(S.marketId, id), eq(S.status, 'APPROVED'), sql`${S.netTzs} > 0`,
      sql`not exists (select 1 from payments p where p.settlement_id = "settlements"."id" and p.status in ('PENDING', 'PROCESSING', 'SUCCESS'))`)).orderBy(asc(M.memberNo));
    if (!due.length) throw badRequest('Hakuna wakulima wanaosubiri kulipwa kwenye soko hili (hesabu ziidhinishwe kwanza)');
    const total = due.reduce((s, d) => s.plus(d.s.netTzs), D(0));
    const n = await nextNumber(tx, m.amcosId, 'payment_batch');
    const [batch] = await tx.insert(PB).values({ amcosId: m.amcosId, seasonId: m.seasonId, marketId: m.id, batchNo: `${amcos.code}-PB-${pad(n)}`, totalAmount: fmt2(total), status: 'DRAFT', createdById: req.auth!.userId }).returning();
    await tx.insert(PY).values(due.map((d) => ({ amcosId: m.amcosId, batchId: batch.id, settlementId: d.s.id, memberId: d.member.id, amount: d.s.netTzs, ...destinationOf(d.member), idempotencyKey: `${batch.id}:${d.s.id}` })));
    const approval = await createApproval(tx, req, {
      amcosId: m.amcosId, type: 'PAYMENT_BATCH', entityType: 'PaymentBatch', entityId: batch.id, amount: fmt2(total),
      title: `Malipo ya wakulima ${batch.batchNo} (${m.marketNo}): wakulima ${due.length}, ${tshText(total)}`, reason: `Orodha ya malipo ya soko ${m.marketNo}`,
    });
    const [b] = await tx.update(PB).set({ approvalId: approval.id }).where(eq(PB.id, batch.id)).returning();
    await audit(tx, req, { action: 'PAYMENT_BATCH_PREPARE', entity: 'PaymentBatch', entityId: batch.id, amcosId: m.amcosId, after: { ...b, farmers: due.length } });
    return { batch: b, approval };
  });
  res.status(201).json(out);
}));

async function findBatch(req: Request, id: string) {
  const [b] = await db.select().from(PB).where(and(eq(PB.id, id), amcosScope(req, PB.amcosId)));
  if (!b) throw notFound('Orodha ya malipo');
  return b;
}

async function batchPayments(batchId: string) {
  return db.select({ p: PY, memberNo: M.memberNo, name: sql<string>`${M.firstName} || ' ' || ${M.lastName}`, phone: M.phone, settlementNo: S.settlementNo,
    txnNo: sql<string | null>`(select t.txn_no from finance_transactions t where t.id = "payments"."finance_txn_id")` })
    .from(PY).innerJoin(M, eq(M.id, PY.memberId)).leftJoin(S, eq(S.id, PY.settlementId)).where(eq(PY.batchId, batchId)).orderBy(asc(PY.method), asc(M.memberNo));
}

salesRouter.get('/batches/:id', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await batchPayments(id);
  const market = b.marketId ? await db.query.markets.findFirst({ where: eq(MK.id, b.marketId) }) : null;
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId) }))!;
  const approval = b.approvalId ? await db.select({ a: schema.approvalRequests, by: sql<string | null>`(select u.full_name from users u where u.id = "approval_requests"."decided_by_id")` })
    .from(schema.approvalRequests).where(eq(schema.approvalRequests.id, b.approvalId)) : [];
  const byMethod = (k: string) => fmt2(rows.filter((r) => r.p.method === k).reduce((s, r) => s.plus(r.p.amount), D(0)));
  res.json({
    batch: b, market, amcos: { name: amcos.name, code: amcos.code, district: amcos.district, region: amcos.region },
    approval: approval[0] ? { ...approval[0].a, decidedBy: approval[0].by } : null,
    payments: rows.map((r) => ({ ...r.p, memberNo: r.memberNo, memberName: r.name, phone: r.phone, settlementNo: r.settlementNo, txnNo: r.txnNo })),
    summary: { MOBILE_MONEY: byMethod('MOBILE_MONEY'), BANK: byMethod('BANK'), CASH: byMethod('CASH'),
      paid: fmt2(rows.filter((r) => r.p.status === 'SUCCESS').reduce((s, r) => s.plus(r.p.amount), D(0))),
      pending: rows.filter((r) => r.p.status === 'PENDING' || r.p.status === 'FAILED').length },
  });
}));

salesRouter.get('/batches/:id/csv', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const b = await findBatch(req, id);
  const rows = await batchPayments(id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="malipo-${b.batchNo}.csv"`);
  res.send(toCsv([
    ['Namba ya mkulima', 'Jina', 'Njia', 'Mtoa huduma', 'Namba ya simu / akaunti', 'Kiasi (TSh)', 'Hesabu', 'Hali'],
    ...rows.map((r) => [r.memberNo, r.name, r.p.method, r.p.provider, r.p.destination, r.p.amount, r.settlementNo, r.p.status]),
  ]));
}));

/** Mhasibu anathibitisha malipo YALIYOFANYIKA KWELI (mf. baada ya bulk M-Pesa/benki). Hakuna malipo yanayowekwa "yamefanikiwa" yenyewe. */
salesRouter.post('/batches/:id/confirm', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({
    accountId: z.string().uuid(), paymentIds: z.array(z.string().uuid()).min(1, 'Chagua malipo yaliyofanyika').max(2000),
    reference: z.string().trim().min(2, 'Weka kumbukumbu ya malipo (mf. namba ya bulk payment / cheki)'), txnDate: dateStr.optional(),
  }).parse(req.body);
  const b = await findBatch(req, id);
  if (!['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status)) throw badRequest(b.status === 'DRAFT' ? 'Orodha hii bado inasubiri idhini ya Meneja' : 'Orodha hii haipokei malipo tena');
  const [acc] = await db.select().from(schema.financeAccounts).where(and(eq(schema.financeAccounts.id, body.accountId), eq(schema.financeAccounts.amcosId, b.amcosId)));
  if (!acc || !acc.isActive) throw badRequest('Akaunti ya fedha si sahihi');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, b.amcosId) }))!;
  const market = b.marketId ? await db.query.markets.findFirst({ where: eq(MK.id, b.marketId) }) : null;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from payment_batches where id = ${id} for update`);
    const pays = await tx.select().from(PY).where(and(eq(PY.batchId, id), inArray(PY.id, body.paymentIds)));
    if (pays.length !== new Set(body.paymentIds).size) throw badRequest('Baadhi ya malipo hayako kwenye orodha hii');
    const bad = pays.find((p) => p.status !== 'PENDING' && p.status !== 'FAILED');
    if (bad) throw badRequest('Baadhi ya malipo tayari yamethibitishwa au yamesitishwa');
    const total = pays.reduce((s, p) => s.plus(p.amount), D(0));
    await lockAccount(tx, acc.id);
    const bal = await accountBalance(tx, acc.id);
    if (bal.lessThan(total)) throw badRequest(`Salio la ${acc.name} halitoshi: linahitajika ${tshText(total)}, lipo TSh ${fmt2(bal)}`);
    const date = body.txnDate ?? todayStr();
    for (const p of pays) {
      const mem = (await tx.query.members.findFirst({ where: eq(M.id, p.memberId) }))!;
      const [t] = await tx.insert(schema.financeTransactions).values({
        amcosId: b.amcosId, seasonId: b.seasonId, txnNo: await nextTxnNo(tx, b.amcosId, amcos.code), kind: 'FARMER_PAYMENT', direction: 'OUT', category: 'PAYMENT',
        accountId: acc.id, amount: p.amount, txnDate: date, description: `Malipo ya tumbaku ${market?.marketNo ?? ''} (${b.batchNo})`.replace('  ', ' '),
        reference: body.reference, payee: `${mem.firstName} ${mem.lastName} (${mem.memberNo})`, memberId: mem.id,
        status: 'POSTED', approvalId: b.approvalId, createdById: req.auth!.userId, postedById: req.auth!.userId, postedAt: new Date(),
      }).returning();
      await ledger.post(tx, {
        amcosId: b.amcosId, memberId: mem.id, seasonId: b.seasonId, type: 'PAYMENT', debit: p.amount,
        description: `Malipo ya tumbaku ${t.txnNo} (${p.method === 'MOBILE_MONEY' ? 'simu' : p.method === 'BANK' ? 'benki' : 'taslimu'})`, referenceType: 'FINANCE_TXN', referenceId: t.id, createdById: req.auth!.userId,
      });
      await tx.update(PY).set({ status: 'SUCCESS', providerRef: body.reference, paidAt: new Date(), financeTxnId: t.id, failureReason: null }).where(eq(PY.id, p.id));
      if (p.settlementId) await tx.update(S).set({ status: 'PAID' }).where(eq(S.id, p.settlementId));
    }
    const all = await tx.select({ status: PY.status }).from(PY).where(eq(PY.batchId, id));
    const status = all.every((x) => x.status === 'SUCCESS' || x.status === 'CANCELLED') ? 'COMPLETED' : all.some((x) => x.status === 'FAILED') ? 'PARTIAL' : 'PROCESSING';
    await tx.update(PB).set({ status }).where(eq(PB.id, id));
    await audit(tx, req, { action: 'PAYMENTS_CONFIRMED', entity: 'PaymentBatch', entityId: id, amcosId: b.amcosId, after: { count: pays.length, total: fmt2(total), reference: body.reference, account: acc.name } });
    return { confirmed: pays.length, total: fmt2(total), status };
  });
  res.json(result);
}));

salesRouter.post('/batches/:id/fail', requireAmcosPerm('sales.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ paymentIds: z.array(z.string().uuid()).min(1), reason: z.string().trim().min(3, 'Eleza kwa nini malipo yameshindwa') }).parse(req.body);
  const b = await findBatch(req, id);
  const rows = await db.transaction(async (tx) => {
    const r = await tx.update(PY).set({ status: 'FAILED', failureReason: body.reason }).where(and(eq(PY.batchId, b.id), inArray(PY.id, body.paymentIds), eq(PY.status, 'PENDING'))).returning();
    if (r.length) await tx.update(PB).set({ status: 'PARTIAL' }).where(eq(PB.id, b.id));
    await audit(tx, req, { action: 'PAYMENTS_FAILED', entity: 'PaymentBatch', entityId: b.id, amcosId: b.amcosId, after: { count: r.length, reason: body.reason } });
    return r;
  });
  res.json({ failed: rows.length });
}));

// ------------------------------ MUHTASARI WA MSIMU ------------------------------
salesRouter.get('/summary', requireAmcosPerm('sales.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const s = await season();
  const [r] = (await db.execute<{ farmers: string; kg: string; gross: string; ded: string; net: string; paid: string }>(sql`
    select count(distinct s.member_id) as farmers, coalesce(sum(s.total_kg), 0) as kg, coalesce(sum(s.gross_tzs), 0) as gross,
      coalesce(sum(s.total_deductions), 0) as ded, coalesce(sum(s.net_tzs), 0) as net,
      coalesce((select sum(p.amount) from payments p join settlements x on x.id = p.settlement_id where x.amcos_id = ${amcosId} and x.season_id = ${s.id} and p.status = 'SUCCESS'), 0) as paid
    from settlements s where s.amcos_id = ${amcosId} and s.season_id = ${s.id} and s.status in ('APPROVED', 'PAID')`)).rows;
  const byRule = await db.execute<{ name: string; v: string }>(sql`
    select coalesce(r.name, l.description) as name, sum(l.amount) as v from settlement_lines l join settlements s on s.id = l.settlement_id
    left join deduction_rules r on r.id = l.deduction_rule_id
    where s.amcos_id = ${amcosId} and s.season_id = ${s.id} and s.status in ('APPROVED', 'PAID') group by 1 order by 2 desc`);
  res.json({ season: s, farmers: Number(r.farmers), kg: fmt2(r.kg), grossTzs: fmt2(r.gross), deductions: fmt2(r.ded), netTzs: fmt2(r.net), paid: fmt2(r.paid),
    unpaid: fmt2(D(r.net).minus(r.paid)), deductionsByRule: byRule.rows.map((x) => ({ name: x.name, amount: fmt2(x.v) })) });
}));
