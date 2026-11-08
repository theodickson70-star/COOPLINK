// =====================================================================
//  MALI ZA CHAMA (Mhasibu) — rejista ya mali, uchakavu wa kila mwezi, kuondoa mali (kwa idhini)
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import { createApproval } from '../lib/approvals';
import { accumulated, ASSET_CATEGORIES, chargeFor, monthlyCharge } from '../lib/assets';
import { glMap, postJournal, syncLedger } from '../lib/gl';
import { todayStr } from './accounting.routes';

export const assetsRouter = Router();
const F = schema.fixedAssets;
const DRN = schema.depreciationRuns;
const DLN = schema.depreciationLines;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Kipindi kiwe YYYY-MM');
const lastDay = (p: string) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

assetsRouter.get('/categories', requireAmcosPerm('accounting.read'), (_req, res) => res.json(ASSET_CATEGORIES));

assetsRouter.get('/', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const rows = await db.select({ a: F, txnNo: sql<string | null>`(select t.txn_no from finance_transactions t where t.id = "fixed_assets"."funding_txn_id")` })
    .from(F).where(eq(F.amcosId, amcosId)).orderBy(asc(F.status), asc(F.assetNo));
  const acc = await accumulated(db, amcosId);
  const data = rows.map(({ a, txnNo }) => {
    const ad = acc.get(a.id) ?? D(0);
    return { ...a, categoryLabel: ASSET_CATEGORIES[a.category] ?? a.category, fundingTxnNo: txnNo, accumulated: fmt2(ad), netBookValue: fmt2(a.status === 'DISPOSED' ? 0 : D(a.cost).minus(ad)), monthly: fmt2(monthlyCharge(a)) };
  });
  const live = data.filter((d) => d.status !== 'DISPOSED');
  res.json({ data, totals: { cost: fmt2(live.reduce((s, d) => s.plus(d.cost), D(0))), accumulated: fmt2(live.reduce((s, d) => s.plus(d.accumulated), D(0))), netBookValue: fmt2(live.reduce((s, d) => s.plus(d.netBookValue), D(0))) } });
}));

const assetBody = z.object({
  name: z.string().trim().min(2),
  category: z.string().refine((c) => c in ASSET_CATEGORIES, 'Aina ya mali si sahihi'),
  acquisitionDate: dateStr,
  cost: decimalSchema({ min: 1 }),
  residualValue: decimalSchema({ min: 0 }).optional(),
  usefulLifeMonths: z.coerce.number().int().min(0).max(1200),
  location: z.string().trim().nullable().optional(),
  serialNo: z.string().trim().nullable().optional(),
  fundingTxnId: z.string().uuid().nullable().optional(),
});

/**
 * Kusajili mali.
 *  - Iliyonunuliwa kupitia matumizi (akaunti ya daftari kuu 1500): unganisha na muamala huo — daftari kuu tayari lina gharama.
 *  - Iliyokuwepo kabla ya mfumo: inaingia kama salio la kuanzia (Dr 1500 / Cr 3900).
 */
