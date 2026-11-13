// v0.36 — Timu ya CoopLink: Finance Manager na Huduma kwa Wateja na Masoko.
// Ruhusa zinakaguliwa kwenye server; pesa zinahitaji mtu wa pili; msaada wa akaunti hauoni nenosiri.
process.env.SMS_DRY_RUN = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { clearFeeLock } from '../src/lib/fees';
import { today, addDays } from '../src/lib/subscriptions';
import { dryOutbox } from '../src/lib/sms';

/** Nenosiri la muda kutoka SMS ya majaribio (DRY) — Owner haoni nenosiri SMS ikitumwa */
const smsPassword = (phone: string) => {
  const m = [...dryOutbox].reverse().find((x) => x.phone === phone && /Nenosiri la muda: /.test(x.text));
  return m ? /Nenosiri la muda: (\S+)/.exec(m.text)![1] : null;
};

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7);
const OWNER_PW = 'OwnerPass2026';

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body: json };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body;
async function staff(role: string) {
  const phone = uniqPhone('25568');
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: `${role} ${RUN}`, phone, role });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal(c.body.delivery.status, 'SENT'); assert.equal(c.body.temporaryPassword, null, 'Owner haoni nenosiri');
  const pw = smsPassword(phone)!;
  const t = (await login(phone, pw)).token;
  return { id: c.body.staff.id as string, phone, token: (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: pw, newPassword: 'Staff12345x' })).body.token as string };
}

