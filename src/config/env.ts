import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL inahitajika'),
  DIRECT_URL: z.string().optional(),
  DB_SSL: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET iwe na herufi 32 au zaidi'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGINS: z.string().default('*'), // mf. https://cooplink.co.tz,http://localhost:5173
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Mipangilio ya .env si sahihi:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
