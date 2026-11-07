// =====================================================================
//  SUBSCRIPTIONS ZA COOPLINK (biashara ya jukwaa)
//  Hali inatokana na tarehe:
//    TRIAL / ACTIVE : leo <= endDate
//    PAST_DUE       : endDate < leo <= endDate + graceDays   (bado wanaingia, wanakumbushwa)
//    EXPIRED        : baada ya grace -> chama kinasitishwa (kama enforceSubscriptions = true)
//  endDate inasogezwa TU na malipo yaliyothibitishwa, au nyongeza ya Owner yenye sababu.
// =====================================================================
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';
import { D, fmt2 } from './money';
import { getSetting } from './settings';

type Sub = typeof schema.subscriptions.$inferSelect;
type Plan = typeof schema.subscriptionPlans.$inferSelect;
export type Cycle = (typeof schema.billingCycleEnum.enumValues)[number];
export type SubStatus = (typeof schema.subscriptionStatusEnum.enumValues)[number];

/** Tarehe ya leo Tanzania (YYYY-MM-DD). */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());

const toDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = toDate(d); x.setUTCDate(x.getUTCDate() + n); return fmtDate(x); };
export const addMonths = (d: string, n: number) => {
  const x = toDate(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return fmtDate(x);
};
export const addPeriods = (d: string, cycle: Cycle, n: number) =>
  cycle === 'ANNUAL' ? addMonths(d, 12 * n) : cycle === 'MONTHLY' ? addMonths(d, n) : addDays(d, n);
export const maxDate = (a: string, b: string) => (a > b ? a : b);

export function computeStatus(sub: Pick<Sub, 'status' | 'cycle' | 'endDate' | 'graceDays'>, t = today()): SubStatus {
  if (sub.status === 'CANCELLED') return 'CANCELLED';
  if (t <= sub.endDate) return sub.cycle === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
  if (t <= addDays(sub.endDate, sub.graceDays)) return 'PAST_DUE';
  return 'EXPIRED';
}

export function planPrice(plan: Plan, cycle: Cycle, discountPercent: string | number = 0) {
  if (cycle === 'TRIAL') return '0.00';
  const base = cycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
  return fmt2(D(base).times(D(100).minus(discountPercent)).dividedBy(100));
}

export async function currentSubscription(tx: DbOrTx, amcosId: string) {
  const [s] = await tx.select().from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.amcosId, amcosId), inArray(schema.subscriptions.status, ['TRIAL', 'ACTIVE', 'PAST_DUE'])))
    .limit(1);
  if (s) return s;
  const [latest] = await tx.select().from(schema.subscriptions)
    .where(eq(schema.subscriptions.amcosId, amcosId))
    .orderBy(sql`${schema.subscriptions.createdAt} desc`).limit(1);
  return latest ?? null;
}

/** Chama kipate/kipoteze access kulingana na subscription. Kinagusa TU vyama vilivyositishwa kwa sababu ya subscription. */
export async function syncAmcosAccess(tx: DbOrTx, amcosId: string, status: SubStatus) {
  const cfg = await getSetting('config');
  const a = await tx.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId) });
  if (!a) return null;
  if (status === 'EXPIRED' && cfg.enforceSubscriptions && a.status === 'ACTIVE') {
    await tx.update(schema.amcos).set({ status: 'SUSPENDED', isActive: false, statusReason: 'SUBSCRIPTION_EXPIRED' }).where(eq(schema.amcos.id, amcosId));
    return 'SUSPENDED' as const;
  }
  if (['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(status) && a.status === 'SUSPENDED' && a.statusReason === 'SUBSCRIPTION_EXPIRED') {
    await tx.update(schema.amcos).set({ status: 'ACTIVE', isActive: true, statusReason: null }).where(eq(schema.amcos.id, amcosId));
    return 'REACTIVATED' as const;
  }
  return null;
}