let owner: string, fin: { id: string; phone: string; token: string }, cs: { id: string; phone: string; token: string };
let amcosId: string, managerId: string, managerToken: string, feeId: string;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner Desks', ${phone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false)`);
  owner = (await login(phone, OWNER_PW)).token;
  fin = await staff('FINANCE_MANAGER');
  cs = await staff('CUSTOMER_SUPPORT');
  const mPhone = uniqPhone('25576');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Desk ${RUN} AMCOS`, activate: true, manager: { fullName: `Meneja Desk ${RUN}`, phone: mPhone, email: `desk.${RUN.toLowerCase()}@example.com`, password: 'Meneja#2026x' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  amcosId = reg.body.amcos.id;
  const ml = await login(mPhone, 'Meneja#2026x');
  managerToken = ml.token; managerId = ml.user.id;
  assert.ok(managerToken);
});

after(async () => { server.close(); await pool.end(); });

test('Vyeo: Finance na Huduma kwa Wateja wanaona kazi zao tu', async () => {
  assert.equal((await call('GET', '/api/v1/owner/finance/overview', fin.token)).status, 200);
  assert.equal((await call('GET', '/api/v1/owner/leads', fin.token)).status, 403, 'Fedha haoni leads');
  assert.equal((await call('POST', '/api/v1/owner/comms/announcements', fin.token, {})).status, 403);
  assert.equal((await call('GET', '/api/v1/owner/finance/overview', cs.token)).status, 403, 'Huduma haoni fedha');
  assert.equal((await call('GET', '/api/v1/owner/finance/receivables', cs.token)).status, 403);
  assert.equal((await call('GET', '/api/v1/owner/leads/summary', cs.token)).status, 200);
  assert.equal((await call('GET', '/api/v1/owner/system/health', cs.token)).status, 403, 'Tech ni ya Owner');
  assert.equal((await call('GET', '/api/v1/members', cs.token)).status, 403, 'Hakuna data za ndani za vyama');
  const perms = (await call('GET', '/api/v1/owner/staff/permissions', owner)).body;
  assert.deepEqual(perms.roles, ['FINANCE_MANAGER', 'CUSTOMER_SUPPORT']);
});

test('Matumizi: mfanyakazi anarekodi, mtu wa pili anaidhinisha; ripoti inahesabu yaliyoidhinishwa tu', async () => {
  const before = Number((await call('GET', `/api/v1/owner/finance/report?from=${today()}&to=${today()}`, owner)).body.expenses.total);
  const e = await call('POST', '/api/v1/owner/finance/expenses', fin.token, { category: 'SMS', amount: '35000', description: `SMS bundle ${RUN}`, spentAt: today(), method: 'MOBILE_MONEY', reference: `RF${RUN}` });
  assert.equal(e.status, 201); assert.equal(e.body.expense.status, 'PENDING');
  assert.equal(Number((await call('GET', `/api/v1/owner/finance/report?from=${today()}&to=${today()}`, owner)).body.expenses.total), before, 'yanayosubiri hayahesabiwi');
  assert.equal((await call('POST', `/api/v1/owner/finance/expenses/${e.body.expense.id}/decision`, fin.token, { approve: true })).status, 403, 'hajiidhinishii');
  assert.equal((await call('POST', `/api/v1/owner/finance/expenses/${e.body.expense.id}/decision`, owner, { approve: false })).status, 400, 'sababu ya kukataa');
  const ok = await call('POST', `/api/v1/owner/finance/expenses/${e.body.expense.id}/decision`, owner, { approve: true });
  assert.equal(ok.status, 200); assert.equal(ok.body.expense.status, 'APPROVED');
  assert.equal(Number((await call('GET', `/api/v1/owner/finance/report?from=${today()}&to=${today()}`, owner)).body.expenses.total), before + 35000);
  assert.equal((await call('POST', `/api/v1/owner/finance/expenses/${e.body.expense.id}/decision`, owner, { approve: true })).status, 409);
  const o = await call('POST', '/api/v1/owner/finance/expenses', owner, { category: 'OFFICE', amount: '1000', description: 'Kalamu', spentAt: today() });
  assert.equal(o.body.expense.status, 'APPROVED', 'ya Owner yanaingia moja kwa moja');
  assert.equal((await call('POST', '/api/v1/owner/finance/expenses', fin.token, { category: 'OFFICE', amount: '1000', description: 'Baadaye', spentAt: addDays(today(), 3) })).status, 400);
  const list = (await call('GET', '/api/v1/owner/finance/expenses?status=APPROVED', fin.token)).body.data.find((x: any) => x.id === e.body.expense.id);
  assert.ok(list.recordedBy && list.approvedBy, 'nani alirekodi na nani aliidhinisha');
});

test('Bajeti: matumizi halisi dhidi ya bajeti ya mwezi', async () => {
  const month = today().slice(0, 7);
  assert.equal((await call('PUT', '/api/v1/owner/finance/budgets', cs.token, { month, items: [{ category: 'SMS', amount: '1' }] })).status, 403);
  assert.equal((await call('PUT', '/api/v1/owner/finance/budgets', fin.token, { month, items: [{ category: 'SMS', amount: '1' }, { category: 'SMS', amount: '2' }] })).status, 400);
  const b = await call('PUT', '/api/v1/owner/finance/budgets', fin.token, { month, items: [{ category: 'SMS', amount: '500000' }, { category: 'SERVER', amount: '200000' }] });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const sms = b.body.items.find((i: any) => i.category === 'SMS');
  assert.equal(Number(sms.budget), 500000); assert.ok(Number(sms.actual) >= 35000); assert.ok(sms.used > 0);
});

test('Madeni ya ada: umri wa deni, vikumbusho (mara 1 kwa saa 24), taarifa ya mteja', async () => {
  const [f] = (await db.execute<{ id: string }>(sql`insert into platform_fees (amcos_id, kind, label, amount, due_date, status)
    values (${amcosId}, 'SEASON', ${'Ada ya msimu TEST ' + RUN}, 100000, ${addDays(today(), -40)}, 'UNPAID') returning id`)).rows;
  feeId = f.id; clearFeeLock();
  const r = await call('GET', '/api/v1/owner/finance/receivables?bucket=OVERDUE', fin.token);
  assert.equal(r.status, 200);
  const row = r.body.data.find((x: any) => x.id === feeId);
  assert.ok(row); assert.equal(row.bucket, 'D31_60'); assert.equal(Number(row.balance), 100000); assert.equal(row.days_overdue, 40);
  const m1 = await call('POST', '/api/v1/owner/finance/receivables/remind', fin.token, { feeIds: [feeId] });
  assert.equal(m1.status, 201, JSON.stringify(m1.body)); assert.equal(m1.body.targets, 1);
  const m2 = await call('POST', '/api/v1/owner/finance/receivables/remind', fin.token, { feeIds: [feeId] });
  assert.equal(m2.body.targets, 0); assert.equal(m2.body.skipped.length, 1, 'hakisumbuliwi tena ndani ya saa 24');
  assert.equal((await call('POST', '/api/v1/owner/finance/receivables/remind', cs.token, { feeIds: [feeId] })).status, 403);
  const st = await call('GET', `/api/v1/owner/finance/statement/${amcosId}`, fin.token);
  assert.equal(st.status, 200); assert.ok(Number(st.body.totals.balance) >= 100000);
  const csv = await call('GET', `/api/v1/owner/finance/statement/${amcosId}/csv`, fin.token);
  assert.equal(csv.status, 200); assert.match(String(csv.body), /TAARIFA YA MTEJA/);
  const ov = (await call('GET', '/api/v1/owner/finance/overview', fin.token)).body;
  assert.ok(Number(ov.receivables.overdue) >= 100000); assert.ok(ov.queue.payments.canAct <= ov.queue.payments.n);
});

test('Leads (CRM): hatua, historia, kurudiwa, kupotea kwa sababu, na kugeuka mteja', async () => {
  const phone = uniqPhone('25571');
  const c = await call('POST', '/api/v1/owner/leads', cs.token, { name: 'Halima Said', phone: '0' + phone.slice(3), amcosName: `Lead ${RUN} AMCOS`, region: 'Tabora', source: 'FIELD_VISIT', members: 450 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.lead.id;
  assert.equal(c.body.lead.assignedToId, cs.id, 'aliyeongeza ndiye mhusika');
  assert.equal((await call('POST', '/api/v1/owner/leads', cs.token, { name: 'Halima Said', phone, amcosName: 'Nakala AMCOS' })).status, 409, 'namba moja haifuatiliwi mara mbili');
  assert.equal((await call('POST', `/api/v1/owner/leads/${id}/activities`, cs.token, { kind: 'CALL', body: 'Amependa, demo wiki ijayo', nextFollowUpAt: new Date(Date.now() + 864e5).toISOString() })).status, 201);
  let d = (await call('GET', `/api/v1/owner/leads/${id}`, cs.token)).body;
  assert.equal(d.lead.stage, 'CONTACTED', 'simu ya kwanza inaisogeza lead');
  assert.ok(d.activities.some((a: any) => a.kind === 'STAGE'));
  assert.equal((await call('PATCH', `/api/v1/owner/leads/${id}`, cs.token, { stage: 'LOST' })).status, 400, 'sababu inahitajika');
  assert.equal((await call('PATCH', `/api/v1/owner/leads/${id}`, cs.token, { stage: 'WON' })).status, 400, 'mteja ni kwa kusajili chama');
  assert.equal((await call('PATCH', `/api/v1/owner/leads/${id}`, cs.token, { assignedToId: fin.id })).status, 400, 'Fedha hana leads');
  assert.equal((await call('PATCH', `/api/v1/owner/leads/${id}`, cs.token, { stage: 'DEMO_DONE' })).status, 200);
  const sms = await call('POST', `/api/v1/owner/leads/${id}/sms`, cs.token, { body: 'Asante kwa muda wako leo. Karibu CoopLink!' });
  assert.ok([201, 400].includes(sms.status), JSON.stringify(sms.body));
  const w = await call('POST', `/api/v1/owner/leads/${id}/convert`, cs.token, { amcosId });
  assert.equal(w.status, 200); assert.equal(w.body.lead.stage, 'WON'); assert.equal(w.body.lead.status, 'CLOSED');
  assert.equal((await call('PATCH', `/api/v1/owner/leads/${id}`, cs.token, { stage: 'NEW' })).status, 409);
  const s = (await call('GET', '/api/v1/owner/leads/summary', cs.token)).body;
  assert.ok(s.won90 >= 1 && s.conversion90 !== null);
  const prof = (await call('GET', `/api/v1/owner/customers/${amcosId}/profile`, cs.token)).body;
  assert.equal(prof.lead.id, id, 'historia ya mteja inaonyesha alikotoka');
  assert.equal(prof.can.help, true);
});

test('Msaada wa akaunti: bila kuona nenosiri; kutoka vifaa vyote; sababu lazima', async () => {
  const dg = await call('GET', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/diagnostics`, cs.token);
  assert.equal(dg.status, 200);
  assert.match(dg.body.user.phone, /••••/, 'simu imefichwa sehemu');
  assert.ok(!('passwordHash' in dg.body.user) && !JSON.stringify(dg.body).includes('password_hash'));
  assert.ok(dg.body.sessions >= 1);
  assert.equal((await call('GET', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/diagnostics`, fin.token)).status, 403, 'Fedha hana msaada wa akaunti');
  assert.equal((await call('POST', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/signout`, cs.token, { reason: 'x' })).status, 400);
  const so = await call('POST', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/signout`, cs.token, { reason: 'Simu ya Meneja imepotea', ticketNo: 1001 });
  assert.equal(so.status, 200); assert.ok(so.body.sessions >= 1);
  assert.equal((await call('GET', '/api/v1/auth/me', managerToken)).status, 401, 'ametoka kwenye vifaa vyote');
  const rg = await call('POST', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/reset-guide`, cs.token, { reason: 'Amesahau nenosiri' });
  assert.ok([200, 400].includes(rg.status), JSON.stringify(rg.body));
  const after = (await call('GET', `/api/v1/owner/customers/${amcosId}/staff/${managerId}/diagnostics`, cs.token)).body;
  assert.ok(after.history.some((h: any) => h.action === 'ACCOUNT_HELP_SIGNOUT'));
});

