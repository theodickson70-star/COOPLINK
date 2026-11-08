// =====================================================================
//  DAFTARI KUU NA RIPOTI KUU (Mhasibu anaandika · Meneja anasoma ripoti na kuidhinisha journal)
//   Chati ya akaunti · journal (kwa idhini) · taarifa ya akaunti · Trial Balance · Mapato na Matumizi
//   · Mizania (Balance Sheet) · Mtiririko wa fedha (Cash Flow) · dashibodi ya fedha
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, paged, paginationQuery, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { createApproval } from '../lib/approvals';
import { assertManualAllowed, balances, glMap, isDebitNormal, sumBal, syncLedger, type Bal } from '../lib/gl';
import { toCsv } from './owner/common';
import { lockedThrough, nextDay } from '../lib/periods';
import { currentSeason } from './seasons.routes';

export const accountingRouter = Router();
const GA = schema.glAccounts;
const JE = schema.journalEntries;
const JL = schema.journalLines;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
const prevDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

export const TYPE_LABEL: Record<string, string> = { ASSET: 'Mali', LIABILITY: 'Madeni', EQUITY: 'Mtaji', INCOME: 'Mapato', EXPENSE: 'Matumizi' };
export const SOURCE_LABEL: Record<string, string> = {
  FINANCE_TXN: 'Muamala wa fedha', ACCOUNT_OPENING: 'Salio la kuanzia', STOCK_MOVEMENT: 'Stoo', INPUT_ISSUE: 'Pembejeo kwa mkopo',
  INPUT_ISSUE_CANCEL: 'Kufutwa kwa pembejeo', TOBACCO_SALE: 'Mauzo ya tumbaku', PAYROLL: 'Mishahara', DEPRECIATION: 'Uchakavu',
  ASSET_OPENING: 'Mali iliyokuwepo', ASSET_DISPOSAL: 'Kuondoa mali', MANUAL: 'Journal ya mkono',
  OPENING_BALANCE: 'Salio la kuanzia', YEAR_END_CLOSE: 'Kufunga mwaka',
};

/** Soma chama + ingiza matukio mapya kwenye daftari kuu kabla ya kusoma. */
async function ready(req: Request) {
  const amcosId = await readAmcosId(req);
  await syncLedger(amcosId);
  return amcosId;
}

// ------------------------------ CHATI YA AKAUNTI ------------------------------
accountingRouter.get('/chart', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await ready(req);
  const rows = await balances(db, amcosId);
  res.json({ data: rows.map((r) => ({ ...r, typeLabel: TYPE_LABEL[r.type] })) });
}));

const chartBody = z.object({
  code: z.string().trim().regex(/^\d{4,6}$/, 'Namba ya akaunti iwe tarakimu 4–6'),
  name: z.string().trim().min(3),
  type: z.enum(schema.glAccountTypeEnum.enumValues),
  description: z.string().trim().nullable().optional(),
});

accountingRouter.post('/chart', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = chartBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  await syncLedger(amcosId);
  const range: Record<string, [number, number]> = { ASSET: [1000, 1999], LIABILITY: [2000, 2999], EQUITY: [3000, 3999], INCOME: [4000, 4999], EXPENSE: [5000, 5999] };
  const n = Number(body.code.slice(0, 4));
  const [lo, hi] = range[body.type];
  if (n < lo || n > hi) throw badRequest(`Akaunti za ${TYPE_LABEL[body.type]} zinaanza na ${String(lo)[0]} (mf. ${lo + 10})`);
  if (n >= 1000 && n < 1200) throw badRequest('Namba 1000–1199 ni za akaunti za fedha — ongeza akaunti ya fedha kwenye ukurasa wa Benki na fedha');
  const [dup] = await db.select({ id: GA.id }).from(GA).where(and(eq(GA.amcosId, amcosId), eq(GA.code, body.code)));
  if (dup) throw conflict('Namba hii ya akaunti tayari ipo');
  const acc = await db.transaction(async (tx) => {
    const [a] = await tx.insert(GA).values({ ...body, amcosId, isSystem: false }).returning();
    await audit(tx, req, { action: 'GL_ACCOUNT_CREATE', entity: 'GlAccount', entityId: a.id, amcosId, after: a });
    return a;
  });
  res.status(201).json({ account: acc });
}));

