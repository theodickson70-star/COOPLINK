import { env } from './config/env';
import { createApp } from './app';
import { pool } from './db';
import { ensureSuperAdmin } from './lib/super-admin';
import { startJobs } from './lib/jobs';

async function start() {
  // SUPER_ADMIN kutoka Railway Variables (SEED_ADMIN_*) — kila server inapowaka.
  // Ni salama kurudia: haiundi wa pili, haibadilishi kitu kikiwa tayari sawa.
  // Ikishindwa, server bado inawaka (kosa linaonekana kwenye logs na /health).
  if (process.env.SEED_ADMIN_PHONE) {
    try {
      await ensureSuperAdmin();
    } catch (e) {
      console.error('⚠️  SUPER_ADMIN hajawekwa sawa:', (e as Error).message);
    }
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`🌱 CoopLink inafanya kazi: http://localhost:${env.PORT}  (${env.NODE_ENV})`);
  });
  startJobs(); // subscriptions: hali + kusitisha/kuwasha vyama (kila saa)

  // Kuzima kwa utaratibu (Railway hutuma SIGTERM wakati wa deploy)
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      console.log(`${sig} — inazima...`);
      server.close(() => pool.end().then(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

void start();
