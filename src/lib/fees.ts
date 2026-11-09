// =====================================================================
//  ADA ZA COOPLINK (mapato ya kampuni — HAYACHANGANYWI na fedha za chama wala za wakulima)
//   1. Ada ya kingilio: inadaiwa chama kikifunguliwa; mwisho siku N (3) baadaye.
//   2. Ada ya msimu: kila mwaka, mwisho wa kulipa 15/10; awamu 2 sawa kwa sawa.
//      Inaanza kudaiwa baada ya kingilio kulipwa (au kusamehewa).
//   3. Malipo ni kwa MITANDAO YA SIMU kupitia TeePay (ombi la PIN kwenye simu ya mlipaji).
//      Yanarekodiwa tu TeePay ikisema "succeeded" — ombi la malipo pekee SI malipo.
//   4. Ada ikipita tarehe bila kulipwa yote -> chama kizima kinafungwa (Meneja anaingia kulipa tu).
//      Malipo yakithibitishwa -> kinafunguka papo hapo.
// =====================================================================
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { D, fmt2, tshText } from './money';
import { getSetting } from './settings';
import { addDays, nextInvoiceNo, today } from './subscriptions';
import { createCollection, fromMinor, getCollection, teepayConfig, TeePayError, toMinor, type Collection, type CollectionCreate } from './teepay';
import { badRequest, conflict, notFound } from './errors';

const F = schema.platformFees;
const CN = schema.platformControlNumbers; // historia tu (control numbers zimeachwa)
const MP = schema.platformMobilePayments;
const P = schema.platformPayments;
type Fee = typeof F.$inferSelect;
type MobilePay = typeof MP.$inferSelect;

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

/** 255712345678 -> 0712345678 (muundo wa mfano wa TeePay) */
export const localPhone = (p?: string | null) => (p && /^255[67]\d{8}$/.test(p) ? '0' + p.slice(3) : undefined);
/** Herufi za kawaida tu (bila — wala alama nyingine) ili ombi lisikataliwe kwa sababu ya herufi. */
export const asciiText = (s: string, max: number) =>
  s.normalize('NFKD').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

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
//  Kiasi kinachoruhusiwa
// ---------------------------------------------------------------------
export const outstandingOf = (f: Fee) => D(f.amount).minus(f.paid);
/** Kiasi kinachoruhusiwa kwa ombi moja la malipo: kingilio = chote; msimu = awamu moja, au salio lote. */
export function allowedAmounts(f: Fee) {
  if (f.testAmount && (f.status === 'UNPAID' || f.status === 'PARTIAL')) return [fmt2(f.testAmount)]; // jaribio la Owner
  const left = outstandingOf(f);
  if (left.lte(0)) return [];
  const inst = D(f.amount).dividedBy(f.installments).toDecimalPlaces(2);
  const out = new Set<string>([fmt2(left)]);
  if (f.kind === 'SEASON' && left.gt(inst)) out.add(fmt2(inst));
  return [...out].sort((a, b) => Number(a) - Number(b));
}

// ---------------------------------------------------------------------
//  Malipo kwa mitandao ya simu (TeePay mobile money push)
// ---------------------------------------------------------------------
const OPEN: MobilePay['status'][] = ['SENDING', 'PENDING'];
const STALE_MS = 10 * 60_000; // ombi lisilojibiwa kwa dakika 10 haliwezi kuzuia ombi jipya

function mapStatus(c: Collection): MobilePay['status'] {
  if (c.status === 'succeeded') return 'SUCCEEDED';
  if (c.status === 'failed') return 'FAILED';
  return 'PENDING'; // created / pending / processing (reversed/refunded hushughulikiwa kando)
}

async function sendCreate(mp: MobilePay) {
  try {
    const r = await createCollection(mp.request as CollectionCreate, mp.idempotencyKey);
    const c = r.data;
    const [u] = await db.update(MP).set({
      teepayId: c?.id ?? mp.teepayId, reference: c?.public_reference ?? mp.reference,
      status: c ? (mapStatus(c) === 'SUCCEEDED' ? 'PENDING' : mapStatus(c)) : 'PENDING', // "succeeded" inarekodiwa na sync pekee
      statusDetail: c?.status_detail ?? null, lastError: null, lastSyncedAt: new Date(),
    }).where(eq(MP.id, mp.id)).returning();
    return u;
  } catch (e) {
    const err = e as TeePayError;
    const permanent = err instanceof TeePayError && err.permanent && err.code !== 'idempotency_conflict';
    const msg = `${err.code ?? 'error'}: ${err.message}${err.requestId ? ` (request_id ${err.requestId})` : ''}`.slice(0, 600);
    const [u] = await db.update(MP).set({ status: permanent ? 'FAILED' : 'SENDING', lastError: msg, lastSyncedAt: new Date() }).where(eq(MP.id, mp.id)).returning();
    return u;
  }
}

