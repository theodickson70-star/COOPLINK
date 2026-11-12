// =====================================================================
//  MIPANGILIO YA CHAMA (watumishi wote: Meneja, Mhasibu, Storekeeper)
//   GET  /settings            muhtasari wa kila sehemu + nani anaweza kubadilisha nini (kinahesabiwa HAPA, si kwenye UI)
//   PUT  /settings/profile    profaili ya chama (Meneja). Jina, code na namba ya usajili ni za Owner tu.
//   PUT  /settings/finance    akaunti kuu ya benki (Mhasibu)
//   PUT  /settings/docs       kichwa na kijachini cha nyaraka (Meneja / Mhasibu)
//
//  Sehemu nyingine HAZIRUDIWI hapa — zinatumia endpoints zilizopo:
//   kilo kwa ekari -> PUT /estimates/settings · portal ya wakulima -> PATCH /amcos/:id
//   sarafu ya pembejeo -> PUT /finance/fx/currency · kiwango cha stoo -> PATCH /inputs/items/:id
//   bei za madaraja, makato na mikopo -> kurasa zao (hapa ni hali + kiungo tu)
//  Kila badiliko linaandikwa kwenye audit.
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, phoneSchema } from '../lib/http';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { canAmcos } from '../lib/amcos-permissions';
import { getSetting } from '../lib/settings';
import { broadcastUsedThisMonth, smsConfigured, smsEnabled } from '../lib/sms';
import { currentSeason } from './seasons.routes';

export const settingsRouter = Router();

type Auth = NonNullable<Request['auth']>;
const isManager = (a: Auth) => a.role === 'AMCOS_ADMIN' || a.role === 'SUPER_ADMIN';

/** Ruhusa za kila sehemu — chanzo kimoja cha ukweli (UI inazisoma tu). */
export function settingsAccess(a: Auth) {
  const fin = canAmcos(a, 'finance.read') || a.role === 'AMCOS_ADMIN';
  const stock = canAmcos(a, 'stock.read') || a.role === 'ACCOUNTANT' || a.role === 'AMCOS_ADMIN'; // Mhasibu anasoma viwango (kwa manunuzi)
  return {
    view: { account: true, profile: true, season: true, farmers: true, finance: fin, stock, docs: true, sms: a.role !== 'CLERK' },
    edit: {
      profile: isManager(a),
      identity: a.role === 'SUPER_ADMIN',          // jina, code, namba ya usajili
      season: canAmcos(a, 'estimates.approve'),
      farmers: isManager(a),
      finance: canAmcos(a, 'finance.accounts'),
      stock: canAmcos(a, 'products.manage'),
      docs: isManager(a) || canAmcos(a, 'finance.accounts'),
    },
  };
}

export const LEADER_ROLES = ['CHAIR', 'VICE_CHAIR', 'SECRETARY', 'TREASURER'] as const;
const SETTINGS_ACTIONS = ['AMCOS_PROFILE_UPDATE', 'AMCOS_DOCS_UPDATE', 'AMCOS_MAIN_ACCOUNT_SET', 'ESTIMATE_SETTINGS_UPDATE', 'INPUT_CURRENCY_SET', 'AMCOS_UPDATE', 'INPUT_ITEM_UPDATE'];

/** Asilimia ya ukamilifu wa profaili (kwa orodha ya kukamilisha) */
function completeness(a: typeof schema.amcos.$inferSelect) {
  const leaders = a.leaders ?? [];
  const checks: [string, boolean][] = [
    ['Namba ya usajili', !!a.regNumber], ['Mkoa na wilaya', !!(a.region && a.district)], ['Kijiji/kata', !!(a.village || a.ward)],
    ['Simu ya ofisi', !!a.phone], ['Anwani ya posta', !!a.postalAddress], ['TIN', !!a.tin],
    ['Mwenyekiti', leaders.some((l) => l.role === 'CHAIR' && l.name)], ['Katibu', leaders.some((l) => l.role === 'SECRETARY' && l.name)],
    ['Nembo', !!a.logo],
  ];
  const done = checks.filter((c) => c[1]).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c[1]).map((c) => c[0]) };
}

