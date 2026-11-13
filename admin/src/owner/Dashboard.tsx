// =====================================================================
//  OWNER DASHBOARD (v0.39) — muonekano mpya
//   1. Salamu + kipindi  2. Bango kuu (mapato/ukuaji + ▲▼ dhidi ya kipindi kilichopita)
//   3. Kazi zinazokusubiri (data ileile ya kengele — /owner/notifications)
//   4. Mwenendo wa miezi 12 (tabs)  ·  Hali ya vyama na subscriptions
//   5. Shughuli za karibuni  ·  Mapato kwa muhtasari + hali ya mfumo
//  Takwimu zote zinatoka kwenye database — hakuna namba za kubuni.
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Loading } from '../components/ui';
import { BarChart, LineChart } from '../components/charts';
import { DateRangeFilter, money, nfmt, presetRange, Tabs, type Range } from '../components/owner-ui';

interface Dash {
  range: { from: string; to: string };
  amcos: Record<'total' | 'active' | 'suspended' | 'pending' | 'rejected' | 'new_in_range' | 'new_prev', number>;
  users: Record<'total' | 'active' | 'staff' | 'logged_in_range', number>;
  subscriptions: Record<'active' | 'trial' | 'past_due' | 'expired' | 'expiring' | 'expiringWindowDays', number>;
  revenue: (Record<'in_range' | 'prev_range' | 'this_month' | 'this_year' | 'all_time', string> & { payments: number; payments_in_range: number }) | null;
  series: { month: string; new_amcos: number; new_paid_subs: number; new_trials: number; revenue: string | null }[];
  recent: { kind: 'AMCOS' | 'PAYMENT' | 'TICKET'; ref: string; title: string; detail: string; status: string; amount: string | null; at: string }[];
  health: { db: string; dbMs: number; errors_24h: number; last_job_status: string | null; last_job_at: string | null; maintenance: boolean };
}
interface Notif { key: string; title: string; detail: string; count: number; to: string; tone: 'bad' | 'warn' | 'info' }

const DAYS = ['Jumapili', 'Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi'];
const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];

/** Saa na tarehe ya Tanzania (EAT), bila kujali saa ya kifaa. */
function eatNow() {
  const d = new Date(Date.now() + 3 * 3600e3);
  const h = d.getUTCHours();
  return {
    greet: h < 12 ? 'Habari za asubuhi' : h < 16 ? 'Habari za mchana' : 'Habari za jioni',
    date: `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
  };
}

/** Mabadiliko ya asilimia dhidi ya kipindi kilichopita. */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev && !now) return <span className="dl-delta flat">— hakuna mabadiliko</span>;
  if (!prev) return <span className="dl-delta up">▲ mpya kipindi hiki</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return <span className="dl-delta flat">= sawa na kipindi kilichopita</span>;
  return <span className={`dl-delta ${pct > 0 ? 'up' : 'down'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% <span>dhidi ya kipindi kilichopita</span></span>;
}

/** Chati ndogo ya mstari (miezi 12) ndani ya bango kuu. */
function Spark({ values, label }: { values: number[]; label: string }) {
  const W = 240, H = 64, max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, H - 6 - (v / max) * (H - 14)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="dl-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <defs><linearGradient id="dlg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E3A83A" stopOpacity=".45" /><stop offset="1" stopColor="#E3A83A" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#dlg)" />
      <path d={line} fill="none" stroke="#E3A83A" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="3.5" fill="#F6D58E" />}
    </svg>
  );
}

