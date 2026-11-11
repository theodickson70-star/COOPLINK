// =====================================================================
//  PEMBEJEO
//   /inputs/items        aina za pembejeo za chama
//   /inputs/prices       bei kwa msimu
//   /inputs/stock        salio la stoo, kupokea, marekebisho
//   /input-issues        kutoa pembejeo kwa mkopo -> ledger ya mwanachama
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { nextNumber, pad } from '../lib/counter';
import * as ledger from '../lib/ledger';
import { D, fmt2, tshText } from '../lib/money';
import { findMemberScoped } from './members.routes';
import { lockItems, stockBalance } from '../lib/stock';
import { createApproval } from '../lib/approvals';
import { inputCurrency, recordUsd, requireRate, toTzs } from '../lib/fx';
import { currentSeason } from './seasons.routes';
import { activeGroups } from '../lib/groups';

export const inputsRouter = Router();
export const inputIssuesRouter = Router();

const items = schema.inputItems;
const prices = schema.inputPrices;
const moves = schema.stockMovements;
const issues = schema.inputIssues;

async function resolveOpenSeason(seasonId?: string) {
  const s = seasonId ? await db.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) }) : await currentSeason();
  if (!s) throw notFound('Msimu');
  if (s.status === 'CLOSED') throw badRequest('Msimu umefungwa');
  return s;
}

async function findItemScoped(req: Request, id: string) {
  const [row] = await db.select().from(items).where(and(eq(items.id, id), amcosScope(req, items.amcosId)));
  if (!row) throw notFound('Pembejeo');
  return row;
}

// ------------------------------ AINA ZA PEMBEJEO ------------------------------
const itemBody = z.object({
  name: z.string().trim().min(2),
  category: z.enum(schema.inputCategoryEnum.enumValues),
  unit: z.enum(schema.inputUnitEnum.enumValues),
  reorderLevel: decimalSchema({ min: 0 }).nullable().optional(),
});

inputsRouter.get(
  '/items',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const { active } = z.object({ active: z.enum(['true', 'false']).optional() }).parse(req.query);
    const rows = await db.select().from(items)
      .where(and(amcosScope(req, items.amcosId), active ? eq(items.isActive, active === 'true') : undefined))
      .orderBy(asc(items.category), asc(items.name));
    res.json({ data: rows });
  }),
);

inputsRouter.post(
  '/items',
  requireAmcosPerm('products.manage'),
  ah(async (req, res) => {
    const body = itemBody.extend({ amcosId: z.string().uuid().optional() }).parse(req.body);
    const amcosId = await resolveWriteAmcosId(req, body.amcosId);
    const item = await db.transaction(async (tx) => {
      const [row] = await tx.insert(items).values({ ...body, amcosId }).returning();
      await audit(tx, req, { action: 'INPUT_ITEM_CREATE', entity: 'InputItem', entityId: row.id, amcosId, after: row });
      return row;
    });
    res.status(201).json({ item });
  }),
);

inputsRouter.patch(
  '/items/:id',
  requireAmcosPerm('products.manage'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = itemBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const before = await findItemScoped(req, id);
    const item = await db.transaction(async (tx) => {
      const [row] = await tx.update(items).set(body).where(eq(items.id, id)).returning();
      await audit(tx, req, { action: 'INPUT_ITEM_UPDATE', entity: 'InputItem', entityId: id, amcosId: before.amcosId, before, after: row });
      return row;
    });
    res.json({ item });
  }),
);

// ------------------------------ BEI KWA MSIMU ------------------------------
inputsRouter.get(
  '/prices',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const season = seasonId ? { id: seasonId } : await currentSeason();
    if (!season) throw notFound('Msimu');
    const rows = await db
      .select({ price: prices, item: { id: items.id, name: items.name, unit: items.unit, category: items.category } })
      .from(prices).innerJoin(items, eq(items.id, prices.inputItemId))
      .where(and(amcosScope(req, prices.amcosId), eq(prices.seasonId, season.id)))
      .orderBy(asc(items.name));
    res.json({ data: rows.map((r) => ({ ...r.price, item: r.item })) });
  }),
);

