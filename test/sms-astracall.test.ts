// AstraCall (v0.41): muundo wa ombi kulingana na nyaraka, Sender ID kwa anayepokea, kurudia kwa Idempotency-Key, webhook
process.env.SMS_DRY_RUN = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool, schema } from '../src/db';
import { dryOutbox, providerSend, providerStatus, senderOfKind, sendNow, smsAudience, SMS_KINDS, type SmsKind } from '../src/lib/sms';
import { clearSettingsCache } from '../src/lib/settings';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); await pool.end(); });

/** Inaendesha fn kana kwamba ni production na AstraCall (fetch ya AstraCall inaigwa) */
async function withAstra<T>(handler: (url: string, init: RequestInit) => { status: number; body: unknown }, fn: (calls: { url: string; init: RequestInit }[]) => Promise<T>) {
  const env = { NODE_ENV: process.env.NODE_ENV, SMS_DRY_RUN: process.env.SMS_DRY_RUN, KEY: process.env.ASTRACALL_API_KEY };
  const realFetch = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  process.env.NODE_ENV = 'production'; delete process.env.SMS_DRY_RUN; process.env.ASTRACALL_API_KEY = 'sk_test_unit';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://astracall.cc/')) return realFetch(input, init);
    calls.push({ url, init: init ?? {} });
    const r = handler(url, init ?? {});
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try { return await fn(calls); } finally {
    globalThis.fetch = realFetch;
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.SMS_DRY_RUN === undefined) delete process.env.SMS_DRY_RUN; else process.env.SMS_DRY_RUN = env.SMS_DRY_RUN;
    if (env.KEY === undefined) delete process.env.ASTRACALL_API_KEY; else process.env.ASTRACALL_API_KEY = env.KEY;
  }
}

test('Sender ID: MKULIMA kwa kila SMS ya mkulima, COOPLINK kwa watumishi', () => {
  const staff: SmsKind[] = ['LOGIN_OTP', 'PASSWORD_RESET_OTP', 'STAFF_CREDENTIALS', 'SECURITY_ALERT', 'OWNER_ANNOUNCEMENT', 'STAFF_ALERT', 'SYSTEM_ALERT'];
  for (const k of Object.keys(SMS_KINDS) as SmsKind[]) {
    assert.equal(smsAudience(k), staff.includes(k) ? 'STAFF' : 'FARMER', k);
    assert.equal(senderOfKind(k), staff.includes(k) ? 'COOPLINK' : 'MKULIMA', k);
  }
  // OTP zote za mkulima na matangazo ya chama kwa wakulima ni MKULIMA
  for (const k of ['MEMBER_PHONE_OTP', 'CASH_PAYOUT_OTP', 'GROUP_CONSENT_OTP', 'FARMER_PORTAL_PIN', 'ISSUE_HANDOVER_OTP', 'CHAMA_BROADCAST', 'GROUP_DEBT', 'SALE_SETTLED'] as SmsKind[]) assert.equal(senderOfKind(k), 'MKULIMA');
});

test('AstraCall: POST /sms/send kwa Bearer key, +255, sender ID na Idempotency-Key; 202 = imepokelewa', async () => {
  await withAstra(() => ({ status: 202, body: { success: true, data: { id: 'msg-abc', status: 'queued' } } }), async (calls) => {
    const r = await providerSend('255712345678', 'Habari', { kind: 'SALE_SETTLED', idempotencyKey: 'cl-test-1', reference: 'Settlement' });
    assert.deepEqual([r.status, r.providerRef, r.sender], ['SENT', 'msg-abc', 'MKULIMA']);
    assert.equal(calls[0].url, 'https://astracall.cc/api/v1/sms/send');
    const h = calls[0].init.headers as Record<string, string>;
    assert.equal(h.Authorization, 'Bearer sk_test_unit');
    assert.equal(h['Idempotency-Key'], 'cl-test-1');
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual([body.to, body.sender_id, body.message, body.message_type], ['+255712345678', 'MKULIMA', 'Habari', 'transactional']);
    const s = await providerSend('255712345678', 'Karibu', { kind: 'LOGIN_OTP' });
    assert.equal(s.sender, 'COOPLINK');
    assert.equal(JSON.parse(String(calls[1].init.body)).sender_id, 'COOPLINK');
  });
});

