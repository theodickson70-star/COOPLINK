// =====================================================================
//  IDHINI (APPROVAL WORKFLOW) — kila ombi linalohitaji uamuzi wa Meneja
//   1. Mtumishi anaandaa ombi  -> approval_requests (PENDING), rekodi husika inasubiri
//   2. Meneja anaidhinisha/anakataa kwa maelezo -> handler ya aina hiyo inatekeleza
//   3. Uamuzi hauwezi kubadilishwa (trigger kwenye database); kila hatua ina audit log
//  Sheria: hakuna anayeidhinisha ombi alilolianzisha mwenyewe.
// =====================================================================
import type { Request } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { AppError, badRequest, conflict, forbidden, notFound } from './errors';
import { audit } from './audit';
import { missingRoles } from './amcos-permissions';
import { currentRate, recordUsd, toTzs } from './fx';
import { nextNumber, pad } from './counter';
import { D, fmt2 } from './money';
import * as ledger from './ledger';
import { lockItems, stockBalance } from './stock';
import { nextTxnNo } from './finance';
import { assertManualAllowed, glMap, postJournal } from './gl';
import { onPaymentBatch, onTobaccoSale } from './tobacco';
import { onPayroll } from './payroll';
import { onAssetDisposal } from './assets';
import { onOpeningBalance, onPeriodClose, onYearEndClose } from './closing';
import { onGroupChange, onGroupRegistration } from './groups';
import { today as darToday } from './subscriptions';  // tarehe ya Tanzania, si UTC
import { onKuniBatch, reverseKuniPayment } from './kuni';

type ApprovalType = (typeof schema.approvalTypeEnum.enumValues)[number];
type Approval = typeof schema.approvalRequests.$inferSelect;
const A = schema.approvalRequests;

export const APPROVAL_LABEL: Record<ApprovalType, string> = {
  MEMBER_REGISTRATION: 'Usajili wa mkulima',
  EXPENSE: 'Matumizi',
  FARMER_PAYMENT: 'Malipo kwa mkulima',
  SUPPLIER_PAYMENT: 'Malipo kwa mzabuni',
  PURCHASE: 'Manunuzi',
  STOCK_ADJUSTMENT: 'Marekebisho ya stoo',
  INPUT_ISSUE: 'Ugawaji wa pembejeo',
  REVERSAL: 'Kusahihisha muamala (reversal)',
  JOURNAL: 'Journal ya daftari kuu',
  TOBACCO_SALE: 'Mauzo ya tumbaku na makato',
  PAYMENT_BATCH: 'Orodha ya malipo ya wakulima',
  TRANSFER: 'Uhamisho kati ya akaunti',
  PAYROLL: 'Mishahara',
  ASSET_DISPOSAL: 'Kuondoa mali ya chama',
  OPENING_BALANCE: 'Salio la kuanzia',
  PERIOD_CLOSE: 'Kufunga kipindi',
  YEAR_END_CLOSE: 'Kufunga mwaka wa fedha',
  STOCK_RECEIPT: 'Mzigo wa pembejeo (idadi na bei)',
  GROUP_REGISTRATION: 'Usajili wa kikundi cha wakulima',
  GROUP_CHANGE: 'Mabadiliko ya wanakikundi',
  KUNI_BATCH: 'Pesa ya kuni (mikopo ya wakulima)',
};

/** Marekebisho ya Meneja wakati wa kuidhinisha mzigo wa pembejeo (idadi na bei). */
export interface ReceiptChanges { quantity?: string; unitPrice?: string }

export async function createApproval(tx: Tx, req: Request, a: {
  amcosId: string; type: ApprovalType; title: string; amount?: string | null; entityType?: string; entityId?: string;
  payload?: unknown; reason?: string | null;
}) {
  const n = await nextNumber(tx, a.amcosId, 'approval');
  const [row] = await tx.insert(A).values({
    amcosId: a.amcosId, requestNo: `IDH-${pad(n)}`, type: a.type, title: a.title, amount: a.amount ?? null,
    entityType: a.entityType, entityId: a.entityId, payload: a.payload ?? null, reason: a.reason ?? null,
    requestedById: req.auth!.userId, requestedRole: req.auth!.role,
  }).returning();
  await audit(tx, req, { action: 'APPROVAL_REQUEST', entity: 'ApprovalRequest', entityId: row.id, amcosId: a.amcosId, after: row });
  return row;
}