accountingRouter.patch('/chart/:id', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ name: z.string().trim().min(3).optional(), description: z.string().trim().nullable().optional(), isActive: z.boolean().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const [acc] = await db.select().from(GA).where(and(eq(GA.id, id), eq(GA.amcosId, amcosId)));
  if (!acc) throw notFound('Akaunti');
  if (acc.financeAccountId) throw badRequest('Akaunti hii inawakilisha akaunti ya fedha — ibadilishe kwenye ukurasa wa fedha');
  if (acc.isSystem && body.isActive === false) throw badRequest('Akaunti za msingi za mfumo haziwezi kufungwa');
  if (body.isActive === false) {
    const bal = (await balances(db, amcosId)).find((b) => b.id === id)!;
    if (!D(bal.balance).isZero()) throw badRequest('Akaunti yenye salio haiwezi kufungwa');
  }
  const row = await db.transaction(async (tx) => {
    const [a] = await tx.update(GA).set(body).where(eq(GA.id, id)).returning();
    await audit(tx, req, { action: 'GL_ACCOUNT_UPDATE', entity: 'GlAccount', entityId: id, amcosId, before: acc, after: a });
    return a;
  });
  res.json({ account: row });
}));

// ------------------------------ JOURNAL ------------------------------
const jQuery = paginationQuery.extend({ from: dateStr.optional(), to: dateStr.optional(), source: z.string().optional(), search: z.string().trim().optional(), glAccountId: z.string().uuid().optional() });

accountingRouter.get('/journals', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const q = jQuery.parse(req.query);
  const amcosId = await ready(req);
  const s = q.search ? `%${q.search}%` : null;
  const where = and(
    eq(JE.amcosId, amcosId),
    q.from ? gte(JE.entryDate, q.from) : undefined,
    q.to ? lte(JE.entryDate, q.to) : undefined,
    q.source ? eq(JE.source, q.source) : undefined,
    s ? or(ilike(JE.entryNo, s), ilike(JE.description, s), ilike(JE.reference, s)) : undefined,
    q.glAccountId ? sql`exists (select 1 from journal_lines l where l.journal_entry_id = "journal_entries"."id" and l.gl_account_id = ${q.glAccountId})` : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      entry: JE,
      amount: sql<string>`(select coalesce(sum(l.debit), 0) from journal_lines l where l.journal_entry_id = "journal_entries"."id")`,
      reversed: sql<boolean>`exists (select 1 from journal_entries r where r.reversal_of_id = "journal_entries"."id")`,
      createdBy: sql<string | null>`(select u.full_name from users u where u.id = "journal_entries"."created_by_id")`,
    }).from(JE).where(where).orderBy(desc(JE.entryDate), desc(JE.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(JE).where(where),
  ]);
  const pending = await db.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.amcosId, amcosId), eq(schema.approvalRequests.type, 'JOURNAL'), eq(schema.approvalRequests.status, 'PENDING'))).orderBy(desc(schema.approvalRequests.createdAt));
  res.json({
    ...paged(rows.map((r) => ({ ...r.entry, amount: fmt2(r.amount), reversed: r.reversed, createdBy: r.createdBy, sourceLabel: SOURCE_LABEL[r.entry.source] ?? r.entry.source })), total, q.page, q.pageSize),
    pending: pending.map((p) => ({ id: p.id, requestNo: p.requestNo, title: p.title, amount: p.amount, createdAt: p.createdAt, payload: p.payload })),
  });
}));

async function journalDetail(amcosId: string, id: string) {
  const [entry] = await db.select({
    entry: JE,
    createdBy: sql<string | null>`(select u.full_name from users u where u.id = "journal_entries"."created_by_id")`,
    reversedBy: sql<string | null>`(select r.entry_no from journal_entries r where r.reversal_of_id = "journal_entries"."id")`,
    reversalOfNo: sql<string | null>`(select o.entry_no from journal_entries o where o.id = "journal_entries"."reversal_of_id")`,
  }).from(JE).where(and(eq(JE.id, id), eq(JE.amcosId, amcosId)));
  if (!entry) throw notFound('Journal');
  const lines = await db.select({
    line: JL, code: GA.code, name: GA.name, type: GA.type,
    member: sql<string | null>`(select m.first_name || ' ' || m.last_name || ' (' || m.member_no || ')' from members m where m.id = "journal_lines"."member_id")`,
  }).from(JL).innerJoin(GA, eq(GA.id, JL.glAccountId)).where(eq(JL.journalEntryId, id)).orderBy(asc(JL.lineNo));
  const approval = entry.entry.approvalId ? await db.query.approvalRequests.findFirst({ where: eq(schema.approvalRequests.id, entry.entry.approvalId) }) : null;
  return {
    ...entry.entry, createdBy: entry.createdBy, reversedBy: entry.reversedBy, reversalOfNo: entry.reversalOfNo, sourceLabel: SOURCE_LABEL[entry.entry.source] ?? entry.entry.source,
    approval: approval ? { id: approval.id, requestNo: approval.requestNo, decidedAt: approval.decidedAt, decisionNote: approval.decisionNote } : null,
    lines: lines.map((l) => ({ ...l.line, code: l.code, name: l.name, type: l.type, member: l.member })),
    totalDebit: fmt2(lines.reduce((s, l) => s.plus(l.line.debit), D(0))), totalCredit: fmt2(lines.reduce((s, l) => s.plus(l.line.credit), D(0))),
  };
}

