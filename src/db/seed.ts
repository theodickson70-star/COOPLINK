// Data ya kuanzia: msimamizi wa mfumo (SUPER_ADMIN) + msimu wa sasa.
// Hiari: SEED_DEMO=true kuongeza Chama Kikuu, AMCOS ya majaribio, watumiaji na pembejeo.
//   npm run db:seed        (kompyuta yako)
//   npm run db:seed:prod   (Railway — inaendeshwa yenyewe kila deploy kupitia `npm run release`)
//
// SUPER_ADMIN (vigezo kutoka environment — hakuna namba wala nenosiri ndani ya code):
//   SEED_ADMIN_PHONE           namba ya kuingia ya SUPER_ADMIN, mf. 0712345678 (isipowekwa, sehemu hii inarukwa)
//   SEED_ADMIN_PASSWORD        nenosiri — kuunda admin wa kwanza, au pamoja na RESET
//   SEED_ADMIN_RESET_PASSWORD  true = weka SEED_ADMIN_PASSWORD kama nenosiri la admin aliyepo
//   SEED_ADMIN_SINGLE          true = SUPER_ADMIN wengine wote wanazimwa (hawafutwi) -> abaki mmoja tu hai
//   SEED_ADMIN_FROM_PHONE      tu kama kuna SUPER_ADMIN zaidi ya mmoja na namba mpya si ya yeyote kati yao
//
// Ni salama kuendesha mara nyingi: haiundi SUPER_ADMIN wa pili, haifuti mtumiaji wala data yoyote,
// na ikiendeshwa tena bila mabadiliko haigusi kitu. Mwishoni INATHIBITISHA kuwa login itafanya kazi;
// ikishindwa, inatoka na kosa (deploy ya Railway inasimama, toleo la zamani linaendelea kufanya kazi).
import { eq } from 'drizzle-orm';
import { db, pool, schema } from './index';
import { hashPassword } from '../lib/security';
import { ensureSuperAdmin } from '../lib/super-admin';

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
    console.error('❌ Seed imeshindwa:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => pool.end());
