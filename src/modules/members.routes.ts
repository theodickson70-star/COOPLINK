import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, phoneSchema, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { activeGroups } from '../lib/groups';
import { hasAmcosPerm } from '../lib/amcos-permissions';
import { createApproval } from '../lib/approvals';
import { lookupNameOrNull, splitName } from '../lib/name-lookup';
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
  // Namba ya uanachama aliyopewa na chama zamani. Ikiachwa wazi, mfumo unaitoa (mf. USOKE-000001).
  memberNo: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/.\- ]{0,29}$/, 'Namba ya uanachama iwe herufi/namba (inaweza kuwa na / au -), hadi herufi 30')),
  nidaNumber: opt(z.string().trim().regex(/^\d{20}$/, 'Namba ya NIDA iwe tarakimu 20')),
  voterIdNumber: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9\- ]{5,24}$/, 'Namba ya kadi ya mpiga kura si sahihi')),
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
  entryFee: opt(decimalSchema({ min: 0 })),
  // "Alishalipa kabla ya CoopLink" — inahitaji namba ya risiti ya zamani. Malipo mapya yanarekodiwa na Mhasibu.
  entryFeePaid: z.boolean().optional(),
  entryFeePaidAt: opt(dateStr),
  entryFeeReference: opt(z.string().trim().max(60)),
  guarantorName: opt(z.string().trim().min(3, 'Jina la mzamini angalau herufi 3')),
  guarantorPhone: opt(phoneSchema),
});

type MemberNames = Partial<Pick<z.infer<typeof memberBody>, 'firstName' | 'middleName' | 'lastName' | 'phone' | 'guarantorName' | 'guarantorPhone' | 'nextOfKinName' | 'nextOfKinPhone' | 'mobileMoneyNumber' | 'mobileMoneyName'>>;
/**
 * Majina yanatoka kwenye usajili wa mobile money wa namba husika (Abliner Name Lookup) — hayaandikwi kwa mkono.
 * Mkulima asiye na simu: jina lake linaandikwa (hakuna namba ya kuthibitisha).
 */
async function verifyMemberNames(body: MemberNames, before?: { phone: string | null }) {
  const ph = body.phone !== undefined ? body.phone : before?.phone;
  const touchesName = body.phone !== undefined || body.firstName !== undefined || body.middleName !== undefined || body.lastName !== undefined;
  if (ph && touchesName) {
    const n = await lookupNameOrNull(ph, 'Simu ya mkulima');
    if (n) Object.assign(body, splitName(n));
  }
  const pairs = [['guarantorPhone', 'guarantorName', 'Simu ya mzamini'], ['nextOfKinPhone', 'nextOfKinName', 'Simu ya mrithi'], ['mobileMoneyNumber', 'mobileMoneyName', 'Namba ya malipo ya simu']] as const;
  for (const [pk, nk, label] of pairs) {
    const v = body[pk];
    if (v) { const n = await lookupNameOrNull(v, label); if (n) body[nk] = n; }
  }
}

function checkEntryFee(b: { entryFeePaid?: boolean; entryFeeReference?: string | null }, before?: { entryFeeReference: string | null }) {
  if (b.entryFeePaid && !(b.entryFeeReference ?? before?.entryFeeReference)) throw badRequest('Weka namba ya risiti ya kiingilio');
}

/** Namba za uanachama na vitambulisho visijirudie ndani ya chama — ujumbe unaoeleweka. */
async function assertUnique(amcosId: string, b: { memberNo?: string | null; nidaNumber?: string | null; voterIdNumber?: string | null }, exceptId?: string) {
  const checks: [keyof typeof b, string][] = [['memberNo', 'Namba ya uanachama'], ['nidaNumber', 'Namba ya NIDA'], ['voterIdNumber', 'Namba ya kadi ya mpiga kura']];
  for (const [k, label] of checks) {
    const v = b[k];
    if (!v) continue;
    const [dup] = await db.select({ id: m.id, memberNo: m.memberNo, firstName: m.firstName, lastName: m.lastName }).from(m)
      .where(and(eq(m.amcosId, amcosId), eq(m[k], v), exceptId ? ne(m.id, exceptId) : undefined));
    if (dup) throw conflict(`${label} ${v} tayari ni ya ${dup.firstName} ${dup.lastName} (${dup.memberNo})`);
  }
}