assetsRouter.post('/', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = assetBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (D(body.residualValue).gt(body.cost)) throw badRequest('Thamani ya mwisho haiwezi kuzidi gharama');
  if (body.acquisitionDate > todayStr()) throw badRequest('Tarehe ya kununua haiwezi kuwa ya baadaye');
  await syncLedger(amcosId);
  const asset = await db.transaction(async (tx) => {
    if (body.fundingTxnId) {
      const t = await tx.query.financeTransactions.findFirst({ where: and(eq(schema.financeTransactions.id, body.fundingTxnId), eq(schema.financeTransactions.amcosId, amcosId)) });
      if (!t || t.status !== 'POSTED' || t.kind !== 'EXPENSE') throw badRequest('Muamala wa kununua mali uwe matumizi yaliyokamilika');
      const gl = (await glMap(tx, amcosId)).byCode.get('1500');
      if (!gl || t.contraGlAccountId !== gl.id) throw badRequest('Muamala huo haukuwekwa kwenye akaunti 1500 (Mali za kudumu). Andaa matumizi ukichagua akaunti 1500');
      const [used] = (await tx.execute<{ v: string }>(sql`select coalesce(sum(cost), 0) as v from fixed_assets where funding_txn_id = ${t.id}`)).rows;
      if (D(used.v).plus(body.cost).gt(t.amount)) throw badRequest(`Gharama inazidi kiasi cha muamala ${t.txnNo} (kilichobaki ${tshText(D(t.amount).minus(used.v))})`);
    }
    const n = await nextNumber(tx, amcosId, 'asset');
    const [a] = await tx.insert(F).values({ ...body, residualValue: body.residualValue ?? '0', amcosId, assetNo: `MALI-${pad(n, 4)}`, fundingTxnId: body.fundingTxnId ?? null, createdById: req.auth!.userId }).returning();
    if (!body.fundingTxnId) {
      await postJournal(tx, { amcosId, date: body.acquisitionDate, description: `Mali iliyokuwepo: ${a.assetNo} ${a.name}`, source: 'ASSET_OPENING', sourceId: a.id, reference: a.assetNo,
        createdById: req.auth!.userId, lines: [{ code: '1500', debit: a.cost }, { code: '3900', credit: a.cost }] });
    }
    await audit(tx, req, { action: 'ASSET_CREATE', entity: 'FixedAsset', entityId: a.id, amcosId, after: a });
    return a;
  });
  res.status(201).json({ asset });
}));

async function findAsset(req: Request, id: string) {
  const [a] = await db.select().from(F).where(and(eq(F.id, id), amcosScope(req, F.amcosId)));
  if (!a) throw notFound('Mali');
  return a;
}

assetsRouter.get('/item/:id', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const a = await findAsset(req, id);
  const hist = await db.select({ period: DRN.period, amount: DLN.amount, createdAt: DRN.createdAt }).from(DLN).innerJoin(DRN, eq(DRN.id, DLN.runId)).where(eq(DLN.assetId, id)).orderBy(asc(DRN.period));
  let run = D(0);
  res.json({ asset: { ...a, categoryLabel: ASSET_CATEGORIES[a.category] ?? a.category, monthly: fmt2(monthlyCharge(a)) },
    history: hist.map((h) => { run = run.plus(h.amount); return { ...h, accumulated: fmt2(run), netBookValue: fmt2(D(a.cost).minus(run)) }; }) });
}));

assetsRouter.patch('/item/:id', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ name: z.string().trim().min(2).optional(), location: z.string().trim().nullable().optional(), serialNo: z.string().trim().nullable().optional() }).parse(req.body);
  const a = await findAsset(req, id);
  const asset = await db.transaction(async (tx) => {
    const [r] = await tx.update(F).set(body).where(eq(F.id, id)).returning();
    await audit(tx, req, { action: 'ASSET_UPDATE', entity: 'FixedAsset', entityId: id, amcosId: a.amcosId, before: a, after: r });
    return r;
  });
  res.json({ asset });
}));

assetsRouter.post('/item/:id/dispose', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ date: dateStr, reason: z.string().trim().min(5, 'Eleza sababu (imeuzwa, imeharibika, imeibiwa ...)') }).parse(req.body);
  const a = await findAsset(req, id);
  if (a.status !== 'ACTIVE') throw badRequest('Mali hii haiko hai');
  if (body.date > todayStr() || body.date < a.acquisitionDate) throw badRequest('Tarehe ya kuondoa si sahihi');
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.update(F).set({ status: 'DISPOSAL_PENDING' }).where(and(eq(F.id, id), eq(F.status, 'ACTIVE'))).returning();
    if (!r) throw conflict('Mali imebadilishwa na mtu mwingine');
    const approval = await createApproval(tx, req, {
      amcosId: a.amcosId, type: 'ASSET_DISPOSAL', entityType: 'FixedAsset', entityId: a.id, amount: a.cost,
      title: `Kuondoa mali ${a.assetNo}: ${a.name} (gharama ${tshText(a.cost)})`, reason: body.reason, payload: { date: body.date },
    });
    await tx.update(F).set({ disposalApprovalId: approval.id }).where(eq(F.id, id));
    return { approval };
  });
  res.status(202).json(out);
}));

