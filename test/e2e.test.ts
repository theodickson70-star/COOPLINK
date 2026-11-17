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
  return call('POST', `/api/v1/approvals/${a.id}/decide`, katibu, { confirmPassword: 'Demo12345', decision, note: 'Imekaguliwa' });
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
  assert.equal(r.body.member.status, 'PENDING', 'Storekeeper akisajili, mkulima anasubiri uthibitisho wa Meneja');
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
  const ok = await call('POST', `/api/v1/estimates/${r.body.estimate.id}/approve`, katibu, { confirmPassword: 'Demo12345' });
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

  assert.equal((await call('GET', `/api/v1/members/${memberId}`, clerk)).body.balance, null, 'Storekeeper haoni fedha za mkulima');
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
  const results = await Promise.all(mine.map((a) => call('POST', `/api/v1/approvals/${a.id}/decide`, katibu, { confirmPassword: 'Demo12345', decision: 'APPROVED', note: 'sawa' })));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'));
  const bal = (await call('GET', '/api/v1/inputs/stock', clerk)).body.data.find((s: any) => s.inputItemId === id);
  assert.equal(bal.balance, '1.00');
  assert.equal(bal.issued, '9.00');

  // v2.8: hali ya stoo — inakaribia kuisha (kwa kasi ya kutoka), chini ya kiwango, imeisha; inayoingia/inayotoka; arifa
  const ovOf = async () => (await call('GET', '/api/v1/store/overview?days=30', clerk)).body.items.find((x: any) => x.id === id);
  let o = await ovOf();
  assert.equal(o.balance, 1); assert.equal(o.issued, 9); assert.equal(o.inPeriod, 10); assert.equal(o.outPeriod, 9);
  assert.equal(o.status, 'SOON', 'Bila kiwango: kwa kasi ya kutoka itaisha ndani ya siku 14'); assert.ok(o.daysLeft !== null && o.daysLeft <= 14);
  assert.ok(o.suggestedLevel > 0, 'Mfumo unapendekeza kiwango cha chini');
  assert.equal((await call('PATCH', `/api/v1/inputs/items/${id}`, clerk, { reorderLevel: '5' })).status, 200);
  o = await ovOf(); assert.equal(o.status, 'LOW');
  let nb = (await call('GET', '/api/v1/notifications', clerk)).body.items.find((i: any) => i.type === 'STOCK' && i.itemId === id);
  assert.ok(nb && nb.unread && nb.kind === 'STOCK_LOW', 'Storekeeper anapata tahadhari ya stoo');
  assert.equal((await call('POST', `/api/v1/notifications/stock/${nb.id}/read`, clerk, {})).status, 200);
  assert.equal((await call('GET', '/api/v1/notifications', clerk)).body.items.find((i: any) => i.type === 'STOCK' && i.itemId === id).unread, false);
  const last = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: id, quantity: 1 }] });
  assert.equal((await decideFor(last.body.issue.id)).status, 200);
  o = await ovOf(); assert.equal(o.status, 'OUT'); assert.equal(o.balance, 0);
  nb = (await call('GET', '/api/v1/notifications', clerk)).body.items.find((i: any) => i.type === 'STOCK' && i.itemId === id);
  assert.ok(nb.unread && nb.kind === 'STOCK_OUT', 'Mwendo mpya -> arifa inarudi kama "imeisha"');
  const ovAll = (await call('GET', '/api/v1/store/overview', clerk)).body;
  assert.ok(ovAll.kpis.out >= 1 && ovAll.daily.length === 30);
  const ins = (await call('GET', `/api/v1/inputs/stock/movements?inputItemId=${id}&direction=IN`, clerk)).body;
  const outs = (await call('GET', `/api/v1/inputs/stock/movements?inputItemId=${id}&direction=OUT`, clerk)).body;
  assert.equal(ins.totals.inQty, '10.0000'); assert.equal(Number(outs.totals.outQty), 10); assert.equal(outs.totals.inCount, 0);
  assert.ok(outs.data.every((m: any) => Number(m.quantity) < 0 && m.member), 'Inayotoka inaonyesha mkulima aliyepewa');

  // v2.9: SMS ya tahadhari ya stoo (Storekeeper + Meneja) — mara moja tu hali ikiwa mbaya zaidi; muhtasari wa Meneja
  const { getSetting, setSetting } = await import('../src/lib/settings');
  const { runStockAlertSms, runDailyDigests, stockLine } = await import('../src/lib/daily');
  const ev = await getSetting('sms.events');
  await setSetting(db, 'sms.events', { ...ev, STOCK_ALERT: true, DAILY_SUMMARY: true });
  try {
    const amcosOf = (await db.execute<{ amcos_id: string }>(sql`select amcos_id from input_items where id = ${id}`)).rows[0].amcos_id;
    const smsFor = async (kind: string) => (await db.execute<{ message: string; phone: string }>(sql`select message, phone from sms_logs where kind = ${kind} and amcos_id = ${amcosOf} order by created_at desc`)).rows;
    const before = (await smsFor('STOCK_ALERT')).length;
    await runStockAlertSms();
    const first = await smsFor('STOCK_ALERT');
    assert.ok(first.length > before, 'SMS ya stoo imewekwa foleni');
    assert.ok(first.some((x) => x.message.includes(`Dawa ${RUN} IMEISHA`)), first[0]?.message);
    const n = first.length;
    await runStockAlertSms();
    assert.equal((await smsFor('STOCK_ALERT')).length, n, 'Hali ileile -> hakuna SMS ya pili');
    assert.match(stockLine({ name: 'NPK', unit: 'BAG', status: 'LOW', balance: 4, daysLeft: 2 } as any), /NPK chini ya kiwango \(salio 4 mifuko\)/);
    await runDailyDigests({ force: true });
    const sum = await smsFor('DAILY_SUMMARY');
    assert.ok(sum.length >= 1 && /Muhtasari wa jana/.test(sum[0].message) && /zimeisha/.test(sum[0].message), sum[0]?.message);
  } finally {
    await setSetting(db, 'sms.events', ev);
  }

  // v2.9: ufuatiliaji — chama kimoja kikipata makosa mfululizo, Owner anapewa tahadhari (na SMS)
  const { evaluateConditions } = await import('../src/lib/monitor');
  const uid = (await db.execute<{ id: string; amcos_id: string }>(sql`select id, amcos_id from users where phone = '255711000002'`)).rows[0];
  for (let i = 0; i < 5; i++) await db.execute(sql`insert into system_errors (method, path, status, message, user_id) values ('POST', '/api/v1/test-v29', 500, 'jaribio', ${uid.id})`);
  const conds = await evaluateConditions();
  const ce = conds.find((c) => c.key === `CHAMA_ERRORS:${uid.amcos_id}`);
  assert.ok(ce?.active, 'Tahadhari ya chama chenye makosa'); assert.match(ce!.title, /makosa \d+ ya mfumo/);
  await db.execute(sql`update system_errors set resolved_at = now() where path = '/api/v1/test-v29'`);

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

