// Majaribio ya Owner Control Panel dhidi ya database halisi.
// Inahitaji: npm run db:migrate && SEED_DEMO=true npm run db:seed (watumiaji wa demo)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { totpCode } from '../src/lib/totp';
import { clearSettingsCache } from '../src/lib/settings';
import { runSubscriptionSweep, today, addDays } from '../src/lib/subscriptions';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7);
const OWNER_PW = 'OwnerPass2026';

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* csv / json download */ }
  return { status: r.status, body: json, headers: r.headers };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body;

let owner: string, ownerId: string, ownerPhone: string, katibu: string;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerPhone = uniqPhone('25569');
  const r = await db.execute<{ id: string }>(sql`insert into users (full_name, phone, role, password_hash, must_change_password)
    values ('Owner Test', ${ownerPhone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false) returning id`);
  ownerId = r.rows[0].id;
  owner = (await login(ownerPhone, OWNER_PW)).token;
  katibu = (await login('0711000001', 'Demo12345')).token;
  assert.ok(owner && katibu);
});

after(async () => {
  await db.execute(sql`delete from platform_settings where key in ('maintenance')`);
  server.close();
  await pool.end();
});

test('RBAC: AMCOS admin hawezi kufikia Owner panel', async () => {
  for (const p of ['/dashboard', '/amcos', '/finance/report', '/staff', '/system/health', '/security/audit']) {
    assert.equal((await call('GET', `/api/v1/owner${p}`, katibu)).status, 403, p);
  }
  assert.equal((await call('GET', '/api/v1/owner/dashboard')).status, 401);
});

let finToken: string, finId: string;
test('Staff: Finance Manager — ruhusa zake tu, na hana access ya data za vyama', async () => {
  const phone = uniqPhone('25568');
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: 'Fatma Fedha', phone, role: 'FINANCE_MANAGER', jobTitle: 'Mhasibu Mkuu' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  finId = c.body.staff.id;
  assert.ok(c.body.staff.permissions.includes('finance.manage'));
  assert.ok(!c.body.staff.permissions.includes('staff.manage'));
  const t = await login(phone, c.body.temporaryPassword);
  finToken = (await call('POST', '/api/v1/auth/change-password', t.token, { currentPassword: c.body.temporaryPassword, newPassword: 'Fedha2026x' })).body.token;
  assert.equal((await call('GET', '/api/v1/owner/finance/report', finToken)).status, 200);
  assert.equal((await call('GET', '/api/v1/owner/dashboard', finToken)).status, 200);
  assert.equal((await call('GET', '/api/v1/owner/staff', finToken)).status, 403);
  assert.equal((await call('GET', '/api/v1/owner/system/health', finToken)).status, 403);
  assert.equal((await call('GET', '/api/v1/members', finToken)).status, 403, 'hana data za vyama');
  assert.equal((await call('GET', '/api/v1/seasons', finToken)).status, 403);
  // Hata Owner hawezi kumpa mfanyakazi staff.manage
  const p = await call('PATCH', `/api/v1/owner/staff/${finId}`, owner, { permissions: ['finance.read', 'staff.manage'] });
  assert.deepEqual(p.body.staff.permissions, ['finance.read']);
  // Mabadiliko ya ruhusa yanaua vikao vya zamani
  assert.equal((await call('GET', '/api/v1/owner/finance/report', finToken)).status, 401);
  await call('PATCH', `/api/v1/owner/staff/${finId}`, owner, { permissions: null });
  finToken = (await login(phone, 'Fedha2026x')).token;
  // /users ya chama haiwezi kuunda wafanyakazi wa jukwaa
  assert.equal((await call('POST', '/api/v1/users', owner, { fullName: 'X Y Z', phone: uniqPhone('25567'), role: 'TECH_SUPPORT' })).status, 400);
});

