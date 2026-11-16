// =====================================================================
//  SMS YA COOPLINK — msingi mmoja kwa SMS zote
//   - Mtoa huduma: AstraCall (ASTRACALL_API_KEY). Sender ID mbili: MKULIMA kwa wakulima, COOPLINK kwa watumishi.
//     Funguo zinasomwa kwenye environment tu; hazikai kwenye code wala hazionyeshwi.
//   - Kila aina ya SMS ina swichi yake (Owner) kwa sababu gharama inabebwa na CoopLink. Swichi kuu (switches.sms)
//     inazima zote kwa dharura.
//   - OTP zinatumwa papo hapo. Taarifa zinaingia kwenye foleni (ndani ya muamala — zinatumwa tu kama kazi imekamilika),
//     na zinazoandaliwa usiku zinasubiri asubuhi.
//   - Kila SMS inarekodiwa (sms_logs): aina, chama, mkulima/mtumiaji, hali, idadi ya SMS (herufi 160). Namba za OTP
//     hazihifadhiwi kwenye kumbukumbu (zinafichwa).
// =====================================================================
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db, pool, schema, type DbOrTx } from '../db';
import { getSetting } from './settings';

import crypto from 'node:crypto';
import { SMS_KINDS, smsAudience, type SmsAudience, type SmsKind } from './sms-kinds';
export { SMS_KINDS, SMS_GROUPS, SMS_EVENT_DEFAULTS, smsAudience, type SmsAudience, type SmsKind } from './sms-kinds';

export type DeliveryResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; providerRef?: string; error?: string };

// ------------------------------ MTOA HUDUMA: ASTRACALL ------------------------------
//  ASTRACALL_API_KEY (lazima) · ASTRACALL_WEBHOOK_SECRET (ripoti za kufika) · ASTRACALL_SENDER_FARMER / ASTRACALL_SENDER_STAFF (hiari)
//  Sender ID kwa anayepokea: wakulima -> MKULIMA, watumishi wa vyama na wafanyakazi wa CoopLink -> COOPLINK.
type Provider = 'ASTRACALL' | 'DRY';
/** DRY: majaribio (NODE_ENV=test au SMS_DRY_RUN=true) — hakuna SMS halisi, ujumbe unahifadhiwa kwenye kumbukumbu ya kumbukumbu tu */
export function smsProvider(): Provider | null {
  if (process.env.SMS_DRY_RUN === 'true' || process.env.NODE_ENV === 'test') return 'DRY';
  if (process.env.ASTRACALL_API_KEY) return 'ASTRACALL';
  return null;
}
export const smsConfigured = () => smsProvider() !== null;
const ASTRA_BASE = () => (process.env.ASTRACALL_BASE_URL ?? 'https://astracall.cc/api/v1').replace(/\/$/, '');
/** Sender ID kwa kila kundi la wanaopokea (majina yaliyoidhinishwa kwenye AstraCall) */
export function senderFor(audience: SmsAudience) {
  return audience === 'FARMER' ? process.env.ASTRACALL_SENDER_FARMER?.trim() || 'MKULIMA' : process.env.ASTRACALL_SENDER_STAFF?.trim() || 'COOPLINK';
}
export const senderOfKind = (kind: SmsKind | string | null | undefined) => senderFor(smsAudience(kind));

/** Ujumbe wa mwisho uliotumwa kwa DRY (kwa majaribio ya OTP tu — haujawahi kutumika production) */
export const dryOutbox: { phone: string; text: string; at: number; sender?: string }[] = [];

