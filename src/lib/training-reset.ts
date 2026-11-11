// =====================================================================
//  KUFUTA DATA YA MAFUNZO (Owner pekee)
//   Chama kilichotumika kufundishia kinaanza upya bila kufungua akaunti mpya:
//   - Kinachobaki: chama (jina, code, usajili, mipangilio ya Owner), watumishi na nenosiri zao,
//     ada/subscription/malipo kwa CoopLink (mapato ya kampuni), akaunti za mfumo kwenye chati ya GL.
//   - Kinachofutwa: kila kitu kilichojazwa na chama (wakulima, pembejeo, fedha, mauzo, mikopo, mishahara,
//     mali, idhini, audit, tiketi za msaada, mipangilio ya chama) na namba zote zinaanza upya.
//   Inaruhusiwa tu kwa chama chenye alama ya "Mafunzo"; baada ya kufuta alama inaondolewa (chama kinakuwa hai
//   na hakiwezi kufutiwa tena kwa njia hii). Rekodi zisizobadilika zinafutwa tu ndani ya muamala huu
//   (cooplink.training_reset = on), kinga za database zinabaki kwa kila kitu kingine.
// =====================================================================
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx, Tx } from '../db';

type Step = { key: string; label: string; table: string; where: (a: string) => SQL };
const own = (table: string) => (a: string) => sql`${sql.raw(table)}.amcos_id = ${a}`;
const via = (col: string, parent: string) => (a: string) => sql`${sql.raw(col)} in (select id from ${sql.raw(parent)} where amcos_id = ${a})`;