settingsRouter.get('/', ah(async (req, res) => {
  const auth = req.auth!;
  if (!auth.amcosId && auth.role !== 'SUPER_ADMIN' && auth.role !== 'UNION_ADMIN') throw forbidden();
  const amcosId = await readAmcosId(req);
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) });
  if (!a) throw notFound('Chama');
  const acc = settingsAccess(auth);
  const season = await currentSeason();
  const S = schema;
  const cnt = sql<number>`count(*)::int`;

  const [lastMember, members] = await Promise.all([
    db.select({ no: S.members.memberNo }).from(S.members).where(eq(S.members.amcosId, amcosId)).orderBy(desc(S.members.createdAt)).limit(1),
    db.select({ n: cnt }).from(S.members).where(eq(S.members.amcosId, amcosId)),
  ]);

  // Fedha (hali + viungo tu)
  let finance = null;
  if (acc.view.finance) {
    const [accounts, grades, rules, loans, fx] = await Promise.all([
      db.select({ id: S.financeAccounts.id, name: S.financeAccounts.name, kind: S.financeAccounts.kind, bankName: S.financeAccounts.bankName, accountNumber: S.financeAccounts.accountNumber })
        .from(S.financeAccounts).where(and(eq(S.financeAccounts.amcosId, amcosId), eq(S.financeAccounts.isActive, true))).orderBy(asc(S.financeAccounts.name)),
      season ? db.select({ n: cnt }).from(S.gradePrices).where(and(eq(S.gradePrices.amcosId, amcosId), eq(S.gradePrices.seasonId, season.id))) : Promise.resolve([{ n: 0 }]),
      season ? db.select({ n: cnt }).from(S.deductionRules).where(and(eq(S.deductionRules.amcosId, amcosId), eq(S.deductionRules.seasonId, season.id), eq(S.deductionRules.isActive, true))) : Promise.resolve([{ n: 0 }]),
      season ? db.select({ n: cnt }).from(S.kuniBatches).where(and(eq(S.kuniBatches.amcosId, amcosId), eq(S.kuniBatches.seasonId, season.id))) : Promise.resolve([{ n: 0 }]),
      db.select({ id: S.fxRates.id }).from(S.fxRates).where(eq(S.fxRates.amcosId, amcosId)).limit(1),
    ]);
    finance = {
      inputCurrency: a.inputCurrency, hasFxRate: fx.length > 0, mainAccountId: a.mainAccountId, accounts,
      status: { gradePrices: grades[0]?.n ?? 0, deductions: rules[0]?.n ?? 0, loanBatches: loans[0]?.n ?? 0 },
    };
  }

  // Stoo: kiwango cha chini cha kila bidhaa + salio la msimu
  let stock = null;
  if (acc.view.stock) {
    const I = S.inputItems; const M = S.stockMovements;
    const rows = await db.select({
      id: I.id, name: I.name, unit: I.unit, category: I.category, reorderLevel: I.reorderLevel,
      balance: season ? sql<string>`coalesce((select sum(${M.quantity}) from ${M} where ${M.inputItemId} = ${I.id} and ${M.seasonId} = ${season.id}), 0)` : sql<string>`0`,
    }).from(I).where(and(eq(I.amcosId, amcosId), eq(I.isActive, true))).orderBy(asc(I.category), asc(I.name));
    const items = rows.map((r) => ({ ...r, low: r.reorderLevel !== null && Number(r.balance) <= Number(r.reorderLevel) }));
    stock = { items, low: items.filter((i) => i.low).length, withoutLevel: items.filter((i) => i.reorderLevel === null).length };
  }

  // SMS (kikomo kinawekwa na Owner)
  let sms = null;
  if (acc.view.sms) {
    const [L, used, on, total] = await Promise.all([
      getSetting('sms.limits'), broadcastUsedThisMonth(amcosId), smsEnabled('CHAMA_BROADCAST'),
      db.execute<{ n: number; failed: number }>(sql`select coalesce(sum(segments) filter (where status in ('SENT','DELIVERED','QUEUED')), 0)::int as n,
        count(*) filter (where status = 'FAILED')::int as failed from sms_logs
        where amcos_id = ${amcosId} and created_at >= date_trunc('month', now() at time zone 'Africa/Dar_es_Salaam') at time zone 'Africa/Dar_es_Salaam'`),
    ]);
    sms = { enabled: on && smsConfigured(), limit: L.broadcastPerMonth, used, remaining: Math.max(L.broadcastPerMonth - used, 0), allThisMonth: total.rows[0]?.n ?? 0, failedThisMonth: total.rows[0]?.failed ?? 0 };
  }

  const main = finance?.accounts.find((x) => x.id === a.mainAccountId)
    ?? (a.mainAccountId ? (await db.select({ name: S.financeAccounts.name, bankName: S.financeAccounts.bankName, accountNumber: S.financeAccounts.accountNumber }).from(S.financeAccounts).where(eq(S.financeAccounts.id, a.mainAccountId)))[0] : undefined);

  const recent = await db.select({ id: S.auditLogs.id, action: S.auditLogs.action, entity: S.auditLogs.entity, createdAt: S.auditLogs.createdAt, by: S.users.fullName, role: S.auditLogs.userRole })
    .from(S.auditLogs).leftJoin(S.users, eq(S.users.id, S.auditLogs.userId))
    .where(and(eq(S.auditLogs.amcosId, amcosId), inArray(S.auditLogs.action, SETTINGS_ACTIONS)))
    .orderBy(desc(S.auditLogs.createdAt)).limit(10);

  res.json({
    access: acc,
    profile: {
      name: a.name, code: a.code, regNumber: a.regNumber, regDate: a.regDate, tin: a.tin,
      region: a.region, district: a.district, ward: a.ward, village: a.village, phone: a.phone, email: a.email, postalAddress: a.postalAddress,
      leaders: a.leaders ?? [], logo: a.logo, completeness: completeness(a), training: a.training,
    },
    season: { current: season ? { name: season.name, status: season.status, startDate: season.startDate, endDate: season.endDate } : null, kgPerAcre: a.kgPerAcre },
    farmers: { portal: a.farmerPortal, members: members[0]?.n ?? 0, lastMemberNo: lastMember[0]?.no ?? null, code: a.code },
    finance, stock, sms,
    docs: { footer: a.docFooter, showBank: a.docShowBank, bank: main ? { name: main.name, bankName: main.bankName, accountNumber: main.accountNumber } : null },
    recent: acc.edit.profile || acc.edit.finance || acc.edit.docs ? recent : [],
  });
}));

