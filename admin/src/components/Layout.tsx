import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, ROLE_GROUPS, type AmcosPermission, type Role } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { NavIndicator, useNavIndicator } from './NavIndicator';
import { api, getSelectedAmcos, setSelectedAmcos, type Paged } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { LogoMark, Wordmark } from './Logo';
import { Button } from './ui';
import { AnnouncementBar, MaintenanceOverlay, SystemBanner } from './Notices';

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
      { to: '/estimates', label: 'Makisio', icon: I.estimate, perm: ['members.read'] },
      { to: '/balances', label: 'Madeni na Salio', icon: I.money, perm: ['ledger.read'] },
    ],
  },
  {
    section: 'Stoo',
    items: [
      { to: '/inputs', label: 'Bidhaa na Stoo', icon: I.inputs, perm: ['stock.read'] },
      { to: '/input-issues', label: 'Ugawaji wa Pembejeo', icon: I.issue, perm: ['stock.read'] },
      { to: '/purchases', label: 'Manunuzi na Wazabuni', icon: I.cart, perm: ['purchases.request', 'purchases.receive', 'finance.read'] },
    ],
  },
  {
    section: 'Fedha',
    items: [{ to: '/finance', label: 'Fedha za Chama', icon: I.wallet, perm: ['finance.read'] }],
  },
  {
    section: 'Usimamizi',
    items: [
      { to: '/users', label: 'Watumishi', icon: I.users, roles: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] },
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
  if (!user) return null;
  const multi = !user.amcosId;

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Menyu kuu">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={42} />
          <div>
            <Wordmark size={24} />
            <div style={{ fontSize: 11, color: '#8FB3A1', marginTop: 4, letterSpacing: '.08em' }}>VYAMA VYA MSINGI</div>
          </div>
        </div>
        <nav className="nav nav-animated" ref={navRef}>
          <NavIndicator box={indicator} />
          {(() => { let n = 0; return NAV.map((g, i) => {
            const items = g.items.filter((it) => (!it.roles || can(...it.roles)) && (!it.perm || may(...it.perm)));
            if (!items.length) return null;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {g.section && <div className="nav-section">{g.section}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/'} style={{ animationDelay: `${60 + n++ * 35}ms` }}>
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
          <Outlet />
        </main>
      </div>
      <MaintenanceOverlay />
    </div>
  );
}
