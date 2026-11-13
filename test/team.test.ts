// v0.38 — Timu ya CoopLink: maombi kwa Owner, 2FA ya lazima, kengele ya kazi, utendaji, vikumbusho vya kiotomatiki, maoni ya mteja
process.env.SMS_DRY_RUN = 'true';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';
import { dryOutbox } from '../src/lib/sms';
import { clearFeeLock } from '../src/lib/fees';
import { clearSettingsCache } from '../src/lib/settings';
import { runRemindersSweep } from '../src/lib/reminders';
import { addDays, today } from '../src/lib/subscriptions';

let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 1000)).slice(-7);
const OWNER_PW = 'OwnerPass2026';
async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json: any = text; try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: json };
}
const login = async (phone: string, password: string) => (await call('POST', '/api/v1/auth/login', undefined, { phone, password })).body;
const smsPassword = (phone: string) => { const m = [...dryOutbox].reverse().find((x) => x.phone === phone && /Nenosiri la muda: /.test(x.text)); return m ? /Nenosiri la muda: (\S+)/.exec(m.text)![1] : null; };
async function staff(role: string) {
  const phone = uniqPhone('25568');
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: `${role} ${RUN}`, phone, role });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const pw = smsPassword(phone)!;
  const t = (await login(phone, pw)).token;
  return { id: c.body.staff.id as string, phone, token: (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: pw, newPassword: 'Staff12345x' })).body.token as string };
}

