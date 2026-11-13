import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { IdleLock } from './components/IdleLock';
import { markSiteSeen, siteSeen } from './lib/session';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, ROLE_GROUPS, homeFor, isPlatform, isStaff, type Role } from './lib/auth';
import { Layout } from './components/Layout';
import { LogoMark } from './components/Logo';
import { Empty, Loading } from './components/ui';
import { Login, ChangePassword } from './pages/Login';
import { OwnerLayout, OWNER_NAV } from './owner/OwnerLayout';
import { PrefsProvider, tr } from './lib/prefs';
import { PAGE_LOADERS } from './lib/prefetch';
import type { AmcosPermission, Permission } from './lib/auth';


// ---------------------------------------------------------------------
//  Kurasa zinapakuliwa zinapohitajika (code splitting): ukurasa wa kwanza unafunguka haraka.
//  Baada ya kuingia, kurasa nyingine zinapakuliwa kimya kimya mtandao ukiwa huru (prefetch),
//  kwa hiyo kubadili ukurasa kunakuwa papo hapo.
// ---------------------------------------------------------------------
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<Record<string, unknown>> })));
}
const load_Workspace_pages = () => import('./pages/Workspace');
const Workspace = lazyPage(load_Workspace_pages, 'Workspace');
PAGE_LOADERS.push(load_Workspace_pages);
const load_Approvals_pages = () => import('./pages/Approvals');
const Approvals = lazyPage(load_Approvals_pages, 'Approvals');
PAGE_LOADERS.push(load_Approvals_pages);
const load_Finance_pages = () => import('./pages/Finance');
const Finance = lazyPage(load_Finance_pages, 'Finance');
PAGE_LOADERS.push(load_Finance_pages);
const load_Purchases_pages = () => import('./pages/Purchases');
const Purchases = lazyPage(load_Purchases_pages, 'Purchases');
const PurchaseDetail = lazyPage(load_Purchases_pages, 'PurchaseDetail');
PAGE_LOADERS.push(load_Purchases_pages);
const load_Accounting_pages = () => import('./pages/Accounting');
const AccountingHome = lazyPage(load_Accounting_pages, 'AccountingHome');
const FinancialReports = lazyPage(load_Accounting_pages, 'FinancialReports');
const Ledger = lazyPage(load_Accounting_pages, 'Ledger');
PAGE_LOADERS.push(load_Accounting_pages);
const load_Bank_pages = () => import('./pages/Bank');
const Bank = lazyPage(load_Bank_pages, 'Bank');
const Voucher = lazyPage(load_Bank_pages, 'Voucher');
PAGE_LOADERS.push(load_Bank_pages);
const load_Sales_pages = () => import('./pages/Sales');
const BatchDetail = lazyPage(load_Sales_pages, 'BatchDetail');
const MarketDetail = lazyPage(load_Sales_pages, 'MarketDetail');
const Sales = lazyPage(load_Sales_pages, 'Sales');
const SettlementStatement = lazyPage(load_Sales_pages, 'SettlementStatement');
PAGE_LOADERS.push(load_Sales_pages);
const load_Payroll_pages = () => import('./pages/Payroll');
const Payroll = lazyPage(load_Payroll_pages, 'Payroll');
const PayrollRunDetail = lazyPage(load_Payroll_pages, 'PayrollRunDetail');
PAGE_LOADERS.push(load_Payroll_pages);
const load_Assets_pages = () => import('./pages/Assets');
const Assets = lazyPage(load_Assets_pages, 'Assets');
PAGE_LOADERS.push(load_Assets_pages);
const load_Periods_pages = () => import('./pages/Periods');
const Payables = lazyPage(load_Periods_pages, 'Payables');
const Periods = lazyPage(load_Periods_pages, 'Periods');
PAGE_LOADERS.push(load_Periods_pages);
const load_FarmerDebts_pages = () => import('./pages/FarmerDebts');
const FarmerDebtDetail = lazyPage(load_FarmerDebts_pages, 'FarmerDebtDetail');
const FarmerDebts = lazyPage(load_FarmerDebts_pages, 'FarmerDebts');
PAGE_LOADERS.push(load_FarmerDebts_pages);
const load_Website = () => import('./pages/Website');
const Website = lazyPage(load_Website, 'Website');
const load_SmsBroadcasts_pages = () => import('./pages/SmsBroadcasts');
const SmsBroadcasts = lazyPage(load_SmsBroadcasts_pages, 'SmsBroadcasts');
PAGE_LOADERS.push(load_SmsBroadcasts_pages);
const load_Groups_pages = () => import('./pages/Groups');
const GroupDetail = lazyPage(load_Groups_pages, 'GroupDetail');
const Groups = lazyPage(load_Groups_pages, 'Groups');
PAGE_LOADERS.push(load_Groups_pages);
const load_Kuni_pages = () => import('./pages/Kuni');
const Kuni = lazyPage(load_Kuni_pages, 'Kuni');
const KuniBatch = lazyPage(load_Kuni_pages, 'KuniBatch');
PAGE_LOADERS.push(load_Kuni_pages);
const load_Billing_pages = () => import('./pages/Billing');
const Billing = lazyPage(load_Billing_pages, 'Billing');
const BillingReceipt = lazyPage(load_Billing_pages, 'BillingReceipt');
PAGE_LOADERS.push(load_Billing_pages);
const load_Members_pages = () => import('./pages/Members');
const Members = lazyPage(load_Members_pages, 'Members');
const MemberNew = lazyPage(load_Members_pages, 'MemberNew');
PAGE_LOADERS.push(load_Members_pages);
const load_MemberDetail_pages = () => import('./pages/MemberDetail');
const MemberDetail = lazyPage(load_MemberDetail_pages, 'MemberDetail');
PAGE_LOADERS.push(load_MemberDetail_pages);
const load_Estimates_pages = () => import('./pages/Estimates');
const Estimates = lazyPage(load_Estimates_pages, 'Estimates');
const EstimateForm = lazyPage(load_Estimates_pages, 'EstimateForm');
PAGE_LOADERS.push(load_Estimates_pages);
const load_Inputs_pages = () => import('./pages/Inputs');
const Inputs = lazyPage(load_Inputs_pages, 'Inputs');
PAGE_LOADERS.push(load_Inputs_pages);
const load_InputIssues_pages = () => import('./pages/InputIssues');
const InputIssues = lazyPage(load_InputIssues_pages, 'InputIssues');
const InputIssueNew = lazyPage(load_InputIssues_pages, 'InputIssueNew');
const InputIssueDetail = lazyPage(load_InputIssues_pages, 'InputIssueDetail');
PAGE_LOADERS.push(load_InputIssues_pages);
const load_Admin_pages = () => import('./pages/Admin');
const Balances = lazyPage(load_Admin_pages, 'Balances');
const Users = lazyPage(load_Admin_pages, 'Users');
const Organizations = lazyPage(load_Admin_pages, 'Organizations');
const Audit = lazyPage(load_Admin_pages, 'Audit');
PAGE_LOADERS.push(load_Admin_pages);
const load_Dashboard_owner = () => import('./owner/Dashboard');
const OwnerDashboard = lazyPage(load_Dashboard_owner, 'OwnerDashboard');
PAGE_LOADERS.push(load_Dashboard_owner);
const load_Amcos_owner = () => import('./owner/Amcos');
const OwnerAmcos = lazyPage(load_Amcos_owner, 'OwnerAmcos');
const OwnerAmcosDetail = lazyPage(load_Amcos_owner, 'OwnerAmcosDetail');
PAGE_LOADERS.push(load_Amcos_owner);
const load_Subscriptions_owner = () => import('./owner/Subscriptions');
const OwnerSubscriptions = lazyPage(load_Subscriptions_owner, 'OwnerSubscriptions');
PAGE_LOADERS.push(load_Subscriptions_owner);
const load_Finance_owner = () => import('./owner/Finance');
const OwnerFinance = lazyPage(load_Finance_owner, 'OwnerFinance');
PAGE_LOADERS.push(load_Finance_owner);
const load_Staff_owner = () => import('./owner/Staff');
const OwnerStaff = lazyPage(load_Staff_owner, 'OwnerStaff');
PAGE_LOADERS.push(load_Staff_owner);
const load_System_owner = () => import('./owner/System');
const OwnerSystem = lazyPage(load_System_owner, 'OwnerSystem');
PAGE_LOADERS.push(load_System_owner);
const load_SmsCenter_owner = () => import('./owner/SmsCenter');
const OwnerSmsCenter = lazyPage(load_SmsCenter_owner, 'OwnerSmsCenter');
PAGE_LOADERS.push(load_SmsCenter_owner);
const load_Comms_owner = () => import('./owner/Comms');
const OwnerComms = lazyPage(load_Comms_owner, 'OwnerComms');
PAGE_LOADERS.push(load_Comms_owner);
const load_Security_owner = () => import('./owner/Security');
const OwnerSecurity = lazyPage(load_Security_owner, 'OwnerSecurity');
PAGE_LOADERS.push(load_Security_owner);
const load_Backup_owner = () => import('./owner/Backup');
const OwnerBackup = lazyPage(load_Backup_owner, 'OwnerBackup');
PAGE_LOADERS.push(load_Backup_owner);
const load_Business_owner = () => import('./owner/Business');
const OwnerBusiness = lazyPage(load_Business_owner, 'OwnerBusiness');
PAGE_LOADERS.push(load_Business_owner);
const load_Leads_owner = () => import('./owner/Leads');
const OwnerLeads = lazyPage(load_Leads_owner, 'OwnerLeads');
PAGE_LOADERS.push(load_Leads_owner);
const load_Customer_owner = () => import('./owner/Customer');
const OwnerSuccess = lazyPage(load_Customer_owner, 'OwnerSuccess');
PAGE_LOADERS.push(load_Customer_owner);
const load_Settings_owner = () => import('./owner/Settings');
const OwnerSettings = lazyPage(load_Settings_owner, 'OwnerSettings');
PAGE_LOADERS.push(load_Settings_owner);
const load_Settings_pages = () => import('./pages/Settings');
const Settings = lazyPage(load_Settings_pages, 'Settings');
PAGE_LOADERS.push(load_Settings_pages);
const load_MemberImport_pages = () => import('./pages/MemberImport');
const MemberImport = lazyPage(load_MemberImport_pages, 'MemberImport');
PAGE_LOADERS.push(load_MemberImport_pages);
const load_Legal_pages = () => import('./pages/Legal');
const FarmerPortal = lazyPage(() => import('./pages/FarmerPortal'), 'FarmerPortal');
const PrivacyPage = lazyPage(load_Legal_pages, 'PrivacyPage');
const TermsGate = lazyPage(load_Legal_pages, 'TermsGate');
const TermsPage = lazyPage(load_Legal_pages, 'TermsPage');
PAGE_LOADERS.push(load_Legal_pages);
const load_Support_pages = () => import('./pages/Support');
const Support = lazyPage(load_Support_pages, 'Support');
const SupportDetail = lazyPage(load_Support_pages, 'SupportDetail');
const SupportNew = lazyPage(load_Support_pages, 'SupportNew');
PAGE_LOADERS.push(load_Support_pages);
const load_Support_owner = () => import('./owner/Support');
const OwnerSupport = lazyPage(load_Support_owner, 'OwnerSupport');
const OwnerSupportDetail = lazyPage(load_Support_owner, 'OwnerSupportDetail');
PAGE_LOADERS.push(load_Support_owner);

