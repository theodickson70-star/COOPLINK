import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Permission } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { PrefSwitches, useT } from '../lib/prefs';
import { LegalLinks } from '../components/LegalLinks';
import { prefetchPages } from '../lib/prefetch';
import { OWNER_ROLE_LABEL, ROLE_LABEL } from '../lib/format';
import { LogoMark, Wordmark } from '../components/Logo';
import { Button, Loading } from '../components/ui';
import { SystemBanner } from '../components/Notices';
import { NavIndicator, useNavIndicator } from '../components/NavIndicator';

const ic = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I = {
  dash: ic(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  amcos: ic(<><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></>),
  support: ic(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8" /><path d="M12 17v.01" /></>),
  subs: ic(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>),
  finance: ic(<><path d="M3 17l5-5 4 4 8-8" /><path d="M15 8h5v5" /></>),
  staff: ic(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M17 11l2 2 3-3" /></>),
  system: ic(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2" /></>),
  comms: ic(<><path d="M3 11l15-6v14L3 13z" /><path d="M7 13v4a2 2 0 0 0 4 0v-3" /></>),
  sms: ic(<><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>),
  security: ic(<><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  backup: ic(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  business: ic(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>),
  settings: ic(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  menu: ic(<path d="M3 6h18M3 12h18M3 18h18" />),
};

// Menyu ya Owner kwa makundi (bila namba)
export const OWNER_NAV: { to: string; label: string; sub: string; icon: ReactNode; perm?: Permission; group: string }[] = [
  { to: '/owner', label: 'Owner Dashboard', sub: 'Muhtasari wa biashara', icon: I.dash, perm: 'platform.dashboard', group: 'Muhtasari' },
  { to: '/owner/amcos', label: 'AMCOS Management', sub: 'Wateja (vyama)', icon: I.amcos, perm: 'amcos.read', group: 'Wateja' },
  { to: '/owner/support', label: 'Support Tickets', sub: 'Msaada kwa vyama', icon: I.support, perm: 'support.read', group: 'Wateja' },
  { to: '/owner/subscriptions', label: 'Subscriptions & Pricing', sub: 'Mipango na bei', icon: I.subs, perm: 'subscriptions.read', group: 'Wateja' },
  { to: '/owner/finance', label: 'Finance & Revenue', sub: 'Fedha za kampuni', icon: I.finance, perm: 'finance.read', group: 'Fedha na Biashara' },
  { to: '/owner/business', label: 'Business Center', sub: 'Malengo na ukuaji', icon: I.business, perm: 'business.read', group: 'Fedha na Biashara' },
  { to: '/owner/staff', label: 'Staff Management', sub: 'Wafanyakazi wa DUKALANGU', icon: I.staff, perm: 'staff.manage', group: 'Timu na Mawasiliano' },
  { to: '/owner/comms', label: 'Marketing & Communication', sub: 'Matangazo na SMS', icon: I.comms, perm: 'comms.read', group: 'Timu na Mawasiliano' },
  { to: '/owner/sms', label: 'SMS Center', sub: 'OTP, taarifa na gharama', icon: I.sms, perm: 'system.read', group: 'Timu na Mawasiliano' },
  { to: '/owner/system', label: 'System Control Center', sub: 'Hali ya mfumo', icon: I.system, perm: 'system.read', group: 'Mfumo na Usalama' },
  { to: '/owner/security', label: 'Security & Audit', sub: 'Usalama na kumbukumbu', icon: I.security, perm: 'security.read', group: 'Mfumo na Usalama' },
  { to: '/owner/backup', label: 'Backup & Database', sub: 'Hifadhi ya data', icon: I.backup, perm: 'backup.read', group: 'Mfumo na Usalama' },
  { to: '/owner/settings', label: 'Owner Settings', sub: 'Akaunti yangu', icon: I.settings, group: 'Akaunti' },
];

export function OwnerLayout() {
  const { user, logout, has } = useAuth();
  const t = useT();
  useEffect(() => { prefetchPages(); }, []);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  // Ukibadili ukurasa: kipengele kilichochaguliwa kionekane ndani ya menyu (menyu pekee inasogea, si ukurasa)
  const navPath = useLocation().pathname;
  useEffect(() => {
    const nav = navRef.current, a = nav?.querySelector('a.active') as HTMLElement | null;
    if (!nav || !a) return;
    if (a.offsetTop < nav.scrollTop + 8) nav.scrollTop = a.offsetTop - 8;
    else if (a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight - 8) nav.scrollTop = a.offsetTop + a.offsetHeight - nav.clientHeight + 8;
  }, [navPath]);
  const indicator = useNavIndicator(navRef);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  // Tiketi zinazosubiri jibu la timu (alama kwenye menyu)
  const support = useFetch<{ waiting: number; overdue: number }>(user && has('support.read') ? '/owner/support/summary' : null, { p: loc.pathname });
  // Tahadhari za mfumo zilizo wazi (alama kwenye System Control Center) — inaangaliwa tena kila dakika 2
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((x) => x + 1);
    const iv = window.setInterval(bump, 120_000);
    window.addEventListener('cl:alerts', bump);
    return () => { window.clearInterval(iv); window.removeEventListener('cl:alerts', bump); };
  }, []);
  const alerts = useFetch<{ open: number; critical: number }>(user && has('system.read') ? '/owner/system/alerts/summary' : null, { p: loc.pathname, tick });
  if (!user) return null;
  const isOwner = user.role === 'SUPER_ADMIN';
  const items = OWNER_NAV.filter((n) => !n.perm || has(n.perm));
  const groups = items.reduce<{ name: string; items: typeof items }[]>((acc, it) => {
    const g = acc.find((x) => x.name === it.group);
    if (g) g.items.push(it); else acc.push({ name: it.group, items: [it] });
    return acc;
  }, []);

  return (
    <div className="shell owner">
      <aside className={`sidebar owner-sidebar ${open ? 'open' : ''}`} aria-label="Menyu ya Owner">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={40} animate />
          <div>
            <Wordmark size={23} animate delay={0.9} />
            <div className="owner-tag">OWNER CONTROL</div>
          </div>
        </div>
        <nav className="nav nav-animated" ref={navRef}>
          <NavIndicator box={indicator} />
          {(() => {
            let n = 0;
            return groups.map((g) => (
              <div key={g.name} className="nav-group">
                <div className="nav-section">{t(g.name)}</div>
                {g.items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/owner'} style={{ animationDelay: `${60 + n++ * 35}ms` }}>
                    <span className="nav-icon">{it.icon}</span>
                    <span className="nav-text"><span>{t(it.label)}</span><small>{t(it.sub)}</small></span>
                    {it.to === '/owner/system' && !!alerts.data?.open && <span className={`nav-count${alerts.data.critical ? ' bad' : ''}`} title={t('Tahadhari za mfumo')}>{alerts.data.open}</span>}
                    {it.to === '/owner/support' && !!support.data?.waiting && <span className={`nav-count${support.data.overdue ? ' bad' : ''}`} title={support.data.overdue ? t('{n} zimechelewa', { n: support.data.overdue }) : t('Zinasubiri jibu')}>{support.data.waiting}</span>}
                  </NavLink>
                ))}
              </div>
            ));
          })()}
        </nav>
        <div className="sidebar-foot">
          Powered by <strong>DUKALANGU SOLUTION</strong><br />
          <em>Connecting Cooperatives. Empowering Farmers.</em><br /><LegalLinks />
        </div>
      </aside>

      {open && <button type="button" className="nav-scrim" aria-label={t('Funga menyu')} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="sm" className="menu-btn" onClick={() => setOpen(true)} aria-label={t('Fungua menyu')}>{I.menu}</Button>
          <strong className="owner-title">Owner Control Panel</strong>
          <div className="grow" />
          {isOwner && <Link className="btn btn-secondary btn-sm hide-sm" to="/">{t('Mwonekano wa Vyama')}</Link>}
          <PrefSwitches compact />
          <div className="user-chip">
            <span className="avatar owner-avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
            <span className="who">{user.fullName}<small>{isOwner ? OWNER_ROLE_LABEL : t(ROLE_LABEL[user.role])}</small></span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>{t('Toka')}</Button>
        </header>
        <SystemBanner />
        <main className="content owner-content">
          <Suspense fallback={<Loading />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
