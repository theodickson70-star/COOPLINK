// =====================================================================
//  VIKUNDI VYA WAKULIMA (dhamana ya pamoja)
//   Storekeeper anaunda kikundi na kupanga wanachama -> Meneja anaidhinisha
//   Kuongeza / kutoa mwanachama kwenye kikundi hai -> idhini ya Meneja (mwenye deni hatoki)
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, uuidParam } from '../lib/http';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { issueOtp, verifiedSet, verifyOtp } from '../lib/otp';
import { smsConfigured, smsEnabled } from '../lib/sms';
import { farmerPhone } from '../lib/sms-events';
import { canAmcos } from '../lib/amcos-permissions';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2 } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import { createApproval } from '../lib/approvals';

export const groupsRouter = Router();
const G = schema.memberGroups;
const GM = schema.memberGroupMembers;
const M = schema.members;
const L = schema.memberLedgerEntries;

// ------------------------------ RIDHAA YA DHAMANA KWA OTP (v0.40) ------------------------------
//  Kuingia kikundi = kudhamini madeni ya wenzako. Kila mkulima anakubali mwenyewe kwa OTP; bila simu, Meneja anaandika sababu.
async function consentOn() { return smsConfigured() && (await smsEnabled('GROUP_CONSENT_OTP')); }
async function assertConsent(req: Request, members: { id: string; memberNo: string }[], override?: string | null) {
  if (!members.length || !(await consentOn())) return 'NONE' as const;
  const ok = await verifiedSet('GROUP_CONSENT', members.map((m) => m.id), 60);
  const missing = members.filter((m) => !ok.has(m.id));
  if (!missing.length) return 'OTP' as const;
  if (!override || override.trim().length < 10) throw new AppError(400, 'GROUP_CONSENT_REQUIRED', `Wakulima hawa hawajakubali dhamana ya kikundi kwa OTP: ${missing.map((m) => m.memberNo).join(', ')}`);
  if (!canAmcos(req.auth!, 'approvals.decide')) throw forbidden('Meneja pekee ndiye anaweza kuingiza mkulima kikundini bila ridhaa yake ya OTP');
  return 'OVERRIDE' as const;
}

const groupStats = {
  members: sql<number>`(select count(*)::int from member_group_members x where x.group_id = "member_groups"."id" and x.left_at is null)`,
  owing: sql<string>`(select coalesce(sum(-b.bal), 0) from (select sum(l.credit) - sum(l.debit) as bal from member_ledger_entries l
    where l.member_id in (select x.member_id from member_group_members x where x.group_id = "member_groups"."id" and x.left_at is null) group by l.member_id) b where b.bal < 0)`,
  // Deni la dola (pembejeo + mikopo ya kuni/grading) la wanachama wote wa kikundi
  owingUsd: sql<string>`(select coalesce(sum(greatest(b.u, 0)), 0) from (select sum(u.usd) as u from member_usd_ledger u
    where u.member_id in (select x.member_id from member_group_members x where x.group_id = "member_groups"."id" and x.left_at is null) group by u.member_id) b)`,
  inputs: sql<string>`(select coalesce(sum(l.debit - l.credit), 0) from member_ledger_entries l where l.reference_type = 'INPUT_ISSUE'
    and l.member_id in (select x.member_id from member_group_members x where x.group_id = "member_groups"."id" and x.left_at is null))`,
  leader: sql<string | null>`(select m.first_name || ' ' || m.last_name from members m where m.id = "member_groups"."leader_member_id")`,
};

/** Orodha ya vikundi (Storekeeper, Meneja na Mhasibu). Mhasibu anaona deni tu, si taarifa binafsi. */
groupsRouter.get('/', requireAmcosPerm('members.read', 'finance.read'), ah(async (req, res) => {
  const { status } = z.object({ status: z.enum(schema.groupStatusEnum.enumValues).optional() }).parse(req.query);
  const rows = await db.select({ g: G, ...groupStats }).from(G).where(and(amcosScope(req, G.amcosId), status ? eq(G.status, status) : undefined)).orderBy(asc(G.status), asc(G.name));
  res.json({ data: rows.map(({ g, ...s }) => ({ ...g, ...s, owing: fmt2(s.owing), owingUsd: fmt2(s.owingUsd), inputs: fmt2(s.inputs) })) });
}));

