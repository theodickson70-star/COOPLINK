// SYSTEM CONTROL CENTER — hali ya mfumo. Hakuna siri (passwords, URLs za DB, API keys) inayorudishwa.
import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { count, desc, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, paged, paginationQuery } from '../../lib/http';
import { requirePermission, requireReauth } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { getSetting, setSetting } from '../../lib/settings';
import { emailConfigured, smsConfigured } from '../../lib/notify';
import { smsProvider } from '../../lib/sms';
import { JOB_CATALOG, JOBS, latestJobRuns } from '../../lib/jobs';
import { anyProvider, clearFeeLock as clearFeeLockCache } from '../../lib/fees';
import { teepayConfig, getCollection, TeePayError } from '../../lib/teepay';
import { ablinerConfig, findDeposit } from '../../lib/abliner';
import { lookupEnabled } from '../../lib/name-lookup';
import { sendSms } from '../../lib/notify';
import { badRequest, notFound } from '../../lib/errors';
import { and, eq, isNull } from 'drizzle-orm';

export const systemRouter = Router();
const STARTED_AT = new Date();
const ROOT = path.resolve(__dirname, '..', '..', '..');

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}

export async function migrationStatus() {
  const journal = readJson<{ entries: { tag: string }[] }>(path.join(ROOT, 'drizzle', 'meta', '_journal.json'));
  let applied = 0;
  try {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    applied = r.rows[0].n;
  } catch { applied = 0; }
  const total = journal?.entries.length ?? 0;
  return { applied, total, latest: journal?.entries.at(-1)?.tag ?? null, upToDate: applied >= total && total > 0 };
}

systemRouter.get(
  '/health',
  requirePermission('system.read'),
  ah(async (_req, res) => {
    const t0 = Date.now();
    let dbOk = true;
    try { await db.execute(sql`select 1`); } catch { dbOk = false; }
    const dbMs = Date.now() - t0;
    const pkg = readJson<{ version: string }>(path.join(ROOT, 'package.json'));
    const size = dbOk ? (await db.execute<{ bytes: string; pretty: string }>(sql`select pg_database_size(current_database())::text as bytes, pg_size_pretty(pg_database_size(current_database())) as pretty`)).rows[0] : null;
    const [errs] = (await db.execute<{ h24: number; d7: number }>(sql`
      select count(*) filter (where created_at > now() - interval '24 hours')::int as h24,
             count(*) filter (where created_at > now() - interval '7 days')::int as d7 from system_errors`)).rows;
    const env = process.env;
    const mem = process.memoryUsage();
    res.json({
      backend: { status: 'ok', version: pkg?.version ?? 'unknown', node: process.version, uptimeSec: Math.round(process.uptime()), startedAt: STARTED_AT, memoryMb: Math.round(mem.rss / 1048576) },
      frontend: { built: fs.existsSync(path.join(ROOT, 'admin', 'dist', 'index.html')) },
      api: { status: 'ok' },
      database: { status: dbOk ? 'ok' : 'down', latencyMs: dbMs, size },
      migrations: await migrationStatus(),
      deployment: {
        platform: env.RAILWAY_ENVIRONMENT_NAME ? 'Railway' : 'local',
        environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.NODE_ENV ?? null,
        service: env.RAILWAY_SERVICE_NAME ?? null,
        deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? null,
        commit: env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        branch: env.RAILWAY_GIT_BRANCH ?? null,
        replica: env.RAILWAY_REPLICA_ID ?? null,
      },
      jobs: (await latestJobRuns()).rows,
      errors: errs,
      integrations: {
        sms: smsConfigured() ? 'configured' : 'not_configured',
        email: emailConfigured() ? 'configured' : 'not_configured',
        payments: anyProvider() ? 'configured' : 'not_configured',
      },
      maintenance: await getSetting('maintenance', { fresh: true }),
      banner: await getSetting('banner', { fresh: true }),
    });
  }),
);

