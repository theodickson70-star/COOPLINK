// Majaribio ya uhasibu kamili wa Mhasibu (v0.4.0): daftari kuu, ripoti kuu, mauzo ya tumbaku na makato,
// vocha/benki, mishahara na mali za chama. Kila hatua inakagua kwamba hesabu zinalingana (debit = credit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { paye } from '../src/lib/payroll';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const OWNER_PW = 'OwnerPass2026';
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 100000)).slice(-7);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
const month = today.slice(0, 7);

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

let owner: string, manager: string, accountant: string, storekeeper: string, amcosId: string;
let cash: any, bank: any;

async function approve(entityId: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') {
  const list = (await call('GET', '/api/v1/approvals?status=PENDING&pageSize=100', manager)).body.data as any[];
  const a = list.find((x) => x.entityId === entityId);
  assert.ok(a, `Ombi la idhini lipo kwa ${entityId}`);
  const r = await call('POST', `/api/v1/approvals/${a.id}/decide`, manager, { decision, note: 'Imekaguliwa na Meneja' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return a;
}
const gl = async () => (await call('GET', '/api/v1/accounting/chart', accountant)).body.data as any[];
const bal = (rows: any[], code: string) => rows.find((r) => r.code === code)?.balance ?? '0.00';
async function assertBooksBalance() {
  const tb = (await call('GET', '/api/v1/accounting/reports/trial-balance', accountant)).body;
  assert.equal(tb.balanced, true, `Trial balance: ${tb.totalDebit} vs ${tb.totalCredit}`);
  const bs = (await call('GET', '/api/v1/accounting/reports/balance-sheet', accountant)).body;
  assert.equal(bs.balanced, true, `Mizania: mali ${bs.totalAssets} vs madeni+mtaji ${bs.totalLiabilitiesEquity}`);
  const d = (await call('GET', '/api/v1/accounting/dashboard', accountant)).body;
  assert.equal(d.farmerLedgerCheck.matches, true, `Ledger ya wakulima ${d.farmerLedgerCheck.memberLedger} vs daftari kuu ${d.farmerLedgerCheck.generalLedger}`);
  return { tb, bs, d };
}

async function newMember(first: string) {
  const m = await call('POST', '/api/v1/members', storekeeper, { firstName: first, lastName: 'Mkulima' + RUN, gender: 'MALE', mobileMoneyNumber: '0754' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0'), mobileMoneyProvider: 'MPESA', preferredPayment: 'MOBILE_MONEY' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  await approve(m.body.member.id);
  return m.body.member;
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password)
    values ('Owner Uhasibu Test', ${phone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false)`);
  owner = (await login(phone, OWNER_PW)).token;
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Uhasibu ${RUN} AMCOS` });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  amcosId = reg.body.amcos.id;
  await call('POST', `/api/v1/owner/amcos/${amcosId}/approve`, owner, {});
  const tokens: Record<string, string> = {};
  for (const role of ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK']) {
    const p = uniqPhone('25576');
    const r = await call('POST', `/api/v1/owner/amcos/${amcosId}/staff`, owner, { role, fullName: `${role} ${RUN}`, phone: p });
    const t = (await login(p, r.body.temporaryPassword)).token;
    tokens[role] = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: r.body.temporaryPassword, newPassword: 'Staff12345' })).body.token;
  }
  manager = tokens.AMCOS_ADMIN; accountant = tokens.ACCOUNTANT; storekeeper = tokens.CLERK;
  cash = (await call('POST', '/api/v1/finance/accounts', accountant, { name: 'Taslimu ofisini', kind: 'CASH', openingBalance: '2000000' })).body.account;
  bank = (await call('POST', '/api/v1/finance/accounts', accountant, { name: 'NMB Akaunti ya chama', kind: 'BANK', bankName: 'NMB', accountNumber: '4010' + RUN, openingBalance: '50000000' })).body.account;
  assert.ok(cash?.id && bank?.id);
});

after(async () => {
  server.close();
  await pool.end();
});

// 1 ------------------------------------------------------------------
test('Ruhusa: Mhasibu ndiye anaandika uhasibu; Meneja ripoti na idhini tu; Stokipa haoni', async () => {
  const chart = await call('GET', '/api/v1/accounting/chart', accountant);
  assert.equal(chart.status, 200);
  assert.ok(chart.body.data.length >= 45, 'Chati ya akaunti imeundwa yenyewe');
  assert.ok(chart.body.data.some((a: any) => a.name === 'NMB Akaunti ya chama' && a.code === '1101'), 'Akaunti ya benki ina akaunti yake kwenye daftari kuu');

  assert.equal((await call('GET', '/api/v1/accounting/reports/balance-sheet', manager)).status, 200, 'Meneja anaona ripoti');
  assert.equal((await call('GET', '/api/v1/accounting/chart', storekeeper)).status, 403, 'Stokipa haoni daftari kuu');
  const a = chart.body.data.find((x: any) => x.code === '5990').id, b = chart.body.data.find((x: any) => x.code === '3200').id;
  const j = { date: today, description: 'Marekebisho ya majaribio', lines: [{ glAccountId: a, debit: '1000' }, { glAccountId: b, credit: '1000' }] };
  assert.equal((await call('POST', '/api/v1/accounting/journals', manager, j)).status, 403, 'Meneja haandiki journal');
  assert.equal((await call('POST', '/api/v1/sales/markets', manager, { marketDate: today, buyerName: 'X', exchangeRate: '2500' })).status, 403);
  assert.equal((await call('POST', '/api/v1/payroll/employees', manager, { fullName: 'Juma', position: 'Mlinzi', basicSalary: '300000' })).status, 403);
  assert.equal((await call('POST', '/api/v1/assets', storekeeper, { name: 'Mizani', category: 'EQUIPMENT', acquisitionDate: today, cost: '100000', usefulLifeMonths: 12 })).status, 403);
  // Mhasibu: fedha tu — hana wakulima, stoo wala kumbukumbu (v0.4.1)
  for (const path of ['/api/v1/members', '/api/v1/estimates', '/api/v1/inputs/items', '/api/v1/inputs/stock', '/api/v1/input-issues', '/api/v1/audit-logs', '/api/v1/reports/member-balances']) {
    assert.equal((await call('GET', path, accountant)).status, 403, `Mhasibu hazuiwi: ${path}`);
  }
  assert.equal((await call('POST', '/api/v1/members', accountant, { firstName: 'X', lastName: 'Y', gender: 'MALE' })).status, 403);
  const look = await call('GET', '/api/v1/members/lookup?search=a', accountant);
  assert.equal(look.status, 200, 'Mhasibu anatafuta mkulima kwa malipo');
  assert.ok(look.body.data.every((x: any) => x.nidaNumber === undefined && x.phone === undefined), 'Taarifa binafsi hazitoki');
  assert.equal((await call('GET', '/api/v1/audit-logs', manager)).status, 403, 'Kumbukumbu ni ya Super Admin pekee');
  assert.equal((await call('GET', '/api/v1/audit-logs', owner)).status, 200);
  const me = (await call('GET', '/api/v1/auth/me', manager)).body.user;
  assert.ok(me.amcosPermissions.includes('accounting.read') && !me.amcosPermissions.includes('accounting.manage'));
});