let planId: string, amcosId: string, subId: string, clerkPhone: string;
test('AMCOS: usajili PENDING -> idhini + trial; mipango; assign', async () => {
  const plan = await call('POST', '/api/v1/owner/subscriptions/plans', owner, {
    name: 'Msingi ' + RUN, code: 'BASIC' + RUN, monthlyPrice: '50000', annualPrice: '500000', trialDays: 14, graceDays: 7, features: ['Wanachama', 'Pembejeo'],
  });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  planId = plan.body.plan.id;

  const a = await call('POST', '/api/v1/owner/amcos', finToken, { name: 'AMCOS Mpya', code: 'N' + RUN });
  assert.equal(a.status, 403, 'Finance hana amcos.create');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: 'AMCOS ya Ulyankulu', code: 'U' + RUN, region: 'Tabora', district: 'Kaliua', contactName: 'Katibu Juma', contactPhone: '0755000111' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.amcos.status, 'PENDING');
  assert.equal(reg.body.amcos.isActive, false);
  amcosId = reg.body.amcos.id;

  // Mtumiaji wa chama kinachosubiri hawezi kuingia
  clerkPhone = uniqPhone('25566');
  await db.execute(sql`insert into users (full_name, phone, role, amcos_id, password_hash, must_change_password) values ('Katibu Mpya', ${clerkPhone}, 'AMCOS_ADMIN', ${amcosId}, ${await hashPassword('Katibu2026')}, false)`);
  const blocked = await call('POST', '/api/v1/auth/login', undefined, { phone: clerkPhone, password: 'Katibu2026' });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'AMCOS_SUSPENDED');

  const ap = await call('POST', `/api/v1/owner/amcos/${amcosId}/approve`, owner, { trialPlanId: planId });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.amcos.status, 'ACTIVE');
  assert.ok((await login(clerkPhone, 'Katibu2026')).token, 'sasa anaingia');

  const det = await call('GET', `/api/v1/owner/amcos/${amcosId}`, owner);
  assert.equal(det.body.subscriptions[0].status, 'TRIAL');
  assert.equal(det.body.subscriptions[0].end_date, addDays(today(), 14));
  assert.equal(det.body.admins.length, 1);

  const as = await call('POST', '/api/v1/owner/subscriptions/assign', owner, { amcosId, planId, cycle: 'MONTHLY', discountPercent: '10' });
  assert.equal(as.status, 201, JSON.stringify(as.body));
  subId = as.body.subscription.id;
  assert.equal(as.body.subscription.price, '45000.00', 'punguzo la 10%');
  assert.equal(as.body.subscription.endDate, today(), 'haijalipwa bado');
  const list = await call('GET', '/api/v1/owner/subscriptions?status=UNPAID', owner);
  assert.ok(list.body.data.some((s: any) => s.id === subId));
  // Mpango uliotumiwa haufutwi
  const del = await call('DELETE', `/api/v1/owner/subscriptions/plans/${planId}`, owner, { confirmPassword: OWNER_PW });
  assert.equal(del.status, 409);
});

