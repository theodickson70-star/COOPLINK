import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, ROLE_GROUPS, homeFor, isPlatform, isStaff, type Role } from './lib/auth';
import { Layout } from './components/Layout';
import { LogoMark } from './components/Logo';
import { Empty } from './components/ui';
import { Login, ChangePassword } from './pages/Login';
import { Workspace } from './pages/Workspace';
import { Approvals } from './pages/Approvals';
import { Finance } from './pages/Finance';
import { Purchases, PurchaseDetail } from './pages/Purchases';
import { AccountingHome, FinancialReports, Ledger } from './pages/Accounting';
import { Bank, Voucher } from './pages/Bank';
import { BatchDetail, MarketDetail, Sales, SettlementStatement } from './pages/Sales';
import { Payroll, PayrollRunDetail } from './pages/Payroll';
import { Assets } from './pages/Assets';
import { Payables, Periods } from './pages/Periods';
import { FarmerDebtDetail, FarmerDebts } from './pages/FarmerDebts';
import { GroupDetail, Groups } from './pages/Groups';
import { Kuni, KuniBatch } from './pages/Kuni';
import { Members, MemberNew } from './pages/Members';
import { MemberDetail } from './pages/MemberDetail';
import { Estimates } from './pages/Estimates';
import { Inputs } from './pages/Inputs';
import { InputIssues, InputIssueNew, InputIssueDetail } from './pages/InputIssues';
import { Balances, Users, Organizations, Audit } from './pages/Admin';
import { OwnerLayout, OWNER_NAV } from './owner/OwnerLayout';
import { OwnerDashboard } from './owner/Dashboard';
import { OwnerAmcos, OwnerAmcosDetail } from './owner/Amcos';
import { OwnerSubscriptions } from './owner/Subscriptions';
import { OwnerFinance } from './owner/Finance';
import { OwnerStaff } from './owner/Staff';
import { OwnerSystem } from './owner/System';
import { OwnerComms } from './owner/Comms';
import { OwnerSecurity } from './owner/Security';
import { OwnerBackup } from './owner/Backup';
import { OwnerBusiness } from './owner/Business';
import { OwnerSettings } from './owner/Settings';
import type { AmcosPermission, Permission } from './lib/auth';

function Splash() {
  return <div className="center" style={{ minHeight: '100%', background: 'var(--forest)' }}><LogoMark size={120} animate /></div>;
}

function Protected({ children, roles, area = 'amcos' }: { children: ReactNode; roles?: Role[]; area?: 'amcos' | 'owner' }) {
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
  // Wafanyakazi wa jukwaa hawaingii upande wa vyama; watumiaji wa vyama hawaingii Owner Panel.
  if (area === 'amcos' && isStaff(user.role)) return <Navigate to="/owner" replace />;
  if (area === 'owner' && !isPlatform(user.role)) return <Navigate to="/" replace />;
  if (roles && !can(...roles)) return <Empty>Huna ruhusa ya kuona ukurasa huu.</Empty>;
  return <>{children}</>;
}

function Perm({ p, children }: { p: Permission; children: ReactNode }) {
  const { has } = useAuth();
  return has(p) ? <>{children}</> : <Empty>Huna ruhusa ya sehemu hii. Wasiliana na Owner.</Empty>;
}

function OwnerHome() {
  const { has } = useAuth();
  if (has('platform.dashboard')) return <OwnerDashboard />;
  const first = OWNER_NAV.find((n) => n.to !== '/owner' && (!n.perm || has(n.perm)));
  return <Navigate to={first?.to ?? '/owner/settings'} replace />;
}