/** Mpangilio wa kufuta: watoto kwanza (foreign keys), kisha wazazi. */
export const RESET_STEPS: Step[] = [
  { key: 'support_attachments', label: 'Viambatisho vya tiketi', table: 'support_attachments', where: via('ticket_id', 'support_tickets') },
  { key: 'support_messages', label: 'Ujumbe wa tiketi', table: 'support_messages', where: via('ticket_id', 'support_tickets') },
  { key: 'support_tickets', label: 'Tiketi za msaada', table: 'support_tickets', where: own('support_tickets') },
  { key: 'bank_reconciliation_items', label: 'Usuluhishi wa benki (mistari)', table: 'bank_reconciliation_items', where: via('reconciliation_id', 'bank_reconciliations') },
  { key: 'bank_reconciliations', label: 'Usuluhishi wa benki', table: 'bank_reconciliations', where: own('bank_reconciliations') },
  { key: 'depreciation_lines', label: 'Uchakavu (mistari)', table: 'depreciation_lines', where: via('run_id', 'depreciation_runs') },
  { key: 'depreciation_runs', label: 'Uchakavu wa mali', table: 'depreciation_runs', where: own('depreciation_runs') },
  { key: 'payroll_lines', label: 'Mishahara (mistari)', table: 'payroll_lines', where: via('payroll_run_id', 'payroll_runs') },
  { key: 'payroll_runs', label: 'Mishahara', table: 'payroll_runs', where: own('payroll_runs') },
  { key: 'employees', label: 'Watumishi wa mishahara', table: 'employees', where: own('employees') },
  { key: 'payments', label: 'Malipo ya wakulima', table: 'payments', where: own('payments') },
  { key: 'payment_batches', label: 'Orodha za malipo', table: 'payment_batches', where: own('payment_batches') },
  { key: 'settlement_lines', label: 'Makato ya hesabu', table: 'settlement_lines', where: via('settlement_id', 'settlements') },
  { key: 'settlements', label: 'Hesabu za wakulima', table: 'settlements', where: own('settlements') },
  { key: 'bales', label: 'Mabelo', table: 'bales', where: own('bales') },
  { key: 'markets', label: 'Masoko', table: 'markets', where: own('markets') },
  { key: 'kuni_loans', label: 'Mikopo (wakulima)', table: 'kuni_loans', where: own('kuni_loans') },
  { key: 'kuni_batches', label: 'Orodha za mikopo', table: 'kuni_batches', where: own('kuni_batches') },
  { key: 'kuni_settings', label: 'Mipangilio ya mikopo', table: 'kuni_settings', where: own('kuni_settings') },
  { key: 'journal_lines', label: 'Daftari kuu (mistari)', table: 'journal_lines', where: own('journal_lines') },
  { key: 'journal_entries', label: 'Journal za daftari kuu', table: 'journal_entries', where: own('journal_entries') },
  { key: 'finance_transactions', label: 'Miamala ya fedha', table: 'finance_transactions', where: own('finance_transactions') },
  { key: 'finance_budgets', label: 'Bajeti', table: 'finance_budgets', where: own('finance_budgets') },
  { key: 'finance_accounts', label: 'Akaunti za fedha', table: 'finance_accounts', where: own('finance_accounts') },
  // Akaunti za GL zilizoongezwa na chama (si za mfumo) — pamoja na zinazowakilisha akaunti za fedha zilizofutwa
  { key: 'gl_accounts', label: 'Akaunti za daftari kuu zilizoongezwa', table: 'gl_accounts', where: (a) => sql`gl_accounts.amcos_id = ${a} and (gl_accounts.is_system = false or gl_accounts.finance_account_id is not null)` },
  { key: 'stock_movements', label: 'Mizigo ya stoo', table: 'stock_movements', where: own('stock_movements') },
  { key: 'input_issue_lines', label: 'Ugawaji (mistari)', table: 'input_issue_lines', where: via('input_issue_id', 'input_issues') },
  { key: 'input_issues', label: 'Ugawaji wa pembejeo', table: 'input_issues', where: own('input_issues') },
  { key: 'estimate_inputs', label: 'Pembejeo za makisio', table: 'estimate_inputs', where: via('estimate_id', 'estimates') },
  { key: 'estimates', label: 'Makisio', table: 'estimates', where: own('estimates') },
  { key: 'farms', label: 'Mashamba', table: 'farms', where: own('farms') },
  { key: 'purchase_request_lines', label: 'Manunuzi (mistari)', table: 'purchase_request_lines', where: via('purchase_request_id', 'purchase_requests') },
  { key: 'purchase_requests', label: 'Maombi ya manunuzi', table: 'purchase_requests', where: own('purchase_requests') },
  { key: 'suppliers', label: 'Wazabuni', table: 'suppliers', where: own('suppliers') },
  { key: 'input_prices', label: 'Bei za pembejeo', table: 'input_prices', where: own('input_prices') },
  { key: 'input_items', label: 'Bidhaa za pembejeo', table: 'input_items', where: own('input_items') },
  { key: 'member_group_members', label: 'Wanachama wa vikundi', table: 'member_group_members', where: via('group_id', 'member_groups') },
  { key: 'member_groups', label: 'Vikundi', table: 'member_groups', where: own('member_groups') },
  { key: 'member_ledger_entries', label: 'Ledger ya wakulima', table: 'member_ledger_entries', where: own('member_ledger_entries') },
  { key: 'member_usd_ledger', label: 'Madeni ya dola', table: 'member_usd_ledger', where: own('member_usd_ledger') },
  { key: 'member_photos', label: 'Picha za wakulima', table: 'member_photos', where: via('member_id', 'members') },
  { key: 'members', label: 'Wakulima', table: 'members', where: own('members') },
  { key: 'grade_prices', label: 'Bei za madaraja', table: 'grade_prices', where: own('grade_prices') },
  { key: 'deduction_rules', label: 'Kanuni za makato', table: 'deduction_rules', where: own('deduction_rules') },
  { key: 'fx_rates', label: 'Viwango vya dola', table: 'fx_rates', where: own('fx_rates') },
  { key: 'fixed_assets', label: 'Mali za chama', table: 'fixed_assets', where: own('fixed_assets') },
  { key: 'period_locks', label: 'Vipindi vilivyofungwa', table: 'period_locks', where: own('period_locks') },
  { key: 'approval_requests', label: 'Maombi ya idhini', table: 'approval_requests', where: own('approval_requests') },
  { key: 'sms_logs', label: 'SMS zilizotumwa', table: 'sms_logs', where: own('sms_logs') },
  { key: 'counters', label: 'Namba (zinaanza upya)', table: 'counters', where: own('counters') },
  { key: 'audit_logs', label: 'Kumbukumbu (audit)', table: 'audit_logs', where: own('audit_logs') },
];

