import { env } from './config/env';
import { createApp } from './app';
import { pool } from './db';
import { ensureSuperAdmin } from './lib/super-admin';
import { startJobs } from './lib/jobs';
import { describeDb, runMigrations } from './db/migrator';
import { verifySchema } from './db/verify-schema';
import { setStartupState } from './lib/startup';

// Kosa lisilotarajiwa la kazi ya nyuma lisiue server nzima — lionekane kwenye logs.
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason instanceof Error ? reason.stack ?? reason.message : reason);
});

async function start() {
  // 1. DATABASE + MIGRATIONS — lazima vikamilike KABLA ya kitu kingine chochote.
  //    Database ni ile ile app inayotumia (DATABASE_URL). Ikishindwa: tunaeleza na kusimama (si kuwaka nusu).
  console.log(`🗄️  Database: ${describeDb(env.DATABASE_URL)}`);
  try {
    await pool.query('select 1');
    const r = await runMigrations(pool);
    console.log(`✅ Migrations: ${r.applied.length} mpya, ${r.recorded.length} zimerekodiwa, ${r.alreadyDone} zilikuwepo (jumla ${r.total})`);
    const check = await verifySchema(pool);
    setStartupState({ migrations: r, schema: check });
    if (!check.ok) {
      throw new Error(`Schema haiendani na code. Meza zinazokosekana: ${check.missingTables.join(', ') || 'hakuna'}; columns: ${check.missingColumns.join(', ') || 'hakuna'}`);
    }
    console.log(`✅ Schema imehakikiwa: meza ${check.tables}, columns zote zipo`);
  } catch (e) {
    console.error('❌ DATABASE HAIKO TAYARI — server haitawaka:', (e as Error).message);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }

  // 2. SUPER_ADMIN kutoka Railway Variables (SEED_ADMIN_*). Haiundi wa pili; nenosiri halibadilishwi
  //    bila SEED_ADMIN_RESET_PASSWORD=true. Ikishindwa, server bado inawaka (kosa linaonekana kwenye logs na /health).
  if (process.env.SEED_ADMIN_PHONE) {
    try {
      await ensureSuperAdmin();
    } catch (e) {
      console.error('⚠️  SUPER_ADMIN hajawekwa sawa:', (e as Error).message);
    }
  }

  // 3. HTTP
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`🌱 CoopLink inafanya kazi: http://localhost:${env.PORT}  (${env.NODE_ENV})`);
  });

  // 4. Kazi za nyuma — BAADA ya migrations na schema kuthibitishwa
  startJobs();

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
