// =====================================================================
//  RUHUSA ZA WATUMISHI WA AMCOS (ndani ya chama)
//   Meneja  (AMCOS_ADMIN) -> anaidhinisha
//   Mhasibu (ACCOUNTANT)  -> anasimamia fedha
//   Stokipa (CLERK)       -> anasimamia stoo
//  Zinakaguliwa KWENYE BACKEND kwa kila ombi (requireAmcosPerm). Menu ya frontend ni urahisi tu.
// =====================================================================
import type { Role } from '../middleware/auth';

export const AMCOS_PERMISSIONS = {
  // Wakulima
  'members.read': 'Kuona wakulima',
  'members.write': 'Kusajili na kuhariri wakulima',
  'members.approve': 'Kuthibitisha wakulima na kubadilisha hali yao',
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
  // Idhini
  'approvals.read': 'Kuona maombi ya idhini',
  'approvals.decide': 'Kuidhinisha au kukataa maombi',
  // Usimamizi
  'staff.read': 'Kuona watumishi wa chama',
  'audit.read': 'Kuona audit log ya chama',
  'reports.finance': 'Ripoti za fedha',
  'reports.stock': 'Ripoti za stoo',
} as const;
export type AmcosPermission = keyof typeof AMCOS_PERMISSIONS;

/** Majina rasmi ya vyeo vitatu (role za database hazibadilishwi ili data ya zamani ibaki salama). */
export const AMCOS_STAFF_ROLES = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] as const satisfies readonly Role[];
export type AmcosStaffRole = (typeof AMCOS_STAFF_ROLES)[number];
export const STAFF_TITLE: Record<AmcosStaffRole, string> = { AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Stokipa' };
export const isAmcosStaff = (r: Role): r is AmcosStaffRole => (AMCOS_STAFF_ROLES as readonly Role[]).includes(r);

const READ: AmcosPermission[] = ['members.read', 'ledger.read', 'stock.read', 'finance.read', 'approvals.read', 'staff.read', 'audit.read', 'reports.finance', 'reports.stock'];

export const AMCOS_ROLE_PERMISSIONS: Partial<Record<Role, AmcosPermission[]>> = {
  AMCOS_ADMIN: [
    'members.read', 'members.write', 'members.approve', 'estimates.write', 'estimates.approve', 'ledger.read',
    'stock.read', 'prices.manage', 'issues.cancel',
    'finance.read', 'approvals.read', 'approvals.decide', 'staff.read', 'audit.read', 'reports.finance', 'reports.stock',
  ],
  ACCOUNTANT: [
    'members.read', 'members.write', 'estimates.write', 'ledger.read',
    'stock.read',
    'finance.read', 'finance.record', 'finance.post', 'finance.accounts',
    'approvals.read', 'audit.read', 'reports.finance', 'reports.stock',
  ],
  CLERK: [
    'members.read', 'members.write', 'estimates.write',
    'stock.read', 'products.manage', 'stock.receive', 'stock.adjust.request', 'issues.request',
    'suppliers.manage', 'purchases.request', 'purchases.receive',
    'approvals.read', 'reports.stock',
  ],
  // Kusoma tu: Owner (anaangalia vyama vyote), Chama Kikuu, na watazamaji wa zamani
  SUPER_ADMIN: READ,
  UNION_ADMIN: READ,
  UNION_VIEWER: READ,
  AMCOS_VIEWER: READ,
};

export function amcosPermissions(role: Role): AmcosPermission[] {
  return [...(AMCOS_ROLE_PERMISSIONS[role] ?? [])];
}
export const hasAmcosPerm = (role: Role, p: AmcosPermission) => (AMCOS_ROLE_PERMISSIONS[role] ?? []).includes(p);