/** Muhtasari unaoonyeshwa kwa Owner kabla ya kufuta */
export const PREVIEW_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Wakulima', keys: ['members'] },
  { label: 'Vikundi', keys: ['member_groups'] },
  { label: 'Makisio', keys: ['estimates'] },
  { label: 'Bidhaa za pembejeo', keys: ['input_items'] },
  { label: 'Ugawaji wa pembejeo', keys: ['input_issues'] },
  { label: 'Mizigo ya stoo', keys: ['stock_movements'] },
  { label: 'Manunuzi na wazabuni', keys: ['purchase_requests', 'suppliers'] },
  { label: 'Akaunti za fedha', keys: ['finance_accounts'] },
  { label: 'Miamala ya fedha', keys: ['finance_transactions'] },
  { label: 'Journal za daftari kuu', keys: ['journal_entries'] },
  { label: 'Masoko na mabelo', keys: ['markets', 'bales'] },
  { label: 'Hesabu na malipo ya wakulima', keys: ['settlements', 'payments'] },
  { label: 'Mikopo', keys: ['kuni_batches'] },
  { label: 'Mishahara na watumishi wa mishahara', keys: ['payroll_runs', 'employees'] },
  { label: 'Mali za chama', keys: ['fixed_assets'] },
  { label: 'Mipangilio (bei za madaraja, makato, mikopo, dola)', keys: ['grade_prices', 'deduction_rules', 'kuni_settings', 'fx_rates'] },
  { label: 'Maombi ya idhini', keys: ['approval_requests'] },
  { label: 'Tiketi za msaada', keys: ['support_tickets'] },
  { label: 'Kumbukumbu (audit)', keys: ['audit_logs'] },
];

export async function resetCounts(tx: DbOrTx, amcosId: string) {
  const out: Record<string, number> = {};
  for (const s of RESET_STEPS) {
    const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.raw(s.table)} where ${s.where(amcosId)}`);
    out[s.key] = r.rows[0].n;
  }
  return out;
}

/** Nakala ya data itakayofutwa (JSON) — Owner anaipakua kabla ya kufuta */
export async function resetBackup(tx: DbOrTx, amcosId: string) {
  const out: Record<string, unknown[]> = {};
  for (const s of RESET_STEPS) {
    // picha na viambatisho ni vikubwa — vinarekodiwa kwa idadi tu
    if (s.key === 'member_photos' || s.key === 'support_attachments') { out[s.key] = []; continue; }
    const r = await tx.execute(sql`select * from ${sql.raw(s.table)} where ${s.where(amcosId)}`);
    out[s.key] = r.rows;
  }
  return out;
}

/** Inafuta data yote ya chama (ndani ya muamala uliopo). Inarudisha idadi zilizofutwa. */
export async function runTrainingReset(tx: Tx, amcosId: string) {
  await tx.execute(sql`select set_config('cooplink.training_reset', 'on', true)`);
  const deleted: Record<string, number> = {};
  for (const s of RESET_STEPS) {
    const r = await tx.execute(sql`delete from ${sql.raw(s.table)} where ${s.where(amcosId)}`);
    deleted[s.key] = r.rowCount ?? 0;
  }
  await tx.execute(sql`select set_config('cooplink.training_reset', 'off', true)`);
  return deleted;
}
