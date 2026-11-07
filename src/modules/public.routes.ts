// Njia zisizohitaji kuingia, na matangazo kwa watumiaji wa vyama
import { Router } from 'express';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah } from '../lib/http';
import { getSetting } from '../lib/settings';

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
