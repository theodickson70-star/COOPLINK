// =====================================================================
//  ARIFA (kengele) — /api/v1/notifications
//  Mahali pamoja pa ujumbe kutoka CoopLink kwa mtumishi wa chama:
//   - matangazo ya Owner (IN_APP; kwa vyama vyote au vilivyochaguliwa) — "imesomwa" inahifadhiwa kwa mtumiaji
//   - majibu ya timu ya CoopLink kwenye tiketi za msaada (hali ya kusomwa ni ile ile ya tiketi: amcos_seen_at)
//   - v2.7: RISITI za ada ya CoopLink (Meneja/Mhasibu) — zinatoka zenyewe malipo yakithibitishwa
// =====================================================================
import { Router, type Request } from 'express';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, uuidParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { ticketNo } from '../lib/support';
import { unreadSql, visibleTickets } from './support.routes';
import { tshText } from '../lib/money';
import { feeReference, SYSTEM_FEE_CATEGORY } from '../lib/fee-expense';
import { canAmcos } from '../lib/amcos-permissions';
import { stockAlerts } from '../lib/stock-overview';
import { currentSeason } from './seasons.routes';

export const notificationsRouter = Router();
const AN = schema.announcements, R = schema.announcementReads, T = schema.supportTickets;
const P = schema.platformPayments, NR = schema.notificationReads;
const FEE_ROLES = ['AMCOS_ADMIN', 'ACCOUNTANT'];
/** Risiti za ada ya CoopLink za siku 90 (chama cha mtumiaji) */
const receiptScope = (req: Request) => and(eq(P.amcosId, req.auth!.amcosId!), eq(P.status, 'VERIFIED'), sql`${P.feeId} is not null`, sql`${P.paidAt} > now() - interval '90 days'`);
/** v2.8: arifa za stoo — kwa watumishi wa chama wenye ruhusa ya kuona stoo (si Afisa Ushirika) */
const seesStock = (req: Request) => !!req.auth!.amcosId && req.auth!.role !== 'COOP_OFFICER' && canAmcos(req.auth!, 'stock.read');
async function stockItems(req: Request) {
  if (!seesStock(req)) return [];
  const season = await currentSeason();
  if (!season) return [];
  return stockAlerts(req.auth!.amcosId!, season.id);
}
const seesReceipts = (req: Request) => !!req.auth!.amcosId && FEE_ROLES.includes(req.auth!.role);

/** Matangazo ya ndani ya mfumo ya siku 60 yanayomhusu mtumiaji huyu (chama chake au vyama vyote) */
const annScope = (req: Request) => {
  const amcosId = req.auth!.amcosId;
  return and(
    gte(AN.createdAt, sql`now() - interval '60 days'`),
    sql`'IN_APP' = any(${AN.channels})`,
    amcosId ? sql`(${AN.audience} = 'ALL' or ${amcosId} = any(${AN.amcosIds}))` : eq(AN.audience, 'ALL'),
  );
};

