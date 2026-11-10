// =====================================================================
//  SYSTEM CONTROL CENTER — tab za ufuatiliaji: Tahadhari, Uptime, Integrations, Kazi za nyuma, Makosa, Swichi
// =====================================================================
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, TextField } from '../components/ui';
import { ConfirmDialog, Pill, Section } from '../components/owner-ui';

const ago = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) { const m = Math.round(-s / 60); return m < 60 ? `baada ya dk ${m}` : `baada ya saa ${Math.round(m / 60)}`; }
  if (s < 60) return 'sasa hivi';
  if (s < 3600) return `dk ${Math.round(s / 60)} zilizopita`;
  if (s < 86400) return `saa ${Math.round(s / 3600)} zilizopita`;
  return `siku ${Math.round(s / 86400)} zilizopita`;
};
const ms = (v: number | null | undefined) => (v == null ? '—' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);

// ---------------------------------------------------------------------
//  TAHADHARI
// ---------------------------------------------------------------------
interface AlertRow { id: string; key: string; kind: string; severity: 'CRITICAL' | 'WARNING'; title: string; body: string | null; count: number; firstAt: string; lastAt: string; resolvedAt: string | null; autoResolved: boolean; ackAt: string | null; notifiedAt: string | null }
const KIND: Record<string, string> = { ERROR_SPIKE: 'Makosa mengi', JOB_FAILED: 'Kazi imeshindwa', JOB_STALE: 'Kazi imesimama', PAYMENT_STUCK: 'Malipo yamekwama', DB_SLOW: 'Database inachelewa', DOWNTIME: 'Mfumo ulikuwa nje ya hewa' };