// ------------------------------ UCHAKAVU ------------------------------
async function depreciationFor(amcosId: string, p: string) {
  const assets = await db.select().from(F).where(and(eq(F.amcosId, amcosId), sql`(status <> 'DISPOSED' or (disposed_at is not null and to_char(disposed_at, 'YYYY-MM') >= ${p}))`));
  const acc = await accumulated(db, amcosId);
  const lines = assets.map((a) => ({ asset: a, amount: chargeFor(a, p, acc.get(a.id) ?? D(0)) })).filter((l) => l.amount.gt(0));
  return { lines, total: lines.reduce((s, l) => s.plus(l.amount), D(0)) };
}

assetsRouter.get('/depreciation', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const rows = await db.select({ r: DRN, n: sql<number>`(select count(*)::int from depreciation_lines l where l.run_id = "depreciation_runs"."id")` }).from(DRN).where(eq(DRN.amcosId, amcosId)).orderBy(desc(DRN.period));
  res.json({ data: rows.map((x) => ({ ...x.r, assets: x.n })) });
}));

assetsRouter.get('/depreciation/preview', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { period: p } = z.object({ period }).parse(req.query);
  const amcosId = await readAmcosId(req);
  const d = await depreciationFor(amcosId, p);
  const [done] = await db.select({ id: DRN.id }).from(DRN).where(and(eq(DRN.amcosId, amcosId), eq(DRN.period, p)));
  res.json({ period: p, alreadyRun: !!done, total: fmt2(d.total), lines: d.lines.map((l) => ({ assetId: l.asset.id, assetNo: l.asset.assetNo, name: l.asset.name, amount: fmt2(l.amount) })) });
}));

/** Kuendesha uchakavu wa mwezi: mara moja tu kwa kila mwezi (unique), journal Dr 5900 / Cr 1590. */
assetsRouter.post('/depreciation', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const { period: p } = z.object({ period }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (p > todayStr().slice(0, 7)) throw badRequest('Huwezi kuendesha uchakavu wa mwezi ujao');
  const d = await depreciationFor(amcosId, p);
  if (d.total.lte(0)) throw badRequest('Hakuna uchakavu wa kuandika kwa mwezi huu');
  const run = await db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: DRN.id }).from(DRN).where(and(eq(DRN.amcosId, amcosId), eq(DRN.period, p)));
    if (dup) throw conflict(`Uchakavu wa ${p} tayari umeandikwa`);
    const [r] = await tx.insert(DRN).values({ amcosId, period: p, total: fmt2(d.total), createdById: req.auth!.userId }).returning();
    await tx.insert(DLN).values(d.lines.map((l) => ({ runId: r.id, assetId: l.asset.id, amount: fmt2(l.amount) })));
    const end = lastDay(p);
    await postJournal(tx, { amcosId, date: end < todayStr() ? end : todayStr(), description: `Uchakavu wa mali wa ${p} (mali ${d.lines.length})`, source: 'DEPRECIATION', sourceId: r.id,
      reference: `UCH-${p}`, createdById: req.auth!.userId, lines: [{ code: '5900', debit: d.total }, { code: '1590', credit: d.total }] });
    await audit(tx, req, { action: 'DEPRECIATION_RUN', entity: 'DepreciationRun', entityId: r.id, amcosId, after: { period: p, total: fmt2(d.total), assets: d.lines.length } });
    return r;
  });
  res.status(201).json({ run });
}));