// Weka au badilisha bei. Bei mpya haiathiri pembejeo zilizokwisha tolewa (kila issue inahifadhi bei yake).
inputsRouter.put(
  '/prices',
  requireAmcosPerm('prices.manage'),
  ah(async (req, res) => {
    const body = z.object({ seasonId: z.string().uuid().optional(), inputItemId: z.string().uuid(), unitPrice: decimalSchema({ min: 0.01 }).optional(), unitPriceUsd: decimalSchema({ min: 0.0001 }).optional() }).parse(req.body);
    const item = await findItemScoped(req, body.inputItemId);
    const season = await resolveOpenSeason(body.seasonId);
    // Chama cha USD: bei ni ya dola; TSh inayohifadhiwa ni ya kiwango cha leo (kwa taarifa tu — ugawaji unatumia kiwango cha siku ya ugawaji)
    const usdMode = (await inputCurrency(db, item.amcosId)) === 'USD';
    let unitPrice: string, unitPriceUsd: string | null = null;
    if (usdMode) {
      if (!body.unitPriceUsd) throw badRequest('Chama hiki kinakopesha pembejeo kwa dola — weka bei kwa USD');
      unitPriceUsd = D(body.unitPriceUsd).toFixed(4);
      unitPrice = fmt2(toTzs(unitPriceUsd, await requireRate(db, item.amcosId)));
    } else {
      if (!body.unitPrice) throw badRequest('Weka bei kwa TSh');
      unitPrice = body.unitPrice;
    }
    const before = await db.query.inputPrices.findFirst({ where: and(eq(prices.seasonId, season.id), eq(prices.inputItemId, item.id)) });
    const price = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(prices)
        .values({ amcosId: item.amcosId, seasonId: season.id, inputItemId: item.id, unitPrice, unitPriceUsd })
        .onConflictDoUpdate({ target: [prices.seasonId, prices.inputItemId], set: { unitPrice, unitPriceUsd, updatedAt: new Date() } })
        .returning();
      await audit(tx, req, { action: 'INPUT_PRICE_SET', entity: 'InputPrice', entityId: row.id, amcosId: item.amcosId, before, after: row });
      return row;
    });
    res.json({ price });
  }),
);

// ------------------------------ STOO ------------------------------
inputsRouter.get(
  '/stock',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const season = seasonId ? { id: seasonId } : await currentSeason();
    if (!season) throw notFound('Msimu');
    const sumIf = (t: (typeof schema.stockMovementTypeEnum.enumValues)[number]) =>
      sql<string>`coalesce(sum(${moves.quantity}) filter (where ${moves.type} = ${t}), 0)`;
    const rows = await db
      .select({
        inputItemId: moves.inputItemId,
        name: items.name,
        unit: items.unit,
        received: sumIf('RECEIPT'),
        issued: sql<string>`abs(coalesce(sum(${moves.quantity}) filter (where ${moves.type} = 'ISSUE'), 0))`,
        returned: sumIf('RETURN'),
        adjusted: sumIf('ADJUSTMENT'),
        damaged: sql<string>`abs(coalesce(sum(${moves.quantity}) filter (where ${moves.type} = 'DAMAGE'), 0))`,
        expired: sql<string>`abs(coalesce(sum(${moves.quantity}) filter (where ${moves.type} = 'EXPIRY'), 0))`,
        balance: sql<string>`coalesce(sum(${moves.quantity}), 0)`,
        reorderLevel: items.reorderLevel,
        low: sql<boolean>`${items.reorderLevel} is not null and coalesce(sum(${moves.quantity}), 0) <= ${items.reorderLevel}`,
      })
      .from(moves).innerJoin(items, eq(items.id, moves.inputItemId))
      .where(and(amcosScope(req, moves.amcosId), eq(moves.seasonId, season.id)))
      .groupBy(moves.inputItemId, items.name, items.unit, items.reorderLevel)
      .orderBy(asc(items.name));
    res.json({ data: rows });
  }),
);

