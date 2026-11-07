// Inaendesha migrations zote ambazo bado hazijaendeshwa.
// Tumia: npm run db:migrate  (au db:migrate:prod baada ya build)
import path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../config/env';

async function main() {
  const pool = new Pool({
    // DIRECT_URL (bila pooler) ni salama zaidi kwa migrations kwenye Supabase
    connectionString: env.DIRECT_URL || env.DATABASE_URL,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const db = drizzle(pool);
  const folder = path.resolve(__dirname, '../../drizzle');
  console.log('⏳ Inaendesha migrations kutoka', folder);
  await migrate(db, { migrationsFolder: folder });
  console.log('✅ Migrations zimekamilika');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Migration imeshindwa:', err);
  process.exit(1);
});
