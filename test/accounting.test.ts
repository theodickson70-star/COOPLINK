// Majaribio ya uhasibu kamili wa Mhasibu (v0.4.0): daftari kuu, ripoti kuu, mauzo ya tumbaku na makato,
// vocha/benki, mishahara na mali za chama. Kila hatua inakagua kwamba hesabu zinalingana (debit = credit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { dryOutbox } from '../src/lib/sms';
import { clearStaffingCache } from '../src/lib/amcos-permissions';
import { D } from '../src/lib/money';
import { paye } from '../src/lib/payroll';
import { dryOutbox } from '../src/lib/sms';

process.env.SMS_DRY_RUN = 'true'; // SMS hazitumwi kweli: zinahifadhiwa kwenye dryOutbox

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
  const r = await call('POST', `/api/v1/approvals/${a.id}/decide`, manager, { confirmPassword: 'Staff12345', decision, note: 'Imekaguliwa na Meneja' });
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
    // v0.37: nenosiri la muda linatumwa kwa SMS (Owner halioni) — kwenye majaribio linasomwa kutoka SMS ya DRY
    assert.equal(r.body.temporaryPassword, null); assert.equal(r.body.delivery.status, 'SENT');
    const sms = [...dryOutbox].reverse().find((x) => x.phone === p && /Nenosiri la muda: /.test(x.text))!;
    assert.match(sms.text, /Uhasibu .* AMCOS/, 'SMS inataja chama');
    const pw = /Nenosiri la muda: (\S+)/.exec(sms.text)![1];
    const t = (await login(p, pw)).token;
    tokens[role] = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: pw, newPassword: 'Staff12345' })).body.token;
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
test('Ruhusa: Mhasibu ndiye anaandika uhasibu; Meneja ripoti na idhini tu; Storekeeper haoni', async () => {
  const chart = await call('GET', '/api/v1/accounting/chart', accountant);
  assert.equal(chart.status, 200);
  assert.ok(chart.body.data.length >= 45, 'Chati ya akaunti imeundwa yenyewe');
  assert.ok(chart.body.data.some((a: any) => a.name === 'NMB Akaunti ya chama' && a.code === '1101'), 'Akaunti ya benki ina akaunti yake kwenye daftari kuu');

  assert.equal((await call('GET', '/api/v1/accounting/reports/balance-sheet', manager)).status, 200, 'Meneja anaona ripoti');
  assert.equal((await call('GET', '/api/v1/accounting/chart', storekeeper)).status, 403, 'Storekeeper haoni daftari kuu');
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
  await call('POST', `/api/v1/approvals/${list[0].id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Nimeona mkataba wa bima' });
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

  // Ulinzi wa takwimu zisizo halisi: kiwango cha fedha, mnunuzi (TTB), bei ya shilingi kwenye safu ya USD, kilo
  assert.equal((await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'Alliance One', exchangeRate: '3' })).status, 400, 'Kiwango 1 USD = 3 TZS si halisi');
  assert.equal((await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'ttb', exchangeRate: '2500' })).status, 400, 'TTB si mnunuzi');
  const opts = (await call('GET', '/api/v1/sales/buyer-options', accountant)).body;
  assert.equal(opts.limits.price.max, 20);
  const mk = await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'Alliance One', exchangeRate: '2500', location: 'Ghala kuu' });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  for (const bad of [{ grossKg: '36', priceUsd: '5200' }, { grossKg: '450', priceUsd: '2' }, { grossKg: '40', netKg: '45', priceUsd: '2' }]) {
    const r = await call('POST', `/api/v1/sales/markets/${mk.body.market.id}/bales`, accountant, { bales: [{ memberId: farmerA.id, baleNo: 'BAD-' + RUN, ...bad }] });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.error?.code ?? r.body.code, 'BALE_UNREALISTIC');
  }
  assert.equal((await call('PATCH', `/api/v1/sales/markets/${mk.body.market.id}`, accountant, { exchangeRate: '3' })).status, 400);
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
  assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Nimelinganisha na vitabu vya zamani' })).status, 200);
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
  assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Hesabu zimekaguliwa' })).status, 200);
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
  await call('POST', `/api/v1/approvals/${pc.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Sawa' });
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
  assert.equal((await call('POST', `/api/v1/approvals/${r.body.approval.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Mbolea mpya ya msimu' })).status, 200);
  const item = (await call('GET', '/api/v1/inputs/items', storekeeper)).body.data.find((i: any) => i.name === name);
  assert.ok(item);
  const st = (await call('GET', '/api/v1/inputs/stock', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id);
  assert.equal(st.balance, '20.00');
  assert.equal((await call('GET', '/api/v1/inputs/prices', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id).unitPrice, '70000.00');
  await assertBooksBalance();
});

// v0.16 -----------------------------------------------------------------
test('Madeni ya wanunuzi: tarehe ya kulipa, kuchelewa, kwa kila mnunuzi; tarehe kabla ya soko inakataliwa', async () => {
  const b = (await call('GET', '/api/v1/sales/buyers', manager)).body;
  assert.equal(b.termsDays, 30);
  const due = b.data.find((x: any) => Number(x.due) > 0);
  assert.ok(due, 'Kuna soko lenye deni');
  assert.equal(due.state, 'NOT_DUE');
  assert.ok(due.dueDate > due.marketDate, 'Tarehe ya kulipa = soko + siku 30');
  assert.ok(b.byBuyer.length >= 1 && Number(b.byBuyer[0].outstanding) > 0);
  // Tarehe kabla ya soko inakataliwa; Meneja haandiki mauzo
  assert.equal((await call('PUT', `/api/v1/sales/markets/${due.id}/buyer-due`, accountant, { dueDate: '2000-01-01' })).status, 400);
  assert.equal((await call('PUT', `/api/v1/sales/markets/${due.id}/buyer-due`, manager, { dueDate: due.marketDate })).status, 403);
  assert.equal((await call('PUT', `/api/v1/sales/markets/${due.id}/buyer-due`, accountant, { dueDate: due.marketDate })).status, 200);
  // Tarehe iliyopita (imewekwa moja kwa moja) -> imechelewa
  await db.execute(sql`update markets set buyer_due_date = ${daysAgo(5)}::date where id = ${due.id}`);
  const b2 = (await call('GET', '/api/v1/sales/buyers', manager)).body;
  const r2 = b2.data.find((x: any) => x.id === due.id);
  assert.equal(r2.state, 'OVERDUE'); assert.equal(r2.overdueDays, 5);
  assert.ok(b2.overdue.count >= 1 && Number(b2.overdue.amount) > 0);
  await db.execute(sql`update markets set buyer_due_date = null where id = ${due.id}`);
});

test('Bajeti dhidi ya matumizi: hali kwa kila kundi na onyo kabla ya kurekodi matumizi', async () => {
  const base0 = Number((await call('GET', '/api/v1/finance/budgets/check?category=OFFICE&amount=0', accountant)).body.actual ?? 0);
  const before0 = (await call('GET', '/api/v1/finance/budgets', manager)).body.data.find((x: any) => x.category === 'OFFICE');
  const spent0 = Number(before0?.actual ?? 0);
  const budget = spent0 + 100000;
  assert.equal(base0, 0, 'Kabla ya bajeti hakuna takwimu za check');
  assert.equal((await call('PUT', '/api/v1/finance/budgets', accountant, { category: 'OFFICE', amount: String(budget) })).status, 200);
  const c1 = (await call('GET', '/api/v1/finance/budgets/check?category=OFFICE&amount=150000', accountant)).body;
  assert.equal(c1.exceeds, true); assert.equal(Number(c1.budget), budget); assert.equal(Number(c1.actual), spent0);
  const c0 = (await call('GET', '/api/v1/finance/budgets/check?category=OFFICE&amount=1000', accountant)).body;
  assert.equal(c0.exceeds, false);
  assert.equal((await call('GET', '/api/v1/finance/budgets/check?category=TRANSPORT&amount=5', accountant)).body.budget, null, 'Hakuna bajeti');
  const t = await call('POST', '/api/v1/finance/expenses', accountant, { category: 'OFFICE', amount: '95000', accountId: bank.id, description: 'Vifaa vya ofisi' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  await approve(t.body.transaction.id);
  await call('POST', `/api/v1/finance/transactions/${t.body.transaction.id}/post`, accountant, {});
  const bg = (await call('GET', '/api/v1/finance/budgets', manager)).body;
  const office = bg.data.find((x: any) => x.category === 'OFFICE');
  assert.equal(Number(office.actual), spent0 + 95000); assert.equal(office.remaining, '5000.00');
  assert.equal(office.state, 'NEAR');
  assert.ok(Array.isArray(bg.months) && bg.months.length >= 1);
  assert.equal(Object.values(office.byMonth).reduce((s: number, v: any) => s + Number(v), 0), spent0 + 95000);
});

test('Taarifa ya mkulima kwa msimu: salio la kuanzia + mwendo = salio; mauzo yanaonekana', async () => {
  const d = (await call('GET', `/api/v1/finance/farmers/${farmerA.id}`, accountant)).body;
  assert.ok(d.seasons.length >= 1);
  assert.ok(d.sales.length >= 1 && d.sales[0].settlementNo);
  assert.equal(d.member.phone, undefined, 'Hakuna taarifa binafsi');
  const sid = (d.seasons.find((x: any) => x.isCurrent) ?? d.seasons[0]).id;
  const s = (await call('GET', `/api/v1/finance/farmers/${farmerA.id}?seasonId=${sid}`, accountant)).body;
  assert.equal(s.season.id, sid);
  assert.equal(s.statement.at(-1)?.balance ?? s.opening, s.balance);
  assert.equal((await call('GET', `/api/v1/finance/farmers/${farmerA.id}?seasonId=not-a-uuid`, accountant)).status, 400);
});

test('Portal ya mkulima: Meneja anawasha, Mhasibu anatoa PIN, mkulima anaona taarifa zake tu', async () => {
  const F = '/api/v1/farmer';
  const no = farmerA.memberNo as string;
  // Portal bado imezimwa: PIN haitolewi. Meneja hatoi PIN; Storekeeper hawashi portal.
  assert.equal((await call('POST', `/api/v1/members/${farmerA.id}/portal/pin`, accountant)).status, 400);
  assert.equal((await call('POST', `/api/v1/members/${farmerA.id}/portal/pin`, manager)).status, 403);
  assert.equal((await call('PATCH', `/api/v1/amcos/${amcosId}`, storekeeper, { farmerPortal: true })).status, 403);
  assert.equal((await call('PATCH', `/api/v1/amcos/${amcosId}`, manager, { farmerPortal: true })).status, 200);

  const issued = await call('POST', `/api/v1/members/${farmerA.id}/portal/pin`, accountant);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const pin = issued.body.pin as string;
  assert.match(pin, /^\d{6}$/);
  // Hash ya PIN haitoki kwenye API ya watumishi
  const staffView = await call('GET', `/api/v1/members/${farmerA.id}`, storekeeper);
  assert.equal(JSON.stringify(staffView.body).includes('portalPinHash'), false);
  const st = (await call('GET', `/api/v1/members/${farmerA.id}/portal`, manager)).body;
  assert.equal(st.hasPin, true); assert.equal(st.mustChange, true); assert.equal(st.canIssue, false);
  const sum = (await call('GET', '/api/v1/members/portal/summary', manager)).body;
  assert.equal(sum.enabled, true); assert.ok(sum.withPin >= 1); assert.equal(sum.canToggle, true);

  // Kuingia
  assert.equal((await call('POST', `${F}/login`, undefined, { memberNo: no, pin: pin === '000000' ? '111112' : '000000' })).status, 401);
  const li = await call('POST', `${F}/login`, undefined, { memberNo: ` ${no.toLowerCase()} `, pin });
  assert.equal(li.status, 200, JSON.stringify(li.body)); assert.equal(li.body.mustChange, true);
  const t1 = li.body.token as string;
  assert.equal((await call('GET', `${F}/statement`, t1)).body.error.code, 'PIN_CHANGE_REQUIRED');
  assert.equal((await call('POST', `${F}/change-pin`, t1, { currentPin: pin, newPin: '1234' })).body.error.code, 'WEAK_PIN');
  assert.equal((await call('POST', `${F}/change-pin`, t1, { currentPin: '999999', newPin: '4826' })).status, 400);
  const ch = await call('POST', `${F}/change-pin`, t1, { currentPin: pin, newPin: '4826' });
  assert.equal(ch.status, 200);
  const t2 = ch.body.token as string;
  assert.equal((await call('GET', `${F}/me`, t1)).status, 401, 'Token ya zamani imekufa baada ya kubadili PIN');

  // Taarifa zake tu
  const me = (await call('GET', `${F}/me`, t2)).body;
  assert.equal(me.member.memberNo, no); assert.equal(me.member.phone, undefined); assert.equal(me.mustChange, false);
  const s = (await call('GET', `${F}/statement`, t2)).body;
  assert.equal(s.member.id, farmerA.id);
  const office = (await call('GET', `/api/v1/finance/farmers/${farmerA.id}`, accountant)).body;
  assert.equal(s.balance, office.balance, 'Salio la portal = salio la ofisi');
  assert.ok(s.issues.every((i: any) => i.status !== 'PENDING_APPROVAL'));

  // Token za aina mbili hazichanganyiki
  assert.equal((await call('GET', '/api/v1/members', t2)).status, 401);
  assert.equal((await call('GET', '/api/v1/finance/farmers', t2)).status, 401);
  assert.equal((await call('GET', `${F}/me`, accountant)).status, 401);

  // Makosa 5 -> amefungwa kwa muda (hata PIN sahihi inakataliwa)
  let last = 0;
  for (let i = 0; i < 5; i++) last = (await call('POST', `${F}/login`, undefined, { memberNo: no, pin: '0000' })).status;
  assert.equal(last, 429);
  assert.equal((await call('POST', `${F}/login`, undefined, { memberNo: no, pin: '4826' })).status, 429);
  // PIN mpya kutoka ofisini inaondoa kufungiwa na kuua sessions za zamani
  const re = await call('POST', `/api/v1/members/${farmerA.id}/portal/pin`, storekeeper);
  assert.equal(re.status, 201);
  assert.equal((await call('GET', `${F}/me`, t2)).status, 401);
  assert.equal((await call('POST', `${F}/login`, undefined, { memberNo: no, pin: re.body.pin })).status, 200);

  // Portal ikizimwa: hakuna anayeingia
  assert.equal((await call('PATCH', `/api/v1/amcos/${amcosId}`, manager, { farmerPortal: false })).status, 200);
  assert.equal((await call('POST', `${F}/login`, undefined, { memberNo: no, pin: re.body.pin })).body.error.code, 'PORTAL_CLOSED');
  await call('PATCH', `/api/v1/amcos/${amcosId}`, manager, { farmerPortal: true });
  // PIN ikifutwa: hawezi kuingia
  assert.equal((await call('DELETE', `/api/v1/members/${farmerA.id}/portal/pin`, accountant)).status, 200);
  assert.equal((await call('POST', `${F}/login`, undefined, { memberNo: no, pin: re.body.pin })).status, 401);
  // Kumbukumbu: PIN haiandikwi kwenye audit
  const logs = await db.execute(sql`select after::text as a from audit_logs where entity_id = ${farmerA.id} and action like 'FARMER_PORTAL%'`);
  assert.ok(logs.rows.length >= 3);
  assert.ok(logs.rows.every((r: any) => !String(r.a ?? '').includes(re.body.pin)));
});

test('Chama chenye Meneja pekee: anapata kazi za Mhasibu/Storekeeper na anajiidhinisha kwa alama; mtumishi akirudi, kinga ya watu wawili inarudi', async () => {
  const staff = await db.execute(sql`select id from users where amcos_id = ${amcosId} and role in ('ACCOUNTANT', 'CLERK') and is_active = true`);
  const ids = staff.rows.map((r: any) => r.id as string);
  // Kawaida: Meneja hawezi kurekodi matumizi
  assert.equal((await call('POST', '/api/v1/finance/expenses', manager, { category: 'OFFICE', amount: '1000', accountId: bank.id, description: 'Kalamu' })).status, 403);
  try {
    for (const id of ids) await db.execute(sql`update users set is_active = false where id = ${id}`);
    clearStaffingCache();
    const me = (await call('GET', '/api/v1/auth/me', manager)).body.user;
    assert.deepEqual([...me.covering].sort(), ['ACCOUNTANT', 'CLERK']);
    assert.ok(me.amcosPermissions.includes('finance.record') && me.amcosPermissions.includes('stock.receive'));
    const ws = (await call('GET', '/api/v1/workspace/summary', manager)).body;
    assert.equal(ws.covering.length, 2);

    const e = await call('POST', '/api/v1/finance/expenses', manager, { category: 'OFFICE', amount: '1000', accountId: bank.id, description: 'Kalamu za ofisi' });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    const ap = ((await call('GET', '/api/v1/approvals?status=PENDING&pageSize=100', manager)).body.data as any[]).find((x) => x.entityId === e.body.transaction.id);
    assert.ok(ap);
    // Maelezo mafupi au bila nenosiri: hapana
    assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Sawa' })).status, 400);
    assert.equal((await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { decision: 'APPROVED', note: 'Risiti ya duka ipo ofisini' })).status, 403);
    const ok = await call('POST', `/api/v1/approvals/${ap.id}/decide`, manager, { confirmPassword: 'Staff12345', decision: 'APPROVED', note: 'Risiti ya duka ipo ofisini' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.approval.decisionNote.startsWith('[Imejiidhinisha'));
    const au = await db.execute(sql`select count(*)::int as n from audit_logs where action = 'APPROVAL_SELF_APPROVED' and entity_id = ${ap.id}`);
    assert.equal((au.rows[0] as any).n, 1);
  } finally {
    for (const id of ids) await db.execute(sql`update users set is_active = true where id = ${id}`);
    clearStaffingCache();
  }
  // Watumishi wamerudi: kazi za ziada zimeondoka, kujiidhinisha kumefungwa
  const me2 = (await call('GET', '/api/v1/auth/me', manager)).body.user;
  assert.deepEqual(me2.covering, []);
  assert.equal((await call('POST', '/api/v1/finance/expenses', manager, { category: 'OFFICE', amount: '1000', accountId: bank.id, description: 'Kalamu' })).status, 403);
});

test('Pembejeo kwa dola: bei USD, ugawaji, marejesho kwa kiwango kipya, makato ya soko kwa kiwango cha soko, manunuzi ya dola, vitabu vinalingana', async () => {
  // Kiwango + sarafu (Mhasibu)
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'USD' })).status, 400, 'Kiwango kwanza');
  assert.equal((await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '30' })).status, 400, 'kiwango si halisi');
  assert.equal((await call('POST', '/api/v1/finance/fx', manager, { usdToTzs: '2500' })).status, 403, 'Meneja haweki kiwango');
  assert.equal((await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2500', note: 'BoT' })).status, 201);
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'USD' })).status, 200);
  const fx = (await call('GET', '/api/v1/finance/fx', storekeeper)).body;
  assert.equal(fx.currency, 'USD'); assert.equal(fx.rate.usdToTzs, '2500.0000');

  // Bei ya dola: $20 kwa mfuko
  const farmerU = await newMember('Uledi');
  const item = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'CAN USD ' + RUN, category: 'FERTILIZER', unit: 'BAG' })).body.item;
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: item.id, quantity: 10, unitPrice: '50000', reference: 'DNU-' + RUN })).status, 400, 'Chama cha USD: bei ni ya dola');
  const rc = await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: item.id, quantity: 10, unitPriceUsd: '20', unitCostUsd: '16', reference: 'DNU-' + RUN });
  assert.equal(rc.status, 202, JSON.stringify(rc.body));
  await approve(item.id);
  const price = (await call('GET', '/api/v1/inputs/prices', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id);
  assert.equal(price.unitPriceUsd, '20.0000'); assert.equal(price.unitPrice, '50000.00');
  const gl0 = await gl();

  // Ugawaji wa mifuko 2 = $40 = TSh 100,000 kwa kiwango 2,500
  const iss = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmerU.id, lines: [{ inputItemId: item.id, quantity: 2 }] });
  assert.equal(iss.status, 201, JSON.stringify(iss.body));
  assert.equal(iss.body.issue.currency, 'USD'); assert.equal(iss.body.issue.totalUsd, '40.00'); assert.equal(iss.body.issue.totalAmount, '100000.00');
  await approve(iss.body.issue.id);
  let st = (await call('GET', `/api/v1/finance/farmers/${farmerU.id}`, accountant)).body;
  assert.equal(st.usd.debtUsd, '40.00'); assert.equal(st.balance, '-100000.00');

  // Kiwango kinapanda 2,600; mkulima analipa TSh 26,000 taslimu -> deni linabadilishwa (+4,000) kisha $10 zinalipwa
  assert.equal((await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2600' })).status, 201);
  const rp = await call('POST', '/api/v1/finance/income', accountant, { category: 'FARMER_REPAYMENT', memberId: farmerU.id, amount: '26000', accountId: bank.id, description: 'Marejesho ya taslimu' });
  assert.equal(rp.status, 201, JSON.stringify(rp.body));
  st = (await call('GET', `/api/v1/finance/farmers/${farmerU.id}`, accountant)).body;
  assert.equal(st.usd.debtUsd, '30.00', 'Dola 10 zimelipwa');
  assert.equal(st.balance, '-78000.00', '$30 x 2,600');
  assert.ok(st.statement.some((e: any) => e.type === 'FX_ADJUSTMENT' && e.debit === '4000.00'));
  await call('POST', '/api/v1/accounting/sync', accountant, {}).catch(() => null);
  let rows = await gl();
  assert.equal(D(bal(rows, '4700')).minus(bal(gl0, '4700')).toFixed(2), '4000.00', 'Faida ya kiwango kwenye daftari kuu');
  await assertBooksBalance();

  // Soko kwa kiwango 2,400: deni ($30) linakatwa kama TSh 72,000 (hasara ya kiwango 6,000)
  const mk = await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'TLTC', exchangeRate: '2400' });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const mid = mk.body.market.id;
  assert.equal((await call('POST', `/api/v1/sales/markets/${mid}/bales`, accountant, { bales: [{ memberId: farmerU.id, baleNo: 'U1-' + RUN, grossKg: '100', priceUsd: '2.0' }] })).status, 201);
  const pv = (await call('GET', `/api/v1/sales/markets/${mid}/preview`, accountant)).body;
  const u = pv.rows.find((r: any) => r.memberId === farmerU.id);
  const loanLine = u.deductions.find((d: any) => d.basis === 'OUTSTANDING_LOAN');
  assert.equal(loanLine.amount, '72000.00', '$30 x 2,400');
  assert.equal((await call('POST', `/api/v1/sales/markets/${mid}/settlements`, accountant, {})).status, 201);
  await approve(mid);
  st = (await call('GET', `/api/v1/finance/farmers/${farmerU.id}`, accountant)).body;
  assert.equal(st.usd.debtUsd, '0.00', 'Deni la dola limekwisha');
  assert.ok(st.statement.some((e: any) => e.type === 'FX_ADJUSTMENT' && e.credit === '6000.00'));
  rows = await gl();
  assert.equal(D(bal(rows, '5700')).minus(bal(gl0, '5700')).toFixed(2), '6000.00', 'Hasara ya kiwango kwenye daftari kuu');
  await assertBooksBalance();

  // Manunuzi ya dola: gharama $15 x 4 = $60 = TSh 144,000 kwa kiwango 2,400
  await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2400' });
  const pr = await call('POST', '/api/v1/store/purchases', storekeeper, { notes: 'Mbolea ya ziada', lines: [{ inputItemId: item.id, quantity: 4, unitCostUsd: '15' }] });
  assert.equal(pr.status, 201, JSON.stringify(pr.body));
  assert.equal(pr.body.purchase.currency, 'USD'); assert.equal(pr.body.purchase.totalUsd, '60.00'); assert.equal(pr.body.purchase.totalAmount, '144000.00');

  // Kufuta ugawaji wa dola kunarudisha deni la dola
  const iss2 = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmerU.id, lines: [{ inputItemId: item.id, quantity: 1 }] });
  await approve(iss2.body.issue.id);
  assert.equal((await call('GET', `/api/v1/finance/farmers/${farmerU.id}`, accountant)).body.usd.debtUsd, '20.00');
  assert.equal((await call('POST', `/api/v1/input-issues/${iss2.body.issue.id}/cancel`, manager, { reason: 'Imetolewa kwa makosa' })).status, 200);
  assert.equal((await call('GET', `/api/v1/finance/farmers/${farmerU.id}`, accountant)).body.usd.debtUsd, '0.00');

  // Rudisha chama kwenye TSh (majaribio mengine)
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'TZS' })).status, 200);
});

test('Mbolea ya vitalu kwa kilo: bei ya kilo = bei ya mfuko / kilo za mfuko, stoo inapungua sehemu ya mfuko, kilo nzima tu', async () => {
  await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2500' });
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'USD' })).status, 200);
  const farmer = await newMember('Vitalu');
  assert.equal((await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'NPK Vitalu ' + RUN, category: 'FERTILIZER', unit: 'BAG', looseKg: true })).status, 400, 'Kilo za mfuko zinahitajika');
  const item = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'NPK Vitalu ' + RUN, category: 'FERTILIZER', unit: 'BAG', packKg: '50', looseKg: true })).body.item;
  assert.equal(item.looseKg, true); assert.equal(item.packKg, '50.00');
  const plain = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'Urea Mfuko ' + RUN, category: 'FERTILIZER', unit: 'BAG', packKg: '50' })).body.item;
  await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: item.id, quantity: 2, unitPriceUsd: '45', reference: 'DNV-' + RUN });
  await approve(item.id);
  await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: plain.id, quantity: 2, unitPriceUsd: '40', reference: 'DNP-' + RUN });
  await approve(plain.id);

  assert.equal((await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmer.id, lines: [{ inputItemId: item.id, quantity: '2.5', unit: 'KG' }] })).status, 400, 'Kilo nzima tu');
  assert.equal((await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmer.id, lines: [{ inputItemId: plain.id, quantity: '3', unit: 'KG' }] })).status, 400, 'Bidhaa hii haigawiwi kwa kilo');
  // Kilo 3 + mfuko 1 wa bidhaa nyingine: $45 / 50 x 3 = $2.70; jumla $42.70
  const iss = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: farmer.id, lines: [{ inputItemId: item.id, quantity: '3', unit: 'KG' }, { inputItemId: plain.id, quantity: '1' }] });
  assert.equal(iss.status, 201, JSON.stringify(iss.body));
  const kgLine = iss.body.issue.lines.find((l: any) => l.inputItemId === item.id);
  assert.equal(Number(kgLine.kg), 3); assert.equal(Number(kgLine.quantity), 0.06); assert.equal(Number(kgLine.amountUsd), 2.7); assert.equal(Number(kgLine.amount), 6750);
  assert.equal(iss.body.issue.totalUsd, '42.70');
  await approve(iss.body.issue.id);
  const st = (await call('GET', '/api/v1/inputs/stock', storekeeper)).body.data.find((x: any) => x.inputItemId === item.id);
  assert.equal(Number(st.balance), 1.94, 'Mifuko 1 + kilo 47');
  const stmt = (await call('GET', `/api/v1/finance/farmers/${farmer.id}`, accountant)).body;
  assert.equal(stmt.usd.debtUsd, '42.70');
  assert.equal(stmt.inputsSummary.find((x: any) => x.name.startsWith('NPK Vitalu')).kg, '3.00');
  assert.ok(stmt.statement.some((e: any) => /kilo 3/.test(e.description)));
  await assertBooksBalance();
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'TZS' })).status, 200);
});

// v0.20 -----------------------------------------------------------------
test('Mikopo: kuni na grading kwa dola — kikomo kwa ekari kila aina, riba yake, idhini, deni la dola, kikundi, kusahihisha, soko', async () => {
  const F = await newMember('Fatuma'), G2 = await newMember('Gabrieli');
  // Njia ya zamani ya "mkopo wa fedha" imefungwa — njia moja tu
  assert.equal((await call('POST', '/api/v1/finance/farmer-payments', accountant, { memberId: F.id, category: 'CASH_LOAN', amount: '1000', description: 'x' })).status, 400);
  for (const [m, acres] of [[F, '2'], [G2, '1.5']] as const) {
    const e = await call('POST', '/api/v1/estimates', storekeeper, { memberId: m.id, acresPlanted: acres, estimatedKg: String(Number(acres) * 600) });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.equal((await call('POST', `/api/v1/estimates/${e.body.estimate.id}/approve`, manager, { confirmPassword: 'Staff12345' })).status, 200);
  }
  const grp = await call('POST', '/api/v1/groups', storekeeper, { name: 'Mikopo ' + RUN, memberIds: [F.id, G2.id], leaderMemberId: F.id });
  assert.equal(grp.status, 201, JSON.stringify(grp.body));
  await approve(grp.body.group.id);
  await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2500' });
  // Mikopo ni ya dola hata kama chama kinatumia TSh kwenye pembejeo
  assert.equal((await call('GET', '/api/v1/finance/fx', accountant)).body.currency, 'TZS');

  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'KUNI', loans: [{ memberId: F.id, amountUsd: '10' }] })).status, 400, 'Mipangilio haijawekwa');
  assert.equal((await call('PUT', '/api/v1/kuni/settings', manager, { loanType: 'KUNI', interestRate: '10', amountPerAcreUsd: '60', isOpen: true })).status, 403, 'Mhasibu ndiye anaweka');
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'KUNI', interestRate: '10', amountPerAcreUsd: '60', isOpen: true })).status, 200);
  const st = (await call('GET', '/api/v1/kuni/settings', accountant)).body;
  assert.equal(st.types.KUNI.amountPerAcreUsd, '60.00'); assert.equal(st.types.GRADING.configured, false, 'Grading ina mipangilio yake');
  const el = (await call('GET', '/api/v1/kuni/eligible?type=KUNI', accountant)).body.data;
  assert.equal(el.find((x: any) => x.memberId === F.id).limit, '120.00');
  assert.equal(el.find((x: any) => x.memberId === G2.id).available, '90.00');
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'KUNI', loans: [{ memberId: F.id, amountUsd: '120.01' }] })).status, 400, 'Haizidi kikomo');
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'GRADING', loans: [{ memberId: F.id, amountUsd: '10' }] })).status, 400, 'Grading bado imefungwa');
  const b = await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'KUNI', loans: [{ memberId: F.id, amountUsd: '80' }, { memberId: G2.id, amountUsd: '90' }] });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.batch.currency, 'USD'); assert.equal(b.body.batch.totalUsd, '170.00'); assert.equal(b.body.batch.totalInterestUsd, '17.00');
  assert.equal(b.body.batch.totalAmount, '425000.00', 'TSh kwa kiwango cha siku ya kuandaa'); assert.equal(b.body.batch.totalInterest, '42500.00');
  assert.match(b.body.batch.batchNo, /-KN-/);
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'KUNI', loans: [{ memberId: F.id, amountUsd: '40.01' }] })).status, 400, 'Kinachosubiri kinahesabiwa kwenye kikomo');
  const det0 = (await call('GET', `/api/v1/kuni/batches/${b.body.batch.id}`, accountant)).body;
  assert.equal((await call('POST', `/api/v1/kuni/batches/${b.body.batch.id}/confirm`, accountant, { accountId: bank.id, loanIds: [det0.loans[0].id], reference: 'X1' })).status, 400, 'Kabla ya idhini');
  await approve(b.body.batch.id);
  const lf = det0.loans.find((l: any) => l.memberId === F.id);
  const c = await call('POST', `/api/v1/kuni/batches/${b.body.batch.id}/confirm`, accountant, { accountId: bank.id, loanIds: det0.loans.map((l: any) => l.id), reference: 'BULK-KUNI-' + RUN });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.status, 'COMPLETED');
  const mbal = async (id: string) => (await call('GET', `/api/v1/members/${id}`, manager)).body.balance.balance;
  assert.equal(await mbal(F.id), '-220000.00', 'Mkopo $80 + riba 10% = $88 x 2,500');
  assert.ok(Number(bal(await gl(), '4450')) >= 42500, 'Riba ni mapato ya chama');
  const fd = (await call('GET', '/api/v1/finance/farmers?filter=all&search=Fatuma', accountant)).body.data[0];
  assert.equal(fd.loans, '200000.00'); assert.equal(fd.interest, '20000.00');
  await assertBooksBalance();

  // Mkopo wa grading: mipangilio yake, kikomo chake (hauathiriwi na kuni)
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'GRADING', interestRate: '5', amountPerAcreUsd: '20', isOpen: true })).status, 200);
  const elg = (await call('GET', '/api/v1/kuni/eligible?type=GRADING', accountant)).body.data;
  assert.equal(elg.find((x: any) => x.memberId === F.id).available, '40.00');
  assert.equal(elg.find((x: any) => x.memberId === F.id).debtUsd, '88.00');
  const gb = await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'GRADING', loans: [{ memberId: F.id, amountUsd: '40' }] });
  assert.equal(gb.status, 201, JSON.stringify(gb.body));
  assert.match(gb.body.batch.batchNo, /-GR-/); assert.equal(gb.body.batch.totalInterestUsd, '2.00');
  await approve(gb.body.batch.id);
  const gl0 = (await call('GET', `/api/v1/kuni/batches/${gb.body.batch.id}`, accountant)).body;
  assert.equal(gl0.batch.label, 'Mkopo wa grading');
  assert.equal((await call('POST', `/api/v1/kuni/batches/${gb.body.batch.id}/confirm`, accountant, { accountId: bank.id, loanIds: gl0.loans.map((l: any) => l.id), reference: 'GR-' + RUN })).status, 200);
  assert.equal((await call('GET', '/api/v1/kuni/batches?type=GRADING', accountant)).body.data.every((x: any) => x.loanType === 'GRADING'), true);

  // Deni limejumlishwa: kwa mkulima (kuni + grading) na kwa kikundi
  const debts = (await call('GET', '/api/v1/kuni/debts?search=' + RUN, accountant)).body;
  const dF = debts.farmers.find((x: any) => x.memberId === F.id);
  assert.equal(dF.kuniUsd, '88.00'); assert.equal(dF.gradingUsd, '42.00'); assert.equal(dF.debtUsd, '130.00');
  const dG = debts.groups.find((x: any) => x.id === grp.body.group.id);
  assert.equal(dG.debtUsd, '229.00', 'F $130 + G2 $99'); assert.equal(dG.kuniUsd, '187.00'); assert.equal(dG.gradingUsd, '42.00'); assert.equal(dG.members, 2);
  assert.equal((await call('GET', `/api/v1/groups/${grp.body.group.id}`, accountant)).body.group.owingUsd, '229.00');
  const stmt = (await call('GET', `/api/v1/finance/farmers/${F.id}`, accountant)).body;
  assert.equal(stmt.usd.breakdown.gradingUsd, '42.00'); assert.equal(stmt.usd.debtUsd, '130.00');
  assert.equal((await call('GET', '/api/v1/kuni/debts', storekeeper)).status, 403, 'Storekeeper haoni madeni ya fedha');
  await assertBooksBalance();

  // Kusahihisha malipo ya kuni ya F: mkopo, riba na deni la dola vinaondolewa; mkopo unarudi "umeshindwa"
  const t = (await call('GET', `/api/v1/kuni/batches/${b.body.batch.id}`, accountant)).body.loans.find((l: any) => l.id === lf.id);
  const txn = (await call('GET', '/api/v1/finance/transactions?search=' + t.txnNo, accountant)).body.data[0];
  assert.equal(txn.amountUsd, '80.00');
  assert.equal((await call('POST', `/api/v1/finance/transactions/${txn.id}/reverse`, accountant, { reason: 'Imetumwa namba isiyo sahihi' })).status, 202);
  await approve(txn.id);
  assert.equal(await mbal(F.id), '-105000.00', 'Grading $42 x 2,500 inabaki');
  const dF2 = (await call('GET', '/api/v1/kuni/debts?search=Fatuma', accountant)).body.farmers.find((x: any) => x.memberId === F.id);
  assert.equal(dF2.kuniUsd, '0.00'); assert.equal(dF2.debtUsd, '42.00');
  assert.equal((await call('GET', `/api/v1/kuni/batches/${b.body.batch.id}`, accountant)).body.loans.find((l: any) => l.id === lf.id).status, 'FAILED');
  await assertBooksBalance();

  // Sokoni: deni la dola la G2 ($99) linakatwa kwa kiwango cha soko (2,600) — faida ya kiwango inaandikwa
  const mk = (await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'TLTC', exchangeRate: '2600' })).body.market;
  await call('POST', `/api/v1/sales/markets/${mk.id}/bales`, accountant, { bales: [{ memberId: G2.id, baleNo: 'G2-' + RUN, grossKg: '200', priceUsd: '2' }] });
  const pv = (await call('GET', `/api/v1/sales/markets/${mk.id}/preview`, accountant)).body.rows[0];
  const loanLine = pv.deductions.find((d: any) => d.basis === 'OUTSTANDING_LOAN');
  assert.equal(loanLine.amount, '257400.00', 'Mkopo wa kuni $90 + riba $9 = $99 x 2,600');
});

// v0.21 -----------------------------------------------------------------
test('Mkopo wa miti: miti kwa hekta x gharama ya mti + riba, kikomo kwa idadi ya miti, deni la dola', async () => {
  const T = await newMember('Tumaini'), U = await newMember('Upendo');
  for (const [m, acres] of [[T, '5'], [U, '2.5']] as const) {
    // Kikomo cha miti kinatoka ekari za MITI kwenye makisio
    const e = await call('POST', '/api/v1/estimates', storekeeper, { memberId: m.id, acresPlanted: acres, treeAcres: acres, estimatedKg: String(Number(acres) * 600) });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.equal((await call('POST', `/api/v1/estimates/${e.body.estimate.id}/approve`, manager, { confirmPassword: 'Staff12345' })).status, 200);
  }
  await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2500' });
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'TREES', interestRate: '10', isOpen: true })).status, 400, 'Idadi ya miti na gharama zinahitajika');
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'TREES', interestRate: '10', areaUnit: 'HECTARE', treesPerArea: 400, costPerTreeUsd: '0.25', isOpen: true })).status, 200);
  const st = (await call('GET', '/api/v1/kuni/settings', accountant)).body.types.TREES;
  assert.equal(st.treesPerArea, 400); assert.equal(st.costPerTreeUsd, '0.2500'); assert.equal(st.areaUnit, 'HECTARE');
  // Ekari 5 = hekta 2.02 -> miti 809; ekari 2.5 = hekta 1.01 -> miti 404
  const el = (await call('GET', '/api/v1/kuni/eligible?type=TREES', accountant)).body.data;
  const eT = el.find((x: any) => x.memberId === T.id), eU = el.find((x: any) => x.memberId === U.id);
  assert.equal(eT.limitTrees, 809); assert.equal(eT.hectares, '2.02'); assert.equal(eT.available, '202.25');
  assert.equal(eU.availableTrees, 404);
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'TREES', loans: [{ memberId: U.id, trees: 405 }] })).status, 400, 'Haizidi miti ya kikomo');
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'TREES', loans: [{ memberId: U.id, trees: 10.5 }] })).status, 400, 'Mti mzima tu');
  const b = await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'TREES', loans: [{ memberId: T.id, trees: 800 }, { memberId: U.id, trees: 404 }] });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.match(b.body.batch.batchNo, /-MT-/);
  assert.equal(b.body.batch.totalTrees, 1204); assert.equal(b.body.batch.totalUsd, '301.00'); assert.equal(b.body.batch.totalInterestUsd, '30.10');
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'TREES', loans: [{ memberId: T.id, trees: 10 }] })).status, 400, 'Miti inayosubiri inahesabiwa');
  await approve(b.body.batch.id);
  const det = (await call('GET', `/api/v1/kuni/batches/${b.body.batch.id}`, accountant)).body;
  assert.equal(det.loans.find((l: any) => l.memberId === T.id).trees, 800);
  assert.equal((await call('POST', `/api/v1/kuni/batches/${b.body.batch.id}/confirm`, accountant, { accountId: bank.id, loanIds: det.loans.map((l: any) => l.id), reference: 'MITI-' + RUN })).status, 200);
  const d = (await call('GET', '/api/v1/kuni/debts?search=Tumaini', accountant)).body.farmers.find((x: any) => x.memberId === T.id);
  assert.equal(d.treesUsd, '220.00', 'Miti 800 x $0.25 = $200 + riba 10%'); assert.equal(d.debtUsd, '220.00');
  assert.equal((await call('GET', `/api/v1/members/${T.id}`, manager)).body.balance.balance, '-550000.00');
  // Kipimo cha ekari: miti kwa ekari moja moja
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'TREES', interestRate: '10', areaUnit: 'ACRE', treesPerArea: 200, costPerTreeUsd: '0.25', isOpen: true })).status, 200);
  const el2 = (await call('GET', '/api/v1/kuni/eligible?type=TREES', accountant)).body.data;
  assert.equal(el2.find((x: any) => x.memberId === T.id).availableTrees, 200, 'Ekari 5 x 200 = 1000 - 800 alizochukua');
  await assertBooksBalance();
});

// v0.22 -----------------------------------------------------------------
test('Makisio kamili: TTB, mabani, kilo @560, mahindi, miti, pembejeo za chama, kuni trip, grading; fomu; ugawaji unaozidi; vikomo vya mikopo', async () => {
  assert.equal((await call('PUT', '/api/v1/estimates/settings', storekeeper, { kgPerAcre: '600' })).status, 403, 'Meneja anaweka');
  assert.equal((await call('PUT', '/api/v1/estimates/settings', manager, { kgPerAcre: '560', postalAddress: 'S.L.P 149 Urambo' })).status, 200);
  await call('POST', '/api/v1/finance/fx', accountant, { usdToTzs: '2500' });
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'USD' })).status, 200);
  const can = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'CAN Est ' + RUN, category: 'FERTILIZER', unit: 'BAG', packKg: '50' })).body.item;
  const bed = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'NPK Mabedi ' + RUN, category: 'FERTILIZER', unit: 'BAG', packKg: '50', looseKg: true })).body.item;
  for (const it of [can, bed]) { await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: it.id, quantity: 10, unitPriceUsd: '40', reference: 'EST-' + it.id.slice(0, 6) }); await approve(it.id); }
  const W = await newMember('Wilson');
  assert.equal((await call('POST', '/api/v1/estimates', storekeeper, { memberId: W.id, acresPlanted: '2', inputs: [{ inputItemId: can.id, quantity: '1', unit: 'KG' }] })).status, 400, 'CAN haikisiwi kwa kilo');
  const e = await call('POST', '/api/v1/estimates', storekeeper, { memberId: W.id, acresPlanted: '2', ttbNo: 'TTB-' + RUN, barnsExisting: 1, barnsNew: 1, maizeAcres: '1', treeAcres: '1', kuniTrips: '3', gradingUsd: '40',
    inputs: [{ inputItemId: can.id, quantity: '4' }, { inputItemId: bed.id, quantity: '10', unit: 'KG' }] });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.estimate.estimatedKg, '1120.00', 'Ekari 2 x kilo 560');
  const one = (await call('GET', `/api/v1/estimates/${e.body.estimate.id}`, storekeeper)).body.estimate;
  assert.equal(one.inputs.length, 2); assert.equal(Number(one.inputs.find((x: any) => x.inputItemId === bed.id).quantity), 0.2); assert.equal(one.ttbNo, 'TTB-' + RUN);
  assert.equal((await call('POST', `/api/v1/estimates/${e.body.estimate.id}/approve`, manager, { confirmPassword: 'Staff12345' })).status, 200);
  const sheet = (await call('GET', '/api/v1/estimates/sheet', storekeeper)).body;
  assert.equal(sheet.amcos.postalAddress, 'S.L.P 149 Urambo');
  assert.ok(sheet.items.some((i: any) => i.id === can.id), 'Safu ya kila pembejeo ya chama');
  const row = sheet.data.find((r: any) => r.memberId === W.id);
  assert.equal(Number(row.inputs[can.id].quantity), 4); assert.equal(row.inputs[bed.id].kg, '10.00'); assert.equal(row.barnsNew, 1); assert.equal(row.kuniTrips, '3.00');

  // Ugawaji: ndani ya makisio -> kawaida; ukizidi -> Meneja anaona "ZAIDI YA MAKISIO"
  const chk = (await call('GET', `/api/v1/estimates/check?memberId=${W.id}`, storekeeper)).body;
  assert.equal(Number(chk.items[can.id].estimated), 4);
  const i1 = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: W.id, lines: [{ inputItemId: can.id, quantity: '3' }] });
  assert.equal(i1.status, 201, JSON.stringify(i1.body));
  const i2 = await call('POST', '/api/v1/input-issues', storekeeper, { memberId: W.id, lines: [{ inputItemId: can.id, quantity: '2' }] });
  const pend = (await call('GET', '/api/v1/approvals?status=PENDING&pageSize=100', manager)).body.data as any[];
  const a1 = pend.find((x) => x.entityId === i1.body.issue.id), a2 = pend.find((x) => x.entityId === i2.body.issue.id);
  assert.ok(!/ZAIDI/.test(a1.title), 'Ndani ya makisio');
  assert.match(a2.title, /ZAIDI YA MAKISIO: CAN Est .* \+1/);
  assert.equal(a2.payload.estimate.over[0].over, '1');
  await approve(i1.body.issue.id); await approve(i2.body.issue.id);

  // Mikopo: kuni = trip 3 x $30; grading = $40 ya makisio; miti = ekari 1 ya miti
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'KUNI', limitBasis: 'TRIP', interestRate: '10', isOpen: true })).status, 400, 'Bei ya trip inahitajika');
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'GRADING', limitBasis: 'TRIP', pricePerTripUsd: '30', interestRate: '5', isOpen: true })).status, 400, 'Trip ni ya kuni tu');
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'KUNI', limitBasis: 'TRIP', pricePerTripUsd: '30', interestRate: '10', isOpen: true })).status, 200);
  assert.equal((await call('PUT', '/api/v1/kuni/settings', accountant, { loanType: 'GRADING', limitBasis: 'ESTIMATE', interestRate: '5', isOpen: true })).status, 200);
  const elK = (await call('GET', '/api/v1/kuni/eligible?type=KUNI&search=Wilson', accountant)).body.data.find((x: any) => x.memberId === W.id);
  assert.equal(elK.limit, '90.00'); assert.match(elK.basis, /trip 3/);
  const elG = (await call('GET', '/api/v1/kuni/eligible?type=GRADING&search=Wilson', accountant)).body.data.find((x: any) => x.memberId === W.id);
  assert.equal(elG.limit, '40.00');
  const elT = (await call('GET', '/api/v1/kuni/eligible?type=TREES&search=Wilson', accountant)).body.data.find((x: any) => x.memberId === W.id);
  assert.equal(elT.limitTrees, 200, 'Ekari 1 ya miti x miti 200 kwa ekari (mipangilio ya jaribio la miti)');
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'KUNI', loans: [{ memberId: W.id, amountUsd: '90.01' }] })).status, 400);
  assert.equal((await call('POST', '/api/v1/kuni/batches', accountant, { loanType: 'GRADING', loans: [{ memberId: W.id, amountUsd: '40' }] })).status, 201);
  await assertBooksBalance();
  assert.equal((await call('PUT', '/api/v1/finance/fx/currency', accountant, { currency: 'TZS' })).status, 200);
});

// v0.23 -----------------------------------------------------------------
test('Mkulima: hali ya ndoa (ameoa / ameolewa / hajaoa) kwenye usajili, kubadilisha na kupakia Excel', async () => {
  const m = await call('POST', '/api/v1/members', storekeeper, { firstName: 'Mariamu', lastName: 'Ndoa' + RUN, gender: 'FEMALE', maritalStatus: 'MARRIED' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.equal(m.body.member.maritalStatus, 'MARRIED');
  assert.equal((await call('POST', '/api/v1/members', storekeeper, { firstName: 'Bad', lastName: 'Ndoa' + RUN, gender: 'MALE', maritalStatus: 'WIDOW' })).status, 400);
  const chk = await call('POST', '/api/v1/members/import', manager, { dryRun: true, rows: [
    { firstName: 'Saidi', lastName: 'Ndoa' + RUN, gender: 'ME', maritalStatus: 'Hajaoa' },
    { firstName: 'Zuhura', lastName: 'Ndoa' + RUN, gender: 'KE', maritalStatus: 'ameolewa' },
    { firstName: 'Musa', lastName: 'Ndoa' + RUN, gender: 'ME', maritalStatus: 'xyz' },
  ] });
  assert.equal(chk.status, 200, JSON.stringify(chk.body));
  const rows = chk.body.rows as any[];
  assert.equal(rows[0].ok, true); assert.ok(!rows[1].warnings.some((w: string) => /Hali ya ndoa/.test(w)), 'ameolewa inaeleweka');
  assert.ok(rows[2].warnings.some((w: string) => /Hali ya ndoa/.test(w)), 'Isiyoeleweka inaachwa wazi kwa tahadhari');
});

// v0.24 -----------------------------------------------------------------
test('Bei za madaraja ya msimu (TTB): orodha ya chama, belo kwa daraja -> bei inajiweka, chini inakataliwa, juu inahitaji sababu', async () => {
  const F = await newMember('Daraja');
  assert.equal((await call('PUT', '/api/v1/sales/grade-prices', storekeeper, { prices: [{ grade: 'L1OF', priceUsd: '3.16' }] })).status, 403);
  assert.equal((await call('PUT', '/api/v1/sales/grade-prices', accountant, { prices: [{ grade: 'L1OF', priceUsd: '3160' }] })).status, 400, 'Bei ya shilingi inakataliwa');
  assert.equal((await call('PUT', '/api/v1/sales/grade-prices', accountant, { prices: [{ grade: 'L1OF', priceUsd: '3.16' }, { grade: 'l1 of', priceUsd: '3.1' }] })).status, 400, 'Daraja limerudiwa');
  const put = await call('PUT', '/api/v1/sales/grade-prices', accountant, { prices: [{ grade: 'l1 of', priceUsd: '3.160' }, { grade: 'X2L', priceUsd: '1.816' }, { grade: 'C3O', priceUsd: '1.571' }] });
  assert.equal(put.status, 200, JSON.stringify(put.body)); assert.equal(put.body.count, 3);
  const gp = (await call('GET', '/api/v1/sales/grade-prices', manager)).body;
  assert.equal(gp.count, 3); assert.ok(gp.prices.some((p: any) => p.grade === 'L1OF' && p.priceUsd === '3.1600'));
  assert.equal(gp.average, '2.182');

  const mk = (await call('POST', '/api/v1/sales/markets', accountant, { marketDate: today, buyerName: 'Alliance One', exchangeRate: '2500' })).body.market;
  const post = (bales: any[]) => call('POST', `/api/v1/sales/markets/${mk.id}/bales`, accountant, { bales });
  assert.equal((await post([{ memberId: F.id, baleNo: 'GP0-' + RUN, grossKg: '50' }])).status, 400, 'Daraja linahitajika');
  const unk = await post([{ memberId: F.id, baleNo: 'GP0-' + RUN, grossKg: '50', grade: 'X9Z' }]);
  assert.equal(unk.status, 400); assert.equal(unk.body.error.code, 'UNKNOWN_GRADE');
  assert.equal((await post([{ memberId: F.id, baleNo: 'GP0-' + RUN, grossKg: '50', grade: 'X2L', priceUsd: '1.5' }])).status, 400, 'Chini ya bei ya daraja');
  assert.equal((await post([{ memberId: F.id, baleNo: 'GP0-' + RUN, grossKg: '50', grade: 'X2L', priceUsd: '1.9' }])).status, 400, 'Juu bila sababu');
  const ok = await post([
    { memberId: F.id, baleNo: 'GP1-' + RUN, grossKg: '100', grade: 'l1of' },
    { memberId: F.id, baleNo: 'GP2-' + RUN, grossKg: '50', grade: 'X2L', priceUsd: '1.9', priceNote: 'Mnunuzi ameongeza bei' },
    { memberId: F.id, baleNo: 'GP3-' + RUN, grossKg: '40', rejected: true, rejectReason: 'Unyevu' },
  ]);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const g1 = ok.body.bales.find((b: any) => b.baleNo.startsWith('GP1-'));
  assert.equal(g1.grade, 'L1OF'); assert.equal(Number(g1.priceUsd), 3.16); assert.equal(g1.valueUsd, '316.00'); assert.equal(Number(g1.listPriceUsd), 3.16);
  const g2 = ok.body.bales.find((b: any) => b.baleNo.startsWith('GP2-'));
  assert.equal(Number(g2.priceUsd), 1.9); assert.equal(Number(g2.listPriceUsd), 1.816); assert.equal(g2.priceNote, 'Mnunuzi ameongeza bei');
  // Orodha ikibadilika, mabelo yaliyokwisha andikwa hayabadiliki
  assert.equal((await call('PUT', '/api/v1/sales/grade-prices', accountant, { prices: [{ grade: 'L1OF', priceUsd: '3.2' }, { grade: 'X2L', priceUsd: '1.816' }] })).status, 200);
  const det = (await call('GET', `/api/v1/sales/markets/${mk.id}`, accountant)).body;
  assert.equal(Number(det.bales.find((b: any) => b.baleNo.startsWith('GP1-')).priceUsd), 3.16);
  assert.equal((await call('GET', '/api/v1/sales/grade-prices', accountant)).body.count, 2, 'C3O imeondolewa');
});

// v0.27 — SMS: swichi za Owner, OTP ya namba ya mkulima, kukabidhi pembejeo, deni la kikundi, matangazo, kuingia na nenosiri -----
const lastCode = (phone: string, re: RegExp) => {
  const m = [...dryOutbox].reverse().find((x) => x.phone === phone && re.test(x.text));
  assert.ok(m, `SMS kwa ${phone}`);
  return m!.text.match(re)![1];
};
const tz = (p: string) => '255' + p.replace(/^0/, '');
test('SMS: Owner anawasha huduma; OTP ya namba ya mkulima, kukabidhi pembejeo, deni la kikundi, matangazo na kikomo', async () => {
  const c = (await call('GET', '/api/v1/owner/sms', owner)).body;
  assert.equal(c.provider.provider, 'DRY');
  assert.ok(c.kinds.find((k: any) => k.key === 'LOGIN_OTP').on === false, 'Huduma mpya zimezimwa mwanzoni');
  assert.equal((await call('PUT', '/api/v1/owner/sms/events', manager, { events: { MEMBER_REGISTERED: true }, confirmPassword: 'Staff12345' })).status, 403);
  assert.equal((await call('PUT', '/api/v1/owner/sms/events', owner, { events: { NOPE: true }, confirmPassword: OWNER_PW })).status, 400);
  const on = { MEMBER_PHONE_OTP: true, ISSUE_HANDOVER_OTP: true, GROUP_DEBT: true, CHAMA_BROADCAST: true, GROUP_INPUT_TAKEN: true, MEMBER_REGISTERED: true };
  assert.equal((await call('PUT', '/api/v1/owner/sms/events', owner, { events: on, confirmPassword: OWNER_PW })).status, 200);

  // 1. Namba mpya ya simu ya mkulima lazima ithibitishwe kwa OTP
  const M1 = await newMember('Simu');
  const newPhone = '0765' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  const p1 = await call('PATCH', `/api/v1/members/${M1.id}`, storekeeper, { phone: newPhone });
  assert.equal(p1.status, 400); assert.equal(p1.body.error.code, 'PHONE_OTP_REQUIRED');
  assert.equal((await call('PATCH', `/api/v1/members/${M1.id}`, storekeeper, { phone: newPhone, phoneOtpOverride: 'Storekeeper anajaribu kupita' })).status, 400, 'Storekeeper hawezi kupita OTP');
  assert.equal((await call('POST', `/api/v1/members/${M1.id}/phone-otp`, storekeeper, { phone: newPhone })).status, 200);
  const code1 = lastCode(tz(newPhone), /namba (\d{6}) inathibitisha/);
  assert.equal((await call('POST', `/api/v1/members/${M1.id}/phone-otp/verify`, storekeeper, { phone: newPhone, code: code1 === '000000' ? '111111' : '000000' })).status, 400);
  assert.equal((await call('POST', `/api/v1/members/${M1.id}/phone-otp/verify`, storekeeper, { phone: newPhone, code: code1 })).status, 200);
  const p2 = await call('PATCH', `/api/v1/members/${M1.id}`, storekeeper, { phone: newPhone });
  assert.equal(p2.status, 200, JSON.stringify(p2.body)); assert.ok(p2.body.member.phoneVerifiedAt);
  // Namba nyingine ambayo OTP yake ilifutwa (namba mpya ilitumwa) haihesabiki kuwa imethibitishwa
  const other = '0766' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  assert.equal((await call('PATCH', `/api/v1/members/${M1.id}`, manager, { mobileMoneyNumber: other, phoneOtpOverride: 'Mkulima yuko shambani, simu imeharibika' })).status, 200, 'Meneja anaweza kupita kwa sababu');

  // 2. Kukabidhi pembejeo kwa OTP ya mkulima
  const item = (await call('POST', '/api/v1/inputs/items', storekeeper, { name: 'SMS-NPK ' + RUN, category: 'FERTILIZER', unit: 'BAG' })).body.item;
  assert.equal((await call('POST', '/api/v1/inputs/stock/receipts', storekeeper, { inputItemId: item.id, quantity: 10, unitPrice: '70000', reference: 'DN-SMS-' + RUN })).status, 202);
  await approve(item.id);
  assert.equal((await call('PUT', '/api/v1/inputs/prices', manager, { inputItemId: item.id, unitPrice: '70000' })).status, 200);
  const issue = async (memberId: string) => {
    const r = await call('POST', '/api/v1/input-issues', storekeeper, { memberId, lines: [{ inputItemId: item.id, quantity: 1 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await call('POST', `/api/v1/input-issues/${r.body.issue.id}/handover/otp`, storekeeper)).status, 400, 'Kabla ya idhini hakuna kukabidhi');
    await approve(r.body.issue.id);
    return r.body.issue.id as string;
  };
  const i1 = await issue(M1.id);
  const d1 = (await call('GET', `/api/v1/input-issues/${i1}`, storekeeper)).body;
  assert.equal(d1.handoverOtp, true); assert.equal(d1.issue.handedOverAt, null);
  assert.equal((await call('POST', `/api/v1/input-issues/${i1}/handover/otp`, storekeeper)).status, 200);
  const sms = [...dryOutbox].reverse().find((x) => x.phone === tz(newPhone))!;
  assert.match(sms.text, /SMS-NPK/); assert.match(sms.text, /deni/);
  const code2 = lastCode(tz(newPhone), /uthibitisho: (\d{6})/);
  assert.equal((await call('POST', `/api/v1/input-issues/${i1}/handover`, storekeeper, {})).status, 400, 'Bila OTP lazima sababu');
  const h = await call('POST', `/api/v1/input-issues/${i1}/handover`, storekeeper, { code: code2 });
  assert.equal(h.status, 200, JSON.stringify(h.body)); assert.equal(h.body.issue.handoverMethod, 'OTP');
  assert.equal((await call('POST', `/api/v1/input-issues/${i1}/handover`, storekeeper, { code: code2 })).status, 409);
  const i2 = await issue(M1.id);
  const h2 = await call('POST', `/api/v1/input-issues/${i2}/handover`, storekeeper, { note: 'Mkulima hana simu leo — amesaini daftari' });
  assert.equal(h2.status, 200); assert.equal(h2.body.issue.handoverMethod, 'MANUAL');
  assert.equal((await call('GET', '/api/v1/input-issues?handover=DONE&pageSize=50', storekeeper)).body.data.filter((x: any) => [i1, i2].includes(x.id)).length, 2);
  // Kumbukumbu inaficha namba ya OTP
  const logs = (await db.execute<{ message: string }>(sql`select message from sms_logs where kind = 'ISSUE_HANDOVER_OTP' and reference_type = 'OTP' order by created_at desc limit 1`)).rows;
  assert.ok(logs[0].message.includes('******') && !logs[0].message.includes(code2));

  // 3. Deni la kikundi kwa SMS (mara moja kwa saa 24)
  const G1 = await newMember('Kundi'), G2 = await newMember('Kundi2');
  const g = await call('POST', '/api/v1/groups', storekeeper, { name: 'SMS ' + RUN, memberIds: [G1.id, G2.id], leaderMemberId: G1.id });
  await approve(g.body.group.id);
  assert.equal((await call('POST', `/api/v1/sms/groups/${g.body.group.id}/debt`, storekeeper)).status, 403);
  const gd = await call('POST', `/api/v1/sms/groups/${g.body.group.id}/debt`, accountant);
  assert.equal(gd.status, 200, JSON.stringify(gd.body)); assert.equal(gd.body.queued, 2);
  assert.equal((await call('POST', `/api/v1/sms/groups/${g.body.group.id}/debt`, manager)).status, 429);

  // 4. Matangazo ya chama: hakiki, tuma, kikomo cha mwezi
  const b0 = (await call('GET', '/api/v1/sms/broadcasts', manager)).body;
  assert.equal(b0.quota.enabled, true); assert.equal(b0.quota.used, 0);
  const body = { kind: 'MEETING', message: 'Kikao cha wanachama Jumamosi saa 4 asubuhi ofisini.', audience: { type: 'GROUP', groupId: g.body.group.id } };
  assert.equal((await call('POST', '/api/v1/sms/broadcasts', storekeeper, body)).status, 403);
  const pv = (await call('POST', '/api/v1/sms/broadcasts/preview', manager, body)).body;
  assert.equal(pv.withPhone, 2); assert.equal(pv.segments, 1); assert.match(pv.text, /KIKAO/);
  const sent = await call('POST', '/api/v1/sms/broadcasts', manager, body);
  assert.equal(sent.status, 201, JSON.stringify(sent.body)); assert.equal(sent.body.queued, 2);
  const b1 = (await call('GET', '/api/v1/sms/broadcasts', manager)).body;
  assert.equal(b1.quota.used, 2); assert.equal(b1.data[0].recipients, 2);
  const lim = (await call('GET', '/api/v1/owner/sms', owner)).body.limits;
  assert.equal((await call('PUT', '/api/v1/owner/sms/limits', owner, { ...lim, broadcastPerMonth: 3, confirmPassword: OWNER_PW })).status, 200);
  const over = await call('POST', '/api/v1/sms/broadcasts', manager, body);
  assert.equal(over.status, 400); assert.equal(over.body.error.code, 'SMS_QUOTA');
  assert.equal((await call('PUT', '/api/v1/owner/sms/limits', owner, { ...lim, confirmPassword: OWNER_PW })).status, 200);
  const st = (await call('GET', '/api/v1/owner/sms', owner)).body;
  assert.ok(st.kinds.find((k: any) => k.key === 'CHAMA_BROADCAST').month.queued + st.kinds.find((k: any) => k.key === 'CHAMA_BROADCAST').month.sent >= 2);
  assert.ok((await call('GET', '/api/v1/owner/sms/logs?kind=MEMBER_PHONE_OTP', owner)).body.data.length >= 1);
  assert.equal((await call('GET', '/api/v1/owner/sms', manager)).status, 403);
});

test('SMS: OTP ya kuingia (kifaa kinachoaminika) na umesahau nenosiri', async () => {
  const phone = uniqPhone('25571'), pw = 'SmsOwner2026';
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner SMS Test', ${phone}, 'SUPER_ADMIN', ${await hashPassword(pw)}, false)`);
  assert.equal((await call('POST', '/api/v1/auth/password/forgot', undefined, { phone })).status, 400, 'Huduma imezimwa');
  assert.equal((await call('GET', '/api/v1/public/status')).body.sms.passwordReset, false);
  try {
    assert.equal((await call('PUT', '/api/v1/owner/sms/events', owner, { events: { LOGIN_OTP: true, PASSWORD_RESET_OTP: true }, confirmPassword: OWNER_PW })).status, 200);
    const l1 = (await call('POST', '/api/v1/auth/login', undefined, { phone, password: pw })).body;
    assert.equal(l1.otpRequired, true); assert.ok(!l1.token); assert.match(l1.phoneMasked, /\*/);
    const code = lastCode(phone, /kuingia ni (\d{6})/);
    assert.equal((await call('POST', '/api/v1/auth/login/otp', undefined, { challenge: l1.challenge, code: code === '000000' ? '111111' : '000000' })).status, 400);
    const ok = (await call('POST', '/api/v1/auth/login/otp', undefined, { challenge: l1.challenge, code })).body;
    assert.ok(ok.token && ok.deviceToken);
    // Kifaa kinachoaminika: hakuna OTP tena
    const l2 = (await call('POST', '/api/v1/auth/login', undefined, { phone, password: pw, deviceToken: ok.deviceToken })).body;
    assert.ok(l2.token && !l2.otpRequired);
    // Umesahau nenosiri
    assert.equal((await call('GET', '/api/v1/public/status')).body.sms.passwordReset, true);
    const unknown = await call('POST', '/api/v1/auth/password/forgot', undefined, { phone: uniqPhone('25571') });
    assert.equal(unknown.status, 200, 'Jibu ni lilelile kwa namba isiyokuwepo');
    assert.equal((await call('POST', '/api/v1/auth/password/forgot', undefined, { phone })).status, 200);
    const rc = lastCode(phone, /nenosiri ni (\d{6})/);
    assert.equal((await call('POST', '/api/v1/auth/password/reset', undefined, { phone, code: rc, newPassword: pw })).status, 400, 'Lisifanane na la zamani');
    // Namba imeshatumika kwenye jaribio lililoshindwa? hapana — nenosiri hukaguliwa baada ya OTP, kwa hiyo tuma mpya
    await db.execute(sql`update otp_codes set created_at = created_at - interval '2 minutes' where purpose = 'PASSWORD_RESET'`);
    assert.equal((await call('POST', '/api/v1/auth/password/forgot', undefined, { phone })).status, 200);
    const rc2 = lastCode(phone, /nenosiri ni (\d{6})/);
    assert.equal((await call('POST', '/api/v1/auth/password/reset', undefined, { phone, code: rc2, newPassword: 'MpyaKabisa2026' })).status, 200);
    assert.equal((await call('GET', '/api/v1/auth/me', l2.token)).status, 401, 'Vikao vya zamani vimefungwa');
    const l3 = (await call('POST', '/api/v1/auth/login', undefined, { phone, password: 'MpyaKabisa2026', deviceToken: ok.deviceToken })).body;
    assert.equal(l3.otpRequired, true, 'Vifaa vinavyoaminika vimefutwa baada ya kubadilisha nenosiri');
  } finally {
    await call('PUT', '/api/v1/owner/sms/events', owner, { events: { LOGIN_OTP: false, PASSWORD_RESET_OTP: false }, confirmPassword: OWNER_PW });
  }
});

// v0.32 — Tovuti: ombi la maonyesho (bila kuingia), mtego wa roboti, na Owner analifuatilia
test('Tovuti: ombi la maonyesho linafika Business Center', async () => {
  assert.equal((await call('POST', '/api/v1/public/demo-request', undefined, { name: 'Ju', phone: '07', amcosName: 'X' })).status, 400);
  assert.equal((await call('POST', '/api/v1/public/demo-request', undefined, { name: 'Roboti', phone: '0712345678', amcosName: 'Spam AMCOS', website: 'http://spam' })).status, 400, 'Mtego wa roboti');
  const ok = await call('POST', '/api/v1/public/demo-request', undefined, { name: 'Juma Hassan', phone: '0712 345 678', amcosName: 'Usoke AMCOS ' + RUN, region: 'Urambo' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // v0.36: ombi linaingia kwenye CRM (leads) likiwa "Mpya", chanzo "Tovuti"
  const list = (await call('GET', '/api/v1/owner/leads?stage=NEW', owner)).body;
  const r = list.data.find((x: any) => x.amcosName === 'Usoke AMCOS ' + RUN);
  assert.ok(r); assert.equal(r.phone, '255712345678'); assert.equal(r.ip, undefined, 'IP haionyeshwi'); assert.equal(r.source, 'WEBSITE');
  assert.equal((await call('GET', '/api/v1/owner/leads', manager)).status, 403);
  const u = await call('PATCH', `/api/v1/owner/leads/${r.id}`, owner, { stage: 'CONTACTED' });
  assert.equal(u.status, 200); assert.equal(u.body.lead.stage, 'CONTACTED'); assert.equal(u.body.lead.status, 'CONTACTED', 'status ya zamani inafuata');
});

// v0.35 — Mipangilio: kila mtumishi anaona sehemu zake; ruhusa zinalindwa kwenye server, si kwa kuficha menu
test('Mipangilio: ruhusa kwa kila cheo, utambulisho ni wa Owner, kila badiliko kwenye audit', async () => {
  const m = (await call('GET', '/api/v1/settings', manager)).body;
  const a = (await call('GET', '/api/v1/settings', accountant)).body;
  const k = (await call('GET', '/api/v1/settings', storekeeper)).body;
  assert.equal(m.access.edit.profile, true); assert.equal(a.access.edit.profile, false); assert.equal(k.access.edit.profile, false);
  assert.equal(a.access.edit.finance, true); assert.equal(k.access.view.finance, false); assert.equal(k.finance, null, 'Storekeeper haoni fedha');
  assert.equal(k.access.edit.stock, true); assert.equal(k.access.view.sms, false); assert.equal(k.sms, null);
  assert.equal(a.access.edit.docs, true); assert.equal(k.access.edit.docs, false);
  assert.ok(m.profile.completeness.pct >= 0 && m.profile.completeness.missing.length > 0);

  // Profaili: Meneja tu; jina/namba ya usajili ni za Owner (hata kupitia /amcos/:id)
  assert.equal((await call('PUT', '/api/v1/settings/profile', accountant, { region: 'Tabora' })).status, 403, 'Mhasibu hawezi');
  assert.equal((await call('PUT', '/api/v1/settings/profile', manager, { name: 'Jina Jipya AMCOS' })).status, 403, 'Meneja habadilishi jina');
  assert.equal((await call('PATCH', `/api/v1/amcos/${amcosId}`, manager, { name: 'Jina Jipya AMCOS' })).status, 403, 'Hata kupitia njia ya zamani');
  assert.equal((await call('PUT', '/api/v1/settings/profile', manager, { name: m.profile.name, region: 'Tabora' })).status, 200, 'Jina lile lile linakubalika');
  assert.equal((await call('PUT', '/api/v1/settings/profile', manager, { tin: '12' })).status, 400, 'TIN si sahihi');
  assert.equal((await call('PUT', '/api/v1/settings/profile', manager, { leaders: [{ role: 'CHAIR', name: 'Ali Juma' }, { role: 'CHAIR', name: 'Juma Ali' }] })).status, 400, 'Nafasi moja mara mbili');
  const p = await call('PUT', '/api/v1/settings/profile', manager, {
    district: 'Urambo', postalAddress: 'S.L.P 149 Urambo', phone: '0712 000 111', tin: '123-456-789', regDate: '2010-05-04',
    leaders: [{ role: 'CHAIR', name: 'Ali Juma Hamisi', phone: '0754000111' }, { role: 'SECRETARY', name: 'Neema Paulo', phone: '' }],
  });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const m2 = (await call('GET', '/api/v1/settings', manager)).body;
  assert.equal(m2.profile.phone, '255712000111'); assert.equal(m2.profile.leaders[0].phone, '255754000111'); assert.equal(m2.profile.leaders[1].phone, null);
  assert.ok(m2.profile.completeness.pct > m.profile.completeness.pct);

  // Fedha: akaunti kuu iwe ya benki ya chama hiki; Meneja hawezi
  const accs = (await call('GET', '/api/v1/finance/accounts', accountant)).body.data;
  const bankAcc = accs.find((x: any) => x.kind === 'BANK'); const cashAcc = accs.find((x: any) => x.kind === 'CASH');
  assert.equal((await call('PUT', '/api/v1/settings/finance', manager, { mainAccountId: bankAcc.id })).status, 403);
  assert.equal((await call('PUT', '/api/v1/settings/finance', accountant, { mainAccountId: cashAcc.id })).status, 400, 'Si benki');
  assert.equal((await call('PUT', '/api/v1/settings/finance', accountant, { mainAccountId: bankAcc.id })).status, 200);

  // Nyaraka: Mhasibu anaweza; nembo lazima iwe picha salama (si SVG); benki inaonekana kwenye /auth/me ikiruhusiwa
  assert.equal((await call('PUT', '/api/v1/settings/docs', storekeeper, { footer: 'x' })).status, 403);
  assert.equal((await call('PUT', '/api/v1/settings/docs', accountant, { logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400, 'SVG hairuhusiwi');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await call('PUT', '/api/v1/settings/docs', accountant, { footer: 'Asante kwa ushirikiano', showBank: true, logo: png })).status, 200);
  const me = (await call('GET', '/api/v1/auth/me', storekeeper)).body;
  assert.equal(me.amcos.docFooter, 'Asante kwa ushirikiano'); assert.equal(me.amcos.logo, png); assert.equal(me.amcos.mainBank.accountNumber, bankAcc.accountNumber);

  // Stoo: Storekeeper anaweka kiwango kupitia endpoint iliyopo; Mhasibu hawezi
  const item = k.stock.items[0];
  if (item) {
    assert.equal((await call('PATCH', `/api/v1/inputs/items/${item.id}`, accountant, { reorderLevel: '5' })).status, 403);
    assert.equal((await call('PATCH', `/api/v1/inputs/items/${item.id}`, storekeeper, { reorderLevel: '100000' })).status, 200);
    const k2 = (await call('GET', '/api/v1/settings', storekeeper)).body;
    assert.equal(k2.stock.items.find((x: any) => x.id === item.id).low, true, 'Stock ndogo');
  }

  // Audit: nembo haiwekwi yote; mabadiliko ya karibuni yanaonekana
  const logs = (await call('GET', '/api/v1/settings', manager)).body.recent;
  for (const act of ['AMCOS_PROFILE_UPDATE', 'AMCOS_MAIN_ACCOUNT_SET', 'AMCOS_DOCS_UPDATE']) assert.ok(logs.some((l: any) => l.action === act), act);
  const al = await call('GET', `/api/v1/audit-logs?action=AMCOS_DOCS_UPDATE&amcosId=${amcosId}`, owner);
  assert.equal(al.status, 200, JSON.stringify(al.body));
  const audit = al.body.data[0];
  assert.ok(audit && /nembo/.test(JSON.stringify(audit.after)) && !JSON.stringify(audit.after).includes('base64'), 'Picha haiwekwi kwenye audit');
});

// v0.26 — LAZIMA liwe la mwisho: linafuta data yote ya chama cha majaribio -----------------------------
test('Chama cha mafunzo: Owner pekee anafuta data yote, watumishi wanabaki, namba zinaanza upya, kinga zinabaki', async () => {
  const path = `/api/v1/owner/amcos/${amcosId}`;
  const code = (await call('GET', path, owner)).body.amcos.code;
  assert.equal((await call('POST', `${path}/training-reset`, owner, { confirmAmcosCode: code, confirmPassword: OWNER_PW })).status, 409, 'Si chama cha mafunzo');
  assert.equal((await call('PUT', `${path}/training`, manager, { training: true, confirmPassword: 'Staff12345' })).status, 403, 'Meneja hawezi');
  assert.equal((await call('PUT', `${path}/training`, owner, { training: true, confirmPassword: OWNER_PW })).status, 200);
  const pv = (await call('GET', `${path}/training-reset`, owner)).body;
  assert.ok(pv.total > 100); assert.equal(pv.staffKept, 3);
  assert.ok(pv.groups.find((g: any) => g.label === 'Wakulima').count > 5);
  const bk = await call('GET', `${path}/training-reset/backup`, owner);
  assert.equal(bk.status, 200); assert.ok(bk.body.tables.members.length > 5 && bk.body.tables.member_ledger_entries.length > 5);
  assert.equal((await call('POST', `${path}/training-reset`, owner, { confirmAmcosCode: 'XXX', confirmPassword: OWNER_PW })).status, 400, 'Code ya chama si sahihi');
  assert.equal((await call('POST', `${path}/training-reset`, owner, { confirmAmcosCode: code, confirmPassword: 'kosa-kosa' })).status, 403, 'Nenosiri si sahihi');
  const r = await call('POST', `${path}/training-reset`, owner, { confirmAmcosCode: code.toLowerCase(), confirmPassword: OWNER_PW });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.total > 100);
  // Watumishi wanaingia kama kawaida; data yote imeondoka
  assert.equal((await call('GET', '/api/v1/members?pageSize=5', manager)).body.data.length, 0);
  assert.equal((await call('GET', '/api/v1/finance/accounts', accountant)).body.data.length, 0);
  assert.equal((await call('GET', '/api/v1/approvals?pageSize=5', manager)).body.data.length, 0);
  assert.equal((await call('GET', '/api/v1/inputs/items', storekeeper)).body.data.length, 0);
  assert.equal((await call('GET', '/api/v1/sales/grade-prices', accountant)).body.count, 0);
  const chart = (await call('GET', '/api/v1/accounting/chart', accountant)).body.data;
  assert.ok(chart.length >= 40 && chart.every((g: any) => g.code !== '1101'), 'Chati ya mfumo inabaki, akaunti za mafunzo zimeondoka');
  // Namba zinaanza upya
  const m = await call('POST', '/api/v1/members', storekeeper, { firstName: 'Mpya', lastName: 'Kabisa', gender: 'MALE' });
  assert.equal(m.status, 201, JSON.stringify(m.body)); assert.match(m.body.member.memberNo, /-000001$/);
  // Chama si cha mafunzo tena; hakiwezi kurudishwa
  const after = (await call('GET', path, owner)).body.amcos;
  assert.equal(after.training, false); assert.ok(after.trainingResetAt);
  assert.equal((await call('PUT', `${path}/training`, owner, { training: true, confirmPassword: OWNER_PW })).status, 409);
  // Kinga za database zinabaki nje ya operesheni hii
  const why = (e: any) => String(e?.cause?.message ?? e?.message);
  await assert.rejects(db.execute(sql`delete from audit_logs where id = (select id from audit_logs limit 1)`), (e) => /IMMUTABLE_RECORD/.test(why(e)));
  await assert.rejects(db.execute(sql`delete from approval_requests where id = (select id from approval_requests limit 1)`), (e) => /haliwezi kufutwa/.test(why(e)));
});
