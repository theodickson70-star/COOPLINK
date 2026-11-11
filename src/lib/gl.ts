// =====================================================================
//  DAFTARI KUU (GENERAL LEDGER) — uhasibu wa double-entry wa chama
//   - Chati ya akaunti inaundwa yenyewe kwa kila chama (na Mhasibu anaweza kuongeza)
//   - Kila tukio la fedha linakuwa journal: jumla ya debit = jumla ya credit (trigger ya DB inakagua)
//   - Journal haifutwi wala kubadilishwa: kosa linasahihishwa kwa journal ya kinyume
//   - syncLedger(): inaingiza kwenye daftari kuu matukio ya moduli nyingine (fedha, stoo, pembejeo)
//     mara moja tu kila moja (unique: amcos + source + sourceId) — data ya zamani nayo inaingia.
// =====================================================================
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx, type Tx } from '../db';
import { D, Decimal, fmt2 } from './money';
import { nextNumber, pad } from './counter';
import { AppError, badRequest } from './errors';
import { lockedThrough, nextDay } from './periods';

type GlType = (typeof schema.glAccountTypeEnum.enumValues)[number];
export interface ChartRow { code: string; name: string; type: GlType; subtype?: string }

/** Chati ya akaunti ya kawaida kwa AMCOS ya tumbaku. */
export const DEFAULT_CHART: ChartRow[] = [
  // MALI (ASSETS)
  { code: '1000', name: 'Fedha taslimu (jumla)', type: 'ASSET', subtype: 'CASH_GROUP' },
  { code: '1100', name: 'Fedha benki (jumla)', type: 'ASSET', subtype: 'CASH_GROUP' },
  { code: '1150', name: 'Fedha za simu (jumla)', type: 'ASSET', subtype: 'CASH_GROUP' },
  { code: '1200', name: 'Wadaiwa — madeni ya wakulima (pembejeo na mikopo)', type: 'ASSET', subtype: 'RECEIVABLE' },
  { code: '1220', name: 'Wadaiwa — makampuni ya ununuzi wa tumbaku', type: 'ASSET', subtype: 'RECEIVABLE' },
  { code: '1250', name: 'Wadaiwa wengine na malipo ya awali', type: 'ASSET', subtype: 'RECEIVABLE' },
  { code: '1300', name: 'Stoo ya pembejeo', type: 'ASSET', subtype: 'INVENTORY' },
  { code: '1500', name: 'Mali za kudumu (gharama)', type: 'ASSET', subtype: 'FIXED_ASSET' },
  { code: '1590', name: 'Uchakavu uliolimbikizwa', type: 'ASSET', subtype: 'ACCUM_DEPRECIATION' },
  { code: '1990', name: 'Fedha zinazohamishwa kati ya akaunti', type: 'ASSET', subtype: 'TRANSFER' },
  // MADENI (LIABILITIES)
  { code: '2100', name: 'Wadai — wazabuni', type: 'LIABILITY', subtype: 'PAYABLE' },
  { code: '2150', name: 'Deni la pembejeo (Chama Kikuu / mzabuni)', type: 'LIABILITY', subtype: 'PAYABLE' },
  { code: '2200', name: 'Malipo ya wakulima yanayodaiwa (mauzo ya tumbaku)', type: 'LIABILITY', subtype: 'FARMER_PAYABLE' },
  { code: '2300', name: 'Ushuru wa Chama Kikuu unaodaiwa', type: 'LIABILITY', subtype: 'LEVY' },
  { code: '2310', name: 'Ushuru wa Halmashauri (cess) unaodaiwa', type: 'LIABILITY', subtype: 'LEVY' },
  { code: '2320', name: 'Makato mengine ya wakulima yanayodaiwa', type: 'LIABILITY', subtype: 'LEVY' },
  { code: '2400', name: 'Mishahara inayodaiwa', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2410', name: 'PAYE inayodaiwa (TRA)', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2420', name: 'NSSF inayodaiwa', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2430', name: 'WCF inayodaiwa', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2440', name: 'SDL inayodaiwa (TRA)', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2450', name: 'Makato mengine ya mishahara', type: 'LIABILITY', subtype: 'PAYROLL' },
  { code: '2500', name: 'Mikopo ya chama (benki / taasisi)', type: 'LIABILITY', subtype: 'LOAN' },
  // MTAJI (EQUITY)
  { code: '3100', name: 'Hisa za wanachama', type: 'EQUITY', subtype: 'SHARE_CAPITAL' },
  { code: '3200', name: 'Akiba na ziada iliyolimbikizwa', type: 'EQUITY', subtype: 'RESERVES' },
  { code: '3900', name: 'Salio la kuanzia (opening balance equity)', type: 'EQUITY', subtype: 'OPENING' },
  // MAPATO (INCOME)
  { code: '4100', name: 'Ushuru wa chama (AMCOS levy)', type: 'INCOME' },
  { code: '4200', name: 'Ada na viingilio vya wanachama', type: 'INCOME' },
  { code: '4300', name: 'Ruzuku na misaada', type: 'INCOME' },
  { code: '4400', name: 'Riba ya benki', type: 'INCOME' },
  { code: '4450', name: 'Riba ya pesa ya kuni (mikopo ya wakulima)', type: 'INCOME' },
  { code: '4600', name: 'Faida ya pembejeo zilizogawiwa', type: 'INCOME' },
  { code: '4700', name: 'Faida ya kubadilisha fedha (dola)', type: 'INCOME' },
  { code: '4900', name: 'Mapato mengine', type: 'INCOME' },
  // MATUMIZI (EXPENSES)
  { code: '5100', name: 'Mishahara na posho', type: 'EXPENSE' },
  { code: '5110', name: 'Michango ya mwajiri (NSSF, WCF, SDL)', type: 'EXPENSE' },
  { code: '5200', name: 'Usafiri', type: 'EXPENSE' },
  { code: '5210', name: 'Ofisi na vifaa', type: 'EXPENSE' },
  { code: '5220', name: 'Umeme, maji na mawasiliano', type: 'EXPENSE' },
  { code: '5230', name: 'Mikutano', type: 'EXPENSE' },
  { code: '5240', name: 'Matengenezo', type: 'EXPENSE' },
  { code: '5250', name: 'Kodi na ada za serikali', type: 'EXPENSE' },
  { code: '5260', name: 'Gharama za benki', type: 'EXPENSE' },
  { code: '5270', name: 'Upakiaji na usafirishaji wa pembejeo', type: 'EXPENSE' },
  { code: '5280', name: 'Mafunzo', type: 'EXPENSE' },
  { code: '5060', name: 'Upotevu / uharibifu wa stoo', type: 'EXPENSE' },
  { code: '5700', name: 'Hasara ya kubadilisha fedha (dola)', type: 'EXPENSE' },
  { code: '5900', name: 'Uchakavu wa mali', type: 'EXPENSE' },
  { code: '5950', name: 'Hasara (faida) ya kuuza/kuondoa mali', type: 'EXPENSE' },
  { code: '5990', name: 'Matumizi mengine', type: 'EXPENSE' },
];

/** Kundi la muamala -> akaunti ya daftari kuu (upande usio wa fedha). */
export const CATEGORY_GL: Record<string, string> = {
  // mapato
  TOBACCO_SALES: '1220', MEMBER_FEES: '4200', SHARE_CAPITAL: '3100', LEVY: '4100', FARMER_REPAYMENT: '1200',
  LOAN_RECEIVED: '2500', GRANT: '4300', INTEREST: '4400', OTHER_INCOME: '4900', ASSET_SALE: '5950',
  // matumizi
  SALARIES: '5100', TRANSPORT: '5200', OFFICE: '5210', UTILITIES: '5220', MEETINGS: '5230', REPAIRS: '5240', TAXES: '5250',
  BANK_CHARGES: '5260', INPUT_HANDLING: '5270', TRAINING: '5280', OTHER_EXPENSE: '5990',
  // malipo
  PAYMENT: '2200', CASH_LOAN: '1200', SUPPLIER: '2100', TRANSFER: '1990', REMITTANCE: '2320',
};

const CASH_BASE: Record<string, number> = { CASH: 1000, BANK: 1100, MOBILE_MONEY: 1150 };
const NORMAL_DEBIT = new Set<GlType>(['ASSET', 'EXPENSE']);
export const isDebitNormal = (t: GlType) => NORMAL_DEBIT.has(t);

const GA = schema.glAccounts;
const JE = schema.journalEntries;
const JL = schema.journalLines;

/** Funga daftari kuu la chama kwa muda wa transaction (namba za journal na sync zisigongane). */
export async function lockGl(tx: DbOrTx, amcosId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gl:' + amcosId}))`);
}

/** Hakikisha chati ya kawaida ipo, na kila akaunti ya fedha ina akaunti yake kwenye daftari kuu. */
export async function ensureChart(tx: DbOrTx, amcosId: string) {
  await tx.insert(GA).values(DEFAULT_CHART.map((c) => ({ ...c, amcosId, isSystem: true }))).onConflictDoNothing();
  const missing = await tx.select().from(schema.financeAccounts).where(and(
    eq(schema.financeAccounts.amcosId, amcosId),
    sql`not exists (select 1 from gl_accounts g where g.finance_account_id = "finance_accounts"."id")`,
  ));
  for (const fa of missing) {
    const base = CASH_BASE[fa.kind] ?? 1000;
    const [{ next }] = (await tx.execute<{ next: number }>(sql`
      select coalesce(max(code::int), ${base}) + 1 as next from gl_accounts
      where amcos_id = ${amcosId} and code ~ '^[0-9]+$' and code::int > ${base} and code::int < ${base + (fa.kind === 'BANK' ? 50 : fa.kind === 'MOBILE_MONEY' ? 50 : 100)}`)).rows;
    await tx.insert(GA).values({
      amcosId, code: String(next), name: fa.name, type: 'ASSET', subtype: 'CASH', isSystem: true, financeAccountId: fa.id,
      description: fa.kind === 'BANK' ? `${fa.bankName ?? 'Benki'} ${fa.accountNumber ?? ''}`.trim() : null,
    }).onConflictDoNothing();
  }
}

export async function glMap(tx: DbOrTx, amcosId: string) {
  const rows = await tx.select().from(GA).where(eq(GA.amcosId, amcosId));
  return {
    byCode: new Map(rows.map((r) => [r.code, r])),
    byId: new Map(rows.map((r) => [r.id, r])),
    byFinance: new Map(rows.filter((r) => r.financeAccountId).map((r) => [r.financeAccountId!, r])),
  };
}
type Maps = Awaited<ReturnType<typeof glMap>>;

export interface JLine { code?: string; glAccountId?: string; debit?: Decimal.Value; credit?: Decimal.Value; memo?: string | null; memberId?: string | null; supplierId?: string | null }
export interface JInput {
  amcosId: string; date: string; description: string; source: string; sourceId?: string | null; reference?: string | null;
  approvalId?: string | null; reversalOfId?: string | null; createdById?: string | null; lines: JLine[];
  /** true: tarehe ikiwa ndani ya kipindi kilichofungwa -> kosa. false (default): tukio la zamani linaandikwa siku ya kwanza iliyo wazi. */
  strict?: boolean;
}

/**
 * Andika journal moja (debit = credit). Inarudisha null kama tukio hili (source + sourceId) lishaandikwa.
 * Mistari ya akaunti moja inaunganishwa; mistari ya sifuri inaondolewa.
 */
export async function postJournal(tx: DbOrTx, j: JInput, maps?: Maps) {
  await lockGl(tx, j.amcosId);
  if (j.sourceId) {
    const [ex] = await tx.select({ id: JE.id }).from(JE).where(and(eq(JE.amcosId, j.amcosId), eq(JE.source, j.source), eq(JE.sourceId, j.sourceId)));
    if (ex) return null;
  }
  let m = maps ?? await glMap(tx, j.amcosId);
  const needsChart = j.lines.some((l) => (l.code && !m.byCode.has(l.code)));
  if (needsChart || m.byCode.size === 0) { await ensureChart(tx, j.amcosId); m = await glMap(tx, j.amcosId); }

  const lines: { glAccountId: string; debit: Decimal; credit: Decimal; memo: string | null; memberId: string | null; supplierId: string | null }[] = [];
  for (const l of j.lines) {
    const acc = l.glAccountId ? m.byId.get(l.glAccountId) : m.byCode.get(l.code!);
    if (!acc || acc.amcosId !== j.amcosId) throw new AppError(500, 'GL_ACCOUNT_MISSING', `Akaunti ya daftari kuu haipo: ${l.code ?? l.glAccountId}`);
    const net = D(l.debit).minus(D(l.credit));
    if (net.isZero()) continue;
    lines.push({ glAccountId: acc.id, debit: net.gt(0) ? net : D(0), credit: net.lt(0) ? net.neg() : D(0), memo: l.memo ?? null, memberId: l.memberId ?? null, supplierId: l.supplierId ?? null });
  }
  const dr = lines.reduce((s, l) => s.plus(l.debit), D(0));
  const cr = lines.reduce((s, l) => s.plus(l.credit), D(0));
  if (!dr.toDecimalPlaces(2).eq(cr.toDecimalPlaces(2))) throw new AppError(400, 'JOURNAL_UNBALANCED', `Journal haijalingana: debit ${fmt2(dr)} ≠ credit ${fmt2(cr)}`);
  if (lines.length < 2 || dr.isZero()) return null; // hakuna thamani ya kuandika

  let date = j.date;
  const lock = await lockedThrough(tx, j.amcosId);
  if (lock && date <= lock) {
    if (j.strict) throw badRequest(`Kipindi kimefungwa hadi ${lock}. Tumia tarehe ya ${nextDay(lock)} au baadaye.`);
    date = nextDay(lock);
  }
  const n = await nextNumber(tx, j.amcosId, 'journal');
  const [entry] = await tx.insert(JE).values({
    amcosId: j.amcosId, entryNo: `JV-${pad(n)}`, entryDate: date, description: j.description.slice(0, 500), source: j.source,
    sourceId: j.sourceId ?? null, reference: j.reference ?? null, approvalId: j.approvalId ?? null, reversalOfId: j.reversalOfId ?? null,
    createdById: j.createdById ?? null,
  }).returning();
  await tx.insert(JL).values(lines.map((l, i) => ({
    journalEntryId: entry.id, amcosId: j.amcosId, glAccountId: l.glAccountId, debit: fmt2(l.debit), credit: fmt2(l.credit),
    memo: l.memo, memberId: l.memberId, supplierId: l.supplierId, lineNo: i + 1,
  })));
  return entry;
}

/** Journal ya kinyume (debit <-> credit). Journal moja inasahihishwa mara moja tu (reversalOfId ni unique). */
export async function reverseJournal(tx: DbOrTx, entryId: string, o: { date: string; description: string; source: string; sourceId?: string | null; approvalId?: string | null; createdById?: string | null }) {
  const [orig] = await tx.select().from(JE).where(eq(JE.id, entryId));
  if (!orig) return null;
  const lines = await tx.select().from(JL).where(eq(JL.journalEntryId, entryId));
  return postJournal(tx, {
    amcosId: orig.amcosId, date: o.date, description: o.description, source: o.source, sourceId: o.sourceId, reference: orig.entryNo,
    approvalId: o.approvalId, reversalOfId: orig.id, createdById: o.createdById,
    lines: lines.map((l) => ({ glAccountId: l.glAccountId, debit: l.credit, credit: l.debit, memo: l.memo, memberId: l.memberId, supplierId: l.supplierId })),
  });
}

export async function journalFor(tx: DbOrTx, amcosId: string, source: string, sourceId: string) {
  const [e] = await tx.select().from(JE).where(and(eq(JE.amcosId, amcosId), eq(JE.source, source), eq(JE.sourceId, sourceId)));
  return e ?? null;
}

const dateOf = (d: Date | string | null | undefined) =>
  !d ? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' })
    : typeof d === 'string' ? d.slice(0, 10) : d.toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });

