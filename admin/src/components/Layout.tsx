import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, ROLE_GROUPS, type AmcosPermission, type Role } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { NavIndicator, useNavIndicator } from './NavIndicator';
import { api, getSelectedAmcos, setSelectedAmcos, type Paged } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { LogoMark, Wordmark } from './Logo';
import { Button } from './ui';
import { AnnouncementBar, MaintenanceOverlay, SystemBanner } from './Notices';
import type { BillingData } from '../pages/Billing';
import { date, tsh } from '../lib/format';

const I = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  members: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.5.2 4.4 1.9 5 5.4" /></>,
  estimate: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  inputs: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  issue: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9v.01M18 15v.01" /></>,
  users: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" /></>,
  org: <><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></>,
  audit: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.5-4.5M8 11h6M11 8v6" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  check: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8L21 7H6.2" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16" cy="13.5" r="1.3" /></>,
  gauge: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" /><circle cx="12" cy="18" r="1.4" /></>,
  leaf: <><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z" /><path d="M5 19l8-8" /></>,
  book: <><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z" /></>,
  bank: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" /></>,
  payroll: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.5 16.5c.6-1.8 2-2.6 3.5-2.6s2.9.8 3.5 2.6M15 10h3M15 13.5h3" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" /></>,
  report: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /><path d="M9 17v-3M12 17v-6M15 17v-4" /></>,
};

function Icon({ d }: { d: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
}

// Menu inaonyesha moduli za cheo husika tu. Usalama halisi uko kwenye backend (kila endpoint inakagua ruhusa).
interface NavItem { to: string; label: string; icon: ReactNode; roles?: Role[]; perm?: AmcosPermission[] }
const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/', label: 'Dashibodi', icon: I.home },
    { to: '/approvals', label: 'Idhini', icon: I.check, perm: ['approvals.read'] },
  ] },
  {
    section: 'Wakulima',
    items: [
      { to: '/members', label: 'Wakulima (wanachama)', icon: I.members, perm: ['members.read'] },
      { to: '/groups', label: 'Vikundi vya wakulima', icon: I.org, perm: ['members.read'] },
      { to: '/estimates', label: 'Makisio', icon: I.estimate, perm: ['members.read'] },
      { to: '/balances', label: 'Madeni na Salio', icon: I.money, perm: ['ledger.read'] },
    ],
  },
  {
    section: 'Stoo',
    items: [
      { to: '/inputs', label: 'Bidhaa na Stoo', icon: I.inputs, perm: ['stock.read'] },
      { to: '/input-issues', label: 'Ugawaji wa Pembejeo', icon: I.issue, perm: ['stock.read'] },
      { to: '/purchases', label: 'Manunuzi na Wazabuni', icon: I.cart, perm: ['purchases.request', 'purchases.receive', 'approvals.decide'] },
    ],
  },
  {
    // Mhasibu: uhasibu kamili · Meneja: ripoti tu (anaidhinisha kupitia Idhini)
    section: 'Fedha na Uhasibu',
    items: [
      { to: '/accounting', label: 'Dashibodi ya fedha', icon: I.gauge, perm: ['accounting.manage'] },
      { to: '/finance', label: 'Miamala na vocha', icon: I.wallet, perm: ['finance.record'] },
      { to: '/sales', label: 'Mauzo ya tumbaku', icon: I.leaf, perm: ['sales.manage'] },
      { to: '/kuni', label: 'Pesa ya kuni', icon: I.money, perm: ['finance.record'] },
      { to: '/farmer-debts', label: 'Madeni ya wakulima', icon: I.members, perm: ['accounting.manage'] },
      { to: '/ledger', label: 'Daftari kuu', icon: I.book, perm: ['accounting.manage'] },
      { to: '/bank', label: 'Benki na usuluhishi', icon: I.bank, perm: ['accounting.manage'] },
      { to: '/payables', label: 'Madeni ya chama', icon: I.money, perm: ['accounting.manage'] },
      { to: '/payroll', label: 'Mishahara', icon: I.payroll, perm: ['payroll.manage'] },
      { to: '/fixed-assets', label: 'Mali za chama', icon: I.building, perm: ['accounting.manage'] },
      { to: '/accounting/periods', label: 'Salio la kuanzia na kufunga', icon: I.check, perm: ['accounting.manage'] },
      { to: '/accounting/reports', label: 'Ripoti za fedha', icon: I.report, perm: ['accounting.read'] },
    ],
  },
  {
    section: 'Usimamizi',
    items: [
      { to: '/users', label: 'Watumishi', icon: I.users, roles: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] },
      { to: '/billing', label: 'Ada ya CoopLink', icon: I.wallet, roles: ['AMCOS_ADMIN', 'ACCOUNTANT'] },
      { to: '/organizations', label: 'Vyama na Misimu', icon: I.org, roles: ROLE_GROUPS.ORGS },
      { to: '/audit', label: 'Kumbukumbu (Audit)', icon: I.audit, perm: ['audit.read'] },
    ],
  },
];

/** Kwa Super/Union admin: chagua chama unachofanyia kazi. */
function AmcosSwitcher() {
  const [list, setList] = useState<{ id: string; name: string; code: string }[]>([]);
  const [value, setValue] = useState(getSelectedAmcos() ?? '');
  useEffect(() => {
    api<Paged<{ id: string; name: string; code: string }>>('/amcos', { query: { pageSize: 100 } }).then((r) => setList(r.data)).catch(() => {});
  }, []);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="muted" style={{ fontSize: 13 }}>Chama:</span>
      <select className="select" style={{ minWidth: 220 }} value={value}
        onChange={(e) => { setSelectedAmcos(e.target.value || null); setValue(e.target.value); window.location.reload(); }}>
        <option value="">Vyama vyote (kusoma tu)</option>
        {list.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
      </select>
    </label>
  );
}

