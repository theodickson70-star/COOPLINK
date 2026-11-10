// =====================================================================
//  UFUATILIAJI WA MFUMO (System Control Center)
//   - Uptime: kila dakika 5 mfumo unajikagua (database inajibu?) na kuandika kipindi hicho.
//     Kipindi kisicho na rekodi = mfumo haukuwa hewani (server imezimwa au database haipatikani).
//   - Tahadhari kwa Owner: makosa mengi ghafla, kazi ya nyuma imeshindwa/imesimama, malipo ya simu yamekwama,
//     database inachelewa, na mfumo uliokuwa nje ya hewa. Tahadhari mpya ya CRITICAL -> SMS kwa Owner/Tech Support.
//   Haifuti data yoyote. Hakuna siri zinazoandikwa.
// =====================================================================
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { db, pool, schema } from '../db';
import { sendSms } from './notify';

const BUCKET_MS = 5 * 60 * 1000;
export const ERROR_SPIKE = 10;          // makosa ndani ya dakika 15
export const DB_SLOW_MS = 1000;
export const PAYMENT_STUCK_MIN = 30;
export const DOWNTIME_MIN = 15;         // pengo la zaidi ya dakika 15 bila ukaguzi = mfumo haukuwa hewani
export const HOURLY_JOBS = ['subscriptions.sweep', 'fees.sweep'] as const;
const MONITOR_LOCK = 815_000;

const VERSION = (() => {
  try { return (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }).version; } catch { return null; }
})();

export const bucketOf = (d: Date) => new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS);

/** Ukaguzi mmoja: database inajibu kwa muda gani. Unaandikwa mara moja kwa kila dakika 5 (replica nyingi hazirudii). */
export async function recordUptime() {
  const t0 = Date.now();
  await db.execute(sql`select 1`);
  const dbMs = Date.now() - t0;
  await db.insert(schema.systemUptime).values({ bucket: bucketOf(new Date()), ok: true, dbMs, version: VERSION }).onConflictDoNothing();
  return dbMs;
}

type Cond = { key: string; kind: string; severity: 'CRITICAL' | 'WARNING'; title: string; body?: string | null; active: boolean };

/** Tahadhari iliyo wazi inasasishwa; mpya inaundwa; hali ikiisha inafungwa yenyewe. Inarudisha tahadhari MPYA. */
export async function applyConditions(conds: Cond[]) {
  const fresh: (typeof schema.systemAlerts.$inferSelect)[] = [];
  const A = schema.systemAlerts;
  for (const c of conds) {
    if (c.active) {
      const [u] = await db.update(A).set({ lastAt: new Date(), count: sql`${A.count} + 1`, title: c.title, body: c.body ?? null, severity: c.severity })
        .where(and(eq(A.key, c.key), isNull(A.resolvedAt))).returning();
      if (!u) {
        const [n] = await db.insert(A).values({ key: c.key, kind: c.kind, severity: c.severity, title: c.title, body: c.body ?? null }).onConflictDoNothing().returning();
        if (n) fresh.push(n);
      }
    } else if (c.kind !== 'DOWNTIME') {
      await db.update(A).set({ resolvedAt: new Date(), autoResolved: true }).where(and(eq(A.key, c.key), isNull(A.resolvedAt)));
    }
  }
  return fresh;
}

