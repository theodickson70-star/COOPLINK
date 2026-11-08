// =====================================================================
//  SALIO LA KUANZIA NA KUFUNGA VIPINDI (Mhasibu anaandaa · Meneja anaidhinisha)
//   - Salio la kuanzia: madeni ya wakulima (ledger zao) + akaunti nyingine za daftari kuu, dhidi ya 3900
//   - Kufunga kipindi: hakuna muamala/journal wa tarehe hiyo au kabla yake (trigger ya DB)
//   - Kufunga mwaka: mapato na matumizi yanahamishiwa akiba (3200), kisha kipindi kinafungwa
// =====================================================================
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { D, fmt2 } from './money';
import { badRequest, conflict } from './errors';
import { audit } from './audit';
import * as ledger from './ledger';
import { assertManualAllowed, balances, glMap, lockGl, postJournal, syncLedger, type JLine } from './gl';
import { lockedThrough } from './periods';

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });

export interface OpeningPayload {
  date: string; description: string;
  farmers: { memberId: string; memberNo: string; name: string; debt?: string | null; credit?: string | null }[];
  lines: { glAccountId: string; code: string; name: string; debit?: string | null; credit?: string | null }[];
}

/** Salio la kuanzia: kila deni la mkulima linaingia ledger yake; daftari kuu linalingana kupitia 3900. */
export async function onOpeningBalance(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const p = a.payload as OpeningPayload;
  const m = await glMap(tx, a.amcosId);
  const jl: JLine[] = [];
  for (const f of p.farmers) {
    const mem = await tx.query.members.findFirst({ where: eq(schema.members.id, f.memberId) });
    if (!mem || mem.amcosId !== a.amcosId) throw badRequest(`Mkulima ${f.memberNo} hayupo tena`);
    if (D(f.debt).gt(0)) {
      await ledger.post(tx, { amcosId: a.amcosId, memberId: mem.id, type: 'OPENING_BALANCE', debit: fmt2(D(f.debt)), description: `Salio la kuanzia (deni) ${p.date}`, referenceType: 'OPENING_BALANCE', referenceId: a.id, createdById: a.requestedById });
      jl.push({ code: '1200', debit: f.debt!, memberId: mem.id, memo: `Deni la kuanzia ${mem.memberNo}` });
    }
    if (D(f.credit).gt(0)) {
      await ledger.post(tx, { amcosId: a.amcosId, memberId: mem.id, type: 'OPENING_BALANCE', credit: fmt2(D(f.credit)), description: `Salio la kuanzia (chama kinadaiwa) ${p.date}`, referenceType: 'OPENING_BALANCE', referenceId: a.id, createdById: a.requestedById });
      jl.push({ code: '2200', credit: f.credit!, memberId: mem.id, memo: `Chama kinadaiwa ${mem.memberNo}` });
    }
  }
  for (const l of p.lines) {
    const acc = m.byId.get(l.glAccountId);
    if (!acc) throw badRequest('Akaunti ya salio la kuanzia haipo tena');
    assertManualAllowed(acc);
    jl.push({ glAccountId: acc.id, debit: l.debit ?? 0, credit: l.credit ?? 0 });
  }
  const net = jl.reduce((s, l) => s.plus(D(l.debit)).minus(D(l.credit)), D(0));
  jl.push({ code: '3900', debit: net.lt(0) ? net.neg() : 0, credit: net.gt(0) ? net : 0, memo: 'Tofauti — salio la kuanzia' });
  const entry = await postJournal(tx, { amcosId: a.amcosId, date: p.date, description: `Salio la kuanzia: ${p.description}`, source: 'OPENING_BALANCE', sourceId: a.id, reference: a.requestNo, approvalId: a.id, createdById: a.requestedById, strict: true, lines: jl }, m);
  await audit(tx, req, { action: 'OPENING_BALANCE_POSTED', entity: 'JournalEntry', entityId: entry?.id ?? null, amcosId: a.amcosId, after: { entryNo: entry?.entryNo, farmers: p.farmers.length, lines: p.lines.length, note } });
}

/** Kufunga kipindi (mf. mwezi uliokaguliwa). */
export async function onPeriodClose(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const p = a.payload as { lockedThrough: string; note?: string | null };
  await lockGl(tx, a.amcosId);
  const cur = await lockedThrough(tx, a.amcosId);
  if (cur && p.lockedThrough <= cur) throw conflict(`Kipindi tayari kimefungwa hadi ${cur}`);
  if (p.lockedThrough >= today()) throw badRequest('Huwezi kufunga leo au siku zijazo');
  const [row] = await tx.insert(schema.periodLocks).values({ amcosId: a.amcosId, lockedThrough: p.lockedThrough, kind: 'PERIOD', note: p.note ?? null, approvalId: a.id, createdById: a.requestedById }).returning();
  await audit(tx, req, { action: 'PERIOD_CLOSED', entity: 'PeriodLock', entityId: row.id, amcosId: a.amcosId, after: { lockedThrough: p.lockedThrough, note } });
}

/** Kufunga mwaka: mapato na matumizi yote hadi tarehe hiyo yanahamishiwa 3200 (akiba/ziada), kisha kipindi kinafungwa. */
export async function onYearEndClose(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const p = a.payload as { closeDate: string; note?: string | null };
  await syncLedger(a.amcosId); // matukio yote ya kipindi yaingie kabla ya kufunga
  const cur = await lockedThrough(tx, a.amcosId);
  if (cur && p.closeDate <= cur) throw conflict(`Kipindi tayari kimefungwa hadi ${cur}`);
  if (p.closeDate >= today()) throw badRequest('Mwaka unafungwa baada ya tarehe ya mwisho kupita');
  const rows = (await balances(tx, a.amcosId, { to: p.closeDate })).filter((r) => (r.type === 'INCOME' || r.type === 'EXPENSE') && !D(r.balance).isZero());
  const jl: JLine[] = rows.map((r) => (r.type === 'INCOME' ? { glAccountId: r.id, debit: r.balance } : { glAccountId: r.id, credit: r.balance }));
  const surplus = rows.reduce((s, r) => (r.type === 'INCOME' ? s.plus(r.balance) : s.minus(r.balance)), D(0));
  jl.push({ code: '3200', credit: surplus.gt(0) ? surplus : 0, debit: surplus.lt(0) ? surplus.neg() : 0, memo: surplus.gte(0) ? 'Ziada ya mwaka' : 'Upungufu wa mwaka' });
  const entry = rows.length ? await postJournal(tx, {
    amcosId: a.amcosId, date: p.closeDate, description: `Kufunga mwaka hadi ${p.closeDate}`, source: 'YEAR_END_CLOSE', sourceId: a.id, reference: a.requestNo,
    approvalId: a.id, createdById: req.auth!.userId, strict: true, lines: jl,
  }) : null;
  const [row] = await tx.insert(schema.periodLocks).values({ amcosId: a.amcosId, lockedThrough: p.closeDate, kind: 'YEAR_END', note: p.note ?? null, approvalId: a.id, journalEntryId: entry?.id ?? null, createdById: a.requestedById }).returning();
  await audit(tx, req, { action: 'YEAR_END_CLOSED', entity: 'PeriodLock', entityId: row.id, amcosId: a.amcosId, after: { closeDate: p.closeDate, surplus: fmt2(surplus), entryNo: entry?.entryNo, note } });
}
