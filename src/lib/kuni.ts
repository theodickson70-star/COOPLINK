// =====================================================================
//  PESA YA KUNI — idhini ya orodha na kusahihisha malipo
// =====================================================================
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { conflict } from './errors';
import { audit } from './audit';
import * as ledger from './ledger';
import { journalFor, reverseJournal } from './gl';

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;
const B = schema.kuniBatches;
const KL = schema.kuniLoans;

/** Meneja ameidhinisha orodha: Mhasibu anaweza kutuma pesa. Fedha HAZITOKI hapa. */
export async function onKuniBatch(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const [b] = await tx.select().from(B).where(eq(B.id, a.entityId!)).for('update');
  if (!b || b.status !== 'DRAFT') throw conflict('Orodha hii ya pesa ya kuni haisubiri idhini');
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
  if (j) await reverseJournal(tx, j.id, { date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }), description: `Kusahihisha riba ya pesa ya kuni (${txnNo})`, source: 'KUNI_INTEREST_REVERSAL', sourceId: loan.id, createdById: userId });
  await tx.update(KL).set({ status: 'FAILED', failureReason: `Imesahihishwa (${txnNo})`, financeTxnId: null }).where(eq(KL.id, loan.id));
  await tx.update(B).set({ status: 'PARTIAL' }).where(eq(B.id, loan.batchId));
}