export function Layout() {
  const { user, amcos, logout, can, may } = useAuth();
  const decider = may('approvals.decide');
  const navRef = useRef<HTMLElement>(null);
  const indicator = useNavIndicator(navRef);
  const pending = useFetch<{ total: number }>(user?.amcosId && may('approvals.read') ? '/approvals/summary' : null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  // Ada ya CoopLink: Mhasibu analipa (Meneja kama hakuna Mhasibu); Meneja anaona hali yake.
  // Chama kikifungwa, mlipaji anabaki kwenye ukurasa wa malipo tu; wengine wote wanaona skrini ya kufungwa.
  const feeRole = user?.role === 'AMCOS_ADMIN' || user?.role === 'ACCOUNTANT';
  const fees = useFetch<BillingData>(feeRole ? '/billing' : null);
  const isPayer = feeRole && !!fees.data?.payer?.isMe;
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  useEffect(() => {
    // Ujumbe mpya wa kufungwa -> hali ya ada isomwe upya mara moja (si kila ombi, ili kusiwe na mzunguko)
    const on = (e: Event) => { const msg = (e as CustomEvent<string>).detail; setLockMsg((prev) => { if (prev !== msg) fees.reload(); return msg; }); };
    window.addEventListener('cl:fees-locked', on);
    return () => window.removeEventListener('cl:fees-locked', on);
  }, [fees.reload]);
  useEffect(() => { if (feeRole && loc.pathname.startsWith('/billing')) fees.reload(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  const multi = !user.amcosId;
  const feeLocked = isPayer ? !!fees.data?.lock : !!lockMsg || (feeRole && !!fees.error && /imefungwa/i.test(fees.error));
  if (isPayer && feeLocked && !loc.pathname.startsWith('/billing')) return <Navigate to="/billing" replace />;
  const due = feeRole && !feeLocked ? fees.data?.fees.find((f) => (f.status === 'UNPAID' || f.status === 'PARTIAL') && (Date.parse(f.dueDate) - Date.now()) / 86_400_000 <= 30) : undefined;

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Menyu kuu">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={42} />
          <div>
            <Wordmark size={24} animate />
            <div style={{ fontSize: 11, color: '#8FB3A1', marginTop: 4, letterSpacing: '.08em' }}>VYAMA VYA MSINGI</div>
          </div>
        </div>
        <nav className="nav nav-animated" ref={navRef}>
          <NavIndicator box={indicator} />
          {(() => { let n = 0; return NAV.map((g, i) => {
            const items = g.items.filter((it) => (!it.roles || can(...it.roles)) && (!it.perm || may(...it.perm)) && (!feeLocked || it.to === '/billing'));
            if (!items.length) return null;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {g.section && <div className="nav-section">{g.section}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/' || it.to === '/accounting'} style={{ animationDelay: `${60 + n++ * 35}ms` }}>
                    <span className="nav-icon"><Icon d={it.icon} /></span>{it.to === '/approvals' && !decider ? 'Maombi yangu' : it.label}
                    {it.to === '/approvals' && decider && !!pending.data?.total && <span className="nav-count">{pending.data.total}</span>}
                  </NavLink>
                ))}
              </div>
            );
          }); })()}
        </nav>
        <div className="sidebar-foot">CoopLink v{__APP_VERSION__}<br />Uwazi · Haki · Maendeleo</div>
      </aside>
      {open && <button type="button" className="nav-scrim" aria-label="Funga menyu" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="sm" className="menu-btn" onClick={() => setOpen(true)} aria-label="Fungua menyu"><Icon d={I.menu} /></Button>
          {multi ? <AmcosSwitcher /> : <strong style={{ fontFamily: 'var(--font-head)', color: 'var(--forest)' }}>{amcos?.name}</strong>}
          <div className="grow" />
          {user.role === 'SUPER_ADMIN' && <Link className="btn btn-primary btn-sm hide-sm" to="/owner">Owner Panel</Link>}
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
            <span className="who">{user.fullName}<small>{ROLE_LABEL[user.role]}{amcos && user.amcosId ? ` · ${amcos.code}` : ''}</small></span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>Toka</Button>
        </header>
        <SystemBanner />
        <main className="content">
          {user.amcosId && <AnnouncementBar />}
          {due && !loc.pathname.startsWith('/billing') && (
            <div className="fee-banner">
              <span><strong>{due.label}</strong>: salio {tsh(due.outstanding)}, mwisho wa kulipa {date(due.dueDate)}.{!isPayer && fees.data?.payer ? ` ${fees.data.payer.label} ndiye analipa.` : ''} Ada isipolipwa kufikia tarehe hiyo, chama kitafungwa.</span>
              <Link className="btn btn-primary btn-sm" to="/billing">{isPayer ? 'Lipa sasa' : 'Angalia ada'}</Link>
            </div>
          )}
          {!isPayer && feeLocked ? (
            <section className="card lock-screen">
              <h2>Chama kimefungwa kwa muda</h2>
              <p>{lockMsg ?? fees.error}</p>
              <Button onClick={logout}>Toka</Button>
            </section>
          ) : <Outlet />}
        </main>
      </div>
      <MaintenanceOverlay />
    </div>
  );
}
