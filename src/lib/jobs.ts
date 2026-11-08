// Kazi za nyuma (background jobs). Zinaendeshwa ndani ya server, kila saa.
// Kama kuna replicas zaidi ya moja, advisory lock inahakikisha moja tu inaendesha kazi.
import { eq, sql } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { runSubscriptionSweep } from './subscriptions';
import { runFeesSweep } from './fees';

const LOCK_KEY = 815_204; // nambari yoyote ya kipekee

async function jobTableExists() {
  const r = await pool.query<{ ok: boolean }>("select to_regclass('public.job_runs') is not null as ok");
  return r.rows[0].ok;
}

/**
 * Endesha kazi moja. HAIRUSHI kosa nje (kosa la kazi ya nyuma lisiue server) — kila kosa linaandikwa kwenye logs
 * na, kama inawezekana, kwenye job_runs.
 */
export async function runJob(name: string, fn: () => Promise<unknown>) {
  try {
    if (!(await jobTableExists())) {
      console.error(`❌ Kazi ${name} haikuendeshwa: meza "job_runs" haipo. Endesha migrations (npm run release).`);
      return;
    }
    await runJobInner(name, fn);
  } catch (e) {
    console.error(`❌ Kazi ${name} imeshindwa:`, (e as Error).message);
  }
}

async function runJobInner(name: string, fn: () => Promise<unknown>) {
  const client = await pool.connect();
  try {
    const got = await client.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
    if (!got.rows[0].ok) {
      await db.insert(schema.jobRuns).values({ name, status: 'SKIPPED', details: { reason: 'inaendeshwa na replica nyingine' }, finishedAt: new Date() });
      return;
    }
    const [run] = await db.insert(schema.jobRuns).values({ name, status: 'RUNNING' }).returning();
    try {
      const details = await fn();
      await db.update(schema.jobRuns).set({ status: 'SUCCESS', details: details as object, finishedAt: new Date() }).where(eq(schema.jobRuns.id, run.id));
    } catch (e) {
      console.error(`❌ Kazi ${name} imeshindwa:`, (e as Error).message);
      await db.update(schema.jobRuns).set({ status: 'FAILED', details: { error: (e as Error).message }, finishedAt: new Date() }).where(eq(schema.jobRuns.id, run.id));
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export const JOBS = {
  subscriptions: () => runJob('subscriptions.sweep', () => runSubscriptionSweep()),
  fees: () => runJob('fees.sweep', () => runFeesSweep()),
};

export function startJobs() {
  if (process.env.DISABLE_JOBS === 'true') return;
  const first = Number(process.env.JOBS_FIRST_RUN_MS ?? 20_000);
  setTimeout(() => { void JOBS.subscriptions().then(() => JOBS.fees()); }, first).unref();
  setInterval(() => { void JOBS.subscriptions().then(() => JOBS.fees()); }, 60 * 60 * 1000).unref();
}

export const latestJobRuns = () =>
  db.execute<{ name: string; status: string; started_at: string; finished_at: string | null; details: unknown }>(sql`
    select distinct on (name) name, status, started_at, finished_at, details
    from job_runs order by name, started_at desc`);
