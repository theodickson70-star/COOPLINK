// =====================================================================
//  RUHUSA ZA WATUMISHI WA AMCOS (ndani ya chama)
//   Meneja  (AMCOS_ADMIN) -> anaidhinisha
//   Mhasibu (ACCOUNTANT)  -> anasimamia fedha
//   Stokipa (CLERK)       -> anasimamia stoo
//  Zinakaguliwa KWENYE BACKEND kwa kila ombi (requireAmcosPerm). Menu ya frontend ni urahisi tu.
// =====================================================================
import { and, eq, inArray } from 'drizzle-orm';
import type { Role } from '../middleware/auth';
import { db, schema } from '../db';

export const AMCOS_PERMISSIONS = {
  // Wakulima
  'members.read': 'Kuona wakulima',
  'members.lookup': 'Kutafuta mkulima (jina na namba tu) kwa ajili ya malipo',
  'members.write': 'Kusajili na kuhariri wakulima',
  'members.approve': 'Kuthibitisha wakulima na kubadilisha hali yao',
  'members.portal': 'Kutoa na kufuta PIN ya portal ya mkulima',
  'estimates.write': 'Kuandika makisio',
  'estimates.approve': 'Kuidhinisha makisio',
  'ledger.read': 'Kuona madeni na taarifa za fedha za wakulima',
  // Stoo
  'stock.read': 'Kuona stoo na historia ya bidhaa',
  'products.manage': 'Kusajili bidhaa (pembejeo)',
  'prices.manage': 'Kuweka bei za pembejeo',
  'stock.receive': 'Kupokea bidhaa',
  'stock.adjust.request': 'Kuomba marekebisho ya stoo',
  'issues.request': 'Kuandaa ugawaji wa pembejeo',
  'issues.cancel': 'Kufuta ugawaji uliokamilika (kwa REVERSAL)',
  'suppliers.manage': 'Kusajili wazabuni',
  'purchases.request': 'Kuandaa maombi ya manunuzi',
  'purchases.receive': 'Kupokea mzigo wa manunuzi',
  // Fedha
  'finance.read': 'Kuona fedha za chama',
  'finance.record': 'Kurekodi mapato na kuandaa matumizi/malipo',
  'finance.post': 'Kukamilisha malipo yaliyoidhinishwa',
  'finance.accounts': 'Kusimamia akaunti za fedha na bajeti',
  // Uhasibu kamili (Mhasibu)
  'accounting.read': 'Kuona daftari kuu na ripoti kuu za fedha (TB, mapato na matumizi, mizania, mtiririko wa fedha)',
  'accounting.manage': 'Chati ya akaunti, journal, usuluhishi wa benki, uhamisho, mali za chama na uchakavu',
  'sales.read': 'Kuona mauzo ya tumbaku na malipo ya wakulima',
  'sales.manage': 'Kusimamia masoko, mabelo, makato na malipo ya wakulima',
  'payroll.read': 'Kuona mishahara',
  'payroll.manage': 'Kusimamia wafanyakazi na kuandaa mishahara',
  // Idhini
  'approvals.read': 'Kuona maombi ya idhini',
  'approvals.decide': 'Kuidhinisha au kukataa maombi',
  // Usimamizi
  'staff.read': 'Kuona watumishi wa chama',
  'audit.read': 'Kuona kumbukumbu (audit log) — Super Admin pekee',
  'reports.finance': 'Ripoti za fedha',
  'reports.stock': 'Ripoti za stoo',
} as const;
export type AmcosPermission = keyof typeof AMCOS_PERMISSIONS;