async function lockPending(tx: Tx, id: string) {
  const [row] = await tx.select().from(A).where(eq(A.id, id)).for('update');
  if (!row) throw notFound('Ombi');
  if (row.status !== 'PENDING') throw conflict('Ombi hili tayari limeshughulikiwa');
  return row;
}

async function closeApproval(tx: Tx, req: Request, a: Approval, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', note: string) {
  const [row] = await tx.update(A).set({
    status, decidedById: req.auth!.userId, decidedRole: req.auth!.role, decidedAt: new Date(), decisionNote: note,
  }).where(and(eq(A.id, a.id), eq(A.status, 'PENDING'))).returning();
  if (!row) throw conflict('Ombi limebadilishwa na mtu mwingine, jaribu tena');
  await audit(tx, req, {
    action: `APPROVAL_${status}`, entity: 'ApprovalRequest', entityId: a.id, amcosId: a.amcosId,
    before: { status: 'PENDING' }, after: { status, note, type: a.type, requestNo: a.requestNo, entityType: a.entityType, entityId: a.entityId },
  });
  return row;
}

// ------------------------------ HANDLERS ------------------------------
type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';

async function onMember(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const m = schema.members;
  const status = o === 'APPROVED' ? 'ACTIVE' : 'EXITED';
  const [row] = await tx.update(m).set({ status }).where(and(eq(m.id, a.entityId!), eq(m.status, 'PENDING'))).returning();
  if (!row) throw conflict('Mkulima huyu hasubiri tena uthibitisho');
  // Jina tofauti na mwenye namba: Meneja akiidhinisha usajili, anaidhinisha pia jina hilo
  if (o === 'APPROVED' && row.nameOverrideReason && !row.nameOverrideById) {
    await tx.update(m).set({ nameOverrideById: req.auth!.userId, nameOverrideAt: new Date() }).where(eq(m.id, row.id));
  }
  await audit(tx, req, { action: o === 'APPROVED' ? 'MEMBER_CONFIRM' : 'MEMBER_REGISTRATION_REJECT', entity: 'Member', entityId: row.id, amcosId: a.amcosId, before: { status: 'PENDING' }, after: { status, note } });
}

async function onFinanceTxn(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const T = schema.financeTransactions;
  const status = o === 'APPROVED' ? 'APPROVED' : o === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
  const [row] = await tx.update(T).set({ status }).where(and(eq(T.id, a.entityId!), eq(T.status, 'PENDING_APPROVAL'))).returning();
  if (!row) throw conflict('Muamala huu hausubiri tena idhini');
  await audit(tx, req, { action: `FINANCE_TXN_${status}`, entity: 'FinanceTransaction', entityId: row.id, amcosId: a.amcosId, before: { status: 'PENDING_APPROVAL' }, after: { status, note } });
}

async function onPurchase(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const P = schema.purchaseRequests;
  const status = o === 'APPROVED' ? 'APPROVED' : o === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
  const [row] = await tx.update(P).set({ status }).where(and(eq(P.id, a.entityId!), eq(P.status, 'PENDING_APPROVAL'))).returning();
  if (!row) throw conflict('Ombi hili la manunuzi halisubiri tena idhini');
  await audit(tx, req, { action: `PURCHASE_${status}`, entity: 'PurchaseRequest', entityId: row.id, amcosId: a.amcosId, before: { status: 'PENDING_APPROVAL' }, after: { status, note } });
}

interface AdjustPayload { inputItemId: string; seasonId: string; quantity: string; kind: 'ADJUSTMENT' | 'DAMAGE' | 'EXPIRY'; batchNo?: string | null; reference?: string | null }