accountingRouter.get('/journals/:id', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const amcosId = await readAmcosId(req);
  res.json({ journal: await journalDetail(amcosId, id) });
}));

const journalBody = z.object({
  date: dateStr,
  description: z.string().trim().min(5, 'Eleza journal hii'),
  reference: z.string().trim().nullable().optional(),
  lines: z.array(z.object({
    glAccountId: z.string().uuid(),
    debit: decimalSchema({ min: 0 }).optional(),
    credit: decimalSchema({ min: 0 }).optional(),
    memo: z.string().trim().nullable().optional(),
  })).min(2, 'Journal inahitaji mistari miwili au zaidi').max(40),
});

/** Journal ya mkono — inaandaliwa na Mhasibu na kuandikwa daftari kuu baada ya idhini ya Meneja. */
accountingRouter.post('/journals', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = journalBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  await syncLedger(amcosId);
  if (body.date > todayStr()) throw badRequest('Tarehe ya journal haiwezi kuwa ya baadaye');
  const lk = await lockedThrough(db, amcosId);
  if (lk && body.date <= lk) throw badRequest(`Kipindi kimefungwa hadi ${lk}. Tumia tarehe ya ${nextDay(lk)} au baadaye.`);
  const m = await glMap(db, amcosId);
  let dr = D(0), cr = D(0);
  for (const l of body.lines) {
    const acc = m.byId.get(l.glAccountId);
    if (!acc) throw badRequest('Akaunti ya journal si sahihi');
    assertManualAllowed(acc);
    const d = D(l.debit), c = D(l.credit);
    if (d.gt(0) === c.gt(0)) throw badRequest(`${acc.code}: kila mstari uwe na debit AU credit`);
    dr = dr.plus(d); cr = cr.plus(c);
  }
  if (!dr.eq(cr)) throw badRequest(`Journal haijalingana: debit TSh ${fmt2(dr)} ≠ credit TSh ${fmt2(cr)}`);
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId, type: 'JOURNAL', amount: fmt2(dr), title: `Journal: ${body.description.slice(0, 60)} (${tshText(dr)})`, reason: body.description,
    payload: { ...body, lines: body.lines.map((l) => ({ ...l, code: m.byId.get(l.glAccountId)!.code, name: m.byId.get(l.glAccountId)!.name })) },
  }));
  res.status(202).json({ approval });
}));

// ------------------------------ TAARIFA YA AKAUNTI (GL STATEMENT) ------------------------------
accountingRouter.get('/ledger/:id', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const to = q.to ?? todayStr();
  const from = q.from ?? `${to.slice(0, 4)}-01-01`;
  const [acc] = await db.select().from(GA).where(and(eq(GA.id, id), eq(GA.amcosId, amcosId)));
  if (!acc) throw notFound('Akaunti');
  const debitNormal = isDebitNormal(acc.type);
  const [ob] = (await db.execute<{ dr: string; cr: string }>(sql`
    select coalesce(sum(l.debit), 0) as dr, coalesce(sum(l.credit), 0) as cr from journal_lines l
    join journal_entries e on e.id = l.journal_entry_id where l.gl_account_id = ${id} and e.entry_date < ${from}`)).rows;
  const sign = (dr: string, cr: string) => (debitNormal ? D(dr).minus(cr) : D(cr).minus(dr));
  let run = sign(ob.dr, ob.cr);
  const opening = fmt2(run);
  const rows = await db.select({
    line: JL, entryNo: JE.entryNo, entryDate: JE.entryDate, description: JE.description, source: JE.source, reference: JE.reference, entryId: JE.id,
    member: sql<string | null>`(select m.first_name || ' ' || m.last_name from members m where m.id = "journal_lines"."member_id")`,
  }).from(JL).innerJoin(JE, eq(JE.id, JL.journalEntryId))
    .where(and(eq(JL.glAccountId, id), gte(JE.entryDate, from), lte(JE.entryDate, to))).orderBy(asc(JE.entryDate), asc(JE.createdAt), asc(JL.lineNo));
  const lines = rows.map((r) => {
    run = run.plus(sign(r.line.debit, r.line.credit));
    return { id: r.line.id, entryId: r.entryId, entryNo: r.entryNo, date: r.entryDate, description: r.line.memo ? `${r.description} — ${r.line.memo}` : r.description,
      source: r.source, reference: r.reference, member: r.member, debit: r.line.debit, credit: r.line.credit, balance: fmt2(run) };
  });
  res.json({ account: { ...acc, typeLabel: TYPE_LABEL[acc.type] }, from, to, opening, closing: fmt2(run),
    totalDebit: fmt2(rows.reduce((s, r) => s.plus(r.line.debit), D(0))), totalCredit: fmt2(rows.reduce((s, r) => s.plus(r.line.credit), D(0))), lines });
}));

