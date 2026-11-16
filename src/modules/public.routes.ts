// Njia zisizohitaji kuingia, na matangazo kwa watumiaji wa vyama
import { LEGAL_EFFECTIVE, LEGAL_EFFECTIVE_EN, LEGAL_VERSION } from '../lib/legal';
import { applyDeliveryEvent, normPhone, sendNow, smsConfigured, smsEnabled, toGsm, verifyAstraSignature } from '../lib/sms';
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
import { DOC, docTypeOf, maskName } from '../lib/finance-docs';

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

// ---------------------------------------------------------------------
//  WEBHOOK YA ASTRACALL (ripoti za kufika kwa SMS)
//  Saini: X-Webhook-Signature = hex(HMAC-SHA256(ASTRACALL_WEBHOOK_SECRET, rawBody)). Tukio moja linashughulikiwa mara moja.
//  Matukio: sms.delivered, sms.failed (hali ya SMS), sender_id.* (yanarekodiwa tu), webhook.test.
// ---------------------------------------------------------------------
publicRouter.post('/astracall/webhook', ah(async (req, res) => {
  if (!process.env.ASTRACALL_WEBHOOK_SECRET) return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'Webhook haijawekwa' } });
  const raw = (req as { rawBody?: Buffer }).rawBody;
  if (!raw || !verifyAstraSignature(raw, req.header('x-webhook-signature'))) return res.status(401).json({ error: { code: 'BAD_SIGNATURE', message: 'Saini si sahihi' } });
  const id = String(req.body?.id ?? '');
  if (!id) return res.status(400).json({ error: { code: 'NO_EVENT_ID', message: 'Event ID haipo' } });
  const eventId = 'astracall:' + id;
  const [seen] = await db.select({ id: schema.teepayEvents.id }).from(schema.teepayEvents).where(eq(schema.teepayEvents.id, eventId));
  if (seen) return res.json({ ok: true, duplicate: true });
  const type = String(req.body?.event ?? '');
  const updated = await applyDeliveryEvent(type, req.body?.data ?? {});
  await db.insert(schema.teepayEvents).values({ id: eventId, type: type || 'unknown', payload: req.body ?? {} }).onConflictDoNothing();
  res.json({ ok: true, updated });
}));

// ---------------------------------------------------------------------
//  KUHAKIKI HATI YA FEDHA KWA QR (v0.42) — bila kuingia kwenye mfumo
//  Inaonyesha tu: chama, aina na namba ya hati, tarehe, kiasi, hali, na jina la mlipwaji kwa ufupi (faragha).
// ---------------------------------------------------------------------
const verifyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
publicRouter.get('/verify/:token', verifyLimiter, ah(async (req, res) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/).safeParse(req.params.token);
  if (!token.success) return res.status(404).json({ valid: false });
  const doc = await db.query.financeDocuments.findFirst({ where: eq(schema.financeDocuments.verifyToken, token.data) });
  if (!doc) return res.status(404).json({ valid: false });
  const T = schema.financeTransactions;
  const [t] = await db.select({
    txn: T, amcos: schema.amcos.name, reg: schema.amcos.regNumber,
    reversed: sql<string | null>`(select coalesce(r.doc_no, r.txn_no) from finance_transactions r where r.reversal_of_id = "finance_transactions"."id")`,
    member: sql<string | null>`(select m.first_name || ' ' || m.last_name from members m where m.id = "finance_transactions"."member_id")`,
  }).from(T).innerJoin(schema.amcos, eq(schema.amcos.id, T.amcosId)).where(eq(T.id, doc.txnId));
  if (!t) return res.status(404).json({ valid: false });
  const type = docTypeOf(t.txn.kind) ?? (t.txn.direction === 'IN' ? 'RECEIPT' : 'PAYMENT_VOUCHER');
  const status = t.reversed ? 'REVERSED' : t.txn.status;
  res.json({
    valid: true, type, title: DOC[type].title, docNo: t.txn.docNo ?? t.txn.txnNo, date: t.txn.txnDate, amount: t.txn.amount, currency: 'TZS',
    amountUsd: t.txn.amountUsd, status, reversedBy: t.reversed, amcos: t.amcos, regNumber: t.reg, party: maskName(t.txn.payee ?? t.member),
    issuedAt: t.txn.postedAt ?? t.txn.createdAt,
  });
}));
