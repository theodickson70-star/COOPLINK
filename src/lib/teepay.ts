// =====================================================================
//  TeePay (https://docs.teepay.me) — control numbers za ada za CoopLink.
//  Siri (API key na webhook secret) zinasomwa kwenye environment TU; hazichapishwi kwenye logs.
//  Kiasi: TeePay inatumia "minor units" (TZS: 100 = TSh 1.00).
// =====================================================================
import crypto from 'node:crypto';
import { D, fmt2 } from './money';

export function teepayConfig() {
  const apiKey = process.env.TEEPAY_API_KEY?.trim() || undefined;
  const webhookSecret = process.env.TEEPAY_WEBHOOK_SECRET?.trim() || undefined;
  const baseUrl = (process.env.TEEPAY_BASE_URL?.trim() || 'https://api.teepay.me').replace(/\/+$/, '');
  return { apiKey, webhookSecret, baseUrl, enabled: !!apiKey };
}

export class TeePayError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); }
  /** Kosa la kudumu (ombi lenyewe si sahihi) — kurudia hakutasaidia. */
  get permanent() { return [400, 401, 403, 404, 409, 422].includes(this.status); }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<{ status: number; data: T }> {
  const cfg = teepayConfig();
  if (!cfg.apiKey) throw new TeePayError(503, 'not_configured', 'Malipo kwa control number hayajawashwa (TEEPAY_API_KEY haipo)');
  let r: Response;
  try {
    r = await fetch(cfg.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new TeePayError(503, 'network_error', `Imeshindikana kuwasiliana na TeePay: ${(e as Error).message}`);
  }
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* si JSON */ }
  if (!r.ok) {
    const err = json?.error ?? json ?? {};
    // Maelezo ya ziada ya TeePay (mf. sehemu gani ya ombi si sahihi) yanahifadhiwa ili kosa lieleweke
    const { code: _c, message: _m, request_id: _r, ...extra } = typeof err === 'object' && err ? err : ({} as Record<string, unknown>);
    const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra).slice(0, 400)}` : '';
    if (!r.ok && r.status !== 404) console.warn(`[teepay] ${method} ${path} -> ${r.status} ${err.code ?? ''}${detail}`);
    throw new TeePayError(r.status, String(err.code ?? 'error'), String(err.message ?? `TeePay HTTP ${r.status}`) + detail, err.request_id ?? json?.request_id);
  }
  return { status: r.status, data: json as T };
}

export interface CnCreate {
  kind: 'bill' | 'customer';
  customer: { name: string; phone?: string; email?: string };
  description?: string;
  amount_minor?: string;
  payment_mode?: 'EXACT' | 'ALLOW_PARTIAL_AND_OVER_PAYMENT';
}
export interface CnPayment { id?: string; status: string; reference?: string; amount_minor?: string; fee_minor?: string; paid_at?: string; received_at?: string }
export interface CnResource {
  id: string; number: string | null; status?: string; currency?: string;
  amount_minor?: string; collected_minor?: string; remaining_minor?: string; payment_count?: number;
  payments?: CnPayment[];
}

/** 201 = namba imetolewa; 202 = bado (rudia kwa Idempotency-Key ileile, SI mpya). */
export const createControlNumber = (body: CnCreate, idempotencyKey: string) =>
  request<CnResource>('POST', '/v1/control-numbers', body, idempotencyKey);
export const getControlNumber = (id: string) => request<CnResource>('GET', `/v1/control-numbers/${encodeURIComponent(id)}`);

export const toMinor = (amount: string | number) => D(amount).times(100).toFixed(0);
export const fromMinor = (minor: string | number) => fmt2(D(minor).dividedBy(100));

/**
 * Hakiki saini ya webhook: v1=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), muda ndani ya dakika 5.
 */
export function verifyWebhookSignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string, nowMs = Date.now()) {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
