// =====================================================================
//  USIMAMIZI WA SERIKALI (v0.43) — Afisa Ushirika Wilaya
//   Afisa: dashibodi ya vyama vyote vya wilaya, ukaguzi na hoja, maagizo rasmi, zuio la malipo.
//   Chama (Meneja/Mhasibu): kupokea ripoti za ukaguzi, kujibu hoja, kuthibitisha na kutekeleza maagizo.
//   Ruhusa zote zinakaguliwa tena na backend (oversight.read / oversight.respond / oversight.manage).
// =====================================================================
import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, setSelectedAmcos, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/prefs';
import { date, dateTime, num, tsh } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, Select, Textarea, TextField } from '../components/ui';
import { ConfirmDialog, Kpi, Section } from '../components/owner-ui';
import { Password, Sessions, TwoFactor } from '../owner/Settings';

// ------------------------------ AINA NA LEBO ------------------------------
interface Flag { level: 'bad' | 'warn'; text: string }
interface DistrictRow {
  id: string; name: string; code: string; reg_number: string | null; ward: string | null; village: string | null; is_active: boolean;
  members: number; staff: number; pending_approvals: number; stale_approvals: number; last_recon: string | null; locked_through: string | null;
  income_ytd: string; spend_ytd: string; unapproved_payments: number; open_findings: number; serious_findings: number; overdue_findings: number;
  open_directives: number; overdue_directives: number; last_inspection: string | null; hold_since: string | null; last_activity: string | null;
  flags: Flag[]; risk: 'HIGH' | 'MEDIUM' | 'LOW';
}
interface Overview {
  jurisdiction: { region: string | null; district: string | null } | null;
  officers: { id: string; fullName: string; jobTitle: string | null; lastLoginAt: string | null }[];
  amcos: DistrictRow[];
  totals: null | { amcos: number; members: number; openFindings: number; seriousFindings: number; openDirectives: number; holds: number; highRisk: number; incomeYtd: number; spendYtd: number };
}
interface Summary {
  findings: { open: number; responded: number }; directives: { open: number; inProgress: number; complied: number };
  holds: { id: string; amcosId: string; reason: string; placedAt: string; amcos: string; by: string | null }[];
}
interface Inspection {
  id: string; amcosId: string; inspNo: string; title: string; kind: string; periodFrom: string | null; periodTo: string | null; status: string;
  summary: string | null; conclusion: string | null; issuedAt: string | null; closedAt: string | null; createdAt: string;
  amcosName?: string; amcosCode?: string; createdBy?: string | null; issuedBy?: string | null; closedBy?: string | null; findings?: number; open?: number; critical?: number;
}
interface Finding {
  id: string; findingNo: number; area: string; title: string; detail: string; severity: string; recommendation: string | null; dueDate: string | null;
  status: string; response: string | null; respondedAt: string | null; respondedBy: string | null; resolutionNote: string | null; resolvedAt: string | null; resolvedBy: string | null;
}
interface Directive {
  id: string; amcosId: string; amcosName: string; amcosCode: string; dirNo: string; subject: string; body: string; priority: string; dueDate: string | null; status: string;
  issuedBy: string | null; createdAt: string; ackBy: string | null; ackAt: string | null; complianceNote: string | null; compliedBy: string | null; compliedAt: string | null; closeNote: string | null; closedAt: string | null;
}
interface Hold { id: string; amcosId: string; amcosName: string; amcosCode: string; reason: string; placedAt: string; placedBy: string | null; liftedAt: string | null; liftedBy: string | null; liftReason: string | null }
type AmcosLite = { id: string; name: string; code: string; district?: string | null };

export const KIND: Record<string, string> = { ROUTINE: 'Ukaguzi wa kawaida', SPECIAL: 'Ukaguzi maalum', INVESTIGATION: 'Uchunguzi', FOLLOW_UP: 'Ufuatiliaji' };
export const AREA: Record<string, string> = { FINANCE: 'Fedha na hesabu', MEMBERS: 'Wanachama', SALES: 'Mauzo ya tumbaku', INPUTS: 'Pembejeo', STORE: 'Stoo na mali', GOVERNANCE: 'Uongozi na utawala', OTHER: 'Mengineyo' };
export const SEV: Record<string, string> = { LOW: 'Ndogo', MEDIUM: 'Wastani', HIGH: 'Kubwa', CRITICAL: 'Hatari sana' };
const ST: Record<string, string> = {
  DRAFT: 'Rasimu', ISSUED: 'Imetolewa', CLOSED: 'Imefungwa', OPEN: 'Wazi', RESPONDED: 'Imejibiwa', RESOLVED: 'Imetatuliwa', REOPENED: 'Imerudishwa',
  SENT: 'Limetumwa', ACKNOWLEDGED: 'Limepokelewa', COMPLIED: 'Limetekelezwa', WITHDRAWN: 'Limefutwa', HIGH: 'Hatari kubwa', MEDIUM: 'Tahadhari', LOW: 'Salama',
};
const TONE: Record<string, string> = {
  DRAFT: 'neutral', ISSUED: 'warn', CLOSED: 'ok', OPEN: 'bad', RESPONDED: 'warn', RESOLVED: 'ok', REOPENED: 'bad', SENT: 'bad', ACKNOWLEDGED: 'warn', COMPLIED: 'warn',
  WITHDRAWN: 'neutral', HIGH: 'bad', MEDIUM: 'warn', LOW: 'ok', CRITICAL: 'bad', URGENT: 'bad', NORMAL: 'neutral',
};
function Tag({ v, label }: { v: string; label?: string }) {
  const t = useT();
  return <span className={`badge badge-${TONE[v] ?? 'neutral'}`}>{t(label ?? ST[v] ?? SEV[v] ?? v)}</span>;
}
const sevTag = (s: string) => <span className={`ov-sev ov-sev-${s.toLowerCase()}`}>{SEV[s] ?? s}</span>;
const overdue = (d: string | null, open: boolean) => !!d && open && d < new Date().toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

function useOfficer() {
  const { user, may } = useAuth();
  return { officer: user?.role === 'COOP_OFFICER' || may('oversight.manage'), respond: may('oversight.respond'), user };
}

