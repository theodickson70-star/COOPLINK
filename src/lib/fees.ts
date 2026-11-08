// =====================================================================
//  ADA ZA COOPLINK (mapato ya kampuni — HAYACHANGANYWI na fedha za chama wala za wakulima)
//   1. Ada ya kingilio: inadaiwa chama kikifunguliwa; mwisho siku N (3) baadaye.
//   2. Ada ya msimu: kila mwaka, mwisho wa kulipa 15/10; awamu 2 sawa kwa sawa.
//      Inaanza kudaiwa baada ya kingilio kulipwa (au kusamehewa).
//   3. Malipo ni kwa CONTROL NUMBER ya TeePay TU. Malipo yanathibitishwa na TeePay ("verified")
//      kabla ya kurekodiwa — ombi la malipo pekee SI malipo.
//   4. Ada ikipita tarehe bila kulipwa yote -> chama kizima kinafungwa (Meneja anaingia kulipa tu).
//      Malipo yakithibitishwa -> kinafunguka papo hapo.
// =====================================================================
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { D, fmt2, tshText } from './money';
import { getSetting } from './settings';
import { addDays, nextInvoiceNo, today } from './subscriptions';
import { createControlNumber, fromMinor, getControlNumber, teepayConfig, TeePayError, toMinor, type CnCreate } from './teepay';
import { badRequest, conflict, notFound } from './errors';

const F = schema.platformFees;
const CN = schema.platformControlNumbers;
const P = schema.platformPayments;
type Fee = typeof F.$inferSelect;
type ControlNo = typeof CN.$inferSelect;

/** Mwisho wa kulipa ada ya msimu unaofuata (au wa leo) — mf. 2027-10-15. */
export async function seasonDeadline(t = today()) {
  const c = await getSetting('fees');
  const md = `${String(c.deadlineMonth).padStart(2, '0')}-${String(c.deadlineDay).padStart(2, '0')}`;
  const y = Number(t.slice(0, 4));
  const thisYear = `${y}-${md}`;
  return t <= thisYear ? thisYear : `${y + 1}-${md}`;
}
export const seasonLabel = (due: string) => { const y = Number(due.slice(0, 4)); return `${y - 1}/${y}`; };

async function sysAudit(tx: DbOrTx, action: string, amcosId: string, entityId: string, after: unknown, userId?: string | null) {
  await tx.insert(schema.auditLogs).values({ action, entity: 'PlatformFee', entityId, amcosId, userId: userId ?? null, userRole: userId ? null : 'SYSTEM', after: after as object });
}

/** Chama kipya: kidaiwe ada ya kingilio (kama ada zimewashwa). Haiundi mara mbili. */
export async function ensureEntranceFee(tx: DbOrTx, amcosId: string, userId?: string | null, opts: { force?: boolean } = {}) {
  const c = await getSetting('fees', { fresh: true });
  if (!c.enabled && !opts.force) return null;
  const [have] = await tx.select().from(F).where(and(eq(F.amcosId, amcosId), eq(F.kind, 'ENTRANCE')));
  if (have) return have;
  const [row] = await tx.insert(F).values({
    amcosId, kind: 'ENTRANCE', label: 'Ada ya kingilio', amount: fmt2(c.entranceFee), installments: 1,
    dueDate: addDays(today(), c.entranceDays), createdById: userId ?? null,
  }).onConflictDoNothing().returning();
  if (row) await sysAudit(tx, 'FEE_ENTRANCE_CREATE', amcosId, row.id, { amount: row.amount, dueDate: row.dueDate }, userId);
  return row ?? null;
}

