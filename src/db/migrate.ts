// Inaendesha migrations zote ambazo bado hazijaendeshwa, kisha inahakiki schema.
// Tumia: npm run db:migrate  (au db:migrate:prod baada ya build). Server pia inaziendesha yenyewe ikiwaka.
// Database ni ile ile app inayotumia (DATABASE_URL) — ili migrations zisiende database nyingine.
import { pool } from './index';
import { env } from '../config/env';
import { describeDb, runMigrations } from './migrator';
import { verifySchema } from './verify-schema';

async function main() {
  console.log(`⏳ Migrations kwenye database: ${describeDb(env.DATABASE_URL)}`);
  if (env.DIRECT_URL && describeDb(env.DIRECT_URL) !== describeDb(env.DATABASE_URL)) {
    console.warn(`⚠️  DIRECT_URL (${describeDb(env.DIRECT_URL)}) ni tofauti na DATABASE_URL. Migrations zinaendeshwa kwenye DATABASE_URL (database ya app).`);
  }
  const r = await runMigrations(pool);
  console.log(`✅ Migrations: ${r.applied.length} zimeendeshwa, ${r.recorded.length} zimerekodiwa, ${r.alreadyDone} zilikuwepo (jumla ${r.total})`);
  const check = await verifySchema(pool);
  if (!check.ok) {
    throw new Error(`Schema haiendani na code. Meza zinazokosekana: ${check.missingTables.join(', ') || 'hakuna'}; columns: ${check.missingColumns.join(', ') || 'hakuna'}`);
  }
  console.log(`✅ Schema imehakikiwa: meza ${check.tables} na columns zote zipo`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('❌ Migration imeshindwa:', (err as Error).message);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