test('offline (v2.9): kifurushi cha data, usajili na ugawaji kutoka foleni havirudiwi', async () => {
  const pack = (await call('GET', '/api/v1/offline/pack', clerk)).body;
  assert.ok(pack.members.length > 0 && pack.items.length > 0 && pack.season.id);
  assert.ok(pack.can.issue && pack.can.register);
  const me = pack.members.find((m: any) => m.id === memberId);
  assert.ok(me, 'Mkulima hai yumo kwenye kifurushi');
  assert.equal(me.phoneEnd, '456', 'Tarakimu 3 za mwisho tu');
  assert.ok(!JSON.stringify(pack).includes('255754123456'), 'Hakuna namba kamili ya simu');
  assert.ok(pack.items.every((i: any) => 'balance' in i && 'price' in i));
  assert.equal((await call('GET', '/api/v1/offline/pack', undefined)).status, 401);

  // Usajili kutoka foleni: ukitumwa mara mbili (mtandao ukikatika baada ya kutuma) -> rekodi moja
  const ref = 'off-' + RUN + '-member1';
  const body = { firstName: 'Offline', lastName: 'Mkulima' + RUN, gender: 'FEMALE', village: 'Usisya', clientRef: ref };
  const a = await call('POST', '/api/v1/members', clerk, body);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await call('POST', '/api/v1/members', clerk, body);
  assert.equal(b.status, 200); assert.equal(b.body.duplicate, true); assert.equal(b.body.member.id, a.body.member.id);
  assert.equal((await db.execute<{ n: number }>(sql`select count(*)::int as n from members where client_ref = ${ref}`)).rows[0].n, 1);

  // Ugawaji kutoka foleni (njia ileile ya kawaida, clientRef)
  const it = pack.items.find((i: any) => i.price && Number(i.balance) >= 1);
  if (it) {
    const iref = 'off-' + RUN + '-issue1';
    const x = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: it.id, quantity: 1 }], clientRef: iref });
    assert.equal(x.status, 201, JSON.stringify(x.body));
    const y = await call('POST', '/api/v1/input-issues', clerk, { memberId, lines: [{ inputItemId: it.id, quantity: 1 }], clientRef: iref });
    assert.equal(y.body.duplicate, true); assert.equal(y.body.issue.id, x.body.issue.id);
  }
  // Mapendekezo ya vijiji (public + ya chama)
  const v = (await call('GET', '/api/v1/public/locations/villages?region=Tabora&district=Urambo&ward=Usisya', undefined)).body;
  assert.ok(v.villages.includes('Katungulu'));
  const mv = (await call('GET', '/api/v1/members/villages', clerk)).body;
  assert.ok(mv.villages.some((x: string) => x.toLowerCase() === 'usisya'), 'Vijiji vilivyokwisha andikwa vinapendekezwa');
});
