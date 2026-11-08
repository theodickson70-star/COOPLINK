// =====================================================================
//  STOO (Stokipa) — wazabuni, maombi ya manunuzi, kupokea mzigo, hesabu ya stoo, ripoti
//   Manunuzi: Stokipa anaomba -> Meneja anaidhinisha -> Mhasibu analipa -> Stokipa anapokea -> stoo inaongezeka
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, phoneSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { nextNumber, pad } from '../lib/counter';
import { D, fmt2 } from '../lib/money';
import { createApproval } from '../lib/approvals';
import { stockBalance } from '../lib/stock';
import { currentSeason } from './seasons.routes';
import { toCsv } from './owner/common';

export const storeRouter = Router();
const S = schema.suppliers;
const P = schema.purchaseRequests;
const PL = schema.purchaseRequestLines;
const moves = schema.stockMovements;
const items = schema.inputItems;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');

async function openSeason() {
  const s = await currentSeason();
  if (!s) throw badRequest('Hakuna msimu unaoendelea');
  if (s.status === 'CLOSED') throw badRequest('Msimu umefungwa');
  return s;
}

// ------------------------------ WAZABUNI ------------------------------
const supplierBody = z.object({
  name: z.string().trim().min(2),
  phone: phoneSchema.nullable().optional(),
  email: z.string().email().nullable().optional(),
  tin: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

storeRouter.get('/suppliers', requireAmcosPerm('stock.read', 'finance.read'), ah(async (req, res) => {
  res.json({ data: await db.select().from(S).where(amcosScope(req, S.amcosId)).orderBy(asc(S.name)) });
}));

storeRouter.post('/suppliers', requireAmcosPerm('suppliers.manage'), ah(async (req, res) => {
  const body = supplierBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const supplier = await db.transaction(async (tx) => {
    const [s] = await tx.insert(S).values({ ...body, amcosId }).returning();
    await audit(tx, req, { action: 'SUPPLIER_CREATE', entity: 'Supplier', entityId: s.id, amcosId, after: s });
    return s;
  });
  res.status(201).json({ supplier });
}));

storeRouter.patch('/suppliers/:id', requireAmcosPerm('suppliers.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = supplierBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const [before] = await db.select().from(S).where(and(eq(S.id, id), amcosScope(req, S.amcosId)));
  if (!before) throw notFound('Mzabuni');
  const supplier = await db.transaction(async (tx) => {
    const [s] = await tx.update(S).set(body).where(eq(S.id, id)).returning();
    await audit(tx, req, { action: 'SUPPLIER_UPDATE', entity: 'Supplier', entityId: id, amcosId: before.amcosId, before, after: s });
    return s;
  });
  res.json({ supplier });
}));

// ------------------------------ MAOMBI YA MANUNUZI ------------------------------
const prCols = {
  pr: P,
  supplier: S.name,
  requestedBy: sql<string | null>`(select u.full_name from users u where u.id = "purchase_requests"."requested_by_id")`,
  paid: sql<string>`(select coalesce(sum(case when t.kind = 'REVERSAL' then -t.amount else t.amount end), 0) from finance_transactions t
    where t.purchase_request_id = "purchase_requests"."id" and t.status = 'POSTED')`,
};

storeRouter.get('/purchases', requireAmcosPerm('stock.read', 'finance.read'), ah(async (req, res) => {
  const q = paginationQuery.extend({ status: z.enum(schema.purchaseStatusEnum.enumValues).optional() }).parse(req.query);
  const where = and(amcosScope(req, P.amcosId), q.status ? eq(P.status, q.status) : undefined);
  const [rows, [{ total }]] = await Promise.all([
    db.select(prCols).from(P).leftJoin(S, eq(S.id, P.supplierId)).where(where).orderBy(desc(P.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(P).where(where),
  ]);
  res.json(paged(rows.map((r) => ({ ...r.pr, supplierName: r.supplier, requestedBy: r.requestedBy, paid: fmt2(r.paid) })), total, q.page, q.pageSize));
}));

async function scopedPr(req: Request, id: string) {
  const [pr] = await db.select().from(P).where(and(eq(P.id, id), amcosScope(req, P.amcosId)));
  if (!pr) throw notFound('Ombi la manunuzi');
  return pr;
}

storeRouter.get('/purchases/:id', requireAmcosPerm('stock.read', 'finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  await scopedPr(req, id);
  const [row] = await db.select(prCols).from(P).leftJoin(S, eq(S.id, P.supplierId)).where(eq(P.id, id));
  const lines = await db.query.purchaseRequestLines.findMany({ where: eq(PL.purchaseRequestId, id), with: { inputItem: { columns: { id: true, name: true, unit: true } } } });
  const receipts = await db.select().from(moves).where(eq(moves.purchaseRequestId, id)).orderBy(asc(moves.createdAt));
  const payments = await db.select().from(schema.financeTransactions).where(eq(schema.financeTransactions.purchaseRequestId, id)).orderBy(asc(schema.financeTransactions.createdAt));
  const approval = row.pr.approvalId ? await db.query.approvalRequests.findFirst({ where: eq(schema.approvalRequests.id, row.pr.approvalId) }) : null;
  res.json({ purchase: { ...row.pr, supplierName: row.supplier, requestedBy: row.requestedBy, paid: fmt2(row.paid) }, lines, receipts, payments, approval });
}));

storeRouter.post('/purchases', requireAmcosPerm('purchases.request'), ah(async (req, res) => {
  const body = z.object({
    supplierId: z.string().uuid().nullable().optional(),
    neededBy: dateStr.nullable().optional(),
    notes: z.string().trim().min(3, 'Eleza sababu ya manunuzi'),
    lines: z.array(z.object({ inputItemId: z.string().uuid(), quantity: decimalSchema({ min: 0.01 }), unitCost: decimalSchema({ min: 0 }) })).min(1).max(30),
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const season = await openSeason();
  const ids = body.lines.map((l) => l.inputItemId);
  if (new Set(ids).size !== ids.length) throw badRequest('Bidhaa moja imerudiwa');
  const found = await db.select().from(items).where(and(eq(items.amcosId, amcosId), inArray(items.id, ids)));
  if (found.length !== ids.length) throw badRequest('Baadhi ya bidhaa hazipo kwenye chama hiki');
  const supplier = body.supplierId ? (await db.select().from(S).where(and(eq(S.id, body.supplierId), eq(S.amcosId, amcosId))))[0] : null;
  if (body.supplierId && !supplier) throw notFound('Mzabuni');
  const lines = body.lines.map((l) => ({ ...l, amount: fmt2(D(l.quantity).times(l.unitCost)) }));
  const total = fmt2(lines.reduce((s, l) => s.plus(l.amount), D(0)));
  const nameOf = new Map(found.map((i) => [i.id, i.name]));
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
  const result = await db.transaction(async (tx) => {
    const [pr] = await tx.insert(P).values({
      amcosId, seasonId: season.id, prNo: `${amcos.code}-PR-${pad(await nextNumber(tx, amcosId, 'purchase'))}`,
      supplierId: supplier?.id ?? null, totalAmount: total, neededBy: body.neededBy ?? null, notes: body.notes, requestedById: req.auth!.userId,
    }).returning();
    await tx.insert(PL).values(lines.map((l) => ({ purchaseRequestId: pr.id, ...l })));
    await audit(tx, req, { action: 'PURCHASE_REQUEST', entity: 'PurchaseRequest', entityId: pr.id, amcosId, after: { ...pr, lines } });
    const approval = await createApproval(tx, req, {
      amcosId, type: 'PURCHASE', entityType: 'PurchaseRequest', entityId: pr.id, amount: total, reason: body.notes,
      title: `Manunuzi ${pr.prNo}${supplier ? ` kutoka ${supplier.name}` : ''}: ${lines.map((l) => `${nameOf.get(l.inputItemId)} x${l.quantity}`).join(', ')}`,
    });
    const [upd] = await tx.update(P).set({ approvalId: approval.id }).where(eq(P.id, pr.id)).returning();
    return { purchase: upd, approval };
  });
  res.status(201).json(result);
}));

// Mzigo wa ombi la manunuzi unaingizwa stoo kupitia "Ingiza pembejeo" (POST /inputs/stock/receipts, purchaseLineId)
// — njia moja tu ya kuongeza stoo, na Meneja anaidhinisha idadi na bei ya mkulima.


// ------------------------------ HESABU YA STOO (RECONCILIATION) ------------------------------
/** Stokipa anaingiza hesabu halisi; tofauti zinakuwa maombi ya marekebisho kwa Meneja. Stoo haibadiliki sasa. */
storeRouter.post('/stock-count', requireAmcosPerm('stock.adjust.request'), ah(async (req, res) => {
  const body = z.object({
    notes: z.string().trim().min(3),
    counts: z.array(z.object({ inputItemId: z.string().uuid(), countedQty: decimalSchema({ min: 0 }) })).min(1),
  }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const season = await openSeason();
  const found = await db.select().from(items).where(and(eq(items.amcosId, amcosId), inArray(items.id, body.counts.map((c) => c.inputItemId))));
  const nameOf = new Map(found.map((i) => [i.id, i.name]));
  const out = await db.transaction(async (tx) => {
    const created = [];
    const report = [];
    for (const c of body.counts) {
      if (!nameOf.has(c.inputItemId)) throw badRequest('Bidhaa haipo kwenye chama hiki');
      const sys = await stockBalance(tx, amcosId, season.id, c.inputItemId);
      const diff = D(c.countedQty).minus(sys);
      report.push({ inputItemId: c.inputItemId, name: nameOf.get(c.inputItemId), system: fmt2(sys), counted: c.countedQty, difference: fmt2(diff) });
      if (diff.isZero()) continue;
      created.push(await createApproval(tx, req, {
        amcosId, type: 'STOCK_ADJUSTMENT', entityType: 'InputItem', entityId: c.inputItemId,
        title: `Hesabu ya stoo: ${nameOf.get(c.inputItemId)} ${diff.isPos() ? '+' : ''}${fmt2(diff)} (mfumo ${fmt2(sys)}, halisi ${c.countedQty})`,
        reason: body.notes,
        payload: { inputItemId: c.inputItemId, seasonId: season.id, quantity: fmt2(diff), kind: 'ADJUSTMENT', reference: 'HESABU-YA-STOO', balanceAtRequest: fmt2(sys) },
      }));
    }
    await audit(tx, req, { action: 'STOCK_COUNT', entity: 'StockCount', amcosId, after: { notes: body.notes, report } });
    return { report, approvals: created };
  });
  res.status(201).json(out);
}));

// ------------------------------ MUHTASARI NA RIPOTI ------------------------------
storeRouter.get('/expiring', requireAmcosPerm('stock.read'), ah(async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(60) }).parse(req.query);
  const rows = await db.select({
    id: moves.id, inputItemId: moves.inputItemId, name: items.name, unit: items.unit, batchNo: moves.batchNo,
    expiryDate: moves.expiryDate, quantity: moves.quantity, reference: moves.reference,
  }).from(moves).innerJoin(items, eq(items.id, moves.inputItemId))
    .where(and(amcosScope(req, moves.amcosId), eq(moves.type, 'RECEIPT'), isNotNull(moves.expiryDate),
      lte(moves.expiryDate, sql`(current_date + ${days}::int)`), gte(moves.expiryDate, sql`(current_date - 365)`)))
    .orderBy(asc(moves.expiryDate)).limit(100);
  res.json({ data: rows.map((r) => ({ ...r, expired: r.expiryDate! < new Date().toISOString().slice(0, 10) })) });
}));

storeRouter.get('/stock.csv', requireAmcosPerm('reports.stock'), ah(async (req, res) => {
  const season = await currentSeason();
  if (!season) throw notFound('Msimu');
  const f = (t: string) => sql<string>`abs(coalesce(sum(${moves.quantity}) filter (where ${moves.type} = ${t}), 0))`;
  const rows = await db.select({
    name: items.name, unit: items.unit, received: f('RECEIPT'), issued: f('ISSUE'), returned: f('RETURN'),
    adjusted: sql<string>`coalesce(sum(${moves.quantity}) filter (where ${moves.type} = 'ADJUSTMENT'), 0)`,
    damaged: f('DAMAGE'), expired: f('EXPIRY'), balance: sql<string>`coalesce(sum(${moves.quantity}), 0)`,
  }).from(moves).innerJoin(items, eq(items.id, moves.inputItemId))
    .where(and(amcosScope(req, moves.amcosId), eq(moves.seasonId, season.id))).groupBy(items.name, items.unit).orderBy(asc(items.name));
  const csv = toCsv([
    ['Bidhaa', 'Kipimo', 'Zilizoingia', 'Zilizotoka', 'Zilizorudishwa', 'Marekebisho', 'Zilizoharibika', 'Muda umeisha', 'Salio'],
    ...rows.map((r) => [r.name, r.unit, r.received, r.issued, r.returned, r.adjusted, r.damaged, r.expired, r.balance]),
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="stoo-${season.name.replace(/\W+/g, '-')}.csv"`);
  res.send(csv);
}));