// 2 ------------------------------------------------------------------
test('Daftari kuu: salio la kuanzia, mapato, matumizi -> TB, mizania na fedha zinalingana', async () => {
  let rows = await gl();
  assert.equal(bal(rows, '3900'), '52000000.00', 'Salio la kuanzia la akaunti mbili');
  const inc = await call('POST', '/api/v1/finance/income', accountant, { category: 'GRANT', amount: '3000000', accountId: bank.id, description: 'Ruzuku ya maghala' });
  assert.equal(inc.status, 201);
  const exp = await call('POST', '/api/v1/finance/expenses', accountant, { category: 'TRANSPORT', amount: '150000', accountId: cash.id, description: 'Usafiri wa mizani' });
  await approve(exp.body.transaction.id);
  assert.equal((await call('POST', `/api/v1/finance/transactions/${exp.body.transaction.id}/post`, accountant, {})).status, 200);
  rows = await gl();
  assert.equal(bal(rows, '4300'), '3000000.00');
  assert.equal(bal(rows, '5200'), '150000.00');
  assert.equal(bal(rows, '1001'), '1850000.00', 'Taslimu kwenye daftari kuu = salio la akaunti');
  assert.equal(bal(rows, '1101'), '53000000.00');
  const { tb } = await assertBooksBalance();
  assert.ok(Number(tb.totalDebit) > 0);

  // Vocha ya malipo na risiti
  const v = await call('GET', `/api/v1/bank/voucher/${exp.body.transaction.id}`, accountant);
  assert.equal(v.body.kind, 'PAYMENT_VOUCHER');
  assert.ok(v.body.approval?.decidedBy, 'Vocha inaonyesha aliyeidhinisha');
  assert.equal((await call('GET', `/api/v1/bank/voucher/${inc.body.transaction.id}`, accountant)).body.kind, 'RECEIPT');

  // Kusahihisha muamala -> journal ya kinyume
  const rev = await call('POST', `/api/v1/finance/transactions/${exp.body.transaction.id}/reverse`, accountant, { reason: 'Kiasi kiliandikwa vibaya' });
  await approve(exp.body.transaction.id);
  assert.equal(rev.status, 202);
  rows = await gl();
  assert.equal(bal(rows, '5200'), '0.00');
  assert.equal(bal(rows, '1001'), '2000000.00');
  await assertBooksBalance();
});

// 3 ------------------------------------------------------------------
test('Journal ya mkono: haigusi akaunti za fedha, inalingana, na inaingia baada ya idhini tu', async () => {
  const rows = await gl();
  const id = (c: string) => rows.find((r) => r.code === c).id;
  const bad = await call('POST', '/api/v1/accounting/journals', accountant, { date: today, description: 'Jaribu kugusa benki', lines: [{ glAccountId: id('1101'), debit: '500' }, { glAccountId: id('4900'), credit: '500' }] });
  assert.equal(bad.status, 400, 'Akaunti za fedha zinaguswa kwa miamala tu');
  const unbal = await call('POST', '/api/v1/accounting/journals', accountant, { date: today, description: 'Haijalingana', lines: [{ glAccountId: id('1250'), debit: '500' }, { glAccountId: id('4900'), credit: '400' }] });
  assert.equal(unbal.status, 400);
  const ok = await call('POST', '/api/v1/accounting/journals', accountant, { date: today, description: 'Malipo ya awali ya bima', lines: [{ glAccountId: id('1250'), debit: '240000' }, { glAccountId: id('3200'), credit: '240000' }] });
  assert.equal(ok.status, 202, JSON.stringify(ok.body));
  assert.equal(bal(await gl(), '1250'), '0.00', 'Bado haijaingia kabla ya idhini');
  const list = (await call('GET', '/api/v1/approvals?status=PENDING&type=JOURNAL', manager)).body.data;
  await call('POST', `/api/v1/approvals/${list[0].id}/decide`, manager, { decision: 'APPROVED', note: 'Nimeona mkataba wa bima' });
  assert.equal(bal(await gl(), '1250'), '240000.00');
  const js = (await call('GET', '/api/v1/accounting/journals?source=MANUAL', accountant)).body;
  assert.equal(js.data.length, 1);
  const det = (await call('GET', `/api/v1/accounting/journals/${js.data[0].id}`, manager)).body.journal;
  assert.equal(det.totalDebit, det.totalCredit);
  assert.ok(det.approval?.requestNo);

  // Database yenyewe: journal haibadilishwi, haifutwi, na haiwezi kuwa bila kulingana
  await assert.rejects(db.execute(sql`update journal_lines set debit = 1 where journal_entry_id = ${det.id}`));
  await assert.rejects(db.execute(sql`delete from journal_entries where id = ${det.id}`));
  await assert.rejects(db.transaction(async (tx) => {
    const [e] = (await tx.execute<{ id: string }>(sql`insert into journal_entries (amcos_id, entry_no, entry_date, description, source) values (${amcosId}, ${'X-' + RUN}, ${today}, 'mbaya', 'TEST') returning id`)).rows;
    await tx.execute(sql`insert into journal_lines (journal_entry_id, amcos_id, gl_account_id, debit, credit) values (${e.id}, ${amcosId}, ${id('1250')}, 100, 0), (${e.id}, ${amcosId}, ${id('4900')}, 0, 90)`);
  }), 'Trigger inakataa journal isiyolingana');
  await assertBooksBalance();
});