test('Malipo: PENDING -> uthibitisho (nenosiri) -> subscription inasogea; hakuna nakala mbili', async () => {
  const ref = 'MP' + RUN + 'A1';
  const p = await call('POST', '/api/v1/owner/finance/payments', finToken, {
    subscriptionId: subId, category: 'SUBSCRIPTION', amount: '45000', method: 'MOBILE_MONEY', providerRef: ref, paidAt: today(), periods: 2,
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.payment.status, 'PENDING', 'haijawa SUCCESS yenyewe');
  assert.match(p.body.payment.invoiceNo, /^CL-INV-\d{6}$/);
  const dup = await call('POST', '/api/v1/owner/finance/payments', finToken, { subscriptionId: subId, category: 'SUBSCRIPTION', amount: '45000', method: 'MOBILE_MONEY', providerRef: ref, paidAt: today() });
  assert.equal(dup.status, 409);

  const noPw = await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, owner, {});
  assert.equal(noPw.body.error.code, 'REAUTH_REQUIRED');
  const badPw = await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, owner, { confirmPassword: 'wrong' });
  assert.equal(badPw.body.error.code, 'REAUTH_FAILED');
  // v0.36 maker-checker: aliyerekodi hathibitishi mwenyewe
  const self = await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, finToken, { confirmPassword: 'Fedha2026x' });
  assert.equal(self.status, 403, 'mtu wa pili athibitishe');
  const v = await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, owner, { confirmPassword: OWNER_PW });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.payment.status, 'VERIFIED');
  const expected = (() => { const d = new Date(`${today()}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 2); return d.toISOString().slice(0, 10); })();
  assert.equal(v.body.extension.to, expected, 'miezi 2 imeongezwa');
  assert.equal(v.body.extension.status, 'ACTIVE');
  assert.equal((await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, owner, { confirmPassword: OWNER_PW })).status, 409);

  await call('POST', '/api/v1/owner/finance/expenses', finToken, { category: 'SERVER', amount: '20000', description: 'Railway', spentAt: today() });
  const rep = await call('GET', `/api/v1/owner/finance/report?from=${today()}&to=${today()}`, owner);
  const [{ v: verified }] = (await db.execute<{ v: string }>(sql`select coalesce(sum(amount),0)::text as v from platform_payments where status='VERIFIED' and paid_at >= ${new Date(`${today()}T00:00:00+03:00`)} and paid_at < ${new Date(`${addDays(today(), 1)}T00:00:00+03:00`)}`)).rows;
  assert.equal(Number(rep.body.revenue.total), Number(verified), 'ripoti = database');
  const csv = await call('GET', `/api/v1/owner/finance/export.csv?from=${today()}&to=${today()}`, owner);
  assert.equal(csv.status, 200);
  assert.match(String(csv.body), /RIPOTI YA FEDHA/);
  // Fedha za kampuni hazigusi ledger ya wanachama
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from member_ledger_entries where amcos_id = ${amcosId}`)).rows;
  assert.equal(n, 0);
});

test('Subscription ikiisha + grace: chama kinasitishwa; malipo yakithibitishwa kinarudi', async () => {
  await db.execute(sql`update subscriptions set end_date = ${addDays(today(), -30)} where id = ${subId}`);
  const sweep = await runSubscriptionSweep();
  assert.ok(sweep.suspended >= 1);
  const det = await call('GET', `/api/v1/owner/amcos/${amcosId}`, owner);
  assert.equal(det.body.amcos.status, 'SUSPENDED');
  assert.equal(det.body.amcos.statusReason, 'SUBSCRIPTION_EXPIRED');
  assert.equal((await call('POST', '/api/v1/auth/login', undefined, { phone: clerkPhone, password: 'Katibu2026' })).status, 403);
  // Reactivate kwa mkono inakataliwa mpaka alipe
  assert.equal((await call('POST', `/api/v1/owner/amcos/${amcosId}/reactivate`, owner, { confirmPassword: OWNER_PW })).status, 409);

  const p = await call('POST', '/api/v1/owner/finance/payments', owner, { subscriptionId: subId, category: 'SUBSCRIPTION', amount: '45000', method: 'BANK', paidAt: today() });
  const v = await call('POST', `/api/v1/owner/finance/payments/${p.body.payment.id}/verify`, owner, { confirmPassword: OWNER_PW });
  assert.equal(v.body.extension.access, 'REACTIVATED');
  assert.ok((await login(clerkPhone, 'Katibu2026')).token, 'anaingia tena');
});

test('Maintenance: watumiaji wa vyama wanazuiwa, Owner anaendelea', async () => {
  assert.equal((await call('PUT', '/api/v1/owner/system/maintenance', owner, { enabled: true, message: 'Tunaboresha mfumo' })).body.error.code, 'REAUTH_REQUIRED');
  const on = await call('PUT', '/api/v1/owner/system/maintenance', owner, { enabled: true, message: 'Tunaboresha mfumo', confirmPassword: OWNER_PW });
  assert.equal(on.status, 200);
  clearSettingsCache();
  const m = await call('GET', '/api/v1/members', katibu);
  assert.equal(m.status, 503);
  assert.equal(m.body.error.code, 'MAINTENANCE');
  assert.equal((await call('GET', '/api/v1/owner/dashboard', owner)).status, 200);
  assert.equal((await call('GET', '/api/v1/public/status')).body.maintenance.enabled, true);
  await call('PUT', '/api/v1/owner/system/maintenance', owner, { enabled: false, message: 'Tunaboresha mfumo', confirmPassword: OWNER_PW });
  clearSettingsCache();
  assert.equal((await call('GET', '/api/v1/members', katibu)).status, 200);
});