async function findGroup(req: Request, id: string) {
  const [g] = await db.select().from(G).where(and(eq(G.id, id), amcosScope(req, G.amcosId)));
  if (!g) throw notFound('Kikundi');
  return g;
}

groupsRouter.get('/:id', requireAmcosPerm('members.read', 'finance.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const g = await findGroup(req, id);
  const [stats] = await db.select(groupStats).from(G).where(eq(G.id, id));
  const mems = await db.select({ gm: GM, memberNo: M.memberNo, firstName: M.firstName, lastName: M.lastName, village: M.village, status: M.status }).from(GM).innerJoin(M, eq(M.id, GM.memberId))
    .where(eq(GM.groupId, id)).orderBy(sql`${GM.leftAt} nulls first`, asc(M.memberNo));
  const ids = mems.map((m) => m.gm.memberId);
  const sums = ids.length ? await db.select({ memberId: L.memberId,
    inputs: sql<string>`coalesce(sum(case when ${L.referenceType} = 'INPUT_ISSUE' then ${L.debit} - ${L.credit} else 0 end), 0)`,
    guaranteedFor: sql<string>`coalesce(sum(case when ${L.type} = 'DEDUCTION' and ${L.referenceType} = 'GROUP_GUARANTEE' then ${L.debit} else 0 end), 0)`,
    coveredByGroup: sql<string>`coalesce(sum(case when ${L.type} = 'GROUP_GUARANTEE' then ${L.credit} else 0 end), 0)`,
    balance: sql<string>`coalesce(sum(${L.credit}) - sum(${L.debit}), 0)` })
    .from(L).where(inArray(L.memberId, ids)).groupBy(L.memberId) : [];
  const by = new Map(sums.map((s) => [s.memberId, s]));
  const usdRows = ids.length ? await db.select({ memberId: schema.memberUsdLedger.memberId, usd: sql<string>`sum(${schema.memberUsdLedger.usd})` })
    .from(schema.memberUsdLedger).where(inArray(schema.memberUsdLedger.memberId, ids)).groupBy(schema.memberUsdLedger.memberId) : [];
  const usdOf = new Map(usdRows.map((u) => [u.memberId, D(u.usd).gt(0) ? fmt2(u.usd) : '0.00']));
  const pending = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, 'PENDING')));
  res.json({
    group: { ...g, ...stats, owing: fmt2(stats.owing), owingUsd: fmt2(stats.owingUsd), inputs: fmt2(stats.inputs) },
    members: mems.map((m) => {
      const s = by.get(m.gm.memberId);
      return { memberId: m.gm.memberId, memberNo: m.memberNo, name: `${m.firstName} ${m.lastName}`, village: m.village, status: m.status, joinedAt: m.gm.joinedAt, leftAt: m.gm.leftAt, removeReason: m.gm.removeReason,
        inputs: fmt2(s?.inputs ?? 0), debtUsd: usdOf.get(m.gm.memberId) ?? '0.00', guaranteedFor: fmt2(s?.guaranteedFor ?? 0), coveredByGroup: fmt2(s?.coveredByGroup ?? 0), balance: fmt2(s?.balance ?? 0) };
    }),
    pending: pending.map((p) => ({ id: p.id, requestNo: p.requestNo, type: p.type, title: p.title, createdAt: p.createdAt })),
  });
}));

const groupBody = z.object({
  name: z.string().trim().min(2, 'Weka jina la kikundi'),
  village: z.string().trim().nullable().optional(),
  memberIds: z.array(z.string().uuid()).min(2, 'Kikundi kinahitaji wanachama wawili au zaidi').max(50),
  leaderMemberId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  consentOverride: z.string().trim().max(300).optional(),
});

