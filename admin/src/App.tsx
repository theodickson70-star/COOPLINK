import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, ROLE_GROUPS, type Role } from './lib/auth';
import { Layout } from './components/Layout';
import { LogoMark } from './components/Logo';
import { Empty } from './components/ui';
import { Login, ChangePassword } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Members, MemberNew } from './pages/Members';
import { MemberDetail } from './pages/MemberDetail';
import { Estimates } from './pages/Estimates';
import { Inputs } from './pages/Inputs';
import { InputIssues, InputIssueNew, InputIssueDetail } from './pages/InputIssues';
import { Balances, Users, Organizations, Audit } from './pages/Admin';

function Splash() {
  return <div className="center" style={{ minHeight: '100%', background: 'var(--forest)' }}><LogoMark size={120} animate /></div>;
}

function Protected({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading, can } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    const go = () => nav('/change-password');
    window.addEventListener('cl:password-change', go);
    return () => window.removeEventListener('cl:password-change', go);
  }, [nav]);
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (roles && !can(...roles)) return <Empty>Huna ruhusa ya kuona ukurasa huu.</Empty>;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user && !user.mustChangePassword) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NeedsUser({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/change-password" element={<NeedsUser><ChangePassword /></NeedsUser>} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="members" element={<Members />} />
            <Route path="members/new" element={<Protected roles={ROLE_GROUPS.STAFF}><MemberNew /></Protected>} />
            <Route path="members/:id" element={<MemberDetail />} />
            <Route path="estimates" element={<Estimates />} />
            <Route path="inputs" element={<Inputs />} />
            <Route path="input-issues" element={<InputIssues />} />
            <Route path="input-issues/new" element={<Protected roles={ROLE_GROUPS.STAFF}><InputIssueNew /></Protected>} />
            <Route path="input-issues/:id" element={<InputIssueDetail />} />
            <Route path="balances" element={<Balances />} />
            <Route path="users" element={<Protected roles={ROLE_GROUPS.ADMINS}><Users /></Protected>} />
            <Route path="organizations" element={<Protected roles={ROLE_GROUPS.ORGS}><Organizations /></Protected>} />
            <Route path="audit" element={<Protected roles={ROLE_GROUPS.AUDIT}><Audit /></Protected>} />
            <Route path="*" element={<Empty>Ukurasa haupo.</Empty>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
