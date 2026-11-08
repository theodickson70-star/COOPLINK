// =====================================================================
//  MISHAHARA (Mhasibu anaandaa · Meneja anaidhinisha · Mhasibu analipa)
//   Wafanyakazi wa chama · hesabu ya PAYE/NSSF/WCF/SDL · hati za mishahara (payslips)
// =====================================================================
import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah, decimalSchema, uuidParam } from '../lib/http';
import { badRequest, conflict, notFound } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { amcosScope, readAmcosId, resolveWriteAmcosId } from '../middleware/tenant';
import { audit } from '../lib/audit';
import { D, fmt2, tshText } from '../lib/money';
import { nextNumber, pad } from '../lib/counter';
import { createApproval } from '../lib/approvals';
import { accountBalance, lockAccount, nextTxnNo } from '../lib/finance';
import { computeLine, PAYROLL_RATES } from '../lib/payroll';
import { ensureChart, glMap } from '../lib/gl';
import { todayStr } from './accounting.routes';

export const payrollRouter = Router();
const E = schema.employees;
const R = schema.payrollRuns;
const L = schema.payrollLines;
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Kipindi kiwe YYYY-MM');

payrollRouter.get('/rates', requireAmcosPerm('payroll.read'), (_req, res) => {
  res.json({ ...PAYROLL_RATES, bands: PAYROLL_RATES.bands.map((b) => ({ ...b, to: Number.isFinite(b.to) ? b.to : null })) });
});

// ------------------------------ WAFANYAKAZI ------------------------------
payrollRouter.get('/employees', requireAmcosPerm('payroll.read'), ah(async (req, res) => {
  const rows = await db.select().from(E).where(amcosScope(req, E.amcosId)).orderBy(desc(E.isActive), asc(E.employeeNo));
  res.json({ data: rows.map((e) => ({ ...e, preview: computeLine(e, false) })) });
}));