// ------------------------------ RIPOTI KUU ------------------------------
function trialBalance(rows: Bal[]) {
  const lines = rows.filter((r) => !D(r.debit).isZero() || !D(r.credit).isZero()).map((r) => {
    const net = D(r.debit).minus(r.credit);
    return { id: r.id, code: r.code, name: r.name, type: r.type, typeLabel: TYPE_LABEL[r.type], debit: fmt2(net.gt(0) ? net : 0), credit: fmt2(net.lt(0) ? net.neg() : 0) };
  });
  const td = lines.reduce((s, l) => s.plus(l.debit), D(0)), tc = lines.reduce((s, l) => s.plus(l.credit), D(0));
  return { lines, totalDebit: fmt2(td), totalCredit: fmt2(tc), balanced: td.eq(tc) };
}

accountingRouter.get('/reports/trial-balance', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { asOf } = z.object({ asOf: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const date = asOf ?? todayStr();
  res.json({ asOf: date, ...trialBalance(await balances(db, amcosId, { to: date })) });
}));

accountingRouter.get('/reports/trial-balance.csv', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { asOf } = z.object({ asOf: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const date = asOf ?? todayStr();
  const tb = trialBalance(await balances(db, amcosId, { to: date }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${date}.csv"`);
  res.send(toCsv([['Namba', 'Akaunti', 'Aina', 'Debit', 'Credit'], ...tb.lines.map((l) => [l.code, l.name, l.typeLabel, l.debit, l.credit]), ['', 'JUMLA', '', tb.totalDebit, tb.totalCredit]]));
}));

function incomeStatement(rows: Bal[]) {
  const pick = (t: string) => rows.filter((r) => r.type === t && !D(r.balance).isZero()).map((r) => ({ id: r.id, code: r.code, name: r.name, amount: r.balance }));
  const income = pick('INCOME'), expense = pick('EXPENSE');
  const ti = income.reduce((s, r) => s.plus(r.amount), D(0)), te = expense.reduce((s, r) => s.plus(r.amount), D(0));
  return { income, expense, totalIncome: fmt2(ti), totalExpense: fmt2(te), surplus: fmt2(ti.minus(te)) };
}

accountingRouter.get('/reports/income-statement', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const to = q.to ?? todayStr();
  const from = q.from ?? `${to.slice(0, 4)}-01-01`;
  res.json({ from, to, ...incomeStatement(await balances(db, amcosId, { from, to, excludeClosing: true })) });
}));

accountingRouter.get('/reports/balance-sheet', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { asOf } = z.object({ asOf: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const date = asOf ?? todayStr();
  const all = await balances(db, amcosId, { to: date });
  // Baada ya kufunga mwaka, ziada imeshahamia 3200 — "ya sasa" inaanza siku baada ya kufunga
  const [lc] = (await db.execute<{ d: string | null }>(sql`select max(locked_through)::text as d from period_locks where amcos_id = ${amcosId} and kind = 'YEAR_END' and locked_through <= ${date}`)).rows;
  const lastClose = lc?.d ?? null;
  const yearStart = lastClose ? nextDay(lastClose) : `${date.slice(0, 4)}-01-01`;
  const prior = incomeStatement(await balances(db, amcosId, { to: prevDay(yearStart) }));
  const current = incomeStatement(await balances(db, amcosId, { from: yearStart, to: date }));
  const group = (t: string) => all.filter((r) => r.type === t && !D(r.balance).isZero()).map((r) => ({ id: r.id, code: r.code, name: r.name, subtype: r.subtype, amount: r.balance }));
  const assets = group('ASSET'), liabilities = group('LIABILITY'), equity = group('EQUITY');
  const ta = assets.reduce((s, r) => s.plus(r.amount), D(0));
  const tl = liabilities.reduce((s, r) => s.plus(r.amount), D(0));
  const te = equity.reduce((s, r) => s.plus(r.amount), D(0)).plus(prior.surplus).plus(current.surplus);
  res.json({
    asOf: date, assets, liabilities, equity, currentFrom: yearStart, lastClose,
    retainedPrior: prior.surplus, currentSurplus: current.surplus,
    totalAssets: fmt2(ta), totalLiabilities: fmt2(tl), totalEquity: fmt2(te), totalLiabilitiesEquity: fmt2(tl.plus(te)),
    balanced: ta.eq(tl.plus(te)),
  });
}));