test('Wateja: maelezo ya timu, makundi ya kulenga na afya', async () => {
  const n = await call('POST', `/api/v1/owner/customers/${amcosId}/notes`, cs.token, { body: 'Meneja anapendelea kupigiwa simu jioni.' });
  assert.equal(n.status, 201);
  const notes = (await call('GET', `/api/v1/owner/customers/${amcosId}/notes`, fin.token)).body.data;
  assert.ok(notes.some((x: any) => x.id === n.body.note.id && !x.mine));
  assert.equal((await call('PATCH', `/api/v1/owner/customers/${amcosId}/notes/${n.body.note.id}/pin`, fin.token, { pinned: true })).status, 403);
  assert.equal((await call('PATCH', `/api/v1/owner/customers/${amcosId}/notes/${n.body.note.id}/pin`, cs.token, { pinned: true })).status, 200);
  const seg = (await call('GET', '/api/v1/owner/customers/segments', cs.token)).body.data;
  assert.ok(seg.find((x: any) => x.key === 'FEES_OVERDUE').count >= 1);
  const a = await call('POST', '/api/v1/owner/comms/announcements', cs.token, { kind: 'ANNOUNCEMENT', title: 'Ada ya msimu', body: 'Tafadhali lipa ada yako.', audience: 'SEGMENT', segment: 'FEES_OVERDUE', channels: ['IN_APP'] });
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.ok(a.body.targets >= 1);
  const h = await call('GET', '/api/v1/owner/customers/health', cs.token);
  assert.equal(h.status, 200); assert.ok(Array.isArray(h.body.onboarding));
  await db.execute(sql`update platform_fees set status = 'WAIVED', waived_reason = 'Mtihani' where id = ${feeId}`); clearFeeLock();
});

