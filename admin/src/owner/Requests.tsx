// =====================================================================
//  MAOMBI YA TIMU (v0.38)
//   Mfanyakazi: "Maombi kwa Owner" — anatuma ombi la huduma inayohitaji Owner na kufuatilia majibu.
//   Owner: "Maombi ya timu" — anaona maombi yote, anajibu, anafunga, na kutekeleza (mf. kumtoa mtumishi kwenye vifaa).
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Field, Loading, Modal, PageHead, SelectField, Textarea, TextField } from '../components/ui';
import { ConfirmDialog, Kpi, Pill, Tabs } from '../components/owner-ui';

type Status = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'DECLINED';
interface Req {
  id: string; requestNo: number; category: string; priority: string; status: Status; subject: string; amcosId: string | null; amcosName: string | null;
  by: string | null; byRole: string | null; messages: number; lastAt: string; unseen: boolean; createdAt: string; resolution: string | null;
}
const STATUS: Record<Status, [string, string]> = { OPEN: ['PENDING', 'Linasubiri'], IN_PROGRESS: ['TRIAL', 'Linashughulikiwa'], DONE: ['ACTIVE', 'Limekamilika'], DECLINED: ['CANCELLED', 'Limekataliwa'] };
const PRIORITY: Record<string, string> = { URGENT: 'Dharura', HIGH: 'Muhimu', NORMAL: 'Kawaida' };
export const CATEGORY_HELP: Record<string, string> = {
  ACCOUNT_SIGNOUT: 'Mtumishi wa chama apotewe na simu au mtu mwingine ameingia kwenye akaunti yake — Owner atamtoa kwenye vifaa vyote.',
  FEE_WAIVER: 'Chama kinaomba kusamehewa au kupunguziwa ada ya CoopLink.',
  REFUND: 'Malipo yamekatwa mara mbili au kimakosa — yanahitaji kurudishwa.',
  AMCOS_APPROVAL: 'Chama kipya kimesajiliwa na kinasubiri idhini ya Owner.',
  TECHNICAL: 'Hitilafu ya mfumo, SMS, malipo ya simu au backup — Msaada wa Kiufundi uko kwa Owner.',
  ACCESS: 'Unahitaji ruhusa zaidi, au kuna tatizo kwenye akaunti yako.',
  OTHER: 'Jambo jingine linalohitaji uamuzi wa Owner.',
};