/** Baada ya kingilio kulipwa/kusamehewa: ada ya msimu wa sasa (mwisho 15/10) iwepo. */
export async function ensureSeasonFee(tx: DbOrTx, amcosId: string) {
  const [entrance] = await tx.select().from(F).where(and(eq(F.amcosId, amcosId), eq(F.kind, 'ENTRANCE')));
  if (!entrance || !['PAID', 'WAIVED'].includes(entrance.status)) return null;
  const due = await seasonDeadline();
  const [have] = await tx.select().from(F).where(and(eq(F.amcosId, amcosId), eq(F.kind, 'SEASON'), eq(F.dueDate, due)));
  if (have) return have;
  const c = await getSetting('fees');
  const [row] = await tx.insert(F).values({
    amcosId, kind: 'SEASON', label: `Ada ya msimu ${seasonLabel(due)}`, amount: fmt2(c.seasonFee),
    installments: Math.max(1, c.seasonInstallments), dueDate: due,
  }).onConflictDoNothing().returning();
  if (row) await sysAudit(tx, 'FEE_SEASON_CREATE', amcosId, row.id, { amount: row.amount, dueDate: row.dueDate });
  return row ?? null;
}

// ---------------------------------------------------------------------
//  Kufungwa kwa chama
// ---------------------------------------------------------------------
export interface FeeLock { feeId: string; kind: 'ENTRANCE' | 'SEASON'; label: string; dueDate: string; outstanding: string }
const lockCache = new Map<string, { at: number; v: FeeLock | null }>();
export const clearFeeLock = (amcosId?: string) => (amcosId ? lockCache.delete(amcosId) : lockCache.clear());

/** Ada iliyopita tarehe bila kulipwa yote. Bila TeePay kuwashwa, hakuna chama kinachofungwa (hawana njia ya kulipa). */
export async function feeLock(amcosId: string, opts: { fresh?: boolean } = {}): Promise<FeeLock | null> {
  if (!teepayConfig().enabled) return null;
  const c = lockCache.get(amcosId);
  if (!opts.fresh && c && Date.now() - c.at < 15_000) return c.v;
  const [f] = await db.select().from(F)
    .where(and(eq(F.amcosId, amcosId), inArray(F.status, ['UNPAID', 'PARTIAL']), lt(F.dueDate, today())))
    .orderBy(asc(F.dueDate)).limit(1);
  const v = f ? { feeId: f.id, kind: f.kind, label: f.label, dueDate: f.dueDate, outstanding: fmt2(D(f.amount).minus(f.paid)) } : null;
  lockCache.set(amcosId, { at: Date.now(), v });
  return v;
}

// ---------------------------------------------------------------------
//  Control numbers
// ---------------------------------------------------------------------
export const outstandingOf = (f: Fee) => D(f.amount).minus(f.paid);
/** Kiasi kinachoruhusiwa kwa control number: kingilio = chote; msimu = awamu moja, au salio lote. */
export function allowedAmounts(f: Fee) {
  const left = outstandingOf(f);
  if (left.lte(0)) return [];
  const inst = D(f.amount).dividedBy(f.installments).toDecimalPlaces(2);
  const out = new Set<string>([fmt2(left)]);
  if (f.kind === 'SEASON' && left.gt(inst)) out.add(fmt2(inst));
  return [...out].sort((a, b) => Number(a) - Number(b));
}

async function callCreate(cn: ControlNo) {
  try {
    const r = await createControlNumber(cn.request as CnCreate, cn.idempotencyKey);
    const issued = r.status === 201 && !!r.data?.number;
    const [u] = await db.update(CN).set({
      teepayId: r.data?.id ?? cn.teepayId, number: r.data?.number ?? null, status: issued ? 'ISSUED' : 'ISSUING', lastError: null, lastSyncedAt: new Date(),
    }).where(eq(CN.id, cn.id)).returning();
    return u;
  } catch (e) {
    const err = e as TeePayError;
    const permanent = err instanceof TeePayError && err.permanent && err.code !== 'idempotency_conflict';
    const msg = `${err.code ?? 'error'}: ${err.message}${err.requestId ? ` (request_id ${err.requestId})` : ''}`.slice(0, 500);
    const [u] = await db.update(CN).set({ status: permanent ? 'FAILED' : 'ISSUING', lastError: msg, lastSyncedAt: new Date() }).where(eq(CN.id, cn.id)).returning();
    return u;
  }
}