systemRouter.get(
  '/errors',
  requirePermission('system.read'),
  ah(async (req, res) => {
    const q = paginationQuery.parse(req.query);
    const rows = await db.select().from(schema.systemErrors).orderBy(desc(schema.systemErrors.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: count() }).from(schema.systemErrors);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

systemRouter.get(
  '/settings',
  requirePermission('system.read'),
  ah(async (_req, res) => {
    res.json({ config: await getSetting('config', { fresh: true }), maintenance: await getSetting('maintenance', { fresh: true }), banner: await getSetting('banner', { fresh: true }) });
  }),
);

systemRouter.put(
  '/settings/config',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({
      defaultTrialDays: z.number().int().min(0).max(365),
      defaultGraceDays: z.number().int().min(0).max(90),
      expiringWindowDays: z.number().int().min(1).max(90),
      enforceSubscriptions: z.boolean(),
      currency: z.enum(['TZS', 'USD']),
    }).parse(req.body);
    const before = await getSetting('config', { fresh: true });
    await db.transaction(async (tx) => {
      await setSetting(tx, 'config', b, req.auth!.userId);
      await audit(tx, req, { action: 'SETTINGS_CONFIG_UPDATE', entity: 'PlatformSetting', entityId: 'config', before, after: b });
    });
    res.json({ config: b });
  }),
);

systemRouter.put(
  '/maintenance',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({ enabled: z.boolean(), message: z.string().trim().min(5).max(300) }).passthrough().parse(req.body);
    await requireReauth(req);
    const value = { enabled: b.enabled, message: b.message };
    await db.transaction(async (tx) => {
      await setSetting(tx, 'maintenance', value, req.auth!.userId);
      await audit(tx, req, { action: value.enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', entity: 'PlatformSetting', entityId: 'maintenance', after: value });
    });
    res.json({ maintenance: value });
  }),
);

systemRouter.put(
  '/banner',
  requirePermission('system.manage'),
  ah(async (req, res) => {
    const b = z.object({ enabled: z.boolean(), message: z.string().trim().max(300), tone: z.enum(['info', 'warn']) }).parse(req.body);
    await db.transaction(async (tx) => {
      await setSetting(tx, 'banner', b, req.auth!.userId);
      await audit(tx, req, { action: 'BANNER_UPDATE', entity: 'PlatformSetting', entityId: 'banner', after: b });
    });
    res.json({ banner: b });
  }),
);

systemRouter.post(
  '/jobs/subscriptions/run',
  requirePermission('system.manage', 'subscriptions.manage'),
  ah(async (req, res) => {
    await JOBS.subscriptions();
    await audit(db, req, { action: 'JOB_RUN', entity: 'Job', entityId: 'subscriptions.sweep' });
    res.json({ jobs: (await latestJobRuns()).rows });
  }),
);


// =====================================================================
//  TAHADHARI (alerts)
// =====================================================================
const AL = schema.systemAlerts;
systemRouter.get('/alerts/summary', requirePermission('system.read'), ah(async (_req, res) => {
  const [r] = (await db.execute<{ open: number; critical: number }>(sql`
    select count(*)::int as open, count(*) filter (where severity = 'CRITICAL')::int as critical
    from system_alerts where resolved_at is null and ack_at is null`)).rows;
  res.json(r);
}));

systemRouter.get('/alerts', requirePermission('system.read'), ah(async (req, res) => {
  const { state } = z.object({ state: z.enum(['open', 'all']).default('open') }).parse(req.query);
  const rows = await db.select().from(AL).where(state === 'open' ? isNull(AL.resolvedAt) : undefined)
    .orderBy(sql`case when ${AL.resolvedAt} is null then 0 else 1 end`, sql`case when ${AL.severity} = 'CRITICAL' then 0 else 1 end`, desc(AL.lastAt)).limit(100);
  res.json({ data: rows });
}));

/** "Nimeona": inaondoa alama kwenye menyu. Tahadhari ya DOWNTIME (tukio lililopita) inafungwa pia. */
systemRouter.post('/alerts/:id/ack', requirePermission('system.manage'), ah(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [a] = await db.select().from(AL).where(eq(AL.id, id));
  if (!a) throw notFound('Tahadhari');
  const [u] = await db.update(AL).set({ ackAt: new Date(), ackById: req.auth!.userId, ...(a.kind === 'DOWNTIME' ? { resolvedAt: new Date() } : {}) }).where(eq(AL.id, id)).returning();
  await audit(db, req, { action: 'SYSTEM_ALERT_ACK', entity: 'SystemAlert', entityId: id, after: { key: a.key } });
  res.json({ alert: u });
}));