// ------------------------------ PROFAILI (Meneja) ------------------------------
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();
const txt = (max: number) => opt(z.string().trim().max(max).transform((v) => v || null));
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const LOGO_MAX = 90_000; // herufi za data URL (~65KB) — nembo ndogo tu, si picha kubwa

const profileBody = z.object({
  name: opt(z.string().trim().min(3).max(120)),
  regNumber: txt(60),
  region: txt(60), district: txt(60), ward: txt(60), village: txt(60),
  phone: opt(z.union([z.literal(''), phoneSchema]).transform((v) => v || null)),
  email: opt(z.union([z.literal(''), z.string().trim().email('Email si sahihi')]).transform((v) => v || null)),
  postalAddress: txt(120),
  tin: opt(z.string().trim().regex(/^(\d{3}-?\d{3}-?\d{3})?$/, 'TIN iwe tarakimu 9 (mf. 123-456-789)').transform((v) => v || null)),
  regDate: opt(z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || null))
    .refine((v) => !v || v <= new Date().toISOString().slice(0, 10), 'Tarehe ya usajili haiwezi kuwa ya baadaye'),
  leaders: opt(z.array(z.object({
    role: z.enum(LEADER_ROLES),
    name: z.string().trim().min(3, 'Andika jina kamili la kiongozi').max(80),
    phone: opt(z.union([z.literal(''), phoneSchema]).transform((v) => v || null)).transform((v) => v ?? null),
  })).max(LEADER_ROLES.length).refine((l) => new Set(l.map((x) => x.role)).size === l.length, 'Nafasi moja imerudiwa')),
}).strict();
const logoSchema = opt(z.string().max(LOGO_MAX, 'Nembo ni kubwa mno — tumia picha ndogo (chini ya 60KB)').refine((v) => LOGO_RE.test(v), 'Nembo iwe picha ya PNG, JPG au WEBP'));

