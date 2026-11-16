import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth, ROLE_GROUPS, type AmcosPermission, type Role } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { NavIndicator, useNavIndicator } from './NavIndicator';
import { api, getSelectedAmcos, setSelectedAmcos, type Paged } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { LogoMark, Wordmark } from './Logo';
import { Button, Loading } from './ui';
import { AnnouncementBar, MaintenanceOverlay, SystemBanner } from './Notices';
import { PrefSwitches, useT } from '../lib/prefs';
import { LegalLinks } from './LegalLinks';
import { hasGuide, OPEN_GUIDE, PageGuide } from './PageGuide';
import { prefetchPages } from '../lib/prefetch';
import type { BillingData } from '../pages/Billing';
import { date, tsh } from '../lib/format';
import { BottomNav, UserSheet, useTableCards, type BottomItem } from './MobileUi';

const I = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  members: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.5.2 4.4 1.9 5 5.4" /></>,
  estimate: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  inputs: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  issue: <><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9v.01M18 15v.01" /></>,
  users: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" /></>,
  org: <><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
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
  sms: <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  stop: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8" /><path d="M12 17v.01" /></>,
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
    { to: '/oversight', label: 'Ukaguzi na Maagizo', icon: I.shield, perm: ['oversight.respond'] },
  ] },
  {
    section: 'Usimamizi wa Serikali',
    items: [
      { to: '/oversight', label: 'Dashibodi ya wilaya', icon: I.shield, perm: ['oversight.manage'] },
      { to: '/oversight/inspections', label: 'Ukaguzi na hoja', icon: I.audit, perm: ['oversight.manage'] },
      { to: '/oversight/directives', label: 'Maagizo rasmi', icon: I.flag, perm: ['oversight.manage'] },
      { to: '/oversight/holds', label: 'Zuio la malipo', icon: I.stop, perm: ['oversight.manage'] },
    ],
  },
  {
    section: 'Wakulima',
    items: [
      { to: '/members', label: 'Wakulima (wanachama)', icon: I.members, perm: ['members.read'] },
      { to: '/groups', label: 'Vikundi vya wakulima', icon: I.org, perm: ['members.read'] },
      { to: '/estimates', label: 'Makisio ya msimu', icon: I.estimate, perm: ['members.read'] },
      { to: '/balances', label: 'Madeni na Salio', icon: I.money, perm: ['ledger.read'] },
    ],
  },
  {
    section: 'Pembejeo na Stoo',
    items: [
      { to: '/inputs', label: 'Bidhaa na Stoo', icon: I.inputs, perm: ['stock.read'] },
      { to: '/input-issues', label: 'Ugawaji wa Pembejeo', icon: I.issue, perm: ['stock.read'] },
      { to: '/purchases', label: 'Manunuzi na Wazabuni', icon: I.cart, perm: ['purchases.request', 'purchases.receive', 'approvals.decide'] },
    ],
  },
  {
    section: 'Mauzo na Mikopo',
    items: [
      { to: '/sales', label: 'Mauzo ya tumbaku', icon: I.leaf, perm: ['sales.manage', 'oversight.manage'] },
      { to: '/kuni', label: 'Mikopo', icon: I.money, perm: ['finance.record', 'oversight.manage'] },
      { to: '/farmer-debts', label: 'Madeni ya wakulima', icon: I.members, perm: ['accounting.manage', 'oversight.manage'] },
    ],
  },
  {
    // Mhasibu: uhasibu kamili · Meneja: ripoti tu (anaidhinisha kupitia Idhini)
    section: 'Fedha na Uhasibu',
    items: [
      { to: '/accounting', label: 'Dashibodi ya fedha', icon: I.gauge, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/finance', label: 'Miamala na vocha', icon: I.wallet, perm: ['finance.record', 'oversight.manage'] },
      { to: '/ledger', label: 'Daftari kuu', icon: I.book, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/bank', label: 'Benki na usuluhishi', icon: I.bank, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/payables', label: 'Madeni ya chama', icon: I.money, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/payroll', label: 'Mishahara', icon: I.payroll, perm: ['payroll.manage', 'oversight.manage'] },
      { to: '/fixed-assets', label: 'Mali za chama', icon: I.building, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/accounting/periods', label: 'Salio la kuanzia na kufunga', icon: I.check, perm: ['accounting.manage', 'oversight.manage'] },
      { to: '/accounting/reports', label: 'Ripoti za fedha', icon: I.report, perm: ['accounting.read'] },
    ],
  },
  {
    section: 'Mawasiliano',
    items: [
      { to: '/sms', label: 'Matangazo kwa SMS', icon: I.sms, perm: ['members.approve'] },
    ],
  },
  {
    section: 'Usimamizi',
    items: [
      { to: '/users', label: 'Watumishi', icon: I.users, roles: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] },
      { to: '/billing', label: 'Ada ya CoopLink', icon: I.wallet, roles: ['AMCOS_ADMIN', 'ACCOUNTANT'] },
      { to: '/organizations', label: 'Vyama na Misimu', icon: I.org, roles: ROLE_GROUPS.ORGS },
      { to: '/audit', label: 'Kumbukumbu (Audit)', icon: I.audit, perm: ['audit.read'] },
      { to: '/settings', label: 'Mipangilio', icon: I.settings, roles: ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] },
    ],
  },
];
// Help & Support: kimebanwa chini kabisa ya menyu (hakisogei pamoja na orodha)
const SUPPORT_ROLES: Role[] = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'];