/** Mtiririko wa fedha (njia ya moja kwa moja): kila mstari usio wa fedha kwenye journal zinazogusa fedha. */
accountingRouter.get('/reports/cash-flow', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const amcosId = await ready(req);
  const to = q.to ?? todayStr();
  const from = q.from ?? `${to.slice(0, 4)}-01-01`;
  const cashAt = async (d: string) => sumBal((await balances(db, amcosId, { to: d })), (r) => r.subtype === 'CASH');
  const opening = await cashAt(prevDay(from));
  const closing = await cashAt(to);
  const r = await db.execute<{ id: string; code: string; name: string; type: string; subtype: string | null; amount: string }>(sql`
    select a.id, a.code, a.name, a.type, a.subtype, sum(l.credit - l.debit) as amount
    from journal_lines l
    join journal_entries e on e.id = l.journal_entry_id
    join gl_accounts a on a.id = l.gl_account_id
    where e.amcos_id = ${amcosId} and e.entry_date between ${from} and ${to}
      and coalesce(a.subtype, '') <> 'CASH'
      and exists (select 1 from journal_lines c join gl_accounts ca on ca.id = c.gl_account_id where c.journal_entry_id = e.id and ca.subtype = 'CASH')
    group by a.id order by a.code`);
  const classify = (x: { code: string; subtype: string | null }) =>
    x.subtype === 'TRANSFER' ? 'TRANSFER'
      : x.subtype === 'FIXED_ASSET' || x.subtype === 'ACCUM_DEPRECIATION' || x.code === '5950' ? 'INVESTING'
        : x.subtype === 'SHARE_CAPITAL' || x.subtype === 'LOAN' || x.subtype === 'RESERVES' || x.subtype === 'OPENING' ? 'FINANCING' : 'OPERATING';
  const sections: Record<string, { label: string; lines: { id: string; code: string; name: string; amount: string }[]; total: string }> = {
    OPERATING: { label: 'Shughuli za kawaida (uendeshaji)', lines: [], total: '0' },
    INVESTING: { label: 'Uwekezaji (mali za kudumu)', lines: [], total: '0' },
    FINANCING: { label: 'Ugharamiaji (hisa, mikopo, salio la kuanzia)', lines: [], total: '0' },
    TRANSFER: { label: 'Uhamisho kati ya akaunti za chama', lines: [], total: '0' },
  };
  for (const x of r.rows) {
    if (D(x.amount).isZero()) continue;
    const s = sections[classify(x)];
    s.lines.push({ id: x.id, code: x.code, name: x.name, amount: fmt2(x.amount) });
  }
  for (const s of Object.values(sections)) s.total = fmt2(s.lines.reduce((t, l) => t.plus(l.amount), D(0)));
  const net = Object.values(sections).reduce((t, s) => t.plus(s.total), D(0));
  res.json({ from, to, opening: fmt2(opening), net: fmt2(net), closing: fmt2(closing), sections, balanced: opening.plus(net).eq(closing) });
}));

