// =====================================================================
//  ARIFA (kengele) — /api/v1/notifications
//  Mahali pamoja pa ujumbe kutoka CoopLink kwa mtumishi wa chama:
//   - matangazo ya Owner (IN_APP; kwa vyama vyote au vilivyochaguliwa) — "imesomwa" inahifadhiwa kwa mtumiaji
//   - majibu ya timu ya CoopLink kwenye tiketi za msaada (hali ya kusomwa ni ile ile ya tiketi: amcos_seen_at)
// =====================================================================
import { Router, type Request } from 'express';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, uuidParam } from '../lib/http';
import { notFound } from '../lib/errors';
import { ticketNo } from '../lib/support';
import { unreadSql, visibleTickets } from './support.routes';

export const notificationsRouter = Router();
const AN = schema.announcements, R = schema.announcementReads, T = schema.supportTickets;

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

  const items = [
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

/** Weka zote zimesomwa (matangazo + majibu ya tiketi) */
notificationsRouter.post('/read-all', ah(async (req, res) => {
  const ids = (await db.select({ id: AN.id }).from(AN).where(annScope(req))).map((x) => x.id);
  if (ids.length) await db.insert(R).values(ids.map((announcementId) => ({ announcementId, userId: req.auth!.userId }))).onConflictDoNothing();
  if (req.auth!.amcosId) {
    const tids = (await db.select({ id: T.id }).from(T).where(and(visibleTickets(req), unreadSql))).map((x) => x.id);
    if (tids.length) await db.update(T).set({ amcosSeenAt: new Date() }).where(inArray(T.id, tids));
  }
  res.json({ ok: true });
}));
