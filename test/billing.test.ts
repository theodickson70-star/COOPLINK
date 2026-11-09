// Ada za CoopLink: kingilio (siku 3) + ada ya msimu (awamu 2, mwisho 15/10) kwa mitandao ya simu (TeePay).
// TeePay inaigizwa na seva ndogo ya majaribio (hakuna pesa halisi wala mtandao wa nje).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { clearFeeLock } from '../src/lib/fees';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 100000)).slice(-7);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const SECRET = 'whsec_test_' + RUN;

// ------------------------- TeePay ya kuigiza -------------------------
interface MockCol { id: string; ref: string; amount_minor: string; body: string; status: string; detail?: string }
const mock = { cols: new Map<string, MockCol>(), byKey: new Map<string, MockCol>(), creates: [] as { key: string; body: string }[], fail503Once: true };
let mockServer: http.Server;
function startMock() {
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== 'Bearer tp_test_mock.secret') return send(401, { error: { code: 'invalid_credential', message: 'bad key' } });
      if (req.method === 'POST' && req.url === '/v1/collections') {
        const key = String(req.headers['idempotency-key'] ?? '');
        mock.creates.push({ key, body });
        if (mock.fail503Once) { mock.fail503Once = false; return send(503, { error: { code: 'provider_unavailable', message: 'try later' } }); }
        const prev = mock.byKey.get(key);
        if (prev && prev.body !== body) return send(409, { error: { code: 'idempotency_conflict', message: 'different body' } });
        const j = JSON.parse(body);
        if (!j.customer?.email || String(j.customer?.name).split(' ').length < 2) return send(422, { error: { code: 'invalid_request', message: 'invalid', field: 'customer' } });
        const col = prev ?? { id: crypto.randomUUID(), ref: 'TP' + crypto.randomBytes(4).toString('hex').toUpperCase(), amount_minor: j.money.amount_minor, body, status: 'pending' };
        mock.byKey.set(key, col); mock.cols.set(col.ref, col);
        return send(202, { id: col.id, public_reference: col.ref, operation: 'charge', status: col.status, money: { amount_minor: col.amount_minor, currency: 'TZS' } });
      }
      const m = req.url?.match(/^\/v1\/collections\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        const col = mock.cols.get(decodeURIComponent(m[1]));
        if (!col) return send(404, { error: { code: 'not_found', message: 'nf' } });
        return send(200, { id: col.id, public_reference: col.ref, operation: 'charge', status: col.status, status_detail: col.detail, money: { amount_minor: col.amount_minor, currency: 'TZS' }, fee: { amount_minor: '90000', currency: 'TZS' }, channel: 'MPESA' });
      }
      send(404, { error: { code: 'not_found', message: req.url } });
    });
  }).listen(0);
  return `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
}
const finish = (ref: string, status: 'succeeded' | 'failed', detail?: string) => { const c = mock.cols.get(ref)!; c.status = status; c.detail = detail; };
async function webhook(ref: string, opts: { eventId?: string; badSig?: boolean; type?: string } = {}) {
  const eventId = opts.eventId ?? crypto.randomUUID();
  const type = opts.type ?? 'payment.completed';
  const raw = JSON.stringify({ id: eventId, type, event: type, environment: 'sandbox', data: { reference: ref, status: type === 'payment.completed' ? 'succeeded' : 'failed' } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v1=' + crypto.createHmac('sha256', opts.badSig ? 'whsec_wrong' : SECRET).update(`${ts}.${raw}`).digest('hex');
  const r = await fetch(base + '/api/v1/public/teepay/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-teepay-event-id': eventId, 'x-teepay-timestamp': ts, 'x-teepay-signature': sig }, body: raw });
  return { status: r.status, body: await r.json() as any };
}
const PAYER = { phone: '0712345678', name: 'Theo Baruth', email: 'meneja@example.com' };

// ------------------------------ msaada ------------------------------
async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: json };
}
const login = (phone: string, password: string) => call('POST', '/api/v1/auth/login', undefined, { phone, password });

let owner: string, manager: string, clerkPhone: string, amcosId: string;
const setDue = async (feeId: string, d: string) => { await db.execute(sql`update platform_fees set due_date = ${d} where id = ${feeId}`); clearFeeLock(); };
const billing = async () => (await call('GET', '/api/v1/billing', manager)).body;

before(async () => {
  process.env.TEEPAY_API_KEY = 'tp_test_mock.secret';
  process.env.TEEPAY_WEBHOOK_SECRET = SECRET;
  process.env.TEEPAY_BASE_URL = startMock();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner Ada Test', ${phone}, 'SUPER_ADMIN', ${await hashPassword('OwnerPass2026')}, false)`);
  owner = (await login(phone, 'OwnerPass2026')).body.token;
  const mPhone = uniqPhone('25576');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Ada ${RUN} AMCOS`, activate: true, manager: { fullName: 'Meneja Ada', phone: mPhone, email: `meneja.${RUN.toLowerCase()}@example.com`, password: 'Meneja#2026x' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  amcosId = reg.body.amcos.id;
  const t = (await login(mPhone, 'Meneja#2026x')).body.token;
  manager = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: 'Meneja#2026x', newPassword: 'Staff12345' })).body.token;
  clerkPhone = uniqPhone('25576');
  const r = await call('POST', `/api/v1/owner/amcos/${amcosId}/staff`, owner, { role: 'CLERK', fullName: `Stokipa ${RUN}`, phone: clerkPhone });
  const ct = (await login(clerkPhone, r.body.temporaryPassword)).body.token;
  await call('POST', '/api/v1/auth/change-password', ct, { currentPassword: r.body.temporaryPassword, newPassword: 'Staff12345' });
});

after(async () => {
  server.close(); mockServer.close();
  delete process.env.TEEPAY_API_KEY; delete process.env.TEEPAY_WEBHOOK_SECRET; delete process.env.TEEPAY_BASE_URL;
  await pool.end();
});

test('Kingilio: kinadaiwa chama kikifunguliwa, chama kinafungwa baada ya siku 3, kinafunguka malipo yakithibitishwa', async () => {
  let b = await billing();
  const entrance = b.fees.find((f: any) => f.kind === 'ENTRANCE');
  assert.ok(entrance, 'Ada ya kingilio imeundwa');
  assert.equal(entrance.amount, '45000.00');
  assert.equal(entrance.dueDate, addDays(today, 3), 'Siku 3 baada ya kufunguliwa');
  assert.deepEqual(entrance.allowed, ['45000.00']);
  assert.equal(b.lock, null);
  assert.equal(b.fees.filter((f: any) => f.kind === 'SEASON').length, 0, 'Ada ya msimu haidaiwi kabla ya kingilio');
  assert.equal((await call('GET', '/api/v1/members', manager)).status, 200);

  // Ruhusa: Meneja pekee
  const clerk = (await login(clerkPhone, 'Staff12345')).body.token;
  assert.equal((await call('GET', '/api/v1/billing', clerk)).status, 403, 'Stokipa hagusi ada');
  assert.equal((await call('GET', '/api/v1/billing', owner)).status, 403);

  // Siku 3 zimepita bila malipo -> chama kizima kimefungwa
  await setDue(entrance.id, addDays(today, -1));
  const blocked = await call('GET', '/api/v1/members', manager);
  assert.equal(blocked.status, 402); assert.equal(blocked.body.error?.code ?? blocked.body.code, 'FEES_LOCKED');
  assert.equal((await call('GET', '/api/v1/members', clerk)).status, 402, 'Token za zamani za wafanyakazi zinazuiwa');
  const cl = await login(clerkPhone, 'Staff12345');
  assert.equal(cl.status, 403, 'Wafanyakazi hawaingii chama kikiwa kimefungwa');
  b = await billing();
  assert.equal(b.lock?.kind, 'ENTRANCE', 'Meneja anaingia kwenye ukurasa wa malipo');

  // Uthibitisho wa taarifa za mlipaji (TeePay Tanzania: jina kamili + email)
  assert.equal((await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '1000' })).status, 400, 'Kiasi kisicho sahihi');
  assert.equal((await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000', name: 'Theo' })).status, 400, 'Jina kamili linahitajika');
  assert.equal((await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000', email: 'si-email' })).status, 400);
  assert.equal((await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000', phone: '12345' })).status, 400);

  // TeePay haipatikani (503) -> SENDING; kuhakiki kunarudia kwa Idempotency-Key ILEILE na mwili uleule
  const p1 = await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000' });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p1.body.payment.status, 'SENDING');
  assert.equal(p1.body.payment.idempotencyKey, undefined, 'Funguo za ndani hazitoki');
  const s1 = await call('POST', `/api/v1/billing/payments/${p1.body.payment.id}/sync`, manager, {});
  assert.equal(s1.body.status, 'PENDING');
  assert.equal(new Set(mock.creates.map((c) => c.key)).size, 1, 'Idempotency-Key haikubadilika');
  const sent = JSON.parse(mock.creates[0].body);
  assert.deepEqual(sent.money, { amount_minor: '4500000', currency: 'TZS' }, 'TSh 45,000 = 4500000 minor units');
  assert.equal(sent.customer.phone, '+255712345678'); assert.equal(sent.customer.country, 'TZ');
  assert.equal(sent.customer.name, 'Theo Baruth'); assert.equal(sent.customer.email, 'meneja@example.com');
  // Ombi likiwa wazi, jingine haliruhusiwi (lisilipwe mara mbili)
  assert.equal((await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000' })).status, 409);

  // Mteja ameghairi kwenye simu -> FAILED, bado imefungwa, anaweza kujaribu tena
  let ov = await billing();
  const ref1 = ov.fees.find((f: any) => f.id === entrance.id).mobilePayments[0].reference;
  finish(ref1, 'failed', 'cancelled');
  assert.equal((await webhook(ref1, { type: 'payment.failed' })).status, 200);
  ov = await billing();
  assert.equal(ov.fees.find((f: any) => f.id === entrance.id).mobilePayments[0].status, 'FAILED');
  assert.equal(ov.fees.find((f: any) => f.id === entrance.id).mobilePayments[0].statusDetail, 'cancelled');
  assert.equal(ov.lock?.kind, 'ENTRANCE');

  const p2 = await call('POST', `/api/v1/billing/fees/${entrance.id}/pay`, manager, { ...PAYER, amount: '45000' });
  assert.equal(p2.body.payment.status, 'PENDING');
  const ref2 = p2.body.payment.reference;
  // Bado inasubiri PIN -> hakuna kilichorekodiwa
  assert.equal((await call('POST', `/api/v1/billing/payments/${p2.body.payment.id}/sync`, manager, {})).body.recorded, null);

  // Saini mbaya inakataliwa
  finish(ref2, 'succeeded');
  assert.equal((await webhook(ref2, { badSig: true })).status, 401);
  assert.equal((await billing()).fees.find((f: any) => f.id === entrance.id).status, 'UNPAID');

  const ev = crypto.randomUUID();
  assert.equal((await webhook(ref2, { eventId: ev })).status, 200);
  b = await billing();
  const paidFee = b.fees.find((f: any) => f.id === entrance.id);
  assert.equal(paidFee.status, 'PAID'); assert.equal(paidFee.paid, '45000.00');
  assert.equal(b.lock, null, 'Chama kimefunguka papo hapo');
  assert.equal((await call('GET', '/api/v1/members', manager)).status, 200);
  assert.equal((await login(clerkPhone, 'Staff12345')).status, 200, 'Wafanyakazi wanaingia tena');

  // Tukio lilelile / kuhakiki tena hakurekodi mara mbili
  assert.equal((await webhook(ref2, { eventId: ev })).body.duplicate, true);
  await webhook(ref2);
  await call('POST', `/api/v1/billing/payments/${p2.body.payment.id}/sync`, manager, {});
  b = await billing();
  assert.equal(b.fees.find((f: any) => f.id === entrance.id).payments.length, 1, 'Malipo yamerekodiwa mara moja');

  // Risiti
  const rid = b.fees.find((f: any) => f.id === entrance.id).payments[0].id;
  const rc = await call('GET', `/api/v1/billing/receipts/${rid}`, manager);
  assert.equal(rc.status, 200);
  assert.match(rc.body.message, /imepokelewa/); assert.match(rc.body.message, /mwaka mzima/);
  assert.match(rc.body.receipt.method, /0712345678/);
  assert.match(rc.body.receipt.receiptNo, /^CL-INV-/);
  // Mapato ya kampuni (Owner) — kumbukumbu ileile ya malipo ya jukwaa
  const od = await call('GET', `/api/v1/owner/amcos/${amcosId}`, owner);
  assert.ok(od.body.payments.some((p: any) => p.id === rid && p.status === 'VERIFIED' && p.category === 'SETUP'));
});

test('Ada ya msimu: 700,000 kwa awamu mbili sawa, mwisho 15/10; chama kinafungwa kisipomaliza', async () => {
  let b = await billing();
  const season = b.fees.find((f: any) => f.kind === 'SEASON');
  assert.ok(season, 'Ada ya msimu inaanza kudaiwa baada ya kingilio');
  assert.equal(season.amount, '700000.00'); assert.equal(season.installments, 2);
  assert.match(season.dueDate, /-10-15$/);
  assert.ok(season.dueDate >= today);
  assert.deepEqual(season.allowed, ['350000.00', '700000.00'], 'Awamu ya nusu au yote');
  assert.equal((await call('POST', `/api/v1/billing/fees/${season.id}/pay`, manager, { ...PAYER, amount: '200000' })).status, 400);

  const c = await call('POST', `/api/v1/billing/fees/${season.id}/pay`, manager, { ...PAYER, amount: '350000' });
  assert.equal(c.status, 201); assert.equal(c.body.payment.status, 'PENDING');
  finish(c.body.payment.reference, 'succeeded');
  const s = await call('POST', `/api/v1/billing/payments/${c.body.payment.id}/sync`, manager, {});
  assert.equal(s.status, 200); assert.ok(s.body.recorded); assert.equal(s.body.status, 'SUCCEEDED');
  b = await billing();
  let f = b.fees.find((x: any) => x.id === season.id);
  assert.equal(f.status, 'PARTIAL'); assert.equal(f.outstanding, '350000.00');
  assert.deepEqual(f.allowed, ['350000.00'], 'Awamu ya pili tu');
  const r1 = await call('GET', `/api/v1/billing/receipts/${f.payments[0].id}`, manager);
  assert.match(r1.body.message, /Salio ni TSh 350,000/);

  // 15/10 imepita na awamu ya pili haijalipwa -> imefungwa
  await setDue(season.id, addDays(today, -1));
  assert.equal((await call('GET', '/api/v1/members', manager)).status, 402);
  assert.equal((await billing()).lock?.kind, 'SEASON');

  const c2 = await call('POST', `/api/v1/billing/fees/${season.id}/pay`, manager, { ...PAYER, amount: '350000' });
  assert.equal(c2.status, 201);
  finish(c2.body.payment.reference, 'succeeded');
  assert.equal((await webhook(c2.body.payment.reference)).status, 200);
  b = await billing();
  f = b.fees.find((x: any) => x.id === season.id);
  assert.equal(f.status, 'PAID'); assert.equal(b.lock, null);
  assert.equal((await call('GET', '/api/v1/members', manager)).status, 200);
  const r2 = await call('GET', `/api/v1/billing/receipts/${f.payments[0].id}`, manager);
  assert.match(r2.body.message, /imelipwa kikamilifu/);
  assert.equal((await call('POST', `/api/v1/billing/fees/${season.id}/pay`, manager, { ...PAYER, amount: '350000' })).status, 409, 'Imelipwa tayari');
});

test('Owner: bei, vyama vya zamani (dai au samehe), na bila TeePay hakuna chama kinachofungwa', async () => {
  const st = await call('GET', '/api/v1/owner/fees/settings', owner);
  assert.equal(st.body.settings.entranceFee, 45000); assert.equal(st.body.teepay.enabled, true);
  const list = await call('GET', '/api/v1/owner/fees', owner);
  assert.ok(list.body.data.some((r: any) => r.id === amcosId && r.entrance_status === 'PAID'));

  // Chama cha zamani (kabla ya ada): hakidaiwi mpaka Owner aamue
  const old = await call('POST', '/api/v1/owner/amcos', owner, { name: `Zamani ${RUN} AMCOS` });
  await db.execute(sql`update amcos set status = 'ACTIVE', is_active = true where id = ${old.body.amcos.id}`);
  assert.equal((await call('GET', `/api/v1/owner/fees/amcos/${old.body.amcos.id}`, owner)).body.fees.length, 0);
  assert.equal((await call('POST', `/api/v1/owner/fees/amcos/${old.body.amcos.id}/entrance`, owner, { waive: true })).status, 400, 'Sababu inahitajika');
  const w = await call('POST', `/api/v1/owner/fees/amcos/${old.body.amcos.id}/entrance`, owner, { waive: true, reason: 'Chama cha majaribio (pilot)' });
  assert.equal(w.status, 201); assert.equal(w.body.fee.status, 'WAIVED');
  const o = (await call('GET', `/api/v1/owner/fees/amcos/${old.body.amcos.id}`, owner)).body;
  assert.ok(o.fees.some((f: any) => f.kind === 'SEASON' && f.status === 'UNPAID'), 'Ada ya msimu inadaiwa baada ya kusamehewa kingilio');
  assert.equal((await call('POST', `/api/v1/owner/fees/amcos/${old.body.amcos.id}/entrance`, owner, {})).status, 409);

  // Bila TEEPAY_API_KEY: hawana njia ya kulipa, kwa hiyo hakuna kufungwa
  const season = o.fees.find((f: any) => f.kind === 'SEASON');
  await setDue(season.id, addDays(today, -1));
  const { feeLock } = await import('../src/lib/fees');
  assert.ok(await feeLock(old.body.amcos.id, { fresh: true }));
  const k = process.env.TEEPAY_API_KEY; delete process.env.TEEPAY_API_KEY;
  assert.equal(await feeLock(old.body.amcos.id, { fresh: true }), null);
  process.env.TEEPAY_API_KEY = k;
  // Owner anasamehe ada ya msimu kwa sababu -> imefunguka
  assert.equal((await call('POST', `/api/v1/owner/fees/${season.id}/waive`, owner, { reason: 'Msamaha wa bodi' })).status, 200);
  assert.equal(await feeLock(old.body.amcos.id, { fresh: true }), null);
});

test('Jaribio la TSh 500 (ada halisi inabaki) na kughairi ombi ambalo push haikufika', async () => {
  // Chama kipya chenye kingilio cha 45,000
  const mPhone = uniqPhone('25576');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Jaribio ${RUN} AMCOS`, activate: true, manager: { fullName: 'Meneja Jaribio', phone: mPhone, password: 'Meneja#2026x' } });
  const aid = reg.body.amcos.id;
  const t = (await login(mPhone, 'Meneja#2026x')).body.token;
  const mgr = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: 'Meneja#2026x', newPassword: 'Staff12345' })).body.token;
  const fee = (await call('GET', '/api/v1/billing', mgr)).body.fees[0];
  await setDue(fee.id, addDays(today, -1)); // imefungwa

  // Owner anaweka jaribio la 500 (si kwa Meneja)
  assert.equal((await call('POST', `/api/v1/owner/fees/${fee.id}/test`, mgr, { amount: 500 })).status, 403);
  assert.equal((await call('POST', `/api/v1/owner/fees/${fee.id}/test`, owner, { amount: 100 })).status, 400, 'Chini ya TSh 500');
  assert.equal((await call('POST', `/api/v1/owner/fees/${fee.id}/test`, owner, { amount: 500 })).status, 200);
  let f = (await call('GET', '/api/v1/billing', mgr)).body.fees[0];
  assert.deepEqual(f.allowed, ['500.00']); assert.equal(f.testAmount, '500.00');
  assert.equal((await call('POST', `/api/v1/billing/fees/${fee.id}/pay`, mgr, { ...PAYER, amount: '45000' })).status, 400, 'Wakati wa jaribio ni 500 tu');

  // Push haikufika -> Meneja anaghairi -> anaomba tena
  const p1 = await call('POST', `/api/v1/billing/fees/${fee.id}/pay`, mgr, { ...PAYER, amount: '500' });
  assert.equal(p1.body.payment.status, 'PENDING'); assert.equal(p1.body.payment.isTest, true);
  assert.equal((await call('POST', `/api/v1/billing/fees/${fee.id}/pay`, mgr, { ...PAYER, amount: '500' })).status, 409);
  const cx = await call('POST', `/api/v1/billing/payments/${p1.body.payment.id}/cancel`, mgr, {});
  assert.equal(cx.status, 200); assert.equal(cx.body.abandoned, true);
  const p2 = await call('POST', `/api/v1/billing/fees/${fee.id}/pay`, mgr, { ...PAYER, amount: '500' });
  assert.equal(p2.status, 201, 'Anaruhusiwa kuomba tena baada ya kughairi');

  // Ombi la pili linalipwa -> jaribio limefanikiwa: risiti, lakini ada ya 45,000 inabaki
  finish(p2.body.payment.reference, 'succeeded');
  assert.equal((await webhook(p2.body.payment.reference)).status, 200);
  let b = (await call('GET', '/api/v1/billing', mgr)).body;
  f = b.fees[0];
  assert.equal(f.status, 'UNPAID'); assert.equal(f.paid, '0.00'); assert.equal(f.amount, '45000.00');
  assert.equal(f.testAmount, null, 'Kiasi cha majaribio kimeondoka');
  assert.deepEqual(f.allowed, ['45000.00'], 'Imerudi 45,000');
  assert.ok(b.lock, 'Bado imefungwa: ada halisi haijalipwa');
  const rp = f.payments.find((p: any) => p.isTest);
  const rc = await call('GET', `/api/v1/billing/receipts/${rp.id}`, mgr);
  assert.equal(rc.body.isTest, true); assert.match(rc.body.message, /majaribio/);

  // Ombi lililoghairiwa likija kulipwa baadaye bado linarekodiwa (pesa haipotei)
  finish(p1.body.payment.reference, 'succeeded');
  await webhook(p1.body.payment.reference);
  b = (await call('GET', '/api/v1/billing', mgr)).body;
  assert.equal(b.fees[0].payments.filter((p: any) => p.isTest).length, 2);
  assert.equal(b.fees[0].paid, '0.00');
  const od = await call('GET', `/api/v1/owner/fees/amcos/${aid}`, owner);
  assert.equal(od.status, 200);
});