async function onStockAdjustment(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return; // stoo haibadiliki bila idhini
  const p = a.payload as AdjustPayload;
  const season = await tx.query.seasons.findFirst({ where: eq(schema.seasons.id, p.seasonId) });
  if (!season || season.status === 'CLOSED') throw badRequest('Msimu wa marekebisho haya umefungwa');
  await lockItems(tx, a.amcosId, [p.inputItemId]);
  const bal = await stockBalance(tx, a.amcosId, p.seasonId, p.inputItemId);
  if (bal.plus(p.quantity).isNeg()) throw new AppError(400, 'INSUFFICIENT_STOCK', `Stoo haitoshi kwa marekebisho haya. Salio la sasa ni ${fmt2(bal)}`);
  const [mv] = await tx.insert(schema.stockMovements).values({
    amcosId: a.amcosId, seasonId: p.seasonId, inputItemId: p.inputItemId, type: p.kind, quantity: p.quantity,
    reference: p.reference ?? a.requestNo, batchNo: p.batchNo ?? null, notes: `${a.reason ?? ''} · Idhini: ${note}`.trim(),
    approvalId: a.id, createdById: a.requestedById,
  }).returning();
  await audit(tx, req, { action: 'STOCK_ADJUSTMENT_APPLIED', entity: 'StockMovement', entityId: mv.id, amcosId: a.amcosId, before: { balance: fmt2(bal) }, after: { ...mv, balance: fmt2(bal.plus(p.quantity)) } });
}

async function onInputIssue(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const I = schema.inputIssues;
  const issue = await tx.query.inputIssues.findFirst({ where: eq(I.id, a.entityId!) });
  if (!issue || issue.status !== 'PENDING_APPROVAL') throw conflict('Ugawaji huu hausubiri tena idhini');
  if (o !== 'APPROVED') {
    const status = o === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
    await tx.update(I).set({ status, cancelledById: req.auth!.userId, cancelledAt: new Date(), cancelReason: note }).where(eq(I.id, issue.id));
    await audit(tx, req, { action: `INPUT_ISSUE_${status}`, entity: 'InputIssue', entityId: issue.id, amcosId: a.amcosId, before: { status: issue.status }, after: { status, note } });
    return;
  }
  const season = await tx.query.seasons.findFirst({ where: eq(schema.seasons.id, issue.seasonId) });
  if (!season || season.status === 'CLOSED') throw badRequest('Msimu umefungwa');
  const member = await tx.query.members.findFirst({ where: eq(schema.members.id, issue.memberId) });
  if (member?.status !== 'ACTIVE') throw badRequest('Mkulima hayuko hai (ACTIVE) — haiwezekani kumpa pembejeo');
  const lines = await tx.query.inputIssueLines.findMany({ where: eq(schema.inputIssueLines.inputIssueId, issue.id), with: { inputItem: { columns: { name: true } } } });
  await lockItems(tx, a.amcosId, lines.map((l) => l.inputItemId));
  for (const l of lines) {
    const bal = await stockBalance(tx, a.amcosId, issue.seasonId, l.inputItemId);
    if (bal.lessThan(l.quantity)) throw new AppError(400, 'INSUFFICIENT_STOCK', `Stoo haitoshi: ${l.inputItem.name} (salio ${fmt2(bal)})`);
  }
  await tx.insert(schema.stockMovements).values(lines.map((l) => ({
    amcosId: a.amcosId, seasonId: issue.seasonId, inputItemId: l.inputItemId, type: 'ISSUE' as const,
    quantity: fmt2(D(l.quantity).neg()), reference: issue.issueNo, inputIssueId: issue.id, approvalId: a.id, createdById: issue.issuedById,
  })));
  await ledger.post(tx, {
    amcosId: a.amcosId, memberId: issue.memberId, seasonId: issue.seasonId, type: 'INPUT_LOAN', debit: issue.totalAmount,
    description: `Pembejeo ${issue.issueNo}: ${lines.map((l) => (l.kg ? `${l.inputItem.name} kilo ${D(l.kg).toFixed()}` : `${l.inputItem.name} x${D(l.quantity).toFixed()}`)).join(', ')}`,
    referenceType: 'INPUT_ISSUE', referenceId: issue.id, createdById: req.auth!.userId,
  });
  // Deni la dola: linaandikwa kwa dola na thamani yake ya TSh kwa kiwango cha siku ya ugawaji
  if (issue.currency === 'USD' && issue.totalUsd) {
    await recordUsd(tx, { amcosId: a.amcosId, memberId: issue.memberId, seasonId: issue.seasonId, kind: 'ISSUE', usd: issue.totalUsd, tzs: issue.totalAmount, rate: issue.fxRate,
      description: `Pembejeo ${issue.issueNo}`, referenceType: 'INPUT_ISSUE', referenceId: issue.id, createdById: req.auth!.userId });
  }
  const [upd] = await tx.update(I).set({ status: 'ISSUED', issuedAt: new Date(), approvalId: a.id, approvedById: req.auth!.userId, approvedAt: new Date() })
    .where(and(eq(I.id, issue.id), eq(I.status, 'PENDING_APPROVAL'))).returning();
  await audit(tx, req, { action: 'INPUT_ISSUE_APPROVED', entity: 'InputIssue', entityId: issue.id, amcosId: a.amcosId, before: { status: issue.status }, after: { status: upd.status, note } });
}

