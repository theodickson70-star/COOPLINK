// Data ya kuanzia: msimamizi wa mfumo (SUPER_ADMIN) + msimu wa sasa.
// Hiari: SEED_DEMO=true kuongeza Chama Kikuu, AMCOS ya majaribio, watumiaji na pembejeo.
//   npm run db:seed        (kompyuta yako)
//   npm run db:seed:prod   (Railway, baada ya build)
//
// SUPER_ADMIN (vigezo kutoka environment — hakuna namba wala nenosiri ndani ya code):
//   SEED_ADMIN_PHONE           (lazima) namba ya kuingia ya SUPER_ADMIN, mf. 0712345678
//   SEED_ADMIN_PASSWORD        nenosiri — linahitajika tu kuunda admin mpya au kulibadilisha
//   SEED_ADMIN_RESET_PASSWORD  true = weka SEED_ADMIN_PASSWORD kama nenosiri jipya la admin aliyepo
//   SEED_ADMIN_FROM_PHONE      tu kama kuna SUPER_ADMIN zaidi ya mmoja: namba ya sasa ya akaunti ya kubadilisha
//
// Ni salama kuendesha mara nyingi: haiundi SUPER_ADMIN wa pili, inabadilisha aliyepo.
import { asc, eq, sql } from 'drizzle-orm';
import { db, pool, schema } from './index';
import { hashPassword, passwordSchemaRule } from '../lib/security';
import { normalizePhone } from '../lib/http';

const mask = (p: string) => `${p.slice(0, 4)}****${p.slice(-4)}`;

async function ensureSuperAdmin() {
  const rawPhone = process.env.SEED_ADMIN_PHONE?.trim();
  if (!rawPhone) throw new Error('Weka SEED_ADMIN_PHONE (namba ya simu ya SUPER_ADMIN) kwenye environment');
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error('SEED_ADMIN_PHONE si namba sahihi ya simu (mf. 0712345678)');

  const password = process.env.SEED_ADMIN_PASSWORD || undefined;
  const resetPassword = process.env.SEED_ADMIN_RESET_PASSWORD === 'true';
  if (password && !passwordSchemaRule.test(password)) throw new Error(`SEED_ADMIN_PASSWORD: ${passwordSchemaRule.message}`);
  if (resetPassword && !password) throw new Error('SEED_ADMIN_RESET_PASSWORD=true inahitaji SEED_ADMIN_PASSWORD');
  // Hash kabla ya transaction (bcrypt ni polepole)
  const newHash = password ? await hashPassword(password) : undefined;

  const result = await db.transaction(async (tx) => {
    const u = schema.users;

    // 1. Je, namba hii tayari ni ya mtu? Isichukuliwe kutoka kwa mtumiaji mwingine.
    const owner = await tx.query.users.findFirst({ where: eq(u.phone, phone) });
    if (owner && owner.role !== 'SUPER_ADMIN') {
      throw new Error(`Namba ${mask(phone)} tayari inatumiwa na mtumiaji mwingine (${owner.role}). Hakuna kilichobadilishwa.`);
    }

    // 2. Chagua SUPER_ADMIN wa kubadilisha (rekodi zimefungwa hadi transaction iishe)
    const supers = await tx.select().from(u).where(eq(u.role, 'SUPER_ADMIN')).orderBy(asc(u.createdAt)).for('update');
    let target = owner;
    if (!target && supers.length === 1) target = supers[0];
    if (!target && supers.length > 1) {
      const from = process.env.SEED_ADMIN_FROM_PHONE ? normalizePhone(process.env.SEED_ADMIN_FROM_PHONE) : null;
      if (!from) {
        throw new Error(`Kuna SUPER_ADMIN ${supers.length}. Weka SEED_ADMIN_FROM_PHONE = namba ya sasa ya akaunti unayotaka kubadilisha. Hakuna kilichobadilishwa.`);
      }
      target = supers.find((s) => s.phone === from);
      if (!target) throw new Error(`Hakuna SUPER_ADMIN mwenye namba ${mask(from)}. Hakuna kilichobadilishwa.`);
    }

    // 3a. Hakuna SUPER_ADMIN kabisa -> unda mmoja
    if (!target) {
      if (!newHash) throw new Error('Hakuna SUPER_ADMIN. Weka SEED_ADMIN_PASSWORD ili kumuunda.');
      const [created] = await tx.insert(u).values({
        fullName: 'Msimamizi wa Mfumo', phone, role: 'SUPER_ADMIN', passwordHash: newHash, mustChangePassword: true,
      }).returning({ id: u.id });
      await tx.insert(schema.auditLogs).values({
        action: 'SUPER_ADMIN_CREATE', entity: 'User', entityId: created.id, after: { phone, source: 'seed' },
      });
      return { action: 'created' as const, phone };
    }

    // 3b. Badilisha SUPER_ADMIN aliyepo (id ile ile — historia na audit zinabaki)
    const changes: Partial<typeof u.$inferInsert> = {};
    if (target.phone !== phone) changes.phone = phone;
    if (resetPassword && newHash) {
      changes.passwordHash = newHash;
      changes.mustChangePassword = true;
    }
    if (!target.isActive) changes.isActive = true;
    if (Object.keys(changes).length === 0) return { action: 'unchanged' as const, phone };

    await tx.update(u)
      .set({ ...changes, tokenVersion: sql`${u.tokenVersion} + 1` }) // vikao vya zamani vinakufa
      .where(eq(u.id, target.id));
    await tx.insert(schema.auditLogs).values({
      action: 'SUPER_ADMIN_UPDATE', entity: 'User', entityId: target.id,
      before: { phone: target.phone, isActive: target.isActive },
      after: { phone, isActive: true, passwordReset: !!changes.passwordHash, source: 'seed' },
    });
    return {
      action: 'updated' as const, phone, oldPhone: target.phone,
      phoneChanged: !!changes.phone, passwordReset: !!changes.passwordHash, reactivated: !!changes.isActive,
    };
  });

  // Hakuna nenosiri wala hash inayoandikwa kwenye logs
  if (result.action === 'created') {
    console.log(`✅ SUPER_ADMIN ameundwa: ${mask(result.phone)} (atalazimika kubadilisha nenosiri akiingia)`);
  } else if (result.action === 'unchanged') {
    console.log(`ℹ️  SUPER_ADMIN tayari yuko sawa: ${mask(result.phone)}`);
  } else {
    const parts = [
      result.phoneChanged ? `namba ${mask(result.oldPhone)} -> ${mask(result.phone)}` : null,
      result.passwordReset ? 'nenosiri limebadilishwa (atalazimika kulibadilisha akiingia)' : null,
      result.reactivated ? 'akaunti imewashwa tena' : null,
    ].filter(Boolean);
    console.log(`✅ SUPER_ADMIN amesasishwa: ${parts.join('; ')}. Vikao vya zamani vimefutwa.`);
  }
}

