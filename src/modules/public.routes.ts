// Njia zisizohitaji kuingia, na matangazo kwa watumiaji wa vyama
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
  res.json({ maintenance: m, banner: b.enabled ? b : null, brand: { productName: p.productName, companyName: p.companyName, slogan: p.slogan } });
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