/** Meneja anatengeneza control number ya ada. Control number moja hai kwa kila ada (inarudishwa ileile). */
export async function issueControlNumber(feeId: string, amount: string, userId: string) {
  if (!teepayConfig().enabled) throw badRequest('Malipo kwa control number bado hayajawashwa na CoopLink. Wasiliana na CoopLink.');
  const prep = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from platform_fees where id = ${feeId} for update`);
    const [f] = await tx.select().from(F).where(eq(F.id, feeId));
    if (!f) throw notFound('Ada');
    if (f.status === 'PAID' || f.status === 'WAIVED') throw conflict('Ada hii tayari imelipwa');
    const [active] = await tx.select().from(CN).where(and(eq(CN.feeId, feeId), inArray(CN.status, ['ISSUING', 'ISSUED'])));
    if (active) return { cn: active, fresh: false };
    if (!allowedAmounts(f).includes(fmt2(amount))) throw badRequest(`Kiasi kinachoruhusiwa: ${allowedAmounts(f).map((a) => tshText(a)).join(' au ')}`);
    const a = (await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, f.amcosId) }))!;
    const mgr = await tx.query.users.findFirst({ where: eq(schema.users.id, userId) });
    const id = randomUUID();
    const request: CnCreate = {
      kind: 'bill',
      customer: {
        name: a.name.slice(0, 160),
        ...(mgr?.phone ? { phone: `+${mgr.phone}`.slice(0, 20) } : {}),
        ...(mgr?.email ? { email: mgr.email } : {}),
      },
      description: `CoopLink: ${f.label} — ${a.name} (${a.code})`.slice(0, 240),
      amount_minor: toMinor(amount),
      payment_mode: 'EXACT',
    };
    const [cn] = await tx.insert(CN).values({
      id, feeId, amcosId: f.amcosId, amount: fmt2(amount), amountMinor: request.amount_minor!, idempotencyKey: `cooplink_${id.replace(/-/g, '')}`,
      request, createdById: userId,
    }).returning();
    await sysAudit(tx, 'FEE_CONTROL_NUMBER_REQUEST', f.amcosId, f.id, { controlNumberId: cn.id, amount: cn.amount }, userId);
    return { cn, fresh: true };
  });
  if (prep.cn.status === 'ISSUING') return callCreate(prep.cn); // mpya, au ya zamani ambayo TeePay hawakumaliza (Idempotency-Key ileile)
  return prep.cn;
}

/**
 * Soma control number kwenye TeePay na urekodi malipo YALIYOTHIBITISHWA ("verified") ambayo bado hayajarekodiwa.
 * Inaitwa na webhook, kitufe cha "Hakiki malipo" na kazi ya nyuma — matokeo ni yaleyale (haiongezi mara mbili).
 */
export async function syncControlNumber(cnId: string) {
  let [cn] = await db.select().from(CN).where(eq(CN.id, cnId));
  if (!cn) throw notFound('Control number');
  if (cn.status === 'ISSUING') cn = await callCreate(cn);
  if (!cn.teepayId || cn.status === 'FAILED') return { cn, recorded: [] as (typeof P.$inferSelect)[] };
  let remote;
  try {
    remote = (await getControlNumber(cn.teepayId)).data;
  } catch (e) {
    await db.update(CN).set({ lastError: `${(e as TeePayError).code}: ${(e as Error).message}`.slice(0, 500), lastSyncedAt: new Date() }).where(eq(CN.id, cn.id));
    throw e;
  }
  const verified = (remote.payments ?? []).filter((p) => p.status === 'verified' && p.amount_minor && (p.id || p.reference));
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from platform_fees where id = ${cn.feeId} for update`);
    const [f] = await tx.select().from(F).where(eq(F.id, cn.feeId));
    const recorded: (typeof P.$inferSelect)[] = [];
    let paid = D(f.paid);
    for (const p of verified) {
      const ref = `TEEPAY:${p.id ?? p.reference}`;
      const [dup] = await tx.select({ id: P.id }).from(P).where(eq(P.providerRef, ref));
      if (dup) continue;
      const amount = fromMinor(p.amount_minor!);
      const [row] = await tx.insert(P).values({
        invoiceNo: await nextInvoiceNo(tx), amcosId: f.amcosId, category: f.kind === 'ENTRANCE' ? 'SETUP' : 'SUBSCRIPTION',
        amount, method: 'MOBILE_MONEY', providerRef: ref, status: 'VERIFIED',
        paidAt: new Date(p.paid_at ?? p.received_at ?? Date.now()), verifiedAt: new Date(),
        feeId: f.id, controlNumberId: cn.id,
        notes: `${f.label} · control number ${cn.number ?? ''} · TeePay ${p.reference ?? p.id}${p.fee_minor ? ` · ada ya TeePay TSh ${fromMinor(p.fee_minor)}` : ''}`,
      }).returning();
      recorded.push(row);
      paid = paid.plus(amount);
    }
    let fee = f;
    if (recorded.length) {
      const full = paid.gte(f.amount);
      [fee] = await tx.update(F).set({ paid: fmt2(paid), status: f.status === 'WAIVED' ? 'WAIVED' : full ? 'PAID' : 'PARTIAL', paidAt: full ? new Date() : f.paidAt, updatedAt: new Date() })
        .where(eq(F.id, f.id)).returning();
      await sysAudit(tx, 'FEE_PAYMENT_VERIFIED', f.amcosId, f.id, { payments: recorded.map((r) => ({ invoiceNo: r.invoiceNo, amount: r.amount, ref: r.providerRef })), paid: fee.paid, status: fee.status });
    }
    const collected = remote.collected_minor ?? cn.collectedMinor;
    const cnPaid = D(collected).gte(cn.amountMinor);
    const [u] = await tx.update(CN).set({
      number: remote.number ?? cn.number, collectedMinor: collected, status: cnPaid ? 'PAID' : 'ISSUED', paidAt: cnPaid ? (cn.paidAt ?? new Date()) : null,
      lastError: null, lastSyncedAt: new Date(),
    }).where(eq(CN.id, cn.id)).returning();
    if (fee.kind === 'ENTRANCE' && fee.status === 'PAID') await ensureSeasonFee(tx, fee.amcosId);
    return { cn: u, recorded };
  });
  clearFeeLock(cn.amcosId);
  return result;
}