async function astra(path: string, init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }) {
  const res = await fetch(`${ASTRA_BASE()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${process.env.ASTRACALL_API_KEY}`, Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}
/** Kosa la AstraCall: { success:false, error:{ code, message } } */
const errText = (d: Record<string, unknown>, status: number) => {
  const e = d.error as { code?: string; message?: string } | string | undefined;
  const code = typeof e === 'object' ? e?.code : undefined;
  const msg = (typeof e === 'string' ? e : e?.message) ?? (d.message as string | undefined) ?? `HTTP ${status}`;
  return `${code ? `${code}: ` : ''}${msg} (HTTP ${status})`.slice(0, 400);
};
/** Matokeo ya kutuma: 'unknown' = AstraCall haijui kama ilipokelewa (503) — rudia kwa Idempotency-Key ileile */
export type SendOutcome = DeliveryResult & { unknown?: boolean; sender?: string };

/**
 * Kutuma SMS moja. idempotencyKey: moja kwa kila ujumbe (kurudia kwa key ileile hakutumi mara mbili).
 * AstraCall inarudisha 202 = imepokelewa kutumwa; kufika halisi kunakuja kwenye webhook (sms.delivered / sms.failed).
 */
export async function providerSend(phone: string, text: string, opts: { kind?: SmsKind | string | null; idempotencyKey?: string; reference?: string } = {}): Promise<SendOutcome> {
  const p = smsProvider();
  const sender = senderOfKind(opts.kind);
  if (!p) return { status: 'SKIPPED', error: 'Mtoa huduma wa SMS hajasanidiwa (ASTRACALL_API_KEY)', sender };
  if (p === 'DRY') { dryOutbox.push({ phone, text, at: Date.now(), sender }); if (dryOutbox.length > 200) dryOutbox.shift(); return { status: 'SENT', providerRef: 'dry-run', sender }; }
  try {
    const { res, data } = await astra('/sms/send', {
      method: 'POST', idempotencyKey: opts.idempotencyKey ?? `cl-${crypto.randomUUID()}`,
      body: { to: `+${phone}`, sender_id: sender, message: text, message_type: 'transactional', ...(opts.reference ? { reference: opts.reference.slice(0, 64) } : {}) },
    });
    const d = (data.data ?? {}) as Record<string, unknown>;
    if (res.ok && data.success !== false) return { status: 'SENT', providerRef: String(d.id ?? d.message_id ?? '') || undefined, sender };
    const code = typeof data.error === 'object' ? (data.error as { code?: string }).code : undefined;
    return { status: 'FAILED', error: errText(data, res.status), sender, unknown: res.status === 503 || code === 'submission_unknown' };
  } catch (e) {
    // Muda umeisha / mtandao: hatujui kama ilipokelewa — rudia kwa key ileile
    return { status: 'FAILED', error: (e as Error).message, sender, unknown: true };
  }
}

/** Salio na Sender ID za AstraCall (Owner: SMS Center). Hakuna funguo zinazorudishwa. */
export async function providerStatus() {
  const p = smsProvider();
  const senders = { FARMER: senderFor('FARMER'), STAFF: senderFor('STAFF') };
  const base = {
    provider: p, configured: !!p, senderId: `${senders.FARMER} · ${senders.STAFF}`, senders, balance: null as string | null, mode: null as string | null,
    senderIds: [] as string[], usable: {} as Record<string, boolean>, webhook: !!process.env.ASTRACALL_WEBHOOK_SECRET, error: null as string | null,
  };
  if (p !== 'ASTRACALL') return base;
  try {
    const b = await astra('/balance', { method: 'GET' });
    const bd = (b.data.data ?? {}) as Record<string, unknown>;
    if (b.res.ok) { base.balance = `${Number(bd.sms_balance ?? 0).toLocaleString('en-US')} ${String(bd.unit ?? 'SMS')}`; base.mode = bd.mode ? String(bd.mode) : null; }
    else base.error = errText(b.data, b.res.status);
    const s = await astra('/sender-ids', { method: 'GET' });
    const list = (s.data.data ?? []) as { sender_id?: string; status?: string; usable?: boolean }[];
    if (s.res.ok && Array.isArray(list)) {
      base.senderIds = list.map((x) => `${x.sender_id ?? ''}${x.status && x.status !== 'approved' ? ` (${x.status})` : ''}`).filter(Boolean).slice(0, 20);
      for (const x of list) if (x.sender_id) base.usable[x.sender_id.toUpperCase()] = !!x.usable;
      const missing = Object.values(senders).filter((n) => !base.usable[n.toUpperCase()]);
      if (missing.length) base.error = `${base.error ? base.error + ' · ' : ''}Sender ID haiwezi kutumika bado: ${missing.join(', ')}`;
    } else base.error = `${base.error ? base.error + ' · ' : ''}sender-ids: ${errText(s.data, s.res.status)}`;
  } catch (e) { base.error = (e as Error).message; }
  return base;
}

/**
 * Webhook ya AstraCall: X-Webhook-Signature = hex(HMAC-SHA256(ASTRACALL_WEBHOOK_SECRET, rawBody)).
 * sms.delivered / sms.failed -> hali ya SMS kwenye kumbukumbu (kwa message_id).
 */
export function verifyAstraSignature(raw: Buffer, got: string | undefined) {
  const secret = process.env.ASTRACALL_WEBHOOK_SECRET;
  if (!secret || !got) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
export async function applyDeliveryEvent(event: string, data: { message_id?: string; status?: string; error?: string | null; delivered_at?: string | null }) {
  if (!data?.message_id || !['sms.delivered', 'sms.failed'].includes(event)) return 0;
  const L = schema.smsLogs;
  const ok = event === 'sms.delivered';
  const r = await db.update(L).set(ok
    ? { status: 'DELIVERED', deliveredAt: data.delivered_at ? new Date(data.delivered_at) : new Date(), updatedAt: new Date() }
    : { status: 'FAILED', error: `Haikufika: ${String(data.error ?? data.status ?? 'failed').slice(0, 200)}`, updatedAt: new Date() })
    .where(and(eq(L.providerRef, data.message_id), eq(L.provider, 'ASTRACALL'))).returning({ id: L.id });
  return r.length;
}

// ------------------------------ MSAADA ------------------------------
/** 0754… / +255754… / 255754… -> 255754… (au null) */
export function normPhone(p: string | null | undefined) {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  const n = d.startsWith('0') && d.length === 10 ? `255${d.slice(1)}` : d.length === 9 ? `255${d}` : d;
  return /^255[67]\d{8}$/.test(n) ? n : null;
}
export const maskPhone = (p: string) => `${p.slice(0, 5)}****${p.slice(-3)}`;
const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;
/** Idadi ya SMS: herufi 160 (GSM) au 70 (Unicode) kwa SMS moja */
export function segments(text: string) {
  const gsm = GSM.test(text);
  const len = text.length;
  if (gsm) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
/** Herufi zisizo za GSM (mf. ’ “ —) zinageuzwa ili SMS isiwe ya Unicode (gharama mara 2+) */
export const toGsm = (t: string) => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/≈/g, '~').replace(/[^\S\n]+/g, ' ').trim();

export interface SmsMessage {
  kind: SmsKind; phone: string | null | undefined; text: string;
  amcosId?: string | null; memberId?: string | null; userId?: string | null; referenceType?: string; referenceId?: string | null;
  /** Kinachohifadhiwa kwenye kumbukumbu badala ya ujumbe halisi (OTP) */
  logText?: string;
}

export async function smsEnabled(kind: SmsKind) {
  const [sw, ev] = await Promise.all([getSetting('switches'), getSetting('sms.events')]);
  return sw.sms && !!ev[kind];
}
async function quietUntil(kind: SmsKind): Promise<Date | null> {
  if (SMS_KINDS[kind].urgent) return null;
  const L = await getSetting('sms.limits');
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam', hour: 'numeric', hourCycle: 'h23' }));
  const quiet = L.quietStart > L.quietEnd ? h >= L.quietStart || h < L.quietEnd : h >= L.quietStart && h < L.quietEnd;
  if (!quiet) return null;
  // saa ya kuanza tena (Afrika Mashariki = UTC+3)
  const d = new Date();
  const eat = new Date(d.getTime() + 3 * 3600_000);
  const target = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() + (h >= L.quietStart ? 1 : 0), L.quietEnd - 3, 0, 0));
  return target;
}

