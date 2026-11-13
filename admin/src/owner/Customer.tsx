// =====================================================================
//  HUDUMA KWA WATEJA NA MASOKO
//   OwnerSuccess  — dashibodi ya kazi: tiketi, leads za leo, vyama hatarini, wanaoanza, makundi ya kulenga
//   CustomerPanel — historia ya mteja ndani ya ukurasa wa chama (afya, tiketi, mawasiliano, lead, maelezo ya timu)
//   AccountHelp   — msaada wa akaunti ya mtumishi wa chama, bila kuona wala kuweka nenosiri
// =====================================================================
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, TextField } from '../components/ui';
import { Kpi, Pill, Section } from '../components/owner-ui';

interface Health {
  atRisk: { id: string; name: string; code: string; region: string | null; idle_days: number; risk: number; fee_overdue: boolean; open_tickets: number; failed_logins: number; members: number }[];
  onboarding: { id: string; name: string; code: string; status: string; created_at: string; staff: number; members: number; steps: boolean[]; progress: number }[];
  totals: { active: number; pending: number; suspended: number; weekly_active: number };
}
interface Segment { key: string; label: string; desc: string; count: number }
const STEPS = ['Imeidhinishwa', 'Watumishi 3', 'Kingilio', 'Wakulima 10+', 'Anatumia wiki hii'];

