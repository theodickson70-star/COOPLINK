// =====================================================================
//  MAAFISA USHIRIKA (v0.43) — Owner pekee anasajili Afisa Ushirika wa Wilaya na wakaguzi wake
//   - hadi maafisa 5 walio hai kwa kila wilaya; wote wana nguvu sawa za ukaguzi na usimamizi
//   - nenosiri la muda kwa SMS; 2FA ni lazima (siku za neema kama wafanyakazi wa CoopLink)
//   - wanaona vyama vyote vya wilaya yao (kusoma tu) + ukaguzi, maagizo na zuio la malipo
// =====================================================================
import { checkLocation } from '../../lib/locations';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, phoneSchema, uuidParam } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { sendTempCredentials, tempExpiry } from '../../lib/staff-credentials';
import { assertPhoneFree } from '../../lib/user-phone';
import { activeSessionsWhere } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { hashPassword, tempPassword } from '../../lib/security';
import { verifiedName } from '../../lib/name-lookup';
import { districtAmcosIds } from '../../middleware/tenant';

export const officersRouter = Router();
export const MAX_OFFICERS_PER_DISTRICT = 5;
const U = schema.users;
const cols = { id: U.id, fullName: U.fullName, phone: U.phone, email: U.email, role: U.role, jobTitle: U.jobTitle, isActive: U.isActive, lastLoginAt: U.lastLoginAt,
  totpEnabled: U.totpEnabled, jurisdictionRegion: U.jurisdictionRegion, jurisdictionDistrict: U.jurisdictionDistrict, createdAt: U.createdAt };
const ownerOnly = (req: Request) => { if (req.auth!.role !== 'SUPER_ADMIN') throw forbidden('Owner pekee ndiye anasajili Maafisa Ushirika'); };
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

async function activeInDistrict(district: string, except?: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(U).where(and(eq(U.role, 'COOP_OFFICER'), eq(U.isActive, true),
    sql`lower(trim(${U.jurisdictionDistrict})) = lower(trim(${district}))`, except ? sql`${U.id} <> ${except}` : undefined));
  return n;
}
async function findOfficer(id: string) {
  const [u] = await db.select(cols).from(U).where(and(eq(U.id, id), eq(U.role, 'COOP_OFFICER')));
  if (!u) throw notFound('Afisa');
  return u;
}

officersRouter.get('/', ah(async (req, res) => {
  ownerOnly(req);
  const rows = await db.select(cols).from(U).where(eq(U.role, 'COOP_OFFICER')).orderBy(desc(U.isActive), U.jurisdictionDistrict, U.fullName);
  // Wilaya zilizopo (kutoka vyama vilivyosajiliwa) na idadi ya vyama kila moja
  const districts = (await db.execute<{ region: string | null; district: string; amcos: number }>(sql`
    select min(region) as region, min(trim(district)) as district, count(*)::int as amcos from amcos where district is not null and trim(district) <> ''
    group by lower(trim(district)) order by 2`)).rows;
  const out = [];
  for (const r of rows) out.push({ ...r, amcosCount: (await districtAmcosIds({ region: r.jurisdictionRegion, district: r.jurisdictionDistrict })).length });
  res.json({ data: out, districts, maxPerDistrict: MAX_OFFICERS_PER_DISTRICT });
}));

const body = z.object({
  fullName: z.string().trim().min(3), phone: phoneSchema, email: z.string().trim().email('Email si sahihi').nullable().optional(),
  jobTitle: z.string().trim().min(3).max(80).default('Afisa Ushirika Wilaya'),
  region: z.string().trim().min(2).max(60).nullable().optional(), district: z.string().trim().min(2, 'Chagua wilaya').max(60),
});

