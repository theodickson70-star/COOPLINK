// =====================================================================
//  PESA YA KUNI — mikopo ya fedha kwa wakulima (kuandaa kuni za kukaushia tumbaku)
//   Mipangilio ya msimu · Andaa orodha (kikomo kwa ekari za makisio) · Meneja anaidhinisha
//   · Pesa zinatumwa kwenye akaunti za wakulima · Mhasibu anathibitisha waliolipwa
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiDownload } from '../lib/api';
import { useAction, useFetch, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, num, phone, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { DocHead, PrintButton, Signatures } from './acc-common';

interface Settings { interestRate: string; amountPerAcre: string; isOpen: boolean; configured?: boolean }
interface Eligible { memberId: string; memberNo: string; name: string; village: string | null; group: string | null; acres: string; estimatedKg: string; limit: string; taken: string; available: string; debt: string; method: string; destination: string }
const METHOD: Record<string, string> = { MOBILE_MONEY: 'Simu', BANK: 'Benki', CASH: 'Taslimu' };
const B_STATUS: Record<string, string> = { DRAFT: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — tuma pesa', PROCESSING: 'Inalipwa', PARTIAL: 'Sehemu', COMPLETED: 'Imekamilika', CANCELLED: 'Imefutwa' };

export function Kuni() {
  const { may } = useAuth();
  const [tab, setTab] = useState<'prepare' | 'batches'>('prepare');
  const st = useFetch<{ season: { name: string }; settings: Settings }>('/kuni/settings');
  const [ok, setOk] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Pesa ya kuni" sub={<>Mikopo ya fedha kwa wakulima kuandaa kuni za kukaushia tumbaku{st.data ? <> · Msimu <strong>{st.data.season.name}</strong></> : null}. Deni (mkopo + riba) linakatwa kwenye mauzo pamoja na deni la pembejeo.</>} />
      <Alert kind="ok">{ok}</Alert>
      {st.data && <SettingsCard s={st.data.settings} canEdit={may('finance.record')} onSaved={() => { st.reload(); setOk('Mipangilio ya pesa ya kuni imehifadhiwa'); }} />}
      <div style={{ marginTop: 16 }}><Tabs value={tab} onChange={setTab} items={[['prepare', 'Andaa orodha'], ['batches', 'Orodha za pesa ya kuni']]} /></div>
      {tab === 'prepare' ? <Prepare settings={st.data?.settings} onDone={(m) => { setOk(m); setTab('batches'); }} /> : <Batches />}
    </>
  );
}

function SettingsCard({ s, canEdit, onSaved }: { s: Settings; canEdit: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(!s.configured && s.configured !== undefined ? true : false);
  const [f, setF] = useState({ interestRate: String(Number(s.interestRate)), amountPerAcre: String(Number(s.amountPerAcre)), isOpen: s.isOpen || s.configured === false });
  const { busy, error, run } = useAction();
  if (!edit) return (
    <div className="grid grid-kpi">
      <Kpi tone="dark" label="Kikomo kwa ekari" value={tsh(s.amountPerAcre)} hint="Ekari za makisio yaliyoidhinishwa" />
      <Kpi label="Riba kwa msimu" value={`${num(s.interestRate)}%`} hint="Inaongezwa pesa zikitumwa" />
      <Kpi tone={s.isOpen ? undefined : 'warn'} label="Hali" value={s.isOpen ? 'Wazi' : 'Imefungwa'} hint={canEdit ? undefined : 'Inawekwa na Mhasibu'} />
      {canEdit && <button type="button" className="card kpi" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setEdit(true)}><span className="label">Mipangilio</span><span className="value" style={{ fontSize: 18 }}>Badilisha →</span></button>}
    </div>
  );
  return (
    <Section title="Mipangilio ya pesa ya kuni (msimu huu)">
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Kikomo kwa ekari (TSh) *" type="number" min="0" value={f.amountPerAcre} onChange={(v) => setF({ ...f, amountPerAcre: v })} help="Mkulima mwenye ekari 2 za makisio, kikomo = 2 × kiasi hiki" />
        <TextField label="Riba kwa msimu (%) *" type="number" min="0" step="0.1" value={f.interestRate} onChange={(v) => setF({ ...f, interestRate: v })} help="Mf. 10% — mkopo wa 500,000 unakuwa deni la 550,000" />
      </div>
      <label className="check"><input type="checkbox" checked={f.isOpen} onChange={(e) => setF({ ...f, isOpen: e.target.checked })} /> Pesa ya kuni iko wazi (inaweza kutolewa)</label>
      <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        {s.configured !== false && <Button variant="secondary" onClick={() => setEdit(false)}>Ghairi</Button>}
        {canEdit && <Button busy={busy} onClick={async () => { if (await run(() => api('/kuni/settings', { method: 'PUT', body: f }))) { setEdit(false); onSaved(); } }}>Hifadhi</Button>}
      </div>
    </Section>
  );
}

function Prepare({ settings, onDone }: { settings?: Settings; onDone: (m: string) => void }) {
  const { may } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const el = useFetch<{ data: Eligible[] }>('/kuni/eligible', { search: dq || undefined });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const rate = Number(settings?.interestRate ?? 0);
  const rows = el.data?.data ?? [];
  useEffect(() => { setAmounts((a) => ({ ...Object.fromEntries(rows.map((r) => [r.memberId, String(Number(r.available))])), ...a })); }, [el.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = rows.filter((r) => picked.has(r.memberId) && Number(amounts[r.memberId]) > 0);
  const total = useMemo(() => chosen.reduce((s, r) => s + Number(amounts[r.memberId] || 0), 0), [chosen, amounts]);
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  if (settings && (!settings.isOpen || Number(settings.amountPerAcre) <= 0)) return <Alert kind="warn">Pesa ya kuni haijafunguliwa msimu huu. Weka kikomo kwa ekari na riba kwenye mipangilio juu, kisha weka "iko wazi".</Alert>;
  return (
    <section className="card">
      <div className="toolbar">
        <input className="input" placeholder="Tafuta mkulima…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta mkulima" />
        <div className="grow" />
        <span className="muted">Wakulima wenye makisio yaliyoidhinishwa tu</span>
      </div>
      {!el.data ? <Loading /> : rows.length === 0 ? <Empty>Hakuna mkulima mwenye makisio yaliyoidhinishwa msimu huu. Makisio yanaingizwa na Stokipa na kuidhinishwa na Meneja.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Chagua wote" onChange={(e) => setPicked(e.target.checked ? new Set(rows.filter((r) => Number(r.available) > 0).map((r) => r.memberId)) : new Set())} /></th>
            <th>Mkulima</th><th className="num">Ekari</th><th className="num">Kikomo</th><th className="num">Amekopa</th><th className="num">Deni la sasa</th><th>Kiasi cha kutoa</th><th>Atalipwa kupitia</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.memberId} className={picked.has(r.memberId) ? 'row-picked' : ''} style={{ opacity: Number(r.available) > 0 ? 1 : 0.55 }}>
              <td>{Number(r.available) > 0 && <input type="checkbox" aria-label={`Chagua ${r.name}`} checked={picked.has(r.memberId)} onChange={() => toggle(r.memberId)} />}</td>
              <td><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.memberNo}{r.group ? ` · ${r.group}` : ''}</div></td>
              <td className="num">{num(r.acres)}</td><td className="num">{tsh(r.limit)}</td><td className="num">{Number(r.taken) ? tsh(r.taken) : '—'}</td>
              <td className="num">{Number(r.debt) ? tsh(r.debt) : '—'}</td>
              <td>{Number(r.available) > 0 ? <input className="input" style={{ maxWidth: 140 }} type="number" min="1" max={Number(r.available)} value={amounts[r.memberId] ?? ''} aria-label={`Kiasi ${r.name}`}
                onChange={(e) => { setAmounts({ ...amounts, [r.memberId]: e.target.value }); if (!picked.has(r.memberId)) toggle(r.memberId); }} /> : <span className="muted">Kikomo kimefika</span>}</td>
              <td style={{ fontSize: 13 }}>{METHOD[r.method]}{r.method !== 'CASH' ? ` · ${r.method === 'MOBILE_MONEY' ? phone(r.destination) : r.destination}` : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {chosen.length > 0 && (
        <div className="card-pad stack" style={{ gap: 10 }}>
          <div className="recon-sum" style={{ margin: 0 }}>
            <div><span>Wakulima</span><strong>{chosen.length}</strong></div>
            <div><span>Pesa ya kuni</span><strong>{tsh(total)}</strong></div>
            <div><span>Riba ({num(rate)}%)</span><strong>{tsh(total * rate / 100)}</strong></div>
            <div><span>Deni jipya (jumla)</span><strong>{tsh(total * (1 + rate / 100))}</strong></div>
          </div>
          <TextField label="Maelezo" value={notes} onChange={setNotes} placeholder="mf. Awamu ya kwanza ya pesa ya kuni" />
          <Alert>{error}</Alert>
          {may('finance.record') && <div className="actions" style={{ justifyContent: 'flex-end' }}><Button busy={busy} onClick={async () => {
            const r = await run(() => api<{ batch: { batchNo: string }; approval: { requestNo: string } }>('/kuni/batches', { method: 'POST', body: { notes: notes || null, loans: chosen.map((c) => ({ memberId: c.memberId, amount: amounts[c.memberId] })) } }));
            if (r) { setPicked(new Set()); onDone(`Orodha ${r.batch.batchNo} imetumwa kwa Meneja (${r.approval.requestNo}). Baada ya idhini, tuma pesa na uthibitishe waliolipwa.`); }
          }}>Tuma kwa Meneja</Button></div>}
        </div>
      )}
    </section>
  );
}

function Batches() {
  const { data } = useFetch<{ data: { id: string; batchNo: string; status: string; totalAmount: string; totalInterest: string; interestRate: string; farmers: number; paid: string; createdAt: string }[] }>('/kuni/batches');
  const nav = useNavigate();
  return (
    <section className="card">
      {!data ? <Loading /> : data.data.length === 0 ? <Empty>Bado hakuna orodha.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Orodha</th><th className="num">Wakulima</th><th className="num">Pesa ya kuni</th><th className="num">Riba</th><th className="num">Imetumwa</th><th>Hali</th></tr></thead>
          <tbody>{data.data.map((b) => (
            <tr key={b.id} onClick={() => nav(`/kuni/batches/${b.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{b.batchNo}</strong><div className="muted" style={{ fontSize: 12 }}>{dateTime(b.createdAt)}</div></td>
              <td className="num">{b.farmers}</td><td className="num">{tsh(b.totalAmount)}</td><td className="num">{tsh(b.totalInterest)} <span className="muted">({num(b.interestRate)}%)</span></td>
              <td className="num">{tsh(b.paid)}</td><td><Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} label={B_STATUS[b.status]} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

interface Loan { id: string; memberId: string; memberNo: string; memberName: string; amount: string; interest: string; method: string; provider: string | null; destination: string; status: string; providerRef: string | null; failureReason: string | null; txnNo: string | null }

export function KuniBatch() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<{ batch: { id: string; batchNo: string; status: string; totalAmount: string; totalInterest: string; interestRate: string }; approval: { requestNo: string; decidedBy: string | null; decidedAt: string | null } | null; loans: Loan[]; summary: { MOBILE_MONEY: string; BANK: string; CASH: string; paid: string; pending: number } }>(`/kuni/batches/${id}`);
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>(may('finance.record') ? '/finance/accounts' : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'confirm' | 'fail' | null>(null);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const b = data.batch;
  const payable = ['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status) && may('finance.record');
  const pickedTotal = data.loans.filter((l) => picked.has(l.id)).reduce((t, l) => t + Number(l.amount), 0);
  const toggle = (lid: string) => { const n = new Set(picked); if (n.has(lid)) n.delete(lid); else n.add(lid); setPicked(n); };
  const groups = (['MOBILE_MONEY', 'BANK', 'CASH'] as const).map((k) => [k, data.loans.filter((l) => l.method === k)] as const).filter(([, l]) => l.length);
  return (
    <>
      <PageHead title={<>{b.batchNo} <Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} label={B_STATUS[b.status]} /></>} sub={<>Pesa ya kuni {tsh(b.totalAmount)} · riba {num(b.interestRate)}% ({tsh(b.totalInterest)}) · imetumwa {tsh(data.summary.paid)}</>}>
        <Link className="btn btn-secondary no-print" to={may('finance.record') ? '/kuni' : '/approvals'}>← Rudi</Link>
        <Button variant="secondary" className="no-print" onClick={() => apiDownload(`/kuni/batches/${b.id}/csv`, { filename: `pesa-ya-kuni-${b.batchNo}.csv` })}>CSV ya benki / M-Pesa</Button>
        <PrintButton label="Chapisha orodha" />
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {b.status === 'DRAFT' && <Alert kind="warn">Inasubiri idhini ya Meneja. Hakuna pesa inayotumwa kabla ya idhini.</Alert>}
      {payable && data.summary.pending > 0 && <Alert kind="warn">Tuma pesa kwenye akaunti za wakulima (bulk M-Pesa, benki au taslimu), kisha chagua waliotumiwa na uthibitishe hapa. Mkopo na riba vinaingia kwenye deni la mkulima wakati wa kuthibitisha.</Alert>}
      <section className="card card-pad print-doc">
        <DocHead title="ORODHA YA PESA YA KUNI" no={b.batchNo} sub={`Riba ${num(b.interestRate)}% kwa msimu`} />
        {groups.map(([k, list]) => (
          <div key={k} className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="table fin-table">
              <thead><tr>{payable && <th className="no-print" style={{ width: 36 }} />}<th>{METHOD[k]} — Mkulima</th><th>{k === 'CASH' ? 'Sahihi ya mpokeaji' : 'Namba / akaunti'}</th><th className="num">Pesa ya kuni</th><th className="num">Riba</th><th>Hali</th></tr></thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} className={picked.has(l.id) ? 'row-picked' : ''}>
                    {payable && <td className="no-print">{(l.status === 'PENDING' || l.status === 'FAILED') && <input type="checkbox" aria-label={`Chagua ${l.memberName}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />}</td>}
                    <td>{l.memberName}<div className="muted" style={{ fontSize: 12 }}>{l.memberNo}</div></td>
                    <td>{k === 'CASH' ? <span className="sign-line" /> : <>{l.provider ? `${l.provider === 'MPESA' ? 'M-Pesa' : l.provider} · ` : ''}{k === 'MOBILE_MONEY' ? phone(l.destination) : l.destination}</>}</td>
                    <td className="num"><strong>{tsh(l.amount)}</strong></td><td className="num">{tsh(l.interest)}</td>
                    <td><Badge status={l.status} />{l.txnNo && <div className="muted" style={{ fontSize: 12 }}>{l.txnNo} · {l.providerRef}</div>}{l.failureReason && <div className="muted" style={{ fontSize: 12 }}>{l.failureReason}</div>}</td>
                  </tr>
                ))}
                <tr className="row-total">{payable && <td className="no-print" />}<td colSpan={2}>Jumla — {METHOD[k]} ({list.length})</td><td className="num">{tsh(list.reduce((t, l) => t + Number(l.amount), 0))}</td><td className="num">{tsh(list.reduce((t, l) => t + Number(l.interest), 0))}</td><td /></tr>
              </tbody>
            </table>
          </div>
        ))}
        {data.approval && <p className="muted">Idhini: {data.approval.requestNo}{data.approval.decidedBy ? ` · ${data.approval.decidedBy} · ${dateTime(data.approval.decidedAt)}` : ''}</p>}
        <Signatures items={['Ameandaa (Mhasibu)', 'Ameidhinisha (Meneja)', 'Mwenyekiti wa Bodi']} />
      </section>
      {payable && picked.size > 0 && (
        <div className="sticky-bar no-print">
          <span>Umechagua <strong>{picked.size}</strong> · {tsh(pickedTotal)}</span>
          <div className="actions"><Button variant="secondary" onClick={() => setMode('fail')}>Weka "imeshindwa"</Button><Button onClick={() => setMode('confirm')}>Thibitisha zimetumwa</Button></div>
        </div>
      )}
      {mode === 'confirm' && (
        <Modal open title={`Thibitisha pesa ya kuni ${picked.size} (${tsh(pickedTotal)})`} onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button busy={busy} disabled={!accountId || reference.trim().length < 2} onClick={async () => {
            const r = await run(() => api<{ confirmed: number }>(`/kuni/batches/${b.id}/confirm`, { method: 'POST', body: { accountId, loanIds: [...picked], reference } }));
            if (r) { setOk(`Pesa ya kuni ${r.confirmed} imethibitishwa — mkopo na riba vimeingia kwenye madeni ya wakulima`); setPicked(new Set()); setMode(null); reload(); }
          }}>Thibitisha</Button></>}>
          <Alert kind="warn">Thibitisha tu pesa zilizotoka kweli.</Alert>
          <div className="form-grid">
            <SelectField label="Akaunti iliyolipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
            <TextField label="Kumbukumbu ya malipo *" value={reference} onChange={setReference} />
          </div>
        </Modal>
      )}
      {mode === 'fail' && (
        <Modal open title="Malipo yameshindwa" onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
            const r = await run(() => api<{ failed: number }>(`/kuni/batches/${b.id}/fail`, { method: 'POST', body: { loanIds: [...picked], reason } }));
            if (r) { setOk(`Malipo ${r.failed} yamewekwa "yameshindwa"`); setPicked(new Set()); setMode(null); reload(); }
          }}>Hifadhi</Button></>}>
          <TextField label="Sababu *" value={reason} onChange={setReason} />
        </Modal>
      )}
    </>
  );
}
