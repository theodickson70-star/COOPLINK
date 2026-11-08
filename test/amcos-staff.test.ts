// Majaribio ya watumishi watatu wa AMCOS (Meneja, Mhasibu, Stokipa), idhini, fedha na stoo — v0.3.0
// Yanathibitisha masharti ya sehemu ya 11 ya spec "AMCOS STAFF ROLES & PERMISSIONS".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const OWNER_PW = 'OwnerPass2026';
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 100000)).slice(-7);

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body: json };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body;

let owner: string;
interface Amcos { id: string; manager: string; accountant: string; storekeeper: string; managerId: string }
let A: Amcos, B: Amcos;

/** Owner anaunda chama, anakiidhinisha, na anaweka watumishi watatu (kila mmoja anabadilisha nenosiri la muda). */
async function setupAmcos(code: string): Promise<Amcos> {
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `AMCOS ${code}`, code });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const id = reg.body.amcos.id;
  assert.equal((await call('POST', `/api/v1/owner/amcos/${id}/approve`, owner, {})).status, 200);
  const tokens: Record<string, string> = {};
  let managerId = '';
  for (const [role, name] of [['AMCOS_ADMIN', 'Meneja'], ['ACCOUNTANT', 'Mhasibu'], ['CLERK', 'Stokipa']] as const) {
    const phone = uniqPhone('25576');
    const r = await call('POST', `/api/v1/owner/amcos/${id}/staff`, owner, { role, fullName: `${name} ${code}`, phone });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (role === 'AMCOS_ADMIN') managerId = r.body.user.id;
    const t = (await login(phone, r.body.temporaryPassword)).token;
    const ch = await call('POST', '/api/v1/auth/change-password', t, { currentPassword: r.body.temporaryPassword, newPassword: 'Staff12345' });
    assert.equal(ch.status, 200);
    tokens[role] = ch.body.token;
  }
  return { id, manager: tokens.AMCOS_ADMIN, accountant: tokens.ACCOUNTANT, storekeeper: tokens.CLERK, managerId };
}