export function OwnerRequests() {
  const { user } = useAuth();
  const owner = user?.role === 'SUPER_ADMIN';
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<'ACTIVE' | 'DONE' | 'DECLINED' | ''>('ACTIVE');
  const { data, error, loading, reload } = useFetch<{ data: Req[]; categories: Record<string, string> }>('/owner/requests', { status: status || undefined });
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [open, setOpen] = useState<string | null>(sp.get('id'));
  useEffect(() => { const id = sp.get('id'); if (id) setOpen(id); }, [sp]);
  const cats = data?.categories ?? {};
  const rows = data?.data ?? [];
  const urgent = rows.filter((r) => r.priority === 'URGENT' && (r.status === 'OPEN' || r.status === 'IN_PROGRESS')).length;
  return (
    <>
      <PageHead title={owner ? 'Maombi ya timu' : 'Maombi kwa Owner'}
        sub={owner ? 'Wafanyakazi wanaomba huduma zinazohitaji uamuzi au ruhusa yako' : 'Huduma zinazohitaji Owner: kumtoa mtumishi kwenye vifaa, kusamehe ada, marejesho, tatizo la kiufundi…'}>
        {!owner && <Button onClick={() => setCreating(true)}>+ Ombi jipya</Button>}
      </PageHead>
      {owner && status === 'ACTIVE' && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Yanasubiri uamuzi" value={rows.length} />
          <Kpi tone={urgent ? 'bad' : undefined} label="Ya dharura" value={urgent} />
          <Kpi label="Wafanyakazi walioomba" value={new Set(rows.map((r) => r.by)).size} />
        </div>
      )}
      <div className="no-print" style={{ margin: '12px 0' }}>
        <Tabs value={status} onChange={setStatus} items={[['ACTIVE', 'Yanayoendelea'], ['DONE', 'Yaliyokamilika'], ['DECLINED', 'Yaliyokataliwa'], ['', 'Yote']]} />
      </div>
      <Alert>{error}</Alert>
      <section className="card">
        {loading && !data ? <Loading /> : rows.length === 0 ? <Empty>{owner ? 'Hakuna ombi kwenye kundi hili.' : 'Hujatuma ombi lolote hapa. Bonyeza "+ Ombi jipya".'}</Empty> : (
          <ul className="req-list">{rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className={r.unseen ? 'unseen' : ''}>
                <span className={`req-pri ${r.priority.toLowerCase()}`} aria-hidden="true" />
                <span className="grow">
                  <b>#{r.requestNo} · {r.subject}</b>
                  <span className="muted st-small">{cats[r.category] ?? r.category}{r.amcosName ? ` · ${r.amcosName}` : ''}{owner && r.by ? ` · ${r.by} (${ROLE_LABEL[r.byRole ?? ''] ?? r.byRole})` : ''}</span>
                </span>
                <span className="req-meta">
                  {r.priority !== 'NORMAL' && <Pill value={r.priority === 'URGENT' ? 'FAILED' : 'PENDING'} label={PRIORITY[r.priority]} />}
                  <Pill value={STATUS[r.status][0]} label={STATUS[r.status][1]} />
                  {r.unseen && <span className="req-new">Jibu jipya</span>}
                  <span className="muted st-small">{dateTime(r.lastAt)}</span>
                </span>
              </button>
            </li>
          ))}</ul>
        )}
      </section>
      {creating && <NewRequest onClose={() => { setCreating(false); if (sp.get('new')) setSp({}, { replace: true }); }} onSaved={(id) => { setCreating(false); setSp({}, { replace: true }); reload(); setOpen(id); }} />}
      {open && <RequestDetail id={open} onClose={() => { setOpen(null); if (sp.get('id')) setSp({}, { replace: true }); reload(); }} onChanged={reload} />}
    </>
  );
}