/** Hali zote zinazokaguliwa kila dakika 5 */
export async function evaluateConditions(): Promise<Cond[]> {
  const conds: Cond[] = [];
  const [{ n: errs }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from system_errors where created_at > now() - interval '15 minutes' and resolved_at is null`)).rows;
  conds.push({ key: 'ERROR_SPIKE', kind: 'ERROR_SPIKE', severity: 'CRITICAL', title: `Makosa ${errs} ya mfumo ndani ya dakika 15`, body: 'Fungua tab ya "Makosa" kuona ni njia gani zinashindwa.', active: errs >= ERROR_SPIKE });

  const jobsOn = process.env.DISABLE_JOBS !== 'true';
  for (const name of HOURLY_JOBS) {
    const [last] = await db.select().from(schema.jobRuns).where(and(eq(schema.jobRuns.name, name), ne(schema.jobRuns.status, 'SKIPPED'), ne(schema.jobRuns.status, 'RUNNING')))
      .orderBy(desc(schema.jobRuns.startedAt)).limit(1);
    const err = (last?.details as { error?: string } | null)?.error;
    conds.push({ key: `JOB_FAILED:${name}`, kind: 'JOB_FAILED', severity: name === 'fees.sweep' ? 'CRITICAL' : 'WARNING', title: `Kazi ya nyuma "${name}" imeshindwa`, body: err ? `Kosa: ${err.slice(0, 300)}` : null, active: last?.status === 'FAILED' });
    const ageH = last ? (Date.now() - last.startedAt.getTime()) / 3_600_000 : null;
    const stale = jobsOn && process.uptime() > 3 * 3600 && (ageH === null || ageH > 3);
    conds.push({ key: `JOB_STALE:${name}`, kind: 'JOB_STALE', severity: 'WARNING', title: `Kazi ya nyuma "${name}" haijaendeshwa kwa zaidi ya saa 3`, body: 'Inapaswa kuendeshwa kila saa. Angalia tab ya "Kazi za nyuma".', active: stale });
  }

  const [{ n: stuck }] = (await db.execute<{ n: number }>(sql`
    select count(*)::int as n from platform_mobile_payments
    where status in ('SENDING', 'PENDING') and abandoned_at is null
      and created_at < now() - make_interval(mins => ${PAYMENT_STUCK_MIN}) and created_at > now() - interval '3 days'`)).rows;
  conds.push({ key: 'PAYMENT_STUCK', kind: 'PAYMENT_STUCK', severity: 'WARNING', title: `Malipo ${stuck} ya simu yamekwama zaidi ya dakika ${PAYMENT_STUCK_MIN}`, body: 'Huenda webhook ya TeePay/Abliner haifiki. Angalia tab ya "Integrations" na ukurasa wa ada.', active: stuck > 0 });

  const slow = (await db.select({ ms: schema.systemUptime.dbMs }).from(schema.systemUptime).orderBy(desc(schema.systemUptime.bucket)).limit(3));
  conds.push({ key: 'DB_SLOW', kind: 'DB_SLOW', severity: 'WARNING', title: 'Database inachelewa kujibu', body: `Ukaguzi 3 wa mwisho: ${slow.map((x) => `${x.ms} ms`).join(', ')}`, active: slow.length === 3 && slow.every((x) => (x.ms ?? 0) > DB_SLOW_MS) });
  return conds;
}

/** SMS kwa Owner na Tech Support (namba zao zinasomwa kwenye database, hazipo kwenye code). */
async function notifyOwners(alerts: (typeof schema.systemAlerts.$inferSelect)[]) {
  const crit = alerts.filter((a) => a.severity === 'CRITICAL');
  if (!crit.length) return;
  const people = await db.select({ phone: schema.users.phone }).from(schema.users)
    .where(and(eq(schema.users.isActive, true), sql`${schema.users.role} in ('SUPER_ADMIN', 'TECH_SUPPORT')`));
  for (const a of crit) {
    let sent = false;
    for (const p of people) {
      const r = await sendSms(p.phone, `CoopLink TAHADHARI: ${a.title}. Fungua System Control Center.`);
      if (r.status === 'SENT') sent = true;
    }
    if (sent) await db.update(schema.systemAlerts).set({ notifiedAt: new Date() }).where(eq(schema.systemAlerts.id, a.id));
  }
}

/** Kazi ya ufuatiliaji (kila dakika 5). HAIRUSHI kosa nje. */
export async function runMonitor(opts: { startup?: boolean } = {}) {
  const client = await pool.connect().catch(() => null);
  if (!client) return { ok: false, reason: 'database haipatikani' };
  try {
    const got = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [MONITOR_LOCK]);
    if (!got.rows[0].ok) return { ok: true, skipped: true };
    try {
      const conds: Cond[] = [];
      if (opts.startup) {
        const [prev] = await db.select({ b: schema.systemUptime.bucket }).from(schema.systemUptime).orderBy(desc(schema.systemUptime.bucket)).limit(1);
        const gapMin = prev ? Math.round((Date.now() - prev.b.getTime()) / 60_000) : 0;
        if (prev && gapMin > DOWNTIME_MIN) {
          const fmt = (d: Date) => d.toLocaleString('sw-TZ', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'medium', timeStyle: 'short' });
          conds.push({ key: `DOWNTIME:${prev.b.toISOString()}`, kind: 'DOWNTIME', severity: 'WARNING', title: `Mfumo haukuwa hewani kwa takriban dakika ${gapMin}`,
            body: `Kuanzia ${fmt(prev.b)} hadi ${fmt(new Date())} (ukaguzi wa mwisho kabla ya kuwaka upya).`, active: true });
        }
      }
      const dbMs = await recordUptime();
      conds.push(...(await evaluateConditions()));
      const fresh = await applyConditions(conds);
      await notifyOwners(fresh).catch((e) => console.error('[monitor] SMS:', (e as Error).message));
      return { ok: true, dbMs, newAlerts: fresh.length };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MONITOR_LOCK]);
    }
  } catch (e) {
    console.error('❌ Ufuatiliaji wa mfumo umeshindwa:', (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  } finally {
    client.release();
  }
}