test('Sessions: kufuta kikao kimoja kunaua token yake tu', async () => {
  const a = (await login(ownerPhone, OWNER_PW)).token;
  const b = (await login(ownerPhone, OWNER_PW)).token;
  const list = await call('GET', '/api/v1/auth/sessions', a);
  const current = list.body.data.find((s: any) => s.current);
  assert.ok(list.body.data.length >= 2);
  assert.equal((await call('DELETE', `/api/v1/auth/sessions/${current.id}`, b)).status, 200);
  assert.equal((await call('GET', '/api/v1/auth/me', a)).status, 401, 'a imefutwa');
  assert.equal((await call('GET', '/api/v1/auth/me', b)).status, 200, 'b bado hai');
  await call('POST', '/api/v1/auth/logout', b);
  assert.equal((await call('GET', '/api/v1/auth/me', b)).status, 401);
});

test('2FA (TOTP): kuwasha, kuingia kwa msimbo, kuzima', async () => {
  const setup = await call('POST', '/api/v1/auth/2fa/setup', owner);
  assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\/CoopLink/);
  assert.equal((await call('POST', '/api/v1/auth/2fa/enable', owner, { code: '000000' })).status, 400);
  assert.equal((await call('POST', '/api/v1/auth/2fa/enable', owner, { code: totpCode(setup.body.secret) })).status, 200);
  const step1 = await login(ownerPhone, OWNER_PW);
  assert.equal(step1.twoFactorRequired, true);
  assert.equal(step1.token, undefined);
  // Token ya changamoto haitumiki kama token ya kuingia
  assert.equal((await call('GET', '/api/v1/auth/me', step1.challenge)).status, 401);
  assert.equal((await call('POST', '/api/v1/auth/2fa/verify', undefined, { challenge: step1.challenge, code: '123456' })).status, 401);
  const ok = await call('POST', '/api/v1/auth/2fa/verify', undefined, { challenge: step1.challenge, code: totpCode(setup.body.secret) });
  assert.ok(ok.body.token);
  owner = ok.body.token;
  // Kitendo nyeti sasa kinahitaji msimbo pia
  assert.equal((await call('POST', '/api/v1/auth/2fa/disable', owner, { confirmPassword: OWNER_PW })).body.error.code, 'REAUTH_FAILED');
  assert.equal((await call('POST', '/api/v1/auth/2fa/disable', owner, { confirmPassword: OWNER_PW, confirmCode: totpCode(setup.body.secret) })).status, 200);
  const [{ s }] = (await db.execute<{ s: string | null }>(sql`select totp_secret as s from users where id = ${ownerId}`)).rows;
  assert.equal(s, null);
});

