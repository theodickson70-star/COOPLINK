// =====================================================================
//  LEADS & CRM — Huduma kwa Wateja na Masoko
//   Ubao wa hatua (pipeline), orodha, historia ya kila lead (simu, vikao, SMS), kupangia mhusika na kufuatilia.
//   Lead inakuwa mteja kwa kusajili chama (AMCOS Management) — hakuna "WON" ya kubonyeza tu.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, phone as fmtPhone } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, Select, SelectField, TextField } from '../components/ui';
import { Kpi, Pill, Tabs } from '../components/owner-ui';

type Stage = 'NEW' | 'CONTACTED' | 'DEMO_SCHEDULED' | 'DEMO_DONE' | 'NEGOTIATION' | 'WON' | 'LOST';
interface Lead {
  id: string; name: string; phone: string; amcosName: string; region: string | null; district: string | null; email: string | null; members: number | null;
  message: string | null; stage: Stage; source: string; assignedToId: string | null; assignee: string | null; nextFollowUpAt: string | null;
  lostReason: string | null; amcosId: string | null; createdAt: string; updatedAt: string | null; activities?: number; lastActivityAt?: string | null;
}
interface Summary { new: number; unassigned: number; open: number; mine: number; due: number; overdue: number; won90: number; lost90: number; created30: number; days_to_win: number | null; conversion90: number | null; byStage: { stage: Stage; n: number }[]; bySource: { source: string; n: number; won: number }[] }
interface Activity { id: string; kind: string; body: string; createdAt: string; by: string; meta: { status?: string } | null }

export const STAGES: [Stage, string][] = [['NEW', 'Mpya'], ['CONTACTED', 'Amepigiwa'], ['DEMO_SCHEDULED', 'Demo imepangwa'], ['DEMO_DONE', 'Demo imefanyika'], ['NEGOTIATION', 'Mazungumzo'], ['WON', 'Amekuwa mteja'], ['LOST', 'Amepotea']];
const STAGE_LABEL = Object.fromEntries(STAGES) as Record<Stage, string>;
const OPEN_STAGES = STAGES.slice(0, 5);
export const SOURCES: [string, string][] = [['WEBSITE', 'Tovuti'], ['PHONE', 'Simu'], ['REFERRAL', 'Rufaa (amependekezwa)'], ['FIELD_VISIT', 'Ziara ya uwandani'], ['EVENT', 'Tukio / mkutano'], ['SOCIAL', 'Mitandao ya kijamii'], ['OTHER', 'Nyingine']];
const SOURCE_LABEL = Object.fromEntries(SOURCES);
const KIND: Record<string, [string, string]> = { NOTE: ['📝', 'Maelezo'], CALL: ['📞', 'Simu'], SMS: ['💬', 'SMS'], MEETING: ['🤝', 'Kikao'], STAGE: ['➜', 'Hatua'], ASSIGN: ['👤', 'Mhusika'] };

const isLate = (d: string | null) => !!d && new Date(d).getTime() < Date.now();
const isToday = (d: string | null) => !!d && new Date(d).toDateString() === new Date().toDateString();
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const initials = (n: string | null) => (n ?? '?').split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase();

function FollowUp({ at, stage }: { at: string | null; stage: Stage }) {
  if (stage === 'WON' || stage === 'LOST') return null;
  if (!at) return <span className="lead-fu none">Hakuna tarehe ya kufuatilia</span>;
  return <span className={`lead-fu ${isLate(at) && !isToday(at) ? 'late' : isToday(at) ? 'today' : ''}`}>📅 {isToday(at) ? `Leo ${new Date(at).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}` : dateTime(at)}</span>;
}