export interface Payer { phone: string; name: string; email: string }

/** Meneja anaomba kulipa ada: ombi la PIN linatumwa kwenye simu ya mlipaji. */
export async function requestMobilePayment(feeId: string, amount: string, payer: Payer, userId: string) {
  if (!teepayConfig().enabled) throw badRequest('Malipo kwa simu bado hayajawashwa na CoopLink. Wasiliana na CoopLink.');
  const prep = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from platform_fees where id = ${feeId} for update`);
    const [f] = await tx.select().from(F).where(eq(F.id, feeId));
    if (!f) throw notFound('Ada');
    if (f.status === 'PAID' || f.status === 'WAIVED') throw conflict('Ada hii tayari imelipwa');
    const [open] = await tx.select().from(MP).where(and(eq(MP.feeId, feeId), inArray(MP.status, OPEN), isNull(MP.abandonedAt))).orderBy(sql`${MP.createdAt} desc`).limit(1);
    if (open && Date.now() - open.createdAt.getTime() < STALE_MS) {
      throw conflict(`Ombi la malipo la ${tshText(open.amount)} kwenda ${localPhone(open.phone) ?? open.phone} bado linasubiri. Thibitisha kwa PIN kwenye simu, au subiri dakika chache kisha jaribu tena.`);
    }
    if (!allowedAmounts(f).includes(fmt2(amount))) throw badRequest(`Kiasi kinachoruhusiwa: ${allowedAmounts(f).map((a) => tshText(a)).join(' au ')}`);
    const a = (await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, f.amcosId) }))!;
    const id = randomUUID();
    const request: CollectionCreate = {
      money: { amount_minor: toMinor(amount), currency: 'TZS' },
      customer: { country: 'TZ', phone: `+${payer.phone}`, name: asciiText(payer.name, 120), email: payer.email.trim().toLowerCase() },
      description: asciiText(`CoopLink ${f.label} - ${a.name} (${a.code})`, 240),
    };
    const [mp] = await tx.insert(MP).values({
      id, feeId, amcosId: f.amcosId, amount: fmt2(amount), amountMinor: request.money.amount_minor, phone: payer.phone, payerName: request.customer.name,
      idempotencyKey: `cooplink_mm_${id.replace(/-/g, '')}`, request, createdById: userId, isTest: !!f.testAmount,
    }).returning();
    await sysAudit(tx, 'FEE_MOBILE_PAYMENT_REQUEST', f.amcosId, f.id, { mobilePaymentId: mp.id, amount: mp.amount, phone: localPhone(payer.phone) }, userId);
    return mp;
  });
  return sendCreate(prep);
}

/**
 * Soma hali ya malipo kwenye TeePay; yakiwa "succeeded" rekodi malipo (mara moja tu), funga ada, fungua chama.
 * Inaitwa na webhook, kitufe/ukurasa wa Meneja (kila sekunde chache) na kazi ya nyuma — matokeo ni yaleyale.
 */
export async function syncMobilePayment(mpId: string) {
  let [mp] = await db.select().from(MP).where(eq(MP.id, mpId));
  if (!mp) throw notFound('Malipo');
  if (mp.status === 'SENDING') mp = await sendCreate(mp);
  if (mp.status !== 'PENDING' || !mp.reference) return { mp, recorded: null as (typeof P.$inferSelect) | null };
  let c: Collection;
  try {
    c = (await getCollection(mp.reference)).data;
  } catch (e) {
    await db.update(MP).set({ lastError: `${(e as TeePayError).code}: ${(e as Error).message}`.slice(0, 600), lastSyncedAt: new Date() }).where(eq(MP.id, mp.id));
    throw e;
  }
  const st = mapStatus(c);
  if (st === 'PENDING') {
    const [u] = await db.update(MP).set({ lastSyncedAt: new Date(), lastError: null }).where(eq(MP.id, mp.id)).returning();
    return { mp: u, recorded: null };
  }
  if (st === 'FAILED') {
    const [u] = await db.update(MP).set({ status: 'FAILED', statusDetail: c.status_detail ?? null, lastSyncedAt: new Date() }).where(and(eq(MP.id, mp.id), eq(MP.status, 'PENDING'))).returning();
    return { mp: u ?? mp, recorded: null };
  }
  // succeeded
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from platform_fees where id = ${mp.feeId} for update`);
    const [cur] = await tx.select().from(MP).where(eq(MP.id, mp.id));
    if (cur.status === 'SUCCEEDED') return { mp: cur, recorded: null };
    const [f] = await tx.select().from(F).where(eq(F.id, mp.feeId));
    const ref = `TEEPAY:${c.public_reference ?? c.id}`;
    const amount = c.money?.amount_minor ? fromMinor(c.money.amount_minor) : mp.amount;
    let [row] = await tx.select().from(P).where(eq(P.providerRef, ref));
    if (!row && cur.isTest) {
      // JARIBIO: pesa imepokelewa na kurekodiwa (mapato), lakini ada halisi haipungui; kiasi cha majaribio kinaondolewa
      [row] = await tx.insert(P).values({
        invoiceNo: await nextInvoiceNo(tx), amcosId: f.amcosId, category: 'OTHER', amount, method: 'MOBILE_MONEY', providerRef: ref, status: 'VERIFIED',
        paidAt: new Date(), verifiedAt: new Date(), feeId: f.id,
        notes: `MAJARIBIO ya malipo (${f.label}) · simu ${localPhone(mp.phone) ?? mp.phone} (${mp.payerName})${c.channel ? ` · ${c.channel}` : ''} · TeePay ${c.public_reference ?? c.id}`,
      }).returning();
      await tx.update(F).set({ testAmount: null, updatedAt: new Date() }).where(eq(F.id, f.id));
      await sysAudit(tx, 'FEE_TEST_PAYMENT_VERIFIED', f.amcosId, f.id, { invoiceNo: row.invoiceNo, amount, ref, feeAmount: f.amount });
    }
    if (!row) {
      [row] = await tx.insert(P).values({
        invoiceNo: await nextInvoiceNo(tx), amcosId: f.amcosId, category: f.kind === 'ENTRANCE' ? 'SETUP' : 'SUBSCRIPTION',
        amount, method: 'MOBILE_MONEY', providerRef: ref, status: 'VERIFIED', paidAt: new Date(), verifiedAt: new Date(), feeId: f.id,
        notes: `${f.label} · simu ${localPhone(mp.phone) ?? mp.phone} (${mp.payerName})${c.channel ? ` · ${c.channel}` : ''} · TeePay ${c.public_reference ?? c.id}${c.fee?.amount_minor ? ` · ada ya TeePay TSh ${fromMinor(c.fee.amount_minor)}` : ''}`,
      }).returning();
      const paid = D(f.paid).plus(amount);
      const full = paid.gte(f.amount);
      const [fee] = await tx.update(F).set({ paid: fmt2(paid), status: f.status === 'WAIVED' ? 'WAIVED' : full ? 'PAID' : 'PARTIAL', paidAt: full ? new Date() : f.paidAt, updatedAt: new Date() })
        .where(eq(F.id, f.id)).returning();
      await sysAudit(tx, 'FEE_PAYMENT_VERIFIED', f.amcosId, f.id, { invoiceNo: row.invoiceNo, amount, ref, paid: fee.paid, status: fee.status });
      if (fee.kind === 'ENTRANCE' && fee.status === 'PAID') await ensureSeasonFee(tx, fee.amcosId);
    }
    const [u] = await tx.update(MP).set({ status: 'SUCCEEDED', statusDetail: null, channel: c.channel ?? c.method ?? null, paidAt: new Date(), platformPaymentId: row.id, lastError: null, lastSyncedAt: new Date() })
      .where(eq(MP.id, mp.id)).returning();
    return { mp: u, recorded: row };
  });
  clearFeeLock(mp.amcosId);
  return result;
}