/** Weka mpango kwa chama: subscription ya sasa inafutwa (CANCELLED), mpya inaanza. */
export async function assignPlan(tx: DbOrTx, p: {
  amcosId: string; plan: Plan; cycle: Cycle; startDate: string; discountPercent: string; notes?: string | null; userId?: string;
}) {
  await tx.update(schema.subscriptions)
    .set({ status: 'CANCELLED', cancelledAt: new Date() })
    .where(and(eq(schema.subscriptions.amcosId, p.amcosId), inArray(schema.subscriptions.status, ['TRIAL', 'ACTIVE', 'PAST_DUE'])));
  // Trial: siku za trial. Mpango wa kulipia: haujalipwa bado -> endDate = startDate (grace inaanza).
  const endDate = p.cycle === 'TRIAL' ? addDays(p.startDate, p.plan.trialDays) : p.startDate;
  const draft = { status: 'ACTIVE' as SubStatus, cycle: p.cycle, endDate, graceDays: p.plan.graceDays };
  const status = computeStatus(draft);
  const [sub] = await tx.insert(schema.subscriptions).values({
    amcosId: p.amcosId, planId: p.plan.id, cycle: p.cycle, status, startDate: p.startDate, endDate,
    graceDays: p.plan.graceDays, discountPercent: p.discountPercent, price: planPrice(p.plan, p.cycle, p.discountPercent),
    notes: p.notes ?? null, createdById: p.userId,
  }).returning();
  const access = await syncAmcosAccess(tx, p.amcosId, status);
  return { sub, access };
}

/** Sogeza endDate (malipo yaliyothibitishwa au nyongeza ya Owner) na upange upya hali. */
export async function extendSubscription(tx: DbOrTx, sub: Sub, opts: { periods?: number; cycle?: Cycle; days?: number; plan?: Plan }) {
  let cycle = sub.cycle;
  let price = sub.price;
  if (opts.cycle && opts.cycle !== 'TRIAL' && sub.cycle === 'TRIAL') {
    cycle = opts.cycle;
    if (opts.plan) price = planPrice(opts.plan, cycle, sub.discountPercent);
  }
  const from = maxDate(sub.endDate, today());
  const endDate = opts.days ? addDays(from, opts.days) : addPeriods(from, cycle === 'TRIAL' ? 'MONTHLY' : cycle, opts.periods ?? 1);
  const status = computeStatus({ status: 'ACTIVE', cycle, endDate, graceDays: sub.graceDays });
  const [updated] = await tx.update(schema.subscriptions).set({ cycle, price, endDate, status })
    .where(eq(schema.subscriptions.id, sub.id)).returning();
  const access = await syncAmcosAccess(tx, sub.amcosId, status);
  return { sub: updated, access };
}

/** Kazi ya nyuma: panga hali za subscriptions na usitishe/uwashe vyama. */
export async function runSubscriptionSweep(dbx: DbOrTx = db) {
  const t = today();
  const subs = await dbx.select().from(schema.subscriptions)
    .where(inArray(schema.subscriptions.status, ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED']));
  let changed = 0, suspended = 0, reactivated = 0;
  for (const s of subs) {
    const status = computeStatus(s, t);
    await dbx.transaction(async (tx) => {
      if (status !== s.status) {
        await tx.update(schema.subscriptions).set({ status }).where(eq(schema.subscriptions.id, s.id));
        changed++;
      }
      const access = await syncAmcosAccess(tx, s.amcosId, status);
      if (access) {
        await tx.insert(schema.auditLogs).values({
          action: access === 'SUSPENDED' ? 'AMCOS_AUTO_SUSPEND' : 'AMCOS_AUTO_REACTIVATE', entity: 'Amcos', entityId: s.amcosId,
          amcosId: s.amcosId, userRole: 'SYSTEM', after: { subscriptionId: s.id, subscriptionStatus: status },
        });
        if (access === 'SUSPENDED') suspended++; else reactivated++;
      }
    });
  }
  return { checked: subs.length, changed, suspended, reactivated, date: t };
}

export async function nextInvoiceNo(tx: DbOrTx) {
  const r = await tx.execute<{ n: string }>(sql`select nextval('platform_invoice_seq') as n`);
  return `CL-INV-${String(r.rows[0].n).padStart(6, '0')}`;
}