// ------------------------------ DASHIBODI YA FEDHA ------------------------------
accountingRouter.get('/dashboard', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await ready(req);
  const today = todayStr();
  // Kipindi cha dashibodi: msimu unaoendelea (tumbaku inavuka mwaka), vinginevyo mwaka huu
  const season = await currentSeason();
  const yearStart = season && season.startDate <= today ? season.startDate : `${today.slice(0, 4)}-01-01`;
  const all = await balances(db, amcosId);
  const ytd = incomeStatement(await balances(db, amcosId, { from: yearStart, to: today, excludeClosing: true }));
  const code = (c: string) => D(all.find((r) => r.code === c)?.balance ?? 0);
  const cashAccounts = all.filter((r) => r.subtype === 'CASH').map((r) => ({ id: r.id, code: r.code, name: r.name, balance: r.balance, financeAccountId: r.financeAccountId }));

  // Ledger ya wakulima inalingana na daftari kuu? (wakulima: salio = credit - debit; GL: 2200 - 1200)
  const [ml] = (await db.execute<{ v: string }>(sql`select coalesce(sum(credit) - sum(debit), 0) as v from member_ledger_entries where amcos_id = ${amcosId}`)).rows;
  const glFarmers = code('2200').minus(code('1200'));

  const monthly = await db.execute<{ m: string; income: string; expense: string }>(sql`
    select to_char(e.entry_date, 'YYYY-MM') as m,
      coalesce(sum(case when a.type = 'INCOME' then l.credit - l.debit end), 0) as income,
      coalesce(sum(case when a.type = 'EXPENSE' then l.debit - l.credit end), 0) as expense
    from journal_lines l join journal_entries e on e.id = l.journal_entry_id join gl_accounts a on a.id = l.gl_account_id
    where e.amcos_id = ${amcosId} and e.entry_date > (current_date - interval '12 months') and a.type in ('INCOME', 'EXPENSE') and e.source <> 'YEAR_END_CLOSE'
    group by 1 order by 1`);

  const A = schema.approvalRequests;
  const pending = await db.select({ type: A.type, n: count(), v: sql<string>`coalesce(sum(${A.amount}), 0)` }).from(A)
    .where(and(eq(A.amcosId, amcosId), eq(A.status, 'PENDING'))).groupBy(A.type);
  const T = schema.financeTransactions;
  const [toPost] = await db.select({ n: count(), v: sql<string>`coalesce(sum(${T.amount}), 0)` }).from(T).where(and(eq(T.amcosId, amcosId), eq(T.status, 'APPROVED'), sql`(kind <> 'TRANSFER' or direction = 'OUT')`));
  const lastRecon = await db.execute<{ account_id: string; d: string }>(sql`select account_id, max(statement_date) as d from bank_reconciliations where amcos_id = ${amcosId} group by account_id`);
  const recon = new Map(lastRecon.rows.map((r) => [r.account_id, r.d]));
  const [unpaid] = (await db.execute<{ n: string; v: string }>(sql`
    select count(*) as n, coalesce(sum(net_tzs), 0) as v from settlements s where s.amcos_id = ${amcosId} and s.status = 'APPROVED' and s.net_tzs > 0`)).rows;
  const recent = await db.select({ entry: JE, amount: sql<string>`(select sum(l.debit) from journal_lines l where l.journal_entry_id = "journal_entries"."id")` })
    .from(JE).where(eq(JE.amcosId, amcosId)).orderBy(desc(JE.createdAt)).limit(8);

  res.json({
    cash: { total: fmt2(cashAccounts.reduce((s, a) => s.plus(a.balance), D(0))), accounts: cashAccounts.map((a) => ({ ...a, lastReconciled: a.financeAccountId ? recon.get(a.financeAccountId) ?? null : null })) },
    receivables: { farmers: fmt2(code('1200')), buyers: fmt2(code('1220')), other: fmt2(code('1250')) },
    payables: {
      suppliers: fmt2(code('2100').plus(code('2150'))), farmers: fmt2(code('2200')),
      statutory: fmt2(sumBal(all, (r) => r.subtype === 'LEVY' || (r.subtype === 'PAYROLL' && r.code !== '2400'))), salaries: fmt2(code('2400')), loans: fmt2(code('2500')),
    },
    inventory: fmt2(code('1300')),
    fixedAssets: fmt2(code('1500').minus(code('1590'))),
    lockedThrough: await lockedThrough(db, amcosId),
    ytd: { from: yearStart, season: season && season.startDate <= today ? season.name : null, income: ytd.totalIncome, expense: ytd.totalExpense, surplus: ytd.surplus },
    monthly: monthly.rows.map((r) => ({ month: r.m, income: fmt2(r.income), expense: fmt2(r.expense) })),
    pending: Object.fromEntries(pending.map((p) => [p.type, { count: p.n, amount: fmt2(p.v) }])),
    toPost: { count: toPost.n, amount: fmt2(toPost.v) },
    unpaidFarmers: { count: Number(unpaid.n), amount: fmt2(unpaid.v) },
    farmerLedgerCheck: { memberLedger: fmt2(ml.v), generalLedger: fmt2(glFarmers), matches: D(ml.v).eq(glFarmers) },
    recent: recent.map((r) => ({ id: r.entry.id, entryNo: r.entry.entryNo, date: r.entry.entryDate, description: r.entry.description, source: r.entry.source, sourceLabel: SOURCE_LABEL[r.entry.source] ?? r.entry.source, amount: fmt2(r.amount ?? 0) })),
  });
}));

accountingRouter.post('/sync', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const amcosId = await resolveWriteAmcosId(req);
  res.json(await syncLedger(amcosId));
}));



// ------------------------------ SALIO LA KUANZIA NA KUFUNGA VIPINDI ------------------------------

accountingRouter.get('/periods', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  const L = schema.periodLocks;
  const locks = await db.select({ l: L, by: sql<string | null>`(select u.full_name from users u where u.id = "period_locks"."created_by_id")`,
    entryNo: sql<string | null>`(select j.entry_no from journal_entries j where j.id = "period_locks"."journal_entry_id")` })
    .from(L).where(eq(L.amcosId, amcosId)).orderBy(desc(L.lockedThrough));
  const A = schema.approvalRequests;
  const requests = await db.select().from(A).where(and(eq(A.amcosId, amcosId), sql`${A.type} in ('OPENING_BALANCE', 'PERIOD_CLOSE', 'YEAR_END_CLOSE')`)).orderBy(desc(A.createdAt)).limit(30);
  const openings = await db.select({ id: JE.id, entryNo: JE.entryNo, entryDate: JE.entryDate, description: JE.description,
    amount: sql<string>`(select sum(l.debit) from journal_lines l where l.journal_entry_id = "journal_entries"."id")` })
    .from(JE).where(and(eq(JE.amcosId, amcosId), eq(JE.source, 'OPENING_BALANCE'))).orderBy(desc(JE.createdAt));
  res.json({
    lockedThrough: await lockedThrough(db, amcosId),
    locks: locks.map((x) => ({ ...x.l, createdBy: x.by, entryNo: x.entryNo })),
    requests: requests.map((r) => ({ id: r.id, requestNo: r.requestNo, type: r.type, status: r.status, title: r.title, amount: r.amount, createdAt: r.createdAt, decidedAt: r.decidedAt, decisionNote: r.decisionNote })),
    openings: openings.map((o) => ({ ...o, amount: fmt2(o.amount ?? 0) })),
  });
}));