test('Usalama: historia ya kuingia, audit yenye role, matangazo, export bila siri', async () => {
  await call('POST', '/api/v1/auth/login', undefined, { phone: ownerPhone, password: 'kosa-kosa1' });
  const fails = await call('GET', '/api/v1/owner/security/logins?success=false', owner);
  assert.ok(fails.body.data.some((e: any) => e.reason === 'BAD_PASSWORD' && e.phone === ownerPhone));
  const aud = await call('GET', '/api/v1/owner/security/audit?action=PLATFORM_PAYMENT_VERIFY', owner);
  assert.ok(aud.body.data.length >= 1);
  assert.ok(aud.body.data.every((l: any) => ['SUPER_ADMIN', 'FINANCE_MANAGER'].includes(l.userRole)));
  const [{ n: auto }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'AMCOS_AUTO_SUSPEND' and amcos_id = ${amcosId}`)).rows;
  assert.equal(auto, 1);

  assert.equal((await call('POST', '/api/v1/owner/comms/announcements', finToken, { kind: 'ANNOUNCEMENT', title: 'x', body: 'yyy', audience: 'ALL', channels: ['IN_APP'] })).status, 403);
  const an = await call('POST', '/api/v1/owner/comms/announcements', owner, { kind: 'SYSTEM_UPDATE', title: 'Toleo jipya ' + RUN, body: 'CoopLink v0.2.0 iko hewani', audience: 'ALL', channels: ['IN_APP', 'SMS', 'EMAIL'] });
  assert.equal(an.status, 201, JSON.stringify(an.body));
  assert.ok(an.body.deliveries.SENT >= 1, 'IN_APP');
  assert.ok(an.body.deliveries.SKIPPED >= 1, 'SMS/Email hazijasanidiwa -> SKIPPED, si SENT');
  const mine = await call('GET', '/api/v1/announcements', katibu);
  assert.ok(mine.body.data.some((x: any) => x.title === 'Toleo jipya ' + RUN));

  assert.equal((await call('POST', '/api/v1/owner/backup/export', owner, {})).status, 403);
  const ex = await call('POST', '/api/v1/owner/backup/export', owner, { confirmPassword: OWNER_PW });
  assert.equal(ex.status, 200);
  const raw = JSON.stringify(ex.body);
  assert.ok(!raw.includes('password_hash') && !raw.includes('$2b$') && !raw.includes('totp_secret'), 'hakuna siri kwenye export');
  assert.ok(ex.body.tables.members.length >= 1);
  // Login events haziwezi kubadilishwa
  await assert.rejects(db.execute(sql`delete from login_events`), (e: any) => /IMMUTABLE_RECORD/.test(e?.cause?.message ?? e?.message));
});

test('Dashibodi: takwimu zinatoka database; Tech Support haoni mapato', async () => {
  const d = await call('GET', '/api/v1/owner/dashboard', owner);
  assert.equal(d.status, 200);
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from amcos`)).rows;
  assert.equal(d.body.amcos.total, n);
  assert.equal(d.body.series.length, 12);
  assert.ok(Number(d.body.revenue.all_time) > 0);
  const phone = uniqPhone('25565');
  // v0.36: Tech Support ni ya Owner — haitolewi tena kwa wafanyakazi wapya
  assert.equal((await call('POST', '/api/v1/owner/staff', owner, { fullName: 'Tumaini Tech', phone, role: 'TECH_SUPPORT' })).status, 400);
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: 'Tumaini Huduma', phone, role: 'CUSTOMER_SUPPORT' });
  const t = await login(phone, c.body.temporaryPassword);
  const tech = (await call('POST', '/api/v1/auth/change-password', t.token, { currentPassword: c.body.temporaryPassword, newPassword: 'Tech2026xx' })).body.token;
  const td = await call('GET', '/api/v1/owner/dashboard', tech);
  assert.equal(td.body.revenue, null);
  assert.equal((await call('GET', '/api/v1/owner/system/health', tech)).status, 403, 'Huduma kwa wateja haoni mfumo');
  assert.equal((await call('GET', '/api/v1/owner/finance/report', tech)).status, 403);
  // Mfanyakazi aliyezimwa anatoka mara moja
  await call('POST', `/api/v1/owner/staff/${c.body.staff.id}/active`, owner, { isActive: false });
  assert.equal((await call('GET', '/api/v1/owner/dashboard', tech)).status, 401);
});