/** Kwa Super/Union admin: chagua chama unachofanyia kazi. */
function AmcosSwitcher() {
  const t = useT();
  useEffect(() => { prefetchPages(); }, []);
  const [list, setList] = useState<{ id: string; name: string; code: string }[]>([]);
  const [value, setValue] = useState(getSelectedAmcos() ?? '');
  useEffect(() => {
    api<Paged<{ id: string; name: string; code: string }>>('/amcos', { query: { pageSize: 100 } }).then((r) => setList(r.data)).catch(() => {});
  }, []);
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="muted" style={{ fontSize: 13 }}>{t('Chama:')}</span>
      <select className="select" style={{ minWidth: 220 }} value={value}
        onChange={(e) => { setSelectedAmcos(e.target.value || null); setValue(e.target.value); window.location.reload(); }}>
        <option value="">{t('Vyama vyote (kusoma tu)')}</option>
        {list.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
      </select>
    </label>
  );
}

export function Layout() {
  const { user, amcos, logout, can, may } = useAuth();
  const decider = may('approvals.decide');
  const t = useT();
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
  const pending = useFetch<{ total: number }>(user?.amcosId && may('approvals.read') ? '/approvals/summary' : null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  useTableCards(contentRef);
  const loc = useLocation();
  // Tiketi zenye majibu mapya ya timu ya CoopLink (inasomwa upya ukibadili ukurasa)
  const support = useFetch<{ count: number }>(user?.amcosId ? '/support/unread' : null, { p: loc.pathname.startsWith('/support') ? loc.pathname : 'x' });
  useEffect(() => setOpen(false), [loc.pathname]);
  // Ada ya CoopLink: Mhasibu analipa (Meneja kama hakuna Mhasibu); Meneja anaona hali yake.
  // Chama kikifungwa, mlipaji anabaki kwenye ukurasa wa malipo tu; wengine wote wanaona skrini ya kufungwa.
  const feeRole = user?.role === 'AMCOS_ADMIN' || user?.role === 'ACCOUNTANT';
  const officer = user?.role === 'COOP_OFFICER';
  // Zuio la malipo kutoka kwa Afisa Ushirika: bango kwa watumishi wa chama
  const oversight = useFetch<{ holds: { id: string; reason: string; placedAt: string; by: string | null }[]; directives: { open: number } }>(
    user?.amcosId && may('oversight.read') ? '/oversight/summary' : null, { p: loc.pathname.startsWith('/oversight') ? loc.pathname : 'x' });
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
  // Afisa Ushirika: ukurasa wake wa kwanza ni dashibodi ya wilaya; 2FA ikipita muda -> Akaunti yangu tu
  if (officer && loc.pathname === '/') return <Navigate to="/oversight" replace />;
  if (officer && user.twoFactor?.overdue && !user.totpEnabled && loc.pathname !== '/oversight/account') return <Navigate to="/oversight/account" replace />;
  const feeLocked = officer ? false : isPayer ? !!fees.data?.lock : !!lockMsg || (feeRole && !!fees.error && /imefungwa/i.test(fees.error));
  if (isPayer && feeLocked && !loc.pathname.startsWith('/billing') && !loc.pathname.startsWith('/support')) return <Navigate to="/billing" replace />;
  // Menyu ya chini (simu): vitu vikuu vya cheo hiki kwa mpangilio wa kipaumbele
  const allItems = NAV.flatMap((g) => g.items).filter((it) => !(officer && it.to === '/') && (!it.roles || can(...it.roles)) && (!it.perm || may(...it.perm)));
  const PRIORITY: Record<string, string> = { '/': 'Nyumbani', ...(officer ? { '/oversight': 'Wilaya', '/oversight/inspections': 'Ukaguzi' } : {}), '/approvals': decider || officer ? 'Idhini' : 'Maombi', '/members': 'Wakulima', '/input-issues': 'Pembejeo', '/finance': 'Fedha', '/sales': 'Mauzo', '/inputs': 'Stoo', '/accounting/reports': 'Ripoti' };
  const bottomItems: BottomItem[] = Object.keys(PRIORITY).map((to) => allItems.find((it) => it.to === to)).filter(Boolean)
    .map((it) => ({ to: it!.to, label: PRIORITY[it!.to], icon: <Icon d={it!.icon} />, badge: it!.to === '/approvals' && decider ? pending.data?.total : undefined }));
  const due = feeRole && !feeLocked ? fees.data?.fees.find((f) => (f.status === 'UNPAID' || f.status === 'PARTIAL') && (Date.parse(f.dueDate) - Date.now()) / 86_400_000 <= 30) : undefined;

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label={t('Menyu kuu')}>
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoMark size={42} animate />
          <div>
            <Wordmark size={24} animate delay={0.9} />
          </div>
        </div>
        <nav className="nav nav-animated" ref={navRef}>
          <NavIndicator box={indicator} />
          {(() => { let n = 0; return NAV.map((g, i) => {
            const items = g.items.filter((it) => !(officer && it.to === '/') && (!it.roles || can(...it.roles)) && (!it.perm || may(...it.perm)) && (!feeLocked || it.to === '/billing' || it.to === '/support'));
            if (!items.length) return null;
            return (
              <div key={i} style={{ display: 'contents' }}>
                {g.section && <div className="nav-section">{t(g.section)}</div>}
                {items.map((it) => (
                  <NavLink key={it.to} to={it.to} end={it.to === '/' || it.to === '/accounting' || it.to === '/oversight'} style={{ animationDelay: `${60 + n++ * 35}ms` }}>
                    <span className="nav-icon"><Icon d={it.icon} /></span>{it.to === '/approvals' && !decider ? t(officer ? 'Idhini za chama' : 'Maombi yangu') : t(it.label)}
                    {it.to === '/approvals' && decider && !!pending.data?.total && <span className="nav-count">{pending.data.total}</span>}
                    {it.to === '/oversight' && !officer && !!oversight.data?.directives.open && <span className="nav-count">{oversight.data.directives.open}</span>}
                  </NavLink>
                ))}
              </div>
            );
          }); })()}
        </nav>
        {can(...SUPPORT_ROLES) && (
          <NavLink to="/support" className="sb-help">
            <span className="sb-help-ic"><LogoMark size={26} ring={false} /></span>
            <span className="sb-help-t">Help &amp; Support<small>{t('Tuko tayari kukusaidia')}</small></span>
            {!!support.data?.count && <span className="nav-count" title={t('Majibu mapya')}>{support.data.count}</span>}
          </NavLink>
        )}
      </aside>
      {open && <button type="button" className="nav-scrim"  aria-label={t('Funga menyu')} onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <Button variant="secondary" size="sm" className="menu-btn" onClick={() => setOpen(true)} aria-label={t('Fungua menyu')}><Icon d={I.menu} /></Button>
          {multi ? <AmcosSwitcher /> : <strong className="tb-title" style={{ fontFamily: 'var(--font-head)', color: 'var(--head)' }}>{amcos?.name}</strong>}
          <div className="grow" />
          {user.role === 'SUPER_ADMIN' && <Link className="btn btn-primary btn-sm hide-sm" to="/owner">Owner Panel</Link>}
          {user.amcosId && !loc.pathname.startsWith('/support') && (
            <Link className="btn btn-ghost btn-sm help-btn" to={`/support/new?from=${encodeURIComponent(loc.pathname)}`} title={t('Pata msaada kutoka timu ya CoopLink')}>
              <Icon d={I.help} /><span className="hide-sm">{t('Pata msaada')}</span>
            </Link>
          )}
          <div className="tb-desk">
            {hasGuide(loc.pathname, user.role) && (
              <Button variant="ghost" size="sm" className="help-btn" title={t('Onyesha mwongozo wa ukurasa huu')} onClick={() => { window.dispatchEvent(new Event(OPEN_GUIDE)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                💡<span className="hide-sm">{t('Mwongozo')}</span>
              </Button>
            )}
            <PrefSwitches compact />
            {user.amcosId ? (
              <Link className="user-chip" to="/settings" title={t('Mipangilio na akaunti yangu')}>
                <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
                <span className="who">{user.fullName}<small>{t(ROLE_LABEL[user.role])}{amcos ? ` · ${amcos.code}` : ''}</small></span>
              </Link>
            ) : (
              <div className="user-chip">
                <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
                <span className="who">{user.fullName}<small>{t(ROLE_LABEL[user.role])}</small></span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={logout}>{t('Toka')}</Button>
          </div>
          <button type="button" className="tb-avatar" aria-label={t('Akaunti yangu')} onClick={() => setSheet(true)}>
            <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
          </button>
        </header>
        <UserSheet open={sheet} onClose={() => setSheet(false)}>
          <div className="us-head">
            <span className="avatar" aria-hidden="true">{user.fullName.charAt(0)}</span>
            <div><strong>{user.fullName}</strong><small>{t(ROLE_LABEL[user.role])}{amcos && user.amcosId ? ` · ${amcos.name}` : ''}</small></div>
          </div>
          <div className="us-row"><span>{t('Mwonekano na lugha')}</span><div className="us-prefs"><PrefSwitches /></div></div>
          {hasGuide(loc.pathname, user.role) && (
            <button type="button" className="us-btn" onClick={() => { setSheet(false); window.dispatchEvent(new Event(OPEN_GUIDE)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>💡 {t('Mwongozo wa ukurasa huu')}</button>
          )}
          {user.amcosId && <Link className="us-btn" to="/settings">⚙️ {t('Mipangilio na akaunti yangu')}</Link>}
          {user.role === 'SUPER_ADMIN' && <Link className="us-btn" to="/owner">Owner Panel</Link>}
          <button type="button" className="us-btn danger" onClick={logout}>{t('Toka')}</button>
        </UserSheet>
        <SystemBanner />
        {amcos?.training && user.amcosId && <div className="training-strip" role="status">🎓 {t('Hali ya mafunzo: data ya chama hiki ni ya mazoezi na itafutwa yote kabla ya kuanza matumizi halisi. Akaunti zenu zitabaki.')}</div>}
        <main className="content" ref={contentRef}>
          {user.amcosId && <AnnouncementBar />}
          {officer && user.twoFactor?.required && !user.totpEnabled && !user.twoFactor.overdue && user.twoFactor.deadline && loc.pathname !== '/oversight/account' && (
            <div className="tfa-banner" role="status">🔐 <span>{t('Washa 2FA kabla ya')} <b>{date(user.twoFactor.deadline)}</b>. {t('Akaunti za Afisa Ushirika zina mamlaka ya kiserikali — 2FA ni lazima.')}</span>
              <Link className="btn btn-sm btn-primary" to="/oversight/account">{t('Washa sasa')}</Link></div>
          )}
          {!loc.pathname.startsWith('/oversight') && oversight.data?.holds.map((h) => (
            <div key={h.id} className="ov-hold ov-hold-strip" role="alert">
              <span className="ov-hold-ic" aria-hidden="true">⛔</span>
              <div><b>{t('ZUIO LA MALIPO kutoka kwa Afisa Ushirika')}</b> — {t('malipo yote yanayotoka yamesimamishwa mpaka zuio liondolewe.')} <small>{t('Sababu')}: {h.reason}</small></div>
              <Link className="btn btn-sm btn-secondary" to="/oversight/holds">{t('Maelezo')}</Link>
            </div>
          ))}
          {due && !loc.pathname.startsWith('/billing') && (
            <div className="fee-banner">
              <span><strong>{t(due.label)}</strong>: {t('salio {amount}, mwisho wa kulipa {date}.', { amount: tsh(due.outstanding), date: date(due.dueDate) })}{!isPayer && fees.data?.payer ? ` ${t('{who} ndiye analipa.', { who: t(fees.data.payer.label) })}` : ''} {t('Ada isipolipwa kufikia tarehe hiyo, chama kitafungwa.')}</span>
              <Link className="btn btn-primary btn-sm" to="/billing">{isPayer ? t('Lipa sasa') : t('Angalia ada')}</Link>
            </div>
          )}
          {!isPayer && feeLocked ? (
            <section className="card lock-screen">
              <h2>{t('Chama kimefungwa kwa muda')}</h2>
              <p>{lockMsg ?? fees.error}</p>
              <Button onClick={logout}>{t('Toka')}</Button>
            </section>
          ) : <><PageGuide /><Suspense fallback={<Loading />}><Outlet /></Suspense></>}
        </main>
      </div>
      {!feeLocked && <BottomNav items={bottomItems} onMore={() => setOpen(true)} />}
      <MaintenanceOverlay />
    </div>
  );
}