groupsRouter.post('/consent-otp', requireAmcosPerm('members.write'), ah(async (req, res) => {
  const b = z.object({ memberId: z.string().uuid(), groupName: z.string().trim().min(2).max(60) }).parse(req.body);
  if (!(await consentOn())) throw badRequest('OTP ya ridhaa ya kikundi haijawashwa');
  const [m] = await db.select().from(M).where(and(eq(M.id, b.memberId), amcosScope(req, M.amcosId)));
  if (!m) throw notFound('Mkulima');
  const amcos = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, m.amcosId), columns: { name: true } });
  const o = await issueOtp({ purpose: 'GROUP_CONSENT', kind: 'GROUP_CONSENT_OTP', subjectId: m.id, phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, createdById: req.auth!.userId, ip: req.ip ?? null,
    payload: { groupName: b.groupName },
    text: (c) => `${amcos?.name ?? 'Chama'}: ${m.firstName}, unaombwa kuingia kikundi "${b.groupName}". Mnadhaminiana: mmoja asipolipa deni, mauzo ya wenzake yanalipa. Ukikubali, mpe mtumishi namba ${c}.` });
  res.json(o);
}));
groupsRouter.post('/consent-otp/verify', requireAmcosPerm('members.write'), ah(async (req, res) => {
  const b = z.object({ memberId: z.string().uuid(), code: z.string().trim().min(4).max(10) }).parse(req.body);
  const [m] = await db.select({ id: M.id }).from(M).where(and(eq(M.id, b.memberId), amcosScope(req, M.amcosId)));
  if (!m) throw notFound('Mkulima');
  await verifyOtp('GROUP_CONSENT', m.id, b.code);
  res.json({ verified: true });
}));

groupsRouter.post('/', requireAmcosPerm('members.write'), ah(async (req, res) => {
  const body = groupBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const ids = [...new Set(body.memberIds)];
  if (ids.length !== body.memberIds.length) throw badRequest('Mwanachama amerudiwa kwenye orodha');
  if (body.leaderMemberId && !ids.includes(body.leaderMemberId)) throw badRequest('Kiongozi lazima awe mwanachama wa kikundi');
  const mems = await db.select().from(M).where(and(eq(M.amcosId, amcosId), inArray(M.id, ids)));
  if (mems.length !== ids.length) throw badRequest('Baadhi ya wakulima si wa chama hiki');
  const inactive = mems.filter((m) => m.status !== 'ACTIVE');
  if (inactive.length) throw badRequest(`Wakulima hawa hawajathibitishwa/hawako hai: ${inactive.map((m) => m.memberNo).join(', ')}`);
  const taken = await db.select({ memberNo: M.memberNo, group: G.name }).from(GM).innerJoin(M, eq(M.id, GM.memberId)).innerJoin(G, eq(G.id, GM.groupId))
    .where(and(inArray(GM.memberId, ids), isNull(GM.leftAt)));
  if (taken.length) throw conflict(`Tayari wako kwenye kikundi kingine: ${taken.map((t) => `${t.memberNo} (${t.group})`).join(', ')}`);
  const [dup] = await db.select({ id: G.id }).from(G).where(and(eq(G.amcosId, amcosId), sql`lower(${G.name}) = lower(${body.name})`));
  if (dup) throw conflict('Jina hili la kikundi tayari lipo');
  const consent = await assertConsent(req, mems, body.consentOverride);
  const out = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, amcosId, 'member_group');
    const [g] = await tx.insert(G).values({ amcosId, groupNo: `KIK-${pad(n, 4)}`, name: body.name, village: body.village ?? null, leaderMemberId: body.leaderMemberId ?? null, notes: body.notes ?? null, createdById: req.auth!.userId }).returning();
    await tx.insert(GM).values(ids.map((memberId) => ({ groupId: g.id, memberId, addedById: req.auth!.userId })));
    const approval = await createApproval(tx, req, {
      amcosId, type: 'GROUP_REGISTRATION', entityType: 'MemberGroup', entityId: g.id,
      title: `Kikundi ${g.groupNo} "${g.name}": wanachama ${ids.length}`, reason: body.notes ?? `Wanachama: ${mems.map((m) => `${m.firstName} ${m.lastName} (${m.memberNo})`).join(', ')}`,
      payload: { members: mems.map((m) => ({ memberNo: m.memberNo, name: `${m.firstName} ${m.lastName}` })) },
    });
    const [upd] = await tx.update(G).set({ approvalId: approval.id }).where(eq(G.id, g.id)).returning();
    await audit(tx, req, { action: 'GROUP_CREATE', entity: 'MemberGroup', entityId: g.id, amcosId, after: { ...upd, members: ids.length, consent, ...(consent === 'OVERRIDE' ? { consentOverride: body.consentOverride } : {}) } });
    return { group: upd, approval };
  });
  res.status(201).json(out);
}));

