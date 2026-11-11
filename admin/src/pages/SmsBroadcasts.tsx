// =====================================================================
//  MATANGAZO NA VIKAO KWA SMS (Meneja) — taarifa kwa wakulima wote, kwa kijiji au kwa kikundi.
//   Gharama inabebwa na CoopLink, kwa hiyo kila chama kina kikomo cha SMS kwa mwezi (kinawekwa na CoopLink).
// =====================================================================
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, num } from '../lib/format';
import { Alert, Badge, Button, Empty, Field, Loading, PageHead, Select, Textarea } from '../components/ui';
import { Section } from '../components/owner-ui';

type Kind = 'MEETING' | 'ANNOUNCEMENT';
type Audience = { type: 'ALL' } | { type: 'VILLAGE'; village: string } | { type: 'GROUP'; groupId: string };
interface Quota { enabled: boolean; limit: number; used: number; remaining: number }
interface Broadcast { id: string; kind: Kind; message: string; audience: Audience; recipients: number; segments: number; createdAt: string; createdBy: string | null; sent: number; failed: number }
interface Data { quota: Quota; villages: string[]; groups: { id: string; name: string }[]; chama: string; data: Broadcast[] }
interface Preview { farmers: number; withPhone: number; segments: number; total: number; text: string; quota: Quota }

const KIND_LABEL: Record<Kind, string> = { MEETING: 'Taarifa ya kikao', ANNOUNCEMENT: 'Tangazo' };

export function SmsBroadcasts() {
  const { may } = useAuth();
  const canSend = may('members.approve');
  const d = useFetch<Data>('/sms/broadcasts');
  const [kind, setKind] = useState<Kind>('MEETING');
  const [message, setMessage] = useState('');
  const [aud, setAud] = useState<'ALL' | 'VILLAGE' | 'GROUP'>('ALL');
  const [village, setVillage] = useState('');
  const [groupId, setGroupId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const act = useAction();

  const audience: Audience | null = aud === 'ALL' ? { type: 'ALL' } : aud === 'VILLAGE' ? (village ? { type: 'VILLAGE', village } : null) : groupId ? { type: 'GROUP', groupId } : null;
  useEffect(() => { setPreview(null); }, [kind, message, aud, village, groupId]);

  if (d.loading && !d.data) return <Loading />;
  if (!d.data) return <Alert>{d.error}</Alert>;
  const q = d.data.quota;
  const body = () => ({ kind, message: message.trim(), audience });

  const check = async () => { setOk(null); const r = await act.run(() => api<Preview>('/sms/broadcasts/preview', { method: 'POST', body: body() })); if (r) setPreview(r); };
  const send = async () => {
    const r = await act.run(() => api<{ queued: number }>('/sms/broadcasts', { method: 'POST', body: body() }));
    if (r) { setOk(`Ujumbe umepangwa kutumwa kwa wakulima ${num(r.queued)}.`); setMessage(''); setPreview(null); d.reload(); }
  };
  const audLabel = (a: Audience) => a.type === 'ALL' ? 'Wakulima wote' : a.type === 'VILLAGE' ? `Kijiji: ${a.village}` : `Kikundi: ${d.data!.groups.find((g) => g.id === a.groupId)?.name ?? '—'}`;

  return (
    <div className="stack">
      <PageHead title="Matangazo na vikao kwa SMS" sub="Wajulishe wakulima kuhusu vikao, mikutano na matangazo muhimu ya chama kwa SMS." />
      {!q.enabled && <Alert kind="warn">Huduma ya matangazo kwa SMS haijawashwa kwa sasa. Wasiliana na CoopLink kuiwasha.</Alert>}
      <div className="grid grid-kpi">
        <div className="card card-pad"><div className="muted small">SMS zilizotumika mwezi huu</div><strong style={{ fontSize: 22 }}>{num(q.used)}</strong> <span className="muted">/ {num(q.limit)}</span></div>
        <div className="card card-pad"><div className="muted small">Zimebaki mwezi huu</div><strong style={{ fontSize: 22 }}>{num(q.remaining)}</strong></div>
      </div>

      {canSend && q.enabled && (
        <Section title="Andika ujumbe">
          <div className="stack">
            <div className="form-grid">
              <Field label="Aina">{(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Kind)}><option value="MEETING">Taarifa ya kikao / mkutano</option><option value="ANNOUNCEMENT">Tangazo</option></Select>}</Field>
              <Field label="Wapokeaji">{(id) => <Select id={id} value={aud} onChange={(e) => setAud(e.target.value as typeof aud)}><option value="ALL">Wakulima wote (hai)</option><option value="VILLAGE">Kijiji kimoja</option><option value="GROUP">Kikundi kimoja</option></Select>}</Field>
              {aud === 'VILLAGE' && <Field label="Kijiji">{(id) => <Select id={id} value={village} onChange={(e) => setVillage(e.target.value)}><option value="">— chagua —</option>{d.data!.villages.map((v) => <option key={v} value={v}>{v}</option>)}</Select>}</Field>}
              {aud === 'GROUP' && <Field label="Kikundi">{(id) => <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">— chagua —</option>{d.data!.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}</Field>}
            </div>
            <Field label="Ujumbe" help={`${message.length}/450 · mf. "Kikao cha wanachama Jumamosi 15/11 saa 4 asubuhi ofisini kwa chama. Ajenda: makisio ya msimu."`}>
              {(id) => <Textarea id={id} rows={4} maxLength={450} value={message} onChange={(e) => setMessage(e.target.value)} />}
            </Field>
            <Alert>{act.error}</Alert>
            <Alert kind="ok">{ok}</Alert>
            {preview && (
              <div className="stack">
                <div className="sms-preview">{preview.text}</div>
                <Alert kind={preview.total > preview.quota.remaining ? 'error' : 'ok'}>
                  Wakulima {num(preview.farmers)} · wenye simu {num(preview.withPhone)} · SMS {preview.segments} kwa kila mmoja = <strong>SMS {num(preview.total)}</strong> (zimebaki {num(preview.quota.remaining)}).
                </Alert>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="secondary" busy={act.busy && !preview} disabled={message.trim().length < 5 || !audience} onClick={check}>Hakiki</Button>
              <Button busy={act.busy && !!preview} disabled={!preview || preview.withPhone === 0 || preview.total > preview.quota.remaining} onClick={send}>Tuma SMS</Button>
            </div>
          </div>
        </Section>
      )}

      <Section title="Historia ya matangazo" pad={false}>
        {d.data.data.length === 0 ? <Empty>Bado hakuna tangazo lililotumwa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tarehe</th><th>Aina</th><th>Ujumbe</th><th>Wapokeaji</th><th className="num">Wakulima</th><th>Hali</th></tr></thead>
            <tbody>{d.data.data.map((b) => (
              <tr key={b.id}>
                <td className="nowrap">{dateTime(b.createdAt)}<div className="muted small">{b.createdBy ?? ''}</div></td>
                <td>{KIND_LABEL[b.kind]}</td>
                <td style={{ minWidth: 220, maxWidth: 420, whiteSpace: 'normal' }}>{b.message}</td>
                <td>{audLabel(b.audience)}</td>
                <td className="num">{num(b.recipients)}</td>
                <td>{b.sent >= b.recipients ? <Badge status="APPROVED" label="Zimetumwa" /> : <Badge status="PENDING" label={`${num(b.sent)}/${num(b.recipients)}`} />}{b.failed > 0 && <div className="muted small">{b.failed} zimeshindwa</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