const empBody = z.object({
  fullName: z.string().trim().min(3),
  position: z.string().trim().min(2),
  phone: z.string().trim().nullable().optional(),
  basicSalary: decimalSchema({ min: 0 }),
  allowances: decimalSchema({ min: 0 }).optional(),
  otherDeductions: decimalSchema({ min: 0 }).optional(),
  nssfNo: z.string().trim().nullable().optional(),
  tin: z.string().trim().nullable().optional(),
  paymentMethod: z.enum(['MOBILE_MONEY', 'BANK', 'CASH']).default('BANK'),
  bankName: z.string().trim().nullable().optional(),
  accountNumber: z.string().trim().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

payrollRouter.post('/employees', requireAmcosPerm('payroll.manage'), ah(async (req, res) => {
  const body = empBody.parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  const emp = await db.transaction(async (tx) => {
    const n = await nextNumber(tx, amcosId, 'employee');
    const [e] = await tx.insert(E).values({ ...body, amcosId, employeeNo: `EMP-${pad(n, 3)}` }).returning();
    await audit(tx, req, { action: 'EMPLOYEE_CREATE', entity: 'Employee', entityId: e.id, amcosId, after: e });
    return e;
  });
  res.status(201).json({ employee: emp });
}));

payrollRouter.patch('/employees/:id', requireAmcosPerm('payroll.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = empBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const [before] = await db.select().from(E).where(and(eq(E.id, id), amcosScope(req, E.amcosId)));
  if (!before) throw notFound('Mfanyakazi');
  const emp = await db.transaction(async (tx) => {
    const [e] = await tx.update(E).set(body).where(eq(E.id, id)).returning();
    await audit(tx, req, { action: 'EMPLOYEE_UPDATE', entity: 'Employee', entityId: id, amcosId: before.amcosId, before, after: e });
    return e;
  });
  res.json({ employee: emp });
}));

// ------------------------------ MISHAHARA YA MWEZI ------------------------------
async function compute(amcosId: string) {
  const emps = await db.select().from(E).where(and(eq(E.amcosId, amcosId), eq(E.isActive, true))).orderBy(asc(E.employeeNo));
  const sdl = emps.length >= PAYROLL_RATES.sdlMinEmployees;
  const lines = emps.map((e) => ({ employee: e, ...computeLine(e, sdl) }));
  const t = (k: 'gross' | 'paye' | 'nssfEmployee' | 'nssfEmployer' | 'wcf' | 'sdl' | 'otherDeductions' | 'net') => fmt2(lines.reduce((s, l) => s.plus(l[k]), D(0)));
  return {
    sdlApplies: sdl, lines,
    totals: { gross: t('gross'), paye: t('paye'), nssfEmployee: t('nssfEmployee'), nssfEmployer: t('nssfEmployer'), wcf: t('wcf'), sdl: t('sdl'), otherDeductions: t('otherDeductions'), net: t('net') },
  };
}

payrollRouter.get('/preview', requireAmcosPerm('payroll.read'), ah(async (req, res) => {
  const amcosId = await readAmcosId(req);
  res.json(await compute(amcosId));
}));

payrollRouter.get('/runs', requireAmcosPerm('payroll.read'), ah(async (req, res) => {
  const rows = await db.select({ run: R, employees: sql<number>`(select count(*)::int from payroll_lines l where l.payroll_run_id = "payroll_runs"."id")` })
    .from(R).where(amcosScope(req, R.amcosId)).orderBy(desc(R.period), desc(R.createdAt));
  res.json({ data: rows.map((r) => ({ ...r.run, employees: r.employees })) });
}));

payrollRouter.post('/runs', requireAmcosPerm('payroll.manage'), ah(async (req, res) => {
  const body = z.object({ period, notes: z.string().trim().nullable().optional() }).parse(req.body);
  const amcosId = await resolveWriteAmcosId(req);
  if (body.period > todayStr().slice(0, 7)) throw badRequest('Huwezi kuandaa mishahara ya mwezi ujao');
  const c = await compute(amcosId);
  if (!c.lines.length) throw badRequest('Hakuna wafanyakazi hai — ongeza wafanyakazi kwanza');
  const out = await db.transaction(async (tx) => {
    const [dup] = await tx.select({ n: count() }).from(R).where(and(eq(R.amcosId, amcosId), eq(R.period, body.period), sql`status in ('PENDING_APPROVAL', 'APPROVED', 'PAID')`));
    if (dup.n > 0) throw conflict(`Mishahara ya ${body.period} tayari imeandaliwa`);
    const n = await nextNumber(tx, amcosId, 'payroll');
    const [run] = await tx.insert(R).values({
      amcosId, runNo: `MSH-${pad(n, 4)}`, period: body.period, notes: body.notes ?? null, createdById: req.auth!.userId,
      totalGross: c.totals.gross, totalPaye: c.totals.paye, totalNssfEmployee: c.totals.nssfEmployee, totalNssfEmployer: c.totals.nssfEmployer,
      totalWcf: c.totals.wcf, totalSdl: c.totals.sdl, totalOtherDeductions: c.totals.otherDeductions, totalNet: c.totals.net,
    }).returning();
    await tx.insert(L).values(c.lines.map(({ employee, ...l }) => ({ ...l, payrollRunId: run.id, employeeId: employee.id })));
    const approval = await createApproval(tx, req, {
      amcosId, type: 'PAYROLL', entityType: 'PayrollRun', entityId: run.id, amount: c.totals.gross,
      title: `Mishahara ${body.period}: wafanyakazi ${c.lines.length}, ghafi ${tshText(c.totals.gross)}, halisi ${tshText(c.totals.net)}`,
      reason: `PAYE ${tshText(c.totals.paye)} · NSSF ${tshText(D(c.totals.nssfEmployee).plus(c.totals.nssfEmployer))} · WCF ${tshText(c.totals.wcf)}${c.sdlApplies ? ` · SDL ${tshText(c.totals.sdl)}` : ''}`,
    });
    const [upd] = await tx.update(R).set({ approvalId: approval.id }).where(eq(R.id, run.id)).returning();
    await audit(tx, req, { action: 'PAYROLL_PREPARE', entity: 'PayrollRun', entityId: run.id, amcosId, after: upd });
    return { run: upd, approval };
  });
  res.status(201).json(out);
}));

async function findRun(req: Request, id: string) {
  const [r] = await db.select().from(R).where(and(eq(R.id, id), amcosScope(req, R.amcosId)));
  if (!r) throw notFound('Mishahara');
  return r;
}

payrollRouter.get('/runs/:id', requireAmcosPerm('payroll.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const run = await findRun(req, id);
  const lines = await db.select({ l: L, e: E }).from(L).innerJoin(E, eq(E.id, L.employeeId)).where(eq(L.payrollRunId, id)).orderBy(asc(E.employeeNo));
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, run.amcosId) }))!;
  const approval = run.approvalId ? await db.select({ a: schema.approvalRequests, by: sql<string | null>`(select u.full_name from users u where u.id = "approval_requests"."decided_by_id")` })
    .from(schema.approvalRequests).where(eq(schema.approvalRequests.id, run.approvalId)) : [];
  const paid = run.paidTxnId ? await db.query.financeTransactions.findFirst({ where: eq(schema.financeTransactions.id, run.paidTxnId) }) : null;
  res.json({
    run, amcos: { name: amcos.name, code: amcos.code, district: amcos.district, region: amcos.region },
    approval: approval[0] ? { ...approval[0].a, decidedBy: approval[0].by } : null, paidTxn: paid ?? null,
    lines: lines.map((x) => ({ ...x.l, employee: { id: x.e.id, employeeNo: x.e.employeeNo, fullName: x.e.fullName, position: x.e.position, nssfNo: x.e.nssfNo, tin: x.e.tin, paymentMethod: x.e.paymentMethod, bankName: x.e.bankName, accountNumber: x.e.accountNumber } })),
  });
}));

