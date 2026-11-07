// Misimu na Wanunuzi — vinasimamiwa na Msimamizi wa mfumo, vinaonekana na wote
import { Router } from 'express';
import { z } from 'zod';
import { asc, desc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, phoneSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireRole, ROLES } from '../middleware/auth';
import { audit } from '../lib/audit';

export const seasonsRouter = Router();
export const buyersRouter = Router();

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');

export async function currentSeason() {
  return db.query.seasons.findFirst({ where: eq(schema.seasons.isCurrent, true) });
}

seasonsRouter.get(
  '/',
  ah(async (_req, res) => {
    res.json({ data: await db.select().from(schema.seasons).orderBy(desc(schema.seasons.startDate)) });
  }),
);

seasonsRouter.get(
  '/current',
  ah(async (_req, res) => {
    const s = await currentSeason();
    if (!s) throw notFound('Msimu wa sasa');
    res.json({ season: s });
  }),
);

seasonsRouter.post(
  '/',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const body = z
      .object({ name: z.string().trim().regex(/^\d{4}\/\d{4}$/, 'Jina liwe kama 2026/2027'), startDate: dateStr, endDate: dateStr })
      .refine((b) => b.endDate > b.startDate, { message: 'Tarehe ya mwisho iwe baada ya kuanza', path: ['endDate'] })
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [s] = await tx.insert(schema.seasons).values(body).returning();
      await audit(tx, req, { action: 'SEASON_CREATE', entity: 'Season', entityId: s.id, after: s });
      return s;
    });
    res.status(201).json({ season: row });
  }),
);

seasonsRouter.patch(
  '/:id',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = z
      .object({ status: z.enum(schema.seasonStatusEnum.enumValues).optional(), isCurrent: z.literal(true).optional(), endDate: dateStr.optional() })
      .parse(req.body);
    const before = await db.query.seasons.findFirst({ where: eq(schema.seasons.id, id) });
    if (!before) throw notFound('Msimu');
    if (before.status === 'CLOSED' && body.status && body.status !== 'CLOSED') throw badRequest('Msimu uliofungwa haufunguliwi tena');

    const row = await db.transaction(async (tx) => {
      if (body.isCurrent) await tx.update(schema.seasons).set({ isCurrent: false }).where(ne(schema.seasons.id, id));
      const [s] = await tx.update(schema.seasons).set(body).where(eq(schema.seasons.id, id)).returning();
      await audit(tx, req, { action: 'SEASON_UPDATE', entity: 'Season', entityId: id, before, after: s });
      return s;
    });
    res.json({ season: row });
  }),
);

// ------------------------------ BUYERS ------------------------------
const buyerBody = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,15}$/),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
});

buyersRouter.get(
  '/',
  ah(async (_req, res) => {
    res.json({ data: await db.select().from(schema.buyers).orderBy(asc(schema.buyers.name)) });
  }),
);

buyersRouter.post(
  '/',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const body = buyerBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [b] = await tx.insert(schema.buyers).values(body).returning();
      await audit(tx, req, { action: 'BUYER_CREATE', entity: 'Buyer', entityId: b.id, after: b });
      return b;
    });
    res.status(201).json({ buyer: row });
  }),
);

buyersRouter.patch(
  '/:id',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = buyerBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const before = await db.query.buyers.findFirst({ where: eq(schema.buyers.id, id) });
    if (!before) throw notFound('Mnunuzi');
    const row = await db.transaction(async (tx) => {
      const [b] = await tx.update(schema.buyers).set(body).where(eq(schema.buyers.id, id)).returning();
      await audit(tx, req, { action: 'BUYER_UPDATE', entity: 'Buyer', entityId: id, before, after: b });
      return b;
    });
    res.json({ buyer: row });
  }),
);