test('Orodha: hesabu za subqueries ni sahihi (AMCOS, mipango, matangazo)', async () => {
  // AMCOS list bila filter (ilileta 500 "id is ambiguous") na kwa filter
  const all = await call('GET', '/api/v1/owner/amcos?pageSize=100', owner);
  assert.equal(all.status, 200);
  const [real] = (await db.execute<{ id: string; users: number; members: number }>(sql`
    select a.id, (select count(*)::int from users u where u.amcos_id = a.id) as users,
      (select count(*)::int from members m where m.amcos_id = a.id) as members
    from amcos a where exists (select 1 from members m where m.amcos_id = a.id) limit 1`)).rows;
  const row = all.body.data.find((a: any) => a.id === real.id);
  assert.ok(row, 'chama chenye wanachama kiko kwenye orodha');
  assert.equal(row.users, real.users);
  assert.equal(row.members, real.members);
  for (const f of ['NONE', 'TRIAL', 'ACTIVE']) assert.equal((await call('GET', `/api/v1/owner/amcos?subscription=${f}`, owner)).status, 200, f);
  const none = (await call('GET', '/api/v1/owner/amcos?subscription=NONE&pageSize=100', owner)).body.data;
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from amcos a
    where not exists (select 1 from subscriptions x where x.amcos_id = a.id and x.status <> 'CANCELLED')`)).rows;
  assert.equal(none.length, Math.min(n, 100));

  // Mipango: activeSubscriptions = hesabu halisi
  const plans = (await call('GET', '/api/v1/owner/subscriptions/plans', owner)).body.data as any[];
  for (const p of plans) {
    const [{ c }] = (await db.execute<{ c: number }>(sql`select count(*)::int as c from subscriptions where plan_id = ${p.id} and status in ('TRIAL','ACTIVE','PAST_DUE')`)).rows;
    assert.equal(p.activeSubscriptions, c, p.code);
  }
  assert.ok(plans.some((p) => p.activeSubscriptions > 0));

  // Matangazo: deliveryStats zinaonyesha uwasilishaji halisi
  const anns = (await call('GET', '/api/v1/owner/comms/announcements', owner)).body.data as any[];
  assert.ok(anns.length > 0);
  const total = Object.values(anns[0].deliveryStats as Record<string, number>).reduce((a, b) => a + b, 0);
  const [{ d }] = (await db.execute<{ d: number }>(sql`select count(*)::int as d from announcement_deliveries where announcement_id = ${anns[0].id}`)).rows;
  assert.equal(total, d);
  assert.ok(d > 0);
});

test('Wasifu wa kampuni: mawasiliano ya mauzo na msaada wa kiufundi yanaonekana kwenye /public/status', async () => {
  const before = (await call('GET', '/api/v1/owner/business/profile', owner)).body.profile;
  const bad = await call('PUT', '/api/v1/owner/business/profile', owner, { ...before, supportPhone: 'piga simu' });
  assert.equal(bad.status, 400);
  const ok = await call('PUT', '/api/v1/owner/business/profile', owner, {
    ...before, address: 'S.L.P 1, Mji wa Majaribio', phone: '0700 000 001 / 0700 000 002', email: 'mauzo majaribio@example.com',
    supportPhone: '0700 000 003', supportEmail: 'Msaada@Example.com',
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.profile.email, 'maujomajaribio@example.com'.replace('maujo', 'mauzo'), 'Nafasi kwenye email zinaondolewa');
  assert.equal(ok.body.profile.supportEmail, 'msaada@example.com');
  const st = (await call('GET', '/api/v1/public/status')).body;
  assert.equal(st.contact.supportPhone, '0700 000 003');
  assert.equal(st.contact.phone, '0700 000 001 / 0700 000 002');
  assert.equal(st.legal.supportEmail, 'msaada@example.com');
  await call('PUT', '/api/v1/owner/business/profile', owner, before); // rudisha
});

test('System Control Center: ufuatiliaji, tahadhari, makosa yaliyounganishwa, integrations, kazi na swichi za dharura', async () => {
  const S = '/api/v1/owner/system';
  // Ufuatiliaji: ukaguzi mmoja unaandika uptime
  const mon = await call('POST', `${S}/jobs/system.monitor/run`, owner);
  assert.equal(mon.status, 200, JSON.stringify(mon.body));
  const up = (await call('GET', `${S}/uptime?days=7`, owner)).body;
  assert.equal(up.days.length, 7);
  assert.ok(up.lastCheck && up.lastCheck.ok === true);
  assert.equal((await call('GET', `${S}/uptime?days=5`, owner)).status, 400);

  // Makosa: ID tofauti kwenye njia ileile = kundi moja
  const ids = ['11111111-2222-4333-8444-555555555555', '66666666-7777-4888-9999-aaaaaaaaaaaa'];
  for (let i = 0; i < 12; i++) {
    await db.execute(sql`insert into system_errors (method, path, status, message) values ('GET', ${`/members/${ids[i % 2]}`}, 500, ${`Kosa la majaribio ${i}`})`);
  }
  const g = (await call('GET', `${S}/errors/groups?days=1`, owner)).body;
  const grp = g.data.find((x: any) => String(x.path).startsWith('/members/'));
  assert.ok(grp, 'kundi lipo'); assert.equal(grp.n, 12);
  const occ = (await call('GET', `${S}/errors/groups/${grp.fp}`, owner)).body;
  assert.equal(occ.data.length, 12);

  // Tahadhari: makosa 12 ndani ya dk 15 -> ERROR_SPIKE
  await call('POST', `${S}/jobs/system.monitor/run`, owner);
  let alerts = (await call('GET', `${S}/alerts`, owner)).body.data;
  const spike = alerts.find((a: any) => a.key === 'ERROR_SPIKE');
  assert.ok(spike && spike.severity === 'CRITICAL');
  const sum1 = (await call('GET', `${S}/alerts/summary`, owner)).body;
  assert.ok(sum1.critical >= 1);
  assert.equal((await call('POST', `${S}/alerts/${spike.id}/ack`, owner)).status, 200);
  const sum2 = (await call('GET', `${S}/alerts/summary`, owner)).body;
  assert.equal(sum2.critical, sum1.critical - 1);
  // Kosa likirekebishwa -> tahadhari inajifunga yenyewe
  assert.equal((await call('POST', `${S}/errors/groups/${grp.fp}/resolve`, owner)).body.resolved, 12);
  await call('POST', `${S}/jobs/system.monitor/run`, owner);
  alerts = (await call('GET', `${S}/alerts`, owner)).body.data;
  assert.equal(alerts.find((a: any) => a.key === 'ERROR_SPIKE'), undefined);
  assert.equal((await call('GET', `${S}/errors/groups?days=1&state=resolved`, owner)).body.data.some((x: any) => x.fp === grp.fp), true);

  // Integrations na kazi
  const integ = (await call('GET', `${S}/integrations`, owner)).body.data;
  assert.deepEqual(integ.map((x: any) => x.key), ['teepay', 'abliner', 'lookup', 'sms', 'email']);
  assert.equal(JSON.stringify(integ).includes(process.env.TEEPAY_API_KEY || '__none__'), false);
  const jobs = (await call('GET', `${S}/jobs`, owner)).body;
  assert.deepEqual(jobs.data.map((x: any) => x.name), ['subscriptions.sweep', 'fees.sweep', 'system.monitor']);
  assert.equal((await call('POST', `${S}/jobs/haipo/run`, owner)).status, 404);

  // Swichi: kuzima kunahitaji sababu na nenosiri; badiliko linaonekana
  assert.equal((await call('PUT', `${S}/switches`, owner, { key: 'farmerPortal', enabled: false, confirmPassword: OWNER_PW })).status, 400);
  assert.equal((await call('PUT', `${S}/switches`, owner, { key: 'farmerPortal', enabled: false, reason: 'Majaribio ya swichi' })).status, 403);
  const off = await call('PUT', `${S}/switches`, owner, { key: 'farmerPortal', enabled: false, reason: 'Majaribio ya swichi', confirmPassword: OWNER_PW });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const sw = (await call('GET', `${S}/switches`, owner)).body;
  assert.equal(sw.switches.farmerPortal, false); assert.equal(sw.changes.farmerPortal.reason, 'Majaribio ya swichi');
  assert.equal((await call('PUT', `${S}/switches`, owner, { key: 'farmerPortal', enabled: true, confirmPassword: OWNER_PW })).status, 200);
});