notificationsRouter.get('/', ah(async (req, res) => {
  const uid = req.auth!.userId;
  const anns = await db.select({
    id: AN.id, kind: AN.kind, title: AN.title, body: AN.body, createdAt: AN.createdAt,
    readAt: R.readAt,
  }).from(AN).leftJoin(R, and(eq(R.announcementId, AN.id), eq(R.userId, uid))).where(annScope(req)).orderBy(desc(AN.createdAt)).limit(30);

  // Tiketi zenye jibu la CoopLink (siku 60) — kwa watumishi wa chama tu
  let tickets: { id: string; number: string; subject: string; status: string; at: Date; unread: boolean; preview: string | null; author: string | null }[] = [];
  if (req.auth!.amcosId) {
    const rows = await db.select({ id: T.id, no: T.ticketNo, subject: T.subject, status: T.status, at: T.lastPlatformAt, unread: unreadSql }).from(T)
      .where(and(visibleTickets(req), sql`${T.lastPlatformAt} is not null`, sql`${T.lastPlatformAt} > now() - interval '60 days'`))
      .orderBy(desc(T.lastPlatformAt)).limit(20);
    const last = rows.length ? await db.execute<{ ticket_id: string; body: string; author: string }>(sql`
      select distinct on (m.ticket_id) m.ticket_id, m.body, split_part(u.full_name, ' ', 1) as author
      from support_messages m join users u on u.id = m.author_id
      where m.ticket_id in (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}) and m.side = 'PLATFORM' and m.internal = false
      order by m.ticket_id, m.created_at desc`) : { rows: [] };
    const byT = new Map(last.rows.map((x) => [x.ticket_id, x]));
    tickets = rows.map((r) => ({ id: r.id, number: ticketNo(r.no), subject: r.subject, status: r.status, at: r.at!, unread: !!r.unread,
      preview: byT.get(r.id)?.body?.slice(0, 220) ?? null, author: byT.get(r.id)?.author ?? null }));
  }

  // Risiti za ada ya CoopLink — kwa Meneja na Mhasibu
  let receipts: { id: string; no: string; amount: string; at: Date; label: string; test: boolean; doc: string | null; posted: boolean; read: boolean }[] = [];
  if (seesReceipts(req)) {
    const rows = await db.select({ id: P.id, no: P.invoiceNo, amount: P.amount, at: P.paidAt, category: P.category, label: schema.platformFees.label, readAt: NR.readAt })
      .from(P).innerJoin(schema.platformFees, eq(schema.platformFees.id, P.feeId))
      .leftJoin(NR, and(eq(NR.refId, P.id), eq(NR.userId, uid), eq(NR.kind, 'FEE_RECEIPT')))
      .where(receiptScope(req)).orderBy(desc(P.paidAt)).limit(20);
    const refs = rows.map((r) => feeReference(r.no));
    const docs = refs.length ? await db.select({ ref: schema.financeTransactions.reference, doc: schema.financeTransactions.docNo, status: schema.financeTransactions.status })
      .from(schema.financeTransactions).where(and(eq(schema.financeTransactions.amcosId, req.auth!.amcosId!), eq(schema.financeTransactions.category, SYSTEM_FEE_CATEGORY), inArray(schema.financeTransactions.reference, refs))) : [];
    const byRef = new Map(docs.map((d) => [d.ref, d]));
    receipts = rows.map((r) => {
      const d = byRef.get(feeReference(r.no));
      return { id: r.id, no: r.no, amount: r.amount, at: r.at!, label: r.label, test: r.category === 'OTHER', doc: d?.doc ?? null, posted: d?.status === 'POSTED', read: !!r.readAt };
    });
  }

  // Stoo: zilizoisha / chini ya kiwango / zinakaribia kuisha. "Imesomwa" inafungwa kwenye mwendo wa mwisho wa bidhaa:
  // ikiingia au kutoka tena na bado iko kwenye hali hiyo, arifa inarudi.
  const alerts = await stockItems(req);
  const seen = alerts.length ? new Set((await db.select({ ref: NR.refId }).from(NR).where(and(eq(NR.userId, uid), eq(NR.kind, 'STOCK_ALERT'),
    inArray(NR.refId, alerts.map((a) => a.lastMoveId!).filter(Boolean))))).map((x) => x.ref)) : new Set<string>();
  const unitTx = (u: string) => ({ BAG: 'mifuko', KG: 'kilo', LITRE: 'lita', PIECE: 'vipande', PACKET: 'pakiti', ROLL: 'roli', BOTTLE: 'chupa', SPOOL: 'spuli', METRE: 'mita' } as Record<string, string>)[u] ?? u.toLowerCase();
  const stockN = alerts.filter((a) => a.lastMoveId).map((a) => ({
    type: 'STOCK' as const, id: a.lastMoveId!, kind: `STOCK_${a.status}`, at: a.lastOut ?? a.lastIn ?? new Date().toISOString(), unread: !seen.has(a.lastMoveId!), itemId: a.id,
    title: a.status === 'OUT' ? `${a.name} imeisha stoo` : a.status === 'LOW' ? `${a.name} iko chini ya kiwango` : `${a.name} inakaribia kuisha`,
    body: a.status === 'OUT' ? `Salio ni 0. Wakulima hawawezi kupewa ${a.name} mpaka mzigo mpya uingie.`
      : `Salio ${a.balance.toLocaleString('en-US')} ${unitTx(a.unit)}${a.reorderLevel ? ` (kiwango cha chini ${Number(a.reorderLevel).toLocaleString('en-US')})` : ''}${a.daysLeft !== null ? ` — inatosha takriban siku ${a.daysLeft}` : ''}.`,
  }));

  const items = [
    ...stockN,
    ...receipts.map((r) => ({ type: 'RECEIPT' as const, id: r.id, kind: 'FEE_RECEIPT', title: `Risiti ${r.no} · ${r.label}`, at: r.at, unread: !r.read,
      body: r.test ? `Malipo ya majaribio ya ${tshText(r.amount)} yamepokelewa.`
        : `${tshText(r.amount)} imepokelewa na CoopLink. ${r.doc ? (r.posted ? `Imeandikwa kwenye matumizi ya chama (${r.doc}).` : `Imeandikwa kwenye matumizi (${r.doc}) — chagua akaunti iliyolipa ili ikamilike.`) : ''}`.trim() })),
    ...anns.map((a) => ({ type: 'ANNOUNCEMENT' as const, id: a.id, kind: a.kind, title: a.title, body: a.body, at: a.createdAt, unread: !a.readAt })),
    ...tickets.map((t) => ({ type: 'SUPPORT' as const, id: t.id, kind: 'SUPPORT', title: `${t.number} · ${t.subject}`, body: t.preview ?? '', at: t.at, unread: t.unread, author: t.author, status: t.status })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  res.json({ items, unread: items.filter((i) => i.unread).length });
}));

/** Kufungua tangazo = limesomwa */
notificationsRouter.post('/announcements/:id/read', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const [a] = await db.select({ id: AN.id }).from(AN).where(and(eq(AN.id, id), annScope(req)));
  if (!a) throw notFound('Tangazo');
  await db.insert(R).values({ announcementId: id, userId: req.auth!.userId }).onConflictDoNothing();
  res.json({ ok: true });
}));

