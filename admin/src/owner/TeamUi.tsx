// =====================================================================
//  TIMU YA COOPLINK (v0.38): kengele ya kazi, 2FA ya lazima, utendaji wa timu
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, ROLE_LABEL } from '../lib/format';
import { Alert, Loading } from '../components/ui';
import { DateRangeFilter, Kpi, money, presetRange, Section, type Range } from '../components/owner-ui';
import { TwoFactor } from './Settings';

interface Notif { key: string; title: string; detail: string; count: number; to: string; tone: 'bad' | 'warn' | 'info' }

/** Kengele ya kazi: inaangaliwa kila dakika, na kila unapobadili ukurasa. */
export function NotificationBell() {
  const loc = useLocation();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const iv = window.setInterval(() => setTick((x) => x + 1), 60_000); return () => window.clearInterval(iv); }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const { data } = useFetch<{ total: number; items: Notif[] }>('/owner/notifications', { p: loc.pathname, tick });
  const total = data?.total ?? 0;
  const bad = data?.items.some((i) => i.tone === 'bad');
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="bell-btn" aria-label={`Arifa za kazi (${total})`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {total > 0 && <span className={`bell-n ${bad ? 'bad' : ''}`}>{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Arifa za kazi">
          <div className="bell-h"><b>Kazi zinazokusubiri</b><span className="muted st-small">{total ? `${total} kwa jumla` : ''}</span></div>
          {!data ? <Loading /> : data.items.length === 0 ? <p className="bell-empty">Hakuna kazi inayosubiri. 🎉</p> : (
            <ul>{data.items.map((i) => (
              <li key={i.key}><Link to={i.to} className={`tone-${i.tone}`}>
                <span className="bell-c">{i.count}</span><span className="grow"><b>{i.title}</b><span>{i.detail}</span></span>
              </Link></li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Mfanyakazi aliyepita muda bila 2FA: hawezi kuendelea mpaka aiwashe. */
export function TwoFactorGate() {
  const { user } = useAuth();
  return (
    <div className="tfa-gate">
      <div className="tfa-gate-head">
        <span className="tfa-ic" aria-hidden="true">🔐</span>
        <div><h2>Washa 2FA ili kuendelea</h2>
          <p className="muted">Kwa usalama wa pesa na taarifa za vyama, kila mfanyakazi wa CoopLink lazima awe na uthibitisho wa hatua mbili (2FA).
            Muda wa kuiwasha ({user?.twoFactor?.deadline ? date(user.twoFactor.deadline) : ''}) umepita.</p></div>
      </div>
      <ol className="tfa-steps">
        <li>Pakua programu ya uthibitisho kwenye simu yako: <b>Google Authenticator</b> au <b>Microsoft Authenticator</b>.</li>
        <li>Bonyeza "Washa 2FA" hapa chini, kisha piga picha (scan) ya QR code kwa programu hiyo.</li>
        <li>Andika namba 6 zinazoonekana kwenye programu ili kuthibitisha.</li>
      </ol>
      <TwoFactor />
    </div>
  );
}

export function TwoFactorBanner() {
  const { user } = useAuth();
  const t = user?.twoFactor;
  if (!t?.required || t.overdue || !t.deadline) return null;
  const days = Math.max(0, Math.ceil((new Date(t.deadline).getTime() - Date.now()) / 864e5));
  return (
    <div className="tfa-banner" role="status">
      🔐 <span>Washa 2FA kabla ya <b>{dateTime(t.deadline)}</b> ({days === 0 ? 'leo' : `siku ${days} zimebaki`}). Baada ya hapo hutaweza kutumia Owner Panel mpaka uiwashe.</span>
      <Link className="btn btn-sm btn-primary" to="/owner/settings">Washa sasa</Link>
    </div>
  );
}

// ------------------------------ UTENDAJI WA TIMU (Owner) ------------------------------
interface Perf {
  id: string; fullName: string; role: string; jobTitle: string | null; isActive: boolean; lastLoginAt: string | null; totpEnabled: boolean;
  tickets_closed: number; replies: number; first_response_h: string | null; overdue_now: number; csat: number | null; csat_up: number; csat_down: number;
  leads_added: number; lead_contacts: number; leads_won: number; payments_recorded: number; payments_verified: number; verified_amount: string;
  expenses_recorded: number; requests: number; active_days: number;
}
export function PerformanceView() {
  const [range, setRange] = useState<Range>(presetRange('month'));
  const { data, error, loading } = useFetch<{ range: { from: string; to: string }; data: Perf[] }>('/owner/team/performance', { from: range.from, to: range.to });
  const rows = data?.data ?? [];
  const sum = (k: keyof Perf) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return (
    <div className="stack">
      <div className="toolbar" style={{ padding: 0 }}><DateRangeFilter value={range} onChange={setRange} /></div>
      <Alert>{error}</Alert>
      {loading && !data ? <Loading /> : (
        <>
          <div className="grid grid-kpi">
            <Kpi tone="dark" label="Tiketi zilizofungwa" value={sum('tickets_closed')} hint={`Majibu ${sum('replies')}`} />
            <Kpi tone="gold" label="Leads zilizokuwa wateja" value={sum('leads_won')} hint={`Simu/vikao ${sum('lead_contacts')}`} />
            <Kpi label="Malipo yaliyothibitishwa" value={sum('payments_verified')} hint={money(sum('verified_amount'))} />
            <Kpi tone={sum('overdue_now') ? 'warn' : undefined} label="Tiketi zilizochelewa sasa" value={sum('overdue_now')} />
          </div>
          {rows.length === 0 ? <p className="muted">Bado hakuna wafanyakazi.</p> : (
            <div className="perf-grid">{rows.map((r) => (
              <Section key={r.id} title={<>{r.fullName} <span className="muted st-small">· {ROLE_LABEL[r.role] ?? r.role}</span></>}>
                <div className="perf-meta muted st-small">
                  {r.lastLoginAt ? `Aliingia ${dateTime(r.lastLoginAt)}` : 'Hajawahi kuingia'} · siku hai {r.active_days} · {r.totpEnabled ? '2FA ✓' : '2FA haijawashwa'}
                </div>
                <dl className="perf">
                  {(r.tickets_closed || r.replies || r.overdue_now || r.first_response_h) ? <>
                    <dt>Tiketi zilizofungwa</dt><dd>{r.tickets_closed}</dd>
                    <dt>Majibu kwa vyama</dt><dd>{r.replies}</dd>
                    <dt>Muda wa jibu la kwanza</dt><dd>{r.first_response_h ? `saa ${r.first_response_h}` : '—'}</dd>
                    <dt>Zilizochelewa sasa</dt><dd className={r.overdue_now ? 'money-neg' : ''}>{r.overdue_now}</dd>
                    <dt>Kuridhika kwa wateja</dt><dd>{r.csat === null ? '—' : `${r.csat}% (👍 ${r.csat_up} · 👎 ${r.csat_down})`}</dd>
                  </> : null}
                  {(r.leads_added || r.lead_contacts || r.leads_won) ? <>
                    <dt>Leads alizoongeza</dt><dd>{r.leads_added}</dd>
                    <dt>Simu, vikao na SMS</dt><dd>{r.lead_contacts}</dd>
                    <dt>Wamekuwa wateja</dt><dd><b>{r.leads_won}</b></dd>
                  </> : null}
                  {(r.payments_recorded || r.payments_verified || r.expenses_recorded) ? <>
                    <dt>Malipo aliyorekodi</dt><dd>{r.payments_recorded}</dd>
                    <dt>Malipo aliyothibitisha</dt><dd>{r.payments_verified} · {money(r.verified_amount)}</dd>
                    <dt>Matumizi aliyorekodi</dt><dd>{r.expenses_recorded}</dd>
                  </> : null}
                  <dt>Maombi kwa Owner</dt><dd>{r.requests}</dd>
                </dl>
              </Section>
            ))}</div>
          )}
        </>
      )}
    </div>
  );
}
