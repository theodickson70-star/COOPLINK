// =====================================================================
//  NAMBA YA SIMU NA AKAUNTI (v0.37.3)
//   Namba moja = akaunti moja ILIYO HAI. Akaunti zilizozimwa zinabaki na namba zao (historia), na mtu yule yule
//   anaweza kupewa akaunti mpya kwa namba ile ile (mf. Mhasibu wa zamani wa chama anakuwa mfanyakazi wa CoopLink).
//   Database inalinda hili kwa unique index ya sehemu: users(phone) WHERE is_active.
// =====================================================================
import { and, desc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db';
import { conflict } from './errors';
import { ROLE_TITLE_SW } from './staff-credentials';

const U = schema.users;

/** Akaunti ya kuingia kwa namba hii: iliyo hai kwanza (kisha ya karibuni zaidi). */
export async function userByPhone(phone: string) {
  return db.query.users.findFirst({ where: eq(U.phone, phone), orderBy: [desc(U.isActive), desc(U.updatedAt)] });
}

/** Akaunti nyingine ILIYO HAI yenye namba hii (inazuia kuunda au kuwasha akaunti ya pili). */
export async function activeHolder(phone: string, exceptId?: string) {
  const u = await db.query.users.findFirst({
    where: and(eq(U.phone, phone), eq(U.isActive, true), exceptId ? ne(U.id, exceptId) : undefined),
    columns: { id: true, fullName: true, role: true, amcosId: true },
  });
  if (!u) return null;
  const a = u.amcosId ? await db.query.amcos.findFirst({ where: eq(schema.amcos.id, u.amcosId), columns: { name: true } }) : null;
  const title = u.role === 'SUPER_ADMIN' ? 'Owner Super Admin' : `${ROLE_TITLE_SW[u.role] ?? u.role}${a ? ` wa ${a.name}` : ''}`;
  return { ...u, title };
}

export async function assertPhoneFree(phone: string, exceptId?: string) {
  const h = await activeHolder(phone, exceptId);
  if (h) throw conflict(`Namba hii inatumika na akaunti iliyo hai ya ${h.fullName} — ${h.title}. Izime kwanza au tumia namba nyingine.`, { code: 'PHONE_TAKEN' });
}
