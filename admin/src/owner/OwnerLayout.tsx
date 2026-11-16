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
import { useTableCards } from '../components/MobileUi';
import { NotificationBell, TwoFactorBanner, TwoFactorGate } from './TeamUi';

import { ICONS } from '../components/icons';
const ic = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
// v2: nakshi kutoka seti moja ya mfumo (components/icons.tsx)
const I = {
  dash: ic(ICONS.dash),
  amcos: ic(ICONS.groups),
  support: ic(ICONS.help),
  subs: ic(ICONS.card),
  finance: ic(ICONS.trend),
  staff: ic(ICONS.staff),
  system: ic(ICONS.activity),
  comms: ic(ICONS.megaphone),
  sms: ic(ICONS.sms),
  security: ic(ICONS.shield),
  backup: ic(ICONS.database),
  business: ic(ICONS.briefcase),
  settings: ic(ICONS.sliders),
  menu: ic(ICONS.menu),
  requests: ic(ICONS.inbox),
  success: ic(ICONS.heart),
  leads: ic(ICONS.funnel),
};

// Menyu ya Owner kwa makundi (bila namba)
export const OWNER_NAV: { to: string; label: string; sub: string; icon: ReactNode; perm?: Permission; group: string }[] = [
  { to: '/owner', label: 'Owner Dashboard', sub: 'Muhtasari wa biashara', icon: I.dash, perm: 'platform.dashboard', group: 'Muhtasari' },
  { to: '/owner/success', label: 'Customer Success', sub: 'Afya ya wateja na kazi za leo', icon: I.success, perm: 'leads.read', group: 'Wateja' },
  { to: '/owner/leads', label: 'Leads & CRM', sub: 'Wateja watarajiwa', icon: I.leads, perm: 'leads.read', group: 'Wateja' },
  { to: '/owner/amcos', label: 'AMCOS Management', sub: 'Wateja (vyama)', icon: I.amcos, perm: 'amcos.read', group: 'Wateja' },
  { to: '/owner/support', label: 'Support Tickets', sub: 'Msaada kwa vyama', icon: I.support, perm: 'support.read', group: 'Wateja' },
  { to: '/owner/subscriptions', label: 'Subscriptions & Pricing', sub: 'Mipango na bei', icon: I.subs, perm: 'subscriptions.read', group: 'Wateja' },
  { to: '/owner/finance', label: 'Finance & Revenue', sub: 'Fedha za kampuni', icon: I.finance, perm: 'finance.read', group: 'Fedha na Biashara' },
  { to: '/owner/business', label: 'Business Center', sub: 'Malengo na ukuaji', icon: I.business, perm: 'business.read', group: 'Fedha na Biashara' },
  { to: '/owner/requests', label: 'Maombi ya timu', sub: 'Huduma zinazohitaji Owner', icon: I.requests, group: 'Timu na Mawasiliano' },
  { to: '/owner/officers', label: 'Maafisa Ushirika', sub: 'Wakaguzi wa serikali (wilaya)', icon: I.security, perm: 'staff.manage', group: 'Timu na Mawasiliano' },
  { to: '/owner/staff', label: 'Staff Management', sub: 'Wafanyakazi wa DUKALANGU', icon: I.staff, perm: 'staff.manage', group: 'Timu na Mawasiliano' },
  { to: '/owner/comms', label: 'Marketing & Communication', sub: 'Matangazo na SMS', icon: I.comms, perm: 'comms.read', group: 'Timu na Mawasiliano' },
  { to: '/owner/sms', label: 'SMS Center', sub: 'OTP, taarifa na gharama', icon: I.sms, perm: 'system.read', group: 'Timu na Mawasiliano' },
  { to: '/owner/system', label: 'System Control Center', sub: 'Hali ya mfumo', icon: I.system, perm: 'system.read', group: 'Mfumo na Usalama' },
  { to: '/owner/security', label: 'Security & Audit', sub: 'Usalama na kumbukumbu', icon: I.security, perm: 'security.read', group: 'Mfumo na Usalama' },
  { to: '/owner/backup', label: 'Backup & Database', sub: 'Hifadhi ya data', icon: I.backup, perm: 'backup.read', group: 'Mfumo na Usalama' },
  { to: '/owner/settings', label: 'Akaunti yangu', sub: 'Nenosiri, 2FA na vifaa', icon: I.settings, group: 'Akaunti' },
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
  const contentRef = useRef<HTMLElement>(null);
  useTableCards(contentRef); // majedwali yanakuwa kadi kwenye simu
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
  // Dashibodi ya Owner ni ya Owner; wafanyakazi wanaanzia kwenye dawati lao la kazi
  const items = OWNER_NAV.filter((n) => (!n.perm || has(n.perm)) && ((n.to !== '/owner' && n.to !== '/owner/officers') || user?.role === 'SUPER_ADMIN'));
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
                    <span className="nav-text"><span>{t(it.to === '/owner/requests' && !isOwner ? 'Maombi kwa Owner' : it.label)}</span><small>{t(it.sub)}</small></span>
                    {it.to === '/owner/system' && !!alerts.data?.open && <span className={`nav-count${alerts.data.critical ? ' bad' : ''}`} title={t('Tahadhari za mfumo')}>{alerts.data.open}</span>}
                    {it.to === '/owner/support' && !!support.data?.waiting && <span className={`nav-count${support.data.overdue ? ' bad' : ''}`} title={support.data.overdue ? t('{n} zimechelewa', { n: support.data.overdue }) : t('Zinasubiri jibu')}>{support.data.waiting}</span>}
                  </NavLink>
                ))}
              </div>
            ));
          })()}
        </nav>
      </aside>

      {open && <button type="button" className="nav-scrim" aria-label={t('Funga menyu')} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="sm" className="menu-btn" onClick={() => setOpen(true)} aria-label={t('Fungua menyu')}>{I.menu}</Button>
          <strong className="owner-title">Owner Control Panel</strong>
          <div className="grow" />
          {isOwner && <Link className="btn btn-secondary btn-sm hide-sm" to="/">{t('Mwonekano wa Vyama')}</Link>}
          <NotificationBell />
          <PrefSwitches compact />
          <div className="user-chip">
            <span className="avatar owner-avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
            <span className="who">{user.fullName}<small>{isOwner ? OWNER_ROLE_LABEL : t(ROLE_LABEL[user.role])}</small></span>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>{t('Toka')}</Button>
        </header>
        <SystemBanner />
        <main className="content owner-content" ref={contentRef}>
          {user.twoFactor?.overdue ? <TwoFactorGate /> : <>
            <TwoFactorBanner />
            <Suspense fallback={<Loading />}><Outlet /></Suspense>
          </>}
        </main>
      </div>
    </div>
  );
}
