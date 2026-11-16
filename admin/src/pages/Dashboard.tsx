// =====================================================================
//  DASHIBODI YA CHAMA (v2) — salamu, viashiria vikuu, kazi zinazosubiri, mapato/matumizi,
//  shughuli za karibuni na njia za mkato. Takwimu zote zinatoka kwenye endpoints zilizopo
//  (hakuna takwimu za kubuni); kila sehemu inaonekana tu kwa mwenye ruhusa yake.
// =====================================================================
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { date, num, tsh } from '../lib/format';
import { useAuth, type AmcosPermission } from '../lib/auth';
import { useT } from '../lib/prefs';
import { getSelectedAmcos, type Paged } from '../lib/api';
import { Alert, Loading, Stat } from '../components/ui';
import { BarChart } from '../components/charts';
import { Icon, type IconName } from '../components/icons';
import { COMING_SOON } from '../lib/comingSoon';

interface Summary {
  season: { id: string; name: string; status: string };
  members: { total: number; active: number; female: number };
  estimates: { count: number; approvedKg: string; totalKg: string; acres: string };
  inputs: { issues: number; value: string; farmers: number };
  ledger: { debit: string; credit: string };
}
interface Owing { memberId: string; memberNo: string; firstName: string; lastName: string; village: string | null; balance: string }
interface AccDash {
  cash: { total: string; accounts: { id: string; name: string; balance: string; financeAccountId: string | null; lastReconciled: string | null }[] };
  monthly: { month: string; income: string; expense: string }[];
  toPost: { count: number; amount: string };
  unpaidFarmers: { count: number; amount: string };
  farmerLedgerCheck: { matches: boolean };
  recent: { id: string; entryNo: string; date: string; description: string; sourceLabel: string; amount: string }[];
}
interface SalesSum { farmers: number; kg: string; grossTzs: string; unpaid: string }
interface ApprSum { total: number; amountTotal: string }
interface OvSum { findings: { open: number; responded: number }; directives: { open: number; inProgress: number } }