/** Kazi ya nyuma: ada za msimu mpya + kuhakiki control numbers ambazo webhook haikufika. */
export async function runFeesSweep() {
  const ids = await db.selectDistinct({ amcosId: F.amcosId }).from(F).where(and(eq(F.kind, 'ENTRANCE'), inArray(F.status, ['PAID', 'WAIVED'])));
  let seasons = 0;
  for (const { amcosId } of ids) if (await db.transaction((tx) => ensureSeasonFee(tx, amcosId))) seasons++;
  let synced = 0, recorded = 0, errors = 0;
  if (teepayConfig().enabled) {
    const open = await db.select({ id: CN.id }).from(CN)
      .where(and(inArray(CN.status, ['ISSUING', 'ISSUED']), sql`${CN.createdAt} > now() - interval '120 days'`)).orderBy(asc(CN.lastSyncedAt)).limit(100);
    for (const c of open) {
      try { const r = await syncControlNumber(c.id); synced++; recorded += r.recorded.length; } catch { errors++; }
    }
  }
  clearFeeLock();
  return { amcos: ids.length, seasonsCreated: seasons, synced, recorded, errors };
}

/** Ujumbe wa risiti kulingana na hali ya ada BAADA ya malipo hayo. */
export async function receiptOf(paymentId: string, amcosId?: string) {
  const [p] = await db.select().from(P).where(and(eq(P.id, paymentId), amcosId ? eq(P.amcosId, amcosId) : undefined));
  if (!p || !p.feeId || p.status !== 'VERIFIED') throw notFound('Risiti');
  const [f] = await db.select().from(F).where(eq(F.id, p.feeId));
  const before = await db.select({ amount: P.amount }).from(P)
    .where(and(eq(P.feeId, f.id), eq(P.status, 'VERIFIED'), sql`(${P.paidAt}, ${P.createdAt}) <= (select x.paid_at, x.created_at from platform_payments x where x.id = ${p.id})`));
  const paidToDate = before.reduce((t, x) => t.plus(x.amount), D(0));
  const balance = D(f.amount).minus(paidToDate);
  const a = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, p.amcosId!) }))!;
  const cn = p.controlNumberId ? (await db.select().from(CN).where(eq(CN.id, p.controlNumberId)))[0] : null;
  const message = f.kind === 'ENTRANCE'
    ? `Ada ya kingilio ya ${tshText(p.amount)} imepokelewa. Karibu CoopLink — utapata huduma kwa mwaka mzima.`
    : balance.lte(0)
      ? `${f.label} imelipwa kikamilifu (${tshText(f.amount)}). Asante — huduma ya CoopLink inaendelea.`
      : `Awamu ya ${f.label.toLowerCase()} ya ${tshText(p.amount)} imepokelewa. Salio ni ${tshText(balance)}, mwisho wa kulipa ni ${f.dueDate}.`;
  return {
    receipt: { id: p.id, receiptNo: p.invoiceNo, amount: p.amount, paidAt: p.paidAt, providerRef: p.providerRef?.replace(/^TEEPAY:/, '') ?? null, controlNumber: cn?.number ?? null },
    fee: { id: f.id, kind: f.kind, label: f.label, amount: f.amount, paidToDate: fmt2(paidToDate), balance: fmt2(balance.gt(0) ? balance : 0), dueDate: f.dueDate },
    amcos: { id: a.id, name: a.name, code: a.code },
    message,
    business: await getSetting('business.profile'),
  };
}