// =====================================================================
//  UPTIME (siku 30/90)
// =====================================================================
const DAY = 86_400_000, B = 5 * 60_000, DAR = 3 * 3_600_000;
systemRouter.get('/uptime', requirePermission('system.read'), ah(async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).default(30) }).parse(req.query);
  const [first] = await db.select({ b: schema.systemUptime.bucket }).from(schema.systemUptime).orderBy(schema.systemUptime.bucket).limit(1);
  const rows = (await db.execute<{ d: string; n: number; ms: number | null }>(sql`
    select to_char(bucket at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM-DD') as d, count(*)::int as n, round(avg(db_ms))::int as ms
    from system_uptime where bucket > now() - make_interval(days => ${days + 1}) group by 1`)).rows;
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const now = Date.now();
  const todayStart = Math.floor((now + DAR) / DAY) * DAY - DAR;
  let okAll = 0, expAll = 0;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart - i * DAY;
    const key = new Date(start + DAR).toISOString().slice(0, 10);
    const from = Math.max(start, first ? first.b.getTime() : Infinity);
    const to = Math.min(start + DAY, now);
    const expected = to > from ? Math.max(1, Math.ceil((to - from) / B)) : 0;
    const r = byDay.get(key);
    const ok = Math.min(r?.n ?? 0, expected);
    okAll += ok; expAll += expected;
    out.push({ date: key, expected, ok, pct: expected ? Math.round((ok / expected) * 10000) / 100 : null, avgDbMs: r?.ms ?? null });
  }
  const incidents = (await db.execute<{ from: string; to: string; minutes: number }>(sql`
    select prev as "from", bucket as "to", round(extract(epoch from bucket - prev) / 60)::int as minutes from (
      select bucket, lag(bucket) over (order by bucket) as prev from system_uptime where bucket > now() - make_interval(days => ${days})
    ) x where prev is not null and bucket - prev > interval '10 minutes' order by bucket desc limit 50`)).rows;
  const [last] = await db.select().from(schema.systemUptime).orderBy(desc(schema.systemUptime.bucket)).limit(1);
  const [{ ms24 }] = (await db.execute<{ ms24: number | null }>(sql`select round(avg(db_ms))::int as ms24 from system_uptime where bucket > now() - interval '24 hours'`)).rows;
  res.json({ days: out, pct: expAll ? Math.round((okAll / expAll) * 10000) / 100 : null, incidents, lastCheck: last ?? null, avgDbMs24h: ms24, since: first?.b ?? null });
}));