/** Ukurasa wa chama unaohitaji ruhusa ya cheo (backend inakagua tena kila ombi). */
function Need({ p, children }: { p: AmcosPermission[]; children: ReactNode }) {
  const { may } = useAuth();
  return may(...p) ? <>{children}</> : <Empty>Cheo chako hakiruhusiwi kuona ukurasa huu.</Empty>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user && !user.mustChangePassword) return <Navigate to={homeFor(user)} replace />;
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
          <Route path="/owner" element={<Protected area="owner"><OwnerLayout /></Protected>}>
            <Route index element={<OwnerHome />} />
            <Route path="amcos" element={<Perm p="amcos.read"><OwnerAmcos /></Perm>} />
            <Route path="amcos/:id" element={<Perm p="amcos.read"><OwnerAmcosDetail /></Perm>} />
            <Route path="subscriptions" element={<Perm p="subscriptions.read"><OwnerSubscriptions /></Perm>} />
            <Route path="finance" element={<Perm p="finance.read"><OwnerFinance /></Perm>} />
            <Route path="staff" element={<Perm p="staff.manage"><OwnerStaff /></Perm>} />
            <Route path="system" element={<Perm p="system.read"><OwnerSystem /></Perm>} />
            <Route path="comms" element={<Perm p="comms.read"><OwnerComms /></Perm>} />
            <Route path="security" element={<Perm p="security.read"><OwnerSecurity /></Perm>} />
            <Route path="backup" element={<Perm p="backup.read"><OwnerBackup /></Perm>} />
            <Route path="business" element={<Perm p="business.read"><OwnerBusiness /></Perm>} />
            <Route path="settings" element={<OwnerSettings />} />
            <Route path="*" element={<Empty>Ukurasa haupo.</Empty>} />
          </Route>
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Workspace />} />
            <Route path="approvals" element={<Need p={['approvals.read']}><Approvals /></Need>} />
            <Route path="finance" element={<Need p={['finance.read']}><Finance /></Need>} />
            <Route path="accounting" element={<Need p={['accounting.read']}><AccountingHome /></Need>} />
            <Route path="accounting/reports" element={<Need p={['accounting.read']}><FinancialReports /></Need>} />
            <Route path="ledger" element={<Need p={['accounting.read']}><Ledger /></Need>} />
            <Route path="bank" element={<Need p={['accounting.read']}><Bank /></Need>} />
            <Route path="vouchers/:id" element={<Need p={['finance.read']}><Voucher /></Need>} />
            <Route path="sales" element={<Need p={['sales.read']}><Sales /></Need>} />
            <Route path="sales/markets/:id" element={<Need p={['sales.read']}><MarketDetail /></Need>} />
            <Route path="sales/batches/:id" element={<Need p={['sales.read']}><BatchDetail /></Need>} />
            <Route path="sales/settlements/:id" element={<Need p={['sales.read']}><SettlementStatement /></Need>} />
            <Route path="payroll" element={<Need p={['payroll.read']}><Payroll /></Need>} />
            <Route path="payroll/runs/:id" element={<Need p={['payroll.read']}><PayrollRunDetail /></Need>} />
            <Route path="accounting/periods" element={<Need p={['accounting.read']}><Periods /></Need>} />
            <Route path="groups" element={<Need p={['members.read']}><Groups /></Need>} />
            <Route path="groups/:id" element={<Need p={['members.read', 'finance.read']}><GroupDetail /></Need>} />
            <Route path="kuni" element={<Need p={['finance.read']}><Kuni /></Need>} />
            <Route path="kuni/batches/:id" element={<Need p={['finance.read']}><KuniBatch /></Need>} />
            <Route path="farmer-debts" element={<Need p={['finance.read']}><FarmerDebts /></Need>} />
            <Route path="farmer-debts/:id" element={<Need p={['finance.read']}><FarmerDebtDetail /></Need>} />
            <Route path="payables" element={<Need p={['accounting.read']}><Payables /></Need>} />
            <Route path="fixed-assets" element={<Need p={['accounting.read']}><Assets /></Need>} />
            <Route path="purchases" element={<Need p={['stock.read', 'finance.read']}><Purchases /></Need>} />
            <Route path="purchases/:id" element={<Need p={['stock.read', 'finance.read']}><PurchaseDetail /></Need>} />
            <Route path="members" element={<Members />} />
            <Route path="members/new" element={<Need p={['members.write']}><MemberNew /></Need>} />
            <Route path="members/:id" element={<MemberDetail />} />
            <Route path="estimates" element={<Estimates />} />
            <Route path="inputs" element={<Inputs />} />
            <Route path="input-issues" element={<InputIssues />} />
            <Route path="input-issues/new" element={<Need p={['issues.request']}><InputIssueNew /></Need>} />
            <Route path="input-issues/:id" element={<InputIssueDetail />} />
            <Route path="balances" element={<Need p={['ledger.read']}><Balances /></Need>} />
            <Route path="users" element={<Protected roles={['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN']}><Users /></Protected>} />
            <Route path="organizations" element={<Protected roles={ROLE_GROUPS.ORGS}><Organizations /></Protected>} />
            <Route path="audit" element={<Need p={['audit.read']}><Audit /></Need>} />
            <Route path="*" element={<Empty>Ukurasa haupo.</Empty>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
