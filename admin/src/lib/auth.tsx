import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setSelectedAmcos, setToken } from './api';

export type Role = 'SUPER_ADMIN' | 'UNION_ADMIN' | 'UNION_VIEWER' | 'AMCOS_ADMIN' | 'ACCOUNTANT' | 'CLERK' | 'AMCOS_VIEWER';

export interface User {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  unionId: string | null;
  amcosId: string | null;
  mustChangePassword: boolean;
}
export interface Amcos { id: string; name: string; code: string; district?: string | null }

interface AuthState {
  user: User | null;
  amcos: Amcos | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<User>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (...roles: Role[]) => boolean;
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
    setToken(null);
    setSelectedAmcos(null);
    setUser(null);
    setAmcos(null);
  }, []);

  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setAmcos(null);
    };
    window.addEventListener('cl:logout', onLogout);
    if (getToken()) {
      api<{ user: User; amcos: Amcos | null }>('/auth/me')
        .then((r) => {
          setUser(r.user);
          setAmcos(r.amcos);
        })
        .catch(() => setToken(null))
        .finally(() => setLoading(false));
    }
    return () => window.removeEventListener('cl:logout', onLogout);
  }, []);

  const login = async (phone: string, password: string) => {
    const r = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { phone, password } });
    setToken(r.token);
    setSelectedAmcos(null);
    const me = await api<{ user: User; amcos: Amcos | null }>('/auth/me');
    setUser(me.user);
    setAmcos(me.amcos);
    return me.user;
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const r = await api<{ token: string; user: User }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    setToken(r.token);
    setUser({ ...r.user });
  };

  const can = (...roles: Role[]) => !!user && roles.flat().includes(user.role);

  return <Ctx.Provider value={{ user, amcos, loading, login, logout, changePassword, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth nje ya AuthProvider');
  return v;
}
