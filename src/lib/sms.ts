// =====================================================================
//  SMS YA COOPLINK — msingi mmoja kwa SMS zote
//   - Mtoa huduma: RodSMS (RODSMS_API_KEY + RODSMS_SENDER_ID) — au Africa's Talking (AT_USERNAME + AT_API_KEY).
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

import { SMS_KINDS, type SmsKind } from './sms-kinds';
export { SMS_KINDS, SMS_GROUPS, SMS_EVENT_DEFAULTS, type SmsKind } from './sms-kinds';

export type DeliveryResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; providerRef?: string; error?: string };

// ------------------------------ MTOA HUDUMA ------------------------------
type Provider = 'RODSMS' | 'AT' | 'DRY';
/** DRY: majaribio (NODE_ENV=test au SMS_DRY_RUN=true) — hakuna SMS halisi, ujumbe unahifadhiwa kwenye kumbukumbu ya kumbukumbu tu */
export function smsProvider(): Provider | null {
  if (process.env.SMS_DRY_RUN === 'true' || process.env.NODE_ENV === 'test') return 'DRY';
  if (process.env.RODSMS_API_KEY) return 'RODSMS';
  if (process.env.AT_USERNAME && process.env.AT_API_KEY) return 'AT';
  return null;
}
export const smsConfigured = () => smsProvider() !== null;
const RODSMS_BASE = () => (process.env.RODSMS_BASE_URL ?? 'https://rodsms.com/api/v1').replace(/\/$/, '');
export const senderId = () => (smsProvider() === 'RODSMS' ? process.env.RODSMS_SENDER_ID?.trim() || (senderCache?.v ? `${senderCache.v} (auto)` : null) : process.env.AT_SENDER_ID) ?? null;

/** Ujumbe wa mwisho uliotumwa kwa DRY (kwa majaribio ya OTP tu — haujawahi kutumika production) */
export const dryOutbox: { phone: string; text: string; at: number }[] = [];

async function rodsms(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const res = await fetch(`${RODSMS_BASE()}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${process.env.RODSMS_API_KEY}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}
/** Kosa kamili la mtoa huduma: ujumbe + makosa yote ya fields (mf. Laravel: { message, errors: { field: [..] } }) */
const errText = (d: Record<string, unknown>, status: number) => {
  const e = d.error as { code?: string; message?: string } | string | undefined;
  const head = (typeof e === 'string' ? e : e?.message ?? e?.code) ?? (d.message as string | undefined) ?? `HTTP ${status}`;
  const errs = d.errors && typeof d.errors === 'object'
    ? Object.entries(d.errors as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : String(v)}`).join('; ')
    : '';
  return (errs ? `${errs} (HTTP ${status})` : `${head} (HTTP ${status})`).slice(0, 400);
};

