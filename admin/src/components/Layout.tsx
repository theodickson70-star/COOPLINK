import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, ROLE_GROUPS, type Role } from '../lib/auth';
import { api, getSelectedAmcos, setSelectedAmcos, type Paged } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { LogoMark, Wordmark } from './Logo';
import { Button } from './ui';

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
};

function Icon({ d }: { d: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
}

interface NavItem { to: string; label: string; icon: ReactNode; roles?: Role[] }
const NAV: { section?: string; items: NavItem[] }[] = [
  { items: [{ to: '/', label: 'Dashibodi', icon: I.home }] },
  {
    section: 'Chama',
    items: [
      { to: '/members', label: 'Wanachama', icon: I.members },
      { to: '/estimates', label: 'Makisio', icon: I.estimate },
      { to: '/inputs', label: 'Pembejeo na Stoo', icon: I.inputs },
      { to: '/input-issues', label: 'Utoaji wa Pembejeo', icon: I.issue },
      { to: '/balances', label: 'Madeni na Salio', icon: I.money },
    ],
  },
  {
    section: 'Usimamizi',
    items: [
      { to: '/users', label: 'Watumiaji', icon: I.users, roles: ROLE_GROUPS.ADMINS },
      { to: '/organizations', label: 'Vyama na Misimu', icon: I.org, roles: ROLE_GROUPS.ORGS },
      { to: '/audit', label: 'Kumbukumbu (Audit)', icon: I.audit, roles: ROLE_GROUPS.AUDIT },
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
  const { user, amcos, logout, can } = useAuth();
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
        <nav className="nav">
          {NAV.map((g, i) => {
            const items = g.items.filter((it) => !it.roles || can(...it.roles));
            if (!items.length) return null;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {g.section && <div className="nav-section">{g.section}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/'}><Icon d={it.icon} />{it.label}</NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">CoopLink v{__APP_VERSION__}<br />Uwazi · Haki · Maendeleo</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="sm" className="menu-btn" onClick={() => setOpen(true)} aria-label="Fungua menyu"><Icon d={I.menu} /></Button>
          {multi ? <AmcosSwitcher /> : <strong style={{ fontFamily: 'var(--font-head)', color: 'var(--forest)' }}>{amcos?.name}</strong>}
          <div className="grow" />
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
            <span className="who">{user.fullName}<small>{ROLE_LABEL[user.role]}</small></span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>Toka</Button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
