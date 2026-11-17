// Afisa Ushirika wa Wilaya (v0.43): upeo wa wilaya, kusoma tu, hadi maafisa 5, ukaguzi + hoja, maagizo, zuio la malipo
process.env.SMS_DRY_RUN = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { dryOutbox } from '../src/lib/sms';
import { TZ_LOCATIONS } from '../src/lib/locations';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
// v2.5: wilaya lazima iwe ya orodha rasmi — wilaya ya nasibu (isiyo ya Tabora, ambayo majaribio mengine yanaitumia)
const POOL = TZ_LOCATIONS.regions.filter((r) => r.name !== 'Tabora').flatMap((r) => r.districts.map((d) => ({ region: r.name, district: d.name })));
const PICK = POOL[Math.floor(Math.random() * POOL.length)];
const DISTRICT = PICK.district, REGION = PICK.region;
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7);
const OWNER_PW = 'OwnerPass2026';
async function call(method: string, path: string, token?: string, body?: unknown, amcos?: string) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(amcos ? { 'x-amcos-id': amcos } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json: any = text; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: json };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body;
const smsPassword = (phone: string) => { const m = [...dryOutbox].reverse().find((x) => x.phone === phone && /Nenosiri la muda: /.test(x.text)); return m ? /Nenosiri la muda: (\S+)/.exec(m.text)![1] : null; };

let owner: string, officer: string, officerId: string, manager: string, inDistrict: string, outside: string;
const OFFICER_PW = 'Afisa#2026xy';

async function newAmcos(name: string, district: string) {
  const ph = uniqPhone('25576');
  const r = await call('POST', '/api/v1/owner/amcos', owner, { name, activate: true, manager: { fullName: `Meneja ${name}`, phone: ph, password: 'Meneja#2026x' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await db.execute(sql`update amcos set district = ${district}, region = ${REGION} where id = ${r.body.amcos.id}`);
  return { id: r.body.amcos.id as string, phone: ph };
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner Usimamizi', ${phone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false)`);
  owner = (await login(phone, OWNER_PW)).token;
  const a = await newAmcos(`Usimamizi ${RUN} AMCOS`, `  ${DISTRICT.toLowerCase()} `); // nafasi/herufi tofauti: bado ni wilaya ile ile
  inDistrict = a.id;
  const t0 = (await login(a.phone, 'Meneja#2026x')).token;
  manager = (await call('POST', '/api/v1/auth/change-password', t0, { currentPassword: 'Meneja#2026x', newPassword: 'Meneja#2026y' })).body.token;
  await call('POST', '/api/v1/auth/accept-terms', manager, {});
  outside = (await newAmcos(`Nje ${RUN} AMCOS`, `Nyingine${RUN}`)).id;
});
after(async () => { server.close(); await pool.end(); });

test('Owner pekee anasajili Afisa Ushirika; nenosiri kwa SMS; maafisa 5 kwa wilaya', async () => {
  const ph = uniqPhone('25578');
  const body = { fullName: `Afisa Ushirika ${RUN}`, phone: ph, district: DISTRICT, region: REGION, jobTitle: 'Afisa Ushirika Wilaya' };
  assert.equal((await call('POST', '/api/v1/owner/officers', manager, body)).status, 403, 'Meneja wa chama hawezi');
  const c = await call('POST', '/api/v1/owner/officers', owner, body);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.temporaryPassword, null, 'nenosiri halionyeshwi — limetumwa kwa SMS');
  officerId = c.body.officer.id;
  const pw = smsPassword(ph)!;
  const t = (await login(ph, pw)).token;
  officer = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: pw, newPassword: OFFICER_PW })).body.token;
  await call('POST', '/api/v1/auth/accept-terms', officer, {});
  const me = (await call('GET', '/api/v1/auth/me', officer)).body.user;
  assert.equal(me.role, 'COOP_OFFICER'); assert.equal(me.jurisdictionDistrict, DISTRICT);
  assert.equal(me.twoFactor.required, true, '2FA ni lazima kwa Afisa Ushirika');
  // Hadi 5 walio hai kwa wilaya
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/v1/owner/officers', owner, { ...body, fullName: `Mkaguzi ${i} ${RUN}`, phone: uniqPhone('25578') })).status, 201);
  const sixth = await call('POST', '/api/v1/owner/officers', owner, { ...body, fullName: `Wa sita ${RUN}`, phone: uniqPhone('25578') });
  assert.equal(sixth.status, 409); assert.match(sixth.body.error.message, /maafisa 5/);
});