/** Sender ID: RODSMS_SENDER_ID, au ya kwanza iliyoidhinishwa kwenye akaunti ya RodSMS (inakumbukwa saa 1) */
let senderCache: { v: string | null; at: number } | null = null;
const senderOf = (x: unknown) => typeof x === 'string' ? x : String((x as Record<string, unknown>)?.sender_id ?? (x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.sender ?? '');
async function rodsmsSender(): Promise<string | null> {
  const env = process.env.RODSMS_SENDER_ID?.trim();
  if (env) return env;
  if (senderCache && Date.now() - senderCache.at < 3600_000) return senderCache.v;
  let v: string | null = null;
  try {
    const { res, data } = await rodsms('/sender-ids', { method: 'GET' });
    const list = (data.data ?? data.sender_ids ?? data) as unknown;
    if (res.ok && Array.isArray(list)) {
      const ok = list.find((x) => /approved|active/i.test(String((x as Record<string, unknown>)?.status ?? 'approved'))) ?? list[0];
      v = ok ? senderOf(ok) || null : null;
    }
  } catch { /* hakuna */ }
  senderCache = { v, at: Date.now() };
  return v;
}

export async function providerSend(phone: string, text: string): Promise<DeliveryResult> {
  const p = smsProvider();
  if (!p) return { status: 'SKIPPED', error: 'Mtoa huduma wa SMS hajasanidiwa (RODSMS_API_KEY au AT_USERNAME/AT_API_KEY)' };
  if (p === 'DRY') { dryOutbox.push({ phone, text, at: Date.now() }); if (dryOutbox.length > 200) dryOutbox.shift(); return { status: 'SENT', providerRef: 'dry-run' }; }
  try {
    if (p === 'RODSMS') {
      // RodSMS API v1: POST /messages (namba 255XXXXXXXXX, Sender ID iliyoidhinishwa, SMS ya kawaida ya huduma)
      const sender = await rodsmsSender();
      if (!sender) return { status: 'FAILED', error: 'Sender ID haipo: weka RODSMS_SENDER_ID kwenye Railway (jina la Sender ID iliyoidhinishwa kwenye RodSMS)' };
      const { res, data } = await rodsms('/messages', { method: 'POST', body: { sender_id: sender, to: phone, message: text, sms_type: 'transactional' } });
      const d = (data.data ?? data) as Record<string, unknown>;
      if (res.ok && !data.error) return { status: 'SENT', providerRef: String(d.id ?? d.message_id ?? d.messageId ?? '') || undefined };
      return { status: 'FAILED', error: errText(data, res.status) };
    }
    const username = process.env.AT_USERNAME!;
    const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const body = new URLSearchParams({ username, to: `+${phone}`, message: text });
    if (process.env.AT_SENDER_ID) body.set('from', process.env.AT_SENDER_ID);
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST', headers: { apiKey: process.env.AT_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { status?: string; messageId?: string }[]; Message?: string } };
    const r = data.SMSMessageData?.Recipients?.[0];
    if (res.ok && r?.status === 'Success') return { status: 'SENT', providerRef: r.messageId };
    return { status: 'FAILED', error: r?.status ?? data.SMSMessageData?.Message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { status: 'FAILED', error: (e as Error).message };
  }
}

/** Salio na Sender ID za mtoa huduma (Owner: SMS Center). Hakuna funguo zinazorudishwa. */
export async function providerStatus() {
  const p = smsProvider();
  const base = { provider: p, configured: !!p, senderId: senderId(), balance: null as string | null, senderIds: [] as string[], error: null as string | null };
  if (p !== 'RODSMS') return base;
  try {
    const b = await rodsms('/balance', { method: 'GET' });
    const bd = (b.data.data ?? b.data) as Record<string, unknown>;
    if (b.res.ok) base.balance = String(bd.balance ?? bd.credits ?? bd.sms_balance ?? JSON.stringify(bd)).slice(0, 80);
    else base.error = errText(b.data, b.res.status);
    const s = await rodsms('/sender-ids', { method: 'GET' });
    const list = (s.data.data ?? s.data.sender_ids ?? s.data) as unknown;
    if (!(s.res.ok && Array.isArray(list))) base.error = `${base.error ? base.error + ' · ' : ''}sender-ids: ${s.res.ok ? JSON.stringify(s.data).slice(0, 200) : errText(s.data, s.res.status)}`;
    if (s.res.ok && Array.isArray(list)) base.senderIds = list.map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).sender_id ?? ''))).filter(Boolean).slice(0, 20);
  } catch (e) { base.error = (e as Error).message; }
  return base;
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
  let r: DeliveryResult;
  if (!phone) r = { status: 'SKIPPED', error: 'Namba ya simu si sahihi' };
  else if (!opts.force && !(await getSetting('switches')).sms) r = { status: 'SKIPPED', error: 'SMS zimesitishwa kwa swichi kuu' };
  else if (!opts.force && !(await getSetting('sms.events'))[m.kind]) r = { status: 'SKIPPED', error: 'Aina hii ya SMS imezimwa na Owner' };
  else r = await providerSend(phone, text);
  await db.insert(schema.smsLogs).values({
    amcosId: m.amcosId ?? null, phone: phone ?? String(m.phone ?? ''), message: m.logText ?? text, status: r.status, provider: smsProvider(), providerRef: r.providerRef ?? null, error: r.error ?? null,
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
    rows.push({ amcosId: m.amcosId ?? null, phone, message: text, status: 'QUEUED' as const, kind: m.kind, memberId: m.memberId ?? null, userId: m.userId ?? null,
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
        const r: DeliveryResult = !sw.sms ? { status: 'SKIPPED', error: 'SMS zimesitishwa kwa swichi kuu' }
          : m.kind && !ev[m.kind as SmsKind] ? { status: 'SKIPPED', error: 'Aina hii ya SMS imezimwa na Owner' }
          : await providerSend(m.phone, m.message);
        // Imeshindwa: inajaribiwa tena mara 2 (kila baada ya dakika 5)
        const retry = r.status === 'FAILED' && m.attempts < 2;
        await db.update(L).set({
          status: retry ? 'QUEUED' : r.status, attempts: m.attempts + 1, provider: smsProvider(), providerRef: r.providerRef ?? null, error: r.error ?? null,
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