/** Wastani wa gharama ya bidhaa (kutoka mizigo iliyopokelewa yenye gharama). null kama haijulikani. */
async function avgCosts(tx: DbOrTx, amcosId: string) {
  const r = await tx.execute<{ input_item_id: string; avg: string }>(sql`
    select input_item_id, sum(quantity * unit_cost) / nullif(sum(quantity), 0) as avg
    from stock_movements where amcos_id = ${amcosId} and type = 'RECEIPT' and unit_cost is not null and quantity > 0
    group by input_item_id`);
  return new Map(r.rows.filter((x) => x.avg !== null).map((x) => [x.input_item_id, D(x.avg)]));
}

/**
 * Ingiza kwenye daftari kuu kila tukio ambalo bado halijaingia. Ni salama kuiita mara nyingi (idempotent).
 * Matukio: salio la kuanzia la akaunti za fedha, miamala ya fedha iliyokamilika, ugawaji wa pembejeo (na kufutwa kwake),
 * mizigo iliyopokelewa yenye gharama, na marekebisho ya stoo.
 */
export async function syncLedger(amcosId: string) {
  return db.transaction(async (tx) => {
    await lockGl(tx, amcosId);
    await ensureChart(tx, amcosId);
    const m = await glMap(tx, amcosId);
    let posted = 0;
    const post = async (j: JInput) => { if (await postJournal(tx, j, m)) posted++; };

    // 1) Salio la kuanzia la akaunti za fedha
    const opening = await tx.select().from(schema.financeAccounts).where(and(
      eq(schema.financeAccounts.amcosId, amcosId), sql`opening_balance > 0`,
      sql`not exists (select 1 from journal_entries j where j.amcos_id = ${amcosId} and j.source = 'ACCOUNT_OPENING' and j.source_id = "finance_accounts"."id")`,
    ));
    for (const a of opening) {
      const cash = m.byFinance.get(a.id)!;
      await post({ amcosId, date: dateOf(a.createdAt), description: `Salio la kuanzia: ${a.name}`, source: 'ACCOUNT_OPENING', sourceId: a.id,
        lines: [{ glAccountId: cash.id, debit: a.openingBalance }, { code: '3900', credit: a.openingBalance }] });
    }

    // 2) Miamala ya fedha iliyokamilika (POSTED)
    const T = schema.financeTransactions;
    const txns = await tx.select().from(T).where(and(eq(T.amcosId, amcosId), eq(T.status, 'POSTED'),
      sql`not exists (select 1 from journal_entries j where j.amcos_id = ${amcosId} and j.source = 'FINANCE_TXN' and j.source_id = "finance_transactions"."id")`))
      .orderBy(sql`posted_at asc nulls first`, T.createdAt);
    for (const t of txns) {
      const cash = t.accountId ? m.byFinance.get(t.accountId) : undefined;
      if (!cash) continue;
      const contra = t.contraGlAccountId ? m.byId.get(t.contraGlAccountId) : m.byCode.get(CATEGORY_GL[t.category] ?? (t.direction === 'IN' ? '4900' : '5990'));
      if (!contra) continue;
      const amt = t.amount;
      const memberId = t.memberId ?? null;
      const orig = t.reversalOfId ? await journalFor(tx, amcosId, 'FINANCE_TXN', t.reversalOfId) : null;
      await post({
        amcosId, date: t.txnDate, description: `${t.txnNo}: ${t.description}`, source: 'FINANCE_TXN', sourceId: t.id, reference: t.reference ?? t.txnNo,
        approvalId: t.approvalId, reversalOfId: orig?.id ?? null, createdById: t.postedById,
        lines: await (async (): Promise<JLine[]> => {
          // Malipo ya mzabuni kwa ombi la manunuzi la DOLA: deni la mzabuni (2100) linapungua kwa thamani yake ya siku ya ombi;
          // tofauti na TSh zilizolipwa leo ni faida/hasara ya kubadilisha fedha (4700/5700).
          if (t.amountUsd && t.purchaseRequestId && t.category === 'SUPPLIER') {
            const [pr] = await tx.select({ rate: schema.purchaseRequests.fxRate }).from(schema.purchaseRequests).where(eq(schema.purchaseRequests.id, t.purchaseRequestId));
            if (pr?.rate) {
              const carrying = D(t.amountUsd).times(pr.rate).toDecimalPlaces(2);
              const diff = D(amt).minus(carrying); // chanya = tumelipa zaidi (hasara)
              const sgn = t.direction === 'OUT' ? 1 : -1;
              const L = (code: string | null, id: string | null, v: Decimal, extra: Partial<JLine> = {}): JLine => {
                const x = v.times(sgn);
                return { ...(id ? { glAccountId: id } : { code: code! }), ...(x.gte(0) ? { debit: x } : { credit: x.neg() }), ...extra };
              };
              return [
                L(null, contra.id, carrying, { memberId, supplierId: t.supplierId }),
                ...(diff.isZero() ? [] : [L(diff.isPos() ? '5700' : '4700', null, diff, { memo: `Tofauti ya kiwango cha dola ${t.txnNo}` })]),
                L(null, cash.id, D(amt).neg()),
              ];
            }
          }
          return t.direction === 'IN'
            ? [{ glAccountId: cash.id, debit: amt }, { glAccountId: contra.id, credit: amt, memberId, supplierId: t.supplierId }]
            : [{ glAccountId: contra.id, debit: amt, memberId, supplierId: t.supplierId }, { glAccountId: cash.id, credit: amt }];
        })(),
      });
    }

    // 3) Mizigo iliyopokelewa yenye gharama + marekebisho ya stoo
    const costs = await avgCosts(tx, amcosId);
    const SM = schema.stockMovements;
    const moves = await tx.select().from(SM).where(and(eq(SM.amcosId, amcosId), sql`type in ('RECEIPT', 'ADJUSTMENT', 'DAMAGE', 'EXPIRY')`,
      sql`not exists (select 1 from journal_entries j where j.amcos_id = ${amcosId} and j.source = 'STOCK_MOVEMENT' and j.source_id = "stock_movements"."id")`))
      .orderBy(SM.createdAt);
    for (const mv of moves) {
      if (mv.type === 'RECEIPT') {
        if (!mv.unitCost) continue;
        const v = D(mv.quantity).times(mv.unitCost).toDecimalPlaces(2);
        await post({ amcosId, date: dateOf(mv.createdAt), description: `Mzigo wa pembejeo umepokelewa ${mv.reference ?? ''}`.trim(), source: 'STOCK_MOVEMENT', sourceId: mv.id, reference: mv.reference,
          lines: [{ code: '1300', debit: v }, { code: mv.purchaseRequestId ? '2100' : '2150', credit: v, supplierId: mv.supplierId }] });
      } else {
        const c = costs.get(mv.inputItemId);
        if (!c) continue;
        const v = D(mv.quantity).abs().times(c).toDecimalPlaces(2);
        const loss = D(mv.quantity).isNeg();
        await post({ amcosId, date: dateOf(mv.createdAt), description: `Marekebisho ya stoo (${mv.type}) ${mv.reference ?? ''}`.trim(), source: 'STOCK_MOVEMENT', sourceId: mv.id, reference: mv.reference, approvalId: mv.approvalId,
          lines: loss ? [{ code: '5060', debit: v }, { code: '1300', credit: v }] : [{ code: '1300', debit: v }, { code: '5060', credit: v }] });
      }
    }

    // 4) Ugawaji wa pembejeo kwa mkopo: mkulima anadaiwa (1200); stoo inapungua kwa gharama; tofauti ni faida (4600).
    //    Pembejeo zisizo na gharama inayojulikana (mf. zimeletwa na Chama Kikuu) -> deni la pembejeo (2150).
    const I = schema.inputIssues;
    const issued = await tx.select().from(I).where(and(eq(I.amcosId, amcosId),
      sql`exists (select 1 from stock_movements s where s.input_issue_id = "input_issues"."id" and s.type = 'ISSUE')`,
      sql`not exists (select 1 from journal_entries j where j.amcos_id = ${amcosId} and j.source = 'INPUT_ISSUE' and j.source_id = "input_issues"."id")`))
      .orderBy(I.issuedAt);
    for (const is of issued) {
      const lines = await tx.select().from(schema.inputIssueLines).where(eq(schema.inputIssueLines.inputIssueId, is.id));
      const jl: JLine[] = [{ code: '1200', debit: is.totalAmount, memberId: is.memberId }];
      for (const l of lines) {
        const c = costs.get(l.inputItemId);
        if (c) {
          const cost = D(l.quantity).times(c).toDecimalPlaces(2);
          jl.push({ code: '1300', credit: cost }, { code: '4600', credit: D(l.amount).minus(cost) });
        } else jl.push({ code: '2150', credit: l.amount });
      }
      await post({ amcosId, date: dateOf(is.issuedAt), description: `Pembejeo kwa mkopo ${is.issueNo}`, source: 'INPUT_ISSUE', sourceId: is.id, reference: is.issueNo, approvalId: is.approvalId, lines: jl });
    }
    const cancelled = await tx.select({ issue: I, jid: JE.id }).from(I)
      .innerJoin(JE, and(eq(JE.amcosId, amcosId), eq(JE.source, 'INPUT_ISSUE'), sql`${JE.sourceId} = "input_issues"."id"`))
      .where(and(eq(I.amcosId, amcosId), eq(I.status, 'CANCELLED'),
        sql`not exists (select 1 from journal_entries j where j.amcos_id = ${amcosId} and j.source = 'INPUT_ISSUE_CANCEL' and j.source_id = "input_issues"."id")`));
    for (const c of cancelled) {
      if (await reverseJournal(tx, c.jid, { date: dateOf(c.issue.cancelledAt), description: `Kufutwa kwa pembejeo ${c.issue.issueNo}: ${c.issue.cancelReason ?? ''}`.trim(), source: 'INPUT_ISSUE_CANCEL', sourceId: c.issue.id, createdById: c.issue.cancelledById })) posted++;
    }
    return { posted };
  });
}