export function OwnerLeads() {
  const { has } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(() => (window.innerWidth < 860 ? 'list' : 'board'));
  const [assigned, setAssigned] = useState(sp.get('assigned') ?? '');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState(sp.get('stage') ?? 'OPEN');
  const [due, setDue] = useState(sp.get('due') === '1');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const sum = useFetch<Summary>('/owner/leads/summary');
  const list = useFetch<{ data: Lead[] }>('/owner/leads', { stage: view === 'board' ? 'OPEN' : stage || undefined, assigned: assigned || undefined, source: source || undefined, q: dq || undefined, due: due ? '1' : undefined });
  const [open, setOpen] = useState<string | null>(sp.get('id'));
  const [adding, setAdding] = useState(false);
  const manage = has('leads.manage');
  const reload = () => { list.reload(); sum.reload(); };
  useEffect(() => { const id = sp.get('id'); if (id) setOpen(id); }, [sp]);
  const s = sum.data;
  const cols = useMemo(() => OPEN_STAGES.map(([k, label]) => ({ k, label, items: (list.data?.data ?? []).filter((l) => l.stage === k) })), [list.data]);

  return (
    <>
      <PageHead title="Leads & CRM" sub="Vyama vinavyotaka kujiunga na CoopLink — fuatilia kila kimoja mpaka kiwe mteja">
        {manage && <Button onClick={() => setAdding(true)}>+ Lead mpya</Button>}
      </PageHead>
      {s && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Leads zinazofuatiliwa" value={s.open} hint={`${s.created30} mpya ndani ya siku 30`} />
          <Kpi tone={s.due ? 'warn' : undefined} label="Za kufuatilia leo" value={s.due} hint={s.overdue ? `${s.overdue} zimechelewa` : 'Hakuna iliyochelewa'} />
          <Kpi tone={s.unassigned ? 'warn' : undefined} label="Mpya bila mhusika" value={s.unassigned} hint={`Zangu: ${s.mine}`} />
          <Kpi tone="gold" label="Kiwango cha kufaulu (siku 90)" value={s.conversion90 === null ? '—' : `${s.conversion90}%`} hint={`${s.won90} wateja · ${s.lost90} wamepotea${s.days_to_win ? ` · siku ${s.days_to_win} kwa wastani` : ''}`} />
        </div>
      )}
      <section className="card">
        <div className="toolbar lead-toolbar">
          <Tabs value={view} onChange={setView} items={[['board', 'Ubao wa hatua'], ['list', 'Orodha']]} />
          <input className="input" placeholder="Tafuta jina, chama, simu, mkoa…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta lead" />
          <Select aria-label="Mhusika" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
            <option value="">Wahusika wote</option><option value="me">Zangu</option><option value="none">Bila mhusika</option>
          </Select>
          <Select aria-label="Chanzo" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Vyanzo vyote</option>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {view === 'list' && <Select aria-label="Hatua" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="OPEN">Zinazofuatiliwa</option><option value="">Hatua zote</option>{STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>}
          <label className="chk"><input type="checkbox" checked={due} onChange={(e) => { setDue(e.target.checked); setSp(e.target.checked ? { due: '1' } : {}, { replace: true }); }} /> Za leo / zilizochelewa</label>
        </div>
        <Alert>{list.error}</Alert>
        {list.loading && !list.data ? <Loading /> : view === 'board' ? (
          <div className="lead-board">
            {cols.map((c) => (
              <div key={c.k} className="lead-col">
                <div className="lead-col-h"><b>{c.label}</b><span>{c.items.length}</span></div>
                {c.items.length === 0 && <p className="lead-empty">—</p>}
                {c.items.map((l) => (
                  <button key={l.id} type="button" className="lead-card" onClick={() => setOpen(l.id)}>
                    <b>{l.amcosName}</b>
                    <span className="muted">{l.name}{l.region ? ` · ${l.region}` : ''}</span>
                    <FollowUp at={l.nextFollowUpAt} stage={l.stage} />
                    <span className="lead-meta"><span className="lead-src">{SOURCE_LABEL[l.source] ?? l.source}</span>
                      <span className={`lead-av ${l.assignee ? '' : 'none'}`} title={l.assignee ?? 'Bila mhusika'}>{l.assignee ? initials(l.assignee) : '?'}</span></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : !list.data?.data.length ? <Empty>Hakuna lead kwenye kundi hili.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Chama</th><th>Mhusika wa chama</th><th>Hatua</th><th>Kufuatilia</th><th>Mfanyakazi</th><th>Chanzo</th><th>Imeingia</th></tr></thead>
            <tbody>{list.data.data.map((l) => (
              <tr key={l.id} onClick={() => setOpen(l.id)} style={{ cursor: 'pointer' }}>
                <td data-label="Chama"><strong>{l.amcosName}</strong><div className="muted st-small">{[l.district, l.region].filter(Boolean).join(', ')}</div></td>
                <td data-label="Mhusika">{l.name}<div className="muted st-small">{fmtPhone(l.phone)}</div></td>
                <td data-label="Hatua"><StagePill s={l.stage} /></td>
                <td data-label="Kufuatilia"><FollowUp at={l.nextFollowUpAt} stage={l.stage} /></td>
                <td data-label="Mfanyakazi">{l.assignee ?? <span className="muted">—</span>}</td>
                <td data-label="Chanzo">{SOURCE_LABEL[l.source] ?? l.source}</td>
                <td data-label="Imeingia">{date(l.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {s && s.bySource.length > 0 && (
        <section className="card card-pad">
          <h3 className="desk-h3" style={{ marginTop: 0 }}>Vyanzo vya leads (miezi 6)</h3>
          <div className="src-bars">{s.bySource.map((x) => {
            const max = Math.max(...s.bySource.map((y) => y.n));
            return <div key={x.source} className="src-row"><span>{SOURCE_LABEL[x.source] ?? x.source}</span>
              <div className="st-prog" style={{ margin: 0 }}><i style={{ width: `${(x.n / max) * 100}%` }} /></div>
              <b>{x.n}</b><small className="muted">{x.won} wateja</small></div>;
          })}</div>
        </section>
      )}
      {adding && <NewLead onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); reload(); setOpen(id); }} />}
      {open && <LeadDetail id={open} onClose={() => { setOpen(null); if (sp.get('id')) setSp({}, { replace: true }); }} onChanged={reload} />}
    </>
  );
}

function StagePill({ s }: { s: Stage }) {
  const v = s === 'WON' ? 'ACTIVE' : s === 'LOST' ? 'CANCELLED' : s === 'NEW' ? 'PENDING' : 'TRIAL';
  return <Pill value={v} label={STAGE_LABEL[s]} />;
}

function NewLead({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ name: '', phone: '', amcosName: '', region: 'Tabora', district: '', email: '', members: '', source: 'PHONE', message: '', follow: localInput(new Date(Date.now() + 864e5)) });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction();
  return (
    <Modal open title="Lead mpya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={act.busy} disabled={f.name.length < 3 || f.amcosName.length < 3 || f.phone.length < 9} onClick={async () => {
        const r = await act.run(() => api<{ lead: Lead }>('/owner/leads', { method: 'POST', body: {
          name: f.name, phone: f.phone, amcosName: f.amcosName, region: f.region || null, district: f.district || null, email: f.email || null,
          members: f.members ? Number(f.members) : null, source: f.source, message: f.message || null, nextFollowUpAt: toIso(f.follow),
        } }));
        if (r) onSaved(r.lead.id);
      }}>Hifadhi lead</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="form-grid">
        <TextField label="Jina la chama *" placeholder="mf. Usoke AMCOS" value={f.amcosName} onChange={set('amcosName')} />
        <TextField label="Mhusika (jina) *" value={f.name} onChange={set('name')} />
        <TextField label="Simu *" type="tel" placeholder="07XXXXXXXX" value={f.phone} onChange={set('phone')} />
        <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        <TextField label="Mkoa" value={f.region} onChange={set('region')} />
        <TextField label="Wilaya" value={f.district} onChange={set('district')} />
        <TextField label="Idadi ya wakulima (makadirio)" type="number" min="1" value={f.members} onChange={set('members')} />
        <SelectField label="Chanzo" value={f.source} onChange={set('source')} options={SOURCES.filter(([k]) => k !== 'WEBSITE').map(([value, label]) => ({ value, label }))} />
        <TextField label="Kufuatilia tarehe" type="datetime-local" value={f.follow} onChange={set('follow')} />
      </div>
      <TextField label="Maelezo" value={f.message} onChange={set('message')} placeholder="mf. Amesikia kuhusu CoopLink kwenye mkutano wa Chama Kikuu" />
    </Modal>
  );
}

function LeadDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { has } = useAuth();
  const { data, error, reload } = useFetch<{ lead: Lead; activities: Activity[]; amcos: { id: string; name: string; code: string; status: string } | null }>(`/owner/leads/${id}`);
  const team = useFetch<{ data: { id: string; fullName: string }[] }>('/owner/leads/team');
  const manage = has('leads.manage');
  const [kind, setKind] = useState<'CALL' | 'MEETING' | 'NOTE' | 'SMS'>('CALL');
  const [body, setBody] = useState('');
  const [follow, setFollow] = useState(localInput(new Date(Date.now() + 2 * 864e5)));
  const [lost, setLost] = useState(false);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const lostWhy = reason === 'Nyingine' ? other.trim() : reason;
  const [link, setLink] = useState(false);
  const act = useAction();
  const done = () => { reload(); onChanged(); };
  const patch = async (b: Record<string, unknown>) => { if (await act.run(() => api(`/owner/leads/${id}`, { method: 'PATCH', body: b }))) done(); };
  const l = data?.lead;
  const closed = l?.stage === 'WON' || l?.stage === 'LOST';
  const save = async () => {
    const ok = kind === 'SMS'
      ? await act.run(() => api(`/owner/leads/${id}/sms`, { method: 'POST', body: { body } }))
      : await act.run(() => api(`/owner/leads/${id}/activities`, { method: 'POST', body: { kind, body, nextFollowUpAt: kind === 'NOTE' || closed ? undefined : toIso(follow) } }));
    if (ok) { setBody(''); done(); }
  };
  const wa = l ? `https://wa.me/${l.phone}` : '#';
  return (
    <Modal open size="lg" title={l?.amcosName ?? 'Lead'} onClose={onClose}>
      <Alert>{error ?? act.error}</Alert>
      {!l ? <Loading /> : (
        <div className="lead-detail">
          <div className="lead-top">
            <div>
              <div className="lead-who"><b>{l.name}</b> · <a href={`tel:+${l.phone}`}>{fmtPhone(l.phone)}</a> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a>{l.email && <> · <a href={`mailto:${l.email}`}>{l.email}</a></>}</div>
              <div className="muted st-small">{[l.district, l.region].filter(Boolean).join(', ') || 'Eneo halijatajwa'}{l.members ? ` · wakulima ~${l.members.toLocaleString('en-US')}` : ''} · {SOURCE_LABEL[l.source] ?? l.source} · {date(l.createdAt)}</div>
              {l.message && <p className="lead-msg">“{l.message}”</p>}
            </div>
            <StagePill s={l.stage} />
          </div>

          {/* Hatua */}
          <div className="lead-steps" role="list">
            {OPEN_STAGES.map(([k, label], i) => {
              const cur = OPEN_STAGES.findIndex(([x]) => x === l.stage);
              const state = l.stage === 'WON' ? 'done' : i < cur ? 'done' : i === cur ? 'on' : '';
              return <button key={k} type="button" role="listitem" className={state} disabled={!manage || closed || k === l.stage} onClick={() => patch({ stage: k })}>{label}</button>;
            })}
          </div>

          {l.stage === 'WON' && data.amcos && <Alert kind="ok">Amekuwa mteja: <Link to={`/owner/amcos/${data.amcos.id}`}>{data.amcos.name} ({data.amcos.code})</Link></Alert>}
          {l.stage === 'LOST' && <Alert kind="warn">Amepotea: {l.lostReason} {manage && <Button size="sm" variant="ghost" onClick={() => patch({ stage: 'CONTACTED' })}>Fungua tena</Button>}</Alert>}

          {manage && (
            <div className="lead-ctl">
              <SelectField label="Mfanyakazi anayefuatilia" value={l.assignedToId ?? ''} onChange={(v) => patch({ assignedToId: v || null })}
                options={[{ value: '', label: '— Bila mhusika —' }, ...(team.data?.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))]} />
              {!closed && <TextField label="Kufuatilia tena" type="datetime-local" value={l.nextFollowUpAt ? localInput(new Date(l.nextFollowUpAt)) : ''} onChange={(v) => patch({ nextFollowUpAt: toIso(v) })} />}
              {!closed && <div className="lead-win">
                {has('amcos.create') && <Link className="btn btn-primary" to={`/owner/amcos?lead=${l.id}`}>✓ Sajili chama (mteja)</Link>}
                <Button variant="secondary" onClick={() => setLink(true)}>Unganisha na chama kilichopo</Button>
                <Button variant="ghost" onClick={() => setLost(true)}>Amepotea</Button>
              </div>}
            </div>
          )}

          {manage && (
            <div className="lead-log">
              <div className="lead-kinds" role="tablist">
                {(['CALL', 'MEETING', 'NOTE', ...(has('comms.send') && !closed ? ['SMS'] : [])] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k as typeof kind)}>{KIND[k][0]} {KIND[k][1]}</button>
                ))}
              </div>
              <textarea className="input" rows={3} maxLength={kind === 'SMS' ? 300 : 1000} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={kind === 'SMS' ? 'Ujumbe utaanza na "CoopLink:" — mf. Asante kwa muda wako leo…' : kind === 'CALL' ? 'Mmezungumza nini? Hatua inayofuata?' : 'Andika maelezo…'} />
              <div className="lead-log-foot">
                {kind !== 'NOTE' && kind !== 'SMS' && !closed && <label className="st-small">Kufuatilia tena <input className="input" type="datetime-local" value={follow} onChange={(e) => setFollow(e.target.value)} /></label>}
                {kind === 'SMS' && <span className="muted st-small">{body.length}/300 · SMS 3 kwa saa 24</span>}
                <Button busy={act.busy} disabled={body.trim().length < (kind === 'SMS' ? 5 : 2)} onClick={save}>{kind === 'SMS' ? 'Tuma SMS' : 'Hifadhi'}</Button>
              </div>
            </div>
          )}

          <h3 className="desk-h3">Historia</h3>
          <ol className="lead-tl">
            {data.activities.map((a) => (
              <li key={a.id} className={`k-${a.kind.toLowerCase()}`}>
                <span className="lead-tl-ic" aria-hidden="true">{KIND[a.kind]?.[0] ?? '•'}</span>
                <div><b>{KIND[a.kind]?.[1] ?? a.kind}</b> · <span className="muted st-small">{a.by} · {dateTime(a.createdAt)}</span>
                  <p>{a.body}</p>{a.kind === 'SMS' && a.meta?.status && <Pill value={a.meta.status} />}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {lost && (
        <Modal open title="Lead imepotea" onClose={() => setLost(false)}
          footer={<><Button variant="secondary" onClick={() => setLost(false)}>Ghairi</Button><Button variant="danger" disabled={lostWhy.length < 3} busy={act.busy} onClick={async () => { await patch({ stage: 'LOST', lostReason: lostWhy }); setLost(false); }}>Hifadhi</Button></>}>
          <SelectField label="Sababu" value={reason} onChange={setReason} options={[
            { value: '', label: 'Chagua…' }, { value: 'Bei ni kubwa kwao', label: 'Bei ni kubwa kwao' }, { value: 'Wanatumia mfumo mwingine', label: 'Wanatumia mfumo mwingine' },
            { value: 'Hawajaamua bado (msimu ujao)', label: 'Hawajaamua bado (msimu ujao)' }, { value: 'Hapatikani kwenye simu', label: 'Hapatikani kwenye simu' },
            { value: 'Hakuwa chama cha tumbaku', label: 'Hakuwa chama cha tumbaku' }, { value: 'Nyingine', label: 'Nyingine' }]} />
          {reason === 'Nyingine' && <TextField label="Eleza sababu" value={other} onChange={setOther} />}
        </Modal>
      )}
      {link && <LinkAmcos leadId={id} onClose={() => setLink(false)} onDone={() => { setLink(false); done(); }} />}
    </Modal>
  );
}

function LinkAmcos({ leadId, onClose, onDone }: { leadId: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const list = useFetch<{ data: { id: string; name: string; code: string; status: string }[] }>('/owner/amcos', { search: dq || undefined, pageSize: 10 });
  const act = useAction();
  return (
    <Modal open title="Unganisha lead na chama kilichosajiliwa" onClose={onClose}>
      <Alert>{act.error}</Alert>
      <input className="input" placeholder="Tafuta chama…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta chama" autoFocus />
      <ul className="desk-list">{(list.data?.data ?? []).map((a) => (
        <li key={a.id}><span className="grow"><b>{a.name}</b><span className="muted">{a.code}</span></span><Pill value={a.status} />
          <Button size="sm" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/leads/${leadId}/convert`, { method: 'POST', body: { amcosId: a.id } }))) onDone(); }}>Unganisha</Button></li>
      ))}</ul>
    </Modal>
  );
}