// =====================================================================
//  INTEGRATIONS (bila kuonyesha siri)
// =====================================================================
systemRouter.get('/integrations', requirePermission('system.read'), ah(async (_req, res) => {
  const [fees, sw, tests] = await Promise.all([getSetting('fees'), getSetting('switches', { fresh: true }), getSetting('integrations.tests', { fresh: true })]);
  const pay = (await db.execute<{ provider: string; last_ok: string | null; ok24: number; failed24: number; pending: number }>(sql`
    select provider, max(paid_at) filter (where status = 'SUCCEEDED') as last_ok,
      count(*) filter (where status = 'SUCCEEDED' and paid_at > now() - interval '24 hours')::int as ok24,
      count(*) filter (where status = 'FAILED' and created_at > now() - interval '24 hours')::int as failed24,
      count(*) filter (where status in ('SENDING', 'PENDING') and abandoned_at is null and created_at > now() - interval '3 days')::int as pending
    from platform_mobile_payments group by provider`)).rows;
  const hooks = (await db.execute<{ p: string; last: string | null; n24: number }>(sql`
    select case when id like 'abliner:%' then 'ABLINER' else 'TEEPAY' end as p, max(received_at) as last,
      count(*) filter (where received_at > now() - interval '24 hours')::int as n24 from teepay_events group by 1`)).rows;
  const [sms] = (await db.execute<{ last_ok: string | null; ok24: number; failed24: number }>(sql`
    select max(updated_at) filter (where status = 'SENT') as last_ok,
      count(*) filter (where status = 'SENT' and created_at > now() - interval '24 hours')::int as ok24,
      count(*) filter (where status = 'FAILED' and created_at > now() - interval '24 hours')::int as failed24
    from announcement_deliveries where channel = 'SMS'`)).rows;
  const [lk] = (await db.execute<{ n24: number; found24: number; last: string | null }>(sql`
    select count(*) filter (where checked_at > now() - interval '24 hours')::int as n24,
      count(*) filter (where checked_at > now() - interval '24 hours' and status = 'FOUND')::int as found24, max(checked_at) as last
    from phone_name_lookups`).catch(() => ({ rows: [{ n24: 0, found24: 0, last: null }] }))).rows;
  const P = (prov: string) => pay.find((x) => x.provider === prov);
  const H = (prov: string) => hooks.find((x) => x.p === prov);
  const tp = teepayConfig(), ab = ablinerConfig();
  res.json({ data: [
    { key: 'teepay', name: 'TeePay', role: fees.primaryProvider === 'TEEPAY' ? 'Malipo ya ada — njia ya kwanza' : 'Malipo ya ada — njia ya pili',
      configured: tp.enabled, parts: { 'API key': !!tp.apiKey, 'Webhook secret': !!tp.webhookSecret }, switchOn: sw.mobilePayments,
      stats: { lastOk: P('TEEPAY')?.last_ok ?? null, ok24: P('TEEPAY')?.ok24 ?? 0, failed24: P('TEEPAY')?.failed24 ?? 0, pending: P('TEEPAY')?.pending ?? 0, lastWebhook: H('TEEPAY')?.last ?? null, webhooks24: H('TEEPAY')?.n24 ?? 0 },
      test: tests.teepay ?? null, testable: tp.enabled },
    { key: 'abliner', name: 'Abliner', role: fees.primaryProvider === 'ABLINER' ? 'Malipo ya ada — njia ya kwanza' : 'Malipo ya ada — njia ya pili',
      configured: ab.enabled, parts: { 'API key': !!ab.apiKey, 'Webhook secret': !!ab.webhookSecret }, switchOn: sw.mobilePayments,
      stats: { lastOk: P('ABLINER')?.last_ok ?? null, ok24: P('ABLINER')?.ok24 ?? 0, failed24: P('ABLINER')?.failed24 ?? 0, pending: P('ABLINER')?.pending ?? 0, lastWebhook: H('ABLINER')?.last ?? null, webhooks24: H('ABLINER')?.n24 ?? 0 },
      test: tests.abliner ?? null, testable: !!ab.apiKey },
    { key: 'lookup', name: 'Jina la mwenye namba (Abliner)', role: 'Kuthibitisha jina la mwenye namba ya simu kwenye fomu',
      configured: lookupEnabled(), parts: { 'API key': lookupEnabled() }, switchOn: sw.nameLookup,
      stats: { checks24: lk?.n24 ?? 0, found24: lk?.found24 ?? 0, lastCheck: lk?.last ?? null }, test: tests.lookup ?? null, testable: false },
    { key: 'sms', name: `SMS (${smsProvider() === 'RODSMS' ? 'RodSMS' : smsProvider() === 'AT' ? "Africa's Talking" : 'haijawekwa'})`, role: 'OTP, taarifa kwa wakulima na vikundi, matangazo, tahadhari (SMS Center)',
      configured: smsConfigured(), parts: process.env.RODSMS_API_KEY || !process.env.AT_USERNAME
        ? { 'RODSMS_API_KEY': !!process.env.RODSMS_API_KEY, 'RODSMS_SENDER_ID': !!process.env.RODSMS_SENDER_ID }
        : { 'AT_USERNAME': !!process.env.AT_USERNAME, 'AT_API_KEY': !!process.env.AT_API_KEY, 'Sender ID': !!process.env.AT_SENDER_ID }, switchOn: sw.sms,
      stats: { lastOk: sms?.last_ok ?? null, ok24: sms?.ok24 ?? 0, failed24: sms?.failed24 ?? 0 }, test: tests.sms ?? null, testable: smsConfigured() },
    { key: 'email', name: 'Email', role: 'Bado haijaunganishwa', configured: emailConfigured(), parts: {}, switchOn: true, stats: {}, test: null, testable: false },
  ] });
}));