test('Usajili wa wafanyakazi: nenosiri la muda kwa SMS, halihifadhiwi kwenye kumbukumbu, linaisha muda', async () => {
  const phone = uniqPhone('25567');
  assert.equal((await call('POST', '/api/v1/owner/staff', owner, { fullName: 'Nakala', phone: fin.phone, role: 'FINANCE_MANAGER' })).status, 409, 'namba moja, akaunti moja');
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: `Aisha Mussa ${RUN}`, phone, role: 'CUSTOMER_SUPPORT', jobTitle: 'Afisa Mauzo' });
  assert.equal(c.status, 201); assert.equal(c.body.temporaryPassword, null); assert.match(c.body.delivery.phone, /•••/);
  const pw = smsPassword(phone)!;
  assert.ok(pw && pw.length >= 8);
  const [log] = (await db.execute<{ message: string }>(sql`select message from sms_logs where phone = ${phone} and kind = 'STAFF_CREDENTIALS' order by created_at desc limit 1`)).rows;
  assert.ok(log && !log.message.includes(pw) && log.message.includes('••••'), 'nenosiri halihifadhiwi kwenye kumbukumbu');
  // Muda ukiisha, haingii; Owner anamtumia jipya
  await db.execute(sql`update users set temp_password_expires_at = now() - interval '1 minute' where phone = ${phone}`);
  const ex = await call('POST', '/api/v1/auth/login', undefined, { phone, password: pw });
  assert.equal(ex.status, 403); assert.equal(ex.body.error.code, 'TEMP_PASSWORD_EXPIRED');
  const r = await call('POST', `/api/v1/owner/staff/${c.body.staff.id}/reset-password`, owner, {});
  assert.equal(r.status, 200); assert.equal(r.body.temporaryPassword, null);
  const pw2 = smsPassword(phone)!;
  assert.notEqual(pw2, pw);
  const t = await login(phone, pw2);
  assert.ok(t.token); assert.equal(t.user.mustChangePassword, true);
  const ch = await call('POST', '/api/v1/auth/change-password', t.token, { currentPassword: pw2, newPassword: 'Aisha2026xy' });
  assert.equal(ch.status, 200);
  const [u] = (await db.execute<{ e: string | null }>(sql`select temp_password_expires_at as e from users where phone = ${phone}`)).rows;
  assert.equal(u.e, null, 'muda unaondoka akibadilisha');
  assert.equal((await call('POST', `/api/v1/owner/staff/${c.body.staff.id}/reset-password`, cs.token, {})).status, 403, 'Owner pekee');
});

test('Watumishi wa chama: Meneja bila nenosiri la Owner anatumiwa nenosiri la muda kwa SMS', async () => {
  const mPhone = uniqPhone('25578');
  const r = await call('POST', '/api/v1/owner/amcos', owner, { name: `Sms ${RUN} AMCOS`, activate: true, manager: { fullName: `Meneja Sms ${RUN}`, phone: mPhone } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.managerDelivery.status, 'SENT'); assert.equal(r.body.managerTemporaryPassword, null);
  const pw = smsPassword(mPhone)!;
  const t = await login(mPhone, pw);
  assert.ok(t.token); assert.equal(t.user.mustChangePassword, true);
  // Owner akiomba nenosiri jipya, linaenda kwa SMS
  const rs = await call('POST', `/api/v1/owner/amcos/${r.body.amcos.id}/staff/${t.user.id}/reset-password`, owner, {});
  assert.equal(rs.status, 200); assert.equal(rs.body.temporaryPassword, null);
  assert.notEqual(smsPassword(mPhone), pw);
});
