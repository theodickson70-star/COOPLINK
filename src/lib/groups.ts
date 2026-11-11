// =====================================================================
//  VIKUNDI VYA WAKULIMA — usajili kwa idhini ya Meneja, kuongeza/kutoa mwanachama kwa idhini
// =====================================================================
import type { Request } from 'express';
import { smsGroupMemberChange, smsGroupRegistered } from './sms-events';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DbOrTx, type Tx } from '../db';
import { badRequest, conflict } from './errors';
import { audit } from './audit';
import { memberBalance } from './ledger';
import { D } from './money';

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;
const G = schema.memberGroups;
const GM = schema.memberGroupMembers;

/** Kikundi kinachotumika (ACTIVE) cha kila mkulima. */
export async function activeGroups(tx: DbOrTx, memberIds: string[]) {
  if (!memberIds.length) return new Map<string, { groupId: string; name: string; groupNo: string }>();
  const rows = await tx.select({ memberId: GM.memberId, groupId: G.id, name: G.name, groupNo: G.groupNo }).from(GM).innerJoin(G, eq(G.id, GM.groupId))
    .where(and(inArray(GM.memberId, memberIds), isNull(GM.leftAt), eq(G.status, 'ACTIVE')));
  return new Map(rows.map((r) => [r.memberId, { groupId: r.groupId, name: r.name, groupNo: r.groupNo }]));
}

/** Wanachama wa sasa wa vikundi hivi (groupId -> memberIds). */
export async function groupMembers(tx: DbOrTx, groupIds: string[]) {
  const out = new Map<string, string[]>();
  if (!groupIds.length) return out;
  const rows = await tx.select({ groupId: GM.groupId, memberId: GM.memberId }).from(GM).where(and(inArray(GM.groupId, groupIds), isNull(GM.leftAt)));
  for (const r of rows) out.set(r.groupId, [...(out.get(r.groupId) ?? []), r.memberId]);
  return out;
}

export async function onGroupRegistration(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const [g] = await tx.select().from(G).where(eq(G.id, a.entityId!)).for('update');
  if (!g || g.status !== 'PENDING') throw conflict('Kikundi hiki hakisubiri idhini');
  if (o === 'APPROVED') {
    await tx.update(G).set({ status: 'ACTIVE' }).where(eq(G.id, g.id));
    await smsGroupRegistered(tx, g.id);
  } else {
    await tx.update(G).set({ status: 'REJECTED' }).where(eq(G.id, g.id));
    // wanachama wanaachiwa ili waweze kuunda/kujiunga na kikundi kingine
    await tx.update(GM).set({ leftAt: new Date(), removedById: req.auth!.userId, removeReason: `Kikundi ${o === 'REJECTED' ? 'kimekataliwa' : 'kimeondolewa'}: ${note}` })
      .where(and(eq(GM.groupId, g.id), isNull(GM.leftAt)));
  }
  await audit(tx, req, { action: `GROUP_${o}`, entity: 'MemberGroup', entityId: g.id, amcosId: a.amcosId, before: { status: g.status }, after: { note } });
}

export async function onGroupChange(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  if (o !== 'APPROVED') return;
  const p = a.payload as { action: 'ADD' | 'REMOVE'; memberId: string; reason?: string | null };
  const [g] = await tx.select().from(G).where(eq(G.id, a.entityId!));
  if (!g || g.status !== 'ACTIVE') throw conflict('Kikundi hiki hakiko hai');
  if (p.action === 'ADD') {
    const m = await tx.query.members.findFirst({ where: eq(schema.members.id, p.memberId) });
    if (!m || m.status !== 'ACTIVE') throw badRequest('Mkulima hayuko hai (ACTIVE)');
    const [cur] = await tx.select({ id: GM.id }).from(GM).where(and(eq(GM.memberId, p.memberId), isNull(GM.leftAt)));
    if (cur) throw conflict('Mkulima huyu tayari yuko kwenye kikundi kingine');
    await tx.insert(GM).values({ groupId: g.id, memberId: p.memberId, addedById: a.requestedById });
  } else {
    const bal = await memberBalance(tx, a.amcosId, p.memberId);
    if (D(bal.amountOwed).gt(0)) throw badRequest(`Mwanachama ana deni la TSh ${bal.amountOwed} — hawezi kutoka kikundi mpaka amalize deni`);
    const r = await tx.update(GM).set({ leftAt: new Date(), removedById: req.auth!.userId, removeReason: p.reason ?? note })
      .where(and(eq(GM.groupId, g.id), eq(GM.memberId, p.memberId), isNull(GM.leftAt))).returning();
    if (!r.length) throw conflict('Mkulima huyu hayupo kwenye kikundi hiki');
  }
  await audit(tx, req, { action: `GROUP_MEMBER_${p.action}`, entity: 'MemberGroup', entityId: g.id, amcosId: a.amcosId, after: { memberId: p.memberId, note } });
  await smsGroupMemberChange(tx, g.id, p.memberId, p.action);
}