test('Afisa: anaona vyama vya wilaya yake tu, na anasoma tu (backend)', async () => {
  const list = (await call('GET', '/api/v1/amcos?pageSize=100', officer)).body.data.map((a: any) => a.id);
  assert.ok(list.includes(inDistrict)); assert.ok(!list.includes(outside), 'chama cha wilaya nyingine hakionekani');
  assert.equal((await call('GET', `/api/v1/amcos/${outside}`, officer)).status, 404);
  assert.equal((await call('GET', '/api/v1/accounting/chart', officer, undefined, outside)).status, 403);
  assert.equal((await call('GET', '/api/v1/accounting/chart', officer, undefined, inDistrict)).status, 200, 'daftari kuu la chama cha wilaya yake');
  assert.equal((await call('GET', '/api/v1/members?pageSize=5', officer, undefined, inDistrict)).status, 200);
  assert.equal((await call('GET', `/api/v1/audit-logs?amcosId=${inDistrict}`, officer)).status, 200, 'anaona kumbukumbu (audit)');
  const w = await call('POST', '/api/v1/members', officer, { firstName: 'Jaribio', lastName: 'Afisa', gender: 'MALE' }, inDistrict);
  assert.equal(w.status, 403); assert.equal(w.body.error.code, 'OFFICER_READ_ONLY');
  assert.equal((await call('PUT', '/api/v1/finance/doc-numbers', officer, { type: 'RECEIPT', next: 999, reason: 'Afisa anajaribu' }, inDistrict)).status, 403);
  const ov = (await call('GET', '/api/v1/oversight/overview', officer)).body;
  assert.deepEqual(ov.amcos.map((a: any) => a.id), [inDistrict]);
  assert.equal(ov.officers.length, 5);
  assert.ok(ov.amcos[0].flags.some((f: any) => /Hakijawahi kukaguliwa/.test(f.text)));
  assert.equal((await call('GET', '/api/v1/oversight/overview', manager)).status, 403, 'Meneja hana dashibodi ya wilaya');
});