/** Jaribu muunganiko bila kukata pesa: TeePay/Abliner — ombi la kusoma tu; SMS — ujumbe mmoja kwa namba ya anayejaribu. */
systemRouter.post('/integrations/:key/test', requirePermission('system.manage'), ah(async (req, res) => {
  const { key } = z.object({ key: z.enum(['teepay', 'abliner', 'sms']) }).parse(req.params);
  const t0 = Date.now();
  let ok = false, message = '';
  try {
    if (key === 'teepay') {
      if (!teepayConfig().enabled) throw badRequest('TeePay haijawekwa (TEEPAY_API_KEY)');
      try { await getCollection(`cooplink-healthcheck-${Date.now()}`); ok = true; message = 'TeePay inajibu'; } catch (e) {
        if (e instanceof TeePayError && e.status === 404) { ok = true; message = 'TeePay inajibu na API key imekubaliwa'; }
        else if (e instanceof TeePayError && [401, 403].includes(e.status)) message = 'API key imekataliwa na TeePay';
        else message = (e as Error).message;
      }
    } else if (key === 'abliner') {
      if (!ablinerConfig().apiKey) throw badRequest('Abliner haijawekwa (ABLINER_API_KEY)');
      try { await findDeposit(`cooplink-healthcheck-${Date.now()}`); ok = true; message = 'Abliner inajibu na API key imekubaliwa'; } catch (e) {
        const st = (e as { status?: number }).status;
        message = st && [401, 403].includes(st) ? 'API key imekataliwa na Abliner' : (e as Error).message;
      }
    } else {
      if (!smsConfigured()) throw badRequest('SMS haijawekwa (RODSMS_API_KEY + RODSMS_SENDER_ID, au AT_USERNAME / AT_API_KEY)');
      const me = await db.query.users.findFirst({ where: eq(schema.users.id, req.auth!.userId), columns: { phone: true, id: true } });
      const r = await sendSms(me!.phone, 'CoopLink: SMS ya majaribio kutoka System Control Center.', 'SYSTEM_ALERT', { force: true, userId: me!.id });
      ok = r.status === 'SENT'; message = ok ? 'SMS imetumwa kwenye namba yako' : r.error ?? r.status;
    }
  } catch (e) {
    if ((e as { status?: number }).status === 400) throw e;
    message = (e as Error).message;
  }
  const result = { ok, message: message.slice(0, 300), at: new Date().toISOString(), ms: Date.now() - t0 };
  const tests = await getSetting('integrations.tests', { fresh: true });
  await db.transaction(async (tx) => {
    await setSetting(tx, 'integrations.tests', { ...tests, [key]: result }, req.auth!.userId);
    await audit(tx, req, { action: 'INTEGRATION_TEST', entity: 'Integration', entityId: key, after: { ok, message: result.message } });
  });
  res.json({ result });
}));