export interface Task { to: string; icon: IconName; tone: 'green' | 'gold' | 'blue' | 'red'; title: ReactNode; sub: ReactNode; right?: ReactNode }

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Habari za asubuhi' : h < 16 ? 'Habari za mchana' : 'Habari za jioni';
}
export function today() {
  try { return new Date().toLocaleDateString('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return date(new Date().toISOString()); }
}

export function Dashboard() {
  const { user, may } = useAuth();
  const t = useT();
  const single = !!(user?.amcosId || getSelectedAmcos());
  const { data, error, loading } = useFetch<Summary>('/reports/season-summary');
  const owing = useFetch<Paged<Owing>>(may('ledger.read') ? '/reports/member-balances' : null, { onlyOwing: true, pageSize: 6 });
  const acc = useFetch<AccDash>(single && may('accounting.read') ? '/accounting/dashboard' : null);
  const sales = useFetch<SalesSum>(single && may('sales.read') ? '/sales/summary' : null);
  const appr = useFetch<ApprSum>(may('approvals.read') ? '/approvals/summary' : null);
  const ov = useFetch<OvSum>(user?.amcosId && may('oversight.read') ? '/oversight/summary' : null);

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const s = data;
  const outstanding = Math.max(Number(s.ledger.debit) - Number(s.ledger.credit), 0);
  const decider = may('approvals.decide');

  // ------- Kazi zinazosubiri (kutoka takwimu halisi) -------
  const tasks: Task[] = [];
  if (appr.data?.total) tasks.push({ to: '/approvals', icon: 'tasks', tone: 'gold',
    title: decider ? `Maombi ${num(appr.data.total)} yanasubiri uamuzi wako` : `Maombi yako ${num(appr.data.total)} yanasubiri idhini`,
    sub: 'Idhini', right: Number(appr.data.amountTotal) ? tsh(appr.data.amountTotal) : undefined });
  if (acc.data?.toPost.count) tasks.push({ to: '/finance', icon: 'receipt', tone: 'blue', title: `Miamala ${num(acc.data.toPost.count)} imeidhinishwa — ikamilishwe`, sub: 'Miamala na hati', right: tsh(acc.data.toPost.amount) });
  if (acc.data?.unpaidFarmers.count) tasks.push({ to: '/sales', icon: 'leaf', tone: 'green', title: `Wakulima ${num(acc.data.unpaidFarmers.count)} hawajalipwa mauzo`, sub: 'Mauzo ya tumbaku', right: tsh(acc.data.unpaidFarmers.amount) });
  const ovOpen = (ov.data?.findings.open ?? 0) + (ov.data?.directives.open ?? 0) + (ov.data?.directives.inProgress ?? 0);
  if (ovOpen) tasks.push({ to: '/oversight', icon: 'shield', tone: 'red', title: `Hoja na maagizo ${num(ovOpen)} ya Afisa Ushirika`, sub: 'Ukaguzi na maagizo' });
  const stale = (acc.data?.cash.accounts ?? []).filter((a) => a.financeAccountId && (!a.lastReconciled || Date.now() - new Date(a.lastReconciled).getTime() > 40 * 864e5));
  if (stale.length && may('accounting.manage')) tasks.push({ to: '/bank', icon: 'bank', tone: 'blue', title: `Usuluhishi wa benki: akaunti ${num(stale.length)}`, sub: stale.map((a) => a.name).join(', ') });
  if (acc.data && !acc.data.farmerLedgerCheck.matches && may('accounting.manage')) tasks.push({ to: '/accounting', icon: 'scale', tone: 'red', title: 'Daftari la wakulima halilingani na daftari kuu', sub: 'Muhtasari wa fedha' });

  const months = (acc.data?.monthly ?? []).slice(-6).map((m) => ({ month: m.month, income: Number(m.income), expense: Number(m.expense) }));

  return (
    <div className="dash2">
      <HomeHero name={user?.fullName.split(' ')[0] ?? ''} sub={<>
        {tasks.length ? <>{t('Mambo')} <b>{tasks.length}</b> {t('yanasubiri hatua yako leo')}</> : t('Hakuna kinachosubiri — kila kitu kiko sawa.')}
        {' · '}{t('Msimu')} <b>{s.season.name}</b></>}>
        {may('issues.request') && <Link className="btn btn-gold" to="/input-issues/new"><Icon name="inputs" />{t('Toa pembejeo')}</Link>}
        {may('members.write') && <Link className="btn btn-primary" to="/members/new"><Icon name="userPlus" />{t('Sajili mkulima')}</Link>}
      </HomeHero>

      <div className="grid grid-4 dash2-kpis">
        <Stat accent icon="members" tone="green" label="Wanachama hai" value={num(s.members.active)} hint={`${num(s.members.total)} jumla · ${num(s.members.female)} wanawake`} />
        {sales.data && Number(sales.data.kg) > 0
          ? <Stat icon="leaf" tone="gold" label="Mauzo ya tumbaku" value={tsh(sales.data.grossTzs)} hint={`kg ${num(sales.data.kg)} · wakulima ${num(sales.data.farmers)}`} />
          : <Stat icon="estimate" tone="gold" label="Makisio yaliyoidhinishwa" value={`${num(s.estimates.approvedKg)} kg`} hint={`${num(s.estimates.count)} makisio · ekari ${num(s.estimates.acres)}`} />}
        {acc.data
          ? <Stat icon="bank" tone="blue" label="Fedha za chama" value={tsh(acc.data.cash.total)} hint={`Akaunti ${num(acc.data.cash.accounts.length)} za fedha`} />
          : <Stat icon="inputs" tone="blue" label="Pembejeo zilizotolewa" value={tsh(s.inputs.value)} hint={`Kwa wakulima ${num(s.inputs.farmers)} · utoaji ${num(s.inputs.issues)}`} />}
        <Stat icon="scale" tone="red" label="Madeni yanayodaiwa" value={tsh(outstanding)} hint="Pembejeo na makato ambayo bado hayajalipwa" />
      </div>

      <div className="dash2-row">
        {acc.data && (
          <section className="card card-pad dash2-wide">
            <div className="dash2-h"><h2><Icon name="chart" />{t('Mapato na matumizi')}</h2><Link to="/accounting">{t('Muhtasari wa fedha')}</Link></div>
            {months.length
              ? <BarChart title={t('Mapato na matumizi')} data={months} xKey="month" series={[{ key: 'income', label: t('Mapato'), color: '#1F7A52' }, { key: 'expense', label: t('Matumizi'), color: '#E3A83A' }]} height={230} />
              : <p className="muted">{t('Bado hakuna mapato wala matumizi yaliyorekodiwa.')}</p>}
          </section>
        )}
        <TaskPanel tasks={tasks} allTo={may('approvals.read') ? '/approvals' : undefined} />
      </div>

      <div className="dash2-row">
        {acc.data && !!acc.data.recent.length ? (
          <section className="card dash2-wide">
            <div className="dash2-h card-pad" style={{ paddingBottom: 0 }}><h2><Icon name="history" />{t('Shughuli za hivi karibuni')}</h2><Link to="/ledger">{t('Daftari kuu')}</Link></div>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {acc.data.recent.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td style={{ whiteSpace: 'nowrap' }}><b>{r.entryNo}</b><div className="muted" style={{ fontSize: 12.5 }}>{date(r.date)}</div></td>
                      <td>{r.description}<div className="muted" style={{ fontSize: 12.5 }}>{r.sourceLabel}</div></td>
                      <td className="num"><b>{tsh(r.amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : may('ledger.read') && (
          <section className="card dash2-wide">
            <div className="dash2-h card-pad" style={{ paddingBottom: 0 }}><h2><Icon name="scale" />{t('Wenye madeni makubwa')}</h2><Link to="/balances">{t('Ona wote')}</Link></div>
            <OwingTable rows={owing.data?.data} />
          </section>
        )}
        <QuickLinks />
      </div>

      <ComingSoon />

      {acc.data && !!acc.data.recent.length && may('ledger.read') && (
        <section className="card">
          <div className="dash2-h card-pad" style={{ paddingBottom: 0 }}><h2><Icon name="scale" />{t('Wenye madeni makubwa')}</h2><Link to="/balances">{t('Ona wote')}</Link></div>
          <OwingTable rows={owing.data?.data} />
        </section>
      )}
    </div>
  );
}

function OwingTable({ rows }: { rows?: Owing[] }) {
  const t = useT();
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {rows?.map((r) => (
            <tr key={r.memberId}>
              <td><Link className="row-link" to={`/members/${r.memberId}`}>{r.firstName} {r.lastName}</Link><div className="muted" style={{ fontSize: 13 }}>{r.memberNo}{r.village ? ` · ${r.village}` : ''}</div></td>
              <td className="num money-neg">{tsh(Math.abs(Number(r.balance)))}</td>
            </tr>
          ))}
          {rows && rows.length === 0 && <tr><td className="muted">{t('Hakuna mwanachama mwenye deni.')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Kichwa cha ukurasa wa nyumbani: tarehe, salamu kwa wakati wa siku, muhtasari na vitufe */
export function HomeHero({ name, sub, children }: { name: string; sub: ReactNode; children?: ReactNode }) {
  const t = useT();
  return (
    <section className="dash2-hero">
      <div className="dash2-hello">
        <span className="dash2-date">{today()}</span>
        <h1>{t(greeting())}, {name}</h1>
        <p>{sub}</p>
      </div>
      {children && <div className="dash2-cta">{children}</div>}
    </section>
  );
}

/** Orodha ya kazi zinazosubiri (kutoka takwimu halisi za ukurasa husika) */
export function TaskPanel({ tasks, allTo }: { tasks: Task[]; allTo?: string }) {
  const t = useT();
  return (
    <section className="card card-pad dash2-side">
      <div className="dash2-h"><h2><Icon name="tasks" />{t('Kazi zinazokusubiri')}</h2>{allTo && <Link to={allTo}>{t('Zote')}</Link>}</div>
      {tasks.length ? (
        <ul className="dash2-tasks">
          {tasks.map((k, i) => (
            <li key={i}>
              <Link to={k.to}>
                <span className={`stat-chip chip-${k.tone}`}><Icon name={k.icon} /></span>
                <span className="dash2-tt"><b>{typeof k.title === 'string' ? t(k.title) : k.title}</b><small>{typeof k.sub === 'string' ? t(k.sub) : k.sub}</small></span>
                {k.right && <span className="dash2-amt">{k.right}</span>}
                <Icon name="chevronRight" className="dash2-go" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="dash2-clear"><span className="stat-chip chip-green"><Icon name="sparkle" /></span><p>{t('Hakuna kinachosubiri. Kazi nzuri!')}</p></div>
      )}
    </section>
  );
}

export interface Quick { to: string; label: string; icon: IconName; perm: AmcosPermission }
export const QUICK: Quick[] = [
  { to: '/members/new', label: 'Sajili mkulima', icon: 'userPlus', perm: 'members.write' },
  { to: '/finance', label: 'Stakabadhi / Hati ya malipo', icon: 'receipt', perm: 'finance.record' },
  { to: '/input-issues/new', label: 'Toa pembejeo', icon: 'inputs', perm: 'issues.request' },
  { to: '/sales', label: 'Mauzo ya tumbaku', icon: 'leaf', perm: 'sales.manage' },
  { to: '/purchases', label: 'Ombi la manunuzi', icon: 'cart', perm: 'purchases.request' },
  { to: '/sms', label: 'Tuma SMS', icon: 'sms', perm: 'members.approve' },
  { to: '/accounting/reports', label: 'Ripoti za fedha', icon: 'chart', perm: 'accounting.read' },
  { to: '/approvals', label: 'Idhini', icon: 'tasks', perm: 'approvals.decide' },
];

/** Njia za mkato — zinaonekana kwa ruhusa za mtumiaji tu (hadi 6) */
export function QuickLinks() {
  const t = useT();
  const { may } = useAuth();
  const quick = QUICK.filter((x) => may(x.perm)).slice(0, 6);
  if (!quick.length) return null;
  return (
    <section className="dash2-quick">
      <h2>{t('Njia za mkato')}</h2>
      <div className="dash2-qgrid">
        {quick.map((q) => <Link key={q.to + q.label} to={q.to}><Icon name={q.icon} /><span>{t(q.label)}</span></Link>)}
      </div>
    </section>
  );
}

// ------------------------------ INAKUJA HIVI KARIBUNI ------------------------------

export function ComingSoon() {
  const t = useT();
  return (
    <section className="card card-pad soon-card" aria-labelledby="soon-h">
      <div className="dash2-h"><h2 id="soon-h"><Icon name="sparkle" />{t('Inakuja hivi karibuni')}</h2><span className="soon-tag">{t('Tunajenga sasa')}</span></div>
      <div className="soon-grid">
        {COMING_SOON.map((f) => (
          <div className="soon-it" key={f.icon}>
            <span className="stat-chip chip-gold"><Icon name={f.icon} /></span>
            <span><b>{t(f.t)}</b><small>{t(f.d)}</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}