async function onReversal(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const T = schema.financeTransactions;
  const first = await tx.query.financeTransactions.findFirst({ where: eq(T.id, a.entityId!) });
  if (!first || first.status !== 'POSTED' || first.kind === 'REVERSAL') throw conflict('Muamala huu hauwezi kusahihishwa');
  // Uhamisho: pande zote mbili zinasahihishwa pamoja
  const group = first.kind === 'TRANSFER' && first.transferGroupId
    ? await tx.select().from(T).where(and(eq(T.transferGroupId, first.transferGroupId), eq(T.status, 'POSTED'), eq(T.kind, 'TRANSFER')))
    : [first];
  for (const orig of group) await reverseOne(tx, req, a, orig, note);
}

async function reverseOne(tx: Tx, req: Request, a: Approval, orig: typeof schema.financeTransactions.$inferSelect, note: string) {
  const T = schema.financeTransactions;
  const dup = await tx.query.financeTransactions.findFirst({ where: eq(T.reversalOfId, orig.id) });
  if (dup) throw conflict('Muamala huu tayari umesahihishwa');
  const amcos = (await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, a.amcosId) }))!;
  const [rev] = await tx.insert(T).values({
    amcosId: orig.amcosId, seasonId: orig.seasonId, txnNo: await nextTxnNo(tx, a.amcosId, amcos.code), kind: 'REVERSAL',
    direction: orig.direction === 'IN' ? 'OUT' : 'IN', category: orig.category, accountId: orig.accountId, amount: orig.amount,
    txnDate: darToday(), description: `Kusahihisha ${orig.txnNo}: ${a.reason ?? ''}`.trim(),
    reference: orig.txnNo, payee: orig.payee, memberId: orig.memberId, supplierId: orig.supplierId, purchaseRequestId: orig.purchaseRequestId,
    contraGlAccountId: orig.contraGlAccountId, transferGroupId: orig.transferGroupId, marketId: orig.marketId, amountUsd: orig.amountUsd, fxRate: orig.fxRate,
    status: 'POSTED', approvalId: a.id, reversalOfId: orig.id, createdById: a.requestedById, postedById: req.auth!.userId, postedAt: new Date(),
  }).returning();
  const entries = await tx.select().from(schema.memberLedgerEntries).where(and(
    eq(schema.memberLedgerEntries.referenceType, 'FINANCE_TXN'), eq(schema.memberLedgerEntries.referenceId, orig.id),
    sql`${schema.memberLedgerEntries.type} <> 'REVERSAL'`,
  ));
  for (const e of entries) await ledger.reverse(tx, e.id, `Kusahihisha ${orig.txnNo}`, req.auth!.userId);
  // Malipo ya mkulima kutoka orodha ya malipo -> yanarudi kusubiri; mishahara -> inarudi "imeidhinishwa, haijalipwa"
  const P = schema.payments;
  const pays = await tx.update(P).set({ status: 'FAILED', failureReason: `Imesahihishwa (${orig.txnNo})`, financeTxnId: null }).where(eq(P.financeTxnId, orig.id)).returning();
  for (const p of pays) {
    if (p.settlementId) await tx.update(schema.settlements).set({ status: 'APPROVED' }).where(eq(schema.settlements.id, p.settlementId));
    if (p.batchId) await tx.update(schema.paymentBatches).set({ status: 'PARTIAL' }).where(eq(schema.paymentBatches.id, p.batchId));
  }
  await tx.update(schema.payrollRuns).set({ status: 'APPROVED', paidTxnId: null }).where(eq(schema.payrollRuns.paidTxnId, orig.id));
  await reverseKuniPayment(tx, orig.id, req.auth!.userId, orig.txnNo);
  if (orig.category === 'MEMBER_FEES' && orig.memberId) {
    const M = schema.members;
    const [mem] = await tx.update(M).set({ entryFeePaid: false, entryFeePaidAt: null, entryFeeReference: null })
      .where(and(eq(M.id, orig.memberId), eq(M.entryFeeReference, orig.txnNo))).returning({ id: M.id });
    if (mem) await audit(tx, req, { action: 'MEMBER_ENTRY_FEE_REVERSED', entity: 'Member', entityId: mem.id, amcosId: a.amcosId, after: { entryFeePaid: false, reversedTxn: orig.txnNo } });
  }
  await audit(tx, req, { action: 'FINANCE_TXN_REVERSED', entity: 'FinanceTransaction', entityId: orig.id, amcosId: a.amcosId, after: { reversal: rev, note } });
}

