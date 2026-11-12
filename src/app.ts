import fs from 'fs';
import { smsRouter } from './modules/sms.routes';
import { scheduleFlush } from './lib/sms';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import morgan from 'morgan';
import { sql } from 'drizzle-orm';
import { env } from './config/env';
import { db } from './db';
import { authenticate, blockPlatformStaff, maintenanceGuard } from './middleware/auth';
import { ownerRouter } from './modules/owner';
import { publicRouter, announcementsRouter } from './modules/public.routes';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRouter } from './modules/auth.routes';
import { usersRouter } from './modules/users.routes';
import { unionsRouter, amcosRouter } from './modules/organizations.routes';
import { seasonsRouter, buyersRouter } from './modules/seasons.routes';
import { membersRouter } from './modules/members.routes';
import { estimatesRouter } from './modules/estimates.routes';
import { inputsRouter, inputIssuesRouter } from './modules/inputs.routes';
import { reportsRouter, auditRouter } from './modules/reports.routes';
import { approvalsRouter } from './modules/approvals.routes';
import { financeRouter } from './modules/finance.routes';
import { storeRouter } from './modules/store.routes';
import { workspaceRouter } from './modules/workspace.routes';
import { settingsRouter } from './modules/settings.routes';
import { accountingRouter } from './modules/accounting.routes';
import { bankRouter } from './modules/bank.routes';
import { salesRouter } from './modules/sales.routes';
import { payrollRouter } from './modules/payroll.routes';
import { assetsRouter } from './modules/assets.routes';
import { groupsRouter } from './modules/groups.routes';
import { kuniRouter } from './modules/kuni.routes';
import { billingRouter, feeGuard } from './modules/billing.routes';
import { lookupRouter } from './modules/lookup.routes';
import { supportRouter } from './modules/support.routes';
import { farmerRouter } from './modules/farmer.routes';
import { startupState } from './lib/startup';
import { superAdminStatus } from './lib/super-admin';

// Toleo la mfumo (kutoka package.json) — linaonekana kwenye /health
const VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

