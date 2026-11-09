import 'dotenv/config';
import { z } from 'zod';

const blankAsUndefined = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL inahitajika'),
  DIRECT_URL: z.string().optional(),
  DB_SSL: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET iwe na herufi 32 au zaidi'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGINS: z.string().default('*'), // mf. https://cooplink.co.tz,http://localhost:5173
  // TeePay (malipo ya ada za CoopLink kwa simu). Bila hizi, malipo ya ada hayajawashwa na hakuna chama kinachofungwa.
  TEEPAY_API_KEY: blankAsUndefined(z.string().regex(/^tp_(live|test)_/, 'TEEPAY_API_KEY ianze na tp_live_ au tp_test_').optional()),
  TEEPAY_WEBHOOK_SECRET: blankAsUndefined(z.string().startsWith('whsec_', 'TEEPAY_WEBHOOK_SECRET ianze na whsec_').optional()),
  TEEPAY_BASE_URL: z.string().url().default('https://api.teepay.me'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Mipangilio ya .env si sahihi:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
