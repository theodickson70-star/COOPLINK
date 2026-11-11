import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setSelectedAmcos, setToken } from './api';

export type Role =
  | 'SUPER_ADMIN' | 'UNION_ADMIN' | 'UNION_VIEWER' | 'AMCOS_ADMIN' | 'ACCOUNTANT' | 'CLERK' | 'AMCOS_VIEWER'
  | 'FINANCE_MANAGER' | 'TECH_SUPPORT' | 'CUSTOMER_SUPPORT' | 'MARKETING_MANAGER';

export type Permission =
  | 'platform.dashboard' | 'amcos.read' | 'amcos.create' | 'amcos.approve' | 'amcos.suspend'
  | 'subscriptions.read' | 'subscriptions.manage' | 'finance.read' | 'finance.manage' | 'staff.manage'
  | 'system.read' | 'system.manage' | 'comms.read' | 'comms.send' | 'security.read' | 'security.manage'
  | 'backup.read' | 'backup.manage' | 'business.read' | 'business.manage' | 'amcos.staff'
  | 'support.read' | 'support.manage';

/** Ruhusa za watumishi wa AMCOS (zinatoka backend kwenye /auth/me; backend inazikagua tena kila ombi). */
export type AmcosPermission =
  | 'members.read' | 'members.lookup' | 'members.write' | 'members.approve' | 'members.portal' | 'estimates.write' | 'estimates.approve' | 'ledger.read'
  | 'stock.read' | 'products.manage' | 'prices.manage' | 'stock.receive' | 'stock.adjust.request' | 'issues.request' | 'issues.cancel'
  | 'suppliers.manage' | 'purchases.request' | 'purchases.receive'
  | 'finance.read' | 'finance.record' | 'finance.post' | 'finance.accounts'
  | 'approvals.read' | 'approvals.decide' | 'staff.read' | 'audit.read' | 'reports.finance' | 'reports.stock'
  | 'accounting.read' | 'accounting.manage' | 'sales.read' | 'sales.manage' | 'payroll.read' | 'payroll.manage';

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  unionId: string | null;
  amcosId: string | null;
  jobTitle: string | null;
  mustChangePassword: boolean;
  /** Masharti/Faragha: toleo alilokubali, na kama anatakiwa kukubali toleo la sasa */
  termsVersion?: string | null;
  termsRequired?: boolean;
  legalVersion?: string;
  totpEnabled: boolean;
  permissions: Permission[];
  amcosPermissions: AmcosPermission[];
  /** Meneja wa chama kisicho na Mhasibu/Storekeeper: vyeo anavyovifanyia kazi kwa muda */
  covering?: ('ACCOUNTANT' | 'CLERK')[];
}
export interface Amcos { id: string; name: string; code: string; district?: string | null }

export const PLATFORM_ROLES: Role[] = ['SUPER_ADMIN', 'FINANCE_MANAGER', 'TECH_SUPPORT', 'CUSTOMER_SUPPORT', 'MARKETING_MANAGER'];
export const STAFF_ROLES: Role[] = ['FINANCE_MANAGER', 'TECH_SUPPORT', 'CUSTOMER_SUPPORT', 'MARKETING_MANAGER'];
export const isPlatform = (r?: Role) => !!r && PLATFORM_ROLES.includes(r);
export const isStaff = (r?: Role) => !!r && STAFF_ROLES.includes(r);
/** Ukurasa wa kwanza baada ya kuingia. */
export const homeFor = (u: User) => (isPlatform(u.role) ? '/owner' : '/');

type LoginResult = { user: User } | { twoFactor: true; challenge: string };

interface AuthState {
  user: User | null;
  amcos: Amcos | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<LoginResult>;
  verify2fa: (challenge: string, code: string) => Promise<User>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
  has: (...perms: Permission[]) => boolean;
  /** Ruhusa ya ndani ya chama (Meneja / Mhasibu / Storekeeper). */
  may: (...perms: AmcosPermission[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export const ROLE_GROUPS = {
  STAFF: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] as Role[],
  MANAGERS: ['SUPER_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT'] as Role[],
  ADMINS: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] as Role[],
  AUDIT: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN', 'ACCOUNTANT', 'AMCOS_VIEWER'] as Role[],
  ORGS: ['SUPER_ADMIN', 'UNION_ADMIN'] as Role[],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [amcos, setAmcos] = useState<Amcos | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => {
    void api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setSelectedAmcos(null);
    setUser(null);
    setAmcos(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await api<{ user: User; amcos: Amcos | null }>('/auth/me');
    setUser(me.user);
    setAmcos(me.amcos);
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setAmcos(null);
    };
    window.addEventListener('cl:logout', onLogout);
    if (getToken()) {
      refresh().catch(() => setToken(null)).finally(() => setLoading(false));
    }
    return () => window.removeEventListener('cl:logout', onLogout);
  }, [refresh]);

  const finish = async (token: string) => {
    setToken(token);
    setSelectedAmcos(null);
    const me = await api<{ user: User; amcos: Amcos | null }>('/auth/me');
    setUser(me.user);
    setAmcos(me.amcos);
    return me.user;
  };

  const login = async (phone: string, password: string): Promise<LoginResult> => {
    const r = await api<{ token?: string; twoFactorRequired?: boolean; challenge?: string }>('/auth/login', { method: 'POST', body: { phone, password } });
    if (r.twoFactorRequired && r.challenge) return { twoFactor: true, challenge: r.challenge };
    return { user: await finish(r.token!) };
  };

  const verify2fa = async (challenge: string, code: string) => {
    const r = await api<{ token: string }>('/auth/2fa/verify', { method: 'POST', body: { challenge, code } });
    return finish(r.token);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const r = await api<{ token: string; user: User }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    setToken(r.token);
    setUser({ ...r.user });
  };

  const can = (...roles: Role[]) => !!user && roles.flat().includes(user.role);
  const has = (...perms: Permission[]) => !!user && perms.some((p) => user.permissions?.includes(p));
  const may = (...perms: AmcosPermission[]) => !!user && perms.some((p) => user.amcosPermissions?.includes(p));

  return <Ctx.Provider value={{ user, amcos, loading, login, verify2fa, logout, changePassword, refresh, can, has, may }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth nje ya AuthProvider');
  return v;
}