settingsRouter.put('/profile', ah(async (req, res) => {
  const auth = req.auth!;
  const acc = settingsAccess(auth);
  if (!acc.edit.profile) throw forbidden('Ni Meneja pekee anayeweza kubadilisha profaili ya chama');
  const b = profileBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const before = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) });
  if (!before) throw notFound('Chama');
  // Utambulisho rasmi (jina, namba ya usajili) ni wa Owner tu — linalinganishwa ili fomu inayotuma thamani ile ile isikataliwe
  if (!acc.edit.identity && ((b.name !== undefined && b.name !== before.name) || (b.regNumber !== undefined && (b.regNumber ?? null) !== (before.regNumber ?? null)))) {
    throw forbidden('Jina na namba ya usajili wa chama vinabadilishwa na CoopLink tu — wasiliana nasi kupitia Help & Support');
  }
  const { name, regNumber, ...rest } = b;
  const patch: Partial<typeof schema.amcos.$inferInsert> = { ...rest, ...(acc.edit.identity ? { ...(name ? { name } : {}), ...(regNumber !== undefined ? { regNumber } : {}) } : {}) };
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) throw badRequest('Hakuna kilichobadilishwa');
  const pick = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
  await db.transaction(async (tx) => {
    await tx.update(schema.amcos).set(patch).where(eq(schema.amcos.id, amcosId));
    await audit(tx, req, { action: 'AMCOS_PROFILE_UPDATE', entity: 'Amcos', entityId: amcosId, amcosId, before: pick(before), after: pick(patch) });
  });
  res.json({ ok: true });
}));

// ------------------------------ FEDHA (Mhasibu) ------------------------------
settingsRouter.put('/finance', ah(async (req, res) => {
  if (!settingsAccess(req.auth!).edit.finance) throw forbidden('Ni Mhasibu pekee anayeweza kuweka akaunti kuu ya benki');
  const { mainAccountId } = z.object({ mainAccountId: z.string().uuid().nullable() }).strict().parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (mainAccountId) {
    const [acct] = await db.select().from(schema.financeAccounts).where(and(eq(schema.financeAccounts.id, mainAccountId), eq(schema.financeAccounts.amcosId, amcosId)));
    if (!acct) throw notFound('Akaunti');
    if (!acct.isActive) throw badRequest('Akaunti hii imesitishwa');
    if (acct.kind !== 'BANK') throw badRequest('Akaunti kuu iwe ya benki');
  }
  const before = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { mainAccountId: true } });
  await db.transaction(async (tx) => {
    await tx.update(schema.amcos).set({ mainAccountId }).where(eq(schema.amcos.id, amcosId));
    await audit(tx, req, { action: 'AMCOS_MAIN_ACCOUNT_SET', entity: 'Amcos', entityId: amcosId, amcosId, before, after: { mainAccountId } });
  });
  res.json({ mainAccountId });
}));

// ------------------------------ NYARAKA (Meneja / Mhasibu) ------------------------------
settingsRouter.put('/docs', ah(async (req, res) => {
  if (!settingsAccess(req.auth!).edit.docs) throw forbidden('Ni Meneja au Mhasibu pekee wanaoweza kubadilisha nyaraka');
  const b = z.object({ footer: txt(200), showBank: z.boolean().optional(), logo: logoSchema }).strict().parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const before = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { docFooter: true, docShowBank: true, logo: true } });
  if (!before) throw notFound('Chama');
  const patch = {
    ...(b.footer !== undefined ? { docFooter: b.footer } : {}), ...(b.showBank !== undefined ? { docShowBank: b.showBank } : {}),
    ...(b.logo !== undefined ? { logo: b.logo } : {}),
  };
  if (!Object.keys(patch).length) throw badRequest('Hakuna kilichobadilishwa');
  // Picha haiwekwi yote kwenye audit — ukubwa wake tu
  const shot = (o: { docFooter?: string | null; docShowBank?: boolean; logo?: string | null }) => ({
    ...('docFooter' in o ? { docFooter: o.docFooter } : {}), ...('docShowBank' in o ? { docShowBank: o.docShowBank } : {}),
    ...('logo' in o ? { logo: o.logo ? `[nembo · ${Math.round(o.logo.length * 0.75 / 1024)}KB]` : null } : {}),
  });
  await db.transaction(async (tx) => {
    await tx.update(schema.amcos).set(patch).where(eq(schema.amcos.id, amcosId));
    await audit(tx, req, { action: 'AMCOS_DOCS_UPDATE', entity: 'Amcos', entityId: amcosId, amcosId, before: shot(before), after: shot(patch) });
  });
  res.json({ ok: true });
}));