// 4 ------------------------------------------------------------------
let farmerA: any, farmerB: any;
test('Mauzo ya tumbaku: mabelo -> makato -> idhini -> ledger + daftari kuu -> orodha ya malipo -> malipo yaliyothibitishwa', async () => {
  farmerA = await newMember('Athumani');
  farmerB = await newMember('Bakari');
  // Mkulima A ana deni la pembejeo TSh 160,000
  const item = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'NPK ' + RUN, category: 'FERTILIZER', unit: 'BAG' })).body.item;
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: item.id, quantity: 10, unitPrice: '80000', reference: 'DN-' + RUN })).status, 202);
  await approve(item.id);
  assert.equal((await call('PUT', '/api/v1/inputs/prices', manager, { inputItemId: item.id, unitPrice: '80000' })).status, 200);
  const iss = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmerA.id, lines: [{ inputItemId: item.id, quantity: 2 }] });
  await approve(iss.body.issue.id);
  let rows = await gl();
  assert.equal(bal(rows, '1200'), '160000.00', 'Deni la mkulima kwenye daftari kuu');
  assert.equal(bal(rows, '2150'), '160000.00', 'Pembejeo za Chama Kikuu zisizo na gharama -> deni la pembejeo');
  await assertBooksBalance();

  // Kanuni za makato za msimu
  const rules = [
    { name: 'Ushuru wa Halmashauri', code: 'LGA_CESS', basis: 'PERCENT_OF_GROSS', rate: '3', priority: 10 },
    { name: 'Ushuru wa Chama Kikuu', code: 'UNION_LEVY', basis: 'PER_KG', rate: '0.02', currency: 'USD', priority: 20 },
    { name: 'Ushuru wa chama (AMCOS)', code: 'AMCOS_LEVY', basis: 'PERCENT_OF_GROSS', rate: '1', priority: 30 },
    { name: 'Deni la pembejeo', code: 'INPUT_LOAN', basis: 'OUTSTANDING_LOAN', rate: '0', priority: 90 },
  ];
  for (const r of rules) assert.equal((await call('POST', '/api/v1/sales/deduction-rules', accountant, r)).status, 201);
  const rl = (await call('GET', '/api/v1/sales/deduction-rules', manager)).body.data;
  assert.deepEqual(rl.map((r: any) => r.glCode), ['2310', '2300', '4100', '1200']);

  const mk = await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'Alliance One', exchangeRate: '2500', location: 'Ghala kuu' });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const marketId = mk.body.market.id;
  const bales = await call('POST', `/api/v1/sales/markets/${marketId}/bales`, accountant, { bales: [
    { memberNo: farmerA.memberNo, baleNo: 'A1-' + RUN, grossKg: '100', grade: 'L1F', priceUsd: '2.0' },
    { memberId: farmerA.id, baleNo: 'A2-' + RUN, grossKg: '50', grade: 'L2F', priceUsd: '1.6' },
    { memberId: farmerB.id, baleNo: 'B1-' + RUN, grossKg: '80', grade: 'X3L', priceUsd: '1.5' },
    { memberId: farmerB.id, baleNo: 'B2-' + RUN, grossKg: '40', rejected: true, rejectReason: 'Unyevu mwingi' },
  ] });
  assert.equal(bales.status, 201, JSON.stringify(bales.body));
  assert.equal((await call('POST', `/api/v1/sales/markets/${marketId}/bales`, accountant, { bales: [{ memberId: farmerB.id, baleNo: 'B1-' + RUN, grossKg: '1', priceUsd: '1' }] })).status, 400, 'Belo moja haliandikwi mara mbili');

  // A: 100*2 + 50*1.6 = 280 USD -> 700,000 TZS; LGA 21,000; union 150kg*0.02*2500 = 7,500; AMCOS 7,000; deni 160,000 -> halisi 504,500
  // B: 80*1.5 = 120 USD -> 300,000; LGA 9,000; union 80*0.02*2500 = 4,000; AMCOS 3,000 -> halisi 284,000
  const pv = (await call('GET', `/api/v1/sales/markets/${marketId}/preview`, accountant)).body;
  const a = pv.rows.find((r: any) => r.memberId === farmerA.id), b = pv.rows.find((r: any) => r.memberId === farmerB.id);
  assert.equal(a.grossTzs, '700000.00'); assert.equal(a.totalDeductions, '195500.00'); assert.equal(a.netTzs, '504500.00');
  assert.equal(b.grossTzs, '300000.00'); assert.equal(b.netTzs, '284000.00');
  assert.equal(pv.totals.netTzs, '788500.00');

  const st = await call('POST', `/api/v1/sales/markets/${marketId}/settlements`, accountant, {});
  assert.equal(st.status, 201, JSON.stringify(st.body));
  assert.equal((await call('POST', `/api/v1/sales/markets/${marketId}/bales`, accountant, { bales: [{ memberId: farmerB.id, baleNo: 'B9-' + RUN, grossKg: '1', priceUsd: '1' }] })).status, 400, 'Soko limefungwa kwa mabadiliko');
  await approve(marketId);

  rows = await gl();
  assert.equal(bal(rows, '1220'), '1000000.00', 'Mnunuzi anadaiwa jumla ya mauzo');
  assert.equal(bal(rows, '2200'), '788500.00', 'Chama kinadaiwa malipo halisi ya wakulima');
  assert.equal(bal(rows, '2310'), '30000.00');
  assert.equal(bal(rows, '2300'), '11500.00');
  assert.equal(bal(rows, '4100'), '10000.00');
  assert.equal(bal(rows, '1200'), '0.00', 'Deni la pembejeo limerejeshwa kwa mauzo');
  const memA = (await call('GET', `/api/v1/members/${farmerA.id}`, manager)).body;
  assert.equal(memA.balance.balance, '504500.00', 'Ledger ya mkulima: anadai malipo halisi');
  await assertBooksBalance();

  // Orodha ya malipo -> idhini -> Mhasibu anathibitisha malipo yaliyofanyika
  const pb = await call('POST', `/api/v1/sales/markets/${marketId}/payment-batch`, accountant, {});
  assert.equal(pb.status, 201, JSON.stringify(pb.body));
  const batchId = pb.body.batch.id;
  const early = await call('POST', `/api/v1/sales/batches/${batchId}/confirm`, accountant, { accountId: bank.id, paymentIds: ['00000000-0000-0000-0000-000000000000'], reference: 'BULK-1' });
  assert.equal(early.status, 400, 'Haiwezi kulipwa kabla ya idhini');
  await approve(batchId);
  const sheet = (await call('GET', `/api/v1/sales/batches/${batchId}`, accountant)).body;
  assert.equal(sheet.payments.length, 2);
  assert.equal(sheet.summary.MOBILE_MONEY, '788500.00');
  assert.ok(sheet.payments.every((p: any) => p.status === 'PENDING'), 'Hakuna malipo yanayowekwa "yamefanikiwa" yenyewe');
  const csv = await call('GET', `/api/v1/sales/batches/${batchId}/csv`, accountant);
  assert.match(csv.body, /Namba ya mkulima/);
  const pA = sheet.payments.find((p: any) => p.memberId === farmerA.id), pB = sheet.payments.find((p: any) => p.memberId === farmerB.id);
  assert.equal((await call('POST', `/api/v1/sales/batches/${batchId}/fail`, accountant, { paymentIds: [pB.id], reason: 'Namba ya M-Pesa haipo' })).body.failed, 1);
  const c1 = await call('POST', `/api/v1/sales/batches/${batchId}/confirm`, accountant, { accountId: bank.id, paymentIds: [pA.id], reference: 'BULK-' + RUN });
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  assert.equal(c1.body.status, 'PARTIAL');
  const c2 = await call('POST', `/api/v1/sales/batches/${batchId}/confirm`, accountant, { accountId: cash.id, paymentIds: [pB.id], reference: 'TASLIMU-' + RUN });
  assert.equal(c2.body.status, 'COMPLETED');
  assert.equal((await call('POST', `/api/v1/sales/batches/${batchId}/confirm`, accountant, { accountId: cash.id, paymentIds: [pB.id], reference: 'X' })).status, 400, 'Hakuna kulipa mara mbili');

  rows = await gl();
  assert.equal(bal(rows, '2200'), '0.00', 'Wakulima wote wamelipwa');
  assert.equal((await call('GET', `/api/v1/members/${farmerA.id}`, manager)).body.balance.balance, '0.00');
  const market = (await call('GET', `/api/v1/sales/markets/${marketId}`, manager)).body;
  assert.ok(market.settlements.every((s: any) => s.status === 'PAID'));
  // Mnunuzi analipa chama
  assert.equal((await call('POST', '/api/v1/finance/income', accountant, { category: 'TOBACCO_SALES', amount: '1000000', accountId: bank.id, description: 'Malipo ya Alliance One soko ' + RUN })).status, 201);
  assert.equal(bal(await gl(), '1220'), '0.00');
  const sum = (await call('GET', '/api/v1/sales/summary', manager)).body;
  assert.equal(sum.grossTzs, '1000000.00'); assert.equal(sum.unpaid, '0.00');
  await assertBooksBalance();
});