async function noPendingClosing(amcosId: string) {
  const A = schema.approvalRequests;
  const [p] = await db.select({ n: count() }).from(A).where(and(eq(A.amcosId, amcosId), eq(A.status, 'PENDING'), sql`${A.type} in ('PERIOD_CLOSE', 'YEAR_END_CLOSE')`));
  if (p.n > 0) throw conflict('Tayari kuna ombi la kufunga kipindi linalosubiri Meneja');
}

const openingBody = z.object({
  date: dateStr,
  description: z.string().trim().min(3),
  farmers: z.array(z.object({ memberNo: z.string().trim().min(1), debt: decimalSchema({ min: 0 }).nullable().optional(), credit: decimalSchema({ min: 0 }).nullable().optional() })).max(5000).default([]),
  lines: z.array(z.object({ glAccountId: z.string().uuid(), debit: decimalSchema({ min: 0 }).nullable().optional(), credit: decimalSchema({ min: 0 }).nullable().optional() })).max(200).default([]),
});

/** Salio la kuanzia (chama kinapoanza kutumia CoopLink): madeni ya wakulima + akaunti nyingine. Linaingia baada ya idhini ya Meneja. */
accountingRouter.post('/opening-balances', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = openingBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (body.date > todayStr()) throw badRequest('Tarehe ya salio la kuanzia haiwezi kuwa ya baadaye');
  const lock = await lockedThrough(db, amcosId);
  if (lock && body.date <= lock) throw badRequest(`Kipindi kimefungwa hadi ${lock}`);
  if (!body.farmers.length && !body.lines.length) throw badRequest('Weka angalau deni moja la mkulima au akaunti moja');
  await syncLedger(amcosId);
  const nos = [...new Set(body.farmers.map((f) => f.memberNo.toUpperCase()))];
  if (nos.length !== body.farmers.length) throw badRequest('Namba ya mkulima inajirudia — weka mstari mmoja kwa kila mkulima');
  const M = schema.members;
  const mems = nos.length ? await db.select().from(M).where(and(eq(M.amcosId, amcosId), sql`upper(${M.memberNo}) in (${sql.join(nos.map((n) => sql`${n}`), sql`, `)})`)) : [];
  const byNo = new Map(mems.map((m) => [m.memberNo.toUpperCase(), m]));
  const missing = nos.filter((n) => !byNo.has(n));
  if (missing.length) throw badRequest(`Wakulima hawa hawajasajiliwa: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` na wengine ${missing.length - 10}` : ''}`);
  const farmers = body.farmers.map((f) => {
    const m = byNo.get(f.memberNo.toUpperCase())!;
    if (D(f.debt).gt(0) && D(f.credit).gt(0)) throw badRequest(`${m.memberNo}: weka deni AU kinachodaiwa na chama, si vyote`);
    return { memberId: m.id, memberNo: m.memberNo, name: `${m.firstName} ${m.lastName}`, debt: f.debt ?? null, credit: f.credit ?? null };
  }).filter((f) => D(f.debt).gt(0) || D(f.credit).gt(0));
  const g = await glMap(db, amcosId);
  const lines = body.lines.filter((l) => D(l.debit).gt(0) || D(l.credit).gt(0)).map((l) => {
    const acc = g.byId.get(l.glAccountId);
    if (!acc) throw badRequest('Akaunti si sahihi');
    assertManualAllowed(acc);
    if (['1200', '2200', '3900'].includes(acc.code)) throw badRequest(`${acc.code}: madeni ya wakulima yanawekwa kwa kila mkulima; 3900 inajazwa yenyewe`);
    if (D(l.debit).gt(0) && D(l.credit).gt(0)) throw badRequest(`${acc.code}: debit AU credit`);
    return { glAccountId: acc.id, code: acc.code, name: acc.name, debit: l.debit ?? null, credit: l.credit ?? null };
  });
  const dr = farmers.reduce((s, f) => s.plus(D(f.debt)), D(0)).plus(lines.reduce((s, l) => s.plus(D(l.debit)), D(0)));
  const cr = farmers.reduce((s, f) => s.plus(D(f.credit)), D(0)).plus(lines.reduce((s, l) => s.plus(D(l.credit)), D(0)));
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId, type: 'OPENING_BALANCE', amount: fmt2(dr.gt(cr) ? dr : cr),
    title: `Salio la kuanzia ${body.date}: wakulima ${farmers.length}, akaunti ${lines.length} (debit ${tshText(dr)}, credit ${tshText(cr)})`,
    reason: body.description, payload: { date: body.date, description: body.description, farmers, lines, totals: { debit: fmt2(dr), credit: fmt2(cr), equity: fmt2(dr.minus(cr)) } },
  }));
  res.status(202).json({ approval, totals: { debit: fmt2(dr), credit: fmt2(cr), equity: fmt2(dr.minus(cr)) } });
}));

