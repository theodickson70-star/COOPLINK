// Vyama Vikuu (unions) na Vyama vya Msingi (amcos)
import { Router } from 'express';
import { z } from 'zod';
import { generateAmcosCode } from '../lib/amcos-code';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, paged, paginationQuery, phoneSchema, uuidParam } from '../lib/http';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { requireRole, ROLES } from '../middleware/auth';
import { amcosScope, canAccessAmcos } from '../middleware/tenant';
import { ensureEntranceFee } from '../lib/fees';
import { audit } from '../lib/audit';

export const unionsRouter = Router();
export const amcosRouter = Router();

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,12}$/, 'Code iwe herufi/namba 2-12 bila nafasi');

// ------------------------------ UNIONS ------------------------------
const unionBody = z.object({
  name: z.string().trim().min(3),
  code: codeSchema,
  regNumber: z.string().trim().optional(),
  region: z.string().trim().optional(),
  district: z.string().trim().optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
});

unionsRouter.get(
  '/',
  ah(async (req, res) => {
    const me = req.auth!;
    const where = me.role === 'SUPER_ADMIN' ? undefined : me.unionId ? eq(schema.unions.id, me.unionId) : undefined;
    if (me.role !== 'SUPER_ADMIN' && !me.unionId) {
      // Mtumiaji wa chama: anaona Chama Kikuu chake tu
      const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, me.amcosId!) });
      const rows = a?.unionId ? await db.select().from(schema.unions).where(eq(schema.unions.id, a.unionId)) : [];
      return res.json({ data: rows });
    }
    res.json({ data: await db.select().from(schema.unions).where(where).orderBy(asc(schema.unions.name)) });
  }),
);

unionsRouter.post(
  '/',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const body = unionBody.parse(req.body);
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.insert(schema.unions).values(body).returning();
      await audit(tx, req, { action: 'UNION_CREATE', entity: 'Union', entityId: u.id, after: u });
      return u;
    });
    res.status(201).json({ union: row });
  }),
);

unionsRouter.patch(
  '/:id',
  requireRole(ROLES.SUPER),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = unionBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const before = await db.query.unions.findFirst({ where: eq(schema.unions.id, id) });
    if (!before) throw notFound('Chama Kikuu');
    const row = await db.transaction(async (tx) => {
      const [u] = await tx.update(schema.unions).set(body).where(eq(schema.unions.id, id)).returning();
      await audit(tx, req, { action: 'UNION_UPDATE', entity: 'Union', entityId: id, before, after: u });
      return u;
    });
    res.json({ union: row });
  }),
);

// ------------------------------ AMCOS ------------------------------
const amcosBody = z.object({ // code: hiari — isipotumwa, mfumo unaitoa
  unionId: z.string().uuid().optional(),
  name: z.string().trim().min(3),
  code: codeSchema.optional(),
  regNumber: z.string().trim().optional(),
  region: z.string().trim().optional(),
  district: z.string().trim().optional(),
  ward: z.string().trim().optional(),
  village: z.string().trim().optional(),
  phone: phoneSchema.optional(),
  email: z.string().email().optional(),
});

amcosRouter.get(
  '/',
  ah(async (req, res) => {
    const q = paginationQuery.extend({ search: z.string().optional() }).parse(req.query);
    const where = and(
      amcosScope(req, schema.amcos.id),
      q.search ? or(ilike(schema.amcos.name, `%${q.search}%`), ilike(schema.amcos.code, `%${q.search}%`)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(schema.amcos).where(where).orderBy(asc(schema.amcos.name))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(schema.amcos).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

amcosRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    if (!(await canAccessAmcos(req, id))) throw notFound('Chama');
    const row = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, id), with: { union: true } });
    if (!row) throw notFound('Chama');
    res.json({ amcos: row });
  }),
);

amcosRouter.post(
  '/',
  requireRole(['SUPER_ADMIN', 'UNION_ADMIN']),
  ah(async (req, res) => {
    const body = amcosBody.parse(req.body);
    if (req.auth!.role === 'UNION_ADMIN') body.unionId = req.auth!.unionId!;
    if (body.unionId && !(await db.query.unions.findFirst({ where: eq(schema.unions.id, body.unionId) }))) {
      throw badRequest('Chama Kikuu hakipo');
    }
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.insert(schema.amcos).values({ ...body, code: body.code ?? (await generateAmcosCode(tx, body.name)) }).returning();
      if (a.status === 'ACTIVE') await ensureEntranceFee(tx, a.id, req.auth!.userId);
      await audit(tx, req, { action: 'AMCOS_CREATE', entity: 'Amcos', entityId: a.id, amcosId: a.id, after: a });
      return a;
    });
    res.status(201).json({ amcos: row });
  }),
);

amcosRouter.patch(
  '/:id',
  requireRole(['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN']),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    if (!(await canAccessAmcos(req, id))) throw notFound('Chama');
    const body = amcosBody.partial().extend({ isActive: z.boolean().optional(), farmerPortal: z.boolean().optional() }).parse(req.body);
    // Portal ya wakulima inawashwa/kuzimwa na Meneja wa chama (au Msimamizi wa mfumo) tu
    if (body.farmerPortal !== undefined && !['AMCOS_ADMIN', 'SUPER_ADMIN'].includes(req.auth!.role)) throw forbidden('Ni Meneja wa chama pekee anayeweza kuwasha au kuzima portal ya wakulima');
    // Code ni sehemu ya namba za wanachama — haibadilishwi. Union na hali ni za juu tu.
    if (body.code) throw badRequest('Code ya chama haiwezi kubadilishwa');
    if (req.auth!.role !== 'SUPER_ADMIN' && (body.unionId !== undefined || body.isActive !== undefined)) {
      throw forbidden('Ni Msimamizi wa mfumo pekee anayeweza kubadilisha hili');
    }
    const before = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, id) });
    const row = await db.transaction(async (tx) => {
      const [a] = await tx.update(schema.amcos).set(body).where(eq(schema.amcos.id, id)).returning();
      await audit(tx, req, { action: 'AMCOS_UPDATE', entity: 'Amcos', entityId: id, amcosId: id, before, after: a });
      return a;
    });
    res.json({ amcos: row });
  }),
);