/** Menyu ndogo ya sehemu ya usimamizi */
function OvNav() {
  const { officer } = useOfficer();
  const t = useT();
  const items: [string, string][] = officer
    ? [['/oversight', 'Dashibodi ya wilaya'], ['/oversight/inspections', 'Ukaguzi na hoja'], ['/oversight/directives', 'Maagizo rasmi'], ['/oversight/holds', 'Zuio la malipo'], ['/oversight/account', 'Akaunti yangu']]
    : [['/oversight', 'Muhtasari'], ['/oversight/inspections', 'Ripoti za ukaguzi'], ['/oversight/directives', 'Maagizo'], ['/oversight/holds', 'Zuio la malipo']];
  return (
    <nav className="ov-nav no-print" aria-label={t('Usimamizi')}>
      {items.map(([to, l]) => <NavLink key={to} to={to} end={to === '/oversight'}>{t(l)}</NavLink>)}
    </nav>
  );
}

/** Kichwa rasmi cha nyaraka za Afisa Ushirika */
function GovHead({ district, region, title, no }: { district?: string | null; region?: string | null; title: string; no?: string }) {
  return (
    <div className="ov-gov">
      <div className="ov-gov-emblem" aria-hidden="true">⚖</div>
      <div className="ov-gov-t">
        <b>JAMHURI YA MUUNGANO WA TANZANIA</b>
        <span>OFISI YA AFISA USHIRIKA {district ? `WILAYA YA ${district.toUpperCase()}` : 'WILAYA'}{region ? ` — MKOA WA ${region.toUpperCase()}` : ''}</span>
        <h2>{title}</h2>
        {no && <span className="ov-gov-no">Kumb. Na. {no}</span>}
      </div>
    </div>
  );
}

// ------------------------------ UKURASA WA KWANZA ------------------------------
export function OversightHome() {
  const { officer } = useOfficer();
  return officer ? <DistrictDashboard /> : <ChamaInbox />;
}

