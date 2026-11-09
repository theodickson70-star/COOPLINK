// =====================================================================
//  Abliner (https://abliner.net/docs) — njia ya PILI ya malipo ya ada za CoopLink kwa simu (USSD push).
//  Siri zinasomwa kwenye environment TU. Kiasi ni shilingi kamili (si senti).
//  Kila POST /deposits inasainiwa: hex(HMAC-SHA256(whsec, `${ts}.${body}`)) — body inatumwa NENO KWA NENO.
// =====================================================================
import crypto from 'node:crypto';
import { TeePayError } from './teepay';

export function ablinerConfig() {
  const apiKey = process.env.ABLINER_API_KEY?.trim() || undefined;
  const webhookSecret = process.env.ABLINER_WEBHOOK_SECRET?.trim() || undefined;
  const baseUrl = (process.env.ABLINER_BASE_URL?.trim() || 'https://abliner.net/api/v1').replace(/\/+$/, '');
  // Deposits zinahitaji saini, kwa hiyo bila siri ya webhook Abliner haiwezi kupokea malipo
  return { apiKey, webhookSecret, baseUrl, enabled: !!apiKey && !!webhookSecret };
}

/** Makosa ya Abliner yanatumia umbo lilelile la makosa ya mtoa huduma (status, code, permanent). */
export class AblinerError extends TeePayError {}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const cfg = ablinerConfig();
  if (!cfg.apiKey) throw new AblinerError(503, 'not_configured', 'Abliner haijawashwa (ABLINER_API_KEY haipo)');
  const raw = body !== undefined ? JSON.stringify(body) : undefined;
  const sign: Record<string, string> = {};
  if (raw !== undefined && cfg.webhookSecret) {
    const ts = Math.floor(Date.now() / 1000).toString();
    sign['x-abliner-timestamp'] = ts;
    sign['x-abliner-signature'] = crypto.createHmac('sha256', cfg.webhookSecret).update(`${ts}.${raw}`).digest('hex');
  }
  let r: Response;
  try {
    r = await fetch(cfg.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
        ...(raw !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...sign,
        ...extraHeaders,
      },
      body: raw,
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new AblinerError(599, 'network_error', `Imeshindikana kuwasiliana na Abliner: ${(e as Error).message}`);
  }
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* si JSON */ }
  if (!r.ok) {
    const err = json?.error && typeof json.error === 'object' ? json.error : json ?? {};
    const code = String(err.code ?? json?.code ?? 'error');
    const extra = [err.field ? `field=${err.field}` : '', err.errors ? JSON.stringify(err.errors).slice(0, 300) : ''].filter(Boolean).join(' ');
    console.warn(`[abliner] ${method} ${path.split('?')[0]} -> ${r.status} ${code}${extra ? ' ' + extra : ''}`);
    throw new AblinerError(r.status, code, `${String(err.message ?? json?.message ?? `Abliner HTTP ${r.status}`)}${extra ? ` (${extra})` : ''}`, err.transaction_id ?? json?.transaction_id);
  }
  return { status: r.status, data: json as T };
}

export interface DepositCreate { amount: number; method: 'mobile'; currency: 'TZS'; phone: string; reference: string }
export interface AblinerTxn {
  id: string; type?: string; status: string; amount?: number; amount_cents?: number; currency?: string;
  reference?: string; customer_reference?: string; provider_reference?: string; method?: string; message?: string;
}
const unwrap = <T>(j: any): T => (j && typeof j === 'object' && 'data' in j ? j.data : j) as T;

/** Push ya USSD. Idempotency-Key ileile ndani ya saa 24 inarudisha muamala uleule bila push mpya. */
export async function createDeposit(body: DepositCreate, idempotencyKey: string) {
  const r = await request<unknown>('POST', '/deposits', body, { 'Idempotency-Key': idempotencyKey });
  return { status: r.status, data: unwrap<AblinerTxn>(r.data) };
}

/** Tafuta muamala kwa Idempotency-Key (Abliner hawana endpoint ya hali moja kwa moja). */
export async function findDeposit(idempotencyKey: string): Promise<AblinerTxn | null> {
  const r = await request<unknown>('GET', `/transactions?limit=5&idempotency_key=${encodeURIComponent(idempotencyKey)}`);
  const d = unwrap<unknown>(r.data);
  const list = (Array.isArray(d) ? d : Array.isArray((d as any)?.transactions) ? (d as any).transactions : Array.isArray((d as any)?.items) ? (d as any).items : []) as AblinerTxn[];
  return list[0] ?? null;
}

/** Hali ya Abliner -> hali yetu */
export const ablinerStatus = (s?: string): 'SUCCEEDED' | 'FAILED' | 'PENDING' =>
  ['completed', 'success', 'successful', 'succeeded', 'paid'].includes(String(s).toLowerCase()) ? 'SUCCEEDED'
    : ['failed', 'cancelled', 'canceled', 'expired', 'rejected', 'reversed'].includes(String(s).toLowerCase()) ? 'FAILED' : 'PENDING';

/** Webhook: hex(HMAC-SHA256(whsec, `${timestamp}.${rawBody}`)), ndani ya dakika 5 (inakubali pia "v1=" mbele). */
export function verifyAblinerSignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs = Date.now()) {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const got = signature.trim().toLowerCase().replace(/^(v1=|sha256=)/, '');
  const a = Buffer.from(expected), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
