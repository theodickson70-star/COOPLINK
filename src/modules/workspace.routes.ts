// Dashibodi za watumishi: kila sehemu inarudishwa TU kama cheo kina ruhusa yake (Meneja / Mhasibu / Stokipa)
import { Router } from 'express';
import { and, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah } from '../lib/http';
import { amcosScope } from '../middleware/tenant';
import { amcosPermissions, canAmcos, hasAmcosPerm, isAmcosStaff, STAFF_TITLE } from '../lib/amcos-permissions';
import { D, fmt2 } from '../lib/money';
import { currentSeason } from './seasons.routes';
import { APPROVAL_LABEL } from '../lib/approvals';
import { EXPENSE_CATEGORIES } from '../lib/finance';

export const workspaceRouter = Router();

workspaceRouter.get('/summary', ah(async (req, res) => {
  const role = req.auth!.role;
  const can = (p: Parameters<typeof hasAmcosPerm>[1]) => canAmcos(req.auth!, p);
  const season = await currentSeason();
  const m = schema.members, A = schema.approvalRequests, T = schema.financeTransactions, mv = schema.stockMovements;
  const out: Record<string, unknown> = {
    role, title: isAmcosStaff(role) ? STAFF_TITLE[role] : null, permissions: [...amcosPermissions(role), ...(req.auth!.amcosExtra ?? [])], covering: req.auth!.covering ?? [],
    season: season ? { id: season.id, name: season.name, status: season.status } : null,
  };

  const [members] = await db.select({
    total: count(),
    active: sql<number>`count(*) filter (where ${m.status} = 'ACTIVE')::int`,
    pending: sql<number>`count(*) filter (where ${m.status} = 'PENDING')::int`,
    female: sql<number>`count(*) filter (where ${m.gender} = 'FEMALE' and ${m.status} = 'ACTIVE')::int`,
  }).from(m).where(amcosScope(req, m.amcosId));
  out.members = members;

  if (season) {
    const e = schema.estimates, i = schema.inputIssues;
    const [est] = await db.select({
      approvedKg: sql<string>`coalesce(sum(${e.estimatedKg}) filter (where ${e.status} = 'APPROVED'), 0)`,
      draft: sql<number>`count(*) filter (where ${e.status} = 'DRAFT')::int`,
      acres: sql<string>`coalesce(sum(${e.acresPlanted}) filter (where ${e.status} = 'APPROVED'), 0)`,
    }).from(e).where(and(amcosScope(req, e.amcosId), eq(e.seasonId, season.id)));
    const [inp] = await db.select({
      value: sql<string>`coalesce(sum(${i.totalAmount}) filter (where ${i.status} = 'ISSUED'), 0)`,
      farmers: sql<number>`count(distinct ${i.memberId}) filter (where ${i.status} = 'ISSUED')::int`,
      pending: sql<number>`count(*) filter (where ${i.status} = 'PENDING_APPROVAL')::int`,
    }).from(i).where(and(amcosScope(req, i.amcosId), eq(i.seasonId, season.id)));
    out.production = { ...est, inputsIssuedValue: inp.value, farmersWithInputs: inp.farmers, pendingIssues: inp.pending };
  }

  if (can('approvals.read')) {
    const mine = can('approvals.decide') || !req.auth!.amcosId ? undefined : eq(A.requestedById, req.auth!.userId);
    const rows = await db.select({ type: A.type, n: count(), amount: sql<string>`coalesce(sum(${A.amount}), 0)` }).from(A)
      .where(and(amcosScope(req, A.amcosId), mine, eq(A.status, 'PENDING'))).groupBy(A.type);
    const recent = await db.select({ id: A.id, requestNo: A.requestNo, type: A.type, title: A.title, amount: A.amount, status: A.status, createdAt: A.createdAt, decidedAt: A.decidedAt, decisionNote: A.decisionNote })
      .from(A).where(and(amcosScope(req, A.amcosId), mine)).orderBy(desc(A.createdAt)).limit(6);
    out.approvals = {
      total: rows.reduce((s, r) => s + r.n, 0),
      byType: rows.map((r) => ({ type: r.type, label: APPROVAL_LABEL[r.type], count: r.n, amount: fmt2(r.amount) })),
      recent: recent.map((r) => ({ ...r, typeLabel: APPROVAL_LABEL[r.type] })),
    };
  }

  if (can('finance.read')) {
    const ACC = schema.financeAccounts;
    const accounts = await db.select({
      id: ACC.id, name: ACC.name, kind: ACC.kind,
      balance: sql<string>`${ACC.openingBalance} + coalesce((select sum(case when t.direction = 'IN' then t.amount else -t.amount end)
        from finance_transactions t where t.account_id = "finance_accounts"."id" and t.status = 'POSTED'), 0)`,
    }).from(ACC).where(and(amcosScope(req, ACC.amcosId), eq(ACC.isActive, true)));
    const seasonCond = season ? eq(T.seasonId, season.id) : undefined;
    const origKind = sql`coalesce((select o.kind::text from finance_transactions o where o.id = "finance_transactions"."reversal_of_id"), "finance_transactions"."kind"::text)`;
    const signed = sql`case when ${T.kind} = 'REVERSAL' then -${T.amount} else ${T.amount} end`;
    const [flow] = await db.select({
      income: sql<string>`coalesce(sum(${signed}) filter (where ${origKind} = 'INCOME'), 0)`,
      out: sql<string>`coalesce(sum(${signed}) filter (where ${origKind} <> 'INCOME'), 0)`,
    }).from(T).where(and(amcosScope(req, T.amcosId), eq(T.status, 'POSTED'), seasonCond));
    const [pend] = await db.select({
      awaitingApproval: sql<number>`count(*) filter (where ${T.status} = 'PENDING_APPROVAL')::int`,
      awaitingApprovalAmount: sql<string>`coalesce(sum(${T.amount}) filter (where ${T.status} = 'PENDING_APPROVAL'), 0)`,
      toPost: sql<number>`count(*) filter (where ${T.status} = 'APPROVED')::int`,
      toPostAmount: sql<string>`coalesce(sum(${T.amount}) filter (where ${T.status} = 'APPROVED'), 0)`,
    }).from(T).where(amcosScope(req, T.amcosId));
    const l = schema.memberLedgerEntries;
    const bal = db.select({ b: sql<string>`sum(${l.credit}) - sum(${l.debit})`.as('b') }).from(l).where(amcosScope(req, l.amcosId)).groupBy(l.memberId).as('x');
    const [debts] = await db.select({
      owing: sql<string>`coalesce(-sum(${bal.b}) filter (where ${bal.b} < 0), 0)`,
      farmers: sql<number>`count(*) filter (where ${bal.b} < 0)::int`,
      payable: sql<string>`coalesce(sum(${bal.b}) filter (where ${bal.b} > 0), 0)`,
    }).from(bal);
    let budget = null;
    if (season) {
      const B = schema.financeBudgets;
      const [b] = await db.select({ total: sql<string>`coalesce(sum(${B.amount}), 0)` }).from(B).where(and(amcosScope(req, B.amcosId), eq(B.seasonId, season.id)));
      const [a] = await db.select({ spent: sql<string>`coalesce(sum(case when ${T.kind} = 'REVERSAL' then -${T.amount} else ${T.amount} end), 0)` }).from(T)
        .where(and(amcosScope(req, T.amcosId), eq(T.seasonId, season.id), eq(T.status, 'POSTED'), inArray(T.kind, ['EXPENSE', 'REVERSAL']),
          inArray(T.category, Object.keys(EXPENSE_CATEGORIES))));
      budget = { total: fmt2(b.total), spent: fmt2(a.spent) };
    }
    out.finance = {
      accounts: accounts.map((a) => ({ ...a, balance: fmt2(a.balance) })),
      cashTotal: fmt2(accounts.reduce((s, a) => s.plus(a.balance), D(0))),
      seasonIncome: fmt2(flow.income), seasonOut: fmt2(flow.out),
      ...pend, awaitingApprovalAmount: fmt2(pend.awaitingApprovalAmount), toPostAmount: fmt2(pend.toPostAmount),
      farmerDebts: fmt2(debts.owing), farmersOwing: debts.farmers, owedToFarmers: fmt2(debts.payable), budget,
    };
  }

  if (can('stock.read') && season) {
    const it = schema.inputItems;
    const stock = await db.select({
      id: it.id, name: it.name, unit: it.unit, reorderLevel: it.reorderLevel,
      balance: sql<string>`coalesce((select sum(s.quantity) from stock_movements s where s.input_item_id = "input_items"."id" and s.season_id = ${season.id}), 0)`,
    }).from(it).where(and(amcosScope(req, it.amcosId), eq(it.isActive, true)));
    const [mvs] = await db.select({
      received: sql<string>`coalesce(sum(${mv.quantity}) filter (where ${mv.type} = 'RECEIPT'), 0)`,
      issued: sql<string>`coalesce(-sum(${mv.quantity}) filter (where ${mv.type} = 'ISSUE'), 0)`,
      damaged: sql<string>`coalesce(-sum(${mv.quantity}) filter (where ${mv.type} = 'DAMAGE'), 0)`,
      expired: sql<string>`coalesce(-sum(${mv.quantity}) filter (where ${mv.type} = 'EXPIRY'), 0)`,
    }).from(mv).where(and(amcosScope(req, mv.amcosId), eq(mv.seasonId, season.id)));
    const P = schema.purchaseRequests;
    const [pr] = await db.select({
      awaitingApproval: sql<number>`count(*) filter (where ${P.status} = 'PENDING_APPROVAL')::int`,
      awaitingReceipt: sql<number>`count(*) filter (where ${P.status} in ('APPROVED', 'PARTIALLY_RECEIVED'))::int`,
    }).from(P).where(amcosScope(req, P.amcosId));
    const [adj] = await db.select({ n: count() }).from(A).where(and(amcosScope(req, A.amcosId), eq(A.type, 'STOCK_ADJUSTMENT'), eq(A.status, 'PENDING')));
    const [exp] = await db.select({ n: count() }).from(mv).where(and(amcosScope(req, mv.amcosId), eq(mv.type, 'RECEIPT'), isNotNull(mv.expiryDate),
      lte(mv.expiryDate, sql`current_date + 60`), gte(mv.expiryDate, sql`current_date - 30`)));
    const recent = await db.select({ id: mv.id, type: mv.type, quantity: mv.quantity, reference: mv.reference, createdAt: mv.createdAt, name: schema.inputItems.name })
      .from(mv).innerJoin(schema.inputItems, eq(schema.inputItems.id, mv.inputItemId)).where(amcosScope(req, mv.amcosId)).orderBy(desc(mv.createdAt)).limit(8);
    out.stock = {
      items: stock.length,
      low: stock.filter((s) => s.reorderLevel !== null && D(s.balance).lte(s.reorderLevel)).map((s) => ({ ...s, balance: fmt2(s.balance) })),
      outOfStock: stock.filter((s) => D(s.balance).lte(0)).length,
      ...mvs, purchasesAwaitingApproval: pr.awaitingApproval, purchasesAwaitingReceipt: pr.awaitingReceipt,
      pendingAdjustments: adj.n, expiringSoon: exp.n, recent,
    };
  }
  res.json(out);
}));