// 5 ------------------------------------------------------------------
test('Mishahara: PAYE/NSSF/WCF sahihi, idhini, malipo, na madeni ya kisheria', async () => {
  assert.equal(paye(540000).toFixed(2), '24000.00');
  assert.equal(paye(270000).toFixed(2), '0.00');
  assert.equal(paye(1200000).toFixed(2), '188000.00');
  const e1 = await call('POST', '/api/v1/payroll/employees', accountant, { fullName: 'Neema Juma', position: 'Karani wa ghala', basicSalary: '500000', allowances: '100000', nssfNo: 'N123' });
  assert.equal(e1.status, 201);
  assert.equal(e1.body.employee.employeeNo, 'EMP-001');
  await call('POST', '/api/v1/payroll/employees', accountant, { fullName: 'Hamisi Ali', position: 'Mlinzi', basicSalary: '250000' });
  const run = await call('POST', '/api/v1/payroll/runs', accountant, { period: month });
  assert.equal(run.status, 201, JSON.stringify(run.body));
  // Neema: ghafi 600,000; NSSF 60,000; PAYE 24,000; halisi 516,000 · Hamisi: 250,000; NSSF 25,000; PAYE 0; halisi 225,000
  assert.equal(run.body.run.totalNet, '741000.00');
  assert.equal(run.body.run.totalPaye, '24000.00');
  assert.equal(run.body.run.totalWcf, '4250.00');
  assert.equal(run.body.run.totalSdl, '0.00', 'SDL ni kwa waajiri wenye wafanyakazi 10+');
  assert.equal((await call('POST', '/api/v1/payroll/runs', accountant, { period: month })).status, 409, 'Mwezi mmoja mara moja');
  assert.equal((await call('POST', `/api/v1/payroll/runs/${run.body.run.id}/pay`, accountant, { accountId: bank.id })).status, 400, 'Haiwezi kulipwa kabla ya idhini');
  await approve(run.body.run.id);
  let rows = await gl();
  assert.equal(bal(rows, '5100'), '850000.00');
  assert.equal(bal(rows, '2400'), '741000.00');
  assert.equal(bal(rows, '2410'), '24000.00');
  assert.equal(bal(rows, '2420'), '170000.00');
  const pay = await call('POST', `/api/v1/payroll/runs/${run.body.run.id}/pay`, accountant, { accountId: bank.id, reference: 'MSH-' + RUN });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  rows = await gl();
  assert.equal(bal(rows, '2400'), '0.00', 'Mishahara imelipwa');
  // Kulipa PAYE TRA: matumizi yenye akaunti ya daftari kuu 2410
  const payeId = rows.find((r) => r.code === '2410').id;
  const t = await call('POST', '/api/v1/finance/expenses', accountant, { category: 'TAXES', amount: '24000', accountId: bank.id, description: 'PAYE ya mwezi', contraGlAccountId: payeId });
  await approve(t.body.transaction.id);
  await call('POST', `/api/v1/finance/transactions/${t.body.transaction.id}/post`, accountant, {});
  assert.equal(bal(await gl(), '2410'), '0.00');
  const cashId = rows.find((r) => r.code === '1101').id;
  assert.equal((await call('POST', '/api/v1/finance/expenses', accountant, { category: 'TAXES', amount: '1', accountId: bank.id, description: 'Jaribu', contraGlAccountId: cashId })).status, 400);
  const det = (await call('GET', `/api/v1/payroll/runs/${run.body.run.id}`, manager)).body;
  assert.equal(det.lines.length, 2); assert.equal(det.run.status, 'PAID');
  await assertBooksBalance();
});

