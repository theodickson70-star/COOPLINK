import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, phoneSchema, uuidParam } from '../lib/http';
import { badRequest, notFound } from '../lib/errors';
import { requireRole, ROLES } from '../middleware/auth';
import { amcosScope, resolveWriteAmcosId } from '../middleware/tenant';
import { nextNumber, pad } from '../lib/counter';
import { audit } from '../lib/audit';
import { memberBalance } from '../lib/ledger';
import { D, fmt2 } from '../lib/money';

export const membersRouter = Router();

const m = schema.members;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

const memberBody = z.object({
  firstName: z.string().trim().min(2),
  middleName: opt(z.string().trim()),
  lastName: z.string().trim().min(2),
  gender: z.enum(schema.genderEnum.enumValues),
  dateOfBirth: opt(dateStr),
  nidaNumber: opt(z.string().trim().regex(/^\d{20}$/, 'Namba ya NIDA iwe tarakimu 20')),
  phone: opt(phoneSchema),
  village: opt(z.string().trim()),
  hamlet: opt(z.string().trim()),
  photoUrl: opt(z.string().url()),
  joinedAt: dateStr.optional(),
  mobileMoneyNumber: opt(phoneSchema),
  mobileMoneyProvider: opt(z.enum(schema.mobileMoneyProviderEnum.enumValues)),
  mobileMoneyName: opt(z.string().trim()),
  bankName: opt(z.string().trim()),
  bankAccountName: opt(z.string().trim()),
  bankAccountNumber: opt(z.string().trim()),
  preferredPayment: z.enum(schema.paymentMethodEnum.enumValues).optional(),
  sharesCount: z.number().int().min(0).optional(),
  nextOfKinName: opt(z.string().trim()),
  nextOfKinPhone: opt(phoneSchema),
  nextOfKinRelation: opt(z.string().trim()),
});

/** Pata mwanachama NDANI ya wigo wa mtumiaji tu (vinginevyo 404). */
export async function findMemberScoped(req: Request, id: string) {
  const [row] = await db.select().from(m).where(and(eq(m.id, id), amcosScope(req, m.amcosId)));
  if (!row) throw notFound('Mwanachama');
  return row;
}

membersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = paginationQuery
      .extend({
        search: z.string().trim().optional(),
        status: z.enum(schema.memberStatusEnum.enumValues).optional(),
        village: z.string().trim().optional(),
      })
      .parse(req.query);
    const s = q.search ? `%${q.search}%` : null;
    const where = and(
      amcosScope(req, m.amcosId),
      q.status ? eq(m.status, q.status) : undefined,
      q.village ? ilike(m.village, q.village) : undefined,
      s ? or(ilike(m.firstName, s), ilike(m.lastName, s), ilike(m.memberNo, s), ilike(m.phone, s), ilike(m.nidaNumber, s)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(m).where(where).orderBy(asc(m.lastName), asc(m.firstName))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(m).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

membersRouter.post(
  '/',
  requireRole(ROLES.AMCOS_STAFF),
  ah(async (req, res) => {
    const body = memberBody.extend({ amcosId: z.string().uuid().optional() }).parse(req.body);
    const amcosId = await resolveWriteAmcosId(req, body.amcosId);
    const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;

    const member = await db.transaction(async (tx) => {
      const n = await nextNumber(tx, amcosId, 'member');
      const [row] = await tx
        .insert(m)
        .values({ ...body, amcosId, memberNo: `${amcos.code}-${pad(n)}`, createdById: req.auth!.userId })
        .returning();
      await audit(tx, req, { action: 'MEMBER_CREATE', entity: 'Member', entityId: row.id, amcosId, after: row });
      return row;
    });
    res.status(201).json({ member });
  }),
);

membersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const member = await findMemberScoped(req, id);
    const farms = await db.select().from(schema.farms).where(eq(schema.farms.memberId, id)).orderBy(asc(schema.farms.createdAt));
    const balance = await memberBalance(db, member.amcosId, id);
    res.json({ member, farms, balance });
  }),
);

membersRouter.patch(
  '/:id',
  requireRole(ROLES.AMCOS_STAFF),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = memberBody.partial().parse(req.body);
    const before = await findMemberScoped(req, id);
    const member = await db.transaction(async (tx) => {
      const [row] = await tx.update(m).set(body).where(eq(m.id, id)).returning();
      await audit(tx, req, { action: 'MEMBER_UPDATE', entity: 'Member', entityId: id, amcosId: before.amcosId, before, after: row });
      return row;
    });
    res.json({ member });
  }),
);