function DistrictDashboard() {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const ov = useFetch<Overview>('/oversight/overview');
  const [risk, setRisk] = useState<'' | 'HIGH' | 'MEDIUM' | 'LOW'>('');
  const [q, setQ] = useState('');
  const d = ov.data;
  const rows = useMemo(() => (d?.amcos ?? []).filter((a) => (!risk || a.risk === risk) && (!q || `${a.name} ${a.code} ${a.ward ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.risk] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.risk]) || a.name.localeCompare(b.name)), [d, risk, q]);
  const openChama = (id: string, to: string) => { setSelectedAmcos(id); window.location.assign(to); };
  const district = d?.jurisdiction?.district ?? user?.jurisdictionDistrict;
  return (
    <>
      <PageHead title={t('Usimamizi wa vyama')} sub={<>{t('Afisa Ushirika')} · {t('Wilaya ya')} <b>{district ?? '—'}</b>{d?.jurisdiction?.region ? ` · ${t('Mkoa wa')} ${d.jurisdiction.region}` : ''}</>}>
        <Button onClick={() => nav('/oversight/inspections?new=1')}>{t('+ Ukaguzi mpya')}</Button>
        <Button variant="secondary" onClick={() => nav('/oversight/directives?new=1')}>{t('+ Agizo')}</Button>
      </PageHead>
      <OvNav />
      <Alert>{ov.error}</Alert>
      {ov.loading && !d ? <Loading /> : d && (
        <>
          {!d.amcos.length && <Alert kind="warn">{t('Hakuna chama kilichosajiliwa na wilaya hii bado. Mmiliki wa CoopLink aweke jina la wilaya kwenye taarifa za kila chama ili kionekane hapa.')}</Alert>}
          {d.totals && (
            <div className="grid grid-kpi">
              <Kpi label="Vyama vya wilaya" value={num(d.totals.amcos)} hint={`${num(d.totals.members)} wanachama hai`} tone="dark" />
              <Kpi label="Hatari kubwa" value={num(d.totals.highRisk)} hint="vyama vinavyohitaji hatua" tone={d.totals.highRisk ? 'bad' : undefined} />
              <Kpi label="Hoja zilizo wazi" value={num(d.totals.openFindings)} hint={`${num(d.totals.seriousFindings)} nzito`} tone={d.totals.seriousFindings ? 'warn' : undefined} />
              <Kpi label="Maagizo yanayosubiri" value={num(d.totals.openDirectives)} hint={`${num(d.totals.holds)} zuio la malipo`} tone="gold" />
            </div>
          )}
          {d.totals && (
            <div className="ov-strip">
              <span>{t('Mapato ya mwaka huu (vyama vyote)')}: <b>{tsh(d.totals.incomeYtd)}</b></span>
              <span>{t('Matumizi ya mwaka huu')}: <b>{tsh(d.totals.spendYtd)}</b></span>
            </div>
          )}
          {!!d.amcos.length && (
            <div className="card">
              <div className="toolbar">
                <input className="input" style={{ maxWidth: 260 }} placeholder={t('Tafuta chama…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Tafuta chama')} />
                <div className="ov-chips" role="group" aria-label={t('Kiwango cha hatari')}>
                  {(['', 'HIGH', 'MEDIUM', 'LOW'] as const).map((r) => (
                    <button key={r} type="button" className={`ov-chip ${risk === r ? "on" : ""}`} onClick={() => setRisk(r)}>{r ? t(ST[r]) : t('Vyote')}</button>
                  ))}
                </div>
              </div>
              <div className="ov-cards">
                {rows.map((a) => (
                  <article key={a.id} className={`ov-card ov-risk-${a.risk.toLowerCase()}`}>
                    <header>
                      <div><h3>{a.name}</h3><small className="muted">{a.code}{a.reg_number ? ` · Usajili ${a.reg_number}` : ''}{a.ward ? ` · ${a.ward}` : ''}</small></div>
                      <Tag v={a.risk} />
                    </header>
                    <dl className="ov-metrics">
                      <div><dt>{t('Wanachama')}</dt><dd>{num(a.members)}</dd></div>
                      <div><dt>{t('Mapato YTD')}</dt><dd>{tsh(a.income_ytd)}</dd></div>
                      <div><dt>{t('Matumizi YTD')}</dt><dd>{tsh(a.spend_ytd)}</dd></div>
                      <div><dt>{t('Hoja wazi')}</dt><dd>{num(a.open_findings)}</dd></div>
                      <div><dt>{t('Maagizo wazi')}</dt><dd>{num(a.open_directives)}</dd></div>
                      <div><dt>{t('Idhini zinazosubiri')}</dt><dd>{num(a.pending_approvals)}</dd></div>
                      <div><dt>{t('Usuluhishi wa benki')}</dt><dd>{a.last_recon ? date(a.last_recon) : '—'}</dd></div>
                      <div><dt>{t('Ukaguzi wa mwisho')}</dt><dd>{a.last_inspection ? date(a.last_inspection) : '—'}</dd></div>
                    </dl>
                    {!!a.flags.length && <ul className="ov-flags">{a.flags.map((f, i) => <li key={i} className={`ov-flag-${f.level}`}>{t(f.text)}</li>)}</ul>}
                    <footer>
                      <small className="muted">{t('Shughuli ya mwisho')}: {a.last_activity ? dateTime(a.last_activity) : '—'}</small>
                      <div className="actions">
                        <Button size="sm" variant="secondary" onClick={() => openChama(a.id, '/accounting/reports')}>{t('Ripoti za fedha')}</Button>
                        <Button size="sm" variant="secondary" onClick={() => openChama(a.id, '/audit')}>{t('Kumbukumbu')}</Button>
                        <Button size="sm" onClick={() => nav(`/oversight/inspections?new=1&amcos=${a.id}`)}>{t('Kagua')}</Button>
                      </div>
                    </footer>
                  </article>
                ))}
                {!rows.length && <Empty>{t('Hakuna chama kinacholingana na kichujio.')}</Empty>}
              </div>
            </div>
          )}
          <Section title={t('Maafisa wa wilaya hii')}>
            <div className="ov-officers">
              {d.officers.map((o) => (
                <div key={o.id} className="ov-officer"><span className="avatar" aria-hidden="true">{o.fullName.charAt(0)}</span>
                  <div><b>{o.fullName}</b><small className="muted">{o.jobTitle ?? t('Afisa Ushirika')} · {t('aliingia')} {o.lastLoginAt ? dateTime(o.lastLoginAt) : '—'}</small></div></div>
              ))}
            </div>
            <p className="muted st-small">{t('Kufungua data za chama (wanachama, fedha, mauzo, mishahara), chagua chama juu ya ukurasa. Afisa anaona kila kitu lakini hawezi kubadilisha rekodi za chama — anaelekeza kupitia hoja na maagizo.')}</p>
          </Section>
        </>
      )}
    </>
  );
}

/** Chama: muhtasari wa ukaguzi, maagizo na zuio */
function ChamaInbox() {
  const t = useT();
  const s = useFetch<Summary>('/oversight/summary');
  const dirs = useFetch<{ data: Directive[]; can: { manage: boolean; respond: boolean } }>('/oversight/directives');
  const ins = useFetch<{ data: Inspection[] }>('/oversight/inspections');
  const open = (dirs.data?.data ?? []).filter((d) => ['SENT', 'ACKNOWLEDGED'].includes(d.status));
  const openIns = (ins.data?.data ?? []).filter((i) => i.status === 'ISSUED');
  return (
    <>
      <PageHead title={t('Ukaguzi na Maagizo')} sub={t('Kutoka kwa Afisa Ushirika wa Wilaya — jibu kila hoja na utekeleze maagizo ndani ya muda.')} />
      <OvNav />
      <Alert>{s.error ?? dirs.error ?? ins.error}</Alert>
      {s.data?.holds.map((h) => <HoldBanner key={h.id} reason={h.reason} since={h.placedAt} by={h.by} />)}
      {s.data && (
        <div className="grid grid-kpi">
          <Kpi label="Hoja za kujibu" value={num(s.data.findings.open)} hint={`${num(s.data.findings.responded)} zinasubiri uamuzi wa afisa`} tone={s.data.findings.open ? 'bad' : undefined} />
          <Kpi label="Maagizo mapya" value={num(s.data.directives.open)} hint="thibitisha kupokea" tone={s.data.directives.open ? 'warn' : undefined} />
          <Kpi label="Maagizo yanayotekelezwa" value={num(s.data.directives.inProgress)} hint={`${num(s.data.directives.complied)} yameripotiwa`} tone="gold" />
        </div>
      )}
      <Section title={t('Maagizo yanayosubiri hatua')}>
        {dirs.loading && !dirs.data ? <Loading /> : open.length ? <DirectiveList rows={open} can={dirs.data!.can} onChanged={() => { dirs.reload(); s.reload(); }} /> : <Empty>{t('Hakuna agizo linalosubiri. 👍')}</Empty>}
      </Section>
      <Section title={t('Ripoti za ukaguzi zilizo wazi')}>
        {ins.loading && !ins.data ? <Loading /> : openIns.length ? <InspectionTable rows={openIns} /> : <Empty>{t('Hakuna ripoti ya ukaguzi iliyo wazi.')}</Empty>}
      </Section>
    </>
  );
}

export function HoldBanner({ reason, since, by }: { reason: string; since: string; by?: string | null }) {
  const t = useT();
  return (
    <div className="ov-hold" role="alert">
      <span className="ov-hold-ic" aria-hidden="true">⛔</span>
      <div>
        <b>{t('ZUIO LA MALIPO kutoka kwa Afisa Ushirika')}</b>
        <p>{t('Hakuna malipo, mikopo, mishahara wala uhamisho wa fedha utakaokamilishwa mpaka zuio liondolewe. Mapato yanaendelea kupokelewa kama kawaida.')}</p>
        <small>{t('Sababu')}: {reason} · {t('tangu')} {dateTime(since)}{by ? ` · ${by}` : ''}</small>
      </div>
    </div>
  );
}

// ------------------------------ UKAGUZI ------------------------------
function InspectionTable({ rows }: { rows: Inspection[] }) {
  const t = useT();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('Namba')}</th><th>{t('Chama')}</th><th>{t('Ukaguzi')}</th><th>{t('Hali')}</th><th className="num">{t('Hoja')}</th><th className="num">{t('Wazi')}</th><th>{t('Tarehe')}</th></tr></thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td><Link to={`/oversight/inspections/${i.id}`}><b>{i.inspNo}</b></Link></td>
              <td>{i.amcosName}</td>
              <td>{i.title}<br /><small className="muted">{t(KIND[i.kind] ?? i.kind)}</small></td>
              <td><Tag v={i.status} /></td>
              <td className="num">{num(i.findings ?? 0)}</td>
              <td className="num">{i.open ? <b className={i.critical ? 'money-neg' : ''}>{num(i.open)}</b> : '0'}</td>
              <td>{date(i.issuedAt ?? i.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDistrictAmcos(enabled: boolean) {
  return useFetch<Paged<AmcosLite>>(enabled ? '/amcos' : null, { pageSize: 200 });
}

export function OversightInspections() {
  const t = useT();
  const { officer } = useOfficer();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState('');
  const list = useFetch<{ data: Inspection[] }>('/oversight/inspections', { status: status || undefined });
  const creating = sp.get('new') === '1' && officer;
  return (
    <>
      <PageHead title={officer ? t('Ukaguzi na hoja') : t('Ripoti za ukaguzi')} sub={t('Kila ukaguzi una namba rasmi, hoja zake, majibu ya chama na uamuzi wa afisa — kumbukumbu zote zinahifadhiwa.')}>
        {officer && <Button onClick={() => setSp({ new: '1' })}>{t('+ Ukaguzi mpya')}</Button>}
      </PageHead>
      <OvNav />
      <div className="toolbar">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Hali')} style={{ maxWidth: 220 }}>
          <option value="">{t('Hali zote')}</option>
          {(officer ? ['DRAFT', 'ISSUED', 'CLOSED'] : ['ISSUED', 'CLOSED']).map((s) => <option key={s} value={s}>{t(ST[s])}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      <div className="card">
        {list.loading && !list.data ? <Loading /> : list.data?.data.length ? <InspectionTable rows={list.data.data} /> : <Empty>{t('Bado hakuna ukaguzi.')}</Empty>}
      </div>
      {creating && <NewInspection amcosId={sp.get('amcos') ?? ''} onClose={() => setSp({})} />}
    </>
  );
}

function NewInspection({ amcosId: initial, onClose }: { amcosId: string; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const am = useDistrictAmcos(true);
  const act = useAction();
  const [f, setF] = useState({ amcosId: initial, title: '', kind: 'ROUTINE', periodFrom: '', periodTo: '', summary: '' });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    const r = await act.run(() => api<{ inspection: Inspection }>('/oversight/inspections', { method: 'POST', body: { ...f, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null, summary: f.summary.trim() || null } }));
    if (r) nav(`/oversight/inspections/${r.inspection.id}`);
  };
  return (
    <Modal open size="lg" title={t('Ukaguzi mpya')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={act.busy} disabled={!f.amcosId || f.title.trim().length < 5} onClick={save}>{t('Anzisha (rasimu)')}</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="form-grid">
        <label className="field"><span className="label">{t('Chama')}</span>
          <Select value={f.amcosId} onChange={(e) => set({ amcosId: e.target.value })}>
            <option value="">{t('— chagua chama —')}</option>
            {am.data?.data.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </Select></label>
        <label className="field"><span className="label">{t('Aina ya ukaguzi')}</span>
          <Select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></label>
        <TextField label="Kichwa cha ukaguzi" value={f.title} onChange={(v) => set({ title: v })} placeholder={t('mf. Ukaguzi wa hesabu za msimu 2025/26')} />
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <TextField label="Kipindi: kuanzia" type="date" value={f.periodFrom} onChange={(v) => set({ periodFrom: v })} />
          <TextField label="hadi" type="date" value={f.periodTo} onChange={(v) => set({ periodTo: v })} />
        </div>
      </div>
      <label className="field"><span className="label">{t('Upeo na utaratibu wa ukaguzi (hiari)')}</span>
        <Textarea rows={4} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder={t('Maeneo yaliyokaguliwa, nyaraka zilizoangaliwa, waliohojiwa…')} /></label>
      <p className="muted st-small">{t('Ukaguzi unaanza kama rasimu: chama hakiuoni mpaka uutoe. Ongeza hoja kwanza, kisha bonyeza "Toa ripoti".')}</p>
    </Modal>
  );
}

export function OversightInspectionDetail() {
  const t = useT();
  const { id } = useParams();
  const { user } = useAuth();
  const r = useFetch<{ inspection: Inspection; amcos: { name: string; code: string; regNumber: string | null; region: string | null; district: string | null; ward: string | null; village: string | null } | null; findings: Finding[]; can: { manage: boolean; respond: boolean } }>(`/oversight/inspections/${id}`);
  const act = useAction();
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(false);
  const [responding, setResponding] = useState<Finding | null>(null);
  const [reviewing, setReviewing] = useState<Finding | null>(null);
  if (r.loading && !r.data) return <Loading />;
  if (!r.data) return <Alert>{r.error ?? t('Haipatikani')}</Alert>;
  const { inspection: i, amcos: a, findings, can } = r.data;
  const open = findings.filter((f) => f.status !== 'RESOLVED').length;
  const bySev = (s: string) => findings.filter((f) => f.severity === s).length;
  const issue = async () => { if (await act.run(() => api(`/oversight/inspections/${i.id}/issue`, { method: 'POST' }))) r.reload(); };
  return (
    <>
      <PageHead title={`${i.inspNo} · ${i.title}`} sub={<><Tag v={i.status} /> {a?.name}</>}>
        <Link className="btn btn-ghost btn-sm" to="/oversight/inspections">{t('← Orodha')}</Link>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>{t('Chapisha')}</Button>
        {can.manage && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{t('+ Hoja')}</Button>}
        {can.manage && i.status === 'DRAFT' && <Button size="sm" busy={act.busy} disabled={!findings.length} onClick={issue}>{t('Toa ripoti kwa chama')}</Button>}
        {can.manage && i.status === 'ISSUED' && <Button size="sm" disabled={!!open} title={open ? t('Tatua hoja zote kwanza') : undefined} onClick={() => setClosing(true)}>{t('Funga ukaguzi')}</Button>}
      </PageHead>
      <OvNav />
      <Alert>{act.error}</Alert>
      {i.status === 'DRAFT' && <Alert kind="warn">{t('Rasimu — chama hakiuoni ukaguzi huu mpaka utoe ripoti. Ripoti ikitolewa Meneja na Mhasibu wanapata SMS.')}</Alert>}
      {can.respond && !!findings.filter((f) => ['OPEN', 'REOPENED'].includes(f.status)).length && <Alert kind="warn">{t('Jibu kila hoja iliyo wazi: eleza hatua ulizochukua na ambatisha ushahidi kwenye mfumo pale inapohitajika.')}</Alert>}
      <article className="card card-pad print-doc ov-report">
        <GovHead district={a?.district} region={a?.region} title="RIPOTI YA UKAGUZI WA CHAMA CHA USHIRIKA" no={i.inspNo} />
        <dl className="ov-meta">
          <div><dt>Chama</dt><dd>{a?.name} ({a?.code}){a?.regNumber ? ` · Usajili Na. ${a.regNumber}` : ''}</dd></div>
          <div><dt>Mahali</dt><dd>{[a?.village, a?.ward, a?.district].filter(Boolean).join(', ') || '—'}</dd></div>
          <div><dt>Aina</dt><dd>{KIND[i.kind] ?? i.kind}</dd></div>
          <div><dt>Kipindi</dt><dd>{i.periodFrom ? date(i.periodFrom) : '—'} – {i.periodTo ? date(i.periodTo) : '—'}</dd></div>
          <div><dt>Mkaguzi</dt><dd>{i.createdBy ?? '—'}</dd></div>
          <div><dt>Imetolewa</dt><dd>{i.issuedAt ? `${dateTime(i.issuedAt)}${i.issuedBy ? ` · ${i.issuedBy}` : ''}` : 'Bado (rasimu)'}</dd></div>
        </dl>
        <div className="ov-sevbar">
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => <span key={s} className={`ov-sev ov-sev-${s.toLowerCase()}`}>{SEV[s]}: <b>{bySev(s)}</b></span>)}
          <span>Hoja zote: <b>{findings.length}</b> · zilizo wazi: <b>{open}</b></span>
        </div>
        {i.summary && <><h3 className="ov-h">1. Upeo na utaratibu</h3><p className="ov-p">{i.summary}</p></>}
        <h3 className="ov-h">{i.summary ? '2.' : '1.'} Hoja za ukaguzi</h3>
        {!findings.length && <p className="muted">Bado hakuna hoja.</p>}
        {findings.map((f) => (
          <section key={f.id} className={`ov-finding ov-f-${f.status.toLowerCase()}`}>
            <header>
              <b>Hoja #{f.findingNo}: {f.title}</b>
              <span className="ov-fh-tags">{sevTag(f.severity)} <Tag v={f.status} /></span>
            </header>
            <small className="muted">{AREA[f.area] ?? f.area}{f.dueDate ? ` · Muda wa kurekebisha: ${date(f.dueDate)}` : ''}{overdue(f.dueDate, f.status !== 'RESOLVED') ? ' · ⚠ imepita muda' : ''}</small>
            <p className="ov-p"><b>Maelezo:</b> {f.detail}</p>
            {f.recommendation && <p className="ov-p"><b>Pendekezo:</b> {f.recommendation}</p>}
            {f.response && <div className="ov-reply"><b>Jibu la chama</b> <small className="muted">— {f.respondedBy ?? ''} {f.respondedAt ? dateTime(f.respondedAt) : ''}</small><p>{f.response}</p></div>}
            {f.resolutionNote && <div className={`ov-reply ${f.status === 'RESOLVED' ? 'ov-reply-ok' : 'ov-reply-bad'}`}><b>{f.status === 'RESOLVED' ? 'Uamuzi: imetatuliwa' : 'Uamuzi wa afisa'}</b> <small className="muted">— {f.resolvedBy ?? ''}</small><p>{f.resolutionNote}</p></div>}
            <div className="actions no-print">
              {can.respond && ['OPEN', 'REOPENED', 'RESPONDED'].includes(f.status) && <Button size="sm" onClick={() => setResponding(f)}>{f.response ? t('Rekebisha jibu') : t('Jibu hoja')}</Button>}
              {can.manage && i.status === 'ISSUED' && f.status !== 'RESOLVED' && <Button size="sm" variant="secondary" onClick={() => setReviewing(f)}>{t('Toa uamuzi')}</Button>}
              {can.manage && i.status === 'ISSUED' && f.status === 'RESOLVED' && <Button size="sm" variant="ghost" onClick={() => setReviewing(f)}>{t('Rudisha')}</Button>}
            </div>
          </section>
        ))}
        {i.conclusion && <><h3 className="ov-h">Hitimisho</h3><p className="ov-p">{i.conclusion}</p><small className="muted">Imefungwa {i.closedAt ? dateTime(i.closedAt) : ''}{i.closedBy ? ` · ${i.closedBy}` : ''}</small></>}
        <div className="ov-sign">
          <div><span>{i.createdBy ?? '………………………'}</span><small>Afisa Ushirika (Mkaguzi)</small></div>
          <div><span>………………………</span><small>Mwenyekiti / Meneja wa Chama</small></div>
          <div><span>………………………</span><small>Tarehe na Muhuri</small></div>
        </div>
        <p className="ov-foot">Ripoti hii imetolewa kupitia CoopLink · imechapishwa {dateTime(new Date().toISOString())} na {user?.fullName}</p>
      </article>
      {adding && <FindingModal inspectionId={i.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); r.reload(); }} />}
      {responding && <TextModal title={`${t('Jibu hoja')} #${responding.findingNo}`} label="Hatua zilizochukuliwa na chama" initial={responding.response ?? ''} min={10}
        hint={responding.recommendation ? `${t('Pendekezo')}: ${responding.recommendation}` : undefined}
        onClose={() => setResponding(null)} onSubmit={async (v) => { await api(`/oversight/findings/${responding.id}/respond`, { method: 'POST', body: { response: v } }); setResponding(null); r.reload(); }} />}
      {reviewing && <ReviewFinding f={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); r.reload(); }} />}
      {closing && <TextModal title={t('Funga ukaguzi')} label="Hitimisho la ukaguzi" min={10} hint={t('Hoja zote zimetatuliwa. Andika hitimisho litakaloonekana kwenye ripoti.')}
        onClose={() => setClosing(false)} onSubmit={async (v) => { await api(`/oversight/inspections/${i.id}/close`, { method: 'POST', body: { conclusion: v } }); setClosing(false); r.reload(); }} />}
    </>
  );
}