/** Pata mwanachama NDANI ya wigo wa mtumiaji tu (vinginevyo 404). */
export async function findMemberScoped(req: Request, id: string) {
  const [row] = await db.select().from(m).where(and(eq(m.id, id), amcosScope(req, m.amcosId)));
  if (!row) throw notFound('Mwanachama');
  return row;
}

/** Kutafuta mkulima kwa malipo (Mhasibu): jina, namba na kijiji tu — hakuna taarifa binafsi. */
membersRouter.get(
  '/lookup',
  requireAmcosPerm('members.lookup'),
  ah(async (req, res) => {
    const q = paginationQuery.extend({ search: z.string().trim().optional(), status: z.enum(schema.memberStatusEnum.enumValues).optional() }).parse(req.query);
    const s = q.search ? `%${q.search}%` : null;
    const where = and(amcosScope(req, m.amcosId), q.status ? eq(m.status, q.status) : undefined,
      s ? or(ilike(m.firstName, s), ilike(m.lastName, s), ilike(m.memberNo, s), ilike(m.phone, s)) : undefined);
    const cols = { id: m.id, memberNo: m.memberNo, firstName: m.firstName, lastName: m.lastName, village: m.village, status: m.status };
    const [rows, [{ total }]] = await Promise.all([
      db.select(cols).from(m).where(where).orderBy(asc(m.lastName), asc(m.firstName)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(m).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

membersRouter.get(
  '/',
  requireAmcosPerm('members.read'),
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
      s ? or(ilike(m.firstName, s), ilike(m.lastName, s), ilike(m.memberNo, s), ilike(m.phone, s), ilike(m.nidaNumber, s), ilike(m.voterIdNumber, s)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(m).where(where).orderBy(asc(m.lastName), asc(m.firstName))
        .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ total: count() }).from(m).where(where),
    ]);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

// Mtumishi anasajili -> mkulima "anasubiri uthibitisho" hadi Meneja athibitishe. Meneja akisajili mwenyewe, anakuwa hai moja kwa moja.
membersRouter.post(
  '/',
  requireAmcosPerm('members.write'),
  ah(async (req, res) => {
    const body = memberBody.extend({ amcosId: z.string().uuid().optional() }).parse(req.body);
    const amcosId = await resolveWriteAmcosId(req, body.amcosId);
    const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) }))!;
    checkEntryFee(body);
    await verifyMemberNames(body);
    await assertUnique(amcosId, body);
    const { memberNo: givenNo, amcosId: _ignored, ...data } = body;

    const member = await db.transaction(async (tx) => {
      // Namba iliyopo (ya zamani) au mpya kutoka mfumo — mpya inaruka namba zilizokwisha chukuliwa
      let memberNo = givenNo ?? '';
      while (!memberNo) {
        const candidate = `${amcos.code}-${pad(await nextNumber(tx, amcosId, 'member'))}`;
        const taken = await tx.select({ id: m.id }).from(m).where(and(eq(m.amcosId, amcosId), eq(m.memberNo, candidate)));
        if (!taken.length) memberNo = candidate;
      }
      const confirmer = hasAmcosPerm(req.auth!.role, 'members.approve');
      const [row] = await tx
        .insert(m)
        .values({ ...data, amcosId, memberNo, createdById: req.auth!.userId, status: confirmer ? 'ACTIVE' : 'PENDING' })
        .returning();
      await audit(tx, req, { action: 'MEMBER_CREATE', entity: 'Member', entityId: row.id, amcosId, after: row });
      if (!confirmer) {
        await createApproval(tx, req, {
          amcosId, type: 'MEMBER_REGISTRATION', entityType: 'Member', entityId: row.id,
          title: `Usajili: ${row.firstName} ${row.lastName} (${row.memberNo})${row.village ? ` · ${row.village}` : ''}`,
        });
      }
      return row;
    });
    res.status(201).json({ member });
  }),
);

membersRouter.get(
  '/:id',
  requireAmcosPerm('members.read'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const member = await findMemberScoped(req, id);
    const farms = await db.select().from(schema.farms).where(eq(schema.farms.memberId, id)).orderBy(asc(schema.farms.createdAt));
    // Stokipa haoni taarifa za fedha za mkulima
    const balance = hasAmcosPerm(req.auth!.role, 'ledger.read') ? await memberBalance(db, member.amcosId, id) : null;
    const [photo] = await db.select({ updatedAt: schema.memberPhotos.updatedAt }).from(schema.memberPhotos).where(eq(schema.memberPhotos.memberId, id));
    const group = (await activeGroups(db, [member.id])).get(member.id) ?? null;
    res.json({ member, farms, balance, group, photo: photo ? { updatedAt: photo.updatedAt } : null });
  }),
);