/** Kufungua risiti = imesomwa */
notificationsRouter.post('/receipts/:id/read', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  if (!seesReceipts(req)) throw notFound('Risiti');
  const [p] = await db.select({ id: P.id }).from(P).where(and(eq(P.id, id), receiptScope(req)));
  if (!p) throw notFound('Risiti');
  await db.insert(NR).values({ userId: req.auth!.userId, kind: 'FEE_RECEIPT', refId: id }).onConflictDoNothing();
  res.json({ ok: true });
}));

/** Kufungua arifa ya stoo = imesomwa (mpaka mwendo mwingine wa bidhaa hiyo) */
notificationsRouter.post('/stock/:id/read', ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  if (!seesStock(req)) throw notFound('Arifa');
  const [m] = await db.select({ id: schema.stockMovements.id }).from(schema.stockMovements).where(and(eq(schema.stockMovements.id, id), eq(schema.stockMovements.amcosId, req.auth!.amcosId!)));
  if (!m) throw notFound('Arifa');
  await db.insert(NR).values({ userId: req.auth!.userId, kind: 'STOCK_ALERT', refId: id }).onConflictDoNothing();
  res.json({ ok: true });
}));

/** Weka zote zimesomwa (matangazo + majibu ya tiketi + risiti + stoo) */
notificationsRouter.post('/read-all', ah(async (req, res) => {
  const ids = (await db.select({ id: AN.id }).from(AN).where(annScope(req))).map((x) => x.id);
  if (ids.length) await db.insert(R).values(ids.map((announcementId) => ({ announcementId, userId: req.auth!.userId }))).onConflictDoNothing();
  const al = (await stockItems(req)).map((a) => a.lastMoveId).filter((x): x is string => !!x);
  if (al.length) await db.insert(NR).values(al.map((refId) => ({ userId: req.auth!.userId, kind: 'STOCK_ALERT', refId }))).onConflictDoNothing();
  if (seesReceipts(req)) {
    const rids = (await db.select({ id: P.id }).from(P).where(receiptScope(req))).map((x) => x.id);
    if (rids.length) await db.insert(NR).values(rids.map((refId) => ({ userId: req.auth!.userId, kind: 'FEE_RECEIPT', refId }))).onConflictDoNothing();
  }
  if (req.auth!.amcosId) {
    const tids = (await db.select({ id: T.id }).from(T).where(and(visibleTickets(req), unreadSql))).map((x) => x.id);
    if (tids.length) await db.update(T).set({ amcosSeenAt: new Date() }).where(inArray(T.id, tids));
  }
  res.json({ ok: true });
}));