function Splash() {
  return (
    <div className="center cl-loading cl-splash" role="status" aria-label={tr('Inapakia')} style={{ minHeight: '100%', background: 'var(--forest)' }}>
      <LogoMark size={120} spin />
      <div className="cl-loading-txt">{tr('Inapakia')}<span className="cl-dots" aria-hidden="true" /></div>
    </div>
  );
}

function Protected({ children, roles, area = 'amcos' }: { children: ReactNode; roles?: Role[]; area?: 'amcos' | 'owner' }) {
  const { user, loading, can } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    const go = () => nav('/change-password');
    window.addEventListener('cl:password-change', go);
    return () => window.removeEventListener('cl:password-change', go);
  }, [nav]);
  const loc = useLocation();
  const [, bump] = useState(0);
  if (loading) return <Splash />;
  // Mgeni kwenye anwani kuu anaona tovuti ya COOPLINK; kurasa nyingine zinampeleka kuingia
  if (!user) return area === 'amcos' && loc.pathname === '/' ? <Suspense fallback={<Splash />}><Website /></Suspense> : <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  // Kila mtu anapofungua mfumo (kikao kipya cha kivinjari) anaona tovuti ya COOPLINK kwanza, kisha "Endelea kwenye mfumo"
  if (area === 'amcos' && loc.pathname === '/' && !siteSeen()) {
    return <Suspense fallback={<Splash />}><Website signedIn onEnter={() => { markSiteSeen(); bump((x) => x + 1); nav(homeFor(user), { replace: true }); window.scrollTo(0, 0); }} /></Suspense>;
  }
  // Masharti ya Huduma na Sera ya Faragha: kila mtumiaji anakubali toleo la sasa kabla ya kuendelea
  if (user.termsRequired) return <Suspense fallback={<Splash />}><TermsGate /></Suspense>;
  // Wafanyakazi wa jukwaa hawaingii upande wa vyama; watumiaji wa vyama hawaingii Owner Panel.
  if (area === 'amcos' && isStaff(user.role)) return <Navigate to="/owner" replace />;
  if (area === 'owner' && !isPlatform(user.role)) return <Navigate to="/" replace />;
  if (roles && !can(...roles)) return <Empty>Huna ruhusa ya kuona ukurasa huu.</Empty>;
  return <IdleLock>{children}</IdleLock>;
}

