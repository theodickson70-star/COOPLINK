import { useState } from 'react';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Button, Empty, Field, Input, Loading, Modal, PageHead, Pager, SelectField, TextField, Textarea } from '../components/ui';
import { LABELS, Pill, Section } from '../components/owner-ui';

interface Ann {
  id: string; kind: string; title: string; body: string; audience: string; amcosIds: string[] | null; channels: string[];
  sentAt: string | null; createdAt: string; createdBy: string | null; deliveryStats: Record<string, number>;
}

export function OwnerComms() {
  const { has } = useAuth();
  const [page, setPage] = useState(1);
  const list = useFetch<Paged<Ann>>('/owner/comms/announcements', { page, pageSize: 20 });
  const health = useFetch<{ integrations: { sms: string; email: string } }>(has('system.read') ? '/owner/system/health' : null);
  const [compose, setCompose] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const act = useAction();
  const smsOff = health.data && health.data.integrations.sms !== 'configured';

  return (
    <>
      <PageHead title="Marketing & Communication" sub="Matangazo kwa vyama: ndani ya mfumo, SMS na email">
        {has('comms.send') && <>
          <Button variant="secondary" busy={act.busy} onClick={async () => {
            const r = await act.run(() => api<{ targets: number; deliveries: Record<string, number> }>('/owner/comms/expiry-reminders', { method: 'POST', body: {} }));
            if (r) { setResult(r.targets ? `Vikumbusho vimetumwa kwa vyama ${r.targets}: ${fmtStats(r.deliveries)}` : 'Hakuna subscription inayokaribia kuisha.'); list.reload(); }
          }}>Tuma vikumbusho vya kuisha</Button>
          <Button onClick={() => setCompose(true)}>+ Tangazo jipya</Button>
        </>}
      </PageHead>
      {smsOff && <Alert kind="warn">SMS bado haijasanidiwa. Ujumbe wa SMS utarekodiwa kama <strong>Imerukwa</strong> (hautumwi). Email pia haijasanidiwa. Matangazo ya <strong>ndani ya mfumo</strong> yanafanya kazi.</Alert>}
      <Alert>{act.error ?? list.error}</Alert>
      <Alert kind="ok">{result}</Alert>
      <Section pad={false} title="Historia ya matangazo na kampeni">
        {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>Bado hakuna tangazo lililotumwa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tarehe</th><th>Aina</th><th>Kichwa</th><th>Walengwa</th><th>Njia</th><th>Uwasilishaji</th><th /></tr></thead>
            <tbody>{list.data?.data.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{dateTime(a.sentAt ?? a.createdAt)}</td>
                <td><Pill value={a.kind} /></td>
                <td><strong>{a.title}</strong><div className="muted" style={{ fontSize: 13 }}>{a.body.slice(0, 80)}{a.body.length > 80 ? '…' : ''}</div></td>
                <td>{a.audience === 'ALL' ? 'Vyama vyote' : `Vyama ${a.amcosIds?.length ?? 0}`}</td>
                <td>{a.channels.map((c) => LABELS[c] ?? c).join(', ')}</td>
                <td>{fmtStats(a.deliveryStats)}</td>
                <td className="num"><Button size="sm" variant="ghost" onClick={() => setDetail(a.id)}>Maelezo</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={list.data?.meta} onPage={setPage} />
      </Section>
      {compose && <Compose onClose={() => setCompose(false)} onSent={(msg) => { setCompose(false); setResult(msg); list.reload(); }} />}
      {detail && <DeliveryDetail id={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

const fmtStats = (s: Record<string, number>) => Object.entries(s).map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join(' · ') || '—';

function Compose({ onClose, onSent }: { onClose: () => void; onSent: (msg: string) => void }) {
  const [kind, setKind] = useState('ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [selected, setSelected] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>(['IN_APP']);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const amcos = useFetch<Paged<{ id: string; name: string; code: string; status: string }>>(audience === 'SELECTED' ? '/owner/amcos' : null, { search: q, pageSize: 50 });
  const { busy, error, run } = useAction();
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <Modal open title="Tangazo jipya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={title.length < 3 || body.length < 3 || !channels.length || (audience === 'SELECTED' && !selected.length)} onClick={async () => {
        const r = await run(() => api<{ targets: number; deliveries: Record<string, number> }>('/owner/comms/announcements', { method: 'POST', body: { kind, title, body, audience, amcosIds: audience === 'SELECTED' ? selected : undefined, channels } }));
        if (r) onSent(`Tangazo limetumwa kwa vyama ${r.targets}: ${fmtStats(r.deliveries)}`);
      }}>Tuma</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <SelectField label="Aina" value={kind} onChange={setKind} options={['ANNOUNCEMENT', 'SYSTEM_UPDATE', 'MARKETING'].map((v) => ({ value: v, label: LABELS[v] }))} />
        <SelectField label="Walengwa" value={audience} onChange={setAudience} options={[{ value: 'ALL', label: 'Vyama vyote (hai na vilivyositishwa)' }, { value: 'SELECTED', label: 'Vyama nitakavyochagua' }]} />
      </div>
      <TextField label="Kichwa *" maxLength={120} value={title} onChange={setTitle} />
      <Field label="Ujumbe *" help={`${body.length}/1000 · SMS zinakatwa kwenye herufi 459`}>{(id) => <Textarea id={id} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      <fieldset className="perm-box"><legend>Njia</legend>
        <div className="actions">
          {['IN_APP', 'SMS', 'EMAIL'].map((c) => <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels(toggle(channels, c))} />{LABELS[c]}</label>)}
        </div>
      </fieldset>
      {audience === 'SELECTED' && (
        <fieldset className="perm-box"><legend>Chagua vyama ({selected.length})</legend>
          <Input aria-label="Tafuta chama" placeholder="Tafuta…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="perm-grid" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
            {amcos.data?.data.map((a) => <label key={a.id}><input type="checkbox" checked={selected.includes(a.id)} onChange={() => setSelected(toggle(selected, a.id))} />{a.name} <span className="muted">({a.code})</span></label>)}
          </div>
        </fieldset>
      )}
    </Modal>
  );
}

function DeliveryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading } = useFetch<{ announcement: Ann; deliveries: { id: string; channel: string; recipient: string | null; status: string; error: string | null; amcosName: string | null }[] }>(`/owner/comms/announcements/${id}`);
  return (
    <Modal open title={data?.announcement.title ?? 'Tangazo'} onClose={onClose}>
      {loading ? <Loading /> : data && (
        <>
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{data.announcement.body}</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Chama</th><th>Njia</th><th>Mpokeaji</th><th>Hali</th></tr></thead>
            <tbody>{data.deliveries.map((d) => (
              <tr key={d.id}><td>{d.amcosName ?? '—'}</td><td>{LABELS[d.channel] ?? d.channel}</td><td>{d.recipient ?? '—'}</td>
                <td><Pill value={d.status} />{d.error && <div className="muted" style={{ fontSize: 12 }}>{d.error}</div>}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </Modal>
  );
}
