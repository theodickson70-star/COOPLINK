// =====================================================================
//  MISHAHARA (Tanzania Bara) — PAYE, NSSF, WCF, SDL
//   PAYE ya mwezi (kipato baada ya NSSF ya mfanyakazi):
//     0 – 270,000 .......... 0%
//     270,001 – 520,000 .... 8% ya kinachozidi 270,000
//     520,001 – 760,000 .... 20,000 + 20% ya kinachozidi 520,000
//     760,001 – 1,000,000 .. 68,000 + 25% ya kinachozidi 760,000
//     zaidi ya 1,000,000 ... 128,000 + 30% ya kinachozidi 1,000,000
//   NSSF: 10% mfanyakazi + 10% mwajiri · WCF: 0.5% mwajiri · SDL: 3.5% mwajiri (wafanyakazi 10+)
//   Viwango vinaweza kubadilika kwa sheria mpya ya fedha — vibadilishwe hapa (sehemu moja).
// =====================================================================
import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '../db';
import { D, Decimal, fmt2 } from './money';
import { conflict } from './errors';
import { audit } from './audit';
import { postJournal } from './gl';

export const PAYROLL_RATES = {
  bands: [
    { from: 0, to: 270_000, base: 0, rate: 0 },
    { from: 270_000, to: 520_000, base: 0, rate: 0.08 },
    { from: 520_000, to: 760_000, base: 20_000, rate: 0.20 },
    { from: 760_000, to: 1_000_000, base: 68_000, rate: 0.25 },
    { from: 1_000_000, to: Infinity, base: 128_000, rate: 0.30 },
  ],
  nssfEmployee: 0.10,
  nssfEmployer: 0.10,
  wcf: 0.005,
  sdl: 0.035,
  sdlMinEmployees: 10,
};

export function paye(taxable: Decimal.Value): Decimal {
  const t = D(taxable);
  if (t.lte(0)) return D(0);
  const band = [...PAYROLL_RATES.bands].reverse().find((b) => t.gt(b.from)) ?? PAYROLL_RATES.bands[0];
  return D(band.base).plus(t.minus(band.from).times(band.rate)).toDecimalPlaces(2);
}

export function computeLine(e: { basicSalary: string; allowances: string; otherDeductions: string }, sdlApplies: boolean) {
  const gross = D(e.basicSalary).plus(e.allowances);
  const nssfEmployee = gross.times(PAYROLL_RATES.nssfEmployee).toDecimalPlaces(2);
  const taxable = gross.minus(nssfEmployee);
  const tax = paye(taxable);
  const other = Decimal.min(D(e.otherDeductions), gross.minus(nssfEmployee).minus(tax));
  const net = gross.minus(nssfEmployee).minus(tax).minus(Decimal.max(other, 0));
  return {
    basicSalary: fmt2(e.basicSalary), allowances: fmt2(e.allowances), gross: fmt2(gross), nssfEmployee: fmt2(nssfEmployee), taxable: fmt2(taxable),
    paye: fmt2(tax), otherDeductions: fmt2(Decimal.max(other, 0)), net: fmt2(net),
    nssfEmployer: fmt2(gross.times(PAYROLL_RATES.nssfEmployer)), wcf: fmt2(gross.times(PAYROLL_RATES.wcf)), sdl: fmt2(sdlApplies ? gross.times(PAYROLL_RATES.sdl) : 0),
  };
}

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;

const lastDay = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Idhini ya mishahara: gharama na madeni (PAYE, NSSF, WCF, SDL, mishahara) yanaingia daftari kuu. */
export async function onPayroll(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const R = schema.payrollRuns;
  const [run] = await tx.select().from(R).where(eq(R.id, a.entityId!)).for('update');
  if (!run || run.status !== 'PENDING_APPROVAL') throw conflict('Mishahara hii haisubiri idhini');
  if (o !== 'APPROVED') {
    await tx.update(R).set({ status: o === 'REJECTED' ? 'REJECTED' : 'CANCELLED' }).where(eq(R.id, run.id));
    await audit(tx, req, { action: `PAYROLL_${o}`, entity: 'PayrollRun', entityId: run.id, amcosId: a.amcosId, after: { note } });
    return;
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const end = lastDay(run.period);
  const employer = D(run.totalNssfEmployer).plus(run.totalWcf).plus(run.totalSdl);
  await postJournal(tx, {
    amcosId: a.amcosId, date: end < today ? end : today, description: `Mishahara ya ${run.period} (${run.runNo})`, source: 'PAYROLL', sourceId: run.id,
    reference: run.runNo, approvalId: a.id, createdById: req.auth!.userId,
    lines: [
      { code: '5100', debit: run.totalGross, memo: 'Mishahara ghafi' },
      { code: '5110', debit: employer, memo: 'Michango ya mwajiri' },
      { code: '2400', credit: run.totalNet, memo: 'Mishahara halisi inayodaiwa' },
      { code: '2410', credit: run.totalPaye },
      { code: '2420', credit: D(run.totalNssfEmployee).plus(run.totalNssfEmployer) },
      { code: '2430', credit: run.totalWcf },
      { code: '2440', credit: run.totalSdl },
      { code: '2450', credit: run.totalOtherDeductions },
    ],
  });
  await tx.update(R).set({ status: 'APPROVED' }).where(and(eq(R.id, run.id), eq(R.status, 'PENDING_APPROVAL')));
  await audit(tx, req, { action: 'PAYROLL_APPROVED', entity: 'PayrollRun', entityId: run.id, amcosId: a.amcosId, after: { period: run.period, net: run.totalNet, note } });
}