// Hali ya uanachama (hakuna kufuta mwanachama — historia ya fedha lazima ibaki)
membersRouter.patch(
  '/:id/status',
  requireRole(ROLES.AMCOS_MANAGERS),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = z.object({ status: z.enum(schema.memberStatusEnum.enumValues), reason: z.string().trim().min(3) }).parse(req.body);
    const before = await findMemberScoped(req, id);
    if (before.status === body.status) throw badRequest('Hali tayari ni hiyo');
    const member = await db.transaction(async (tx) => {
      const [row] = await tx.update(m).set({ status: body.status }).where(eq(m.id, id)).returning();
      await audit(tx, req, {
        action: 'MEMBER_STATUS_CHANGE', entity: 'Member', entityId: id, amcosId: before.amcosId,
        before: { status: before.status }, after: { status: row.status, reason: body.reason },
      });
      return row;
    });
    res.json({ member });
  }),
);

// ------------------------------ MASHAMBA ------------------------------
const farmBody = z.object({
  name: opt(z.string().trim()),
  village: opt(z.string().trim()),
  acres: decimalSchema({ min: 0.01 }),
  latitude: opt(decimalSchema({ allowNegative: true })),
  longitude: opt(decimalSchema({ allowNegative: true })),
});

membersRouter.post(
  '/:id/farms',
  requireRole(ROLES.AMCOS_STAFF),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const member = await findMemberScoped(req, id);
    const body = farmBody.parse(req.body);
    const farm = await db.transaction(async (tx) => {
      const [row] = await tx.insert(schema.farms).values({ ...body, amcosId: member.amcosId, memberId: id }).returning();
      await audit(tx, req, { action: 'FARM_CREATE', entity: 'Farm', entityId: row.id, amcosId: member.amcosId, after: row });
      return row;
    });
    res.status(201).json({ farm });
  }),
);

membersRouter.patch(
  '/:id/farms/:farmId',
  requireRole(ROLES.AMCOS_STAFF),
  ah(async (req, res) => {
    const { id, farmId } = z.object({ id: z.string().uuid(), farmId: z.string().uuid() }).parse(req.params);
    const member = await findMemberScoped(req, id);
    const body = farmBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const before = await db.query.farms.findFirst({ where: and(eq(schema.farms.id, farmId), eq(schema.farms.memberId, id)) });
    if (!before) throw notFound('Shamba');
    const farm = await db.transaction(async (tx) => {
      const [row] = await tx.update(schema.farms).set(body).where(eq(schema.farms.id, farmId)).returning();
      await audit(tx, req, { action: 'FARM_UPDATE', entity: 'Farm', entityId: farmId, amcosId: member.amcosId, before, after: row });
      return row;
    });
    res.json({ farm });
  }),
);

// ------------------------------ TAARIFA YA FEDHA (STATEMENT) ------------------------------
membersRouter.get(
  '/:id/statement',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const { seasonId } = z.object({ seasonId: z.string().uuid().optional() }).parse(req.query);
    const member = await findMemberScoped(req, id);
    const l = schema.memberLedgerEntries;
    const entries = await db
      .select()
      .from(l)
      .where(and(eq(l.amcosId, member.amcosId), eq(l.memberId, id), seasonId ? eq(l.seasonId, seasonId) : undefined))
      .orderBy(asc(l.createdAt), asc(l.id));

    let running = D(0);
    const lines = entries.map((e) => {
      running = running.plus(e.credit).minus(e.debit);
      return { ...e, runningBalance: fmt2(running) };
    });
    res.json({
      member: { id: member.id, memberNo: member.memberNo, name: `${member.firstName} ${member.lastName}` },
      entries: lines,
      summary: await memberBalance(db, member.amcosId, id, seasonId),
    });
  }),
);

// Rekodi za karibuni za mwanachama (kwa ukurasa wa mwanachama)
membersRouter.get(
  '/:id/activity',
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const member = await findMemberScoped(req, id);
    const a = schema.auditLogs;
    const rows = await db.select().from(a)
      .where(and(eq(a.amcosId, member.amcosId), eq(a.entity, 'Member'), eq(a.entityId, id)))
      .orderBy(desc(a.createdAt)).limit(50);
    res.json({ data: rows });
  }),
);