/** Upau mmoja wenye sehemu (status distribution) + maelezo. */
function Split({ parts, total }: { parts: { label: string; value: number; cls: string; to?: string }[]; total: number }) {
  return (
    <div className="dl-split">
      <div className="dl-bar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} className={p.cls} style={{ flexGrow: p.value }} />)}
        {total === 0 && <span className="empty" style={{ flexGrow: 1 }} />}
      </div>
      <ul className="dl-legend">
        {parts.map((p) => (
          <li key={p.label}>
            <i className={p.cls} aria-hidden="true" />
            {p.to && p.value ? <Link to={p.to}>{p.label}</Link> : <span>{p.label}</span>}
            <b>{nfmt(p.value)}</b>
            <span className="muted">{total ? `${Math.round((p.value / total) * 100)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND: Record<Dash['recent'][number]['kind'], { ic: string; to: (r: Dash['recent'][number]) => string; verb: (r: Dash['recent'][number]) => string }> = {
  AMCOS: { ic: '🏠', to: (r) => `/owner/amcos/${r.ref}`, verb: (r) => (r.status === 'PENDING' ? 'Chama kipya kimejisajili — kinasubiri idhini' : 'Chama kimesajiliwa') },
  PAYMENT: { ic: '💰', to: () => '/owner/finance?tab=payments', verb: (r) => (r.status === 'VERIFIED' ? 'Malipo yamethibitishwa' : 'Malipo yanasubiri uthibitisho') },
  TICKET: { ic: '💬', to: () => '/owner/support', verb: () => 'Tiketi ya msaada' },
};

export function OwnerDashboard() {
  const { user, has } = useAuth();
  const [range, setRange] = useState<Range>(presetRange('30d'));
  const [trend, setTrend] = useState<'revenue' | 'amcos' | 'subs'>('revenue');
  const { data, error, loading } = useFetch<Dash>('/owner/dashboard', { from: range.from, to: range.to });
  const tasks = useFetch<{ total: number; items: Notif[] }>('/owner/notifications');
  const now = eatNow();
  const first = user?.fullName.split(' ')[0] ?? '';

  const d = data;
  const rev = d?.revenue;
  const trendKey = rev ? trend : trend === 'revenue' ? 'amcos' : trend;
  const subsTotal = d ? d.subscriptions.active + d.subscriptions.trial + d.subscriptions.past_due + d.subscriptions.expired : 0;

  return (
    <div className="dl">
      <header className="dl-top">
        <div>
          <span className="dl-date">{now.date}</span>
          <h1>{now.greet}, {first} 👋</h1>
          {d && <p className="muted">
            Vyama <b>{nfmt(d.amcos.active)}</b> vinatumia CoopLink
            {d.amcos.pending ? <> · <Link to="/owner/amcos?status=PENDING">{d.amcos.pending} vinasubiri idhini yako</Link></> : null}
            {d.subscriptions.expiring ? <> · {d.subscriptions.expiring} subscriptions zinakaribia kuisha</> : null}
          </p>}
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </header>
      <Alert>{error}</Alert>

      {loading && !d ? <Loading /> : d && (
        <>
          {/* ---------- Bango kuu ---------- */}
          <section className="dl-hero">
            <div className="dl-hero-main">
              {rev ? <>
                <span className="dl-eyebrow">Mapato ya CoopLink · kipindi hiki</span>
                <strong className="dl-big">{money(rev.in_range)}</strong>
                <Delta now={Number(rev.in_range)} prev={Number(rev.prev_range)} />
                <span className="dl-sub">Malipo {nfmt(rev.payments_in_range)} yaliyothibitishwa · {range.from} → {range.to}</span>
              </> : <>
                <span className="dl-eyebrow">Vyama vipya · kipindi hiki</span>
                <strong className="dl-big">{nfmt(d.amcos.new_in_range)}</strong>
                <Delta now={d.amcos.new_in_range} prev={d.amcos.new_prev} />
                <span className="dl-sub">{range.from} → {range.to}</span>
              </>}
            </div>
            <div className="dl-hero-chart">
              <span className="dl-eyebrow">{rev ? 'Mapato' : 'Vyama vipya'} · miezi 12</span>
              <Spark values={d.series.map((s) => Number(rev ? s.revenue ?? 0 : s.new_amcos))} label={rev ? 'Mwenendo wa mapato miezi 12' : 'Vyama vipya miezi 12'} />
            </div>
            <div className="dl-hero-stats">
              <Link to="/owner/amcos" className="dl-stat"><span>Vyama hai</span><b>{nfmt(d.amcos.active)}<small> / {nfmt(d.amcos.total)}</small></b><em>+{nfmt(d.amcos.new_in_range)} kipindi hiki</em></Link>
              <Link to="/owner/subscriptions" className="dl-stat"><span>Subscriptions hai</span><b>{nfmt(d.subscriptions.active)}</b><em>{nfmt(d.subscriptions.trial)} kwenye trial</em></Link>
              <div className="dl-stat"><span>Watumiaji wa vyama</span><b>{nfmt(d.users.active)}</b><em>{nfmt(d.users.logged_in_range)} waliingia kipindi hiki</em></div>
              {rev && <Link to="/owner/finance" className="dl-stat"><span>Mapato ya mwezi huu</span><b>{money(rev.this_month)}</b><em>Mwaka: {money(rev.this_year)}</em></Link>}
            </div>
          </section>

          {/* ---------- Kazi zinazokusubiri ---------- */}
          <section className="dl-block">
            <div className="dl-h"><h2>Kazi zinazokusubiri</h2>{tasks.data?.total ? <span className="dl-count">{tasks.data.total}</span> : null}</div>
            {!tasks.data ? <Loading /> : tasks.data.items.length === 0 ? (
              <div className="dl-clear">✅ <span><b>Kila kitu kiko sawa.</b> Hakuna kazi inayokusubiri kwa sasa.</span></div>
            ) : (
              <div className="dl-tasks">{tasks.data.items.map((t) => (
                <Link key={t.key} to={t.to} className={`dl-task ${t.tone}`}>
                  <b className="dl-task-n">{t.count}</b>
                  <span className="dl-task-t"><b>{t.title}</b><span>{t.detail}</span></span>
                  <span className="dl-go" aria-hidden="true">→</span>
                </Link>
              ))}</div>
            )}
          </section>

          {/* ---------- Mwenendo + hali ---------- */}
          <div className="dl-grid">
            <section className="card dl-card">
              <div className="dl-h">
                <h2>Mwenendo wa miezi 12</h2>
                <Tabs value={trendKey} onChange={setTrend} items={[...(rev ? [['revenue', 'Mapato']] as ['revenue', string][] : []), ['amcos', 'Vyama vipya'], ['subs', 'Subscriptions']]} />
              </div>
              {trendKey === 'revenue' && <LineChart title="Mapato kwa mwezi" data={d.series} xKey="month" height={260} series={[{ key: 'revenue', label: 'Mapato (TSh)', color: '#1F7A52' }]} />}
              {trendKey === 'amcos' && <BarChart title="Vyama vipya kwa mwezi" data={d.series} xKey="month" height={260} series={[{ key: 'new_amcos', label: 'Vyama vipya', color: '#0B2F23' }]} />}
              {trendKey === 'subs' && <BarChart title="Subscriptions mpya kwa mwezi" data={d.series} xKey="month" height={260}
                series={[{ key: 'new_paid_subs', label: 'Za kulipia', color: '#1F7A52' }, { key: 'new_trials', label: 'Trial', color: '#E3A83A' }]} />}
            </section>

            <section className="card dl-card">
              <div className="dl-h"><h2>Hali ya vyama</h2><Link to="/owner/amcos" className="dl-link">Vyote →</Link></div>
              <Split total={d.amcos.total} parts={[
                { label: 'Hai', value: d.amcos.active, cls: 's-ok', to: '/owner/amcos?status=ACTIVE' },
                { label: 'Vinasubiri idhini', value: d.amcos.pending, cls: 's-warn', to: '/owner/amcos?status=PENDING' },
                { label: 'Vimesitishwa', value: d.amcos.suspended, cls: 's-bad', to: '/owner/amcos?status=SUSPENDED' },
                { label: 'Vimekataliwa', value: d.amcos.rejected, cls: 's-mute' },
              ]} />
              <div className="dl-h dl-h-sub"><h2>Subscriptions</h2><Link to="/owner/subscriptions" className="dl-link">Fungua →</Link></div>
              <Split total={subsTotal} parts={[
                { label: 'Hai (za kulipia)', value: d.subscriptions.active, cls: 's-ok' },
                { label: 'Trial', value: d.subscriptions.trial, cls: 's-gold' },
                { label: 'Kwenye grace', value: d.subscriptions.past_due, cls: 's-warn' },
                { label: 'Zimeisha', value: d.subscriptions.expired, cls: 's-bad' },
              ]} />
              {d.subscriptions.expiring > 0 && (
                <Link to="/owner/subscriptions" className="dl-note">⏳ <span><b>{d.subscriptions.expiring}</b> zitaisha ndani ya siku {d.subscriptions.expiringWindowDays} — wakumbushe walipie mapema</span></Link>
              )}
            </section>
          </div>

          {/* ---------- Shughuli + mfumo ---------- */}
          <div className="dl-grid">
            <section className="card dl-card">
              <div className="dl-h"><h2>Shughuli za karibuni</h2></div>
              {d.recent.length === 0 ? <p className="muted">Bado hakuna shughuli.</p> : (
                <ol className="dl-feed">{d.recent.map((r) => (
                  <li key={`${r.kind}-${r.ref}`}>
                    <span className={`dl-feed-ic k-${r.kind.toLowerCase()}`} aria-hidden="true">{KIND[r.kind].ic}</span>
                    <Link to={KIND[r.kind].to(r)} className="dl-feed-t">
                      <span className="muted st-small">{KIND[r.kind].verb(r)}</span>
                      <b>{r.title}</b>
                      {r.detail && <span className="muted st-small">{r.detail}</span>}
                    </Link>
                    <span className="dl-feed-r">
                      {r.amount && <b>{money(r.amount)}</b>}
                      <span className="muted st-small">{dateTime(r.at)}</span>
                    </span>
                  </li>
                ))}</ol>
              )}
            </section>

            <div className="dl-side">
              {rev && (
                <section className="card dl-card">
                  <div className="dl-h"><h2>Mapato kwa muhtasari</h2>{has('finance.read') && <Link to="/owner/finance" className="dl-link">Finance →</Link>}</div>
                  <dl className="dl-money">
                    <dt>Mwezi huu</dt><dd>{money(rev.this_month)}</dd>
                    <dt>Mwaka huu</dt><dd>{money(rev.this_year)}</dd>
                    <dt>Tangu mwanzo</dt><dd><b>{money(rev.all_time)}</b></dd>
                  </dl>
                  <p className="muted st-small" style={{ margin: '8px 0 0' }}>Malipo {nfmt(rev.payments)} yaliyothibitishwa · mapato ya CoopLink pekee (si fedha za vyama)</p>
                </section>
              )}
              <section className="card dl-card">
                <div className="dl-h"><h2>Hali ya mfumo</h2><Link to="/owner/system" className="dl-link">Maelezo →</Link></div>
                <ul className="dl-health">
                  <li><i className="ok" /><span>Database</span><b>{d.health.dbMs} ms</b></li>
                  <li><i className={d.health.errors_24h ? 'bad' : 'ok'} /><span>Makosa (saa 24)</span><b>{d.health.errors_24h || 'Hakuna'}</b></li>
                  <li><i className={!d.health.last_job_status ? 'mute' : d.health.last_job_status === 'FAILED' ? 'bad' : 'ok'} /><span>Kazi ya mwisho</span><b>{d.health.last_job_at ? dateTime(d.health.last_job_at) : 'Bado'}</b></li>
                  <li><i className={d.health.maintenance ? 'warn' : 'ok'} /><span>Maintenance</span><b>{d.health.maintenance ? 'Imewashwa' : 'Imezimwa'}</b></li>
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