// =====================================================================
//  KAZI ZA NYUMA (zote)
// =====================================================================
systemRouter.get('/jobs', requirePermission('system.read'), ah(async (_req, res) => {
  const stats = (await db.execute<{ name: string; last_ok: string | null; failed24: number; runs24: number; avg_ms: number | null }>(sql`
    select name, max(started_at) filter (where status = 'SUCCESS') as last_ok,
      count(*) filter (where status = 'FAILED' and started_at > now() - interval '24 hours')::int as failed24,
      count(*) filter (where status in ('SUCCESS', 'FAILED') and started_at > now() - interval '24 hours')::int as runs24,
      round(avg(extract(epoch from finished_at - started_at) * 1000) filter (where status = 'SUCCESS' and started_at > now() - interval '7 days'))::int as avg_ms
    from job_runs group by name`)).rows;
  const last = (await latestJobRuns()).rows;
  const [mon] = (await db.execute<{ last: string | null; n24: number; ms: number | null }>(sql`
    select max(checked_at) as last, count(*) filter (where bucket > now() - interval '24 hours')::int as n24, round(avg(db_ms) filter (where bucket > now() - interval '24 hours'))::int as ms from system_uptime`)).rows;
  const enabled = process.env.DISABLE_JOBS !== 'true';
  res.json({ enabled, data: JOB_CATALOG.map((j) => {
    if (j.name === 'system.monitor') {
      const lastAt = mon?.last ?? null;
      return { name: j.name, label: j.label, desc: j.desc, everyMin: j.everyMin, lastRun: lastAt ? { status: 'SUCCESS', startedAt: lastAt, finishedAt: lastAt, details: { dbMs: mon?.ms ?? null } } : null,
        lastOk: lastAt, failed24: 0, runs24: mon?.n24 ?? 0, avgMs: mon?.ms ?? null, nextAt: lastAt ? new Date(new Date(lastAt).getTime() + j.everyMin * 60_000).toISOString() : null, history: false };
    }
    const l = last.find((x) => x.name === j.name);
    const st = stats.find((x) => x.name === j.name);
    return { name: j.name, label: j.label, desc: j.desc, everyMin: j.everyMin,
      lastRun: l ? { status: l.status, startedAt: l.started_at, finishedAt: l.finished_at, details: l.details } : null,
      lastOk: st?.last_ok ?? null, failed24: st?.failed24 ?? 0, runs24: st?.runs24 ?? 0, avgMs: st?.avg_ms ?? null,
      nextAt: l ? new Date(new Date(l.started_at).getTime() + j.everyMin * 60_000).toISOString() : null, history: true };
  }) });
}));

systemRouter.get('/jobs/:name/runs', requirePermission('system.read'), ah(async (req, res) => {
  const { name } = z.object({ name: z.string().max(60) }).parse(req.params);
  const rows = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, name)).orderBy(desc(schema.jobRuns.startedAt)).limit(20);
  res.json({ data: rows.map((r) => ({ ...r, ms: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null })) });
}));

systemRouter.post('/jobs/:name/run', requirePermission('system.manage'), ah(async (req, res) => {
  const { name } = z.object({ name: z.string().max(60) }).parse(req.params);
  const job = JOB_CATALOG.find((j) => j.name === name);
  if (!job) throw notFound('Kazi');
  const result = await job.run();
  await audit(db, req, { action: 'JOB_RUN', entity: 'Job', entityId: name });
  res.json({ ok: true, result: result ?? null });
}));

// =====================================================================
//  MAKOSA YALIYOUNGANISHWA (kosa moja = njia + ujumbe, bila namba/ID zinazobadilika)
// =====================================================================
const FP = sql`md5(coalesce(method, '') || ' ' || regexp_replace(regexp_replace(coalesce(path, ''), '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}', ':id', 'g'), '[0-9]+', ':n', 'g') || ' ' || regexp_replace(coalesce(message, ''), '[0-9]+', 'N', 'g'))`;
const RANGE = z.coerce.number().int().refine((d) => [1, 7, 30].includes(d)).default(7);

systemRouter.get('/errors/groups', requirePermission('system.read'), ah(async (req, res) => {
  const q = z.object({ days: RANGE, state: z.enum(['open', 'resolved', 'all']).default('open') }).parse(req.query);
  const rows = (await db.execute<{ fp: string; method: string; path: string; message: string; n: number; users: number; first_at: string; last_at: string; open: number }>(sql`
    select ${FP} as fp, (array_agg(method order by created_at desc))[1] as method, (array_agg(path order by created_at desc))[1] as path,
      (array_agg(message order by created_at desc))[1] as message, count(*)::int as n, count(distinct user_id)::int as users,
      min(created_at) as first_at, max(created_at) as last_at, count(*) filter (where resolved_at is null)::int as open
    from system_errors where created_at > now() - make_interval(days => ${q.days})
    group by 1
    having ${q.state === 'open' ? sql`count(*) filter (where resolved_at is null) > 0` : q.state === 'resolved' ? sql`count(*) filter (where resolved_at is null) = 0` : sql`true`}
    order by max(created_at) desc limit 100`)).rows;
  const [tot] = (await db.execute<{ n: number; groups: number }>(sql`
    select count(*)::int as n, count(distinct ${FP})::int as groups from system_errors where created_at > now() - make_interval(days => ${q.days}) and resolved_at is null`)).rows;
  // Makosa kwa saa (saa 24) kwa grafu ndogo
  const hourly = (await db.execute<{ h: string; n: number }>(sql`
    select to_char(date_trunc('hour', created_at at time zone 'Africa/Dar_es_Salaam'), 'HH24') as h, count(*)::int as n
    from system_errors where created_at > now() - interval '24 hours' group by date_trunc('hour', created_at at time zone 'Africa/Dar_es_Salaam') order by 1`)).rows;
  res.json({ data: rows, totals: tot, hourly });
}));