/** Kulipa mishahara iliyoidhinishwa: fedha halisi zinatoka kwenye akaunti; deni la mishahara (2400) linalipwa. */
payrollRouter.post('/runs/:id/pay', requireAmcosPerm('payroll.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const body = z.object({ accountId: z.string().uuid(), txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reference: z.string().trim().nullable().optional() }).parse(req.body);
  const run = await findRun(req, id);
  if (run.status !== 'APPROVED') throw badRequest(run.status === 'PENDING_APPROVAL' ? 'Mishahara hii bado inasubiri idhini ya Meneja' : 'Mishahara hii haiwezi kulipwa');
  const [acc] = await db.select().from(schema.financeAccounts).where(and(eq(schema.financeAccounts.id, body.accountId), eq(schema.financeAccounts.amcosId, run.amcosId)));
  if (!acc || !acc.isActive) throw badRequest('Akaunti ya fedha si sahihi');
  const amcos = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, run.amcosId) }))!;
  const out = await db.transaction(async (tx) => {
    await ensureChart(tx, run.amcosId);
    const gl = (await glMap(tx, run.amcosId)).byCode.get('2400')!;
    await lockAccount(tx, acc.id);
    const bal = await accountBalance(tx, acc.id);
    if (bal.lessThan(run.totalNet)) throw badRequest(`Salio la ${acc.name} halitoshi (TSh ${fmt2(bal)})`);
    const [t] = await tx.insert(schema.financeTransactions).values({
      amcosId: run.amcosId, txnNo: await nextTxnNo(tx, run.amcosId, amcos.code), kind: 'EXPENSE', direction: 'OUT', category: 'SALARIES', accountId: acc.id,
      amount: run.totalNet, txnDate: body.txnDate ?? todayStr(), description: `Mishahara halisi ya ${run.period} (${run.runNo})`, reference: body.reference ?? run.runNo,
      payee: 'Wafanyakazi wa chama', contraGlAccountId: gl.id, status: 'POSTED', approvalId: run.approvalId, createdById: req.auth!.userId, postedById: req.auth!.userId, postedAt: new Date(),
    }).returning();
    const [r] = await tx.update(R).set({ status: 'PAID', paidTxnId: t.id }).where(and(eq(R.id, id), eq(R.status, 'APPROVED'))).returning();
    if (!r) throw conflict('Mishahara imebadilishwa na mtu mwingine');
    await audit(tx, req, { action: 'PAYROLL_PAID', entity: 'PayrollRun', entityId: id, amcosId: run.amcosId, after: { txnNo: t.txnNo, amount: t.amount, account: acc.name } });
    return { run: r, transaction: t };
  });
  res.json(out);
}));