officersRouter.post('/', ah(async (req, res) => {
  ownerOnly(req);
  const b = checkLocation(body.parse(req.body), null, { requireDistrict: true });
  const district = norm(b.district), region = b.region ? norm(b.region) : null;
  if ((await activeInDistrict(district)) >= MAX_OFFICERS_PER_DISTRICT) throw conflict(`Wilaya ya ${district} tayari ina maafisa ${MAX_OFFICERS_PER_DISTRICT} walio hai — zima mmoja kwanza`);
  await assertPhoneFree(b.phone);
  const fullName = (await verifiedName(b.phone, b.fullName))!;
  const password = tempPassword();
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(U).values({
      fullName, phone: b.phone, email: b.email ?? null, role: 'COOP_OFFICER', jobTitle: b.jobTitle, jurisdictionRegion: region, jurisdictionDistrict: district,
      passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(),
    }).returning(cols);
    await audit(tx, req, { action: 'COOP_OFFICER_CREATE', entity: 'User', entityId: u.id, after: u });
    return u;
  });
  const delivery = await sendTempCredentials(user, password, { kind: 'NEW' });
  await audit(db, req, { action: 'STAFF_CREDENTIALS_SENT', entity: 'User', entityId: user.id, after: { channel: 'SMS', status: delivery.status, kind: 'NEW' } });
  res.status(201).json({ officer: user, delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
}));

officersRouter.patch('/:id', ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const b = body.omit({ phone: true }).partial().parse(req.body);
  const before = await findOfficer(id);
  Object.assign(b, checkLocation(b, { region: before.jurisdictionRegion, district: before.jurisdictionDistrict }));
  const district = b.district ? norm(b.district) : before.jurisdictionDistrict!;
  const moved = !!b.district && district.toLowerCase() !== (before.jurisdictionDistrict ?? '').toLowerCase();
  if (moved && before.isActive && (await activeInDistrict(district, id)) >= MAX_OFFICERS_PER_DISTRICT) throw conflict(`Wilaya ya ${district} tayari ina maafisa ${MAX_OFFICERS_PER_DISTRICT}`);
  const fullName = b.fullName ? (await verifiedName(before.phone, b.fullName))! : undefined;
  const row = await db.transaction(async (tx) => {
    const [u] = await tx.update(U).set({ fullName, email: b.email, jobTitle: b.jobTitle, jurisdictionDistrict: district, jurisdictionRegion: b.region === undefined ? undefined : b.region ? norm(b.region) : null,
      ...(moved ? { tokenVersion: sql`${U.tokenVersion} + 1` } : {}) }).where(eq(U.id, id)).returning(cols);
    if (moved) await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
    await audit(tx, req, { action: 'COOP_OFFICER_UPDATE', entity: 'User', entityId: id, before, after: u });
    return u;
  });
  res.json({ officer: row });
}));

officersRouter.post('/:id/active', ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const before = await findOfficer(id);
  if (isActive && !before.isActive) {
    await assertPhoneFree(before.phone, id);
    if ((await activeInDistrict(before.jurisdictionDistrict ?? '', id)) >= MAX_OFFICERS_PER_DISTRICT) throw conflict(`Wilaya hii tayari ina maafisa ${MAX_OFFICERS_PER_DISTRICT} walio hai`);
  }
  const row = await db.transaction(async (tx) => {
    const [u] = await tx.update(U).set({ isActive, ...(isActive ? {} : { tokenVersion: sql`${U.tokenVersion} + 1` }) }).where(eq(U.id, id)).returning(cols);
    if (!isActive) await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
    await audit(tx, req, { action: isActive ? 'COOP_OFFICER_ACTIVATE' : 'COOP_OFFICER_DEACTIVATE', entity: 'User', entityId: id, before: { isActive: before.isActive }, after: { isActive } });
    return u;
  });
  res.json({ officer: row });
}));

officersRouter.post('/:id/reset-password', ah(async (req, res) => {
  ownerOnly(req);
  const { id } = uuidParam.parse(req.params);
  const before = await findOfficer(id);
  if (!before.isActive) throw badRequest('Akaunti hii imezimwa — iwashe kwanza');
  const password = tempPassword();
  await db.transaction(async (tx) => {
    await tx.update(U).set({ passwordHash: await hashPassword(password), mustChangePassword: true, tempPasswordExpiresAt: tempExpiry(), tokenVersion: sql`${U.tokenVersion} + 1` }).where(eq(U.id, id));
    await tx.update(schema.userSessions).set({ revokedAt: new Date(), revokedById: req.auth!.userId }).where(activeSessionsWhere(id));
    await audit(tx, req, { action: 'COOP_OFFICER_PASSWORD_RESET', entity: 'User', entityId: id });
  });
  const delivery = await sendTempCredentials(before, password, { kind: before.lastLoginAt ? 'RESET' : 'NEW' });
  res.json({ delivery, temporaryPassword: delivery.status === 'SENT' ? null : password });
}));
