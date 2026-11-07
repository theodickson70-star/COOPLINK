import { env } from './config/env';
import { createApp } from './app';
import { pool } from './db';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`🌱 CoopLink inafanya kazi: http://localhost:${env.PORT}  (${env.NODE_ENV})`);
});

// Kuzima kwa utaratibu (Railway hutuma SIGTERM wakati wa deploy)
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig} — inazima...`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
