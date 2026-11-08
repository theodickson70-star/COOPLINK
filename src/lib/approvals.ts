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
import { nextNumber, pad } from './counter';
import { D, fmt2 } from './money';
import * as ledger from './ledger';
import { lockItems, stockBalance } from './stock';
import { nextTxnNo } from './finance';
import { assertManualAllowed, glMap, postJournal } from './gl';
import { onPaymentBatch, onTobaccoSale } from './tobacco';
import { onPayroll } from './payroll';
import { onAssetDisposal } from './assets';

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
};

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
    description: `Pembejeo ${issue.issueNo}: ${lines.map((l) => `${l.inputItem.name} x${l.quantity}`).join(', ')}`,
    referenceType: 'INPUT_ISSUE', referenceId: issue.id, createdById: req.auth!.userId,
  });
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
    txnDate: new Date().toISOString().slice(0, 10), description: `Kusahihisha ${orig.txnNo}: ${a.reason ?? ''}`.trim(),
    reference: orig.txnNo, payee: orig.payee, memberId: orig.memberId, supplierId: orig.supplierId, purchaseRequestId: orig.purchaseRequestId,
    contraGlAccountId: orig.contraGlAccountId, transferGroupId: orig.transferGroupId,
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
};

/** Meneja anaidhinisha au anakataa. Lazima awe wa chama hicho na asiwe aliyeanzisha ombi. */
export async function decideApproval(tx: Tx, req: Request, id: string, decision: 'APPROVED' | 'REJECTED', note: string) {
  const a = await lockPending(tx, id);
  if (req.auth!.amcosId !== a.amcosId) throw notFound('Ombi');
  if (a.requestedById === req.auth!.userId) throw forbidden('Huwezi kuidhinisha ombi ulilolianzisha mwenyewe');
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