export function createApp() {
  const app = express();
  // Kinga ya jumla: hash ya PIN ya mkulima haitoki kwenye API yoyote, hata route ikirudisha safu nzima ya members.
  const HIDDEN_KEYS = new Set(['portalPinHash', 'portalTokenVersion']);
  // Idadi za stoo zina desimali 4 (mbolea ya vitalu kwa kilo: 0.0600 mfuko). Zisizohitaji desimali 4 zinaonyeshwa kwa 2 (20.0000 -> 20.00).
  const QTY_KEYS = new Set(['quantity', 'balance', 'received', 'issued', 'returned', 'adjusted', 'damaged', 'expired', 'countedQty', 'systemQty', 'difference']);
  app.set('json replacer', (k: string, v: unknown) => {
    if (HIDDEN_KEYS.has(k)) return undefined;
    if (typeof v === 'string' && QTY_KEYS.has(k) && /^-?\d+\.\d{2}00$/.test(v)) return v.slice(0, -2);
    return v;
  });
  app.set('trust proxy', 1); // Railway / Vercel / Nginx
  app.disable('x-powered-by');
  // img-src: blob: inahitajika kuonyesha picha za wakulima (zinapakuliwa kwa token) na kupunguza picha kwenye kifaa
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, imgSrc: ["'self'", 'data:', 'blob:'] } } }));
  // Kubana majibu (gzip/brotli): JS, CSS na JSON zinapungua ~70–80%, mfumo unafunguka haraka hasa kwa intaneti ya simu
  app.use(compression({ threshold: 1024 }));
  app.use(cors({ origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()) }));
  // rawBody inahitajika kuhakiki saini za webhook (TeePay)
  app.use(express.json({ limit: '3mb', verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  // SMS za taarifa ziko kwenye foleni ndani ya muamala; zinatumwa baada ya jibu (muamala umekamilika)
  app.use((req, res, next) => { if (req.method !== 'GET') res.on('finish', () => scheduleFlush(300)); next(); });

  app.get('/health', async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      const superAdmin = await superAdminStatus().catch(() => undefined);
      const st = startupState();
      const migrations = st.migrations ? { total: st.migrations.total, upToDate: true, appliedAtStartup: st.migrations.applied } : undefined;
      res.json({ status: 'ok', db: 'ok', version: VERSION, superAdmin, migrations, schema: st.schema ? (st.schema.ok ? 'ok' : 'mismatch') : undefined, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'error', db: 'down', version: VERSION });
    }
  });

  const api = express.Router();
  api.use('/public', publicRouter);
  api.use('/auth', authRouter);
  api.use('/farmer', farmerRouter);             // Portal ya mkulima — ina uthibitisho wake (token ya mkulima tu)

  // Kila kitu chini ya hapa kinahitaji kuingia
  api.use(authenticate);
  api.use(maintenanceGuard);
  api.use('/owner', ownerRouter);              // Owner Control Panel (wasimamizi wa jukwaa tu)
  api.use('/announcements', announcementsRouter);
  api.use('/lookup', lookupRouter);              // Jina la mwenye namba ya simu (Abliner) — kwa fomu zote
  api.use(blockPlatformStaff);                 // wafanyakazi wa jukwaa hawaingii data za vyama
  api.use('/billing', billingRouter);           // Ada ya CoopLink (Meneja) — inapatikana hata chama kikiwa kimefungwa
  api.use('/support', supportRouter);           // Tiketi za msaada — hata chama kikiwa kimefungwa
  api.use(feeGuard);                            // ada iliyopita tarehe bila kulipwa -> chama kimefungwa
  api.use('/users', usersRouter);
  api.use('/unions', unionsRouter);
  api.use('/amcos', amcosRouter);
  api.use('/seasons', seasonsRouter);
  api.use('/buyers', buyersRouter);
  api.use('/members', membersRouter);
  api.use('/sms', smsRouter);                   // matangazo ya chama kwa SMS, deni la kikundi kwa SMS
  api.use('/kuni', kuniRouter);                 // Pesa ya kuni (mikopo ya fedha kwa wakulima)
  api.use('/groups', groupsRouter);              // Vikundi vya wakulima (dhamana ya pamoja)
  api.use('/estimates', estimatesRouter);
  api.use('/inputs', inputsRouter);
  api.use('/input-issues', inputIssuesRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/approvals', approvalsRouter);       // Idhini za Meneja
  api.use('/finance', financeRouter);           // Fedha za chama (Mhasibu)
  api.use('/store', storeRouter);               // Stoo, manunuzi, wazabuni (Storekeeper)
  api.use('/accounting', accountingRouter);     // Daftari kuu na ripoti kuu (Mhasibu)
  api.use('/bank', bankRouter);                 // Uhamisho, usuluhishi wa benki, vocha
  api.use('/sales', salesRouter);               // Mauzo ya tumbaku na makato
  api.use('/payroll', payrollRouter);           // Mishahara
  api.use('/assets', assetsRouter);             // Mali za chama na uchakavu
  api.use('/workspace', workspaceRouter);       // Dashibodi za watumishi
  api.use('/settings', settingsRouter);         // Mipangilio ya chama (watumishi wote; ruhusa kwa kila sehemu)

  app.use('/api/v1', api);

  // ---------------- ADMIN WEB (React) ----------------
  // Baada ya `npm run build`, kurasa za admin ziko admin/dist na zinahudumiwa hapa hapa.
  // Kwa hiyo Railway inahitaji service MOJA tu: API + admin kwenye anwani moja.
  const adminDir = path.resolve(__dirname, '..', 'admin', 'dist');
  if (fs.existsSync(path.join(adminDir, 'index.html'))) {
    app.use('/assets', express.static(path.join(adminDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use('/assets', (_req, res) => res.status(404).end()); // faili la zamani lisirudishe index.html
    // redirect:false — /login isiende /login/ (kuna folda ya picha za login)
    app.use(express.static(adminDir, { index: false, maxAge: '7d', redirect: false }));
    // Kurasa kama /members/123 zinarudisha index.html (React Router inashughulikia)
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(adminDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
