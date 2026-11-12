// Njia zisizohitaji kuingia, na matangazo kwa watumiaji wa vyama
import { LEGAL_EFFECTIVE, LEGAL_EFFECTIVE_EN, LEGAL_VERSION } from '../lib/legal';
import { normPhone, sendNow, smsConfigured, smsEnabled, toGsm } from '../lib/sms';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { badRequest } from '../lib/errors';
import { Router } from 'express';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah } from '../lib/http';
import { getSetting } from '../lib/settings';
import { teepayConfig, verifyWebhookSignature } from '../lib/teepay';
import { syncAblinerWebhook, syncMobilePayment } from '../lib/fees';
import { ablinerConfig, verifyAblinerSignature } from '../lib/abliner';

export const publicRouter = Router();

// Hali ya mfumo kwa ukurasa wa kuingia (maintenance + tangazo) — hakuna siri
publicRouter.get('/status', ah(async (_req, res) => {
  const [m, b, p] = await Promise.all([getSetting('maintenance'), getSetting('banner'), getSetting('business.profile')]);
  const smsReset = smsConfigured() && (await smsEnabled('PASSWORD_RESET_OTP'));
  res.json({ sms: { passwordReset: smsReset }, maintenance: m, banner: b.enabled ? b : null, brand: { productName: p.productName, companyName: p.companyName, slogan: p.slogan, poweredBy: p.poweredBy || 'DUKALANGU SOLUTION' },
    // kwa kurasa za Masharti na Faragha: toleo na mawasiliano ya kampuni
    legal: { version: LEGAL_VERSION, effective: LEGAL_EFFECTIVE, effectiveEn: LEGAL_EFFECTIVE_EN, companyName: p.companyName, phone: p.phone, email: p.email, address: p.address, tin: p.tin, website: p.website, supportPhone: p.supportPhone, supportEmail: p.supportEmail },
    // mawasiliano ya kampuni yanayoonyeshwa kwenye mfumo (kuingia, msaada, risiti)
    contact: { companyName: p.companyName, address: p.address, phone: p.phone, email: p.email, website: p.website, supportPhone: p.supportPhone, supportEmail: p.supportEmail } });
}));

// ---------------------------------------------------------------------
//  OMBI LA MAONYESHO (tovuti ya umma): chama kinaomba kuonyeshwa COOPLINK.
//  Bila kuingia, kwa hiyo: kikomo cha maombi kwa IP, sehemu ya mtego (honeypot) dhidi ya roboti,
//  na taarifa fupi kwa SMS kwenda namba ya kampuni (kama huduma ya SMS ya tahadhari imewashwa).
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Maombi mengi kutoka mtandao huu. Jaribu tena baadaye au tupigie simu.' } },
});
const demoBody = z.object({
  name: z.string().trim().min(3, 'Andika jina lako').max(80),
  phone: z.string().trim().min(9, 'Andika namba sahihi ya simu').max(20),
  amcosName: z.string().trim().min(3, 'Andika jina la chama').max(120),
  region: z.string().trim().max(80).optional(),
  message: z.string().trim().max(600).optional(),
  website: z.string().max(0).optional(), // honeypot: binadamu haioni sehemu hii
});
publicRouter.post('/demo-request', demoLimiter, ah(async (req, res) => {
  const b = demoBody.parse(req.body);
  const phone = normPhone(b.phone);
  if (!phone) throw badRequest('Andika namba sahihi ya simu (mf. 0712 345 678)');
  const [row] = await db.insert(schema.demoRequests).values({
    name: b.name, phone, amcosName: b.amcosName, region: b.region || null, message: b.message || null, ip: req.ip ?? null,
  }).returning({ id: schema.demoRequests.id });
  const p = await getSetting('business.profile');
  const to = p.supportPhone || p.phone;
  if (to) void sendNow({ kind: 'SYSTEM_ALERT', phone: to, text: toGsm(`CoopLink: Ombi jipya la maonyesho - ${b.amcosName} (${b.region || 'eneo halijatajwa'}). ${b.name}, ${phone}.`) }).catch(() => {});
  res.status(201).json({ ok: true, id: row.id });
}));

export const announcementsRouter = Router();

