// =====================================================================
//  ADA YA COOPLINK KWENYE VITABU VYA CHAMA (v2.7)
//  Malipo ya ada ya CoopLink yakithibitishwa (TeePay/Abliner au Owner), chama kinapata:
//   1. Risiti ya CoopLink (platform_payments) — inaonekana kwa Mhasibu/Meneja kwenye kengele ya arifa.
//   2. Rekodi ya MATUMIZI kwenye fedha za chama (finance_transactions, aina "Ada ya mfumo (CoopLink)",
//      Hati ya Malipo PV-…) — ili matumizi ya chama yawe kamili.
//  Mapato ya CoopLink na fedha za chama ni vitabu viwili tofauti: hapa ni upande wa CHAMA tu (alicholipa).
//
//  Fedha zimetoka akaunti gani ya chama?
//   - Simu iliyolipa ni namba ya akaunti ya simu (MOBILE_MONEY) ya chama yenye salio la kutosha
//     -> matumizi yanakamilishwa (POSTED) kwenye akaunti hiyo moja kwa moja.
//   - Vinginevyo -> yanaandikwa yakiwa "Imeidhinishwa" (malipo yamethibitishwa na mtoa huduma), na Mhasibu
//     anachagua akaunti iliyolipa kwa kitufe "Kamilisha". Mfumo haukisii akaunti — salio lisingekuwa sahihi.
//  Ni salama kuiita mara nyingi: rekodi moja tu kwa kila risiti.
// =====================================================================
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { accountBalance, lockAccount, nextTxnNo } from './finance';
import { nextDocNo } from './finance-docs';
import { D } from './money';
import { normalizePhone } from './http';

const T = schema.financeTransactions;
export const SYSTEM_FEE_CATEGORY = 'SYSTEM_FEE';
export const feeReference = (receiptNo: string) => `CoopLink ${receiptNo}`;

type Payment = typeof schema.platformPayments.$inferSelect;

export async function recordFeeExpense(tx: DbOrTx, p: Payment, opts: { payerPhone?: string | null; userId?: string | null } = {}) {
  if (!p.amcosId || !p.feeId || p.status !== 'VERIFIED' || p.category === 'OTHER') return null; // majaribio hayaingii vitabuni
  const ref = feeReference(p.invoiceNo);
  const [dup] = await tx.select({ id: T.id }).from(T).where(and(eq(T.amcosId, p.amcosId), eq(T.category, SYSTEM_FEE_CATEGORY), eq(T.reference, ref)));
  if (dup) return null;
  const amcos = await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, p.amcosId) });
  const fee = await tx.query.platformFees.findFirst({ where: eq(schema.platformFees.id, p.feeId) });
  if (!amcos || !fee) return null;
  // Aliyeandika: aliyeanzisha malipo; vinginevyo Mhasibu/Meneja wa chama (muamala lazima uwe na mtu)
  let by = opts.userId ?? p.createdById ?? null;
  if (by) {
    const u = await tx.query.users.findFirst({ where: eq(schema.users.id, by), columns: { amcosId: true } });
    if (u?.amcosId !== p.amcosId) by = null; // Owner/mfanyakazi wa CoopLink si mtumishi wa chama
  }
  if (!by) {
    const staff = await tx.select({ id: schema.users.id, role: schema.users.role }).from(schema.users)
      .where(and(eq(schema.users.amcosId, p.amcosId), eq(schema.users.isActive, true), inArray(schema.users.role, ['ACCOUNTANT', 'AMCOS_ADMIN'])));
    by = (staff.find((s) => s.role === 'ACCOUNTANT') ?? staff[0])?.id ?? null;
  }
  if (!by) return null;

  // Akaunti ya simu ya chama iliyolipa (namba ile ile) — tu kama salio linatosha
  let account: typeof schema.financeAccounts.$inferSelect | undefined;
  const phone = normalizePhone(opts.payerPhone ?? '');
  if (phone) {
    const accs = await tx.select().from(schema.financeAccounts)
      .where(and(eq(schema.financeAccounts.amcosId, p.amcosId), eq(schema.financeAccounts.kind, 'MOBILE_MONEY'), eq(schema.financeAccounts.isActive, true)));
    account = accs.find((a) => a.accountNumber && normalizePhone(a.accountNumber) === phone);
    if (account) {
      await lockAccount(tx, account.id);
      if ((await accountBalance(tx, account.id)).lessThan(D(p.amount))) account = undefined;
    }
  }
  const season = await tx.query.seasons.findFirst({ where: eq(schema.seasons.isCurrent, true) });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const description = `${fee.label} — ada ya mfumo wa CoopLink (risiti ${p.invoiceNo})`;
  const [t] = await tx.insert(T).values({
    amcosId: p.amcosId, seasonId: season?.id ?? null, txnNo: await nextTxnNo(tx, p.amcosId, amcos.code), docNo: await nextDocNo(tx, p.amcosId, 'PAYMENT_VOUCHER'),
    kind: 'EXPENSE', direction: 'OUT', category: SYSTEM_FEE_CATEGORY, accountId: account?.id ?? null, amount: p.amount, txnDate: today,
    description, reference: ref, payee: 'CoopLink',
    status: account ? 'POSTED' : 'APPROVED', createdById: by, ...(account ? { postedById: by, postedAt: new Date() } : {}),
  }).returning();
  await tx.insert(schema.financeTxnLines).values({ amcosId: p.amcosId, txnId: t.id, lineNo: 1, description, amount: p.amount });
  await tx.insert(schema.auditLogs).values({
    action: 'SYSTEM_FEE_EXPENSE_RECORDED', entity: 'FinanceTransaction', entityId: t.id, amcosId: p.amcosId, userId: null, userRole: 'SYSTEM',
    after: { receiptNo: p.invoiceNo, amount: p.amount, status: t.status, account: account?.name ?? null, docNo: t.docNo },
  });
  return t;
}