membersRouter.patch(
  '/:id',
  requireAmcosPerm('members.write'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = memberBody.partial().parse(req.body);
    const before = await findMemberScoped(req, id);
    if (body.memberNo !== undefined && body.memberNo !== before.memberNo) {
      // Namba ya uanachama inabadilishwa na Meneja tu (inatumika kwenye risiti na ripoti)
      if (!hasAmcosPerm(req.auth!.role, 'members.approve')) throw badRequest('Namba ya uanachama inabadilishwa na Meneja tu');
      if (!body.memberNo) throw badRequest('Namba ya uanachama haiwezi kuwa tupu');
    }
    checkEntryFee(body, before);
    await verifyMemberNames(body, before);
    await assertUnique(before.amcosId, body, id);
    const member = await db.transaction(async (tx) => {
      const [row] = await tx.update(m).set({ ...body, memberNo: body.memberNo ?? undefined }).where(eq(m.id, id)).returning();
      await audit(tx, req, { action: 'MEMBER_UPDATE', entity: 'Member', entityId: id, amcosId: before.amcosId, before, after: row });
      return row;
    });
    res.json({ member });
  }),
);

// Hali ya uanachama (hakuna kufuta mwanachama — historia ya fedha lazima ibaki)
membersRouter.patch(
  '/:id/status',
  requireAmcosPerm('members.approve'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'EXITED', 'DECEASED']), reason: z.string().trim().min(3) }).parse(req.body);
    const before = await findMemberScoped(req, id);
    if (before.status === 'PENDING') throw badRequest('Mkulima huyu anasubiri uthibitisho — tumia ukurasa wa Idhini');
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
  requireAmcosPerm('members.write'),
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
  requireAmcosPerm('members.write'),
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
  requireAmcosPerm('ledger.read'),
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
  requireAmcosPerm('members.read'),
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

// ------------------------------ PICHA YA MKULIMA (hiari) ------------------------------
const P = schema.memberPhotos;
const MAX_PHOTO = 400 * 1024; // baada ya kupunguzwa kwenye kifaa, picha ni ~30-80KB

membersRouter.get(
  '/:id/photo',
  requireAmcosPerm('members.read'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    await findMemberScoped(req, id);
    const [p] = await db.select().from(P).where(eq(P.memberId, id));
    if (!p) throw notFound('Picha');
    res.setHeader('Content-Type', p.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(p.data, 'base64'));
  }),
);

membersRouter.put(
  '/:id/photo',
  requireAmcosPerm('members.write'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const body = z.object({
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      data: z.string().min(100).regex(/^[A-Za-z0-9+/=]+$/, 'Picha si sahihi'),
    }).parse(req.body);
    const member = await findMemberScoped(req, id);
    const size = Buffer.byteLength(body.data, 'base64');
    if (size > MAX_PHOTO) throw badRequest('Picha ni kubwa mno (zaidi ya 400KB)');
    await db.transaction(async (tx) => {
      await tx.insert(P).values({ memberId: id, mimeType: body.mimeType, data: body.data, sizeBytes: size, uploadedById: req.auth!.userId })
        .onConflictDoUpdate({ target: P.memberId, set: { mimeType: body.mimeType, data: body.data, sizeBytes: size, uploadedById: req.auth!.userId, updatedAt: sql`now()` } });
      await audit(tx, req, { action: 'MEMBER_PHOTO_SET', entity: 'Member', entityId: id, amcosId: member.amcosId, after: { sizeBytes: size, mimeType: body.mimeType } });
    });
    res.json({ ok: true, sizeBytes: size });
  }),
);

membersRouter.delete(
  '/:id/photo',
  requireAmcosPerm('members.write'),
  ah(async (req, res) => {
    const { id } = uuidParam.parse(req.params);
    const member = await findMemberScoped(req, id);
    await db.transaction(async (tx) => {
      await tx.delete(P).where(eq(P.memberId, id));
      await audit(tx, req, { action: 'MEMBER_PHOTO_REMOVE', entity: 'Member', entityId: id, amcosId: member.amcosId });
    });
    res.json({ ok: true });
  }),
);