async function pendingChange(groupId: string, memberId: string) {
  const [p] = await db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, groupId), eq(schema.approvalRequests.status, 'PENDING'),
    eq(schema.approvalRequests.type, 'GROUP_CHANGE'), sql`${schema.approvalRequests.payload}->>'memberId' = ${memberId}`));
  if (p) throw conflict('Tayari kuna ombi linalomhusu mkulima huyu kwenye kikundi hiki');
}

groupsRouter.post('/:id/members', requireAmcosPerm('members.write'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { memberId, consentOverride } = z.object({ memberId: z.string().uuid(), consentOverride: z.string().trim().max(300).optional() }).parse(req.body);
  const g = await findGroup(req, id);
  if (g.status !== 'ACTIVE') throw badRequest('Wanachama wanaongezwa kwenye kikundi kilichoidhinishwa tu');
  const [m] = await db.select().from(M).where(and(eq(M.id, memberId), eq(M.amcosId, g.amcosId)));
  if (!m || m.status !== 'ACTIVE') throw badRequest('Mkulima hayuko hai (ACTIVE)');
  const [cur] = await db.select({ id: GM.id }).from(GM).where(and(eq(GM.memberId, memberId), isNull(GM.leftAt)));
  if (cur) throw conflict('Mkulima huyu tayari yuko kwenye kikundi');
  await pendingChange(id, memberId);
  const consent = await assertConsent(req, [m], consentOverride);
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId: g.amcosId, type: 'GROUP_CHANGE', entityType: 'MemberGroup', entityId: g.id,
    reason: consent === 'OVERRIDE' ? `Bila OTP ya ridhaa: ${consentOverride}` : consent === 'OTP' ? 'Mkulima amekubali dhamana kwa OTP' : undefined,
    title: `Kumwongeza ${m.firstName} ${m.lastName} (${m.memberNo}) kwenye kikundi ${g.name}`, payload: { action: 'ADD', memberId, memberNo: m.memberNo, name: `${m.firstName} ${m.lastName}` },
  }));
  res.status(202).json({ approval });
}));

groupsRouter.post('/:id/members/:memberId/remove', requireAmcosPerm('members.write'), ah(async (req, res) => {
  const { id, memberId } = z.object({ id: z.string().uuid(), memberId: z.string().uuid() }).parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Eleza sababu') }).parse(req.body);
  const g = await findGroup(req, id);
  if (g.status !== 'ACTIVE') throw badRequest('Kikundi hiki hakiko hai');
  const [cur] = await db.select({ id: GM.id }).from(GM).where(and(eq(GM.groupId, id), eq(GM.memberId, memberId), isNull(GM.leftAt)));
  if (!cur) throw notFound('Mwanachama wa kikundi');
  const [b] = await db.select({ bal: sql<string>`coalesce(sum(${L.credit}) - sum(${L.debit}), 0)` }).from(L).where(eq(L.memberId, memberId));
  if (D(b.bal).lt(0)) throw badRequest(`Mwanachama ana deni la TSh ${fmt2(D(b.bal).neg())} — hawezi kutoka kikundi mpaka amalize deni`);
  await pendingChange(id, memberId);
  const m = (await db.query.members.findFirst({ where: eq(M.id, memberId) }))!;
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId: g.amcosId, type: 'GROUP_CHANGE', entityType: 'MemberGroup', entityId: g.id, reason,
    title: `Kumtoa ${m.firstName} ${m.lastName} (${m.memberNo}) kwenye kikundi ${g.name}`, payload: { action: 'REMOVE', memberId, reason, memberNo: m.memberNo, name: `${m.firstName} ${m.lastName}` },
  }));
  res.status(202).json({ approval });
}));

