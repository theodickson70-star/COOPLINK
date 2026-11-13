// =====================================================================
//  SMS ZA MATUKIO (taarifa kwa mkulima na vikundi) — zinaandaliwa ndani ya muamala wa tukio na kutumwa
//  baada ya kukamilika. Kila aina ina swichi ya Owner (lib/sms-kinds). Ujumbe ni mfupi (SMS 1–2) na wa Kiswahili.
// =====================================================================
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { D, Decimal } from './money';
import { enqueue, smsEnabled, type SmsMessage } from './sms';

type Member = typeof schema.members.$inferSelect;
const tsh = (v: Decimal.Value) => `TSh ${D(v).toDecimalPlaces(0).toNumber().toLocaleString('en-US')}`;
const usd = (v: Decimal.Value) => `$${D(v).toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const farmerPhone = (m: Pick<Member, 'phone' | 'mobileMoneyNumber'>) => m.phone ?? m.mobileMoneyNumber;
const first = (m: Pick<Member, 'firstName'>) => m.firstName;
const full = (m: Pick<Member, 'firstName' | 'lastName'>) => `${m.firstName} ${m.lastName}`;

async function amcosName(tx: DbOrTx, amcosId: string) {
  const a = await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { name: true } });
  // Jina fupi la chama (SMS ni fupi): "NSANJO MULTI-PURPOSE CO-OPERATIVE SOCIETY" -> "NSANJO AMCOS"
  const raw = (a?.name ?? 'Chama').trim();
  if (raw.length <= 30) return raw;
  const n = raw.replace(/\s+(multi[- ]?purpose|co-?\s?operative|society|limited|ltd|chama cha msingi).*$/i, '').trim() || raw;
  return /amcos/i.test(n) ? n.slice(0, 30) : `${n.slice(0, 24)} AMCOS`;
}

/** Deni la mkulima: TSh kwenye vitabu + dola */
async function debtOf(tx: DbOrTx, memberIds: string[]) {
  if (!memberIds.length) return new Map<string, { tzs: Decimal; usd: Decimal }>();
  const rows = (await tx.execute<{ id: string; bal: string; usd: string }>(sql`
    select m.id, coalesce((select sum(l.credit) - sum(l.debit) from member_ledger_entries l where l.member_id = m.id), 0)::text as bal,
      coalesce((select sum(u.usd) from member_usd_ledger u where u.member_id = m.id), 0)::text as usd
    from members m where m.id in (${sql.join(memberIds.map((x) => sql`${x}`), sql`, `)})`)).rows;
  return new Map(rows.map((r) => [r.id, { tzs: D(r.bal).lt(0) ? D(r.bal).neg() : D(0), usd: D(r.usd).gt(0) ? D(r.usd) : D(0) }]));
}
const debtText = (d: { tzs: Decimal; usd: Decimal }) => (d.usd.gt(0) ? `${usd(d.usd)} (${tsh(d.tzs)})` : tsh(d.tzs));

/** Kikundi hai cha mkulima, wanachama wake, na deni la jumla la kikundi */
export async function groupOf(tx: DbOrTx, memberId: string) {
  const G = schema.memberGroups, GM = schema.memberGroupMembers;
  const [g] = await tx.select({ id: G.id, name: G.name }).from(GM).innerJoin(G, eq(G.id, GM.groupId))
    .where(and(eq(GM.memberId, memberId), isNull(GM.leftAt), eq(G.status, 'ACTIVE'))).limit(1);
  return g ?? null;
}
export async function groupDebt(tx: DbOrTx, groupId: string) {
  const GM = schema.memberGroupMembers;
  const ids = (await tx.select({ id: GM.memberId }).from(GM).where(and(eq(GM.groupId, groupId), isNull(GM.leftAt)))).map((r) => r.id);
  const members = ids.length ? await tx.select().from(schema.members).where(inArray(schema.members.id, ids)) : [];
  const debts = await debtOf(tx, ids);
  const total = { tzs: D(0), usd: D(0) };
  for (const d of debts.values()) { total.tzs = total.tzs.plus(d.tzs); total.usd = total.usd.plus(d.usd); }
  return { members, debts, total };
}

// ------------------------------ MKULIMA ------------------------------
export async function smsMemberRegistered(tx: DbOrTx, m: Member) {
  if (!(await smsEnabled('MEMBER_REGISTERED'))) return;
  const chama = await amcosName(tx, m.amcosId);
  await enqueue(tx, { kind: 'MEMBER_REGISTERED', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'Member', referenceId: m.id,
    text: `${chama}: Karibu ${first(m)}! Umesajiliwa kama mwanachama. Namba yako ya uanachama ni ${m.memberNo}. Itumie kila unapohudumiwa na chama.` });
}

/** Pembejeo alizokabidhiwa (bila OTP — kwa OTP mkulima alishapata orodha) + deni lake */
export async function smsInputHandedOver(tx: DbOrTx, m: Member, issue: { id: string; issueNo: string; totalAmount: string; totalUsd: string | null }, items: string) {
  if (!(await smsEnabled('INPUT_HANDED_OVER'))) return;
  const chama = await amcosName(tx, m.amcosId);
  const d = (await debtOf(tx, [m.id])).get(m.id)!;
  await enqueue(tx, { kind: 'INPUT_HANDED_OVER', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'InputIssue', referenceId: issue.id,
    text: `${chama}: ${first(m)}, umepokea ${items} (${issue.issueNo}) thamani ${issue.totalUsd ? usd(issue.totalUsd) : tsh(issue.totalAmount)}. Deni lako sasa: ${debtText(d)}.` });
}

/** Mwanakikundi amechukua pembejeo -> wanakikundi wengine wanajua, na deni la jumla la kikundi */
export async function smsGroupInputTaken(tx: DbOrTx, m: Member, issue: { id: string; totalAmount: string; totalUsd: string | null }, items: string) {
  if (!(await smsEnabled('GROUP_INPUT_TAKEN'))) return;
  const g = await groupOf(tx, m.id);
  if (!g) return;
  const chama = await amcosName(tx, m.amcosId);
  const { members, total } = await groupDebt(tx, g.id);
  const value = issue.totalUsd ? usd(issue.totalUsd) : tsh(issue.totalAmount);
  await enqueue(tx, members.filter((x) => x.id !== m.id).map((x): SmsMessage => ({
    kind: 'GROUP_INPUT_TAKEN', phone: farmerPhone(x), amcosId: m.amcosId, memberId: x.id, referenceType: 'InputIssue', referenceId: issue.id,
    text: `${chama}: Kikundi ${g.name} - ${full(m)} amechukua ${items} (${value}). Deni la kikundi sasa: ${debtText(total)}. Mnadhaminiana.`,
  })));
}

export async function smsLoanSent(tx: DbOrTx, m: Member, o: { loanId: string; label: string; amountUsd: string | null; amount: string; interestUsd: string | null; interest: string }) {
  if (!(await smsEnabled('LOAN_SENT'))) return;
  const chama = await amcosName(tx, m.amcosId);
  const d = (await debtOf(tx, [m.id])).get(m.id)!;
  await enqueue(tx, { kind: 'LOAN_SENT', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'KuniLoan', referenceId: o.loanId,
    text: `${chama}: ${first(m)}, ${o.label.toLowerCase()} ${o.amountUsd ? `${usd(o.amountUsd)} (${tsh(o.amount)})` : tsh(o.amount)} umetumwa. Riba ${o.interestUsd ? usd(o.interestUsd) : tsh(o.interest)}. Deni lako sasa: ${debtText(d)}.` });
}

export async function smsSaleSettled(tx: DbOrTx, rows: { member: Member; settlementId: string; kg: string; grossTzs: string; deductions: string; netTzs: string; marketDate: string }[]) {
  if (!rows.length || !(await smsEnabled('SALE_SETTLED'))) return;
  const chama = await amcosName(tx, rows[0].member.amcosId);
  await enqueue(tx, rows.map((r): SmsMessage => ({
    kind: 'SALE_SETTLED', phone: farmerPhone(r.member), amcosId: r.member.amcosId, memberId: r.member.id, referenceType: 'Settlement', referenceId: r.settlementId,
    text: `${chama}: ${first(r.member)}, soko ${r.marketDate.split('-').reverse().join('/')}: kilo ${D(r.kg).toNumber().toLocaleString('en-US')}, mauzo ${tsh(r.grossTzs)}, makato ${tsh(r.deductions)}. Utalipwa ${tsh(r.netTzs)}.`,
  })));
}

export async function smsPaymentSent(tx: DbOrTx, m: Member, o: { paymentId: string; amount: string; method: string; destination: string | null; label?: string; refType?: string }) {
  if (!(await smsEnabled('PAYMENT_SENT'))) return;
  const chama = await amcosName(tx, m.amcosId);
  const via = o.method === 'MOBILE_MONEY' ? `kwa simu ${o.destination ? '0' + o.destination.slice(-9) : ''}`.trim() : o.method === 'BANK' ? 'benki' : 'taslimu';
  const what = o.label ?? 'malipo ya mauzo ya tumbaku';
  await enqueue(tx, { kind: 'PAYMENT_SENT', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: o.refType ?? 'Payment', referenceId: o.paymentId,
    text: `${chama}: ${first(m)}, ${what} ${tsh(o.amount)} ${o.method === 'CASH' ? 'umekabidhiwa taslimu' : `yametumwa ${via}`}. Asante.` });
}

// ------------------------------ VIKUNDI ------------------------------
export async function smsGroupRegistered(tx: DbOrTx, groupId: string) {
  if (!(await smsEnabled('GROUP_REGISTERED'))) return;
  const g = await tx.query.memberGroups.findFirst({ where: eq(schema.memberGroups.id, groupId) });
  if (!g) return;
  const { members } = await groupDebt(tx, groupId);
  const leader = members.find((x) => x.id === g.leaderMemberId);
  const chama = await amcosName(tx, g.amcosId);
  await enqueue(tx, members.map((x): SmsMessage => ({
    kind: 'GROUP_REGISTERED', phone: farmerPhone(x), amcosId: g.amcosId, memberId: x.id, referenceType: 'MemberGroup', referenceId: g.id,
    text: `${chama}: Kikundi ${g.name} kimesajiliwa, wanachama ${members.length}${leader ? `, kiongozi ${full(leader)}` : ''}. Mnadhaminiana madeni ya pembejeo na mikopo.`,
  })));
}

export async function smsGroupMemberChange(tx: DbOrTx, groupId: string, memberId: string, action: 'ADD' | 'REMOVE') {
  const kind = action === 'ADD' ? 'GROUP_MEMBER_JOINED' : 'GROUP_MEMBER_LEFT';
  if (!(await smsEnabled(kind))) return;
  const g = await tx.query.memberGroups.findFirst({ where: eq(schema.memberGroups.id, groupId) });
  const m = await tx.query.members.findFirst({ where: eq(schema.members.id, memberId) });
  if (!g || !m) return;
  const { members } = await groupDebt(tx, groupId);
  const chama = await amcosName(tx, g.amcosId);
  const msgs: SmsMessage[] = [{
    kind, phone: farmerPhone(m), amcosId: g.amcosId, memberId: m.id, referenceType: 'MemberGroup', referenceId: g.id,
    text: action === 'ADD' ? `${chama}: ${first(m)}, umejiunga na kikundi ${g.name} (wanachama ${members.length}). Mnadhaminiana madeni.` : `${chama}: ${first(m)}, umetoka kwenye kikundi ${g.name}. Hudhamini tena madeni ya kikundi hicho.`,
  }];
  for (const x of members.filter((y) => y.id !== m.id)) {
    msgs.push({ kind, phone: farmerPhone(x), amcosId: g.amcosId, memberId: x.id, referenceType: 'MemberGroup', referenceId: g.id,
      text: action === 'ADD' ? `${chama}: ${full(m)} amejiunga na kikundi chenu ${g.name}. Wanachama sasa ${members.length}.` : `${chama}: ${full(m)} ametoka kwenye kikundi chenu ${g.name}. Wanachama sasa ${members.length}.` });
  }
  await enqueue(tx, msgs);
}

/** Deni la kikundi kwa kila mwanakikundi (Meneja/Mhasibu anabonyeza). Inarudisha idadi ya SMS zilizowekwa kwenye foleni. */
export async function smsGroupDebt(tx: DbOrTx, groupId: string, by: string) {
  const g = await tx.query.memberGroups.findFirst({ where: eq(schema.memberGroups.id, groupId) });
  if (!g) return 0;
  const { members, debts, total } = await groupDebt(tx, groupId);
  const chama = await amcosName(tx, g.amcosId);
  return enqueue(tx, members.map((x): SmsMessage => ({
    kind: 'GROUP_DEBT', phone: farmerPhone(x), amcosId: g.amcosId, memberId: x.id, userId: by, referenceType: 'MemberGroup', referenceId: g.id,
    text: `${chama}: Kikundi ${g.name} - deni la jumla ${debtText(total)}. Deni lako ${debtText(debts.get(x.id) ?? { tzs: D(0), usd: D(0) })}. Mnadhaminiana: deni la mmoja linalipwa na kikundi.`,
  })));
}

// ------------------------------ SAFARI YA MKULIMA (v0.40) ------------------------------
const STATUS_TEXT: Record<string, string> = {
  ACTIVE: 'uanachama wako umerudishwa — sasa uko HAI na unaweza kuhudumiwa',
  SUSPENDED: 'uanachama wako umesitishwa kwa muda',
  EXITED: 'umetoka kwenye uanachama wa chama',
};
const local = (p: string | null | undefined) => (p ? `0${p.slice(-9)}` : '');

/** Mtumishi amesajili -> ombi linasubiri Meneja; Meneja akikataa -> sababu */
export async function smsMemberApplication(tx: DbOrTx, m: Member, outcome: 'RECEIVED' | 'REJECTED', note?: string) {
  if (!(await smsEnabled('MEMBER_APPLICATION'))) return;
  const chama = await amcosName(tx, m.amcosId);
  await enqueue(tx, { kind: 'MEMBER_APPLICATION', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'Member', referenceId: m.id,
    text: outcome === 'RECEIVED'
      ? `${chama}: ${first(m)}, ombi lako la uanachama limepokelewa. Utapata SMS nyingine Meneja akishaidhinisha.`
      : `${chama}: ${first(m)}, ombi lako la uanachama halikukubaliwa${note ? `: ${note.slice(0, 80)}` : ''}. Wasiliana na chama kwa maelezo.` });
}

export async function smsMemberStatus(tx: DbOrTx, m: Member, reason: string) {
  const t = STATUS_TEXT[m.status];
  if (!t || !(await smsEnabled('MEMBER_STATUS'))) return;
  const chama = await amcosName(tx, m.amcosId);
  await enqueue(tx, { kind: 'MEMBER_STATUS', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'Member', referenceId: m.id,
    text: `${chama}: ${first(m)}, ${t}. Sababu: ${reason.slice(0, 70)}.${m.status === 'ACTIVE' ? '' : ' Wasiliana na chama kwa maelezo.'}` });
}

/** Namba ya zamani inaambiwa namba imebadilishwa (kama si yeye, aripoti) */
export async function smsPhoneChanged(tx: DbOrTx, m: Member, oldPhones: string[], what: 'simu' | 'malipo' | 'simu na malipo') {
  if (!oldPhones.length || !(await smsEnabled('MEMBER_PHONE_CHANGED'))) return;
  const chama = await amcosName(tx, m.amcosId);
  await enqueue(tx, oldPhones.map((ph): SmsMessage => ({ kind: 'MEMBER_PHONE_CHANGED', phone: ph, amcosId: m.amcosId, memberId: m.id, referenceType: 'Member', referenceId: m.id,
    text: `${chama}: Namba ya ${what} ya mwanachama ${m.memberNo} (${full(m)}) imebadilishwa kutoka ${local(ph)}. Kama hukuomba, ripoti chama MARA MOJA.` })));
}

export async function smsMemberReceipt(tx: DbOrTx, m: Member, o: { txnId: string; txnNo: string; amount: string; label: string; showDebt: boolean }) {
  if (!(await smsEnabled('MEMBER_RECEIPT'))) return;
  const chama = await amcosName(tx, m.amcosId);
  const d = o.showDebt ? (await debtOf(tx, [m.id])).get(m.id)! : null;
  await enqueue(tx, { kind: 'MEMBER_RECEIPT', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'FinanceTransaction', referenceId: o.txnId,
    text: `${chama}: ${first(m)}, tumepokea ${tsh(o.amount)} (${o.label}). Risiti ${o.txnNo}.${d ? ` Deni lililobaki: ${debtText(d)}.` : ''} Asante.` });
}

export async function smsEstimateApproved(tx: DbOrTx, m: Member, o: { estimateId: string; acres: string; kg: string }) {
  if (!(await smsEnabled('ESTIMATE_APPROVED'))) return;
  const chama = await amcosName(tx, m.amcosId);
  await enqueue(tx, { kind: 'ESTIMATE_APPROVED', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: 'Estimate', referenceId: o.estimateId,
    text: `${chama}: ${first(m)}, makisio yako ya msimu yameidhinishwa: ekari ${D(o.acres).toNumber()}, kilo ${D(o.kg).toNumber().toLocaleString('en-US')}. Pembejeo zako zitapangwa kwa makisio haya.` });
}

/** Dhamana ya kikundi: mdhamini (mauzo yake yamekatwa) na mdaiwa (deni lake limepungua) */
export async function smsGuaranteeUsed(tx: DbOrTx, rows: { guarantor: Member; debtor: Member; amount: string; settlementId: string }[]) {
  if (!rows.length || !(await smsEnabled('GROUP_GUARANTEE_USED'))) return;
  const chama = await amcosName(tx, rows[0].guarantor.amcosId);
  const debts = await debtOf(tx, [...new Set(rows.map((r) => r.debtor.id))]);
  const msgs: SmsMessage[] = [];
  for (const r of rows) {
    msgs.push({ kind: 'GROUP_GUARANTEE_USED', phone: farmerPhone(r.guarantor), amcosId: r.guarantor.amcosId, memberId: r.guarantor.id, referenceType: 'Settlement', referenceId: r.settlementId,
      text: `${chama}: ${first(r.guarantor)}, ${tsh(r.amount)} kwenye mauzo yako imelipa deni la mwanakikundi ${full(r.debtor)} (dhamana ya kikundi).` });
    msgs.push({ kind: 'GROUP_GUARANTEE_USED', phone: farmerPhone(r.debtor), amcosId: r.debtor.amcosId, memberId: r.debtor.id, referenceType: 'Settlement', referenceId: r.settlementId,
      text: `${chama}: ${first(r.debtor)}, mwanakikundi ${full(r.guarantor)} amelipa ${tsh(r.amount)} ya deni lako. Deni lako sasa: ${debtText(debts.get(r.debtor.id) ?? { tzs: D(0), usd: D(0) })}.` });
  }
  await enqueue(tx, msgs);
}

export async function smsPaymentFailed(tx: DbOrTx, rows: { member: Member; refType: string; refId: string; amount: string; what: string }[]) {
  if (!rows.length || !(await smsEnabled('PAYMENT_FAILED'))) return;
  const chama = await amcosName(tx, rows[0].member.amcosId);
  await enqueue(tx, rows.map((r): SmsMessage => ({ kind: 'PAYMENT_FAILED', phone: farmerPhone(r.member), amcosId: r.member.amcosId, memberId: r.member.id, referenceType: r.refType, referenceId: r.refId,
    text: `${chama}: ${first(r.member)}, ${r.what} ${tsh(r.amount)} haijakufikia bado (imekwama). Chama kinashughulikia. Hakikisha namba yako ya malipo ni sahihi.` })));
}

/** Pembejeo zimefutwa / muamala wa mkulima umesahihishwa */
export async function smsAccountCorrection(tx: DbOrTx, m: Member, o: { refType: string; refId: string; what: string }) {
  if (!(await smsEnabled('ACCOUNT_CORRECTION'))) return;
  const chama = await amcosName(tx, m.amcosId);
  const d = (await debtOf(tx, [m.id])).get(m.id)!;
  await enqueue(tx, { kind: 'ACCOUNT_CORRECTION', phone: farmerPhone(m), amcosId: m.amcosId, memberId: m.id, referenceType: o.refType, referenceId: o.refId,
    text: `${chama}: ${first(m)}, marekebisho kwenye akaunti yako: ${o.what}. Deni lako sasa: ${debtText(d)}.` });
}