interface JournalPayload { date: string; description: string; reference?: string | null; lines: { glAccountId: string; debit?: string; credit?: string; memo?: string | null }[] }

/** Journal ya mkono (marekebisho, salio la kuanzia n.k.) — inaandikwa daftari kuu baada ya idhini tu. */
async function onJournal(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const p = a.payload as JournalPayload;
  const m = await glMap(tx, a.amcosId);
  for (const l of p.lines) {
    const acc = m.byId.get(l.glAccountId);
    if (!acc) throw badRequest('Akaunti ya journal haipo tena');
    assertManualAllowed(acc);
  }
  const entry = await postJournal(tx, {
    amcosId: a.amcosId, date: p.date, description: p.description, source: 'MANUAL', sourceId: a.id, reference: p.reference ?? a.requestNo,
    approvalId: a.id, createdById: a.requestedById, lines: p.lines,
  }, m);
  await audit(tx, req, { action: 'JOURNAL_POSTED', entity: 'JournalEntry', entityId: entry?.id ?? null, amcosId: a.amcosId, after: { entryNo: entry?.entryNo, note } });
}

/** Uhamisho kati ya akaunti za chama: pande mbili zinaidhinishwa pamoja. */
async function onTransfer(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const T = schema.financeTransactions;
  const first = await tx.query.financeTransactions.findFirst({ where: eq(T.id, a.entityId!) });
  if (!first?.transferGroupId) throw conflict('Uhamisho haupo');
  const status = o === 'APPROVED' ? 'APPROVED' : o === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
  const rows = await tx.update(T).set({ status }).where(and(eq(T.transferGroupId, first.transferGroupId), eq(T.status, 'PENDING_APPROVAL'))).returning();
  if (rows.length !== 2) throw conflict('Uhamisho huu hausubiri tena idhini');
  await audit(tx, req, { action: `TRANSFER_${status}`, entity: 'FinanceTransaction', entityId: first.id, amcosId: a.amcosId, after: { status, note } });
}