export function AlertsTab({ onChange }: { onChange: () => void }) {
  const { has } = useAuth();
  const [state, setState] = useState<'open' | 'all'>('open');
  const { data, loading, reload } = useFetch<{ data: AlertRow[] }>('/owner/system/alerts', { state });
  const act = useAction();
  const run = useAction();
  const ack = async (id: string) => { if (await act.run(() => api(`/owner/system/alerts/${id}/ack`, { method: 'POST' }))) { reload(); onChange(); } };
  return (
    <div className="stack">
      <div className="sc-bar">
        <div className="seg" role="tablist">
          <button className={state === 'open' ? 'on' : ''} onClick={() => setState('open')}>Zilizo wazi</button>
          <button className={state === 'all' ? 'on' : ''} onClick={() => setState('all')}>Historia yote</button>
        </div>
        {has('system.manage') && <Button size="sm" variant="secondary" busy={run.busy} onClick={async () => { if (await run.run(() => api('/owner/system/jobs/system.monitor/run', { method: 'POST' }))) { reload(); onChange(); } }}>Kagua sasa</Button>}
      </div>
      <Alert>{act.error ?? run.error}</Alert>
      <p className="muted sc-note">Mfumo unajikagua kila dakika 5. Tahadhari mpya ya <b>Hatari</b> inatumwa kwa SMS kwa Owner na Tech Support (SMS zikiwa zimewekwa). Hali ikirudi sawa, tahadhari inajifunga yenyewe.</p>
      {loading && !data ? <Loading /> : !data?.data.length ? (
        <div className="sc-allgood"><span>✓</span><strong>{state === 'open' ? 'Hakuna tahadhari iliyo wazi' : 'Bado hakuna tahadhari'}</strong><p>Mfumo uko sawa.</p></div>
      ) : (
        <div className="sc-alerts">{data.data.map((a) => (
          <article key={a.id} className={`sc-alert ${a.severity.toLowerCase()}${a.resolvedAt ? ' done' : ''}`}>
            <div className="sc-alert-ico" aria-hidden="true">{a.resolvedAt ? '✓' : a.severity === 'CRITICAL' ? '!' : '⚠'}</div>
            <div className="sc-alert-main">
              <div className="sc-alert-top">
                <span className={`sc-sev ${a.severity.toLowerCase()}`}>{a.severity === 'CRITICAL' ? 'Hatari' : 'Onyo'}</span>
                <span className="muted">{KIND[a.kind] ?? a.kind}</span>
                {a.count > 1 && <span className="muted">· imeonekana mara {a.count}</span>}
                {a.notifiedAt && <span className="muted">· SMS imetumwa</span>}
              </div>
              <strong>{a.title}</strong>
              {a.body && <p>{a.body}</p>}
              <small className="muted">Ilianza {dateTime(a.firstAt)} · mara ya mwisho {ago(a.lastAt)}
                {a.resolvedAt ? ` · ${a.autoResolved ? 'imejifunga yenyewe' : 'imefungwa'} ${dateTime(a.resolvedAt)}` : a.ackAt ? ' · umeiona' : ''}</small>
            </div>
            {!a.resolvedAt && !a.ackAt && has('system.manage') && <Button size="sm" variant="ghost" onClick={() => ack(a.id)}>Nimeona</Button>}
          </article>
        ))}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
//  UPTIME
// ---------------------------------------------------------------------
interface Uptime { days: { date: string; expected: number; ok: number; pct: number | null; avgDbMs: number | null }[]; pct: number | null; incidents: { from: string; to: string; minutes: number }[]; lastCheck: { bucket: string; dbMs: number; version: string | null; checkedAt: string } | null; avgDbMs24h: number | null; since: string | null }
const tone = (p: number | null) => (p == null ? 'none' : p >= 99.5 ? 'ok' : p >= 97 ? 'warn' : 'bad');

export function UptimeTab() {
  const [days, setDays] = useState(30);
  const { data, loading } = useFetch<Uptime>('/owner/system/uptime', { days });
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return (
    <div className="stack">
      <div className="sc-bar">
        <div className="seg">{[7, 30, 90].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>Siku {d}</button>)}</div>
      </div>
      <div className="grid grid-kpi">
        <div className={`card kpi sc-up ${tone(data.pct)}`}><span className="label">Uptime (siku {days})</span><span className="value">{data.pct == null ? '—' : `${data.pct}%`}</span><span className="hint">{data.since ? `Ufuatiliaji ulianza ${dateTime(data.since)}` : 'Bado hakuna ukaguzi'}</span></div>
        <div className="card kpi"><span className="label">Ukaguzi wa mwisho</span><span className="value sc-small">{ago(data.lastCheck?.checkedAt)}</span><span className="hint">{data.lastCheck ? `Database ${ms(data.lastCheck.dbMs)}${data.lastCheck.version ? ` · v${data.lastCheck.version}` : ''}` : '—'}</span></div>
        <div className="card kpi"><span className="label">Kasi ya database (saa 24)</span><span className="value sc-small">{ms(data.avgDbMs24h)}</span><span className="hint">Wastani wa ukaguzi wote</span></div>
        <div className={`card kpi ${data.incidents.length ? 'kpi-warn' : ''}`}><span className="label">Matukio ya kukatika</span><span className="value sc-small">{data.incidents.length}</span><span className="hint">Mapengo ya zaidi ya dk 10</span></div>
      </div>
      <Section title="Kila siku">
        <div className={`sc-bars d${days}`} role="img" aria-label="Uptime kwa kila siku">
          {data.days.map((d) => (
            <span key={d.date} className={`sc-day ${tone(d.pct)}`} title={`${d.date}: ${d.pct == null ? 'hakuna data' : `${d.pct}% (${d.ok}/${d.expected} ukaguzi)`}${d.avgDbMs != null ? ` · DB ${d.avgDbMs} ms` : ''}`} />
          ))}
        </div>
        <div className="sc-bars-legend"><span>{data.days[0]?.date}</span><span><i className="ok" /> 99.5%+ <i className="warn" /> 97%+ <i className="bad" /> chini <i className="none" /> hakuna data</span><span>Leo</span></div>
      </Section>
      <Section title="Matukio ya kukatika" pad={false}>
        {!data.incidents.length ? <Empty>Hakuna kukatika kulikorekodiwa katika kipindi hiki.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Kuanzia</th><th>Hadi</th><th className="num">Muda</th></tr></thead>
            <tbody>{data.incidents.map((i) => <tr key={i.to}><td>{dateTime(i.from)}</td><td>{dateTime(i.to)}</td><td className="num">{i.minutes >= 60 ? `saa ${(i.minutes / 60).toFixed(1)}` : `dk ${i.minutes}`}</td></tr>)}</tbody>
          </table></div>
        )}
      </Section>
      <p className="muted sc-note">Kipindi cha dakika 5 kisicho na ukaguzi kinahesabiwa kuwa mfumo haukuwa hewani (server imezimwa, deploy ndefu au database haipatikani). Deploy ya kawaida huchukua chini ya dakika 5.</p>
    </div>
  );
}

// ---------------------------------------------------------------------
//  INTEGRATIONS
// ---------------------------------------------------------------------
interface Integ { key: string; name: string; role: string; configured: boolean; parts: Record<string, boolean>; switchOn: boolean; stats: Record<string, string | number | null>; test: { ok: boolean; message: string; at: string; ms: number } | null; testable: boolean }
const STAT_LABEL: Record<string, string> = { lastOk: 'Mafanikio ya mwisho', ok24: 'Yaliyofanikiwa (saa 24)', failed24: 'Yaliyoshindwa (saa 24)', pending: 'Yanayosubiri sasa', lastWebhook: 'Webhook ya mwisho', webhooks24: 'Webhooks (saa 24)', checks24: 'Maombi (saa 24)', found24: 'Majina yaliyopatikana (saa 24)', lastCheck: 'Ombi la mwisho' };
const isTime = (k: string) => ['lastOk', 'lastWebhook', 'lastCheck'].includes(k);

export function IntegrationsTab() {
  const { has } = useAuth();
  const { data, loading, reload } = useFetch<{ data: Integ[] }>('/owner/system/integrations');
  const act = useAction();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const test = async (key: string) => { setBusyKey(key); await act.run(() => api(`/owner/system/integrations/${key}/test`, { method: 'POST' })); setBusyKey(null); reload(); };
  return (
    <div className="stack">
      <Alert>{act.error}</Alert>
      <p className="muted sc-note">Siri (API keys, webhook secrets) hazionyeshwi — inaonyeshwa tu kama zimewekwa kwenye Railway Variables. "Jaribu muunganiko" haikati pesa: TeePay/Abliner zinaulizwa ombi la kusoma tu; SMS inatumwa kwenye namba yako.</p>
      <div className="sc-integ">{data?.data.map((i) => {
        const state = !i.configured ? 'off' : !i.switchOn ? 'paused' : i.test && !i.test.ok ? 'bad' : Number(i.stats.failed24 ?? 0) > 0 || Number(i.stats.pending ?? 0) > 0 ? 'warn' : 'ok';
        const label = { off: 'Haijawekwa', paused: 'Imesitishwa (swichi)', bad: 'Jaribio limeshindwa', warn: 'Inafanya kazi — angalia', ok: 'Inafanya kazi' }[state];
        return (
          <section key={i.key} className={`card sc-int ${state}`}>
            <header><div><h3>{i.name}</h3><p className="muted">{i.role}</p></div><span className={`sc-dot ${state}`}>{label}</span></header>
            {Object.keys(i.parts).length > 0 && <div className="sc-parts">{Object.entries(i.parts).map(([k, v]) => <span key={k} className={v ? 'yes' : 'no'}>{v ? '✓' : '✕'} {k}</span>)}</div>}
            {i.configured && Object.keys(i.stats).length > 0 && (
              <dl className="sc-stats">{Object.entries(i.stats).map(([k, v]) => <div key={k}><dt>{STAT_LABEL[k] ?? k}</dt><dd className={k === 'failed24' && Number(v) > 0 ? 'money-neg' : k === 'pending' && Number(v) > 0 ? 'warn-ink' : undefined}>{isTime(k) ? ago(v as string | null) : String(v ?? 0)}</dd></div>)}</dl>
            )}
            {i.test && <p className={`sc-test ${i.test.ok ? 'ok' : 'bad'}`}>{i.test.ok ? '✓' : '✕'} {i.test.message} <span className="muted">· {ago(i.test.at)} · {ms(i.test.ms)}</span></p>}
            {i.testable && has('system.manage') && <Button size="sm" variant="secondary" busy={busyKey === i.key} onClick={() => test(i.key)}>{i.key === 'sms' ? 'Tuma SMS ya majaribio kwangu' : 'Jaribu muunganiko'}</Button>}
          </section>
        );
      })}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
//  KAZI ZA NYUMA
// ---------------------------------------------------------------------
interface Job { name: string; label: string; desc: string; everyMin: number; lastRun: { status: string; startedAt: string; finishedAt: string | null; details: Record<string, unknown> | null } | null; lastOk: string | null; failed24: number; runs24: number; avgMs: number | null; nextAt: string | null; history: boolean }
interface Run { id: string; status: string; startedAt: string; finishedAt: string | null; ms: number | null; details: Record<string, unknown> | null }

export function JobsTab() {
  const { has } = useAuth();
  const { data, loading, reload } = useFetch<{ enabled: boolean; data: Job[] }>('/owner/system/jobs');
  const act = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [hist, setHist] = useState<Job | null>(null);
  if (loading && !data) return <Loading />;
  const run = async (name: string) => { setBusy(name); await act.run(() => api(`/owner/system/jobs/${name}/run`, { method: 'POST' })); setBusy(null); reload(); };
  return (
    <div className="stack">
      {data && !data.enabled && <Alert kind="warn">Kazi za nyuma zimezimwa kwenye server hii (DISABLE_JOBS=true). Zinaendeshwa kwa mkono tu.</Alert>}
      <Alert>{act.error}</Alert>
      <div className="sc-jobs">{data?.data.map((j) => (
        <section key={j.name} className="card sc-job">
          <header>
            <div><h3>{j.label} <code>{j.name}</code></h3><p className="muted">{j.desc}</p></div>
            {j.lastRun ? <Pill value={j.lastRun.status} /> : <Pill value="SKIPPED" label="Bado" />}
          </header>
          <dl className="sc-stats">
            <div><dt>Inaendeshwa</dt><dd>kila {j.everyMin >= 60 ? `saa ${j.everyMin / 60}` : `dk ${j.everyMin}`}</dd></div>
            <div><dt>Mara ya mwisho</dt><dd>{ago(j.lastRun?.startedAt)}</dd></div>
            <div><dt>Mafanikio ya mwisho</dt><dd>{ago(j.lastOk)}</dd></div>
            <div><dt>Ijayo</dt><dd>{data.enabled ? ago(j.nextAt) : '—'}</dd></div>
            <div><dt>Muda wa wastani</dt><dd>{ms(j.avgMs)}</dd></div>
            <div><dt>Saa 24</dt><dd>{j.runs24} {j.failed24 > 0 && <span className="money-neg">· {j.failed24} zimeshindwa</span>}</dd></div>
          </dl>
          {j.lastRun?.details && <p className="sc-details">{Object.entries(j.lastRun.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</p>}
          <div className="sc-actions">
            {has('system.manage') && <Button size="sm" variant="secondary" busy={busy === j.name} onClick={() => run(j.name)}>Endesha sasa</Button>}
            {j.history && <Button size="sm" variant="ghost" onClick={() => setHist(j)}>Historia</Button>}
          </div>
        </section>
      ))}</div>
      {hist && <JobHistory job={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function JobHistory({ job, onClose }: { job: Job; onClose: () => void }) {
  const { data } = useFetch<{ data: Run[] }>(`/owner/system/jobs/${job.name}/runs`);
  return (
    <Modal open title={`Historia: ${job.label}`} onClose={onClose}>
      {!data ? <Loading /> : !data.data.length ? <Empty>Bado haijaendeshwa.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Hali</th><th className="num">Muda</th><th>Matokeo</th></tr></thead>
          <tbody>{data.data.map((r) => (
            <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(r.startedAt)}</td><td><Pill value={r.status} /></td><td className="num">{ms(r.ms)}</td>
              <td className="muted" style={{ fontSize: 12 }}>{r.details ? Object.entries(r.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  MAKOSA (yameunganishwa)
// ---------------------------------------------------------------------
interface Group { fp: string; method: string; path: string; message: string; n: number; users: number; first_at: string; last_at: string; open: number }
interface Occ { id: string; method: string; path: string; status: number; message: string; stack: string | null; createdAt: string; resolvedAt: string | null; user: string | null; role: string | null }

export function ErrorsTab({ onChange }: { onChange: () => void }) {
  const { has } = useAuth();
  const [days, setDays] = useState(7);
  const [state, setState] = useState<'open' | 'resolved' | 'all'>('open');
  const { data, loading, reload } = useFetch<{ data: Group[]; totals: { n: number; groups: number }; hourly: { h: string; n: number }[] }>('/owner/system/errors/groups', { days, state });
  const [open, setOpen] = useState<Group | null>(null);
  const act = useAction();
  // Saa 24 kamili (saa zisizo na kosa = 0), ya zamani kushoto -> sasa kulia (saa za Tanzania)
  const nowH = new Date(Date.now() + 3 * 3_600_000).getUTCHours();
  const slots = Array.from({ length: 24 }, (_, i) => {
    const h = String((nowH - 23 + i + 24) % 24).padStart(2, '0');
    return { h, n: data?.hourly.find((x) => x.h === h)?.n ?? 0 };
  });
  const max = Math.max(1, ...slots.map((x) => x.n));
  const resolve = async (g: Group) => { if (await act.run(() => api(`/owner/system/errors/groups/${g.fp}/resolve`, { method: 'POST' }))) { setOpen(null); reload(); onChange(); } };
  return (
    <div className="stack">
      <div className="sc-bar">
        <div className="seg">{[1, 7, 30].map((d) => <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{d === 1 ? 'Saa 24' : `Siku ${d}`}</button>)}</div>
        <div className="seg">{([['open', 'Hayajarekebishwa'], ['resolved', 'Yamerekebishwa'], ['all', 'Yote']] as const).map(([k, l]) => <button key={k} className={state === k ? 'on' : ''} onClick={() => setState(k)}>{l}</button>)}</div>
      </div>
      <Alert>{act.error}</Alert>
      {data && (
        <div className="grid grid-2">
          <div className="card kpi"><span className="label">Makosa yasiyorekebishwa</span><span className="value">{data.totals.n}</span><span className="hint">Aina {data.totals.groups} tofauti</span></div>
          <div className="card kpi sc-spark-card"><span className="label">Saa 24 zilizopita</span>
            <div className="sc-spark" aria-label="Makosa kwa saa">{slots.map((x) => <span key={x.h} className={x.n ? '' : 'zero'} style={{ height: x.n ? `${Math.max(8, (x.n / max) * 100)}%` : '3px' }} title={`Saa ${x.h}:00 — makosa ${x.n}`} />)}</div>
            <div className="sc-spark-axis"><span>saa 24 zilizopita</span><span>sasa</span></div>
          </div>
        </div>
      )}
      <section className="card">
        {loading && !data ? <Loading /> : !data?.data.length ? <Empty>{state === 'open' ? 'Hakuna kosa lisilorekebishwa katika kipindi hiki. 🎉' : 'Hakuna.'}</Empty> : (
          <ul className="sc-errs">{data.data.map((g) => (
            <li key={g.fp}>
              <button type="button" className={`sc-err${g.open ? '' : ' done'}`} onClick={() => setOpen(g)}>
                <span className="sc-err-n">{g.n}×</span>
                <span className="sc-err-main"><strong>{g.message}</strong><code>{g.method} {g.path}</code></span>
                <span className="sc-err-side"><span>{ago(g.last_at)}</span><small className="muted">{g.users ? `watumiaji ${g.users}` : 'hakuna mtumiaji'} · tangu {dateTime(g.first_at)}</small></span>
              </button>
            </li>
          ))}</ul>
        )}
      </section>
      {open && <ErrorDetail g={open} canManage={has('system.manage')} busy={act.busy} onResolve={() => resolve(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ErrorDetail({ g, canManage, busy, onResolve, onClose }: { g: Group; canManage: boolean; busy: boolean; onResolve: () => void; onClose: () => void }) {
  const { data } = useFetch<{ data: Occ[] }>(`/owner/system/errors/groups/${g.fp}`);
  const [i, setI] = useState(0);
  const o = data?.data[i];
  return (
    <Modal open title="Kosa la mfumo" onClose={onClose} footer={<>{canManage && g.open > 0 && <Button busy={busy} onClick={onResolve}>✓ Limerekebishwa</Button>}<Button variant="secondary" onClick={onClose}>Funga</Button></>}>
      <p style={{ marginTop: 0 }}><strong>{g.message}</strong></p>
      <p className="muted" style={{ fontSize: 13 }}><code>{g.method} {g.path}</code> · mara {g.n} · watumiaji {g.users}</p>
      {!data ? <Loading /> : o && (
        <>
          <div className="sc-occ-nav">
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← Jipya zaidi</Button>
            <span className="muted">{i + 1} / {data.data.length}</span>
            <Button size="sm" variant="ghost" disabled={i >= data.data.length - 1} onClick={() => setI(i + 1)}>Ya zamani →</Button>
          </div>
          <dl className="tk-dl">
            <dt>Wakati</dt><dd>{dateTime(o.createdAt)}</dd>
            <dt>Njia</dt><dd><code>{o.method} {o.path}</code></dd>
            <dt>Mtumiaji</dt><dd>{o.user ? `${o.user} (${o.role})` : '—'}</dd>
            <dt>Hali</dt><dd>{o.resolvedAt ? `Limerekebishwa ${dateTime(o.resolvedAt)}` : 'Halijarekebishwa'}</dd>
          </dl>
          {o.stack && <pre className="sc-stack">{o.stack}</pre>}
        </>
      )}
      <p className="muted" style={{ fontSize: 12 }}>"Limerekebishwa" linaweka kosa hili kando. Likitokea tena, litaonekana upya.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------
//  SWICHI ZA DHARURA
// ---------------------------------------------------------------------
type SwKey = 'mobilePayments' | 'sms' | 'farmerPortal' | 'nameLookup';
const SWITCHES: { key: SwKey; title: string; on: string; off: string }[] = [
  { key: 'mobilePayments', title: 'Malipo ya ada kwa simu', on: 'Vyama vinalipa ada ya CoopLink kwa M-Pesa, Airtel Money, Mixx by Yas na HaloPesa.', off: 'Maombi mapya ya kulipa yanakataliwa. Malipo yaliyokwisha anza bado yanahakikiwa. Vyama havifungwi kwa kutolipa wakati huu.' },
  { key: 'sms', title: 'Kutuma SMS', on: 'Matangazo, tahadhari kwa Owner na nenosiri la muda vinatumwa kwa SMS.', off: 'Hakuna SMS inayotumwa — zote zinarekodiwa kama "Imerukwa".' },
  { key: 'farmerPortal', title: 'Portal ya wakulima (vyama vyote)', on: 'Wakulima wa vyama vilivyowasha portal wanaingia /mkulima.', off: 'Hakuna mkulima anayeweza kuingia, hata kama Meneja ameiwasha. PIN zinabaki.' },
  { key: 'nameLookup', title: 'Kuthibitisha jina la mwenye namba', on: 'Fomu zinajaza jina la mwenye namba ya simu kutoka Abliner.', off: 'Majina yanaandikwa kwa mkono kwenye fomu.' },
];

export function SwitchesTab() {
  const { has } = useAuth();
  const { data, loading, reload } = useFetch<{ switches: Record<SwKey, boolean>; changes: Record<string, { action: string; at: string; by: string | null; reason: string | null }> }>('/owner/system/switches');
  const [target, setTarget] = useState<{ key: SwKey; enabled: boolean } | null>(null);
  const [reason, setReason] = useState('');
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const sw = SWITCHES.find((x) => x.key === target?.key);
  return (
    <div className="stack">
      <p className="muted sc-note">Tumia swichi hizi wakati wa dharura tu (mf. mtoa huduma wa malipo ana tatizo, au SMS zinatumwa vibaya). Kila badiliko linahitaji nenosiri lako na linaandikwa kwenye Security &amp; Audit. Inachukua hadi sekunde 15 kufika kwenye server zote.</p>
      <div className="sc-switches">{SWITCHES.map((s) => {
        const on = data.switches[s.key];
        const ch = data.changes[s.key];
        return (
          <section key={s.key} className={`card sc-switch ${on ? 'on' : 'off'}`}>
            <header>
              <h3>{s.title}</h3>
              <span className={`sc-dot ${on ? 'ok' : 'bad'}`}>{on ? 'Inafanya kazi' : 'IMESITISHWA'}</span>
            </header>
            <p>{on ? s.on : s.off}</p>
            {ch && <small className="muted">{ch.action === 'SWITCH_OFF' ? 'Ilizimwa' : 'Iliwashwa'} na {ch.by ?? '—'} {dateTime(ch.at)}{ch.reason ? ` · "${ch.reason}"` : ''}</small>}
            {has('system.manage') && <Button size="sm" variant={on ? 'danger' : 'primary'} onClick={() => { setReason(''); setTarget({ key: s.key, enabled: !on }); }}>{on ? 'Sitisha' : 'Washa tena'}</Button>}
          </section>
        );
      })}</div>
      <ConfirmDialog open={!!target} danger={target ? !target.enabled : false} title={target?.enabled ? `Washa: ${sw?.title}` : `Sitisha: ${sw?.title}`} confirmLabel={target?.enabled ? 'Washa' : 'Sitisha'}
        message={target?.enabled ? sw?.on : sw?.off} onClose={() => setTarget(null)}
        onConfirm={async (c) => { await api('/owner/system/switches', { method: 'PUT', body: { key: target!.key, enabled: target!.enabled, reason: reason || undefined, ...c } }); setTarget(null); reload(); }}>
        {target && !target.enabled && <TextField label="Sababu ya kusitisha *" value={reason} onChange={setReason} placeholder="mf. TeePay wana hitilafu, malipo hayafiki" />}
      </ConfirmDialog>
    </div>
  );
}