// ------------------------------ SALIO NA RIPOTI ------------------------------
export interface Bal { id: string; code: string; name: string; type: GlType; subtype: string | null; financeAccountId: string | null; isActive: boolean; isSystem: boolean; debit: string; credit: string; balance: string }

/** Salio la kila akaunti kati ya tarehe (from hiari). balance = upande wa kawaida wa akaunti (chanya ni kawaida). */
export async function balances(tx: DbOrTx, amcosId: string, o: { from?: string; to?: string; excludeClosing?: boolean } = {}): Promise<Bal[]> {
  const r = await tx.execute<{ id: string; code: string; name: string; type: GlType; subtype: string | null; finance_account_id: string | null; is_active: boolean; is_system: boolean; dr: string; cr: string }>(sql`
    select a.id, a.code, a.name, a.type, a.subtype, a.finance_account_id, a.is_active, a.is_system,
      coalesce(sum(l.debit), 0) as dr, coalesce(sum(l.credit), 0) as cr
    from gl_accounts a
    left join journal_lines l on l.gl_account_id = a.id
      and exists (select 1 from journal_entries e where e.id = l.journal_entry_id
        ${o.from ? sql`and e.entry_date >= ${o.from}` : sql``} ${o.to ? sql`and e.entry_date <= ${o.to}` : sql``}
        ${o.excludeClosing ? sql`and e.source <> 'YEAR_END_CLOSE'` : sql``})
    where a.amcos_id = ${amcosId}
    group by a.id order by a.code`);
  return r.rows.map((x) => {
    const net = D(x.dr).minus(x.cr);
    return { id: x.id, code: x.code, name: x.name, type: x.type, subtype: x.subtype, financeAccountId: x.finance_account_id, isActive: x.is_active, isSystem: x.is_system,
      debit: fmt2(x.dr), credit: fmt2(x.cr), balance: fmt2(isDebitNormal(x.type) ? net : net.neg()) };
  });
}

export const sumBal = (rows: Bal[], f: (r: Bal) => boolean) => rows.filter(f).reduce((s, r) => s.plus(r.balance), D(0));

/** Kagua akaunti ya mkopo/malipo inayoruhusiwa kwenye journal ya mkono (si akaunti za fedha — tumia miamala). */
export function assertManualAllowed(acc: typeof GA.$inferSelect) {
  if (acc.subtype === 'CASH' || acc.financeAccountId) throw badRequest(`${acc.code} ${acc.name}: akaunti za fedha zinaguswa kwa miamala (mapato/matumizi/uhamisho), si journal ya mkono`);
  if (acc.subtype === 'CASH_GROUP') throw badRequest(`${acc.code} ni kichwa cha kundi — chagua akaunti halisi`);
  if (!acc.isActive) throw badRequest(`${acc.code} ${acc.name} imefungwa`);
}

export type { Tx };