function Perm({ p, children }: { p: Permission; children: ReactNode }) {
  const { has } = useAuth();
  return has(p) ? <>{children}</> : <Empty>Huna ruhusa ya sehemu hii. Wasiliana na Owner.</Empty>;
}

function OwnerHome() {
  const { has, user } = useAuth();
  // Kila mfanyakazi anaanzia kwenye kazi zake: Fedha -> Finance, Huduma kwa Wateja na Masoko -> Customer Success
  if (user?.role !== 'SUPER_ADMIN') {
    if (has('finance.read') && !has('leads.read')) return <Navigate to="/owner/finance" replace />;
    if (has('leads.read')) return <Navigate to="/owner/success" replace />;
  }
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
    <PrefsProvider>
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/mkulima" element={<FarmerPortal />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/change-password" element={<NeedsUser><ChangePassword /></NeedsUser>} />
          <Route path="/owner" element={<Protected area="owner"><OwnerLayout /></Protected>}>
            <Route index element={<OwnerHome />} />
            <Route path="amcos" element={<Perm p="amcos.read"><OwnerAmcos /></Perm>} />
            <Route path="amcos/:id" element={<Perm p="amcos.read"><OwnerAmcosDetail /></Perm>} />
            <Route path="subscriptions" element={<Perm p="subscriptions.read"><OwnerSubscriptions /></Perm>} />
            <Route path="fees/receipts/:id" element={<Perm p="subscriptions.read"><BillingReceipt base="/owner/fees" /></Perm>} />
            <Route path="finance" element={<Perm p="finance.read"><OwnerFinance /></Perm>} />
            <Route path="staff" element={<Perm p="staff.manage"><OwnerStaff /></Perm>} />
            <Route path="system" element={<Perm p="system.read"><OwnerSystem /></Perm>} />
            <Route path="sms" element={<Perm p="system.read"><OwnerSmsCenter /></Perm>} />
            <Route path="comms" element={<Perm p="comms.read"><OwnerComms /></Perm>} />
            <Route path="security" element={<Perm p="security.read"><OwnerSecurity /></Perm>} />
            <Route path="backup" element={<Perm p="backup.read"><OwnerBackup /></Perm>} />
            <Route path="business" element={<Perm p="business.read"><OwnerBusiness /></Perm>} />
            <Route path="support" element={<Perm p="support.read"><OwnerSupport /></Perm>} />
            <Route path="leads" element={<Perm p="leads.read"><OwnerLeads /></Perm>} />
            <Route path="success" element={<Perm p="leads.read"><OwnerSuccess /></Perm>} />
            <Route path="support/:id" element={<Perm p="support.read"><OwnerSupportDetail /></Perm>} />
            <Route path="settings" element={<OwnerSettings />} />
            <Route path="*" element={<Empty>Ukurasa haupo.</Empty>} />
          </Route>
          <Route element={<Protected><Layout /></Protected>}>
            <Route index element={<Workspace />} />
            <Route path="approvals" element={<Need p={['approvals.read']}><Approvals /></Need>} />
            <Route path="support" element={<Support />} />
            <Route path="support/new" element={<SupportNew />} />
            <Route path="support/:id" element={<SupportDetail />} />
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
            <Route path="sms" element={<Need p={['members.approve']}><SmsBroadcasts /></Need>} />
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
            <Route path="members/import" element={<Need p={['members.approve']}><MemberImport /></Need>} />
            <Route path="members/:id" element={<MemberDetail />} />
            <Route path="estimates" element={<Estimates />} />
            <Route path="estimates/new" element={<Need p={['estimates.write']}><EstimateForm /></Need>} />
            <Route path="estimates/:id/edit" element={<Need p={['estimates.write']}><EstimateForm /></Need>} />
            <Route path="inputs" element={<Inputs />} />
            <Route path="input-issues" element={<InputIssues />} />
            <Route path="input-issues/new" element={<Need p={['issues.request']}><InputIssueNew /></Need>} />
            <Route path="input-issues/:id" element={<InputIssueDetail />} />
            <Route path="balances" element={<Need p={['ledger.read']}><Balances /></Need>} />
            <Route path="billing" element={<Protected roles={['AMCOS_ADMIN', 'ACCOUNTANT']}><Billing /></Protected>} />
            <Route path="billing/receipts/:id" element={<Protected roles={['AMCOS_ADMIN', 'ACCOUNTANT']}><BillingReceipt /></Protected>} />
            <Route path="users" element={<Protected roles={['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN']}><Users /></Protected>} />
            <Route path="organizations" element={<Protected roles={ROLE_GROUPS.ORGS}><Organizations /></Protected>} />
            <Route path="audit" element={<Need p={['audit.read']}><Audit /></Need>} />
            <Route path="settings" element={<Protected roles={['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK']}><Settings /></Protected>} />
            <Route path="*" element={<Empty>Ukurasa haupo.</Empty>} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </PrefsProvider>
  );
}