let owner: string, cs: { id: string; phone: string; token: string }, fin: { id: string; phone: string; token: string };
let amcosId: string, managerId: string, managerToken: string, managerPhone: string;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner Timu', ${phone}, 'SUPER_ADMIN', ${await hashPassword(OWNER_PW)}, false)`);
  owner = (await login(phone, OWNER_PW)).token;
  cs = await staff('CUSTOMER_SUPPORT');
  fin = await staff('FINANCE_MANAGER');
  managerPhone = uniqPhone('25577');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Timu ${RUN} AMCOS`, activate: true, manager: { fullName: `Meneja Timu ${RUN}`, phone: managerPhone, password: 'Meneja#2026x' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  amcosId = reg.body.amcos.id;
  const ml = await login(managerPhone, 'Meneja#2026x');
  managerToken = ml.token; managerId = ml.user.id;
});
after(async () => { server.close(); await pool.end(); });

test('Maombi kwa Owner: Huduma kwa Wateja anaomba, Owner anatekeleza kumtoa mtumishi kwenye vifaa', async () => {
  assert.equal((await call('POST', '/api/v1/owner/requests', cs.token, { category: 'ACCOUNT_SIGNOUT', subject: 'Simu ya Meneja imeibiwa', body: 'Meneja amepiga simu: simu yake imeibiwa jana.' })).status, 400, 'chama na mtumishi lazima');
  const c = await call('POST', '/api/v1/owner/requests', cs.token, { category: 'ACCOUNT_SIGNOUT', priority: 'URGENT', subject: 'Simu ya Meneja imeibiwa', body: 'Meneja amepiga simu: simu yake imeibiwa jana.', amcosId, targetUserId: managerId });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.request.id;
  assert.equal((await call('POST', '/api/v1/owner/requests', cs.token, { category: 'ACCOUNT_SIGNOUT', subject: 'Tena simu ya Meneja', body: 'Ombi la pili la mtumishi yule yule.', amcosId, targetUserId: managerId })).status, 409, 'ombi moja tu linalosubiri');
  // Mfanyakazi mwingine haoni ombi hili; Owner anaona
  assert.equal((await call('GET', `/api/v1/owner/requests/${id}`, fin.token)).status, 404);
  assert.ok(!(await call('GET', '/api/v1/owner/requests', fin.token)).body.data.some((r: any) => r.id === id));
  const ol = (await call('GET', '/api/v1/owner/requests?status=ACTIVE', owner)).body.data;
  assert.ok(ol.some((r: any) => r.id === id));
  const n = (await call('GET', '/api/v1/owner/notifications', owner)).body;
  assert.ok(n.items.some((i: any) => i.key === 'requests' && i.count >= 1));
  // Mfanyakazi hawezi kutekeleza wala kubadilisha hali
  assert.equal((await call('POST', `/api/v1/owner/requests/${id}/execute`, cs.token, { confirmPassword: 'Staff12345x' })).status, 403);
  assert.equal((await call('POST', `/api/v1/owner/requests/${id}/status`, cs.token, { status: 'DONE' })).status, 403);
  const det = (await call('GET', `/api/v1/owner/requests/${id}`, owner)).body;
  assert.equal(det.can.execute, true); assert.match(det.target.phone, /•••/);
  assert.equal((await call('POST', `/api/v1/owner/requests/${id}/execute`, owner, {})).status, 403, 'nenosiri la Owner linahitajika');
  const ex = await call('POST', `/api/v1/owner/requests/${id}/execute`, owner, { confirmPassword: OWNER_PW });
  assert.equal(ex.status, 200, JSON.stringify(ex.body)); assert.ok(ex.body.sessions >= 1);
  assert.equal((await call('GET', '/api/v1/auth/me', managerToken)).status, 401, 'Meneja ametolewa kwenye vifaa vyote');
  const mine = (await call('GET', '/api/v1/owner/requests', cs.token)).body.data.find((r: any) => r.id === id);
  assert.equal(mine.status, 'DONE'); assert.equal(mine.unseen, true, 'mwombaji anaona jibu jipya');
  assert.ok((await call('GET', '/api/v1/owner/notifications', cs.token)).body.items.some((i: any) => i.key === 'requests'));
  await call('GET', `/api/v1/owner/requests/${id}`, cs.token); // akiliangalia, arifa inaondoka
  assert.equal((await call('GET', '/api/v1/owner/requests', cs.token)).body.data.find((r: any) => r.id === id).unseen, false);
  // Ombi la kawaida: kukataliwa kunahitaji sababu; mwombaji akijibu, linafunguka tena
  const o = await call('POST', '/api/v1/owner/requests', fin.token, { category: 'FEE_WAIVER', subject: 'Kusamehe ada ya kingilio', body: 'Chama kimeomba punguzo kwa sababu ya ukame msimu huu.', amcosId });
  assert.equal(o.status, 201);
  assert.equal((await call('POST', `/api/v1/owner/requests/${o.body.request.id}/status`, owner, { status: 'DECLINED' })).status, 400);
  assert.equal((await call('POST', `/api/v1/owner/requests/${o.body.request.id}/status`, owner, { status: 'DECLINED', resolution: 'Ada ni sawa kwa vyama vyote' })).status, 200);
  assert.equal((await call('POST', `/api/v1/owner/requests/${o.body.request.id}/messages`, fin.token, { body: 'Wameongeza ushahidi wa ukame.' })).status, 201);
  assert.equal((await call('GET', `/api/v1/owner/requests/${o.body.request.id}`, owner)).body.request.status, 'OPEN');
});

test('2FA ni lazima kwa wafanyakazi baada ya siku 3', async () => {
  const me = (await call('GET', '/api/v1/auth/me', cs.token)).body.user;
  assert.equal(me.twoFactor.required, true); assert.equal(me.twoFactor.overdue, false);
  await db.execute(sql`update users set created_at = now() - interval '10 days' where id = ${cs.id}`);
  await db.execute(sql`update platform_settings set value = jsonb_set(value, '{staff2faSince}', to_jsonb((now() - interval '10 days')::text)) where key = 'security'`);
  clearSettingsCache();
  const blocked = await call('GET', '/api/v1/owner/leads', cs.token);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'TWO_FACTOR_SETUP_REQUIRED');
  assert.equal((await call('GET', '/api/v1/auth/me', cs.token)).status, 200, 'anaweza kufika Akaunti yangu kuwasha 2FA');
  assert.equal((await call('GET', '/api/v1/owner/dashboard', owner)).status, 200, 'Owner hahusiki');
  await db.execute(sql`update users set totp_enabled = true where id = ${cs.id}`);
  assert.equal((await call('GET', '/api/v1/owner/leads', cs.token)).status, 200);
  await db.execute(sql`update users set totp_enabled = false, created_at = now() where id = ${cs.id}`);
  await db.execute(sql`update platform_settings set value = jsonb_set(value, '{staff2faSince}', to_jsonb(now()::text)) where key = 'security'`);
  clearSettingsCache();
});

test('Kengele ya kazi na utendaji wa timu', async () => {
  const n = await call('GET', '/api/v1/owner/notifications', fin.token);
  assert.equal(n.status, 200); assert.ok(Array.isArray(n.body.items));
  assert.ok(n.body.items.some((i: any) => i.key === '2fa'), 'anakumbushwa kuwasha 2FA');
  assert.equal((await call('GET', '/api/v1/owner/team/performance', fin.token)).status, 403);
  const p = await call('GET', `/api/v1/owner/team/performance?from=${addDays(today(), -30)}&to=${today()}`, owner);
  assert.equal(p.status, 200);
  const row = p.body.data.find((x: any) => x.id === cs.id);
  assert.ok(row && row.requests >= 1);
});

test('Vikumbusho vya ada vya kiotomatiki na SMS za kazi kwa wafanyakazi', async () => {
  const [f] = (await db.execute<{ id: string }>(sql`insert into platform_fees (amcos_id, kind, label, amount, due_date, status)
    values (${amcosId}, 'SEASON', ${'Ada ya msimu AUTO ' + RUN}, 50000, ${addDays(today(), 3)}, 'UNPAID') returning id`)).rows;
  clearFeeLock();
  const pay = await call('POST', '/api/v1/owner/finance/payments', fin.token, { category: 'OTHER', amount: '1000', method: 'CASH', paidAt: today() });
  await db.execute(sql`update platform_payments set created_at = now() - interval '30 hours' where id = ${pay.body.payment.id}`);
  const r1 = await runRemindersSweep({ force: true });
  assert.ok(r1.feeReminders >= 1, JSON.stringify(r1));
  const [a] = (await db.execute<{ created_by_id: string | null }>(sql`select an.created_by_id from announcements an join announcement_deliveries d on d.announcement_id = an.id
    where d.amcos_id = ${amcosId} and an.title = 'Ada ya CoopLink' order by an.created_at desc limit 1`)).rows;
  assert.equal(a.created_by_id, null, 'imetumwa na mfumo');
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from staff_alerts where key like ${'pay:' + pay.body.payment.id + '%'}`)).rows;
  assert.ok(n >= 1, 'Owner/mfanyakazi mwingine wa fedha amearifiwa');
  assert.equal((await db.execute<{ n: number }>(sql`select count(*)::int as n from staff_alerts where key = ${'pay:' + pay.body.payment.id + ':' + fin.id}`)).rows[0].n, 0, 'aliyerekodi haarifiwi');
  const r2 = await runRemindersSweep({ force: true });
  assert.equal(r2.feeReminders, 0, 'hakikumbushwi mara mbili ndani ya saa 24');
  assert.equal((await call('PUT', '/api/v1/owner/finance/reminders', cs.token, { feesAuto: false })).status, 403);
  assert.equal((await call('PUT', '/api/v1/owner/finance/reminders', fin.token, { feesAuto: true })).status, 200);
  await db.execute(sql`update platform_fees set status = 'WAIVED', waived_reason = 'Mtihani' where id = ${f.id}`); clearFeeLock();
});