/** SMS ya papo hapo (OTP / tahadhari). Inarekodiwa. force = Owner kujaribu (inapita swichi za aina). */
export async function sendNow(m: SmsMessage, opts: { force?: boolean } = {}): Promise<DeliveryResult> {
  const phone = normPhone(m.phone);
  const text = toGsm(m.text);
  let r: SendOutcome;
  if (!phone) r = { status: 'SKIPPED', error: 'Namba ya simu si sahihi' };
  else if (!opts.force && !(await getSetting('switches')).sms) r = { status: 'SKIPPED', error: 'SMS zimesitishwa kwa swichi kuu' };
  else if (!opts.force && !(await getSetting('sms.events'))[m.kind]) r = { status: 'SKIPPED', error: 'Aina hii ya SMS imezimwa na Owner' };
  else {
    // Haijulikani kama ilipokelewa (503 / muda umeisha): jaribu mara moja tena kwa Idempotency-Key ileile — haitumwi mara mbili
    const key = `cl-${crypto.randomUUID()}`;
    let o = await providerSend(phone, text, { kind: m.kind, idempotencyKey: key, reference: m.referenceType ?? undefined });
    if (o.unknown) o = await providerSend(phone, text, { kind: m.kind, idempotencyKey: key, reference: m.referenceType ?? undefined });
    r = o;
  }
  await db.insert(schema.smsLogs).values({
    amcosId: m.amcosId ?? null, phone: phone ?? String(m.phone ?? ''), message: m.logText ?? text, status: r.status, provider: smsProvider(), providerRef: r.providerRef ?? null, error: r.error ?? null,
    senderId: senderOfKind(m.kind),
    kind: m.kind, memberId: m.memberId ?? null, userId: m.userId ?? null, segments: segments(text), referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null,
    attempts: 1, sentAt: r.status === 'SENT' ? new Date() : null,
  }).catch((e) => console.error('[sms] kumbukumbu:', (e as Error).message));
  return r;
}