/** Majina rasmi ya vyeo vitatu (role za database hazibadilishwi ili data ya zamani ibaki salama). */
export const AMCOS_STAFF_ROLES = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] as const satisfies readonly Role[];
export type AmcosStaffRole = (typeof AMCOS_STAFF_ROLES)[number];
export const STAFF_TITLE: Record<AmcosStaffRole, string> = { AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Stokipa' };
export const isAmcosStaff = (r: Role): r is AmcosStaffRole => (AMCOS_STAFF_ROLES as readonly Role[]).includes(r);

const READ: AmcosPermission[] = ['members.read', 'members.lookup', 'ledger.read', 'stock.read', 'finance.read', 'approvals.read', 'staff.read', 'reports.finance', 'reports.stock', 'accounting.read', 'sales.read', 'payroll.read'];

export const AMCOS_ROLE_PERMISSIONS: Partial<Record<Role, AmcosPermission[]>> = {
  AMCOS_ADMIN: [
    'members.read', 'members.lookup', 'members.write', 'members.approve', 'estimates.write', 'estimates.approve', 'ledger.read',
    'stock.read', 'prices.manage', 'issues.cancel',
    'finance.read', 'approvals.read', 'approvals.decide', 'staff.read', 'reports.finance', 'reports.stock',
    // Meneja: ripoti na idhini tu — haandiki journal, vocha wala mishahara
    'accounting.read', 'sales.read', 'payroll.read',
  ],
  // Mhasibu: fedha na uhasibu TU (hana wakulima, stoo wala kumbukumbu). Anatafuta mkulima kwa malipo kupitia members.lookup.
  ACCOUNTANT: [
    'members.lookup', 'members.portal',
    'finance.read', 'finance.record', 'finance.post', 'finance.accounts',
    'accounting.read', 'accounting.manage', 'sales.read', 'sales.manage', 'payroll.read', 'payroll.manage',
    'approvals.read', 'reports.finance',
  ],
  CLERK: [
    'members.read', 'members.lookup', 'members.write', 'members.portal', 'estimates.write',
    'stock.read', 'products.manage', 'stock.receive', 'stock.adjust.request', 'issues.request',
    'suppliers.manage', 'purchases.request', 'purchases.receive',
    'approvals.read', 'reports.stock',
  ],
  // Kusoma tu: Owner (anaangalia vyama vyote), Chama Kikuu, na watazamaji wa zamani
  SUPER_ADMIN: [...READ, 'audit.read'], // kumbukumbu (audit) ni ya Super Admin pekee
  UNION_ADMIN: READ,
  UNION_VIEWER: READ,
  AMCOS_VIEWER: READ,
};

export function amcosPermissions(role: Role): AmcosPermission[] {
  return [...(AMCOS_ROLE_PERMISSIONS[role] ?? [])];
}
export const hasAmcosPerm = (role: Role, p: AmcosPermission) => (AMCOS_ROLE_PERMISSIONS[role] ?? []).includes(p);

// =====================================================================
//  CHAMA CHENYE MENEJA PEKEE
//  Chama kisicho na Mhasibu au Stokipa aliye hai: Meneja anapata kazi za cheo kisichokuwepo (kwa muda).
//  Mhasibu/Stokipa akiongezwa (au akiwashwa), kazi hizo zinarudi kwake zenyewe.
//  Kuidhinisha ombi alilolianzisha mwenyewe kunaruhusiwa TU katika hali hii (approvals.ts), kwa nenosiri + maelezo,
//  na kunaonekana kama "Imejiidhinisha" kwa Owner na Chama Kikuu.
// =====================================================================
export type CoverRole = 'ACCOUNTANT' | 'CLERK';
const staffCache = new Map<string, { at: number; missing: CoverRole[] }>();
const STAFF_TTL = 20_000;
export function clearStaffingCache() { staffCache.clear(); }

/** Vyeo ambavyo chama hakina mtumishi hai kwa sasa */
export async function missingRoles(amcosId: string): Promise<CoverRole[]> {
  const c = staffCache.get(amcosId);
  if (c && Date.now() - c.at < STAFF_TTL) return c.missing;
  const rows = await db.selectDistinct({ role: schema.users.role }).from(schema.users)
    .where(and(eq(schema.users.amcosId, amcosId), eq(schema.users.isActive, true), inArray(schema.users.role, ['ACCOUNTANT', 'CLERK'])));
  const have = new Set(rows.map((r) => r.role));
  const missing = (['ACCOUNTANT', 'CLERK'] as const).filter((r) => !have.has(r));
  staffCache.set(amcosId, { at: Date.now(), missing });
  return missing;
}

/** Ruhusa za ziada za Meneja kwa vyeo visivyokuwepo (tupu kwa wengine). */
export async function coverPermissions(role: Role, amcosId: string | null): Promise<{ covering: CoverRole[]; extra: AmcosPermission[] }> {
  if (role !== 'AMCOS_ADMIN' || !amcosId) return { covering: [], extra: [] };
  const covering = await missingRoles(amcosId);
  const own = new Set(AMCOS_ROLE_PERMISSIONS.AMCOS_ADMIN);
  const extra = [...new Set(covering.flatMap((r) => AMCOS_ROLE_PERMISSIONS[r] ?? []))].filter((p) => !own.has(p));
  return { covering, extra };
}

/** Ruhusa kamili ya mtumiaji aliyeingia (cheo + kazi za vyeo visivyokuwepo) */
export const canAmcos = (auth: { role: Role; amcosExtra?: AmcosPermission[] }, p: AmcosPermission) =>
  hasAmcosPerm(auth.role, p) || !!auth.amcosExtra?.includes(p);