export function OwnerSuccess() {
  const { user, has } = useAuth();
  const health = useFetch<Health>('/owner/customers/health');
  const support = useFetch<{ open: number; waiting: number; overdue: number; unassigned: number; mine: number; avgFirstHours: string | null }>(has('support.read') ? '/owner/support/summary' : null);
  const leads = useFetch<{ due: number; overdue: number; unassigned: number; mine: number; open: number; conversion90: number | null }>(has('leads.read') ? '/owner/leads/summary' : null);
  const segs = useFetch<{ data: Segment[] }>(has('comms.read') || has('leads.read') ? '/owner/customers/segments' : null);
  const h = health.data;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Habari za asubuhi' : hour < 16 ? 'Habari za mchana' : 'Habari za jioni';
  const s = support.data, l = leads.data;
  return (
    <>
      <PageHead title="Customer Success" sub="Huduma kwa Wateja na Masoko — wateja wenye furaha, wanaotumia mfumo, na wateja wapya" />
      <div className="desk-hello"><div><h2>{hello}, {user?.fullName.split(' ')[0]}</h2><p className="muted">Kazi zinazokusubiri leo</p></div></div>
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Vyama vinavyotumia mfumo wiki hii" value={h ? `${h.totals.weekly_active}/${h.totals.active}` : '…'} hint={h ? `${h.totals.pending} vinasubiri idhini · ${h.totals.suspended} vimesitishwa` : undefined} />
        {s && <Kpi tone={s.overdue ? 'bad' : s.mine ? 'warn' : undefined} label="Tiketi zangu" value={s.mine} hint={`${s.overdue} zimechelewa · ${s.unassigned} bila mhusika`} />}
        {l && <Kpi tone={l.due ? 'warn' : undefined} label="Leads za kufuatilia leo" value={l.due} hint={`${l.open} zinafuatiliwa · ${l.conversion90 ?? '—'}% zinafaulu`} />}
        <Kpi tone={h?.atRisk.length ? 'warn' : 'gold'} label="Vyama hatarini" value={h?.atRisk.length ?? '…'} hint="Havitumii mfumo, ada, au tiketi nyingi" />
      </div>

      <div className="desk-queue">
        {s && <Link className={`dq ${s.overdue ? 'hot' : ''}`} to="/owner/support"><span className="dq-n">{s.overdue}</span><span className="dq-t"><b>Tiketi zilizochelewa</b><span>Jibu la kwanza limepita muda{s.avgFirstHours ? ` · wastani saa ${s.avgFirstHours}` : ''}</span></span></Link>}
        {s && <Link className={`dq ${s.unassigned ? 'warm' : ''}`} to="/owner/support"><span className="dq-n">{s.unassigned}</span><span className="dq-t"><b>Tiketi bila mhusika</b><span>Chukua au gawa kwa mwenzako</span></span></Link>}
        {l && <Link className={`dq ${l.due ? 'hot' : ''}`} to="/owner/leads?due=1"><span className="dq-n">{l.due}</span><span className="dq-t"><b>Leads za leo</b><span>{l.overdue ? `${l.overdue} zimechelewa — piga simu sasa` : 'Piga simu, panga demo'}</span></span></Link>}
        {l && <Link className={`dq ${l.unassigned ? 'warm' : ''}`} to="/owner/leads?assigned=none"><span className="dq-n">{l.unassigned}</span><span className="dq-t"><b>Leads mpya bila mhusika</b><span>Kutoka tovuti — wajibu ndani ya saa 24</span></span></Link>}
      </div>

      <Alert>{health.error}</Alert>
      <div className="grid grid-2">
        <Section title="Vyama hatarini" actions={<span className="muted st-small">Alama ya hatari 0–100</span>}>
          {!h ? <Loading /> : h.atRisk.length === 0 ? <Empty>Vyama vyote viko salama. 🎉</Empty> : (
            <ul className="desk-list risk-list">{h.atRisk.map((r) => (
              <li key={r.id}>
                <span className="grow"><Link to={`/owner/amcos/${r.id}`}><b>{r.name}</b></Link>
                  <span className="risk-tags">
                    {r.idle_days >= 7 && <em>Siku {r.idle_days} bila kuingia</em>}
                    {r.fee_overdue && <em className="bad">Ada imepita muda</em>}
                    {r.open_tickets > 0 && <em>Tiketi {r.open_tickets}</em>}
                    {r.failed_logins >= 5 && <em>Majaribio ya kuingia {r.failed_logins}</em>}
                    {r.members < 10 && <em>Wakulima {r.members}</em>}
                  </span></span>
                <span className={`risk-score ${r.risk >= 60 ? 'bad' : 'warn'}`}>{r.risk}</span>
              </li>
            ))}</ul>
          )}
        </Section>
        <Section title="Wateja wanaoanza (siku 45)">
          {!h ? <Loading /> : h.onboarding.length === 0 ? <Empty>Hakuna mteja mpya kwa sasa.</Empty> : (
            <ul className="desk-list onb-list">{[...h.onboarding].sort((a, b) => a.progress - b.progress).slice(0, 8).map((o) => (
              <li key={o.id}>
                <span className="grow"><Link to={`/owner/amcos/${o.id}`}><b>{o.name}</b></Link><span className="muted st-small">{o.code} · tangu {date(o.created_at)}</span>
                  <span className="onb-steps">{o.steps.map((ok, i) => <i key={i} className={ok ? 'ok' : ''} title={STEPS[i]}>{STEPS[i]}</i>)}</span></span>
                <span className="onb-pct">{o.progress}%</span>
              </li>
            ))}</ul>
          )}
        </Section>
      </div>

      {segs.data && (
        <Section title="Makundi ya wateja (kulenga matangazo)">
          <div className="seg-grid">{segs.data.data.map((g) => (
            <div key={g.key} className="seg">
              <strong>{g.count}</strong><b>{g.label}</b><span className="muted st-small">{g.desc}</span>
              {has('comms.send') && g.count > 0 && <Link className="btn btn-secondary btn-sm" to={`/owner/comms?segment=${g.key}`}>Tuma tangazo</Link>}
            </div>
          ))}</div>
        </Section>
      )}
    </>
  );
}

// ------------------------------ HISTORIA YA MTEJA ------------------------------
interface Profile {
  health: { last_login: string | null; failed_logins_7d: number; logins_30d: number; sms_failed_30d: number; members: number };
  tickets: { id: string; ticketNo: number; subject: string; status: string; priority: string; createdAt: string }[] | null;
  comms: { id: string; title: string; kind: string; at: string; ok: number; failed: number }[] | null;
  lead: { id: string; name: string; source: string; createdAt: string; wonAt: string | null } | null;
}
interface Note { id: string; body: string; pinned: boolean; createdAt: string; by: string | null; role: string | null; mine: boolean }
const TICKET_LABEL: Record<string, string> = { OPEN: 'Wazi', IN_PROGRESS: 'Inashughulikiwa', ANSWERED: 'Imejibiwa', CLOSED: 'Imefungwa' };

