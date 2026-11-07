// =====================================================================
//  UKAGUZI WA SUPER_ADMIN — kuendesha NDANI ya Railway (production)
//    npm run admin:check
//
//  Inasoma (haibadilishi chochote):
//    SEED_ADMIN_PHONE      namba ya kuingia, mf. 0712345678
//    ADMIN_CHECK_PASSWORD  (hiari) nenosiri la kujaribu; au SEED_ADMIN_PASSWORD ikiwa imewekwa
//
//  Inafuata njia ile ile ya POST /api/v1/auth/login:
//    phoneSchema (normalizePhone) -> akaunti -> isActive -> bcrypt -> JWT sign/verify
//  Haionyeshi nenosiri, hash wala token. Exit code 0 = sawa, 1 = kuna tatizo.
// =====================================================================
import { asc, eq } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { phoneSchema } from '../lib/http';
import { signToken, verifyPassword, verifyToken } from '../lib/security';

const mask = (p: string) => `${p.slice(0, 4)}****${p.slice(-4)}`;
let problems = 0;
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => { problems++; console.log(`  ❌ ${msg}`); };
const info = (msg: string) => console.log(`  ℹ️  ${msg}`);

async function main() {
  console.log('\n=== CoopLink: ukaguzi wa SUPER_ADMIN ===');
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').hostname; } catch { return '?'; } })();
  info(`Database host: ${host}`);

  // 1. Namba — kwa njia ile ile ya login
  const raw = process.env.SEED_ADMIN_PHONE?.trim();
  if (!raw) { bad('SEED_ADMIN_PHONE haijawekwa'); return; }
  const parsed = phoneSchema.safeParse(raw);
  if (!parsed.success) { bad('SEED_ADMIN_PHONE si namba sahihi'); return; }
  const phone = parsed.data;
  ok(`Namba inasomeka na login kama ${mask(phone)}`);

  // 2. SUPER_ADMIN wote
  const supers = await db
    .select({ id: schema.users.id, phone: schema.users.phone, isActive: schema.users.isActive, createdAt: schema.users.createdAt })
    .from(schema.users).where(eq(schema.users.role, 'SUPER_ADMIN')).orderBy(asc(schema.users.createdAt));
  info(`SUPER_ADMIN waliopo: ${supers.length} -> ${supers.map((s) => `${mask(s.phone)}${s.isActive ? '' : ' (amezimwa)'}`).join(', ') || 'hakuna'}`);
  if (supers.length > 1) info('Kuna zaidi ya mmoja. Wa ziada anaweza kuzimwa kwenye ukurasa wa Watumiaji.');

  // 3. Akaunti ya namba hii
  const user = await db.query.users.findFirst({ where: eq(schema.users.phone, phone) });
  if (!user) {
    bad(`Hakuna akaunti yenye namba ${mask(phone)}. Endesha: npm run db:seed:prod`);
    return;
  }
  user.role === 'SUPER_ADMIN' ? ok('Akaunti ipo na ni SUPER_ADMIN') : bad(`Akaunti ipo lakini role ni ${user.role}`);
  user.isActive ? ok('Akaunti iko hai (isActive = true)') : bad('Akaunti IMEZIMWA (isActive = false). Endesha db:seed:prod kuiwasha.');
  info(`Lazima abadilishe nenosiri akiingia: ${user.mustChangePassword ? 'ndiyo' : 'hapana'}`);
  info(`Aliingia mwisho: ${user.lastLoginAt ? user.lastLoginAt.toISOString() : 'hajawahi'}`);

  // 4. Nenosiri (bcrypt, sawa na login)
  const pw = process.env.ADMIN_CHECK_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  if (!pw) {
    info('Nenosiri halikujaribiwa (weka ADMIN_CHECK_PASSWORD kujaribu)');
  } else if (await verifyPassword(pw, user.passwordHash)) {
    ok('Nenosiri linalingana (bcrypt)');
  } else {
    bad('Nenosiri HALILINGANI na akaunti hii');
  }

  // 5. JWT (sawa na login + middleware)
  try {
    const token = signToken({ sub: user.id, tv: user.tokenVersion });
    const decoded = verifyToken(token);
    decoded.sub === user.id && decoded.tv === user.tokenVersion
      ? ok('JWT inatengenezwa na kuthibitishwa kwa JWT_SECRET ya production')
      : bad('JWT haikuthibitishwa ipasavyo');
  } catch (e) {
    bad(`JWT imeshindwa: ${(e as Error).message}`);
  }
}

main()
  .catch((e) => { problems++; console.error('  ❌ Hitilafu:', (e as Error).message); })
  .finally(async () => {
    console.log(problems === 0 ? '\nMATOKEO: SAWA ✅ — SUPER_ADMIN anaweza kuingia.\n' : `\nMATOKEO: matatizo ${problems} ❌\n`);
    await pool.end();
    process.exit(problems === 0 ? 0 : 1);
  });