// 6 ------------------------------------------------------------------
test('Mali za chama: rejista, uchakavu wa mwezi mara moja, na kuondoa kwa idhini', async () => {
  const a = await call('POST', '/api/v1/assets', accountant, { name: 'Ghala la tumbaku', category: 'BUILDING', acquisitionDate: '2020-01-15', cost: '12000000', usefulLifeMonths: 240 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  // Kununua mizani kupitia matumizi (akaunti 1500)
  let rows = await gl();
  const fa = rows.find((r) => r.code === '1500').id;
  const t = await call('POST', '/api/v1/finance/expenses', accountant, { category: 'OFFICE', amount: '1200000', accountId: bank.id, description: 'Mizani ya kidijitali', contraGlAccountId: fa });
  await approve(t.body.transaction.id);
  await call('POST', `/api/v1/finance/transactions/${t.body.transaction.id}/post`, accountant, {});
  const over = await call('POST', '/api/v1/assets', accountant, { name: 'Mizani', category: 'EQUIPMENT', acquisitionDate: today, cost: '1500000', usefulLifeMonths: 60, fundingTxnId: t.body.transaction.id });
  assert.equal(over.status, 400, 'Gharama haizidi muamala');
  const sc = await call('POST', '/api/v1/assets', accountant, { name: 'Mizani', category: 'EQUIPMENT', acquisitionDate: today, cost: '1200000', residualValue: '0', usefulLifeMonths: 60, fundingTxnId: t.body.transaction.id });
  assert.equal(sc.status, 201);
  rows = await gl();
  assert.equal(bal(rows, '1500'), '13200000.00');
  const pv = (await call('GET', `/api/v1/assets/depreciation/preview?period=${month}`, accountant)).body;
  assert.equal(pv.total, '70000.00', '12m/240 = 50,000 + 1.2m/60 = 20,000');
  assert.equal((await call('POST', '/api/v1/assets/depreciation', accountant, { period: month })).status, 201);
  assert.equal((await call('POST', '/api/v1/assets/depreciation', accountant, { period: month })).status, 409);
  rows = await gl();
  assert.equal(bal(rows, '1590'), '-70000.00', 'Uchakavu uliolimbikizwa (contra-asset)');
  assert.equal(bal(rows, '5900'), '70000.00');
  const d = await call('POST', `/api/v1/assets/item/${sc.body.asset.id}/dispose`, accountant, { date: today, reason: 'Imeharibika na haitengenezeki' });
  assert.equal(d.status, 202);
  await approve(sc.body.asset.id);
  rows = await gl();
  assert.equal(bal(rows, '1500'), '12000000.00');
  assert.equal(bal(rows, '5950'), '1180000.00', 'Hasara = thamani iliyobaki');
  const list = (await call('GET', '/api/v1/assets', manager)).body;
  assert.equal(list.totals.netBookValue, '11950000.00');
  await assertBooksBalance();
});

// 7 ------------------------------------------------------------------
test('Benki: uhamisho kwa idhini na usuluhishi wa benki (bank reconciliation)', async () => {
  const tr = await call('POST', '/api/v1/bank/transfers', accountant, { fromAccountId: cash.id, toAccountId: bank.id, amount: '500000', description: 'Kuweka benki fedha za ada' });
  assert.equal(tr.status, 201, JSON.stringify(tr.body));
  await approve(tr.body.out.id);
  assert.equal((await call('POST', `/api/v1/finance/transactions/${tr.body.out.id}/post`, accountant, {})).status, 200);
  const accs = (await call('GET', '/api/v1/finance/accounts', accountant)).body.data;
  const bankBal = accs.find((a: any) => a.id === bank.id).balance;
  const rows = await gl();
  assert.equal(bal(rows, '1990'), '0.00', 'Fedha njiani zimefika');
  assert.equal(bal(rows, '1101'), bankBal, 'Benki: daftari kuu = cashbook');

  const rec = (await call('GET', `/api/v1/bank/reconciliation/${bank.id}?statementDate=${today}`, accountant)).body;
  assert.equal(rec.bookBalance, bankBal);
  const unclear = rec.uncleared.find((u: any) => u.amount === '24000.00'); // PAYE bado haijaonekana benki
  const cleared = rec.uncleared.filter((u: any) => u.id !== unclear.id).map((u: any) => u.id);
  const wrong = await call('POST', `/api/v1/bank/reconciliation/${bank.id}`, accountant, { statementDate: today, statementBalance: bankBal, clearedTxnIds: cleared });
  assert.equal(wrong.status, 400, 'Tofauti lazima iwe sifuri');
  const stmt = (Number(bankBal) + 24000).toFixed(2);
  const ok = await call('POST', `/api/v1/bank/reconciliation/${bank.id}`, accountant, { statementDate: today, statementBalance: stmt, clearedTxnIds: cleared, notes: 'Taarifa ya NMB' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.reconciliation.unclearedOut, '24000.00');
  const again = (await call('GET', `/api/v1/bank/reconciliation/${bank.id}`, accountant)).body;
  assert.equal(again.uncleared.length, 1, 'Iliyobaki ni PAYE tu');
  assert.equal((await call('POST', `/api/v1/bank/reconciliation/${bank.id}`, accountant, { statementDate: today, statementBalance: stmt, clearedTxnIds: cleared })).status, 400, 'Muamala hausuluhishwi mara mbili');
  await assertBooksBalance();
});

// 8 ------------------------------------------------------------------
test('Ripoti kuu: mapato na matumizi, mtiririko wa fedha na CSV', async () => {
  const is = (await call('GET', '/api/v1/accounting/reports/income-statement', manager)).body;
  const surplus = Number(is.totalIncome) - Number(is.totalExpense);
  assert.equal(Number(is.surplus), surplus);
  const cf = (await call('GET', `/api/v1/accounting/reports/cash-flow?from=${today.slice(0, 4)}-01-01`, manager)).body;
  assert.equal(cf.balanced, true, `Fedha: ${cf.opening} + ${cf.net} ≠ ${cf.closing}`);
  assert.equal(cf.sections.TRANSFER.total, '0.00', 'Uhamisho wa ndani unajifuta');
  const csv = await call('GET', '/api/v1/accounting/reports/trial-balance.csv', accountant);
  assert.match(csv.body, /JUMLA/);
  const led = (await call('GET', `/api/v1/accounting/ledger/${(await gl()).find((r) => r.code === '1101').id}?from=2000-01-01`, accountant)).body;
  assert.equal(led.closing, (await gl()).find((r) => r.code === '1101').balance);
  const d = (await call('GET', '/api/v1/accounting/dashboard', manager)).body;
  assert.ok(d.monthly.length >= 1);
  assert.equal(d.payables.farmers, '0.00');
  // Chama kingine hakioni hesabu hizi
  const other = await call('GET', `/api/v1/accounting/journals/${led.lines[0].entryId}`, (await login('0711000002', 'Demo12345')).token);
  assert.equal(other.status, 404);
});

// 9 ------------------------------------------------------------------
const daysAgo = (n: number) => new Date(Date.parse(today + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
test('Salio la kuanzia: madeni ya wakulima na akaunti nyingine kwa idhini; daftari kuu linalingana', async () => {
  const rows = await gl();
  const id = (c: string) => rows.find((r) => r.code === c).id;
  assert.equal((await call('POST', '/api/v1/accounting/opening-balances', accountant, { date: today, description: 'x', farmers: [{ memberNo: 'HAKUNA-1', debt: '1' }] })).status, 400);
  assert.equal((await call('POST', '/api/v1/accounting/opening-balances', accountant, { date: today, description: 'x', lines: [{ glAccountId: id('1200'), debit: '5' }] })).status, 400, '1200 inawekwa kwa kila mkulima');
  const before3900 = Number(bal(rows, '3900'));
  const r = await call('POST', '/api/v1/accounting/opening-balances', accountant, {
    date: today, description: 'Kuanza kutumia CoopLink',
    farmers: [{ memberNo: farmerA.memberNo, debt: '50000' }, { memberNo: farmerB.memberNo.toLowerCase(), credit: '20000' }],
    lines: [{ glAccountId: id('2150'), credit: '300000' }, { glAccountId: id('1300'), debit: '200000' }],
  });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.totals.equity, '-70000.00');
  assert.equal(Number(bal(await gl(), '1200')), 0, 'Haiingii kabla ya idhini');
  const ap = (await call('GET', '/api/v1/approvals?status=PENDING&type=OPENING_BALANCE', manager)).body.data[0];
  assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { decision: 'APPROVED', note: 'Nimelinganisha na vitabu vya zamani' })).status, 200);
  const after = await gl();
  assert.equal(bal(after, '1200'), '50000.00');
  assert.equal(bal(after, '2200'), '20000.00');
  assert.equal(bal(after, '2150'), '460000.00');
  assert.equal(Number(bal(after, '3900')), before3900 - 70000);
  assert.equal((await call('GET', `/api/v1/members/${farmerA.id}`, manager)).body.balance.balance, '-50000.00');
  const per = (await call('GET', '/api/v1/accounting/periods', accountant)).body;
  assert.equal(per.openings.length, 1);
  await assertBooksBalance();
});

// 10 -----------------------------------------------------------------
test('Mnunuzi anadaiwa kwa soko na umri wa deni; madeni ya Chama Kikuu/ushuru yanalipwa kwa idhini', async () => {
  const b = (await call('GET', '/api/v1/sales/buyers', manager)).body;
  assert.equal(b.data.length, 1);
  assert.equal(b.data[0].due, '1000000.00');
  assert.equal(b.unallocated, '1000000.00', 'Malipo ya awali hayakuunganishwa na soko');
  const pay = await call('POST', '/api/v1/finance/income', accountant, { category: 'OTHER_INCOME', amount: '1', accountId: bank.id, description: 'x', marketId: b.data[0].id });
  assert.equal(pay.status, 400, 'Soko kwa mauzo ya tumbaku tu');

  const p = (await call('GET', '/api/v1/accounting/payables', accountant)).body.data;
  const lga = p.find((x: any) => x.code === '2310');
  assert.equal(lga.balance, '30000.00');
  assert.equal((await call('POST', '/api/v1/finance/expenses', accountant, { category: 'REMITTANCE', amount: '30000', accountId: bank.id, description: 'Ushuru wa Halmashauri' })).status, 400, 'Lazima kuchagua deni');
  const t = await call('POST', '/api/v1/finance/expenses', accountant, { category: 'REMITTANCE', amount: '30000', accountId: bank.id, description: 'Ushuru wa Halmashauri msimu', contraGlAccountId: lga.id });
  assert.equal(t.status, 201);
  await approve(t.body.transaction.id);
  await call('POST', `/api/v1/finance/transactions/${t.body.transaction.id}/post`, accountant, {});
  assert.equal(bal(await gl(), '2310'), '0.00');
  await assertBooksBalance();
});

// 11 -----------------------------------------------------------------
test('Kufunga mwaka na kufunga kipindi: ziada inahamia akiba, tarehe za nyuma zinakataliwa', async () => {
  const d3 = daysAgo(3), d2 = daysAgo(2), d1 = daysAgo(1);
  assert.equal((await call('POST', '/api/v1/finance/income', accountant, { category: 'OTHER_INCOME', amount: '100000', accountId: cash.id, description: 'Mapato ya zamani', txnDate: d3 })).status, 201);
  const pv = (await call('GET', `/api/v1/accounting/year-end-preview?closeDate=${d2}`, accountant)).body;
  assert.equal(pv.totalIncome, '100000.00');
  assert.equal((await call('POST', '/api/v1/accounting/year-end-close', manager, { closeDate: d2 })).status, 403, 'Meneja anaidhinisha tu');
  assert.equal((await call('POST', '/api/v1/accounting/year-end-close', accountant, { closeDate: today })).status, 400);
  const before3200 = Number(bal(await gl(), '3200'));
  assert.equal((await call('POST', '/api/v1/accounting/year-end-close', accountant, { closeDate: d2, note: 'Mwaka wa majaribio' })).status, 202);
  assert.equal((await call('POST', '/api/v1/accounting/period-close', accountant, { lockedThrough: d1 })).status, 409, 'Ombi moja la kufunga kwa wakati mmoja');
  const ap = (await call('GET', '/api/v1/approvals?status=PENDING&type=YEAR_END_CLOSE', manager)).body.data[0];
  assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { decision: 'APPROVED', note: 'Hesabu zimekaguliwa' })).status, 200);
  let rows = await gl();
  assert.equal(Number(bal(rows, '3200')), before3200 + 100000, 'Ziada imehamia akiba');
  assert.equal(bal(rows, '4900'), '0.00', 'Mapato ya mwaka uliofungwa yamesafishwa');
  const is = (await call('GET', `/api/v1/accounting/reports/income-statement?from=${d3}&to=${d2}`, manager)).body;
  assert.equal(is.totalIncome, '100000.00', 'Ripoti ya mwaka uliofungwa bado inaonyesha mapato');
  const bs = (await call('GET', '/api/v1/accounting/reports/balance-sheet', manager)).body;
  assert.equal(bs.balanced, true); assert.equal(bs.lastClose, d2);

  // Tarehe za kipindi kilichofungwa zinakataliwa
  const late = await call('POST', '/api/v1/finance/income', accountant, { category: 'OTHER_INCOME', amount: '5', accountId: cash.id, description: 'Ya nyuma', txnDate: d2 });
  assert.equal(late.status, 400); assert.match(late.body.error.message, /Kipindi kimefungwa/);
  const jid = rows.find((r) => r.code === '1250').id, eq3200 = rows.find((r) => r.code === '3200').id;
  assert.equal((await call('POST', '/api/v1/accounting/journals', accountant, { date: d2, description: 'Ya nyuma sana', lines: [{ glAccountId: jid, debit: '5' }, { glAccountId: eq3200, credit: '5' }] })).status, 400);
  await assert.rejects(db.execute(sql`insert into journal_entries (amcos_id, entry_no, entry_date, description, source) values (${amcosId}, ${'L-' + RUN}, ${d2}, 'x', 'TEST')`), 'DB inakataa');
  await assert.rejects(db.execute(sql`delete from period_locks where amcos_id = ${amcosId}`), 'Kufunga hakutenguliwi');

  // Kufunga kipindi (mwezi uliokaguliwa)
  assert.equal((await call('POST', '/api/v1/accounting/period-close', accountant, { lockedThrough: d1, note: 'Mwezi umekaguliwa' })).status, 202);
  const pc = (await call('GET', '/api/v1/approvals?status=PENDING&type=PERIOD_CLOSE', manager)).body.data[0];
  await call('POST', `/api/v1/approvals/${pc.id}/decide`, manager, { decision: 'APPROVED', note: 'Sawa' });
  const per = (await call('GET', '/api/v1/accounting/periods', manager)).body;
  assert.equal(per.lockedThrough, d1);
  assert.deepEqual(per.locks.map((l: any) => l.kind), ['PERIOD', 'YEAR_END']);
  assert.equal((await call('POST', '/api/v1/finance/income', accountant, { category: 'OTHER_INCOME', amount: '5', accountId: cash.id, description: 'Leo', txnDate: today })).status, 201, 'Leo bado iko wazi');
  await assertBooksBalance();
});

