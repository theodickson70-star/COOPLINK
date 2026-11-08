// =====================================================================
//  RBAC ya jukwaa (Owner Control Panel)
//  - SUPER_ADMIN = OWNER SUPER ADMIN: ruhusa zote.
//  - Wafanyakazi wa NAYA/CoopLink: ruhusa za role yao, au orodha maalum (users.permissions).
//  - `staff.manage` ni ya OWNER pekee na haitolewi kwa mfanyakazi yeyote.
//  - Wafanyakazi wa jukwaa HAWANA access ya data za vyama (inazuiwa kwenye app.ts).
// =====================================================================
import type { Role } from '../middleware/auth';

export const PERMISSIONS = {
  'platform.dashboard': 'Kuona dashibodi ya mmiliki',
  'amcos.read': 'Kuona vyama (biashara)',
  'amcos.create': 'Kusajili vyama',
  'amcos.approve': 'Kuidhinisha / kukataa vyama',
  'amcos.staff': 'Kusimamia watumishi wa vyama (Meneja, Mhasibu, Stokipa)',
  'amcos.suspend': 'Kusitisha / kuwasha vyama',
  'subscriptions.read': 'Kuona subscriptions',
  'subscriptions.manage': 'Kusimamia mipango na subscriptions',
  'finance.read': 'Kuona fedha za kampuni',
  'finance.manage': 'Kurekodi / kuthibitisha malipo na matumizi',
  'staff.manage': 'Kusimamia wafanyakazi (Owner pekee)',
  'system.read': 'Kuona hali ya mfumo',
  'system.manage': 'Maintenance, matangazo ya mfumo, mipangilio',
  'comms.read': 'Kuona mawasiliano',
  'comms.send': 'Kutuma matangazo / SMS',
  'security.read': 'Kuona usalama na audit',
  'security.manage': 'Kufuta sessions za watumiaji',
  'backup.read': 'Kuona backup na database',
  'backup.manage': 'Kuchukua export / kuomba restore',
  'business.read': 'Kuona NAYA Group Business',
  'business.manage': 'Kuhariri malengo na wasifu wa biashara',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
const OWNER_ONLY: Permission[] = ['staff.manage'];

export const PLATFORM_ROLES: Role[] = ['SUPER_ADMIN', 'FINANCE_MANAGER', 'TECH_SUPPORT', 'CUSTOMER_SUPPORT', 'MARKETING_MANAGER'];
export const STAFF_ROLES: Role[] = ['FINANCE_MANAGER', 'TECH_SUPPORT', 'CUSTOMER_SUPPORT', 'MARKETING_MANAGER'];
export const isPlatformRole = (r: Role) => PLATFORM_ROLES.includes(r);
export const isStaffRole = (r: Role) => STAFF_ROLES.includes(r);

export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  FINANCE_MANAGER: ['platform.dashboard', 'amcos.read', 'subscriptions.read', 'subscriptions.manage', 'finance.read', 'finance.manage', 'business.read'],
  TECH_SUPPORT: ['platform.dashboard', 'amcos.read', 'system.read', 'system.manage', 'backup.read', 'security.read'],
  CUSTOMER_SUPPORT: ['platform.dashboard', 'amcos.read', 'amcos.create', 'subscriptions.read', 'comms.read', 'comms.send'],
  MARKETING_MANAGER: ['platform.dashboard', 'amcos.read', 'comms.read', 'comms.send', 'business.read'],
};

/** Ruhusa halisi za mtumiaji. */
export function effectivePermissions(role: Role, custom: string[] | null | undefined): Permission[] {
  if (role === 'SUPER_ADMIN') return [...ALL_PERMISSIONS];
  if (!isStaffRole(role)) return [];
  const base = custom ?? ROLE_DEFAULTS[role] ?? [];
  return base.filter((p): p is Permission => p in PERMISSIONS && !OWNER_ONLY.includes(p as Permission));
}

/** Orodha safi ya ruhusa inayoweza kuhifadhiwa kwa mfanyakazi (bila za Owner pekee). */
export function sanitizePermissions(list: string[]): Permission[] {
  return [...new Set(list)].filter((p): p is Permission => p in PERMISSIONS && !OWNER_ONLY.includes(p as Permission));
}