/**
 * Meneja anaghairi ombi ambalo push yake haikufika, ili aombe tena. Ombi halifutwi: kwanza linaulizwa TeePay,
 * na kazi ya nyuma inaendelea kulihakiki — likija kulipwa baadaye, malipo yanarekodiwa kawaida.
 */
export async function abandonMobilePayment(mpId: string, userId: string) {
  try { await syncMobilePayment(mpId); } catch { /* TeePay haipatikani: bado tunaruhusu kughairi */ }
  const [u] = await db.update(MP).set({ abandonedAt: new Date() })
    .where(and(eq(MP.id, mpId), inArray(MP.status, OPEN), isNull(MP.abandonedAt))).returning();
  const [cur] = await db.select().from(MP).where(eq(MP.id, mpId));
  if (u) await sysAudit(db, 'FEE_MOBILE_PAYMENT_ABANDON', cur.amcosId, cur.feeId, { mobilePaymentId: cur.id, amount: cur.amount, phone: localPhone(cur.phone) }, userId);
  return { mp: cur, abandoned: !!u };
}

/** Kazi ya nyuma: ada za msimu mpya + kuhakiki malipo ya simu ambayo webhook haikufika. */
export async function runFeesSweep() {
  const ids = await db.selectDistinct({ amcosId: F.amcosId }).from(F).where(and(eq(F.kind, 'ENTRANCE'), inArray(F.status, ['PAID', 'WAIVED'])));
  let seasons = 0;
  for (const { amcosId } of ids) if (await db.transaction((tx) => ensureSeasonFee(tx, amcosId))) seasons++;
  let synced = 0, recorded = 0, errors = 0;
  if (teepayConfig().enabled) {
    const open = await db.select({ id: MP.id }).from(MP)
      .where(and(inArray(MP.status, OPEN), sql`${MP.createdAt} > now() - interval '3 days'`)).orderBy(asc(MP.lastSyncedAt)).limit(100);
    for (const m of open) {
      try { const r = await syncMobilePayment(m.id); synced++; if (r.recorded) recorded++; } catch { errors++; }
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
    .where(and(eq(P.feeId, f.id), eq(P.status, 'VERIFIED'), sql`${P.category} <> 'OTHER'`, sql`(${P.paidAt}, ${P.createdAt}) <= (select x.paid_at, x.created_at from platform_payments x where x.id = ${p.id})`));
  const paidToDate = before.reduce((t, x) => t.plus(x.amount), D(0));
  const balance = D(f.amount).minus(paidToDate);
  const a = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, p.amcosId!) }))!;
  const [mp] = await db.select().from(MP).where(eq(MP.platformPaymentId, p.id));
  const cn = !mp && p.controlNumberId ? (await db.select().from(CN).where(eq(CN.id, p.controlNumberId)))[0] : null;
  const isTest = p.category === 'OTHER';
  const message = isTest
    ? `Malipo ya majaribio ya ${tshText(p.amount)} yamepokelewa — mfumo wa malipo unafanya kazi. ${f.label} halisi (${tshText(f.amount)}) haijabadilika.`
    : f.kind === 'ENTRANCE'
    ? `Ada ya kingilio ya ${tshText(p.amount)} imepokelewa. Karibu CoopLink — utapata huduma kwa mwaka mzima.`
    : balance.lte(0)
      ? `${f.label} imelipwa kikamilifu (${tshText(f.amount)}). Asante — huduma ya CoopLink inaendelea.`
      : `Awamu ya ${f.label.toLowerCase()} ya ${tshText(p.amount)} imepokelewa. Salio ni ${tshText(balance)}, mwisho wa kulipa ni ${f.dueDate}.`;
  const method = mp ? `Simu ${localPhone(mp.phone) ?? mp.phone} (${mp.payerName})${mp.channel ? ` · ${mp.channel}` : ''}` : cn ? `Control number ${cn.number ?? ''}` : 'TeePay';
  return {
    receipt: { id: p.id, receiptNo: p.invoiceNo, amount: p.amount, paidAt: p.paidAt, providerRef: p.providerRef?.replace(/^TEEPAY:/, '') ?? null, method },
    isTest,
    fee: { id: f.id, kind: f.kind, label: f.label, amount: f.amount, paidToDate: fmt2(paidToDate), balance: fmt2(balance.gt(0) ? balance : 0), dueDate: f.dueDate },
    amcos: { id: a.id, name: a.name, code: a.code },
    message,
    business: await getSetting('business.profile'),
  };
}

