// ADA ZA COOPLINK (Owner): bei, vyama vinavyodaiwa, kudai/kusamehe kingilio kwa vyama vya zamani
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, TextField } from '../components/ui';
import { money, Section } from '../components/owner-ui';
import type { BillingData } from '../pages/Billing';

interface FeeSettings { enabled: boolean; entranceFee: number; entranceDays: number; seasonFee: number; seasonInstallments: number; deadlineMonth: number; deadlineDay: number }
const ST: Record<string, string> = { UNPAID: 'Haijalipwa', PARTIAL: 'Sehemu', PAID: 'Imelipwa', WAIVED: 'Imesamehewa' };
const tone = (s: string | null) => (s === 'PAID' ? 'PAID' : s === 'WAIVED' ? 'COMPLETED' : s === 'PARTIAL' ? 'PARTIAL' : s ? 'PENDING' : 'DRAFT');

export function OwnerFees() {
  const { has } = useAuth();
  const st = useFetch<{ settings: FeeSettings; teepay: { enabled: boolean; webhook: boolean; mode: string | null } }>('/owner/fees/settings');
  const list = useFetch<{ data: Record<string, any>[] }>('/owner/fees');
  const [edit, setEdit] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  if (!st.data || !list.data) return <Loading />;
  const s = st.data.settings, t = st.data.teepay;
  return (
    <div className="stack">
      <Alert kind="ok">{ok}</Alert>
      {!t.enabled && <Alert kind="warn">TeePay haijaunganishwa: weka TEEPAY_API_KEY na TEEPAY_WEBHOOK_SECRET kwenye Railway Variables. Mpaka hapo vyama havifungwi kwa ada (hawana njia ya kulipa).</Alert>}
      {t.enabled && !t.webhook && <Alert kind="warn">TEEPAY_WEBHOOK_SECRET haipo: malipo yatathibitishwa kwa kitufe cha "Hakiki" na kazi ya kila saa tu, si papo hapo.</Alert>}
      <Section title="Bei na utaratibu" actions={has('subscriptions.manage') && <Button size="sm" onClick={() => setEdit(true)}>Badilisha</Button>}>
        <dl className="dl">
          <dt>Ada ya kingilio</dt><dd><strong>{money(s.entranceFee)}</strong> · ndani ya siku {s.entranceDays} baada ya chama kufunguliwa</dd>
          <dt>Ada ya msimu</dt><dd><strong>{money(s.seasonFee)}</strong> · awamu {s.seasonInstallments} · mwisho {s.deadlineDay}/{s.deadlineMonth} kila mwaka</dd>
          <dt>Vyama vipya</dt><dd>{s.enabled ? 'Vinadaiwa kingilio vikifunguliwa' : 'Havidaiwi (ada zimezimwa)'}</dd>
          <dt>TeePay</dt><dd>{t.enabled ? `Imeunganishwa (${t.mode === 'live' ? 'LIVE' : 'majaribio'})` : 'Haijaunganishwa'}{t.webhook ? ' · webhook ipo' : ''}</dd>
        </dl>
      </Section>
      <Section pad={false} title="Vyama na ada zao">
        {list.data.data.length === 0 ? <Empty>Hakuna chama.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Chama</th><th>Kingilio</th><th>Ada ya msimu</th><th /></tr></thead>
            <tbody>{list.data.data.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/owner/amcos/${r.id}`}><strong>{r.name}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{r.code}{r.overdue > 0 ? ' · ' : ''}{r.overdue > 0 && <span className="text-bad">imefungwa</span>}</div></td>
                <td>{r.entrance_id ? <><Badge status={tone(r.entrance_status)} label={ST[r.entrance_status]} /><div className="muted" style={{ fontSize: 12 }}>{money(r.entrance_paid)} / {money(r.entrance_amount)} · {date(r.entrance_due)}</div></> : <span className="muted">Haidaiwi</span>}</td>
                <td>{r.season_id ? <><Badge status={tone(r.season_status)} label={ST[r.season_status]} /><div className="muted" style={{ fontSize: 12 }}>{r.season_label?.replace('Ada ya msimu ', '')} · {money(r.season_paid)} / {money(r.season_amount)} · {date(r.season_due)}</div></> : <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'right' }}><Link className="btn btn-secondary btn-sm" to={`/owner/amcos/${r.id}`}>Fungua</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      {edit && <SettingsModal s={s} onClose={() => setEdit(false)} onDone={(m) => { setEdit(false); setOk(m); st.reload(); }} />}
    </div>
  );
}

function SettingsModal({ s, onClose, onDone }: { s: FeeSettings; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v)])) as Record<string, string | boolean>);
  const act = useAction();
  const set = (k: string) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Modal open title="Bei za ada za CoopLink" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={act.busy} onClick={async () => { const r = await act.run(() => api<{ note: string }>('/owner/fees/settings', { method: 'PUT', body: f })); if (r) onDone(r.note); }}>Hifadhi</Button></>}>
      <Alert>{act.error}</Alert>
      <Alert kind="warn">Bei mpya zinatumika kwa ada zitakazodaiwa kuanzia sasa tu; ada zilizokwisha kudaiwa hazibadiliki.</Alert>
      <div className="form-grid">
        <TextField label="Ada ya kingilio (TSh)" type="number" value={String(f.entranceFee)} onChange={set('entranceFee')} />
        <TextField label="Siku za kulipa kingilio" type="number" value={String(f.entranceDays)} onChange={set('entranceDays')} />
        <TextField label="Ada ya msimu (TSh)" type="number" value={String(f.seasonFee)} onChange={set('seasonFee')} />
        <TextField label="Awamu za ada ya msimu" type="number" value={String(f.seasonInstallments)} onChange={set('seasonInstallments')} />
        <TextField label="Mwisho: siku" type="number" value={String(f.deadlineDay)} onChange={set('deadlineDay')} />
        <TextField label="Mwisho: mwezi" type="number" value={String(f.deadlineMonth)} onChange={set('deadlineMonth')} />
      </div>
      <label className="check"><input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Vyama vipya vidaiwe ada ya kingilio vikifunguliwa</label>
    </Modal>
  );
}

/** Sehemu ya "Ada za CoopLink" kwenye ukurasa wa chama (Owner). */
export function AmcosFeesSection({ amcosId, active }: { amcosId: string; active: boolean }) {
  const { has } = useAuth();
  const { data, reload } = useFetch<Omit<BillingData, 'config'>>(`/owner/fees/amcos/${amcosId}`);
  const [modal, setModal] = useState<null | { kind: 'waive-entrance' } | { kind: 'waive'; feeId: string; label: string }>(null);
  const [reason, setReason] = useState('');
  const act = useAction();
  if (!data) return <Loading />;
  const manage = has('subscriptions.manage');
  const hasEntrance = data.fees.some((f) => f.kind === 'ENTRANCE');
  const close = () => { setModal(null); setReason(''); };
  return (
    <Section pad={false} title="Ada za CoopLink (kingilio na msimu)" actions={manage && active && !hasEntrance && <>
      <Button size="sm" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/fees/amcos/${amcosId}/entrance`, { method: 'POST', body: {} }))) reload(); }}>Dai ada ya kingilio</Button>
      <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'waive-entrance' })}>Samehe kingilio</Button>
    </>}>
      <Alert>{act.error}</Alert>
      {data.lock && <div style={{ padding: '0 16px' }}><Alert>Chama kimefungwa: {data.lock.label} haijalipwa tangu {date(data.lock.dueDate)}.</Alert></div>}
      {data.fees.length === 0 ? <Empty>Chama hiki hakidaiwi ada bado (kilikuwepo kabla ya ada). Chagua "Dai ada ya kingilio" (siku za kulipa zinaanza leo) au "Samehe kingilio".</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ada</th><th className="num">Kiasi</th><th className="num">Imelipwa</th><th>Mwisho</th><th>Hali</th><th>Control number / risiti</th><th /></tr></thead>
          <tbody>{data.fees.map((f) => (
            <tr key={f.id}>
              <td><strong>{f.label}</strong>{f.waivedReason && <div className="muted" style={{ fontSize: 12 }}>Msamaha: {f.waivedReason}</div>}</td>
              <td className="num">{money(f.amount)}</td><td className="num">{money(f.paid)}</td>
              <td className={f.overdue ? 'text-bad' : ''}>{date(f.dueDate)}</td>
              <td><Badge status={tone(f.status)} label={f.overdue ? 'Imepita tarehe' : ST[f.status]} /></td>
              <td style={{ fontSize: 13 }}>
                {f.controlNumbers.map((c) => <div key={c.id}>{c.number ?? 'inatolewa…'} · {money(c.amount)} · <span className="muted">{c.status}</span>{c.lastError ? <span className="text-bad"> · {c.lastError}</span> : null}
                  {(c.status === 'ISSUED' || c.status === 'ISSUING') && <> · <a href="#" onClick={async (e) => { e.preventDefault(); if (await act.run(() => api(`/owner/fees/control-numbers/${c.id}/sync`, { method: 'POST', body: {} }))) reload(); }}>hakiki</a></>}</div>)}
                {f.payments.map((p) => <div key={p.id}><Link to={`/owner/fees/receipts/${p.id}`}>{p.receiptNo}</Link> · {money(p.amount)} · {dateTime(p.paidAt)}</div>)}
              </td>
              <td style={{ textAlign: 'right' }}>{manage && (f.status === 'UNPAID' || f.status === 'PARTIAL') && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'waive', feeId: f.id, label: f.label })}>Samehe</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {modal && (
        <Modal open title={modal.kind === 'waive' ? `Samehe: ${modal.label}` : 'Samehe ada ya kingilio'} onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button busy={act.busy} disabled={reason.trim().length < 3} onClick={async () => {
            const ok = modal.kind === 'waive'
              ? await act.run(() => api(`/owner/fees/${modal.feeId}/waive`, { method: 'POST', body: { reason } }))
              : await act.run(() => api(`/owner/fees/amcos/${amcosId}/entrance`, { method: 'POST', body: { waive: true, reason } }));
            if (ok) { close(); reload(); }
          }}>Samehe</Button></>}>
          <p>Msamaha unahifadhiwa kwenye kumbukumbu pamoja na jina lako na sababu.{modal.kind === 'waive-entrance' ? ' Ada ya msimu itaanza kudaiwa.' : ''}</p>
          <TextField label="Sababu *" value={reason} onChange={setReason} />
        </Modal>
      )}
    </Section>
  );
}
