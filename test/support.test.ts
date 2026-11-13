// Tiketi za msaada: chama kinafungua, timu ya DUKALANGU inajibu; usiri wa maelezo ya ndani; muda wa jibu (SLA).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { db, pool } from '../src/db';
import { hashPassword } from '../src/lib/security';

const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const uniqPhone = (p: string) => p + String(Date.now() + Math.floor(Math.random() * 100000)).slice(-7);
let server: http.Server, base: string;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body: json, type: r.headers.get('content-type') };
}
const login = (phone: string, password: string) => call('POST', '/api/v1/auth/login', undefined, { phone, password });

let owner: string, manager: string, clerk: string, accountant: string, other: string, marketing: string, marketingId: string, support: string, supportId: string;
// PNG ndogo halali (1x1)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function staffOf(amcosId: string, role: string) {
  const phone = uniqPhone('25576');
  const r = await call('POST', `/api/v1/owner/amcos/${amcosId}/staff`, owner, { role, fullName: `${role} ${RUN}`, phone });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await login(phone, r.body.temporaryPassword)).body.token;
  return (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: r.body.temporaryPassword, newPassword: 'Staff12345' })).body.token as string;
}
async function platformStaff(role: string, permissions?: string[]) {
  const phone = uniqPhone('25568');
  const c = await call('POST', '/api/v1/owner/staff', owner, { fullName: `${role} ${RUN}`, phone, role, ...(permissions ? { permissions } : {}) });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const t = (await login(phone, c.body.temporaryPassword)).body.token;
  return { id: c.body.staff.id as string, token: (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: c.body.temporaryPassword, newPassword: 'Staff12345x' })).body.token as string };
}
async function newAmcos(tag: string) {
  const mPhone = uniqPhone('25576');
  const reg = await call('POST', '/api/v1/owner/amcos', owner, { name: `Msaada ${tag} ${RUN} AMCOS`, activate: true, manager: { fullName: `Meneja ${tag}`, phone: mPhone, email: `m.${tag.toLowerCase()}.${RUN.toLowerCase()}@example.com`, password: 'Meneja#2026x' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const t = (await login(mPhone, 'Meneja#2026x')).body.token;
  const mgr = (await call('POST', '/api/v1/auth/change-password', t, { currentPassword: 'Meneja#2026x', newPassword: 'Staff12345' })).body.token as string;
  return { id: reg.body.amcos.id as string, manager: mgr };
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const phone = uniqPhone('25569');
  await db.execute(sql`insert into users (full_name, phone, role, password_hash, must_change_password) values ('Owner Msaada', ${phone}, 'SUPER_ADMIN', ${await hashPassword('OwnerPass2026')}, false)`);
  owner = (await login(phone, 'OwnerPass2026')).body.token;
  const a = await newAmcos('A');
  manager = a.manager;
  clerk = await staffOf(a.id, 'CLERK');
  accountant = await staffOf(a.id, 'ACCOUNTANT');
  other = (await newAmcos('B')).manager;
  // Mfanyakazi aliyepunguziwa ruhusa (masoko tu, bila msaada)
  const mk0 = await platformStaff('CUSTOMER_SUPPORT', ['platform.dashboard', 'comms.read', 'comms.send']);
  marketing = mk0.token; marketingId = mk0.id;
  const s = await platformStaff('CUSTOMER_SUPPORT');
  support = s.token; supportId = s.id;
});
after(async () => { server.close(); await pool.end(); });

test('Tiketi za msaada: kufungua, kuonekana kwa wanaostahili, majibu, maelezo ya ndani, SLA na kufunga', async () => {
  // Storekeeper anafungua tiketi yenye picha ya skrini
  const c = await call('POST', '/api/v1/support/tickets', clerk, {
    category: 'BUG', priority: 'HIGH', subject: 'Ukurasa wa stoo haufunguki', body: 'Nikifungua Bidhaa na Stoo inaonyesha kosa.',
    context: { page: '/store', version: '0.13.0' }, attachments: [{ mimeType: 'image/png', data: PNG }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = c.body.ticket.id;
  assert.match(c.body.ticket.number, /^TK-\d{5}$/);
  const hrs = (new Date(c.body.ticket.dueAt).getTime() - new Date(c.body.ticket.createdAt).getTime()) / 3_600_000;
  assert.equal(Math.round(hrs), 8, 'Kubwa = saa 8');

  // Meneja anaona tiketi za chama; Mhasibu haoni ya Storekeeper; chama kingine hakioni kabisa
  assert.ok((await call('GET', '/api/v1/support/tickets', manager)).body.data.some((t: any) => t.id === id));
  assert.ok(!(await call('GET', '/api/v1/support/tickets', accountant)).body.data.some((t: any) => t.id === id));
  assert.equal((await call('GET', `/api/v1/support/tickets/${id}`, accountant)).status, 404);
  assert.equal((await call('GET', `/api/v1/support/tickets/${id}`, other)).status, 404);

  // Timu: mfanyakazi asiye na ruhusa ya msaada anazuiwa; wafanyakazi wa jukwaa hawaingii msaada wa chama
  assert.equal((await call('GET', '/api/v1/owner/support/tickets', marketing)).status, 403);
  assert.equal((await call('GET', '/api/v1/support/tickets', support)).status, 403);
  const q = await call('GET', '/api/v1/owner/support/tickets?view=waiting', support);
  assert.equal(q.status, 200);
  assert.ok(q.body.data.some((t: any) => t.id === id && t.waiting));

  // Maelezo ya ndani hayaonekani kwa chama; jibu la kawaida linaonekana na kuweka muda wa jibu la kwanza
  assert.equal((await call('POST', `/api/v1/owner/support/tickets/${id}/messages`, support, { body: 'Ndani: angalia logs za /store', internal: true })).status, 201);
  let d = (await call('GET', `/api/v1/support/tickets/${id}`, clerk)).body;
  assert.equal(d.messages.length, 1, 'maelezo ya ndani yamefichwa');
  assert.equal((await call('GET', '/api/v1/support/unread', clerk)).body.count, 0);
  assert.equal((await call('POST', `/api/v1/owner/support/tickets/${id}/messages`, support, { body: 'Tumelirekebisha, jaribu tena.' })).status, 201);
  const od = (await call('GET', `/api/v1/owner/support/tickets/${id}`, support)).body;
  assert.equal(od.ticket.status, 'ANSWERED');
  assert.ok(od.ticket.firstResponseAt);
  assert.equal(od.ticket.assignedToId, supportId, 'aliyejibu kwanza anapewa tiketi');
  assert.equal(od.messages.length, 3);
  assert.equal((await call('GET', '/api/v1/support/unread', clerk)).body.count, 1, 'Storekeeper anaona jibu jipya');
  d = (await call('GET', `/api/v1/support/tickets/${id}`, clerk)).body;
  assert.equal(d.messages.length, 2);
  assert.match(d.messages[1].author, /Timu ya CoopLink/);
  assert.equal((await call('GET', '/api/v1/support/unread', clerk)).body.count, 0, 'imesomwa');

  // Picha: chama kinaiona; chama kingine hakiioni
  const attId = d.messages[0].attachments[0].id;
  const img = await call('GET', `/api/v1/support/attachments/${attId}`, manager);
  assert.equal(img.status, 200); assert.equal(img.type, 'image/png');
  assert.equal((await call('GET', `/api/v1/support/attachments/${attId}`, other)).status, 404);

  // Chama kinajibu -> tiketi inarudi kwa timu
  assert.equal((await call('POST', `/api/v1/support/tickets/${id}/messages`, clerk, { body: 'Bado inagoma kwenye simu.' })).status, 201);
  assert.equal((await call('GET', `/api/v1/owner/support/tickets/${id}`, support)).body.ticket.status, 'OPEN');

  // Kugawa kwa mtu asiye na ruhusa ya msaada kunakataliwa; kipaumbele; kufunga na kufungua upya
  const mk = (await call('GET', '/api/v1/owner/support/assignees', support)).body.data;
  assert.ok(mk.some((u: any) => u.id === supportId));
  assert.equal((await call('PATCH', `/api/v1/owner/support/tickets/${id}`, support, { assignedToId: marketingId })).status, 400);
  assert.equal((await call('PATCH', `/api/v1/owner/support/tickets/${id}`, support, { status: 'CLOSED' })).status, 200);
  assert.equal((await call('GET', '/api/v1/support/tickets?status=ACTIVE', clerk)).body.data.filter((t: any) => t.id === id).length, 0);
  assert.equal((await call('POST', `/api/v1/support/tickets/${id}/messages`, clerk, { body: 'Limerudi tena leo.' })).status, 201);
  assert.equal((await call('GET', `/api/v1/owner/support/tickets/${id}`, support)).body.ticket.status, 'OPEN', 'jibu baada ya kufungwa linafungua upya');

  // Tiketi ya dharura isiyojibiwa ikipita muda -> "imechelewa"
  const u = await call('POST', '/api/v1/support/tickets', manager, { category: 'PAYMENT', priority: 'URGENT', subject: 'Malipo ya ada yamekatwa', body: 'Pesa imekatwa lakini chama bado kimefungwa.' });
  assert.equal(u.status, 201);
  await db.execute(sql`update support_tickets set created_at = now() - interval '3 hours', due_at = now() - interval '1 hour' where id = ${u.body.ticket.id}`);
  const late = (await call('GET', '/api/v1/owner/support/tickets?view=overdue', support)).body.data;
  assert.ok(late.some((t: any) => t.id === u.body.ticket.id && t.overdue));
  assert.ok((await call('GET', '/api/v1/owner/support/summary', owner)).body.overdue >= 1);
  // Kubadili kipaumbele kabla ya jibu kunahesabu muda upya kuanzia ilipofunguliwa
  await call('PATCH', `/api/v1/owner/support/tickets/${u.body.ticket.id}`, support, { priority: 'NORMAL' });
  assert.ok(!(await call('GET', '/api/v1/owner/support/tickets?view=overdue', support)).body.data.some((t: any) => t.id === u.body.ticket.id));

  // Uthibitisho wa data
  assert.equal((await call('POST', '/api/v1/support/tickets', clerk, { category: 'BUG', subject: 'x', body: 'y' })).status, 400);
  assert.equal((await call('POST', '/api/v1/support/tickets', clerk, { category: 'BUG', subject: 'Picha mbaya', body: 'Angalia picha', attachments: [{ mimeType: 'application/pdf', data: PNG }] })).status, 400);
});

test('Masharti ya Huduma na Sera ya Faragha: kukubali toleo la sasa kunarekodiwa', async () => {
  const me = (await call('GET', '/api/v1/auth/me', clerk)).body.user;
  assert.equal(me.termsRequired, true, 'mtumiaji mpya anatakiwa kukubali');
  assert.ok(me.legalVersion);
  const pub = (await call('GET', '/api/v1/public/status')).body;
  assert.equal(pub.legal.version, me.legalVersion);
  assert.equal((await call('POST', '/api/v1/auth/accept-terms', clerk, { version: '1999-01-01', accept: true })).status, 400, 'toleo la zamani linakataliwa');
  assert.equal((await call('POST', '/api/v1/auth/accept-terms', clerk, { version: me.legalVersion, accept: false })).status, 400, 'lazima akubali');
  const ok = await call('POST', '/api/v1/auth/accept-terms', clerk, { version: me.legalVersion, accept: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.termsRequired, false);
  assert.equal(ok.body.user.termsVersion, me.legalVersion);
  const [a] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'TERMS_ACCEPT' and entity_id = ${me.id}`)).rows;
  assert.equal(a.n, 1);
  assert.equal((await call('GET', '/api/v1/auth/me', clerk)).body.user.termsRequired, false);
});