function FindingModal({ inspectionId, onClose, onSaved }: { inspectionId: string; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const act = useAction();
  const [f, setF] = useState({ area: 'FINANCE', severity: 'MEDIUM', title: '', detail: '', recommendation: '', dueDate: '' });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    if (await act.run(() => api(`/oversight/inspections/${inspectionId}/findings`, { method: 'POST', body: { ...f, recommendation: f.recommendation.trim() || null, dueDate: f.dueDate || null } }))) onSaved();
  };
  return (
    <Modal open size="lg" title={t('Hoja mpya ya ukaguzi')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={act.busy} disabled={f.title.trim().length < 5 || f.detail.trim().length < 10} onClick={save}>{t('Hifadhi hoja')}</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="form-grid">
        <label className="field"><span className="label">{t('Eneo')}</span>
          <Select value={f.area} onChange={(e) => set({ area: e.target.value })}>{Object.entries(AREA).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></label>
        <label className="field"><span className="label">{t('Uzito')}</span>
          <Select value={f.severity} onChange={(e) => set({ severity: e.target.value })}>{Object.entries(SEV).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></label>
        <TextField label="Kichwa cha hoja" value={f.title} onChange={(v) => set({ title: v })} placeholder={t('mf. Malipo bila hati ya malipo iliyoidhinishwa')} />
        <TextField label="Muda wa kurekebisha (hiari)" type="date" min={today()} value={f.dueDate} onChange={(v) => set({ dueDate: v })} />
      </div>
      <label className="field"><span className="label">{t('Maelezo ya hoja (kilichoonekana)')}</span><Textarea rows={4} value={f.detail} onChange={(e) => set({ detail: e.target.value })} /></label>
      <label className="field"><span className="label">{t('Pendekezo / agizo la kurekebisha (hiari)')}</span><Textarea rows={3} value={f.recommendation} onChange={(e) => set({ recommendation: e.target.value })} /></label>
    </Modal>
  );
}

function ReviewFinding({ f, onClose, onDone }: { f: Finding; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const act = useAction();
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const go = async (decision: 'RESOLVED' | 'REOPENED') => {
    if (await act.run(() => api(`/oversight/findings/${f.id}/review`, { method: 'POST', body: { decision, note, dueDate: decision === 'REOPENED' && due ? due : null } }))) onDone();
  };
  return (
    <Modal open title={`${t('Uamuzi wa hoja')} #${f.findingNo}`} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button>
        <Button variant="danger" busy={act.busy} disabled={note.trim().length < 5} onClick={() => go('REOPENED')}>{t('Rudisha kwa chama')}</Button>
        {f.status !== 'RESOLVED' && <Button busy={act.busy} disabled={note.trim().length < 5} onClick={() => go('RESOLVED')}>{t('Imetatuliwa')}</Button>}
      </>}>
      <Alert>{act.error}</Alert>
      <p><b>{f.title}</b></p>
      {f.response ? <div className="ov-reply"><b>{t('Jibu la chama')}</b><p>{f.response}</p></div> : <Alert kind="warn">{t('Chama bado hakijajibu hoja hii.')}</Alert>}
      <label className="field"><span className="label">{t('Maoni ya afisa')}</span><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <TextField label="Muda mpya (ikirudishwa, hiari)" type="date" min={today()} value={due} onChange={setDue} />
    </Modal>
  );
}

function TextModal({ title, label, initial = '', min, hint, onClose, onSubmit }: { title: string; label: string; initial?: string; min: number; hint?: ReactNode; onClose: () => void; onSubmit: (v: string) => Promise<void> }) {
  const t = useT();
  const act = useAction();
  const [v, setV] = useState(initial);
  return (
    <Modal open title={title} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={act.busy} disabled={v.trim().length < min} onClick={() => act.run(() => onSubmit(v.trim()))}>{t('Tuma')}</Button></>}>
      <Alert>{act.error}</Alert>
      {hint && <p className="muted">{hint}</p>}
      <label className="field"><span className="label">{t(label)}</span><Textarea rows={5} value={v} onChange={(e) => setV(e.target.value)} /></label>
      <small className="muted">{t('Angalau herufi')} {min}</small>
    </Modal>
  );
}

// ------------------------------ MAAGIZO ------------------------------
function DirectiveList({ rows, can, onChanged }: { rows: Directive[]; can: { manage: boolean; respond: boolean }; onChanged: () => void }) {
  const t = useT();
  const act = useAction();
  const [view, setView] = useState<Directive | null>(null);
  const [comply, setComply] = useState<Directive | null>(null);
  const [review, setReview] = useState<{ d: Directive; decision: 'CLOSED' | 'REOPEN' | 'WITHDRAWN' } | null>(null);
  const ack = async (d: Directive) => { if (await act.run(() => api(`/oversight/directives/${d.id}/ack`, { method: 'POST' }))) onChanged(); };
  return (
    <>
      <Alert>{act.error}</Alert>
      <div className="ov-dirs">
        {rows.map((d) => {
          const isOpen = ['SENT', 'ACKNOWLEDGED'].includes(d.status);
          return (
            <article key={d.id} className={`ov-dir ${d.priority === 'URGENT' ? 'ov-dir-urgent' : ''}`}>
              <header>
                <div><b>{d.dirNo}</b> · {d.subject}<br /><small className="muted">{can.manage ? `${d.amcosName} · ` : ''}{t('kutoka')} {d.issuedBy ?? '—'} · {date(d.createdAt)}</small></div>
                <span className="ov-fh-tags">{d.priority === 'URGENT' && <Tag v="URGENT" label="Haraka" />} <Tag v={d.status} /></span>
              </header>
              <p className="ov-p ov-clamp">{d.body}</p>
              <small className={overdue(d.dueDate, isOpen) ? 'money-neg' : 'muted'}>{d.dueDate ? `${t('Litekelezwe kabla ya')} ${date(d.dueDate)}${overdue(d.dueDate, isOpen) ? ` · ${t('limepita muda')}` : ''}` : t('Bila tarehe ya mwisho')}</small>
              {d.complianceNote && <div className="ov-reply"><b>{t('Utekelezaji')}</b> <small className="muted">— {d.compliedBy ?? ''} {d.compliedAt ? dateTime(d.compliedAt) : ''}</small><p>{d.complianceNote}</p></div>}
              {d.closeNote && <div className="ov-reply ov-reply-ok"><b>{t('Maoni ya afisa')}</b><p>{d.closeNote}</p></div>}
              <div className="actions">
                <Button size="sm" variant="ghost" onClick={() => setView(d)}>{t('Soma agizo')}</Button>
                {can.respond && d.status === 'SENT' && <Button size="sm" variant="secondary" busy={act.busy} onClick={() => ack(d)}>{t('Thibitisha kupokea')}</Button>}
                {can.respond && isOpen && <Button size="sm" onClick={() => setComply(d)}>{t('Ripoti utekelezaji')}</Button>}
                {can.manage && d.status === 'COMPLIED' && <Button size="sm" onClick={() => setReview({ d, decision: 'CLOSED' })}>{t('Kubali na funga')}</Button>}
                {can.manage && d.status === 'COMPLIED' && <Button size="sm" variant="secondary" onClick={() => setReview({ d, decision: 'REOPEN' })}>{t('Rudisha')}</Button>}
                {can.manage && !['CLOSED', 'WITHDRAWN'].includes(d.status) && <Button size="sm" variant="ghost" onClick={() => setReview({ d, decision: 'WITHDRAWN' })}>{t('Futa agizo')}</Button>}
              </div>
            </article>
          );
        })}
      </div>
      {view && (
        <Modal open size="lg" title={view.dirNo} onClose={() => setView(null)} footer={<><Button variant="secondary" onClick={() => window.print()}>{t('Chapisha')}</Button><Button onClick={() => setView(null)}>{t('Funga')}</Button></>}>
          <div className="print-doc ov-report">
            <GovHead title="AGIZO RASMI LA AFISA USHIRIKA" no={view.dirNo} />
            <p><b>Kwa:</b> Meneja, {view.amcosName} ({view.amcosCode})<br /><b>Tarehe:</b> {date(view.createdAt)}{view.dueDate ? <><br /><b>Litekelezwe kabla ya:</b> {date(view.dueDate)}</> : null}</p>
            <p><b>YAH: {view.subject.toUpperCase()}</b></p>
            <p className="ov-p">{view.body}</p>
            <div className="ov-sign"><div><span>{view.issuedBy ?? '………………'}</span><small>Afisa Ushirika Wilaya</small></div></div>
          </div>
        </Modal>
      )}
      {comply && <TextModal title={`${t('Utekelezaji wa agizo')} ${comply.dirNo}`} label="Eleza hatua zilizochukuliwa" min={10} initial={comply.complianceNote ?? ''}
        onClose={() => setComply(null)} onSubmit={async (v) => { await api(`/oversight/directives/${comply.id}/comply`, { method: 'POST', body: { note: v } }); setComply(null); onChanged(); }} />}
      {review && <TextModal title={review.decision === 'CLOSED' ? t('Kubali utekelezaji') : review.decision === 'REOPEN' ? t('Rudisha agizo kwa chama') : t('Futa agizo')} label="Maoni ya afisa" min={5}
        onClose={() => setReview(null)} onSubmit={async (v) => { await api(`/oversight/directives/${review.d.id}/review`, { method: 'POST', body: { decision: review.decision, note: v } }); setReview(null); onChanged(); }} />}
    </>
  );
}

export function OversightDirectives() {
  const t = useT();
  const { officer } = useOfficer();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState('');
  const list = useFetch<{ data: Directive[]; can: { manage: boolean; respond: boolean } }>('/oversight/directives', { status: status || undefined });
  return (
    <>
      <PageHead title={t('Maagizo rasmi')} sub={officer ? t('Agizo moja linaweza kwenda kwa chama kimoja au vyama vyote vya wilaya. Meneja anapata SMS na anatakiwa kuthibitisha na kuripoti utekelezaji.') : t('Maagizo kutoka kwa Afisa Ushirika — thibitisha kupokea, kisha ripoti utekelezaji.')}>
        {officer && <Button onClick={() => setSp({ new: '1' })}>{t('+ Agizo jipya')}</Button>}
      </PageHead>
      <OvNav />
      <div className="toolbar">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Hali')} style={{ maxWidth: 220 }}>
          <option value="">{t('Hali zote')}</option>
          {['SENT', 'ACKNOWLEDGED', 'COMPLIED', 'CLOSED', 'WITHDRAWN'].map((s) => <option key={s} value={s}>{t(ST[s])}</option>)}
        </Select>
      </div>
      <Alert>{list.error}</Alert>
      {list.loading && !list.data ? <Loading /> : list.data?.data.length ? <DirectiveList rows={list.data.data} can={list.data.can} onChanged={list.reload} /> : <Empty>{t('Hakuna maagizo.')}</Empty>}
      {officer && sp.get('new') === '1' && <NewDirective onClose={() => setSp({})} onSaved={() => { setSp({}); list.reload(); }} />}
    </>
  );
}

function NewDirective({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const am = useDistrictAmcos(true);
  const act = useAction();
  const [ids, setIds] = useState<string[]>([]);
  const [f, setF] = useState({ subject: '', body: '', priority: 'NORMAL', dueDate: '' });
  const all = am.data?.data ?? [];
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const save = async () => {
    if (await act.run(() => api('/oversight/directives', { method: 'POST', body: { amcosIds: ids, ...f, dueDate: f.dueDate || null } }))) onSaved();
  };
  return (
    <Modal open size="lg" title={t('Agizo jipya')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={act.busy} disabled={!ids.length || f.subject.trim().length < 5 || f.body.trim().length < 10} onClick={save}>{t('Tuma agizo')} ({ids.length})</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="field"><span className="label">{t('Vyama vinavyopokea')}</span>
        <div className="ov-picks">
          <label className="check"><input type="checkbox" checked={!!all.length && ids.length === all.length} onChange={(e) => setIds(e.target.checked ? all.map((a) => a.id) : [])} /> <b>{t('Vyama vyote vya wilaya')} ({all.length})</b></label>
          {all.map((a) => <label key={a.id} className="check"><input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} /> {a.name} <small className="muted">{a.code}</small></label>)}
        </div>
      </div>
      <div className="form-grid">
        <TextField label="Kichwa (YAH)" value={f.subject} onChange={(v) => setF((x) => ({ ...x, subject: v }))} placeholder={t('mf. Kuwasilisha taarifa za fedha za robo ya tatu')} />
        <label className="field"><span className="label">{t('Kipaumbele')}</span>
          <Select value={f.priority} onChange={(e) => setF((x) => ({ ...x, priority: e.target.value }))}><option value="NORMAL">{t('Kawaida')}</option><option value="URGENT">{t('Haraka')}</option></Select></label>
        <TextField label="Litekelezwe kabla ya (hiari)" type="date" min={today()} value={f.dueDate} onChange={(v) => setF((x) => ({ ...x, dueDate: v }))} />
      </div>
      <label className="field"><span className="label">{t('Agizo')}</span><Textarea rows={6} value={f.body} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} /></label>
      <p className="muted st-small">{t('Kila chama kinapata namba yake ya agizo (AG-…) na Meneja anapata SMS kutoka COOPLINK.')}</p>
    </Modal>
  );
}

// ------------------------------ ZUIO LA MALIPO ------------------------------
export function OversightHolds() {
  const t = useT();
  const { officer } = useOfficer();
  const list = useFetch<{ data: Hold[] }>('/oversight/holds');
  const am = useDistrictAmcos(officer);
  const [placing, setPlacing] = useState(false);
  const [amcosId, setAmcosId] = useState('');
  const [reason, setReason] = useState('');
  const [lift, setLift] = useState<Hold | null>(null);
  const [liftReason, setLiftReason] = useState('');
  const active = (list.data?.data ?? []).filter((h) => !h.liftedAt);
  const activeIds = new Set(active.map((h) => h.amcosId));
  return (
    <>
      <PageHead title={t('Zuio la malipo')} sub={t('Zuio linasimamisha malipo yote yanayotoka (matumizi, malipo ya wakulima na wazabuni, mikopo, mishahara, uhamisho). Mapato yanaendelea kupokelewa.')}>
        {officer && <Button variant="danger" onClick={() => { setAmcosId(''); setReason(''); setPlacing(true); }}>{t('Weka zuio')}</Button>}
      </PageHead>
      <OvNav />
      <Alert>{list.error}</Alert>
      {!officer && active.map((h) => <HoldBanner key={h.id} reason={h.reason} since={h.placedAt} by={h.placedBy} />)}
      <div className="card">
        {list.loading && !list.data ? <Loading /> : list.data?.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Chama')}</th><th>{t('Sababu')}</th><th>{t('Liliwekwa')}</th><th>{t('Hali')}</th><th /></tr></thead>
              <tbody>
                {list.data.data.map((h) => (
                  <tr key={h.id}>
                    <td><b>{h.amcosName}</b><br /><small className="muted">{h.amcosCode}</small></td>
                    <td>{h.reason}{h.liftReason && <><br /><small className="muted">{t('Kuondolewa')}: {h.liftReason}</small></>}</td>
                    <td>{dateTime(h.placedAt)}<br /><small className="muted">{h.placedBy}</small></td>
                    <td>{h.liftedAt ? <><Tag v="CLOSED" label="Limeondolewa" /><br /><small className="muted">{dateTime(h.liftedAt)} · {h.liftedBy}</small></> : <Tag v="HIGH" label="Hai" />}</td>
                    <td className="num">{officer && !h.liftedAt && <Button size="sm" variant="secondary" onClick={() => { setLiftReason(''); setLift(h); }}>{t('Ondoa zuio')}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t('Hakuna zuio la malipo.')}</Empty>}
      </div>
      <ConfirmDialog open={placing} danger title={t('Weka zuio la malipo')} confirmLabel={t('Weka zuio')}
        message={t('Chama kitazuiwa kukamilisha malipo yoyote yanayotoka mpaka uondoe zuio. Meneja na Mhasibu watapata SMS.')}
        onClose={() => setPlacing(false)}
        onConfirm={async (c) => {
          if (!amcosId) throw new Error(t('Chagua chama'));
          await api('/oversight/holds', { method: 'POST', body: { amcosId, reason, ...c } });
          setPlacing(false); list.reload();
        }}>
        <label className="field"><span className="label">{t('Chama')}</span>
          <Select value={amcosId} onChange={(e) => setAmcosId(e.target.value)}>
            <option value="">{t('— chagua chama —')}</option>
            {am.data?.data.filter((a) => !activeIds.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </Select></label>
        <label className="field"><span className="label">{t('Sababu ya zuio (herufi 15+)')}</span><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </ConfirmDialog>
      <ConfirmDialog open={!!lift} title={t('Ondoa zuio la malipo')} confirmLabel={t('Ondoa zuio')}
        message={<>{t('Malipo ya')} <b>{lift?.amcosName}</b> {t('yataweza kuendelea kwa taratibu za kawaida.')}</>}
        onClose={() => setLift(null)}
        onConfirm={async (c) => { await api(`/oversight/holds/${lift!.id}/lift`, { method: 'POST', body: { reason: liftReason, ...c } }); setLift(null); list.reload(); }}>
        <label className="field"><span className="label">{t('Kwa nini zuio linaondolewa?')}</span><Textarea rows={3} value={liftReason} onChange={(e) => setLiftReason(e.target.value)} /></label>
      </ConfirmDialog>
    </>
  );
}

// ------------------------------ AKAUNTI YA AFISA ------------------------------
export function OfficerAccount() {
  const t = useT();
  const { user } = useAuth();
  const tf = user?.twoFactor;
  return (
    <>
      <PageHead title={t('Akaunti yangu')} sub={<>{user?.fullName} · {user?.jobTitle ?? t('Afisa Ushirika')} · {t('Wilaya ya')} {user?.jurisdictionDistrict ?? '—'}</>} />
      <OvNav />
      {tf?.required && !user?.totpEnabled && (
        <Alert kind={tf.overdue ? 'error' : 'warn'}>
          {tf.overdue
            ? t('Muda wa kuwasha 2FA umepita. Washa 2FA hapa chini ili kuendelea kutumia mfumo.')
            : `${t('Washa 2FA kabla ya')} ${tf.deadline ? dateTime(tf.deadline) : ''}. ${t('Akaunti za Afisa Ushirika zina mamlaka ya kiserikali — 2FA ni lazima.')}`}
        </Alert>
      )}
      <TwoFactor />
      <Password />
      <Sessions />
    </>
  );
}