inputsRouter.get(
  '/stock/movements',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({ seasonId: z.string().uuid().optional(), inputItemId: z.string().uuid().optional() }).parse(req.query);
    const where = and(
      amcosScope(req, moves.amcosId),
      q.seasonId ? eq(moves.seasonId, q.seasonId) : undefined,
      q.inputItemId ? eq(moves.inputItemId, q.inputItemId) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(moves).where(where).orderBy(desc(moves.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(moves).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

const stockBody = z.object({
  seasonId: z.string().uuid().optional(),
  inputItemId: z.string().uuid(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

// =====================================================================
//  KUINGIZA PEMBEJEO STOO — NJIA MOJA TU
//   Stokipa anaingiza mzigo (bidhaa iliyopo AU mpya; wa kawaida AU wa ombi la manunuzi lililoidhinishwa)
//   pamoja na idadi na bei ya kumkopesha mkulima -> Meneja anaidhinisha idadi na bei
//   -> ndipo stoo inaongezeka na pembejeo zinaweza kutolewa kwa wakulima.
// =====================================================================
const PRQ = schema.purchaseRequests;
const PRL = schema.purchaseRequestLines;
const APR = schema.approvalRequests;

/** Kiasi cha mstari wa manunuzi kinachosubiri idhini kwenye mizigo mingine. */
async function pendingOnLine(lineId: string) {
  const [r] = await db.select({ v: sql<string>`coalesce(sum((${APR.payload}->>'quantity')::numeric), 0)` }).from(APR)
    .where(and(eq(APR.type, 'STOCK_RECEIPT'), eq(APR.status, 'PENDING'), sql`${APR.payload}->>'purchaseLineId' = ${lineId}`));
  return D(r.v);
}

inputsRouter.post(
  '/stock/receipts',
  requireAmcosPerm('stock.receive'),
  ah(async (req, res) => {
    const body = z.object({
      seasonId: z.string().uuid().optional(),
      inputItemId: z.string().uuid().nullable().optional(),             // bidhaa iliyopo
      newItem: itemBody.nullable().optional(),                          // AU bidhaa mpya (inasajiliwa Meneja akiidhinisha)
      purchaseLineId: z.string().uuid().nullable().optional(),          // mzigo wa ombi la manunuzi lililoidhinishwa
      quantity: decimalSchema({ min: 0.01 }),
      reference: z.string().trim().min(2, 'Weka namba ya hati ya mzigo (delivery note)'),
      unitPrice: decimalSchema({ min: 0.01 }).nullable().optional(),    // bei ya kumkopesha mkulima (kwa kipimo kimoja)
      unitCost: decimalSchema({ min: 0 }).nullable().optional(),        // gharama ya chama (hiari)
      unitPriceUsd: decimalSchema({ min: 0.0001 }).nullable().optional(), // chama cha USD: bei ya mkulima kwa dola
      unitCostUsd: decimalSchema({ min: 0 }).nullable().optional(),       // chama cha USD: gharama kwa dola
      source: z.string().trim().nullable().optional(),                  // mf. Chama Kikuu, mzabuni
      batchNo: z.string().trim().nullable().optional(),
      expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      supplierId: z.string().uuid().nullable().optional(),
      notes: z.string().trim().optional(),
    }).parse(req.body);
    const amcosId = await resolveWriteAmcosId(req);
    const season = await resolveOpenSeason(body.seasonId);

    // 1) Chanzo: ombi la manunuzi (bidhaa na gharama zinatoka kwenye ombi)
    let pr: typeof PRQ.$inferSelect | null = null;
    let line: typeof PRL.$inferSelect | null = null;
    if (body.purchaseLineId) {
      [line] = await db.select().from(PRL).where(eq(PRL.id, body.purchaseLineId));
      if (!line) throw notFound('Mstari wa ombi la manunuzi');
      [pr] = await db.select().from(PRQ).where(and(eq(PRQ.id, line.purchaseRequestId), eq(PRQ.amcosId, amcosId)));
      if (!pr) throw notFound('Ombi la manunuzi');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(pr.status)) throw badRequest(pr.status === 'PENDING_APPROVAL' ? 'Ombi hili la manunuzi bado halijaidhinishwa na Meneja' : 'Mzigo wa ombi hili hauwezi kupokelewa');
      const left = D(line.quantity).minus(line.receivedQty).minus(await pendingOnLine(line.id));
      if (D(body.quantity).gt(left)) throw badRequest(`Kiasi kinazidi kilichobaki kupokelewa kwenye ombi ${pr.prNo} (${fmt2(left)})`);
    }

    // 2) Bidhaa: iliyopo au mpya
    let item: typeof items.$inferSelect | null = null;
    const itemId = line?.inputItemId ?? body.inputItemId ?? null;
    if (itemId) {
      item = await findItemScoped(req, itemId);
      if (!item.isActive) throw badRequest('Bidhaa hii imesitishwa');
    } else if (body.newItem) {
      const [dup] = await db.select({ id: items.id }).from(items).where(and(eq(items.amcosId, amcosId), sql`lower(${items.name}) = lower(${body.newItem.name})`));
      if (dup) throw conflict('Bidhaa yenye jina hili tayari ipo — ichague kwenye orodha');
      const [pend] = await db.select({ id: APR.id }).from(APR).where(and(eq(APR.amcosId, amcosId), eq(APR.type, 'STOCK_RECEIPT'), eq(APR.status, 'PENDING'),
        sql`lower(${APR.payload}->'newItem'->>'name') = lower(${body.newItem.name})`));
      if (pend) throw conflict('Bidhaa mpya yenye jina hili tayari inasubiri idhini');
    } else throw badRequest('Chagua bidhaa au andika bidhaa mpya');

    const current = item ? await db.query.inputPrices.findFirst({ where: and(eq(prices.seasonId, season.id), eq(prices.inputItemId, item.id)) }) : undefined;
    const usdMode = (await inputCurrency(db, amcosId)) === 'USD';
    let unitPrice: string, unitPriceUsd: string | null = null, unitCostUsd: string | null = null, rate: ReturnType<typeof D> | null = null;
    if (usdMode) {
      rate = await requireRate(db, amcosId);
      const pUsd = body.unitPriceUsd ?? current?.unitPriceUsd ?? null;
      if (!pUsd) throw badRequest('Weka bei ya kumkopesha mkulima kwa USD');
      unitPriceUsd = D(pUsd).toFixed(4);
      unitPrice = fmt2(toTzs(unitPriceUsd, rate));
      unitCostUsd = line?.unitCostUsd ?? (body.unitCostUsd != null ? D(body.unitCostUsd).toFixed(4) : null);
    } else {
      if (!body.unitPrice && !current) throw badRequest('Weka bei ya kumkopesha mkulima');
      unitPrice = body.unitPrice ?? current!.unitPrice;
    }
    if (item) {
      const [dup] = await db.select({ id: APR.id }).from(APR).where(and(eq(APR.amcosId, amcosId), eq(APR.type, 'STOCK_RECEIPT'), eq(APR.status, 'PENDING'),
        eq(APR.entityId, item.id), sql`${APR.payload}->>'reference' = ${body.reference}`));
      if (dup) throw conflict('Mzigo wa hati hii tayari unasubiri idhini');
    }
    const name = item?.name ?? body.newItem!.name;
    const unit = item?.unit ?? body.newItem!.unit;
    // Mzigo wa ombi la manunuzi: gharama ni ya ombi (TSh kwa kiwango cha ombi) ili deni la mzabuni lilingane na ombi
    const unitCost = line?.unitCost ?? (unitCostUsd && rate ? fmt2(toTzs(unitCostUsd, rate)) : body.unitCost ?? null);
    const source = pr ? `Manunuzi ${pr.prNo}` : body.source ?? null;
    const approval = await db.transaction(async (tx) => {
      const a = await createApproval(tx, req, {
        amcosId, type: 'STOCK_RECEIPT', entityType: 'InputItem', entityId: item?.id, amount: fmt2(D(body.quantity).times(unitPrice)),
        title: usdMode
          ? `${item ? 'Mzigo' : 'Bidhaa mpya na mzigo'}: ${name} — ${body.quantity} ${unit.toLowerCase()} × $${D(unitPriceUsd!).toFixed()}${current?.unitPriceUsd && D(current.unitPriceUsd).toFixed(4) !== unitPriceUsd ? ` (bei ya sasa $${D(current.unitPriceUsd).toFixed()})` : ''}`
          : `${item ? 'Mzigo' : 'Bidhaa mpya na mzigo'}: ${name} — ${body.quantity} ${unit.toLowerCase()} × ${tshText(unitPrice)}${current && current.unitPrice !== unitPrice ? ` (bei ya sasa ${tshText(current.unitPrice)})` : ''}`,
        reason: [source && `Kutoka: ${source}`, `Hati: ${body.reference}`, body.notes].filter(Boolean).join(' · '),
        payload: {
          inputItemId: item?.id ?? null, newItem: item ? null : body.newItem, itemName: name, unit, seasonId: season.id, quantity: body.quantity, unitPrice,
          currentPrice: current?.unitPrice ?? null, unitCost, unitPriceUsd, unitCostUsd, currentPriceUsd: current?.unitPriceUsd ?? null, reference: body.reference, source, batchNo: body.batchNo ?? null, expiryDate: body.expiryDate ?? null,
          supplierId: pr?.supplierId ?? body.supplierId ?? null, purchaseRequestId: pr?.id ?? null, purchaseLineId: line?.id ?? null, prNo: pr?.prNo ?? null, notes: body.notes ?? null,
        },
      });
      await audit(tx, req, { action: 'STOCK_RECEIPT_REQUEST', entity: 'InputItem', entityId: item?.id ?? null, amcosId, after: { approval: a.requestNo, item: name, quantity: body.quantity, unitPrice, purchase: pr?.prNo ?? null } });
      return a;
    });
    res.status(202).json({ approval });
  }),
);



// Marekebisho ya stoo: Stokipa ANAOMBA, Meneja anaidhinisha. Stoo HAIBADILIKI kabla ya idhini.
//   kind: ADJUSTMENT (hesabu), DAMAGE (zimeharibika), EXPIRY (muda umeisha)
const ADJ_LABEL = { ADJUSTMENT: 'Marekebisho', DAMAGE: 'Zimeharibika', EXPIRY: 'Muda umeisha' } as const;
inputsRouter.post(
  '/stock/adjustments',
  requireAmcosPerm('stock.adjust.request'),
  ah(async (req, res) => {
    const body = stockBody.extend({
      quantity: decimalSchema({ allowNegative: true }),
      kind: z.enum(['ADJUSTMENT', 'DAMAGE', 'EXPIRY']).default('ADJUSTMENT'),
      batchNo: z.string().trim().nullable().optional(),
      notes: z.string().trim().min(5, 'Eleza sababu ya marekebisho'),
    }).parse(req.body);
    if (D(body.quantity).isZero()) throw badRequest('Kiasi hakiwezi kuwa sifuri');
    if (body.kind !== 'ADJUSTMENT' && D(body.quantity).isPos()) throw badRequest('Bidhaa zilizoharibika/kuisha muda zinapunguza stoo (kiasi hasi)');
    const item = await findItemScoped(req, body.inputItemId);
    const season = await resolveOpenSeason(body.seasonId);
    const bal = await stockBalance(db, item.amcosId, season.id, item.id);
    if (bal.plus(body.quantity).isNeg()) throw badRequest(`Stoo haitoshi. Salio ni ${fmt2(bal)}`);
    const approval = await db.transaction((tx) => createApproval(tx, req, {
      amcosId: item.amcosId, type: 'STOCK_ADJUSTMENT', entityType: 'InputItem', entityId: item.id,
      title: `${ADJ_LABEL[body.kind]}: ${item.name} ${D(body.quantity).isPos() ? '+' : ''}${body.quantity}`,
      reason: body.notes,
      payload: { inputItemId: item.id, seasonId: season.id, quantity: body.quantity, kind: body.kind, batchNo: body.batchNo ?? null, reference: body.reference ?? null, balanceAtRequest: fmt2(bal) },
    }));
    res.status(202).json({ approval, message: 'Ombi limetumwa kwa Meneja. Stoo itabadilika baada ya idhini.' });
  }),
);

// ------------------------------ KUTOA PEMBEJEO KWA MKOPO ------------------------------
async function loadIssue(id: string) {
  return db.query.inputIssues.findFirst({
    where: eq(issues.id, id),
    with: {
      lines: { with: { inputItem: { columns: { id: true, name: true, unit: true } } } },
      member: { columns: { id: true, memberNo: true, firstName: true, lastName: true } },
    },
  });
}

inputIssuesRouter.get(
  '/',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const q = paginationQuery
      .extend({ seasonId: z.string().uuid().optional(), memberId: z.string().uuid().optional(), status: z.enum(schema.inputIssueStatusEnum.enumValues).optional() })
      .parse(req.query);
    const where = and(
      amcosScope(req, issues.amcosId),
      q.seasonId ? eq(issues.seasonId, q.seasonId) : undefined,
      q.memberId ? eq(issues.memberId, q.memberId) : undefined,
      q.status ? eq(issues.status, q.status) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select({
        issue: issues,
        member: { id: schema.members.id, memberNo: schema.members.memberNo, firstName: schema.members.firstName, lastName: schema.members.lastName },
      })
        .from(issues).innerJoin(schema.members, eq(schema.members.id, issues.memberId))
        .where(where).orderBy(desc(issues.issuedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(issues).where(where),
    ]);
    res.json(paged(rows.map((r) => ({ ...r.issue, member: r.member })), total, q.page, q.pageSize));
  }),
);

inputIssuesRouter.get(
  '/:id',
  requireAmcosPerm('stock.read'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const [scoped] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.id, id), amcosScope(req, issues.amcosId)));
    if (!scoped) throw notFound('Utoaji wa pembejeo');
    res.json({ issue: await loadIssue(id) });
  }),
);

// Stokipa anaandaa ugawaji -> unasubiri idhini ya Meneja. Stoo na deni la mkulima vinabadilika BAADA ya idhini.
inputIssuesRouter.post(
  '/',
  requireAmcosPerm('issues.request'),
  ah(async (req, res) => {
    const body = z
      .object({
        memberId: z.string().uuid(),
        seasonId: z.string().uuid().optional(),
        notes: z.string().trim().optional(),
        // Kutoka app ya offline: kitambulisho cha kipekee ili ikituma mara mbili isirekodiwe mara mbili
        clientRef: z.string().trim().min(8).max(64).optional(),
        lines: z
          .array(z.object({ inputItemId: z.string().uuid(), quantity: decimalSchema({ min: 0.01 }) }))
          .min(1, 'Ongeza angalau pembejeo moja')
          .max(30),
      })
      .parse(req.body);

    const member = await findMemberScoped(req, body.memberId);
    if (member.status !== 'ACTIVE') throw badRequest('Mwanachama hayuko hai (ACTIVE)');
    const amcosId = member.amcosId;

    if (body.clientRef) {
      const dup = await db.query.inputIssues.findFirst({ where: and(eq(issues.amcosId, amcosId), eq(issues.clientRef, body.clientRef)) });
      if (dup) return res.status(200).json({ issue: await loadIssue(dup.id), duplicate: true });
    }

    const itemIds = body.lines.map((l) => l.inputItemId);
    if (new Set(itemIds).size !== itemIds.length) throw badRequest('Pembejeo moja imerudiwa — unganisha kiasi kwenye mstari mmoja');

    const season = await resolveOpenSeason(body.seasonId);
    const itemRows = await db.select().from(items).where(and(eq(items.amcosId, amcosId), inArray(items.id, itemIds)));
    if (itemRows.length !== itemIds.length) throw badRequest('Baadhi ya pembejeo hazipo kwenye chama hiki');
    const inactive = itemRows.find((i) => !i.isActive);
    if (inactive) throw badRequest(`${inactive.name} imesitishwa`);

    const priceRows = await db.select().from(prices).where(and(eq(prices.seasonId, season.id), inArray(prices.inputItemId, itemIds)));
    // Chama cha USD: deni ni la dola (bei ya dola x idadi); TSh = dola x kiwango cha leo (kinahifadhiwa kwenye ugawaji)
    const usdMode = (await inputCurrency(db, amcosId)) === 'USD';
    const rate = usdMode ? await requireRate(db, amcosId) : null;
    const priceOf = new Map(priceRows.filter((p) => !usdMode || p.unitPriceUsd).map((p) => [p.inputItemId, p]));
    const missing = itemRows.filter((i) => !priceOf.has(i.id)).map((i) => i.name);
    if (missing.length) throw badRequest(`Bei ${usdMode ? 'ya dola ' : ''}haijawekwa kwa msimu huu: ${missing.join(', ')}`);

    const lines = body.lines.map((l) => {
      const p = priceOf.get(l.inputItemId)!;
      if (rate) {
        const amountUsd = D(l.quantity).times(p.unitPriceUsd!).toDecimalPlaces(2);
        const amount = toTzs(amountUsd, rate);
        return { ...l, unitPriceUsd: p.unitPriceUsd, amountUsd: fmt2(amountUsd), unitPrice: fmt2(amount.div(l.quantity)), amount: fmt2(amount) };
      }
      return { ...l, unitPriceUsd: null as string | null, amountUsd: null as string | null, unitPrice: p.unitPrice, amount: fmt2(D(l.quantity).times(p.unitPrice)) };
    });
    const total = fmt2(lines.reduce((s, l) => s.plus(l.amount), D(0)));
    const totalUsd = rate ? fmt2(lines.reduce((s, l) => s.plus(l.amountUsd ?? 0), D(0))) : null;
    const nameOf = new Map(itemRows.map((i) => [i.id, i.name]));

    const issueId = await db.transaction(async (tx) => {
      await lockItems(tx, amcosId, itemIds);
      for (const l of lines) {
        const bal = await stockBalance(tx, amcosId, season.id, l.inputItemId);
        if (bal.lessThan(l.quantity)) {
          throw new AppError(400, 'INSUFFICIENT_STOCK', `Stoo haitoshi: ${nameOf.get(l.inputItemId)} (salio ${fmt2(bal)})`);
        }
      }
      if (body.clientRef) {
        const dup = await tx.query.inputIssues.findFirst({ where: and(eq(issues.amcosId, amcosId), eq(issues.clientRef, body.clientRef)) });
        if (dup) return dup.id;
      }

      const amcos = (await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
      const n = await nextNumber(tx, amcosId, 'input_issue');
      const grp = (await activeGroups(tx, [member.id])).get(member.id);
      const [issue] = await tx.insert(issues).values({
        groupId: grp?.groupId ?? null,
        amcosId, seasonId: season.id, memberId: member.id, issueNo: `${amcos.code}-P-${pad(n)}`,
        totalAmount: total, notes: body.notes, clientRef: body.clientRef, issuedById: req.auth!.userId, status: 'PENDING_APPROVAL',
        currency: rate ? 'USD' : 'TZS', fxRate: rate ? rate.toFixed(4) : null, totalUsd,
      }).returning();

      await tx.insert(schema.inputIssueLines).values(lines.map((l) => ({ inputIssueId: issue.id, ...l })));
      await audit(tx, req, { action: 'INPUT_ISSUE_REQUEST', entity: 'InputIssue', entityId: issue.id, amcosId, after: { ...issue, lines } });
      const approval = await createApproval(tx, req, {
        amcosId, type: 'INPUT_ISSUE', entityType: 'InputIssue', entityId: issue.id, amount: total,
        title: `Pembejeo kwa ${member.firstName} ${member.lastName} (${member.memberNo}): ${lines.map((l) => `${nameOf.get(l.inputItemId)} x${l.quantity}`).join(', ')}${totalUsd ? ` — $${totalUsd} (kiwango ${rate!.toFixed()})` : ''}`,
        reason: body.notes ?? null,
      });
      await tx.update(issues).set({ approvalId: approval.id }).where(eq(issues.id, issue.id));
      return issue.id;
    });

    res.status(201).json({ issue: await loadIssue(issueId) });
  }),
);

// Kufuta utoaji: stoo inarudi + deni linafutwa kwa REVERSAL (historia inabaki)
inputIssuesRouter.post(
  '/:id/cancel',
  requireAmcosPerm('issues.cancel'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Eleza sababu ya kufuta') }).parse(req.body);
    const [issue] = await db.select().from(issues).where(and(eq(issues.id, id), amcosScope(req, issues.amcosId)));
    if (!issue) throw notFound('Utoaji wa pembejeo');
    if (issue.status === 'CANCELLED') throw conflict('Tayari imefutwa');
    if (issue.status !== 'ISSUED') throw badRequest('Ugawaji huu haujakamilika. Ombi linalosubiri idhini linakataliwa/kuondolewa kupitia Idhini');
    const season = await db.query.seasons.findFirst({ where: eq(schema.seasons.id, issue.seasonId) });
    if (season?.status === 'CLOSED') throw badRequest('Msimu umefungwa');

    await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(issues)
        .set({ status: 'CANCELLED', cancelledById: req.auth!.userId, cancelledAt: new Date(), cancelReason: reason })
        .where(and(eq(issues.id, id), eq(issues.status, 'ISSUED')))
        .returning();
      if (!upd) throw conflict('Imebadilishwa na mtu mwingine, jaribu tena');

      const lines = await tx.select().from(schema.inputIssueLines).where(eq(schema.inputIssueLines.inputIssueId, id));
      await tx.insert(moves).values(lines.map((l) => ({
        amcosId: issue.amcosId, seasonId: issue.seasonId, inputItemId: l.inputItemId, type: 'RETURN' as const,
        quantity: l.quantity, reference: issue.issueNo, inputIssueId: id, notes: `Kufutwa: ${reason}`, createdById: req.auth!.userId,
      })));

      const entries = await tx.select().from(schema.memberLedgerEntries).where(and(
        eq(schema.memberLedgerEntries.referenceType, 'INPUT_ISSUE'),
        eq(schema.memberLedgerEntries.referenceId, id),
        eq(schema.memberLedgerEntries.type, 'INPUT_LOAN'),
      ));
      for (const e of entries) {
        await ledger.reverse(tx, e.id, `Kufutwa kwa ${issue.issueNo}: ${reason}`, req.auth!.userId);
      }
      // Deni la dola linafutwa kwa kiasi kile kile kilichoandikwa siku ya ugawaji
      if (issue.currency === 'USD' && issue.totalUsd) {
        await recordUsd(tx, { amcosId: issue.amcosId, memberId: issue.memberId, seasonId: issue.seasonId, kind: 'CANCEL', usd: D(issue.totalUsd).neg(), tzs: D(issue.totalAmount).neg(), rate: issue.fxRate,
          description: `Kufutwa kwa ${issue.issueNo}`, referenceType: 'INPUT_ISSUE', referenceId: id, createdById: req.auth!.userId });
      }
      await audit(tx, req, { action: 'INPUT_ISSUE_CANCEL', entity: 'InputIssue', entityId: id, amcosId: issue.amcosId, before: issue, after: { ...upd, reason } });
    });
    res.json({ issue: await loadIssue(id) });
  }),
);
