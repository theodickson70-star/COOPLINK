// Majaribio ya mwisho-hadi-mwisho dhidi ya database halisi.
// Inahitaji: npm run db:migrate && SEED_DEMO=true npm run db:seed
// Endesha:   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json()) as any };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body.token as string;

/** Meneja anaamua ombi linalohusu rekodi hii (v0.3.0: usajili, ugawaji n.k. vinapitia idhini). */
async function decideFor(entityId: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const list = (await call('GET', '/api/v1/approvals?status=PENDING&pageSize=100', katibu)).body.data as any[];
  const a = list.find((x) => x.entityId === entityId);
  assert.ok(a, 'Ombi la idhini lipo');
  return call('POST', `/api/v1/approvals/${a.id}/decide`, katibu, { decision, note: 'Imekaguliwa' });
}

let clerk: string, accountant: string, katibu: string, unionAdmin: string, superT: string;
let otherAmcosId: string, otherAdmin: string;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  clerk = await login('0711000003', 'Demo12345');
  accountant = await login('0711000002', 'Demo12345');
  katibu = await login('0711000001', 'Demo12345');
  unionAdmin = await login('0711000004', 'Demo12345');
  assert.ok(clerk && accountant && katibu && unionAdmin, 'Watumiaji wa demo wameingia');
});

after(async () => {
  server.close();
  await pool.end();
});