test('Ukaguzi: rasimu -> hoja -> kutolewa (SMS) -> chama kinajibu -> afisa anarudisha / anakubali -> kufunga', async () => {
  assert.equal((await call('POST', '/api/v1/oversight/inspections', officer, { amcosId: outside, title: 'Ukaguzi wa nje ya wilaya', kind: 'ROUTINE' })).status, 403);
  const c = await call('POST', '/api/v1/oversight/inspections', officer, { amcosId: inDistrict, title: 'Ukaguzi wa robo ya kwanza 2026', kind: 'ROUTINE', periodFrom: '2026-01-01', periodTo: '2026-03-31' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.inspection.id;
  assert.match(c.body.inspection.inspNo, /^UK-.+-0001$/);
  const f1 = await call('POST', `/api/v1/oversight/inspections/${id}/findings`, officer, { area: 'FINANCE', title: 'Vocha bila saini ya Meneja', detail: 'Vocha 5245 ya gharama za benki haina saini ya aliyeidhinisha.', severity: 'HIGH', recommendation: 'Kila malipo yaidhinishwe kwenye mfumo', dueDate: '2026-12-31' });
  assert.equal(f1.status, 201, JSON.stringify(f1.body));
  assert.equal((await call('POST', `/api/v1/oversight/inspections/${id}/findings`, officer, { area: 'GOVERNANCE', title: 'Mkutano mkuu haujafanyika', detail: 'Hakuna kumbukumbu za mkutano mkuu wa mwaka 2025.', severity: 'MEDIUM' })).status, 201);
  // Rasimu haionekani kwa chama
  assert.ok(!(await call('GET', '/api/v1/oversight/inspections', manager)).body.data.some((i: any) => i.id === id));
  assert.equal((await call('GET', `/api/v1/oversight/inspections/${id}`, manager)).status, 404);
  assert.equal((await call('POST', `/api/v1/oversight/inspections/${id}/issue`, manager)).status, 403, 'chama hakitoi ripoti');
  assert.equal((await call('POST', `/api/v1/oversight/inspections/${id}/issue`, officer)).status, 200);
  const sms = (await db.execute<{ message: string; sender_id: string }>(sql`select message, sender_id from sms_logs where kind = 'OVERSIGHT_NOTICE' and amcos_id = ${inDistrict} order by created_at desc limit 1`)).rows[0];
  assert.match(sms.message, /Ripoti ya ukaguzi .* hoja 2 \(1 nzito\)/); assert.equal(sms.sender_id, 'COOPLINK');
  const det = (await call('GET', `/api/v1/oversight/inspections/${id}`, manager)).body;
  assert.equal(det.can.respond, true); assert.equal(det.findings.length, 2);
  const fid = f1.body.finding.id, gid = det.findings[1].id;
  assert.equal((await call('POST', `/api/v1/oversight/findings/${fid}/respond`, officer, { response: 'Afisa hawezi kujibu hoja ya chama' })).status, 403);
  assert.equal((await call('POST', `/api/v1/oversight/findings/${fid}/respond`, manager, { response: 'Tumeanza kuidhinisha kila malipo kwenye CoopLink.' })).status, 200);
  assert.equal((await call('POST', `/api/v1/oversight/inspections/${id}/close`, officer, { conclusion: 'Chama kimetekeleza mapendekezo yote.' })).status, 400, 'hoja wazi zinazuia kufunga');
  assert.equal((await call('POST', `/api/v1/oversight/findings/${fid}/review`, officer, { decision: 'REOPENED', note: 'Leta nakala za vocha zilizosainiwa' })).status, 200);
  assert.equal((await call('POST', `/api/v1/oversight/findings/${fid}/respond`, manager, { response: 'Nakala zimewekwa kwenye faili la ukaguzi.' })).status, 200);
  for (const x of [fid, gid]) assert.equal((await call('POST', `/api/v1/oversight/findings/${x}/review`, officer, { decision: 'RESOLVED', note: 'Imethibitishwa' })).status, 200);
  const cl = await call('POST', `/api/v1/oversight/inspections/${id}/close`, officer, { conclusion: 'Chama kimetekeleza mapendekezo yote.' });
  assert.equal(cl.status, 200); assert.equal(cl.body.inspection.status, 'CLOSED');
});

test('Maagizo: kwa vyama vya wilaya; chama kinathibitisha na kuripoti utekelezaji; afisa anafunga', async () => {
  assert.equal((await call('POST', '/api/v1/oversight/directives', officer, { amcosIds: [inDistrict, outside], subject: 'Mkutano mkuu wa mwaka', body: 'Fanyeni mkutano mkuu kabla ya 31/12.' })).status, 403, 'chama cha nje ya wilaya');
  const d = await call('POST', '/api/v1/oversight/directives', officer, { amcosIds: [inDistrict], subject: 'Mkutano mkuu wa mwaka', body: 'Fanyeni mkutano mkuu wa mwaka kabla ya tarehe 31/12/2026 na mlete kumbukumbu.', priority: 'URGENT', dueDate: '2026-12-31' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const id = d.body.directives[0].id;
  assert.equal((await call('POST', `/api/v1/oversight/directives/${id}/review`, officer, { decision: 'CLOSED', note: 'Funga' })).status, 400, 'haifungwi kabla ya utekelezaji');
  assert.equal((await call('POST', `/api/v1/oversight/directives/${id}/ack`, manager)).status, 200);
  assert.equal((await call('POST', `/api/v1/oversight/directives/${id}/comply`, manager, { note: 'Mkutano umefanyika 20/12/2026; kumbukumbu zimeambatishwa.' })).status, 200);
  const r = await call('POST', `/api/v1/oversight/directives/${id}/review`, officer, { decision: 'CLOSED', note: 'Utekelezaji umethibitishwa' });
  assert.equal(r.status, 200); assert.equal(r.body.directive.status, 'CLOSED');
});

test('Zuio la malipo: nenosiri la afisa; hakuna fedha inayotoka; kuondolewa kunarudisha malipo', async () => {
  assert.equal((await call('POST', '/api/v1/oversight/holds', officer, { amcosId: inDistrict, reason: 'Uchunguzi wa matumizi yasiyo na idhini' })).status, 403, 'nenosiri linahitajika');
  const h = await call('POST', '/api/v1/oversight/holds', officer, { amcosId: inDistrict, reason: 'Uchunguzi wa matumizi yasiyo na idhini', confirmPassword: OFFICER_PW });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  assert.equal((await call('POST', '/api/v1/oversight/holds', officer, { amcosId: inDistrict, reason: 'Zuio la pili kwa chama kile kile', confirmPassword: OFFICER_PW })).status, 409);
  // Malipo yaliyoidhinishwa hayakamiliki wakati wa zuio
  const [acc] = (await db.execute<{ id: string }>(sql`insert into finance_accounts (amcos_id, name, kind, opening_balance) values (${inDistrict}, 'Taslimu', 'CASH', 100000) returning id`)).rows;
  const [u] = (await db.execute<{ id: string }>(sql`select id from users where amcos_id = ${inDistrict} limit 1`)).rows;
  const [t] = (await db.execute<{ id: string }>(sql`insert into finance_transactions (amcos_id, txn_no, kind, direction, category, account_id, amount, txn_date, description, status, created_by_id, approval_id)
    values (${inDistrict}, ${'HOLD-' + RUN}, 'EXPENSE', 'OUT', 'OFFICE', ${acc.id}, 1000, current_date, 'Vifaa vya ofisi', 'APPROVED', ${u.id}, gen_random_uuid()) returning id`)).rows;
  const blocked = await call('POST', `/api/v1/finance/transactions/${t.id}/post`, manager, {});
  assert.equal(blocked.status, 423, JSON.stringify(blocked.body)); assert.equal(blocked.body.error.code, 'PAYMENT_HOLD');
  const s = (await call('GET', '/api/v1/oversight/summary', manager)).body;
  assert.equal(s.holds.length, 1, 'chama kinaona zuio');
  assert.equal((await call('POST', `/api/v1/oversight/holds/${h.body.hold.id}/lift`, manager, { reason: 'Meneja anajaribu kuondoa', confirmPassword: 'Meneja#2026y' })).status, 403);
  assert.equal((await call('POST', `/api/v1/oversight/holds/${h.body.hold.id}/lift`, officer, { reason: 'Uchunguzi umekamilika', confirmPassword: OFFICER_PW })).status, 200);
  assert.equal((await call('POST', `/api/v1/finance/transactions/${t.id}/post`, manager, {})).status, 200, 'malipo yanaendelea baada ya zuio kuondolewa');
});

test('Owner: kumzima afisa kunafunga vikao vyake mara moja', async () => {
  assert.equal((await call('POST', `/api/v1/owner/officers/${officerId}/active`, owner, { isActive: false })).status, 200);
  assert.equal((await call('GET', '/api/v1/auth/me', officer)).status, 401);
});