async function main() {
  await ensureSuperAdmin();

  let season = await db.query.seasons.findFirst({ where: eq(schema.seasons.name, '2026/2027') });
  if (!season) {
    await db.update(schema.seasons).set({ isCurrent: false });
    [season] = await db.insert(schema.seasons).values({
      name: '2026/2027', startDate: '2026-07-01', endDate: '2027-06-30', status: 'ACTIVE', isCurrent: true,
    }).returning();
    console.log('✅ Msimu 2026/2027 (wa sasa)');
  }

  if (process.env.SEED_DEMO === 'true') {
    const [union] = await db.insert(schema.unions).values({ name: 'Chama Kikuu cha Majaribio', code: 'DEMOU', region: 'Tabora' })
      .onConflictDoNothing().returning();
    const u = union ?? (await db.query.unions.findFirst({ where: eq(schema.unions.code, 'DEMOU') }))!;
    const [a] = await db.insert(schema.amcos).values({ unionId: u.id, name: 'AMCOS ya Majaribio', code: 'DEMO1', region: 'Tabora', district: 'Urambo' })
      .onConflictDoNothing().returning();
    const amcos = a ?? (await db.query.amcos.findFirst({ where: eq(schema.amcos.code, 'DEMO1') }))!;

    const demoUsers = [
      { fullName: 'Katibu wa Majaribio', phone: '255711000001', role: 'AMCOS_ADMIN' as const, amcosId: amcos.id },
      { fullName: 'Mhasibu wa Majaribio', phone: '255711000002', role: 'ACCOUNTANT' as const, amcosId: amcos.id },
      { fullName: 'Karani wa Majaribio', phone: '255711000003', role: 'CLERK' as const, amcosId: amcos.id },
      { fullName: 'Msimamizi wa Union', phone: '255711000004', role: 'UNION_ADMIN' as const, unionId: u.id },
    ];
    const hash = await hashPassword('Demo12345');
    for (const du of demoUsers) {
      await db.insert(schema.users).values({ ...du, passwordHash: hash, mustChangePassword: false }).onConflictDoNothing();
    }

    const demoItems = [
      { name: 'NPK 10:18:24 (50kg)', category: 'FERTILIZER' as const, unit: 'BAG' as const, price: '78000.00' },
      { name: 'CAN (50kg)', category: 'FERTILIZER' as const, unit: 'BAG' as const, price: '65000.00' },
      { name: 'Mbegu za tumbaku (pakiti)', category: 'SEED' as const, unit: 'PACKET' as const, price: '12000.00' },
      { name: 'Kamba ya kufungia (roll)', category: 'PACKAGING' as const, unit: 'ROLL' as const, price: '15000.00' },
    ];
    for (const it of demoItems) {
      const [item] = await db.insert(schema.inputItems).values({ amcosId: amcos.id, name: it.name, category: it.category, unit: it.unit })
        .onConflictDoNothing().returning();
      if (item) {
        await db.insert(schema.inputPrices).values({ amcosId: amcos.id, seasonId: season.id, inputItemId: item.id, unitPrice: it.price });
        await db.insert(schema.stockMovements).values({ amcosId: amcos.id, seasonId: season.id, inputItemId: item.id, type: 'RECEIPT', quantity: '500', reference: 'SEED' });
      }
    }
    console.log('✅ Demo: AMCOS DEMO1, watumiaji 2557110000(01-04) / Demo12345, pembejeo 4 zenye bei na stoo');
  }
}

main()
  .catch((err) => {
    console.error('❌ Seed imeshindwa:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