test('AstraCall: makosa — 402 salio, 503 haijulikani (inarudiwa kwa key ileile), sendNow inarekodi sender', async () => {
  await withAstra(() => ({ status: 402, body: { success: false, error: { code: 'insufficient_balance', message: 'Not enough SMS balance' } } }), async () => {
    const r = await providerSend('255712345678', 'x', { kind: 'STAFF_ALERT' });
    assert.equal(r.status, 'FAILED'); assert.match(r.error!, /insufficient_balance/); assert.ok(!r.unknown);
  });
  let n = 0;
  await withAstra(() => (++n === 1 ? { status: 503, body: { success: false, error: { code: 'submission_unknown', message: 'retry' } } } : { status: 202, body: { success: true, data: { id: 'msg-2' } } }), async (calls) => {
    const r = await sendNow({ kind: 'SYSTEM_ALERT', phone: '0712000111', text: 'Tahadhari' }, { force: true });
    assert.equal(r.status, 'SENT');
    assert.equal(calls.length, 2);
    const k1 = (calls[0].init.headers as Record<string, string>)['Idempotency-Key'], k2 = (calls[1].init.headers as Record<string, string>)['Idempotency-Key'];
    assert.equal(k1, k2, 'Jaribio la pili linatumia key ileile — SMS haitumwi mara mbili');
    const log = (await db.execute<{ sender_id: string; provider: string; provider_ref: string }>(sql`select sender_id, provider, provider_ref from sms_logs where provider_ref = 'msg-2'`)).rows[0];
    assert.deepEqual([log.sender_id, log.provider], ['COOPLINK', 'ASTRACALL']);
  });
});

test('AstraCall: salio na sender IDs (zinazotumika) kwa Owner', async () => {
  await withAstra((url) => url.endsWith('/balance')
    ? { status: 200, body: { success: true, data: { sms_balance: 950, unit: 'SMS', mode: 'live' } } }
    : { status: 200, body: { success: true, data: [{ sender_id: 'MKULIMA', status: 'approved', usable: true }, { sender_id: 'COOPLINK', status: 'approved', usable: true }] } }, async () => {
    const s = await providerStatus();
    assert.equal(s.balance, '950 SMS'); assert.equal(s.mode, 'live');
    assert.deepEqual(s.usable, { MKULIMA: true, COOPLINK: true });
    assert.equal(s.error, null);
  });
});

test('Webhook ya AstraCall: saini ya HMAC inahakikiwa; sms.delivered -> DELIVERED, sms.failed -> FAILED, tukio moja mara moja', async () => {
  const post = (body: unknown, sig?: string) => fetch(`${base}/api/v1/public/astracall/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-webhook-signature': sig } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ id: 'x' })).status, 503, 'Bila siri: haipokelewi');
  process.env.ASTRACALL_WEBHOOK_SECRET = 'whsec_unit_test';
  try {
    const ref = `msg-${Date.now()}`, ref2 = `${ref}-b`;
    await db.insert(schema.smsLogs).values([
      { phone: '255712000222', message: 'a', status: 'SENT', provider: 'ASTRACALL', providerRef: ref, kind: 'SALE_SETTLED' },
      { phone: '255712000223', message: 'b', status: 'SENT', provider: 'ASTRACALL', providerRef: ref2, kind: 'SALE_SETTLED' },
    ]);
    const ev = { id: `ev-${ref}`, event: 'sms.delivered', created_at: new Date().toISOString(), data: { message_id: ref, status: 'delivered', delivered_at: '2026-11-16T09:15:00.000Z' } };
    const raw = JSON.stringify(ev);
    const sig = crypto.createHmac('sha256', 'whsec_unit_test').update(raw).digest('hex');
    assert.equal((await post(ev, 'deadbeef')).status, 401, 'Saini mbaya inakataliwa');
    const ok = await post(ev, sig);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).updated, 1);
    assert.equal(((await (await post(ev, sig)).json()) as { duplicate?: boolean }).duplicate, true);
    const fev = { id: `ev-${ref2}`, event: 'sms.failed', data: { message_id: ref2, status: 'failed', error: 'invalid_recipient' } };
    assert.equal((await post(fev, crypto.createHmac('sha256', 'whsec_unit_test').update(JSON.stringify(fev)).digest('hex'))).status, 200);
    const rows = (await db.execute<{ provider_ref: string; status: string; delivered_at: string | null; error: string | null }>(sql`select provider_ref, status, delivered_at, error from sms_logs where provider_ref in (${ref}, ${ref2}) order by provider_ref`)).rows;
    assert.equal(rows[0].status, 'DELIVERED'); assert.ok(rows[0].delivered_at);
    assert.equal(rows[1].status, 'FAILED'); assert.match(rows[1].error!, /invalid_recipient/);
  } finally { delete process.env.ASTRACALL_WEBHOOK_SECRET; }
});

test('DRY (majaribio): ujumbe unahifadhiwa na sender yake', async () => {
  clearSettingsCache();
  const r = await sendNow({ kind: 'MEMBER_PHONE_OTP', phone: '0712000333', text: 'OTP 123456' }, { force: true });
  assert.equal(r.status, 'SENT');
  assert.equal([...dryOutbox].reverse().find((x) => x.phone === '255712000333')!.sender, 'MKULIMA');
});
