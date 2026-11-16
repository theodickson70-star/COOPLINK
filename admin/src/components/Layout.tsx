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
import { ICONS, type IconName } from './icons';
import { CommandPalette, useCommandPalette, type PaletteItem } from './CommandPalette';

// v2: nakshi zote zinatoka kwenye seti moja (components/icons.tsx)
const I = Object.fromEntries(Object.entries(ICONS)) as Record<IconName, ReactNode>;

function Icon({ d }: { d: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
}

// Menu inaonyesha moduli za cheo husika tu. Usalama halisi uko kwenye backend (kila endpoint inakagua ruhusa).
// v2: sehemu 5 zinazofuata kazi ya chama — Nyumbani → Wakulima → Msimu → Fedha → Chama.
interface NavItem { to: string; label: string; icon: ReactNode; roles?: Role[]; perm?: AmcosPermission[] }
const FIN_READ: AmcosPermission[] = ['accounting.manage', 'oversight.manage'];
const NAV: { section?: string; items: NavItem[] }[] = [
  { section: 'Nyumbani', items: [
    { to: '/', label: 'Dashibodi', icon: I.home },
    { to: '/approvals', label: 'Idhini', icon: I.tasks, perm: ['approvals.read'] },
    { to: '/oversight', label: 'Ukaguzi na Maagizo', icon: I.shield, perm: ['oversight.respond'] },
  ] },
  {
    section: 'Usimamizi wa Serikali',
    items: [
      { to: '/oversight', label: 'Dashibodi ya wilaya', icon: I.shield, perm: ['oversight.manage'] },
      { to: '/oversight/inspections', label: 'Ukaguzi na hoja', icon: I.inspect, perm: ['oversight.manage'] },
      { to: '/oversight/directives', label: 'Maagizo rasmi', icon: I.flag, perm: ['oversight.manage'] },
      { to: '/oversight/holds', label: 'Zuio la malipo', icon: I.stop, perm: ['oversight.manage'] },
    ],
  },
  {
    section: 'Wakulima',
    items: [
      { to: '/members', label: 'Wanachama', icon: I.members, perm: ['members.read'] },
      { to: '/groups', label: 'Vikundi', icon: I.groups, perm: ['members.read'] },
      { to: '/estimates', label: 'Makisio ya msimu', icon: I.estimate, perm: ['members.read'] },
      { to: '/balances', label: 'Madeni na Salio', icon: I.scale, perm: ['ledger.read'] },
      { to: '/farmer-debts', label: 'Madeni ya wakulima', icon: I.debt, perm: FIN_READ },
    ],
  },
  {
    section: 'Msimu',
    items: [
      { to: '/inputs', label: 'Pembejeo na stoo', icon: I.inputs, perm: ['stock.read'] },
      { to: '/input-issues', label: 'Ugawaji wa pembejeo', icon: I.issue, perm: ['stock.read'] },
      { to: '/sales', label: 'Mauzo ya tumbaku', icon: I.leaf, perm: ['sales.manage', 'oversight.manage'] },
      { to: '/kuni', label: 'Mikopo (kuni)', icon: I.handCoins, perm: ['finance.record', 'oversight.manage'] },
      { to: '/purchases', label: 'Manunuzi na wazabuni', icon: I.cart, perm: ['purchases.request', 'purchases.receive', 'approvals.decide'] },
    ],
  },
  {
    // Mhasibu: uhasibu kamili · Meneja: ripoti tu (anaidhinisha kupitia Idhini). Sehemu nyingine za fedha ziko kwenye vichupo (FinanceTabs).
    section: 'Fedha',
    items: [
      { to: '/accounting', label: 'Muhtasari wa fedha', icon: I.pie, perm: FIN_READ },
      { to: '/finance', label: 'Miamala na hati', icon: I.receipt, perm: ['finance.record', 'oversight.manage'] },
      { to: '/bank', label: 'Benki', icon: I.bank, perm: FIN_READ },
      { to: '/ledger', label: 'Daftari kuu', icon: I.book, perm: FIN_READ },
      { to: '/payroll', label: 'Mishahara', icon: I.payroll, perm: ['payroll.manage', 'oversight.manage'] },
      { to: '/accounting/reports', label: 'Ripoti za fedha', icon: I.chart, perm: ['accounting.read'] },
    ],
  },
  {
    section: 'Chama',
    items: [
      { to: '/users', label: 'Watumishi', icon: I.staff, roles: ['SUPER_ADMIN', 'UNION_ADMIN', 'AMCOS_ADMIN'] },
      { to: '/sms', label: 'SMS kwa wakulima', icon: I.sms, perm: ['members.approve'] },
      { to: '/audit', label: 'Kumbukumbu (Audit)', icon: I.history, perm: ['audit.read'] },
      { to: '/billing', label: 'Ada ya CoopLink', icon: I.card, roles: ['AMCOS_ADMIN', 'ACCOUNTANT'] },
      { to: '/organizations', label: 'Vyama na Misimu', icon: I.globe, roles: ROLE_GROUPS.ORGS },
      { to: '/settings', label: 'Mipangilio', icon: I.sliders, roles: ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'] },
    ],
  },
];

/** Vichupo vya Fedha: kila ukurasa wa fedha unaonyesha sehemu zote za fedha mahali pamoja */
const FIN_TABS: NavItem[] = [
  { to: '/accounting', label: 'Muhtasari', icon: I.pie, perm: FIN_READ },
  { to: '/finance', label: 'Miamala na hati', icon: I.receipt, perm: ['finance.record', 'oversight.manage'] },
  { to: '/bank', label: 'Benki', icon: I.bank, perm: FIN_READ },
  { to: '/ledger', label: 'Daftari kuu', icon: I.book, perm: FIN_READ },
  { to: '/payables', label: 'Madeni ya chama', icon: I.invoice, perm: FIN_READ },
  { to: '/payroll', label: 'Mishahara', icon: I.payroll, perm: ['payroll.manage', 'oversight.manage'] },
  { to: '/fixed-assets', label: 'Mali za chama', icon: I.building, perm: FIN_READ },
  { to: '/accounting/periods', label: 'Vipindi na salio la kuanzia', icon: I.lock, perm: FIN_READ },
  { to: '/accounting/reports', label: 'Ripoti', icon: I.chart, perm: ['accounting.read'] },
];
const isFinPath = (p: string) => FIN_TABS.some((x) => p === x.to || (x.to !== '/accounting' && p.startsWith(`${x.to}/`)));

function FinanceTabs({ may }: { may: (p: AmcosPermission) => boolean }) {
  const t = useT();
  const items = FIN_TABS.filter((it) => !it.perm || it.perm.some((p) => may(p)));
  if (items.length < 2) return null;
  return (
    <nav className="fin-tabs" aria-label={t('Sehemu za fedha')}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/accounting'} className={({ isActive }) => (isActive ? 'on' : '')}>
          <Icon d={it.icon} /><span>{t(it.label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
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
  const palette = useCommandPalette();
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
        <button type="button" className="sb-search" onClick={() => palette.setOpen(true)}>
          <Icon d={I.search} /><span>{t('Tafuta…')}</span><kbd>Ctrl K</kbd>
        </button>
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
          <button type="button" className="tb-search" aria-label={t('Tafuta')} onClick={() => palette.setOpen(true)}><Icon d={I.search} /></button>
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
          ) : <>{isFinPath(loc.pathname) && <FinanceTabs may={(p) => may(p)} />}<PageGuide /><Suspense fallback={<Loading />}><Outlet /></Suspense></>}
          <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} members={may('members.read')}
            pages={[...NAV.flatMap((g) => g.items.map((it) => ({ ...it, section: g.section }))), ...FIN_TABS.map((it) => ({ ...it, section: 'Fedha' }))]
              .filter((it) => !(officer && it.to === '/') && (!it.roles || can(...it.roles)) && (!it.perm || may(...it.perm))) as PaletteItem[]} />
        </main>
      </div>
      {!feeLocked && <BottomNav items={bottomItems} onMore={() => setOpen(true)} />}
      <MaintenanceOverlay />
    </div>
  );
}
