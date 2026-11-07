import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';
import * as schema from './schema';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
export { schema };