interface ReceiptPayload {
  inputItemId: string | null; newItem: { name: string; category: (typeof schema.inputCategoryEnum.enumValues)[number]; unit: (typeof schema.inputUnitEnum.enumValues)[number]; reorderLevel?: string | null } | null;
  purchaseRequestId: string | null; purchaseLineId: string | null; prNo: string | null; itemName: string; seasonId: string; quantity: string; unitPrice: string; currentPrice: string | null; unitCost: string | null;
  /** Chama cha USD: bei ya mkulima na gharama kwa dola (unitPrice/unitCost ni TSh kwa kiwango cha siku ya ombi) */
  unitPriceUsd?: string | null; unitCostUsd?: string | null; currentPriceUsd?: string | null;
  reference: string; source: string | null; batchNo: string | null; expiryDate: string | null; supplierId: string | null; notes: string | null;
}

/** Meneja ameidhinisha idadi na bei: stoo inaongezeka na bei ya msimu inawekwa — ndipo pembejeo zinaweza kutolewa. */
async function onStockReceipt(tx: Tx, req: Request, a: Approval, o: Outcome, note: string, changes?: ReceiptChanges) {
  if (o !== 'APPROVED') return;
  const p = a.payload as ReceiptPayload;
  const season = await tx.query.seasons.findFirst({ where: eq(schema.seasons.id, p.seasonId) });
  if (!season || season.status === 'CLOSED') throw badRequest('Msimu wa mzigo huu umefungwa');
  let item = p.inputItemId ? await tx.query.inputItems.findFirst({ where: eq(schema.inputItems.id, p.inputItemId) }) : undefined;
  if (!item && p.newItem) {
    // Bidhaa mpya inasajiliwa sasa (Meneja ameidhinisha)
    const [ex] = await tx.select().from(schema.inputItems).where(and(eq(schema.inputItems.amcosId, a.amcosId), sql`lower(${schema.inputItems.name}) = lower(${p.newItem.name})`));
    if (ex) throw conflict(`Bidhaa "${p.newItem.name}" tayari imesajiliwa — Stokipa aingize mzigo kwa bidhaa iliyopo`);
    [item] = await tx.insert(schema.inputItems).values({ amcosId: a.amcosId, name: p.newItem.name, category: p.newItem.category, unit: p.newItem.unit, reorderLevel: p.newItem.reorderLevel ?? null }).returning();
    await audit(tx, req, { action: 'INPUT_ITEM_CREATE', entity: 'InputItem', entityId: item.id, amcosId: a.amcosId, after: { ...item, approval: a.requestNo } });
  }
  if (!item || item.amcosId !== a.amcosId) throw conflict('Bidhaa haipo tena');
  const quantity = changes?.quantity ?? p.quantity;
  if (p.purchaseLineId) {
    // Mzigo wa manunuzi: kiasi kilichopokelewa kwenye ombi kinaongezeka
    const PL = schema.purchaseRequestLines, PR = schema.purchaseRequests;
    await tx.execute(sql`select 1 from purchase_requests where id = ${p.purchaseRequestId} for update`);
    const [line] = await tx.select().from(PL).where(eq(PL.id, p.purchaseLineId));
    const [pr] = await tx.select().from(PR).where(eq(PR.id, p.purchaseRequestId!));
    if (!line || !pr || !['APPROVED', 'PARTIALLY_RECEIVED'].includes(pr.status)) throw conflict('Ombi la manunuzi haliko tayari kupokea mzigo');
    const left = D(line.quantity).minus(line.receivedQty);
    if (D(quantity).gt(left)) throw badRequest(`Kiasi kinazidi kilichobaki kwenye ombi ${pr.prNo} (${fmt2(left)})`);
    await tx.update(PL).set({ receivedQty: fmt2(D(line.receivedQty).plus(quantity)) }).where(eq(PL.id, line.id));
    const lines = await tx.select().from(PL).where(eq(PL.purchaseRequestId, pr.id));
    const done = lines.every((l) => D(l.receivedQty).gte(l.quantity));
    await tx.update(PR).set({ status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED' }).where(eq(PR.id, pr.id));
    await audit(tx, req, { action: 'PURCHASE_GOODS_RECEIVED', entity: 'PurchaseRequest', entityId: pr.id, amcosId: a.amcosId, before: { status: pr.status }, after: { status: done ? 'RECEIVED' : 'PARTIALLY_RECEIVED', reference: p.reference, quantity, approval: a.requestNo } });
  }
  // Chama cha USD: Meneja akibadilisha bei, anaandika dola; TSh inahesabiwa kwa kiwango cha sasa
  const usd = !!p.unitPriceUsd;
  const rateRow = usd ? await currentRate(tx, a.amcosId) : null;
  const unitPriceUsd = usd ? D(changes?.unitPrice ?? p.unitPriceUsd!).toFixed(4) : null;
  const unitPrice = usd ? fmt2(toTzs(unitPriceUsd!, rateRow?.usdToTzs ?? D(p.unitPrice).div(p.unitPriceUsd!))) : changes?.unitPrice ?? p.unitPrice;
  // Mzigo wa ombi la manunuzi: gharama ya ombi (kiwango cha ombi). Mzigo wa kawaida wa dola: kiwango cha sasa.
  const unitCost = usd && p.unitCostUsd && !p.purchaseLineId ? fmt2(toTzs(p.unitCostUsd, rateRow?.usdToTzs ?? D(p.unitPrice).div(p.unitPriceUsd!))) : p.unitCost;
  const adjusted = [quantity !== p.quantity && `idadi ${p.quantity} → ${quantity}`,
    usd ? (unitPriceUsd !== D(p.unitPriceUsd!).toFixed(4) && `bei $${p.unitPriceUsd} → $${unitPriceUsd}`) : (unitPrice !== p.unitPrice && `bei ${p.unitPrice} → ${unitPrice}`)].filter(Boolean).join(', ');
  const [mv] = await tx.insert(schema.stockMovements).values({
    amcosId: a.amcosId, seasonId: p.seasonId, inputItemId: item.id, type: 'RECEIPT', quantity, reference: p.reference, purchaseRequestId: p.purchaseRequestId ?? null,
    notes: [p.source && `Kutoka: ${p.source}`, p.notes, `Idhini ${a.requestNo}: ${note}`, adjusted && `Meneja alirekebisha ${adjusted}`].filter(Boolean).join(' · '),
    batchNo: p.batchNo, expiryDate: p.expiryDate, supplierId: p.supplierId, unitCost, unitCostUsd: p.unitCostUsd ?? null, approvalId: a.id, createdById: a.requestedById,
  }).returning();
  const P = schema.inputPrices;
  const before = await tx.query.inputPrices.findFirst({ where: and(eq(P.seasonId, p.seasonId), eq(P.inputItemId, item.id)) });
  if (!before || (usd ? before.unitPriceUsd == null || D(before.unitPriceUsd).toFixed(4) !== unitPriceUsd : before.unitPrice !== unitPrice)) {
    const [pr] = await tx.insert(P).values({ amcosId: a.amcosId, seasonId: p.seasonId, inputItemId: item.id, unitPrice, unitPriceUsd })
      .onConflictDoUpdate({ target: [P.seasonId, P.inputItemId], set: { unitPrice, unitPriceUsd, updatedAt: new Date() } }).returning();
    await audit(tx, req, { action: 'INPUT_PRICE_SET', entity: 'InputPrice', entityId: pr.id, amcosId: a.amcosId, before: before ?? null, after: { ...pr, approval: a.requestNo } });
  }
  await audit(tx, req, { action: 'STOCK_RECEIPT_APPROVED', entity: 'StockMovement', entityId: mv.id, amcosId: a.amcosId, after: { ...mv, unitPrice, adjusted: adjusted || null, note } });
}

const HANDLERS: Record<ApprovalType, (tx: Tx, req: Request, a: Approval, o: Outcome, note: string) => Promise<void>> = {
  MEMBER_REGISTRATION: onMember,
  EXPENSE: onFinanceTxn,
  FARMER_PAYMENT: onFinanceTxn,
  SUPPLIER_PAYMENT: onFinanceTxn,
  PURCHASE: onPurchase,
  STOCK_ADJUSTMENT: onStockAdjustment,
  INPUT_ISSUE: onInputIssue,
  REVERSAL: onReversal,
  JOURNAL: onJournal,
  TOBACCO_SALE: onTobaccoSale,
  PAYMENT_BATCH: onPaymentBatch,
  TRANSFER: onTransfer,
  PAYROLL: onPayroll,
  ASSET_DISPOSAL: onAssetDisposal,
  OPENING_BALANCE: onOpeningBalance,
  PERIOD_CLOSE: onPeriodClose,
  YEAR_END_CLOSE: onYearEndClose,
  STOCK_RECEIPT: onStockReceipt,
  GROUP_REGISTRATION: onGroupRegistration,
  GROUP_CHANGE: onGroupChange,
  KUNI_BATCH: onKuniBatch,
};

export const SELF_APPROVED_TAG = '[Imejiidhinisha — chama hakina Mhasibu/Stokipa]';

/** Meneja anaidhinisha au anakataa. Lazima awe wa chama hicho na asiwe aliyeanzisha ombi. */
export async function decideApproval(tx: Tx, req: Request, id: string, decision: 'APPROVED' | 'REJECTED', note: string, changes?: ReceiptChanges) {
  const a = await lockPending(tx, id);
  if (req.auth!.amcosId !== a.amcosId) throw notFound('Ombi');
  if (a.requestedById === req.auth!.userId) {
    // Chama chenye Meneja pekee (hakina Mhasibu au Stokipa): Meneja anaweza kujiidhinisha — kwa nenosiri (route)
    // na maelezo; inaandikwa wazi kama "Imejiidhinisha" ili Owner na Chama Kikuu waione.
    const covering = req.auth!.role === 'AMCOS_ADMIN' ? await missingRoles(a.amcosId) : [];
    if (!covering.length) throw forbidden('Huwezi kuidhinisha ombi ulilolianzisha mwenyewe');
    if (decision === 'APPROVED') {
      if (note.trim().length < 10) throw badRequest('Unajiidhinisha mwenyewe: eleza kwa ufupi kwa nini ombi hili ni sahihi (angalau herufi 10)');
      note = `${SELF_APPROVED_TAG} ${note}`;
      await audit(tx, req, { action: 'APPROVAL_SELF_APPROVED', entity: 'ApprovalRequest', entityId: a.id, amcosId: a.amcosId, after: { type: a.type, amount: a.amount ?? null, covering } });
    }
  }
  if (changes && (changes.quantity || changes.unitPrice)) {
    if (a.type !== 'STOCK_RECEIPT') throw badRequest('Marekebisho yanaruhusiwa kwa mzigo wa pembejeo tu');
    if (decision !== 'APPROVED') throw badRequest('Marekebisho ni kwa kuidhinisha tu');
    await onStockReceipt(tx, req, a, decision, note, changes);
    const what = [changes.quantity && `idadi ${changes.quantity}`, changes.unitPrice && `bei ${changes.unitPrice}`].filter(Boolean).join(', ');
    return closeApproval(tx, req, a, decision, `${note} [Meneja amerekebisha: ${what}]`);
  }
  await HANDLERS[a.type](tx, req, a, decision, note);
  return closeApproval(tx, req, a, decision, note);
}

/** Aliyeanzisha ombi analiondoa kabla ya uamuzi. */
export async function cancelApproval(tx: Tx, req: Request, id: string, note: string) {
  const a = await lockPending(tx, id);
  if (a.requestedById !== req.auth!.userId) throw forbidden('Ni aliyeanzisha ombi tu anayeweza kuliondoa');
  await HANDLERS[a.type](tx, req, a, 'CANCELLED', note);
  return closeApproval(tx, req, a, 'CANCELLED', note);
}