/**
 * Taarifa kwenye foleni — ndani ya muamala wa kazi husika (ikirudishwa nyuma, SMS haitumwi).
 * Aina iliyozimwa au namba isiyo sahihi: hakuna kinachoandikwa. Inarudisha idadi iliyowekwa kwenye foleni.
 */
export async function enqueue(tx: DbOrTx, list: SmsMessage | SmsMessage[]) {
  const msgs = (Array.isArray(list) ? list : [list]);
  if (!msgs.length) return 0;
  const [sw, ev] = await Promise.all([getSetting('switches'), getSetting('sms.events')]);
  if (!sw.sms) return 0;
  const rows = [];
  for (const m of msgs) {
    const phone = normPhone(m.phone);
    if (!ev[m.kind] || !phone) continue;
    const text = toGsm(m.text);
    rows.push({ amcosId: m.amcosId ?? null, phone, message: text, status: 'QUEUED' as const, kind: m.kind, memberId: m.memberId ?? null, userId: m.userId ?? null, senderId: senderOfKind(m.kind),
      segments: segments(text), referenceType: m.referenceType ?? null, referenceId: m.referenceId ?? null, sendAfter: await quietUntil(m.kind) });
  }
  if (rows.length) { await tx.insert(schema.smsLogs).values(rows); scheduleFlush(); }
  return rows.length;
}

// ------------------------------ KUTUMA FOLENI ------------------------------
const FLUSH_LOCK = 815_101;
let timer: NodeJS.Timeout | null = null;
/** Foleni inatumwa muda mfupi baada ya muamala kukamilika (na kazi ya nyuma kila dakika) */
export function scheduleFlush(ms = 800) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void flushSms().catch((e) => console.error('[sms] foleni:', (e as Error).message)); }, ms);
  timer.unref?.();
}

export async function flushSms(limit = 200) {
  const client = await pool.connect().catch(() => null);
  if (!client) return { sent: 0 };
  let sent = 0, failed = 0, skipped = 0;
  try {
    const got = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [FLUSH_LOCK]);
    if (!got.rows[0].ok) return { sent };
    try {
      const L = schema.smsLogs;
      const due = await db.select().from(L).where(and(eq(L.status, 'QUEUED'), or(isNull(L.sendAfter), lte(L.sendAfter, new Date())))).orderBy(asc(L.createdAt)).limit(limit);
      const [sw, ev] = await Promise.all([getSetting('switches', { fresh: true }), getSetting('sms.events', { fresh: true })]);
      for (const m of due) {
        // Idempotency-Key: ileile kama jaribio lililopita halikujulikana (503), mpya kama lilishindwa kweli
        const unknownBefore = !!m.error?.startsWith('[unknown]');
        const key = `cl-${m.id}-${unknownBefore ? m.attempts - 1 : m.attempts}`;
        const r: SendOutcome = !sw.sms ? { status: 'SKIPPED', error: 'SMS zimesitishwa kwa swichi kuu' }
          : m.kind && !ev[m.kind as SmsKind] ? { status: 'SKIPPED', error: 'Aina hii ya SMS imezimwa na Owner' }
          : await providerSend(m.phone, m.message, { kind: m.kind, idempotencyKey: key, reference: m.referenceType ?? undefined });
        // Imeshindwa: inajaribiwa tena mara 2 (kila baada ya dakika 5); haijulikani (503): mara 4 kwa key ileile
        const retry = r.status === 'FAILED' && (r.unknown ? m.attempts < 4 : m.attempts < 2);
        await db.update(L).set({
          status: retry ? 'QUEUED' : r.status, attempts: m.attempts + 1, provider: smsProvider(), providerRef: r.providerRef ?? null,
          error: r.error ? `${r.unknown && retry ? '[unknown] ' : ''}${r.error}` : null, senderId: r.sender ?? m.senderId,
          sentAt: r.status === 'SENT' ? new Date() : null, sendAfter: retry ? new Date(Date.now() + 5 * 60_000) : m.sendAfter, updatedAt: new Date(),
        }).where(eq(L.id, m.id));
        if (r.status === 'SENT') sent++; else if (r.status === 'FAILED') failed++; else skipped++;
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [FLUSH_LOCK]);
    }
  } finally {
    client.release();
  }
  return { sent, failed, skipped };
}

/** SMS za chama mwezi huu (kikomo cha matangazo) */
export async function broadcastUsedThisMonth(amcosId: string) {
  const [r] = (await db.execute<{ n: number }>(sql`
    select coalesce(sum(segments), 0)::int as n from sms_logs
    where amcos_id = ${amcosId} and kind = 'CHAMA_BROADCAST' and status <> 'SKIPPED'
      and created_at >= date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') at time zone 'Africa/Dar_es_Salaam'`)).rows;
  return r?.n ?? 0;
}