// 12 -----------------------------------------------------------------
test('Mhasibu anaona pembejeo alizokopa kila mkulima na deni lake lote (bila taarifa binafsi)', async () => {
  const list = await call('GET', '/api/v1/finance/farmers?filter=all', accountant);
  assert.equal(list.status, 200);
  const a = list.body.data.find((x: any) => x.id === farmerA.id);
  assert.equal(a.inputs, '160000.00');
  assert.equal(a.sales, '700000.00');
  assert.equal(a.balance, (await call('GET', `/api/v1/members/${farmerA.id}`, manager)).body.balance.balance);
  assert.equal(a.phone, undefined);
  const d = (await call('GET', `/api/v1/finance/farmers/${farmerA.id}`, accountant)).body;
  assert.equal(d.inputsSummary[0].quantity, '2.00');
  assert.equal(d.issues[0].lines[0].unitPrice, '80000.00');
  assert.equal(d.statement.at(-1).balance, d.balance);
  assert.equal((await call('GET', `/api/v1/finance/farmers/${farmerA.id}`, storekeeper)).status, 403);
});

// 13 -----------------------------------------------------------------
test('Vikundi: kila mkulima deni lake, kikundi kinadhamini — salio la mwenzao linakatwa kwa uwiano wa malipo', async () => {
  const C = await newMember('Chausiku'), Dm = await newMember('Daudi'), E = await newMember('Elia');
  assert.equal((await call('POST', '/api/v1/groups', storekeeper, { name: 'Mmoja ' + RUN, memberIds: [C.id] })).status, 400, 'Kikundi kinahitaji wawili+');
  const g = await call('POST', '/api/v1/groups', storekeeper, { name: 'Tumaini ' + RUN, village: 'Usoke', memberIds: [C.id, Dm.id, E.id], leaderMemberId: Dm.id });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal((await call('POST', '/api/v1/groups', storekeeper, { name: 'Pili ' + RUN, memberIds: [C.id, farmerA.id] })).status, 409, 'Mkulima mmoja kikundi kimoja');
  await approve(g.body.group.id);
  const groupId = g.body.group.id;

  const item = (await call('GET', '/api/v1/inputs/items', storekeeper)).body.data.find((i: any) => i.name === 'NPK ' + RUN);
  for (const [m, q] of [[C, 3], [Dm, 1]] as const) {
    const iss = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: m.id, lines: [{ inputItemId: item.id, quantity: q }] });
    assert.equal(iss.status, 201, JSON.stringify(iss.body));
    await approve(iss.body.issue.id);
  }
  const gd = (await call('GET', `/api/v1/groups/${groupId}`, accountant)).body;
  assert.equal(gd.group.owing, '320000.00', 'Deni la kikundi = jumla ya madeni ya wanachama');
  const rm = await call('POST', `/api/v1/groups/${groupId}/members/${C.id}/remove`, storekeeper, { reason: 'Anataka kuhama' });
  assert.equal(rm.status, 400, 'Mwenye deni hatoki kikundi');

  const mk = (await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'TLTC', exchangeRate: '2500' })).body.market;
  assert.equal((await call('POST', `/api/v1/sales/markets/${mk.id}/bales`, accountant, { bales: [
    { memberId: C.id, baleNo: 'C1-' + RUN, grossKg: '50', priceUsd: '2.0' },
    { memberId: Dm.id, baleNo: 'D1-' + RUN, grossKg: '100', priceUsd: '2.0' },
    { memberId: E.id, baleNo: 'E1-' + RUN, grossKg: '40', priceUsd: '2.0' },
  ] })).status, 201);
  // C: 250,000 - (7,500 + 2,500 + 2,500) = 237,500 < deni 240,000 -> salio 2,500 linalipwa na D (net 395,000) na E (net 190,000)
  const pv = (await call('GET', `/api/v1/sales/markets/${mk.id}/preview`, accountant)).body;
  const r = (id: string) => pv.rows.find((x: any) => x.memberId === id);
  assert.equal(r(C.id).netTzs, '0.00');
  assert.equal(r(C.id).coveredByGroup, '2500.00');
  const gD = r(Dm.id).deductions.find((d: any) => d.kind === 'GROUP_GUARANTEE'), gE = r(E.id).deductions.find((d: any) => d.kind === 'GROUP_GUARANTEE');
  assert.equal((Number(gD.amount) + Number(gE.amount)).toFixed(2), '2500.00');
  assert.ok(Math.abs(Number(gD.amount) - 1688.03) <= 0.02 && Math.abs(Number(gE.amount) - 811.97) <= 0.02, `${gD.amount} / ${gE.amount}`);
  assert.equal(pv.guarantees[0].uncovered, '0.00');

  assert.equal((await call('POST', `/api/v1/sales/markets/${mk.id}/settlements`, accountant, {})).status, 201);
  await approve(mk.id);
  const bal = async (id: string) => (await call('GET', `/api/v1/members/${id}`, manager)).body.balance.balance;
  assert.equal(await bal(C.id), '0.00', 'Deni la C limemalizwa na kikundi');
  assert.equal(await bal(Dm.id), (395000 - Number(gD.amount)).toFixed(2));
  const after = (await call('GET', `/api/v1/groups/${groupId}`, accountant)).body;
  assert.equal(after.group.owing, '0.00');
  assert.equal(after.members.find((x: any) => x.memberId === C.id).coveredByGroup, '2500.00');
  assert.equal(after.members.find((x: any) => x.memberId === Dm.id).guaranteedFor, gD.amount);
  const fl = (await call('GET', '/api/v1/finance/farmers?filter=all&search=Daudi', accountant)).body.data[0];
  assert.equal(fl.groupName, 'Tumaini ' + RUN);
  await assertBooksBalance();
});