// ---------------------------------------------------------------------
//  HATUA ZA KUANZA KUTUMIA COOPLINK (Meneja): kilichokamilika na kilichobaki — kinahesabiwa kutoka data halisi
// ---------------------------------------------------------------------
workspaceRouter.get('/setup', ah(async (req, res) => {
  const amcosId = req.auth!.amcosId;
  if (!amcosId || req.auth!.role !== 'AMCOS_ADMIN') return res.json({ steps: [] });
  const S = schema;
  const season = await currentSeason();
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const cnt = sql<number>`count(*)::int`;
  const [staff, members, accounts, items, priced, rules, opening, est, fee] = await Promise.all([
    db.select({ role: S.users.role }).from(S.users).where(and(eq(S.users.amcosId, amcosId), eq(S.users.isActive, true))),
    n(db.select({ n: cnt }).from(S.members).where(eq(S.members.amcosId, amcosId))),
    n(db.select({ n: cnt }).from(S.financeAccounts).where(and(eq(S.financeAccounts.amcosId, amcosId), eq(S.financeAccounts.isActive, true)))),
    n(db.select({ n: cnt }).from(S.inputItems).where(and(eq(S.inputItems.amcosId, amcosId), eq(S.inputItems.isActive, true)))),
    season ? n(db.select({ n: sql<number>`count(distinct ${S.inputPrices.inputItemId})::int` }).from(S.inputPrices).where(and(eq(S.inputPrices.amcosId, amcosId), eq(S.inputPrices.seasonId, season.id)))) : Promise.resolve(0),
    season ? n(db.select({ n: cnt }).from(S.deductionRules).where(and(eq(S.deductionRules.amcosId, amcosId), eq(S.deductionRules.seasonId, season.id)))) : Promise.resolve(0),
    n(db.select({ n: cnt }).from(S.journalEntries).where(and(eq(S.journalEntries.amcosId, amcosId), eq(S.journalEntries.source, 'OPENING_BALANCE')))),
    season ? n(db.select({ n: cnt }).from(S.estimates).where(and(eq(S.estimates.amcosId, amcosId), eq(S.estimates.seasonId, season.id)))) : Promise.resolve(0),
    db.select({ status: S.platformFees.status }).from(S.platformFees).where(and(eq(S.platformFees.amcosId, amcosId), eq(S.platformFees.kind, 'ENTRANCE'))),
  ]);
  const roles = new Set(staff.map((s) => s.role));
  const steps = [
    { key: 'staff', title: 'Watumishi: Mhasibu na Stokipa', done: roles.has('ACCOUNTANT') && roles.has('CLERK'), detail: `${roles.has('ACCOUNTANT') ? 'Mhasibu ✓' : 'Mhasibu hayupo'} · ${roles.has('CLERK') ? 'Stokipa ✓' : 'Stokipa hayupo'} — akaunti zinaundwa na CoopLink`, to: '/users' },
    { key: 'members', title: 'Sajili wakulima (au pakia daftari lote kwa CSV)', done: members > 0, detail: members ? `Wakulima ${members}` : 'Bado hakuna mkulima', to: '/members' },
    { key: 'accounts', title: 'Akaunti za fedha za chama (benki/taslimu/simu)', done: accounts > 0, detail: accounts ? `Akaunti ${accounts}` : 'Mhasibu aongeze akaunti za chama', to: '/finance' },
    { key: 'opening', title: 'Salio la kuanzia (fedha, mali na madeni ya zamani ya wakulima)', done: opening > 0, detail: opening ? 'Limewekwa' : 'Mhasibu aweke salio la kuanzia', to: '/accounting/periods' },
    { key: 'inputs', title: 'Pembejeo na bei zake', done: items > 0 && priced > 0, detail: items ? `Bidhaa ${items} · zenye bei ${priced}` : 'Stokipa aingize pembejeo, Meneja aidhinishe bei', to: '/inputs' },
    { key: 'estimates', title: `Makisio ya msimu${season ? ` ${season.name}` : ''}`, done: est > 0, detail: !season ? 'Hakuna msimu unaoendelea' : est ? `Makisio ${est}` : 'Stokipa aingize makisio ya wakulima', to: '/estimates' },
    { key: 'rules', title: 'Makato ya mauzo ya tumbaku (ushuru, ada n.k.)', done: rules > 0, detail: !season ? 'Hakuna msimu unaoendelea' : rules ? `Makato ${rules}` : 'Mhasibu aweke makato ya msimu', to: '/sales' },
    ...(fee.length ? [{ key: 'fee', title: 'Ada ya kingilio ya CoopLink', done: fee[0].status === 'PAID' || fee[0].status === 'WAIVED', detail: fee[0].status === 'PAID' ? 'Imelipwa' : fee[0].status === 'WAIVED' ? 'Imesamehewa' : 'Haijalipwa', to: '/billing' }] : []),
  ];
  res.json({ steps, done: steps.filter((s) => s.done).length, total: steps.length });
}));
