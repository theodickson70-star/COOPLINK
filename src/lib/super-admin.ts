// =====================================================================
//  SUPER_ADMIN kutoka environment (SEED_ADMIN_*).
//  Inatumiwa na:  npm run db:seed / db:seed:prod   NA   server inapowaka (src/server.ts).
//  Inabadilisha SUPER_ADMIN ALIYEPO (haiundi wa pili, haifuti data), kisha inathibitisha login.
//  Tazama maelezo ya vigezo juu ya src/db/seed.ts.
// =====================================================================
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { hashPassword, passwordSchemaRule, signToken, verifyPassword, verifyToken } from './security';
import { phoneSchema } from './http';

const mask = (p: string) => `${p.slice(0, 4)}****${p.slice(-4)}`;

export async function ensureSuperAdmin() {
  const rawPhone = process.env.SEED_ADMIN_PHONE?.trim();
  if (!rawPhone) {
    console.log('ℹ️  SEED_ADMIN_PHONE haijawekwa — SUPER_ADMIN hajaguswa');
    return;
  }
  // Normalization ile ile inayotumiwa na POST /auth/login
  const parsedPhone = phoneSchema.safeParse(rawPhone);
  if (!parsedPhone.success) throw new Error('SEED_ADMIN_PHONE si namba sahihi ya simu (mf. 0712345678)');
  const phone = parsedPhone.data;

  const password = process.env.SEED_ADMIN_PASSWORD || undefined;
  const resetPassword = process.env.SEED_ADMIN_RESET_PASSWORD === 'true';
  const single = process.env.SEED_ADMIN_SINGLE === 'true';
  if (password && !passwordSchemaRule.test(password)) throw new Error(`SEED_ADMIN_PASSWORD: ${passwordSchemaRule.message}`);
  if (resetPassword && !password) throw new Error('SEED_ADMIN_RESET_PASSWORD=true inahitaji SEED_ADMIN_PASSWORD');
  const newHash = password ? await hashPassword(password) : undefined; // bcrypt kabla ya transaction

  const result = await db.transaction(async (tx) => {
    const u = schema.users;

    // 1. Namba isichukuliwe kutoka kwa mtumiaji asiye SUPER_ADMIN
    const owner = await tx.query.users.findFirst({ where: eq(u.phone, phone) });
    if (owner && owner.role !== 'SUPER_ADMIN') {
      throw new Error(`Namba ${mask(phone)} tayari inatumiwa na mtumiaji mwingine (${owner.role}). Hakuna kilichobadilishwa.`);
    }

    // 2. Chagua SUPER_ADMIN wa kubadilisha (rekodi zimefungwa hadi transaction iishe)
    const supers = await tx.select().from(u).where(eq(u.role, 'SUPER_ADMIN')).orderBy(asc(u.createdAt)).for('update');
    let target = owner;
    if (!target && supers.length === 1) target = supers[0];
    if (!target && supers.length > 1) {
      const fromParsed = process.env.SEED_ADMIN_FROM_PHONE ? phoneSchema.safeParse(process.env.SEED_ADMIN_FROM_PHONE) : null;
      if (!fromParsed?.success) {
        throw new Error(`Kuna SUPER_ADMIN ${supers.length} na hakuna mwenye namba ${mask(phone)}. Weka SEED_ADMIN_FROM_PHONE = namba ya sasa ya akaunti ya kubadilisha. Hakuna kilichobadilishwa.`);
      }
      target = supers.find((s) => s.phone === fromParsed.data);
      if (!target) throw new Error(`Hakuna SUPER_ADMIN mwenye namba ${mask(fromParsed.data)}. Hakuna kilichobadilishwa.`);
    }

    const notes: string[] = [];
    let targetId: string;
    let passwordJustSet = false;

    if (!target) {
      // 3a. Hakuna SUPER_ADMIN kabisa -> unda mmoja
      if (!newHash) throw new Error('Hakuna SUPER_ADMIN. Weka SEED_ADMIN_PASSWORD ili kumuunda.');
      const [created] = await tx.insert(u).values({
        fullName: 'Msimamizi wa Mfumo', phone, role: 'SUPER_ADMIN', passwordHash: newHash, mustChangePassword: true,
      }).returning({ id: u.id });
      await tx.insert(schema.auditLogs).values({ action: 'SUPER_ADMIN_CREATE', entity: 'User', entityId: created.id, after: { phone, source: 'seed' } });
      targetId = created.id;
      passwordJustSet = true;
      notes.push('ameundwa');
    } else {
      // 3b. Badilisha SUPER_ADMIN aliyepo (id ile ile)
      targetId = target.id;
      const changes: Partial<typeof u.$inferInsert> = {};
      if (target.phone !== phone) changes.phone = phone;
      // Nenosiri: libadilishwe tu kama halilingani tayari (ili deploy zinazofuata zisilibadilishe tena)
      if (resetPassword && newHash && !(await verifyPassword(password!, target.passwordHash))) {
        changes.passwordHash = newHash;
        changes.mustChangePassword = true;
        passwordJustSet = true;
      }
      if (!target.isActive) changes.isActive = true;

      if (Object.keys(changes).length) {
        await tx.update(u).set({ ...changes, tokenVersion: sql`${u.tokenVersion} + 1` }).where(eq(u.id, target.id));
        await tx.insert(schema.auditLogs).values({
          action: 'SUPER_ADMIN_UPDATE', entity: 'User', entityId: target.id,
          before: { phone: target.phone, isActive: target.isActive },
          after: { phone, isActive: true, passwordReset: !!changes.passwordHash, source: 'seed' },
        });
        if (changes.phone) notes.push(`namba ${mask(target.phone)} -> ${mask(phone)}`);
        if (changes.passwordHash) notes.push('nenosiri limewekwa upya');
        if (changes.isActive) notes.push('akaunti imewashwa');
      }
    }

    // 4. Abaki SUPER_ADMIN mmoja tu hai (wengine wanazimwa, HAWAFUTWI)
    if (single) {
      const others = await tx.update(u)
        .set({ isActive: false, tokenVersion: sql`${u.tokenVersion} + 1` })
        .where(and(eq(u.role, 'SUPER_ADMIN'), ne(u.id, targetId), eq(u.isActive, true)))
        .returning({ id: u.id, phone: u.phone });
      for (const o of others) {
        await tx.insert(schema.auditLogs).values({
          action: 'SUPER_ADMIN_DEACTIVATE', entity: 'User', entityId: o.id,
          before: { isActive: true }, after: { isActive: false, reason: 'SEED_ADMIN_SINGLE', source: 'seed' },
        });
      }
      if (others.length) notes.push(`SUPER_ADMIN wengine ${others.length} wamezimwa (${others.map((o) => mask(o.phone)).join(', ')})`);
    }

    return { targetId, notes, passwordJustSet };
  });

  console.log(result.notes.length
    ? `✅ SUPER_ADMIN ${mask(phone)}: ${result.notes.join('; ')}. Vikao vya zamani vimefutwa.`
    : `ℹ️  SUPER_ADMIN ${mask(phone)} tayari yuko sawa — hakuna kilichobadilishwa`);

  // 5. UTHIBITISHO dhidi ya database hii — njia ile ile ya login (bila kuonyesha siri)
  const user = await db.query.users.findFirst({ where: eq(schema.users.phone, phone) });
  const fail = (m: string) => { throw new Error(`UTHIBITISHO UMESHINDWA: ${m}`); };
  if (!user || user.id !== result.targetId) fail('akaunti haipatikani kwa namba hii');
  if (user!.role !== 'SUPER_ADMIN') fail('akaunti si SUPER_ADMIN');
  if (!user!.isActive) fail('akaunti imezimwa');
  if (password) {
    const match = await verifyPassword(password, user!.passwordHash);
    if (!match && (result.passwordJustSet || resetPassword)) fail('nenosiri halilingani baada ya kuwekwa');
    console.log(match ? '   ✓ nenosiri linalingana (bcrypt)' : '   ⚠ SEED_ADMIN_PASSWORD halilingani na nenosiri la sasa (weka SEED_ADMIN_RESET_PASSWORD=true kulibadilisha)');
  }
  const decoded = verifyToken(signToken({ sub: user!.id, tv: user!.tokenVersion }));
  if (decoded.sub !== user!.id) fail('JWT haikuthibitishwa');
  const activeSupers = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.role, 'SUPER_ADMIN'), eq(schema.users.isActive, true)));
  console.log(`   ✓ namba ${mask(phone)} · SUPER_ADMIN · hai · JWT sawa · SUPER_ADMIN hai kwa jumla: ${activeSupers.length}`);
}


/** Hali ya akaunti ya SEED_ADMIN_PHONE kwa /health (bila kuonyesha namba). */
export async function superAdminStatus(): Promise<'ok' | 'missing' | 'inactive' | 'not-super-admin' | 'invalid-phone' | undefined> {
  const raw = process.env.SEED_ADMIN_PHONE?.trim();
  if (!raw) return undefined;
  const parsed = phoneSchema.safeParse(raw);
  if (!parsed.success) return 'invalid-phone';
  const u = await db.query.users.findFirst({ where: eq(schema.users.phone, parsed.data), columns: { role: true, isActive: true } });
  if (!u) return 'missing';
  if (u.role !== 'SUPER_ADMIN') return 'not-super-admin';
  return u.isActive ? 'ok' : 'inactive';
}