export function CustomerPanel({ amcosId }: { amcosId: string }) {
  const { has } = useAuth();
  const prof = useFetch<Profile>(`/owner/customers/${amcosId}/profile`);
  const notes = useFetch<{ data: Note[] }>(`/owner/customers/${amcosId}/notes`);
  const [body, setBody] = useState('');
  const act = useAction();
  const p = prof.data;
  const idle = p?.health.last_login ? Math.floor((Date.now() - new Date(p.health.last_login).getTime()) / 864e5) : null;
  return (
    <div className="grid grid-2" style={{ marginBottom: 16 }}>
      <Section title="Historia ya mteja">
        {!p ? <Loading /> : (
          <div className="stack" style={{ gap: 12 }}>
            <div className="cust-health">
              <div><span className="muted st-small">Mara ya mwisho kuingia</span><strong className={idle !== null && idle > 14 ? 'money-neg' : ''}>{p.health.last_login ? (idle === 0 ? 'Leo' : `Siku ${idle} zilizopita`) : 'Hajawahi'}</strong></div>
              <div><span className="muted st-small">Kuingia (siku 30)</span><strong>{p.health.logins_30d}</strong></div>
              <div><span className="muted st-small">Kuingia kulikoshindwa (siku 7)</span><strong className={p.health.failed_logins_7d >= 5 ? 'money-neg' : ''}>{p.health.failed_logins_7d}</strong></div>
              <div><span className="muted st-small">SMS zilizoshindwa (siku 30)</span><strong>{p.health.sms_failed_30d}</strong></div>
            </div>
            {p.lead && <div className="cust-lead">🌱 Alitoka kwenye lead ya <strong>{p.lead.name}</strong> ({p.lead.source}) · {date(p.lead.createdAt)}{p.lead.wonAt ? ` → mteja ${date(p.lead.wonAt)}` : ''} {has('leads.read') && <Link to={`/owner/leads?id=${p.lead.id}`}>Fungua</Link>}</div>}
            {p.tickets && (<div>
              <h3 className="desk-h3">Tiketi za karibuni</h3>
              {p.tickets.length === 0 ? <p className="muted st-small">Hakuna tiketi.</p> : <ul className="desk-list">{p.tickets.map((t) => (
                <li key={t.id}><span className="grow"><Link to={`/owner/support/${t.id}`}><b>#{t.ticketNo} {t.subject}</b></Link><span className="muted st-small">{dateTime(t.createdAt)}</span></span>
                  <Pill value={t.status === 'CLOSED' ? 'CANCELLED' : t.status === 'ANSWERED' ? 'ACTIVE' : 'PENDING'} label={TICKET_LABEL[t.status] ?? t.status} /></li>
              ))}</ul>}
            </div>)}
            {p.comms && (<div>
              <h3 className="desk-h3">Mawasiliano ya CoopLink</h3>
              {p.comms.length === 0 ? <p className="muted st-small">Hakuna tangazo lililotumwa.</p> : <ul className="desk-list">{p.comms.map((c) => (
                <li key={c.id}><span className="grow"><b>{c.title}</b><span className="muted st-small">{dateTime(c.at)}</span></span>{c.failed > 0 ? <Pill value="FAILED" label={`${c.failed} hazikufika`} /> : <Pill value="SENT" />}</li>
              ))}</ul>}
            </div>)}
          </div>
        )}
      </Section>
      <Section title="Maelezo ya timu" actions={<span className="muted st-small">Yanaonekana kwa timu ya CoopLink tu</span>}>
        <Alert>{act.error}</Alert>
        <div className="note-add">
          <textarea className="input" rows={2} maxLength={1000} placeholder="mf. Meneja anapendelea kupigiwa simu jioni; anahitaji mafunzo ya Stoo…" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Maelezo mapya" />
          <Button busy={act.busy} disabled={body.trim().length < 3} onClick={async () => { if (await act.run(() => api(`/owner/customers/${amcosId}/notes`, { method: 'POST', body: { body } }))) { setBody(''); notes.reload(); } }}>Ongeza</Button>
        </div>
        {!notes.data ? <Loading /> : notes.data.data.length === 0 ? <p className="muted st-small">Bado hakuna maelezo.</p> : (
          <ul className="notes">{notes.data.data.map((n) => (
            <li key={n.id} className={n.pinned ? 'pinned' : ''}>
              <p>{n.body}</p>
              <span className="muted st-small">{n.by ?? '—'} · {dateTime(n.createdAt)}</span>
              {n.mine && <button type="button" className="note-pin" onClick={async () => { await act.run(() => api(`/owner/customers/${amcosId}/notes/${n.id}/pin`, { method: 'PATCH', body: { pinned: !n.pinned } })); notes.reload(); }}>{n.pinned ? '📌 Ondoa' : '📌 Bandika'}</button>}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}

// ------------------------------ MSAADA WA AKAUNTI ------------------------------
interface Diag {
  user: { fullName: string; roleLabel: string; phone: string; isActive: boolean; mustChangePassword: boolean; totpEnabled: boolean; lastLoginAt: string | null };
  sessions: number; devices: number; failed24h: number;
  logins: { success: boolean; reason: string | null; ip: string | null; userAgent: string | null; suspicious: boolean; createdAt: string }[];
  history: { action: string; created_at: string; by: string | null; after: { reason?: string } | null }[];
}
const LOGIN_REASON: Record<string, string> = { OK: 'Ameingia', BAD_PASSWORD: 'Nenosiri si sahihi', INACTIVE: 'Akaunti imezimwa', AMCOS_SUSPENDED: 'Chama kimesitishwa', BAD_2FA: '2FA si sahihi', '2FA_REQUIRED': 'Anahitaji 2FA', FEES_LOCKED: 'Ada haijalipwa', OTP_SENT: 'OTP imetumwa', BAD_OTP: 'OTP si sahihi', UNKNOWN_PHONE: 'Namba haijulikani' };

export function AccountHelp({ amcosId, userId, onClose }: { amcosId: string; userId: string; onClose: () => void }) {
  const { data, error, reload } = useFetch<Diag>(`/owner/customers/${amcosId}/staff/${userId}/diagnostics`);
  const [mode, setMode] = useState<null | 'signout' | 'guide'>(null);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const act = useAction();
  const d = data;
  const run = async () => {
    const body = { reason, ticketNo: ticket ? Number(ticket) : undefined };
    const r = await act.run(() => api<{ sessions?: number; devices?: number; status?: string }>(`/owner/customers/${amcosId}/staff/${userId}/${mode === 'signout' ? 'signout' : 'reset-guide'}`, { method: 'POST', body }));
    if (r) { setOk(mode === 'signout' ? `Ametolewa kwenye vifaa vyote (sessions ${r.sessions}, vifaa ${r.devices}) na amejulishwa kwa SMS.` : 'Maelekezo ya kubadilisha nenosiri yametumwa kwa SMS.'); setMode(null); setReason(''); setTicket(''); reload(); }
  };
  // Portal: modal inafunguliwa juu ya ukurasa mzima (si ndani ya kadi ya watumishi)
  return createPortal(
    <Modal open size="lg" title="Msaada wa akaunti" onClose={onClose}>
      <Alert>{error ?? act.error}</Alert>
      <Alert kind="ok">{ok}</Alert>
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="help-who">
            <span className="st-av" aria-hidden="true">{d.user.fullName.charAt(0)}</span>
            <div className="grow"><b>{d.user.fullName}</b><span className="muted">{d.user.roleLabel} · {d.user.phone}</span></div>
            {d.user.isActive ? <Pill value="ACTIVE" /> : <Pill value="SUSPENDED" label="Imezimwa" />}
          </div>
          <div className="cust-health">
            <div><span className="muted st-small">Mara ya mwisho kuingia</span><strong>{d.user.lastLoginAt ? dateTime(d.user.lastLoginAt) : 'Hajawahi'}</strong></div>
            <div><span className="muted st-small">Majaribio yaliyoshindwa (saa 24)</span><strong className={d.failed24h >= 3 ? 'money-neg' : ''}>{d.failed24h}</strong></div>
            <div><span className="muted st-small">Vifaa / sessions hai</span><strong>{d.devices} / {d.sessions}</strong></div>
            <div><span className="muted st-small">2FA · Nenosiri la muda</span><strong>{d.user.totpEnabled ? 'Ndiyo' : 'Hapana'} · {d.user.mustChangePassword ? 'Ndiyo' : 'Hapana'}</strong></div>
          </div>
          <div className="help-actions">
            <button type="button" className="dq" onClick={() => setMode('guide')} disabled={!d.user.isActive}><span className="dq-n">🔑</span><span className="dq-t"><b>Amesahau nenosiri</b><span>Mtumie SMS ya hatua za "Umesahau nenosiri?" — atabadilisha mwenyewe kwa OTP</span></span></button>
            <button type="button" className="dq" onClick={() => setMode('signout')}><span className="dq-n">📵</span><span className="dq-t"><b>Simu imepotea / mtu mwingine ameingia</b><span>Mtoe kwenye vifaa vyote — ataingia tena kwa nenosiri na OTP</span></span></button>
          </div>
          <p className="muted st-small">🔐 Huduma kwa wateja haioni wala haiweki nenosiri. Kubadilisha namba ya simu au kuzima akaunti ni kazi ya Owner.</p>
          {mode && (
            <div className="help-form">
              <b>{mode === 'signout' ? 'Toa kwenye vifaa vyote' : 'Tuma maelekezo ya nenosiri'}</b>
              <div className="form-grid">
                <TextField label="Sababu *" placeholder="mf. Meneja amepiga simu: simu yake imeibiwa" value={reason} onChange={setReason} />
                <TextField label="Namba ya tiketi (hiari)" type="number" value={ticket} onChange={setTicket} />
              </div>
              <div className="actions"><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button variant={mode === 'signout' ? 'danger' : 'primary'} busy={act.busy} disabled={reason.trim().length < 5} onClick={run}>{mode === 'signout' ? 'Toa kwenye vifaa vyote' : 'Tuma SMS'}</Button></div>
            </div>
          )}
          <h3 className="desk-h3">Historia ya kuingia (20 za mwisho)</h3>
          {d.logins.length === 0 ? <p className="muted st-small">Hakuna kumbukumbu.</p> : (
            <div className="table-wrap"><table className="table"><tbody>{d.logins.map((e, i) => (
              <tr key={i}><td>{dateTime(e.createdAt)}</td><td>{e.success ? <Pill value="SUCCESS" label="Ameingia" /> : <Pill value="FAILED" label={LOGIN_REASON[e.reason ?? ''] ?? e.reason ?? 'Imeshindwa'} />}{e.suspicious && <> <Pill value="PENDING" label="Isiyo ya kawaida" /></>}</td>
                <td className="muted st-small">{(e.userAgent ?? '').replace(/\(.*?\)/g, '').slice(0, 48)}</td></tr>
            ))}</tbody></table></div>
          )}
          {d.history.length > 0 && <>
            <h3 className="desk-h3">Msaada uliotolewa</h3>
            <ul className="desk-list">{d.history.map((x, i) => <li key={i}><span className="grow"><b>{x.action === 'ACCOUNT_HELP_SIGNOUT' ? 'Ametolewa kwenye vifaa vyote' : 'Maelekezo ya nenosiri'}</b><span className="muted st-small">{x.by} · {x.after?.reason}</span></span><span className="muted st-small">{dateTime(x.created_at)}</span></li>)}</ul>
          </>}
        </div>
      )}
    </Modal>,
    document.body,
  );
}
