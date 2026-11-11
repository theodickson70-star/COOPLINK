// =====================================================================
//  MIKOPO YA WAKULIMA (kuni, grading) — idhini ya orodha na kusahihisha malipo
// =====================================================================
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { conflict } from './errors';
import { audit } from './audit';
import * as ledger from './ledger';
import { journalFor, reverseJournal } from './gl';
import { recordUsd } from './fx';
import { D } from './money';

export const LOAN_TYPES = ['KUNI', 'GRADING', 'TREES'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const LOAN_LABEL: Record<LoanType, string> = { KUNI: 'Mkopo wa kuni', GRADING: 'Mkopo wa grading', TREES: 'Mkopo wa miti' };
export const BATCH_PREFIX: Record<LoanType, string> = { KUNI: 'KN', GRADING: 'GR', TREES: 'MT' };
/** Ekari 1 = hekta 0.404686 (makisio yanaandikwa kwa ekari) */
export const ACRE_TO_HA = '0.404686';

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;
const B = schema.kuniBatches;
const KL = schema.kuniLoans;

/** Meneja ameidhinisha orodha: Mhasibu anaweza kutuma pesa. Fedha HAZITOKI hapa. */
export async function onKuniBatch(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const [b] = await tx.select().from(B).where(eq(B.id, a.entityId!)).for('update');
  if (!b || b.status !== 'DRAFT') throw conflict('Orodha hii ya mkopo haisubiri idhini');
  if (o === 'APPROVED') {
    await tx.update(B).set({ status: 'APPROVED' }).where(eq(B.id, b.id));
  } else {
    await tx.update(B).set({ status: 'CANCELLED' }).where(eq(B.id, b.id));
    await tx.update(KL).set({ status: 'CANCELLED', failureReason: note }).where(and(eq(KL.batchId, b.id), eq(KL.status, 'PENDING')));
  }
  await audit(tx, req, { action: `KUNI_BATCH_${o}`, entity: 'KuniBatch', entityId: b.id, amcosId: a.amcosId, after: { note } });
}

/** Malipo ya pesa ya kuni yakisahihishwa (reversal): riba inaondolewa pia, na mkopo unarudi kusubiri. */
export async function reverseKuniPayment(tx: Tx, financeTxnId: string, userId: string, txnNo: string) {
  const [loan] = await tx.select().from(KL).where(eq(KL.financeTxnId, financeTxnId));
  if (!loan) return;
  const L = schema.memberLedgerEntries;
  const interest = await tx.select().from(L).where(and(eq(L.referenceType, 'KUNI_LOAN'), eq(L.referenceId, loan.id)));
  for (const e of interest) await ledger.reverse(tx, e.id, `Kusahihisha riba ya ${txnNo}`, userId);
  const j = await journalFor(tx, loan.amcosId, 'KUNI_INTEREST', loan.id);
  if (j) await reverseJournal(tx, j.id, { date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }), description: `Kusahihisha riba ya mkopo (${txnNo})`, source: 'KUNI_INTEREST_REVERSAL', sourceId: loan.id, createdById: userId });
  // Deni la dola la mkopo huu linaondolewa (kinyume cha ISSUE)
  const U = schema.memberUsdLedger;
  const issued = await tx.select().from(U).where(and(eq(U.referenceType, 'KUNI_LOAN'), eq(U.referenceId, loan.id), eq(U.kind, 'ISSUE')));
  for (const u of issued) {
    await recordUsd(tx, { amcosId: loan.amcosId, memberId: loan.memberId, seasonId: loan.seasonId, kind: 'CANCEL', usd: D(u.usd).neg(), tzs: D(u.tzs).neg(), rate: u.rate,
      description: `Kusahihisha ${LOAN_LABEL[loan.loanType].toLowerCase()} (${txnNo})`, referenceType: 'KUNI_LOAN', referenceId: loan.id, createdById: userId });
  }
  await tx.update(KL).set({ status: 'FAILED', failureReason: `Imesahihishwa (${txnNo})`, financeTxnId: null }).where(eq(KL.id, loan.id));
  await tx.update(B).set({ status: 'PARTIAL' }).where(eq(B.id, loan.batchId));
}