/** Taarifa za ada za chama kimoja (Meneja / Owner). */
export async function feesOverview(amcosId: string) {
  const fees = await db.select().from(F).where(eq(F.amcosId, amcosId)).orderBy(asc(F.dueDate), asc(F.createdAt));
  const cns = fees.length ? await db.select().from(CN).where(eq(CN.amcosId, amcosId)).orderBy(sql`${CN.createdAt} desc`) : [];
  const pays = fees.length ? await db.select().from(P).where(and(eq(P.amcosId, amcosId), sql`${P.feeId} is not null`)).orderBy(sql`${P.paidAt} desc`) : [];
  const t = today();
  return {
    teepayEnabled: teepayConfig().enabled,
    lock: await feeLock(amcosId, { fresh: true }),
    fees: fees.map((f) => ({
      ...f, outstanding: fmt2(outstandingOf(f).gt(0) ? outstandingOf(f) : 0), overdue: ['UNPAID', 'PARTIAL'].includes(f.status) && f.dueDate < t,
      allowed: f.status === 'UNPAID' || f.status === 'PARTIAL' ? allowedAmounts(f) : [],
      controlNumbers: cns.filter((c) => c.feeId === f.id).map(({ request: _r, idempotencyKey: _k, ...c }) => ({ ...c, collected: fromMinor(c.collectedMinor) })),
      payments: pays.filter((p) => p.feeId === f.id).map((p) => ({ id: p.id, receiptNo: p.invoiceNo, amount: p.amount, paidAt: p.paidAt, status: p.status })),
    })),
  };
}