systemRouter.get('/errors/groups/:fp', requirePermission('system.read'), ah(async (req, res) => {
  const { fp } = z.object({ fp: z.string().regex(/^[0-9a-f]{32}$/) }).parse(req.params);
  const rows = await db.select({ id: schema.systemErrors.id, method: schema.systemErrors.method, path: schema.systemErrors.path, status: schema.systemErrors.status,
    message: schema.systemErrors.message, stack: schema.systemErrors.stack, createdAt: schema.systemErrors.createdAt, resolvedAt: schema.systemErrors.resolvedAt,
    user: schema.users.fullName, role: schema.users.role })
    .from(schema.systemErrors).leftJoin(schema.users, eq(schema.users.id, schema.systemErrors.userId))
    .where(sql`${FP} = ${fp}`).orderBy(desc(schema.systemErrors.createdAt)).limit(50);
  if (!rows.length) throw notFound('Kosa');
  res.json({ data: rows });
}));

systemRouter.post('/errors/groups/:fp/resolve', requirePermission('system.manage'), ah(async (req, res) => {
  const { fp } = z.object({ fp: z.string().regex(/^[0-9a-f]{32}$/) }).parse(req.params);
  const r = await db.update(schema.systemErrors).set({ resolvedAt: new Date(), resolvedById: req.auth!.userId })
    .where(and(isNull(schema.systemErrors.resolvedAt), sql`${FP} = ${fp}`)).returning({ id: schema.systemErrors.id });
  await audit(db, req, { action: 'SYSTEM_ERROR_RESOLVE', entity: 'SystemError', entityId: fp, after: { rows: r.length } });
  res.json({ resolved: r.length });
}));

// =====================================================================
//  SWICHI ZA DHARURA (kill switches)
// =====================================================================
const SWITCH_KEYS = ['mobilePayments', 'sms', 'farmerPortal', 'nameLookup'] as const;
systemRouter.get('/switches', requirePermission('system.read'), ah(async (_req, res) => {
  const sw = await getSetting('switches', { fresh: true });
  const changes = (await db.execute<{ entity_id: string; action: string; created_at: string; full_name: string | null; after: { reason?: string } | null }>(sql`
    select distinct on (a.entity_id) a.entity_id, a.action, a.created_at, u.full_name, a.after
    from audit_logs a left join users u on u.id = a.user_id
    where a.action in ('SWITCH_ON', 'SWITCH_OFF') order by a.entity_id, a.created_at desc`)).rows;
  res.json({ switches: sw, changes: Object.fromEntries(changes.map((c) => [c.entity_id, { action: c.action, at: c.created_at, by: c.full_name, reason: c.after?.reason ?? null }])) });
}));

systemRouter.put('/switches', requirePermission('system.manage'), ah(async (req, res) => {
  const b = z.object({ key: z.enum(SWITCH_KEYS), enabled: z.boolean(), reason: z.string().trim().max(300).optional() }).passthrough().parse(req.body);
  if (!b.enabled && (b.reason ?? '').length < 5) throw badRequest('Andika sababu ya kuzima (angalau herufi 5)');
  await requireReauth(req);
  const before = await getSetting('switches', { fresh: true });
  const value = { ...before, [b.key]: b.enabled };
  await db.transaction(async (tx) => {
    await setSetting(tx, 'switches', value, req.auth!.userId);
    await audit(tx, req, { action: b.enabled ? 'SWITCH_ON' : 'SWITCH_OFF', entity: 'Switch', entityId: b.key, before: { [b.key]: before[b.key] }, after: { [b.key]: b.enabled, reason: b.reason ?? null } });
  });
  clearFeeLockCache();
  res.json({ switches: value });
}));