// Matangazo ya ndani ya mfumo (IN_APP) ya siku 30 zilizopita kwa chama cha mtumiaji
announcementsRouter.get('/', ah(async (req, res) => {
  const amcosId = req.auth!.amcosId;
  const AN = schema.announcements;
  const rows = await db.select({ id: AN.id, kind: AN.kind, title: AN.title, body: AN.body, createdAt: AN.createdAt })
    .from(AN)
    .where(and(
      gte(AN.createdAt, sql`now() - interval '30 days'`),
      sql`'IN_APP' = any(${AN.channels})`,
      amcosId ? sql`(${AN.audience} = 'ALL' or ${amcosId} = any(${AN.amcosIds}))` : eq(AN.audience, 'ALL'),
    ))
    .orderBy(desc(AN.createdAt)).limit(5);
  res.json({ data: rows });
}));

// ---------------------------------------------------------------------
//  WEBHOOK YA TEEPAY (malipo ya ada za CoopLink kwa mitandao ya simu)
//  Saini inahakikiwa kwa raw body. Kisha malipo yanasomwa TENA kutoka TeePay (syncControlNumber),
//  kwa hiyo hakuna kinachorekodiwa kwa kuamini mwili wa ombi pekee. Tukio moja linashughulikiwa mara moja.
// ---------------------------------------------------------------------
publicRouter.post('/teepay/webhook', ah(async (req, res) => {
  const { webhookSecret } = teepayConfig();
  if (!webhookSecret) return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Webhook haijawekwa' } });
  const raw = (req as { rawBody?: Buffer }).rawBody;
  const ok = !!raw && verifyWebhookSignature(raw, req.header('x-teepay-timestamp'), req.header('x-teepay-signature'), webhookSecret);
  if (!ok) return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Saini si sahihi' } });
  const eventId = req.header('x-teepay-event-id') ?? String(req.body?.id ?? '');
  if (!eventId) return res.status(400).json({ error: { code: 'NO_EVENT_ID', message: 'Event ID haipo' } });
  const [seen] = await db.select({ id: schema.teepayEvents.id }).from(schema.teepayEvents).where(eq(schema.teepayEvents.id, eventId));
  if (seen) return res.json({ ok: true, duplicate: true });
  const type = String(req.body?.type ?? req.body?.event ?? '');
  // Malipo ya simu: data.reference = public_reference ya collection
  const ref = req.body?.data?.reference as string | undefined;
  if (type.startsWith('payment.') && ref) {
    const [mp] = await db.select({ id: schema.platformMobilePayments.id }).from(schema.platformMobilePayments).where(eq(schema.platformMobilePayments.reference, String(ref)));
    if (mp) await syncMobilePayment(mp.id); // ikishindwa -> 500 -> TeePay itarudia baadaye
  }
  await db.insert(schema.teepayEvents).values({ id: eventId, type: type || 'unknown', payload: req.body ?? {} }).onConflictDoNothing();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
//  WEBHOOK YA ABLINER (njia ya pili ya malipo ya ada kwa simu)
//  Saini: x-webhook-signature = hex(HMAC-SHA256(whsec, `${x-webhook-timestamp}.${rawBody}`)), ndani ya dakika 5.
//  Abliner wanajaribu mara 3 tu ndani ya sekunde ~7, kwa hiyo kazi ya kila saa na ukurasa wa Meneja vinahakiki pia.
// ---------------------------------------------------------------------
publicRouter.post('/abliner/webhook', ah(async (req, res) => {
  const { webhookSecret } = ablinerConfig();
  if (!webhookSecret) return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Webhook haijawekwa' } });
  const raw = (req as { rawBody?: Buffer }).rawBody;
  const ok = !!raw && verifyAblinerSignature(raw, req.header('x-webhook-timestamp'), req.header('x-webhook-signature'), webhookSecret);
  if (!ok) return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Saini si sahihi' } });
  const eventId = 'abliner:' + String(req.header('x-webhook-id') ?? req.body?.id ?? '');
  if (eventId === 'abliner:') return res.status(400).json({ error: { code: 'NO_EVENT_ID', message: 'Event ID haipo' } });
  const [seen] = await db.select({ id: schema.teepayEvents.id }).from(schema.teepayEvents).where(eq(schema.teepayEvents.id, eventId));
  if (seen) return res.json({ ok: true, duplicate: true });
  const type = String(req.body?.event ?? req.body?.type ?? '');
  if (type.startsWith('transaction.')) await syncAblinerWebhook(req.body?.data); // ikishindwa -> 500 -> Abliner wanarudia
  await db.insert(schema.teepayEvents).values({ id: eventId, type: type || 'unknown', payload: req.body ?? {} }).onConflictDoNothing();
  res.json({ ok: true });
}));