test('Maoni ya mteja baada ya tiketi kufungwa', async () => {
  const ml = await login(managerPhone, 'Meneja#2026x');
  const mt = (await call('POST', '/api/v1/auth/change-password', ml.token, { currentPassword: 'Meneja#2026x', newPassword: 'Meneja#2026y' })).body.token;
  await call('POST', '/api/v1/auth/accept-terms', mt, {});
  const t = await call('POST', '/api/v1/support/tickets', mt, { category: 'TRAINING', subject: 'Tunahitaji mafunzo ya stoo', body: 'Storekeeper mpya anahitaji mafunzo.' });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.ticket?.id ?? t.body.id;
  assert.equal((await call('POST', `/api/v1/support/tickets/${id}/rating`, mt, { rating: 1 })).status, 400, 'baada ya kufungwa tu');
  await call('POST', `/api/v1/support/tickets/${id}/close`, mt, {});
  assert.equal((await call('POST', `/api/v1/support/tickets/${id}/rating`, mt, { rating: 1, comment: 'Asanteni!' })).status, 200);
  assert.equal((await call('POST', `/api/v1/support/tickets/${id}/rating`, mt, { rating: -1 })).status, 400, 'mara moja');
  const s = (await call('GET', '/api/v1/owner/support/summary', owner)).body;
  assert.ok(s.csatUp >= 1);
});