test('auth: login mbaya, nenosiri la muda linalazimisha kubadilisha, tokens za zamani zinakufa', async () => {
  const bad = await call('POST', '/api/v1/auth/login', undefined, { phone: '0711000003', password: 'wrong' });
  assert.equal(bad.status, 401);
  assert.equal((await call('GET', '/api/v1/members')).status, 401);

  // Unda super admin mpya kwa SQL ili jaribio lisitegemee nenosiri la seed
  const { hashPassword } = await import('../src/lib/security');
  const phone = '25579' + String(Date.now()).slice(-7);
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password)
    values ('Test Super', ${phone}, 'SUPER_ADMIN', ${await hashPassword('Temp12345')}, true)`);
  const t1 = await login(phone, 'Temp12345');
  const blocked = await call('GET', '/api/v1/members', t1);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');

  const weak = await call('POST', '/api/v1/auth/change-password', t1, { currentPassword: 'Temp12345', newPassword: 'short' });
  assert.equal(weak.status, 400);
  const ch = await call('POST', '/api/v1/auth/change-password', t1, { currentPassword: 'Temp12345', newPassword: 'NewPass2026' });
  assert.equal(ch.status, 200);
  assert.equal((await call('GET', '/api/v1/auth/me', t1)).status, 401, 'token ya zamani imekufa');
  superT = ch.body.token;
  assert.equal((await call('GET', '/api/v1/members', superT)).status, 200);
});

test('tenancy: chama kingine hakionekani wala kuandikwa', async () => {
  const u = await call('POST', '/api/v1/unions', superT, { name: 'Union Nyingine', code: 'U' + RUN });
  assert.equal(u.status, 201);
  const a = await call('POST', '/api/v1/amcos', superT, { name: 'AMCOS Nyingine', code: 'X' + RUN, unionId: u.body.union.id });
  assert.equal(a.status, 201);
  otherAmcosId = a.body.amcos.id;

  const adm = await call('POST', '/api/v1/users', superT, { fullName: 'Katibu X', phone: '25578' + String(Date.now()).slice(-7), role: 'AMCOS_ADMIN', amcosId: otherAmcosId });
  assert.equal(adm.status, 201);
  assert.ok(adm.body.temporaryPassword);
  // Badilisha nenosiri la muda
  const t = await login(adm.body.user.phone, adm.body.temporaryPassword);
  otherAdmin = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: adm.body.temporaryPassword, newPassword: 'Other12345' })).body.token;

  const xm = await call('POST', '/api/v1/members', otherAdmin, { firstName: 'Siri', lastName: 'Nyingine', gender: 'FEMALE' });
  assert.equal(xm.status, 201);
  assert.match(xm.body.member.memberNo, new RegExp(`^X${RUN}-000001$`));

  // Karani wa DEMO1 hawezi kumwona wala kumbadilisha
  assert.equal((await call('GET', `/api/v1/members/${xm.body.member.id}`, clerk)).status, 404);
  assert.equal((await call('PATCH', `/api/v1/members/${xm.body.member.id}`, clerk, { village: 'X' })).status, 404);
  assert.equal((await call('POST', '/api/v1/members', clerk, { amcosId: otherAmcosId, firstName: 'A', lastName: 'Bb', gender: 'MALE' })).status, 400);
  assert.equal((await call('POST', '/api/v1/members', clerk, { amcosId: otherAmcosId, firstName: 'Aaa', lastName: 'Bbb', gender: 'MALE' })).status, 403);
  // Union admin wa DEMOU haoni AMCOS ya union nyingine
  assert.equal((await call('GET', `/api/v1/members/${xm.body.member.id}`, unionAdmin)).status, 404);
  assert.equal((await call('GET', `/api/v1/amcos/${otherAmcosId}`, unionAdmin)).status, 404);
  // AMCOS_ADMIN hawezi kuunda AMCOS_ADMIN mwingine wala kumpa mtu chama kingine
  assert.equal((await call('POST', '/api/v1/users', katibu, { fullName: 'Mtu Mmoja', phone: '0788000111', role: 'AMCOS_ADMIN' })).status, 403);
});

let memberId: string;

test('wanachama: usajili, namba ya simu, NIDA, hali', async () => {
  const bad = await call('POST', '/api/v1/members', clerk, { firstName: 'Juma', lastName: 'Ally', gender: 'MALE', nidaNumber: '123', phone: '12345' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');

  const nida = '1990' + String(Date.now()).padStart(16, '0').slice(-16);
  const r = await call('POST', '/api/v1/members', clerk, {
    firstName: 'Juma', lastName: 'Ally' + RUN, gender: 'MALE', phone: '0754 123 456', village: 'Usoke', nidaNumber: nida,
    mobileMoneyNumber: '+255754123456', mobileMoneyProvider: 'MPESA',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.member.phone, '255754123456');
  assert.match(r.body.member.memberNo, /^DEMO1-\d{6}$/);
  assert.equal(r.body.member.status, 'PENDING', 'Stokipa akisajili, mkulima anasubiri uthibitisho wa Meneja');
  memberId = r.body.member.id;
  assert.equal((await decideFor(memberId)).status, 200);

  const dup = await call('POST', '/api/v1/members', clerk, { firstName: 'Juma', lastName: 'Mwingine', gender: 'MALE', nidaNumber: nida });
  assert.equal(dup.status, 409, 'NIDA moja haitumiki mara mbili ndani ya chama');

  const farm = await call('POST', `/api/v1/members/${memberId}/farms`, clerk, { name: 'Shamba la Usoke', acres: '2.5' });
  assert.equal(farm.status, 201);

  assert.equal((await call('PATCH', `/api/v1/members/${memberId}/status`, clerk, { status: 'SUSPENDED', reason: 'jaribio' })).status, 403);

  const list = await call('GET', `/api/v1/members?search=Ally${RUN}`, clerk);
  assert.equal(list.body.meta.total, 1);
  const detail = await call('GET', `/api/v1/members/${memberId}`, unionAdmin);
  assert.equal(detail.status, 200, 'Union admin anaona wanachama wa vyama vyake');
  assert.equal(detail.body.farms.length, 1);
});

test('makisio: kuunda, nakala mbili, idhini kwa wenye ruhusa tu', async () => {
  const r = await call('POST', '/api/v1/estimates', clerk, { memberId, acresPlanted: '2.5', estimatedKg: '1800' });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/api/v1/estimates', clerk, { memberId, acresPlanted: 1, estimatedKg: 100 })).status, 409);
  assert.equal((await call('POST', `/api/v1/estimates/${r.body.estimate.id}/approve`, clerk)).status, 403);
  assert.equal((await call('POST', `/api/v1/estimates/${r.body.estimate.id}/approve`, accountant)).status, 403, 'Mhasibu haidhinishi makisio');
  const ok = await call('POST', `/api/v1/estimates/${r.body.estimate.id}/approve`, katibu);
  assert.equal(ok.body.estimate.status, 'APPROVED');
  assert.equal((await call('PATCH', `/api/v1/estimates/${r.body.estimate.id}`, clerk, { estimatedKg: '5000' })).status, 400);
});

test('pembejeo: mkopo -> ledger, stoo, idempotency, kufuta kwa REVERSAL', async () => {
  const items = (await call('GET', '/api/v1/inputs/items', clerk)).body.data as any[];
  const npk = items.find((i) => i.name.startsWith('NPK'));
  const seed = items.find((i) => i.category === 'SEED');
  const stockBefore = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === npk.id).balance;

  const clientRef = 'offline-' + RUN + '-0001';
  const payload = { memberId, clientRef, lines: [{ inputItemId: npk.id, quantity: 2 }, { inputItemId: seed.id, quantity: '1' }] };
  const r = await call('POST', '/api/v1/input-issues', clerk, payload);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.issue.totalAmount, '168000.00'); // 2 x 78,000 + 12,000
  assert.equal(r.body.issue.lines.length, 2);
  assert.equal(r.body.issue.status, 'PENDING_APPROVAL');
  const pendingStock = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === npk.id).balance;
  assert.equal(pendingStock, stockBefore, 'Stoo haibadiliki kabla ya idhini');
  assert.equal((await call('GET', `/api/v1/members/${memberId}`, katibu)).body.balance.amountOwed, '0.00', 'Deni halijaandikwa kabla ya idhini');
  assert.equal((await decideFor(r.body.issue.id)).status, 200);

  const again = await call('POST', '/api/v1/input-issues', clerk, payload);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.issue.id, r.body.issue.id, 'App ya offline ikituma mara mbili, inarekodiwa mara moja');

  assert.equal((await call('GET', `/api/v1/members/${memberId}`, clerk)).body.balance, null, 'Stokipa haoni fedha za mkulima');
  let bal = (await call('GET', `/api/v1/members/${memberId}`, katibu)).body.balance;
  assert.equal(bal.amountOwed, '168000.00');
  const stockAfter = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === npk.id).balance;
  assert.equal(Number(stockBefore) - Number(stockAfter), 2);

  assert.equal((await call('POST', `/api/v1/input-issues/${r.body.issue.id}/cancel`, clerk, { reason: 'kosa la karani' })).status, 403);
  assert.equal((await call('POST', `/api/v1/input-issues/${r.body.issue.id}/cancel`, accountant, { reason: 'kosa la karani' })).status, 403);
  const c = await call('POST', `/api/v1/input-issues/${r.body.issue.id}/cancel`, katibu, { reason: 'kosa la karani' });
  assert.equal(c.status, 200);
  assert.equal(c.body.issue.status, 'CANCELLED');
  assert.equal((await call('POST', `/api/v1/input-issues/${r.body.issue.id}/cancel`, katibu, { reason: 'tena tena' })).status, 409);

  bal = (await call('GET', `/api/v1/members/${memberId}`, katibu)).body.balance;
  assert.equal(bal.balance, '0.00');
  assert.equal((await call('GET', `/api/v1/members/${memberId}/statement`, clerk)).status, 403);
  assert.equal((await call('GET', `/api/v1/members/${memberId}/statement`, accountant)).status, 403, 'Mhasibu haoni wakulima');
  const st = await call('GET', `/api/v1/members/${memberId}/statement`, katibu);
  assert.deepEqual(st.body.entries.map((e: any) => e.type), ['INPUT_LOAN', 'REVERSAL'], 'Historia inabaki');
  assert.equal(st.body.entries[1].runningBalance, '0.00');
  const stockFinal = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === npk.id).balance;
  assert.equal(stockFinal, stockBefore);

  // Issue mpya inayobaki (kwa ripoti)
  const keep = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: npk.id, quantity: 1 }] });
  assert.equal(keep.status, 201);
  assert.equal((await decideFor(keep.body.issue.id)).status, 200);
});

test('pembejeo: bila bei / stoo haitoshi / watu wengi kwa wakati mmoja hawazidishi stoo', async () => {
  assert.equal((await call('POST', '/api/v1/inputs/items', accountant, { name: 'X ' + RUN, category: 'CHEMICAL', unit: 'LITRE' })).status, 403, 'Mhasibu hasajili bidhaa');
  const item = await call('POST', '/api/v1/inputs/items', clerk, { name: 'Dawa ' + RUN, category: 'CHEMICAL', unit: 'LITRE' });
  assert.equal(item.status, 201);
  const id = item.body.item.id;

  const noPrice = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: id, quantity: 1 }] });
  assert.equal(noPrice.status, 400);
  assert.match(noPrice.body.error.message, /Bei haijawekwa/);

  assert.equal((await call('PUT', '/api/v1/inputs/prices', katibu, { inputItemId: id, unitPrice: '25000' })).status, 200);
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', katibu, { inputItemId: id, quantity: 10, reference: 'DN-1' })).status, 403, 'Meneja hapokei stoo');
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', clerk, { inputItemId: id, quantity: 10, reference: 'DN-1' })).status, 202, 'Mzigo unasubiri idhini ya Meneja');
  assert.equal((await decideFor(id)).status, 200);

  const over = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: id, quantity: 11 }] });
  assert.equal(over.body.error.code, 'INSUFFICIENT_STOCK');

  // Maombi 5 ya lita 3 kila moja; stoo ni 10. Meneja akiidhinisha yote kwa wakati mmoja -> 3 tu yanafanikiwa
  const requests = await Promise.all(
    Array.from({ length: 5 }, () => call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: id, quantity: 3 }] })),
  );
  assert.ok(requests.every((r) => r.status === 201));
  const pend = (await call('GET', '/api/v1/approvals?status=PENDING&type=INPUT_ISSUE&pageSize=100', katibu)).body.data as any[];
  const mine = pend.filter((a) => requests.some((r) => r.body.issue.id === a.entityId));
  const results = await Promise.all(mine.map((a) => call('POST', `/api/v1/approvals/${a.id}/decide`, katibu, { decision: 'APPROVED', note: 'sawa' })));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'));
  const bal = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === id);
  assert.equal(bal.balance, '1.00');
  assert.equal(bal.issued, '9.00');

  assert.equal((await call('POST', '/api/v1/inputs/stock/adjustments', accountant, { inputItemId: id, quantity: -1, notes: 'imeharibika stoo' })).status, 403);
  const adj = await call('POST', '/api/v1/inputs/stock/adjustments', clerk, { inputItemId: id, quantity: -2, notes: 'imeharibika stoo' });
  assert.equal(adj.status, 400, 'marekebisho hayawezi kufanya stoo kuwa hasi');
});

test('database: ledger, stoo na audit haziwezi kubadilishwa wala kufutwa', async () => {
  const immutable = (e: any) => /IMMUTABLE_RECORD/.test(e?.cause?.message ?? e?.message);
  await assert.rejects(db.execute(sql`update member_ledger_entries set debit = 1`), immutable);
  await assert.rejects(db.execute(sql`delete from member_ledger_entries`), immutable);
  await assert.rejects(db.execute(sql`delete from stock_movements`), immutable);
  await assert.rejects(db.execute(sql`update audit_logs set action = 'x'`), immutable);
});

test('ripoti na audit log', async () => {
  const s = await call('GET', '/api/v1/reports/season-summary', katibu);
  assert.equal(s.status, 200);
  assert.ok(Number(s.body.inputs.value) > 0);
  const b = await call('GET', '/api/v1/reports/member-balances?onlyOwing=true', katibu);
  assert.equal(b.status, 200);
  assert.ok(b.body.data.every((r: any) => Number(r.balance) < 0));
  const u = await call('GET', '/api/v1/reports/season-summary', unionAdmin);
  assert.equal(u.status, 200);

  // Kumbukumbu (audit) ni ya Super Admin pekee (v0.4.1)
  const logs = await call('GET', `/api/v1/audit-logs?entity=InputIssue&pageSize=100`, superT);
  assert.equal(logs.status, 200);
  assert.ok(logs.body.data.some((l: any) => l.action === 'INPUT_ISSUE_CANCEL'));
  assert.equal((await call('GET', '/api/v1/audit-logs', clerk)).status, 403);
  assert.equal((await call('GET', '/api/v1/audit-logs', katibu)).status, 403);
  assert.equal((await call('GET', '/api/v1/audit-logs', accountant)).status, 403);
  assert.equal((await call('GET', '/api/v1/audit-logs', otherAdmin)).status, 403);
  const other = await call('GET', `/api/v1/audit-logs?amcosId=${otherAmcosId}`, superT);
  assert.ok(other.body.data.every((l: any) => l.amcosId === otherAmcosId));
});

test('ukaguzi: shamba la chama kingine haliwezi kuunganishwa na makisio', async () => {
  const other = await call('POST', '/api/v1/members', otherAdmin, { firstName: 'Shamba', lastName: 'Lingine', gender: 'MALE' });
  const farm = await call('POST', `/api/v1/members/${other.body.member.id}/farms`, otherAdmin, { acres: '1' });
  assert.equal(farm.status, 201);
  const m = await call('POST', '/api/v1/members', katibu, { firstName: 'Mkisio', lastName: 'Mpya' + RUN, gender: 'FEMALE' });
  assert.equal(m.body.member.status, 'ACTIVE', 'Meneja akisajili mwenyewe, mkulima anakuwa hai');
  const est = await call('POST', '/api/v1/estimates', clerk, { memberId: m.body.member.id, acresPlanted: 1, estimatedKg: 500 });
  assert.equal(est.status, 201);
  const bad = await call('PATCH', `/api/v1/estimates/${est.body.estimate.id}`, clerk, { farmId: farm.body.farm.id });
  assert.equal(bad.status, 400);
});

test('ukaguzi: kuingia kwa mafanikio hakuzuiwi na rate limit', async () => {
  for (let i = 0; i < 12; i++) assert.ok(await login('0711000003', 'Demo12345'));
});