/** Fomu ya ombi — inaweza kufunguliwa kutoka popote (mf. Msaada wa akaunti) ikiwa imejazwa tayari. */
export function NewRequest({ onClose, onSaved, preset }: {
  onClose: () => void; onSaved: (id: string) => void;
  preset?: { category: string; subject: string; amcosId?: string; amcosName?: string; targetUserId?: string; targetName?: string };
}) {
  const [category, setCategory] = useState(preset?.category ?? 'TECHNICAL');
  const [priority, setPriority] = useState('NORMAL');
  const [subject, setSubject] = useState(preset?.subject ?? '');
  const [body, setBody] = useState('');
  const [amcos, setAmcos] = useState<{ id: string; name: string } | null>(preset?.amcosId ? { id: preset.amcosId, name: preset.amcosName ?? '' } : null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const list = useFetch<Paged<{ id: string; name: string; code: string }>>(!preset?.amcosId && dq ? '/owner/amcos' : null, { search: dq, pageSize: 8 });
  const act = useAction();
  const locked = !!preset?.targetUserId;
  const node = (
    <Modal open title="Ombi jipya kwa Owner" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={act.busy} disabled={subject.trim().length < 5 || body.trim().length < 10} onClick={async () => {
        const r = await act.run(() => api<{ request: { id: string } }>('/owner/requests', { method: 'POST', body: {
          category, priority, subject, body, amcosId: amcos?.id ?? null, targetUserId: preset?.targetUserId ?? null,
        } }));
        if (r) onSaved(r.request.id);
      }}>Tuma kwa Owner</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="form-grid">
        <SelectField label="Aina ya ombi" value={category} onChange={setCategory} options={Object.entries({
          ACCOUNT_SIGNOUT: 'Kumtoa mtumishi wa chama kwenye vifaa vyote', FEE_WAIVER: 'Kusamehe / kupunguza ada', REFUND: 'Marejesho ya malipo',
          AMCOS_APPROVAL: 'Idhini ya chama', TECHNICAL: 'Tatizo la kiufundi', ACCESS: 'Ruhusa / akaunti yangu', OTHER: 'Mengineyo',
        }).filter(([k]) => k !== 'ACCOUNT_SIGNOUT' || locked).map(([value, label]) => ({ value, label }))} help={CATEGORY_HELP[category]} />
        <SelectField label="Uharaka" value={priority} onChange={setPriority} options={[{ value: 'NORMAL', label: 'Kawaida' }, { value: 'HIGH', label: 'Muhimu' }, { value: 'URGENT', label: 'Dharura — Owner apate SMS sasa hivi' }]} />
      </div>
      {preset?.targetName && <div className="req-target">👤 Mtumishi: <b>{preset.targetName}</b>{preset.amcosName ? ` · ${preset.amcosName}` : ''}</div>}
      {!preset?.amcosId && (
        <div className="form-grid">
          {amcos ? <div className="req-target">🏠 Chama: <b>{amcos.name}</b> <Button size="sm" variant="ghost" onClick={() => setAmcos(null)}>Ondoa</Button></div> : (
            <div style={{ gridColumn: '1 / -1' }}>
              <TextField label="Chama kinachohusika (hiari)" placeholder="Tafuta jina au code…" value={q} onChange={setQ} />
              {list.data?.data.length ? <ul className="desk-list">{list.data.data.map((a) => <li key={a.id}><span className="grow"><b>{a.name}</b><span className="muted">{a.code}</span></span><Button size="sm" variant="ghost" onClick={() => { setAmcos(a); setQ(''); }}>Chagua</Button></li>)}</ul> : null}
            </div>
          )}
        </div>
      )}
      <TextField label="Kichwa *" maxLength={140} placeholder="mf. Meneja wa Usoke amepoteza simu" value={subject} onChange={setSubject} />
      <Field label="Maelezo *" help={`${body.length}/3000`}>{(fid) => <Textarea id={fid} rows={4} maxLength={3000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Eleza kilichotokea, ulichokwisha fanya, na unachoomba Owner afanye." />}</Field>
    </Modal>
  );
  return createPortal(node, document.body);
}

interface Detail {
  request: { id: string; requestNo: number; category: string; priority: string; status: Status; subject: string; resolution: string | null; createdAt: string; resolvedAt: string | null };
  creator: { fullName: string; role: string } | null; amcos: { id: string; name: string; code: string } | null;
  target: { id: string; fullName: string; role: string; phone: string; isActive: boolean; lastLoginAt: string | null } | null;
  messages: { id: string; body: string; createdAt: string; by: string | null; role: string | null; mine: boolean }[];
  categories: Record<string, string>; can: { manage: boolean; execute: boolean };
}

function RequestDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useFetch<Detail>(`/owner/requests/${id}`);
  const [msg, setMsg] = useState('');
  const [decline, setDecline] = useState(false);
  const [why, setWhy] = useState('');
  const [exec, setExec] = useState(false);
  const act = useAction();
  const done = () => { reload(); onChanged(); };
  const setStatus = async (status: Status, resolution?: string) => { if (await act.run(() => api(`/owner/requests/${id}/status`, { method: 'POST', body: { status, resolution } }))) { setDecline(false); setWhy(''); done(); } };
  const d = data;
  const closed = d && (d.request.status === 'DONE' || d.request.status === 'DECLINED');
  return (
    <Modal open size="lg" title={d ? `#${d.request.requestNo} · ${d.request.subject}` : 'Ombi'} onClose={onClose}>
      <Alert>{error ?? act.error}</Alert>
      {!d ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="req-head">
            <Pill value={STATUS[d.request.status][0]} label={STATUS[d.request.status][1]} />
            {d.request.priority !== 'NORMAL' && <Pill value={d.request.priority === 'URGENT' ? 'FAILED' : 'PENDING'} label={PRIORITY[d.request.priority]} />}
            <span className="muted st-small">{d.categories[d.request.category]} · {d.creator?.fullName} ({ROLE_LABEL[d.creator?.role ?? ''] ?? d.creator?.role}) · {dateTime(d.request.createdAt)}</span>
          </div>
          {(d.amcos || d.target) && (
            <div className="req-ctx">
              {d.amcos && <span>🏠 <Link to={`/owner/amcos/${d.amcos.id}`}>{d.amcos.name}</Link> ({d.amcos.code})</span>}
              {d.target && <span>👤 {d.target.fullName} · {ROLE_LABEL[d.target.role] ?? d.target.role} · {d.target.phone}{d.target.lastLoginAt ? ` · aliingia ${dateTime(d.target.lastLoginAt)}` : ''}</span>}
            </div>
          )}
          {d.can.execute && (
            <div className="req-exec">
              <div><b>Tekeleza ombi hili</b><span className="muted st-small">{d.target?.fullName} atatolewa kwenye vifaa vyote na kujulishwa kwa SMS. Ataingia tena kwa nenosiri na OTP.</span></div>
              <Button variant="danger" onClick={() => setExec(true)}>Toa kwenye vifaa vyote</Button>
            </div>
          )}
          <ol className="req-thread">
            {d.messages.map((m) => (
              <li key={m.id} className={m.role === 'SUPER_ADMIN' ? 'owner' : ''}>
                <span className="req-av" aria-hidden="true">{(m.by ?? '?').charAt(0)}</span>
                <div><b>{m.by}</b> <span className="muted st-small">{m.role === 'SUPER_ADMIN' ? 'Owner' : ROLE_LABEL[m.role ?? ''] ?? ''} · {dateTime(m.createdAt)}</span><p>{m.body}</p></div>
              </li>
            ))}
          </ol>
          {d.request.resolution && closed && <Alert kind={d.request.status === 'DONE' ? 'ok' : 'warn'}>{d.request.status === 'DONE' ? 'Limekamilika' : 'Limekataliwa'}: {d.request.resolution}</Alert>}
          {(!closed || !d.can.manage) && (
            <div className="req-reply">
              <textarea className="input" rows={2} maxLength={3000} placeholder={closed ? 'Andika ujumbe kufungua ombi tena…' : 'Andika jibu…'} value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Jibu" />
              <Button busy={act.busy} disabled={msg.trim().length < 2} onClick={async () => { if (await act.run(() => api(`/owner/requests/${id}/messages`, { method: 'POST', body: { body: msg } }))) { setMsg(''); done(); } }}>Tuma</Button>
            </div>
          )}
          {d.can.manage && !closed && (
            <div className="actions">
              {d.request.status === 'OPEN' && <Button variant="secondary" busy={act.busy} onClick={() => setStatus('IN_PROGRESS')}>Ninashughulikia</Button>}
              <Button busy={act.busy} onClick={() => setStatus('DONE', msg.trim() || undefined)}>Imekamilika</Button>
              <Button variant="ghost" onClick={() => setDecline(true)}>Kataa</Button>
            </div>
          )}
          {decline && (
            <div className="help-form">
              <TextField label="Sababu ya kukataa *" value={why} onChange={setWhy} />
              <div className="actions"><Button variant="secondary" onClick={() => setDecline(false)}>Ghairi</Button><Button variant="danger" disabled={why.trim().length < 3} busy={act.busy} onClick={() => setStatus('DECLINED', why)}>Kataa ombi</Button></div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={exec} danger title={`Toa ${d?.target?.fullName ?? ''} kwenye vifaa vyote?`} confirmLabel="Toa kwenye vifaa vyote" onClose={() => setExec(false)}
        message="Sessions zote na vifaa vinavyoaminika vitafutwa mara moja. Mtumishi na mwombaji watajulishwa kwa SMS, na ombi litafungwa."
        onConfirm={async (c) => { await api(`/owner/requests/${id}/execute`, { method: 'POST', body: c }); setExec(false); done(); }} />
    </Modal>
  );
}