async function pendingFor(token: string, entityId: string) {
  const list = (await call('GET', '/api/v1/approvals?status=PENDING&pageSize=100', token)).body.data as any[];
  return list.find((a) => a.entityId === entityId);
}
const stockOf = async (token: string, itemId: string) =>
  (await call('GET', '/api/v1/inputs/stock', token)).body.data.find((s: any) => s.inputItemId === itemId)?.balance ?? '0';

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password)
    values ('Owner Staff Test', ${phone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false)`);
  owner = (await login(phone, OWNER_PW)).token;
  A = await setupAmcos('SA' + RUN);
  B = await setupAmcos('SB' + RUN);
});

after(async () => {
  server.close();
  await pool.end();
});

// 1 ------------------------------------------------------------------
test('AMCOS moja haiwezi kuwa na zaidi ya watumishi watatu (mmoja kwa kila cheo)', async () => {
  const slots = (await call('GET', `/api/v1/owner/amcos/${A.id}/staff`, owner)).body.slots as any[];
  assert.deepEqual(slots.map((s) => [s.role, !!s.holder]), [['AMCOS_ADMIN', true], ['ACCOUNTANT', true], ['CLERK', true]]);

  // Mtumishi wa pili mwenye cheo kilekile -> 409
  const dup = await call('POST', `/api/v1/owner/amcos/${A.id}/staff`, owner, { role: 'ACCOUNTANT', fullName: 'Mhasibu wa Pili', phone: uniqPhone('25577') });
  assert.equal(dup.status, 409);
  // Akaunti ya nne (mtazamaji) haiwezi kuundwa
  const viewer = await call('POST', '/api/v1/users', owner, { fullName: 'Mtazamaji Bodi', phone: uniqPhone('25578'), role: 'AMCOS_VIEWER', amcosId: A.id });
  assert.equal(viewer.status, 400);
  const dup2 = await call('POST', '/api/v1/users', owner, { fullName: 'Stokipa wa Pili', phone: uniqPhone('25578'), role: 'CLERK', amcosId: A.id });
  assert.equal(dup2.status, 409);
  // Hata database yenyewe inazuia
  await assert.rejects(
    db.execute(sql`insert into users (full_name, phone, role, amcos_id, password_hash) values ('X', ${uniqPhone('25579')}, 'CLERK', ${A.id}, 'x')`),
    (e: any) => /users_one_staff_per_role/.test(e?.cause?.message ?? e?.message ?? '') || e?.cause?.code === '23505',
  );
  // Meneja hawezi kuunda watumishi; watumishi wanasimamiwa na Owner
  assert.equal((await call('POST', '/api/v1/users', A.manager, { fullName: 'Mtu Mpya', phone: uniqPhone('25578'), role: 'CLERK' })).status, 403);
  const staff = await call('GET', '/api/v1/users', A.manager);
  assert.equal(staff.status, 200, 'Meneja anaona watumishi wa chama chake');
  assert.ok(staff.body.data.every((u: any) => u.amcosId === A.id));

  // Kubadilisha mtumishi: inahitaji nenosiri la Owner; wa zamani anazimwa (hafutwi) na token yake inakufa
  const noAuth = await call('POST', `/api/v1/owner/amcos/${A.id}/staff`, owner, { role: 'CLERK', fullName: 'Stokipa Mpya', phone: uniqPhone('25577'), replace: true });
  assert.equal(noAuth.status, 403);
  const oldClerkId = slots.find((s) => s.role === 'CLERK').holder.id;
  const phone = uniqPhone('25577');
  const rep = await call('POST', `/api/v1/owner/amcos/${A.id}/staff`, owner, { role: 'CLERK', fullName: 'Stokipa Mpya', phone, replace: true, confirmPassword: OWNER_PW });
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
  assert.equal((await call('GET', '/api/v1/members', A.storekeeper)).status, 401, 'Stokipa wa zamani hawezi kuendelea');
  const after = (await call('GET', `/api/v1/owner/amcos/${A.id}/staff`, owner)).body;
  assert.ok(after.history.some((h: any) => h.id === oldClerkId && !h.isActive), 'Rekodi ya mtumishi wa zamani inabaki');
  const audits = await db.execute<{ action: string }>(sql`select action from audit_logs where entity_id = ${oldClerkId} and action = 'AMCOS_STAFF_REPLACED'`);
  assert.equal(audits.rows.length, 1);
  // Kumwasha wa zamani wakati nafasi ina mtu -> 409
  assert.equal((await call('POST', `/api/v1/owner/amcos/${A.id}/staff/${oldClerkId}/active`, owner, { isActive: true })).status, 409);
  const t = (await login(phone, rep.body.temporaryPassword)).token;
  A.storekeeper = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: rep.body.temporaryPassword, newPassword: 'Staff12345' })).body.token;
  assert.ok(A.storekeeper);
});

// 2 ------------------------------------------------------------------
test('Kila cheo kina ruhusa zake tu (backend)', async () => {
  const me = async (t: string) => (await call('GET', '/api/v1/auth/me', t)).body.user.amcosPermissions as string[];
  assert.ok((await me(A.manager)).includes('approvals.decide'));
  assert.ok(!(await me(A.accountant)).includes('approvals.decide'));
  assert.ok((await me(A.accountant)).includes('finance.record'));
  assert.ok(!(await me(A.storekeeper)).includes('finance.read'));

  // Stokipa hagusi fedha
  for (const p of ['/api/v1/finance/accounts', '/api/v1/finance/transactions', '/api/v1/finance/reports/summary', '/api/v1/reports/member-balances']) {
    assert.equal((await call('GET', p, A.storekeeper)).status, 403, p);
  }
  assert.equal((await call('POST', '/api/v1/finance/expenses', A.storekeeper, { category: 'OFFICE', amount: 1000, description: 'karatasi' })).status, 403);
  // Mhasibu hagusi stoo moja kwa moja
  const item = await call('POST', '/api/v1/inputs/items', A.storekeeper, { name: 'NPK ' + RUN, category: 'FERTILIZER', unit: 'BAG', reorderLevel: '5' });
  assert.equal(item.status, 201);
  const itemId = item.body.item.id;
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', A.accountant, { inputItemId: itemId, quantity: 5, reference: 'DN-X' })).status, 403);
  assert.equal((await call('POST', '/api/v1/inputs/stock/adjustments', A.accountant, { inputItemId: itemId, quantity: 5, notes: 'nimeongeza mwenyewe' })).status, 403);
  assert.equal((await call('POST', '/api/v1/store/purchases', A.accountant, { notes: 'nunua', lines: [{ inputItemId: itemId, quantity: 1, unitCost: 1 }] })).status, 403);
  // Meneja haandiki fedha wala hapokei stoo; anaidhinisha
  assert.equal((await call('POST', '/api/v1/finance/income', A.manager, { category: 'LEVY', amount: 1000, description: 'ushuru' })).status, 403);
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', A.manager, { inputItemId: itemId, quantity: 5, reference: 'DN-X' })).status, 403);
  // Owner kwenye upande wa chama: kusoma tu, hawezi kuidhinisha wala kuandika
  assert.equal((await call('GET', `/api/v1/finance/transactions?amcosId=${A.id}`, owner)).status, 200);
  assert.equal((await call('POST', '/api/v1/finance/income', owner, { category: 'LEVY', amount: 1000, description: 'ushuru', amcosId: A.id })).status, 403);
  // Dashibodi tofauti kwa kila cheo
  const ws = async (t: string) => (await call('GET', '/api/v1/workspace/summary', t)).body;
  const [m, a, s] = [await ws(A.manager), await ws(A.accountant), await ws(A.storekeeper)];
  assert.equal(m.title, 'Meneja'); assert.ok(m.finance && m.stock && m.approvals);
  assert.equal(a.title, 'Mhasibu'); assert.ok(a.finance && a.stock);
  assert.equal(s.title, 'Stokipa'); assert.equal(s.finance, undefined); assert.ok(s.stock);
});

let itemId: string, cashId: string;

// 3 ------------------------------------------------------------------
test('Mhasibu hawezi kuidhinisha ombi lake; hakuna anayeidhinisha ombi alilolianzisha', async () => {
  const acc = await call('POST', '/api/v1/finance/accounts', A.accountant, { name: 'Sanduku la fedha', kind: 'CASH', openingBalance: '500000' });
  assert.equal(acc.status, 201);
  cashId = acc.body.account.id;
  const exp = await call('POST', '/api/v1/finance/expenses', A.accountant, { category: 'TRANSPORT', amount: '120000', description: 'Usafiri wa pembejeo', payee: 'Juma Lori', accountId: cashId });
  assert.equal(exp.status, 201);
  assert.equal(exp.body.transaction.status, 'PENDING_APPROVAL');
  const apId = exp.body.approval.id;
  // Mhasibu hana mamlaka ya kuamua
  assert.equal((await call('POST', `/api/v1/approvals/${apId}/decide`, A.accountant, { decision: 'APPROVED', note: 'sawa' })).status, 403);
  // Hawezi kukamilisha kabla ya idhini
  assert.equal((await call('POST', `/api/v1/finance/transactions/${exp.body.transaction.id}/post`, A.accountant, {})).status, 400);
  // Hata Meneja hawezi kuidhinisha ombi alilolianzisha mwenyewe
  const [own] = (await db.execute<{ id: string }>(sql`insert into approval_requests (amcos_id, request_no, type, title, requested_by_id, requested_role)
    values (${A.id}, ${'IDH-T' + RUN}, 'EXPENSE', 'Ombi la Meneja', ${A.managerId}, 'AMCOS_ADMIN') returning id`)).rows;
  const self = await call('POST', `/api/v1/approvals/${own.id}/decide`, A.manager, { decision: 'APPROVED', note: 'sawa' });
  assert.equal(self.status, 403);
  assert.match(self.body.error.message, /mwenyewe/);
  // Maelezo ya uamuzi ni lazima
  assert.equal((await call('POST', `/api/v1/approvals/${apId}/decide`, A.manager, { decision: 'APPROVED', note: '' })).status, 400);

  // Meneja anaidhinisha -> Mhasibu anakamilisha -> salio linapungua
  const ok = await call('POST', `/api/v1/approvals/${apId}/decide`, A.manager, { decision: 'APPROVED', note: 'Gharama ni sahihi' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.approval.decidedRole, 'AMCOS_ADMIN');
  const posted = await call('POST', `/api/v1/finance/transactions/${exp.body.transaction.id}/post`, A.accountant, { reference: 'RISITI-1' });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.transaction.status, 'POSTED');
  const accs = (await call('GET', '/api/v1/finance/accounts', A.accountant)).body.data;
  assert.equal(accs.find((x: any) => x.id === cashId).balance, '380000.00');
});

// 4 & 6 --------------------------------------------------------------
test('Stokipa hawezi kuidhinisha marekebisho; stoo haibadiliki kabla ya idhini', async () => {
  itemId = (await call('GET', '/api/v1/inputs/items', A.storekeeper)).body.data.find((i: any) => i.name === 'NPK ' + RUN).id;
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', A.storekeeper, { inputItemId: itemId, quantity: 40, reference: 'DN-' + RUN, expiryDate: '2027-06-30', batchNo: 'B1' })).status, 201);
  assert.equal(await stockOf(A.storekeeper, itemId), '40.00');

  const req = await call('POST', '/api/v1/inputs/stock/adjustments', A.storekeeper, { inputItemId: itemId, quantity: '-3', kind: 'DAMAGE', notes: 'Mifuko 3 imelowa maji' });
  assert.equal(req.status, 202);
  const apId = req.body.approval.id;
  assert.equal(await stockOf(A.storekeeper, itemId), '40.00', 'Stoo haibadiliki kabla ya idhini');
  assert.equal((await call('POST', `/api/v1/approvals/${apId}/decide`, A.storekeeper, { decision: 'APPROVED', note: 'sawa' })).status, 403);
  assert.equal((await call('POST', `/api/v1/approvals/${apId}/decide`, A.accountant, { decision: 'APPROVED', note: 'sawa' })).status, 403);

  // Meneja anakataa ombi moja na kuidhinisha jingine
  const r2 = await call('POST', '/api/v1/inputs/stock/adjustments', A.storekeeper, { inputItemId: itemId, quantity: '-10', notes: 'Hesabu imepungua bila maelezo' });
  const rej = await call('POST', `/api/v1/approvals/${r2.body.approval.id}/decide`, A.manager, { decision: 'REJECTED', note: 'Hesabu upya kwanza' });
  assert.equal(rej.status, 200);
  assert.equal(await stockOf(A.storekeeper, itemId), '40.00', 'Lililokataliwa halibadilishi stoo');
  const ok = await call('POST', `/api/v1/approvals/${apId}/decide`, A.manager, { decision: 'APPROVED', note: 'Nimeona mifuko iliyoharibika' });
  assert.equal(ok.status, 200);
  const st = (await call('GET', '/api/v1/inputs/stock', A.storekeeper)).body.data.find((s: any) => s.inputItemId === itemId);
  assert.equal(st.balance, '37.00');
  assert.equal(st.damaged, '3.00');
  // Uamuzi uliofanyika hauamuliwi tena
  assert.equal((await call('POST', `/api/v1/approvals/${apId}/decide`, A.manager, { decision: 'REJECTED', note: 'badilisha' })).status, 409);

  // Ugawaji wa pembejeo unasubiri idhini
  assert.equal((await call('PUT', '/api/v1/inputs/prices', A.manager, { inputItemId: itemId, unitPrice: '80000' })).status, 200);
  const mem = await call('POST', '/api/v1/members', A.storekeeper, { firstName: 'Rehema', lastName: 'Kulwa' + RUN, gender: 'FEMALE' });
  assert.equal(mem.body.member.status, 'PENDING');
  const early = await call('POST', '/api/v1/input-issues', A.storekeeper, { memberId: mem.body.member.id, lines: [{ inputItemId: itemId, quantity: 2 }] });
  assert.equal(early.status, 400, 'Mkulima ambaye hajathibitishwa hapewi pembejeo');
  const mAp = await pendingFor(A.manager, mem.body.member.id);
  assert.equal((await call('POST', `/api/v1/approvals/${mAp.id}/decide`, A.manager, { decision: 'APPROVED', note: 'Ni mwanachama halali' })).status, 200);
  const iss = await call('POST', '/api/v1/input-issues', A.storekeeper, { memberId: mem.body.member.id, lines: [{ inputItemId: itemId, quantity: 2 }] });
  assert.equal(iss.status, 201);
  assert.equal(iss.body.issue.status, 'PENDING_APPROVAL');
  assert.equal(await stockOf(A.storekeeper, itemId), '37.00');
  const iAp = await pendingFor(A.manager, iss.body.issue.id);
  assert.equal((await call('POST', `/api/v1/approvals/${iAp.id}/decide`, A.manager, { decision: 'APPROVED', note: 'Kulingana na makisio' })).status, 200);
  assert.equal(await stockOf(A.storekeeper, itemId), '35.00');
  assert.equal((await call('GET', `/api/v1/members/${mem.body.member.id}`, A.accountant)).body.balance.amountOwed, '160000.00');
});

// 5 ------------------------------------------------------------------
test('Manunuzi: Stokipa anaomba -> Meneja anaidhinisha -> Mhasibu analipa -> Stokipa anapokea', async () => {
  const sup = await call('POST', '/api/v1/store/suppliers', A.storekeeper, { name: 'Mbolea Ltd ' + RUN, phone: '0755123456' });
  assert.equal(sup.status, 201);
  const pr = await call('POST', '/api/v1/store/purchases', A.storekeeper, {
    supplierId: sup.body.supplier.id, notes: 'Stoo inakaribia kuisha', lines: [{ inputItemId: itemId, quantity: 20, unitCost: '70000' }],
  });
  assert.equal(pr.status, 201);
  const prId = pr.body.purchase.id;
  assert.equal(pr.body.purchase.totalAmount, '1400000.00');
  // Haiwezi kupokelewa wala kulipwa kabla ya idhini
  const lineId = (await call('GET', `/api/v1/store/purchases/${prId}`, A.storekeeper)).body.lines[0].id;
  assert.equal((await call('POST', `/api/v1/store/purchases/${prId}/receive`, A.storekeeper, { reference: 'DN-P', lines: [{ lineId, quantity: 5 }] })).status, 400);
  assert.equal((await call('POST', '/api/v1/finance/supplier-payments', A.accountant, { supplierId: sup.body.supplier.id, purchaseRequestId: prId, amount: '100', description: 'malipo' })).status, 400);

  assert.equal((await call('POST', `/api/v1/approvals/${pr.body.approval.id}/decide`, A.manager, { decision: 'APPROVED', note: 'Bei imelinganishwa' })).status, 200);

  // Mhasibu analipa sehemu (idhini ya manunuzi inatosha — haiombi idhini mara ya pili)
  const income = await call('POST', '/api/v1/finance/income', A.accountant, { category: 'LEVY', amount: '2000000', description: 'Ushuru wa msimu', accountId: cashId });
  assert.equal(income.status, 201);
  assert.equal(income.body.transaction.status, 'POSTED');
  const pay = await call('POST', '/api/v1/finance/supplier-payments', A.accountant, { supplierId: sup.body.supplier.id, purchaseRequestId: prId, amount: '700000', description: 'Malipo ya awali', accountId: cashId });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  assert.equal(pay.body.transaction.status, 'APPROVED');
  assert.equal(pay.body.approval, null);
  const over = await call('POST', '/api/v1/finance/supplier-payments', A.accountant, { supplierId: sup.body.supplier.id, purchaseRequestId: prId, amount: '800000', description: 'Zaidi', accountId: cashId });
  assert.equal(over.status, 400, 'Hawezi kulipa zaidi ya thamani ya ombi');
  assert.equal((await call('POST', `/api/v1/finance/transactions/${pay.body.transaction.id}/post`, A.accountant, {})).status, 200);

  // Stokipa anapokea mzigo kwa awamu
  const rec = await call('POST', `/api/v1/store/purchases/${prId}/receive`, A.storekeeper, { reference: 'DN-P1', lines: [{ lineId, quantity: 12, batchNo: 'B2' }] });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.purchase.status, 'PARTIALLY_RECEIVED');
  assert.equal(await stockOf(A.storekeeper, itemId), '47.00');
  assert.equal((await call('POST', `/api/v1/store/purchases/${prId}/receive`, A.storekeeper, { reference: 'DN-P2', lines: [{ lineId, quantity: 9 }] })).status, 400, 'haiwezi kupokea zaidi ya ombi');
  const rec2 = await call('POST', `/api/v1/store/purchases/${prId}/receive`, A.storekeeper, { reference: 'DN-P2', lines: [{ lineId, quantity: 8 }] });
  assert.equal(rec2.body.purchase.status, 'RECEIVED');
  const payables = (await call('GET', '/api/v1/finance/reports/payables', A.accountant)).body;
  assert.equal(payables.data.find((p: any) => p.id === prId).owing, '700000.00');
});

// 7 ------------------------------------------------------------------
test('Miamala iliyokamilika haifutwi kimyakimya: database inazuia, na marekebisho ni REVERSAL yenye idhini', async () => {
  const txns = (await call('GET', '/api/v1/finance/transactions?status=POSTED&pageSize=100', A.accountant)).body.data as any[];
  const exp = txns.find((t) => t.kind === 'EXPENSE');
  const blocked = (e: any) => /finance_transactions/.test(e?.cause?.message ?? e?.message ?? '');
  await assert.rejects(db.execute(sql`delete from finance_transactions where id = ${exp.id}`), blocked);
  await assert.rejects(db.execute(sql`update finance_transactions set amount = 1 where id = ${exp.id}`), blocked);
  await assert.rejects(db.execute(sql`delete from approval_requests where amcos_id = ${A.id}`), (e: any) => /approval_requests/.test(e?.cause?.message ?? ''));
  await assert.rejects(db.execute(sql`update approval_requests set status = 'REJECTED' where amcos_id = ${A.id} and status = 'APPROVED'`), (e: any) => /approval_requests/.test(e?.cause?.message ?? ''));
  await assert.rejects(db.execute(sql`delete from stock_movements where amcos_id = ${A.id}`), (e: any) => /IMMUTABLE_RECORD/.test(e?.cause?.message ?? ''));

  const before = (await call('GET', '/api/v1/finance/accounts', A.accountant)).body.data.find((x: any) => x.id === cashId).balance;
  const rv = await call('POST', `/api/v1/finance/transactions/${exp.id}/reverse`, A.accountant, { reason: 'Gharama iliandikwa mara mbili' });
  assert.equal(rv.status, 202);
  assert.equal((await call('POST', `/api/v1/finance/transactions/${exp.id}/reverse`, A.accountant, { reason: 'tena tena' })).status, 409);
  assert.equal((await call('POST', `/api/v1/approvals/${rv.body.approval.id}/decide`, A.manager, { decision: 'APPROVED', note: 'Nimethibitisha nakala mbili' })).status, 200);
  const afterBal = (await call('GET', '/api/v1/finance/accounts', A.accountant)).body.data.find((x: any) => x.id === cashId).balance;
  assert.equal(Number(afterBal) - Number(before), 120000);
  const orig = (await call('GET', `/api/v1/finance/transactions/${exp.id}`, A.accountant)).body.transaction;
  assert.equal(orig.status, 'POSTED', 'Muamala wa asili unabaki kama ulivyo');
  assert.equal(orig.reversed, true);
  const summary = (await call('GET', '/api/v1/finance/reports/summary', A.manager)).body;
  assert.equal(summary.totals.expense, '0.00', 'Matumizi yaliyosahihishwa hayahesabiwi');
  assert.equal(summary.totals.income, '2000000.00');
  // Audit log ina kila hatua: ombi, uamuzi, utekelezaji
  const acts = (await db.execute<{ action: string }>(sql`select action from audit_logs where amcos_id = ${A.id}`)).rows.map((r) => r.action);
  for (const a of ['APPROVAL_REQUEST', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'FINANCE_TXN_POST', 'FINANCE_TXN_REVERSED', 'STOCK_ADJUSTMENT_APPLIED', 'PURCHASE_GOODS_RECEIVED']) {
    assert.ok(acts.includes(a), a);
  }
});

// 8 ------------------------------------------------------------------
test('AMCOS A haiwezi kuona wala kugusa taarifa za AMCOS B', async () => {
  const bExp = await call('POST', '/api/v1/finance/expenses', B.accountant, { category: 'OFFICE', amount: '5000', description: 'Karatasi za B' });
  assert.equal(bExp.status, 201);
  const aTx = (await call('GET', '/api/v1/finance/transactions?pageSize=100', A.accountant)).body.data as any[];
  assert.ok(aTx.every((t) => t.amcosId === A.id));
  assert.equal((await call('GET', `/api/v1/finance/transactions/${bExp.body.transaction.id}`, A.accountant)).status, 404);
  assert.equal((await call('GET', `/api/v1/approvals/${bExp.body.approval.id}`, A.manager)).status, 404);
  assert.equal((await call('POST', `/api/v1/approvals/${bExp.body.approval.id}/decide`, A.manager, { decision: 'APPROVED', note: 'sawa' })).status, 404);
  assert.ok(((await call('GET', '/api/v1/approvals?pageSize=100', A.manager)).body.data as any[]).every((a) => a.amcosId === A.id));
  assert.ok(((await call('GET', '/api/v1/store/suppliers', B.storekeeper)).body.data as any[]).every((s) => s.amcosId === B.id));
  assert.equal((await call('POST', `/api/v1/finance/income?amcosId=${B.id}`, A.accountant, { category: 'LEVY', amount: '1', description: 'Mapato ya B', accountId: cashId })).status, 403);
  const bWs = (await call('GET', '/api/v1/workspace/summary', B.manager)).body;
  assert.equal(bWs.approvals.total, 1, 'Meneja wa B anaona ombi la B tu');
});

// 9 ------------------------------------------------------------------
test('Owner Super Admin anaendelea kufanya kazi bila kuathiriwa', async () => {
  assert.equal((await call('GET', '/api/v1/owner/dashboard', owner)).status, 200);
  assert.equal((await call('GET', `/api/v1/owner/amcos/${A.id}`, owner)).body.admins.length, 3);
  assert.equal((await call('GET', '/api/v1/owner/dashboard', A.manager)).status, 403, 'Meneja hatumii endpoint za Owner');
  const me = (await call('GET', '/api/v1/auth/me', owner)).body.user;
  assert.equal(me.role, 'SUPER_ADMIN');
  assert.ok(me.permissions.includes('amcos.staff'));
  const ws = (await call('GET', `/api/v1/workspace/summary?amcosId=${A.id}`, owner)).body;
  assert.equal(ws.finance.accounts.length, 1, 'Owner anaona (kusoma tu) fedha za chama alichochagua');
});

// 10 -----------------------------------------------------------------
test('Kusajili chama: code inatolewa na mfumo; Meneja anaundwa na nenosiri la Owner na analazimika kulibadilisha', async () => {
  const name = `Kasisi${RUN} AMCOS`;
  const mgrPhone = uniqPhone('25575');
  const weak = await call('POST', '/api/v1/owner/amcos', owner, { name, activate: true, manager: { fullName: 'Meneja Mpya', phone: mgrPhone, password: 'fupi' } });
  assert.equal(weak.status, 400, 'nenosiri dhaifu linakataliwa');
  const r = await call('POST', '/api/v1/owner/amcos', owner, { name, activate: true, manager: { fullName: 'Meneja Mpya', phone: mgrPhone, password: 'Kuanzia2026' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.amcos.code, `KASISI${RUN}`.slice(0, 8), 'code kutoka neno kuu la jina');
  assert.equal(r.body.manager.fullName, 'Meneja Mpya');
  assert.ok(!JSON.stringify(r.body).includes('Kuanzia2026'), 'nenosiri halirudishwi');
  // Chama cha pili chenye jina linalofanana kinapata code tofauti
  const r2 = await call('POST', '/api/v1/owner/amcos', owner, { name: `Chama cha Msingi Kasisi${RUN}` });
  assert.equal(r2.status, 201);
  assert.notEqual(r2.body.amcos.code, r.body.amcos.code);
  assert.match(r2.body.amcos.code, /^KASISI.*2$/);
  // Namba ya Meneja ikiwa tayari inatumika -> hakuna chama kinachoundwa
  const dupe = await call('POST', '/api/v1/owner/amcos', owner, { name: 'Chama Kingine ' + RUN, manager: { fullName: 'X Y Z', phone: mgrPhone, password: 'Kuanzia2026' } });
  assert.equal(dupe.status, 409);
  // Meneja anaingia kwa nenosiri la kuanzia -> lazima abadilishe
  const l = await login(mgrPhone, 'Kuanzia2026');
  assert.ok(l.token);
  assert.equal(l.user.mustChangePassword, true);
  assert.equal(l.user.role, 'AMCOS_ADMIN');
  assert.equal((await call('GET', '/api/v1/members', l.token)).status, 403, 'hawezi kutumia mfumo kabla ya kubadilisha nenosiri');
  const ch = await call('POST', '/api/v1/auth/change-password', l.token, { currentPassword: 'Kuanzia2026', newPassword: 'Meneja2026x' });
  assert.equal(ch.status, 200);
  assert.equal((await call('GET', '/api/v1/members', ch.body.token)).status, 200);
  // Audit haina nenosiri
  const logs = await db.execute<{ after: unknown }>(sql`select after from audit_logs where amcos_id = ${r.body.amcos.id}`);
  assert.ok(!JSON.stringify(logs.rows).includes('Kuanzia2026'));
  // Kuweka Stokipa kwa nenosiri la Owner (bila nenosiri la muda kurudishwa)
  const st = await call('POST', `/api/v1/owner/amcos/${r.body.amcos.id}/staff`, owner, { role: 'CLERK', fullName: 'Stokipa Kasisi', phone: uniqPhone('25574'), password: 'Stoo2026a' });
  assert.equal(st.status, 201);
  assert.equal(st.body.temporaryPassword, null);
});

// 11 -----------------------------------------------------------------
test('Fomu ya mkulima: namba ya zamani, kadi ya mpiga kura, kiingilio, picha na mzamini', async () => {
  const oldNo = `URM/${RUN}/015`;
  const r = await call('POST', '/api/v1/members', A.manager, {
    memberNo: oldNo.toLowerCase(), firstName: 'Zuhura', lastName: 'Kasimu' + RUN, gender: 'FEMALE',
    voterIdNumber: `T-1000-${RUN}-567`, entryFee: '20000', guarantorName: 'Selemani Kasimu', guarantorPhone: '0754111222',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const mem = r.body.member;
  assert.equal(mem.memberNo, oldNo, 'namba ya zamani inatumika (herufi kubwa)');
  assert.equal(mem.voterIdNumber, `T-1000-${RUN}-567`);
  assert.equal(mem.nidaNumber, null);
  assert.equal(mem.entryFee, '20000.00');
  assert.equal(mem.entryFeePaid, false);
  assert.equal(mem.guarantorPhone, '255754111222');
  // Namba au kadi ya mpiga kura isijirudie
  const dupNo = await call('POST', '/api/v1/members', A.manager, { memberNo: oldNo, firstName: 'Mtu', lastName: 'Mwingine', gender: 'MALE' });
  assert.equal(dupNo.status, 409);
  assert.match(dupNo.body.error.message, /Zuhura/);
  assert.equal((await call('POST', '/api/v1/members', A.manager, { firstName: 'Mtu', lastName: 'Wa Tatu', gender: 'MALE', voterIdNumber: `T-1000-${RUN}-567` })).status, 409);
  // Namba ya chama ileile, chama kingine: inaruhusiwa
  assert.equal((await call('POST', '/api/v1/members', B.manager, { memberNo: oldNo, firstName: 'Juma', lastName: 'B' + RUN, gender: 'MALE' })).status, 201);
  // Bila namba -> mfumo unatoa
  const auto = await call('POST', '/api/v1/members', A.manager, { firstName: 'Auto', lastName: 'Namba' + RUN, gender: 'MALE' });
  assert.match(auto.body.member.memberNo, /^SA.*-\d{6}$/);
  // Alishalipa zamani: risiti ni lazima
  assert.equal((await call('PATCH', `/api/v1/members/${auto.body.member.id}`, A.manager, { entryFeePaid: true })).status, 400);
  const old = await call('PATCH', `/api/v1/members/${auto.body.member.id}`, A.manager, { entryFee: '15000', entryFeePaid: true, entryFeeReference: 'RISITI-2019-44', entryFeePaidAt: '2019-03-01' });
  assert.equal(old.status, 200);
  assert.equal(old.body.member.entryFeePaid, true);
  // Namba ya uanachama inabadilishwa na Meneja tu
  assert.equal((await call('PATCH', `/api/v1/members/${mem.id}`, A.storekeeper, { memberNo: 'NYINGINE-1' })).status, 400);
  assert.equal((await call('PATCH', `/api/v1/members/${mem.id}`, A.manager, { memberNo: `URM/${RUN}/016` })).status, 200);

  // Mhasibu akipokea kiingilio -> kinawekwa "kimelipwa"; reversal inakirudisha "hakijalipwa"
  const inc = await call('POST', '/api/v1/finance/income', A.accountant, { category: 'MEMBER_FEES', amount: '20000', description: 'Kiingilio cha Zuhura', accountId: cashId, memberId: mem.id });
  assert.equal(inc.status, 201);
  let after = (await call('GET', `/api/v1/members/${mem.id}`, A.manager)).body.member;
  assert.equal(after.entryFeePaid, true);
  assert.equal(after.entryFeeReference, inc.body.transaction.txnNo);
  const rv = await call('POST', `/api/v1/finance/transactions/${inc.body.transaction.id}/reverse`, A.accountant, { reason: 'Imeandikwa kwa mkulima asiye sahihi' });
  assert.equal((await call('POST', `/api/v1/approvals/${rv.body.approval.id}/decide`, A.manager, { decision: 'APPROVED', note: 'Sawa, sahihisha' })).status, 200);
  after = (await call('GET', `/api/v1/members/${mem.id}`, A.manager)).body.member;
  assert.equal(after.entryFeePaid, false);

  // Picha (hiari): kupakia, kusoma, AMCOS nyingine haioni
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='.repeat(2);
  assert.equal((await call('PUT', `/api/v1/members/${mem.id}/photo`, A.storekeeper, { mimeType: 'image/png', data: png })).status, 200);
  const det = (await call('GET', `/api/v1/members/${mem.id}`, A.manager)).body;
  assert.ok(det.photo?.updatedAt);
  const img = await fetch(`${base}/api/v1/members/${mem.id}/photo`, { headers: { authorization: `Bearer ${A.manager}` } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/v1/members/${mem.id}/photo`, { headers: { authorization: `Bearer ${B.manager}` } })).status, 404);
  assert.equal((await call('PUT', `/api/v1/members/${mem.id}/photo`, A.manager, { mimeType: 'image/gif', data: png })).status, 400);
  assert.equal((await call('PUT', `/api/v1/members/${mem.id}/photo`, A.manager, { mimeType: 'image/jpeg', data: 'A'.repeat(600_000) })).status, 400, 'picha kubwa mno');
});