accountingRouter.post('/period-close', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = z.object({ lockedThrough: dateStr, note: z.string().trim().nullable().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (body.lockedThrough >= todayStr()) throw badRequest('Funga kipindi kilichokwisha pita tu (kabla ya leo)');
  const lock = await lockedThrough(db, amcosId);
  if (lock && body.lockedThrough <= lock) throw badRequest(`Tayari kimefungwa hadi ${lock}`);
  await noPendingClosing(amcosId);
  const T = schema.financeTransactions;
  const [open] = await db.select({ n: count() }).from(T).where(and(eq(T.amcosId, amcosId), sql`${T.status} in ('PENDING_APPROVAL', 'APPROVED')`, lte(T.txnDate, body.lockedThrough)));
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId, type: 'PERIOD_CLOSE', title: `Kufunga kipindi hadi ${body.lockedThrough}`, reason: body.note ?? 'Kipindi kimekaguliwa',
    payload: { lockedThrough: body.lockedThrough, note: body.note ?? null, openTransactions: open.n },
  }));
  res.status(202).json({ approval, openTransactions: open.n });
}));

accountingRouter.get('/year-end-preview', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const { closeDate } = z.object({ closeDate: dateStr }).parse(req.query);
  const amcosId = await ready(req);
  res.json({ closeDate, lockedThrough: await lockedThrough(db, amcosId), ...incomeStatement(await balances(db, amcosId, { to: closeDate })) });
}));

accountingRouter.post('/year-end-close', requireAmcosPerm('accounting.manage'), ah(async (req, res) => {
  const body = z.object({ closeDate: dateStr, note: z.string().trim().nullable().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (body.closeDate >= todayStr()) throw badRequest('Mwaka unafungwa baada ya tarehe yake ya mwisho kupita');
  const lock = await lockedThrough(db, amcosId);
  if (lock && body.closeDate <= lock) throw badRequest(`Tayari kimefungwa hadi ${lock}`);
  await noPendingClosing(amcosId);
  await syncLedger(amcosId);
  const is = incomeStatement(await balances(db, amcosId, { to: body.closeDate }));
  const approval = await db.transaction((tx) => createApproval(tx, req, {
    amcosId, type: 'YEAR_END_CLOSE', amount: is.surplus.startsWith('-') ? is.surplus.slice(1) : is.surplus,
    title: `Kufunga mwaka hadi ${body.closeDate}: mapato ${tshText(is.totalIncome)}, matumizi ${tshText(is.totalExpense)}, ${Number(is.surplus) >= 0 ? 'ziada' : 'upungufu'} ${tshText(is.surplus.replace('-', ''))}`,
    reason: body.note ?? 'Mwaka wa fedha umekamilika', payload: { closeDate: body.closeDate, note: body.note ?? null, totals: { income: is.totalIncome, expense: is.totalExpense, surplus: is.surplus } },
  }));
  res.status(202).json({ approval });
}));

// ------------------------------ MADENI YA CHAMA (Chama Kikuu, ushuru, kodi) ------------------------------
accountingRouter.get('/payables', requireAmcosPerm('accounting.read'), ah(async (req, res) => {
  const amcosId = await ready(req);
  const all = await balances(db, amcosId);
  const rows = all.filter((r) => r.type === 'LIABILITY' && r.isActive && r.code !== '2200' && r.code !== '2400');
  const T = schema.financeTransactions;
  const pending = await db.select({ contra: T.contraGlAccountId, n: count(), v: sql<string>`coalesce(sum(${T.amount}), 0)` }).from(T)
    .where(and(eq(T.amcosId, amcosId), sql`${T.status} in ('PENDING_APPROVAL', 'APPROVED')`, sql`${T.contraGlAccountId} is not null`)).groupBy(T.contraGlAccountId);
  const pend = new Map(pending.map((p) => [p.contra, p]));
  const [lastPaid] = [await db.execute<{ contra: string; d: string }>(sql`select contra_gl_account_id as contra, max(txn_date)::text as d from finance_transactions where amcos_id = ${amcosId} and status = 'POSTED' and contra_gl_account_id is not null group by 1`)];
  const paid = new Map(lastPaid.rows.map((r) => [r.contra, r.d]));
  res.json({ data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, subtype: r.subtype, balance: r.balance, credited: r.credit, debited: r.debit,
    pendingCount: pend.get(r.id)?.n ?? 0, pendingAmount: fmt2(pend.get(r.id)?.v ?? 0), lastPaid: paid.get(r.id) ?? null })) });
}));