/** Taarifa za ada za chama kimoja (Meneja / Owner). */
export async function feesOverview(amcosId: string) {
  const fees = await db.select().from(F).where(eq(F.amcosId, amcosId)).orderBy(asc(F.dueDate), asc(F.createdAt));
  const mps = fees.length ? await db.select().from(MP).where(eq(MP.amcosId, amcosId)).orderBy(sql`${MP.createdAt} desc`) : [];
  const pays = fees.length ? await db.select().from(P).where(and(eq(P.amcosId, amcosId), sql`${P.feeId} is not null`)).orderBy(sql`${P.paidAt} desc`) : [];
  const t = today();
  return {
    teepayEnabled: teepayConfig().enabled,
    lock: await feeLock(amcosId, { fresh: true }),
    fees: fees.map((f) => ({
      ...f, outstanding: fmt2(outstandingOf(f).gt(0) ? outstandingOf(f) : 0), overdue: ['UNPAID', 'PARTIAL'].includes(f.status) && f.dueDate < t,
      allowed: f.status === 'UNPAID' || f.status === 'PARTIAL' ? allowedAmounts(f) : [],
      mobilePayments: mps.filter((m) => m.feeId === f.id).slice(0, 10).map(({ request: _r, idempotencyKey: _k, ...m }) => ({ ...m, phoneLocal: localPhone(m.phone) ?? m.phone })),
      payments: pays.filter((p) => p.feeId === f.id).map((p) => ({ id: p.id, receiptNo: p.invoiceNo, amount: p.amount, paidAt: p.paidAt, status: p.status, isTest: p.category === 'OTHER' })),
    })),
  };
}
