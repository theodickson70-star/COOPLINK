import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
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
import { accountingRouter } from './modules/accounting.routes';
import { bankRouter } from './modules/bank.routes';
import { salesRouter } from './modules/sales.routes';
import { payrollRouter } from './modules/payroll.routes';
import { assetsRouter } from './modules/assets.routes';
import { groupsRouter } from './modules/groups.routes';
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
  app.set('trust proxy', 1); // Railway / Vercel / Nginx
  app.disable('x-powered-by');
  // img-src: blob: inahitajika kuonyesha picha za wakulima (zinapakuliwa kwa token) na kupunguza picha kwenye kifaa
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, imgSrc: ["'self'", 'data:', 'blob:'] } } }));
  app.use(cors({ origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

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

  // Kila kitu chini ya hapa kinahitaji kuingia
  api.use(authenticate);
  api.use(maintenanceGuard);
  api.use('/owner', ownerRouter);              // Owner Control Panel (wasimamizi wa jukwaa tu)
  api.use('/announcements', announcementsRouter);
  api.use(blockPlatformStaff);                 // wafanyakazi wa jukwaa hawaingii data za vyama
  api.use('/users', usersRouter);
  api.use('/unions', unionsRouter);
  api.use('/amcos', amcosRouter);
  api.use('/seasons', seasonsRouter);
  api.use('/buyers', buyersRouter);
  api.use('/members', membersRouter);
  api.use('/groups', groupsRouter);              // Vikundi vya wakulima (dhamana ya pamoja)
  api.use('/estimates', estimatesRouter);
  api.use('/inputs', inputsRouter);
  api.use('/input-issues', inputIssuesRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit-logs', auditRouter);
  api.use('/approvals', approvalsRouter);       // Idhini za Meneja
  api.use('/finance', financeRouter);           // Fedha za chama (Mhasibu)
  api.use('/store', storeRouter);               // Stoo, manunuzi, wazabuni (Stokipa)
  api.use('/accounting', accountingRouter);     // Daftari kuu na ripoti kuu (Mhasibu)
  api.use('/bank', bankRouter);                 // Uhamisho, usuluhishi wa benki, vocha
  api.use('/sales', salesRouter);               // Mauzo ya tumbaku na makato
  api.use('/payroll', payrollRouter);           // Mishahara
  api.use('/assets', assetsRouter);             // Mali za chama na uchakavu
  api.use('/workspace', workspaceRouter);       // Dashibodi za watumishi

  app.use('/api/v1', api);

  // ---------------- ADMIN WEB (React) ----------------
  // Baada ya `npm run build`, kurasa za admin ziko admin/dist na zinahudumiwa hapa hapa.
  // Kwa hiyo Railway inahitaji service MOJA tu: API + admin kwenye anwani moja.
  const adminDir = path.resolve(__dirname, '..', 'admin', 'dist');
  if (fs.existsSync(path.join(adminDir, 'index.html'))) {
    app.use('/assets', express.static(path.join(adminDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use('/assets', (_req, res) => res.status(404).end()); // faili la zamani lisirudishe index.html
    // redirect:false — /login isiende /login/ (kuna folda ya picha za login)
    app.use(express.static(adminDir, { index: false, maxAge: '1h', redirect: false }));
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