// 14 -----------------------------------------------------------------
test('Ingiza pembejeo: bidhaa mpya inasajiliwa pamoja na mzigo, baada ya idhini ya Meneja', async () => {
  const name = 'Urea ' + RUN;
  const r = await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { newItem: { name, category: 'FERTILIZER', unit: 'BAG' }, quantity: 20, unitPrice: '70000', unitCost: '60000', source: 'Chama Kikuu', reference: 'DN-U-' + RUN });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { newItem: { name: name.toLowerCase(), category: 'FERTILIZER', unit: 'BAG' }, quantity: 1, unitPrice: '1', reference: 'DN-XX' })).status, 409, 'Jina moja linasubiri tayari');
  assert.ok(!(await call('GET', '/api/v1/inputs/items', storekeeper)).body.data.some((i: any) => i.name === name), 'Haijasajiliwa kabla ya idhini');
  assert.equal((await call('POST', `/api/v1/approvals/${r.body.approval.id}/decide`, manager, { decision: 'APPROVED', note: 'Mbolea mpya ya msimu' })).status, 200);
  const item = (await call('GET', '/api/v1/inputs/items', storekeeper)).body.data.find((i: any) => i.name === name);
  assert.ok(item);
  const st = (await call('GET', '/api/v1/inputs/stock', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id);
  assert.equal(st.balance, '20.00');
  assert.equal((await call('GET', '/api/v1/inputs/prices', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id).unitPrice, '70000.00');
  await assertBooksBalance();
});
