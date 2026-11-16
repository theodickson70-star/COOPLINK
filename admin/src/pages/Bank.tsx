// =====================================================================
//  BENKI NA VOCHA (Mhasibu): akaunti za fedha, uhamisho kwa idhini, usuluhishi wa benki,
//  (hati rasmi za kuchapisha ziko pages/FinanceDoc.tsx)
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { ACCOUNT_KIND_LABEL, date, dateTime, tsh } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Section } from '../components/owner-ui';
import { today } from './acc-common';

interface Account { id: string; name: string; kind: string; bankName: string | null; accountNumber: string | null; openingBalance: string; balance: string; isActive: boolean }

export function Bank() {
  const { may } = useAuth();
  const accounts = useFetch<{ data: Account[] }>('/finance/accounts');
  const [transfer, setTransfer] = useState(false);
  const [recon, setRecon] = useState<string>('');
  const [ok, setOk] = useState<string | null>(null);
  const list = accounts.data?.data ?? [];
  useEffect(() => { if (!recon && list.length) setRecon((list.find((a) => a.kind === 'BANK') ?? list[0]).id); }, [list, recon]);
  return (
    <>
      <PageHead title="Benki na usuluhishi" sub="Uhamisho kati ya akaunti za chama (kwa idhini ya Meneja) na kulinganisha cashbook na taarifa ya benki kila mwezi.">
        {may('accounting.manage') && <Button onClick={() => setTransfer(true)}>Hamisha fedha</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <div className="grid grid-kpi">
        {list.map((a) => (
          <button key={a.id} type="button" className={`card kpi ${recon === a.id ? 'kpi-dark' : ''}`} onClick={() => setRecon(a.id)} style={{ textAlign: 'left', cursor: 'pointer' }}>
            <div className="kpi-top"><span className="label">{ACCOUNT_KIND_LABEL[a.kind]}{a.accountNumber ? ` · ${a.accountNumber}` : ''}</span></div>
            <span className="value" style={{ fontSize: 22 }}>{tsh(a.balance)}</span>
            <span className="hint">{a.name}{!a.isActive && ' (imefungwa)'}</span>
          </button>
        ))}
      </div>
      {list.length === 0 && <Empty>Ongeza akaunti za fedha kwenye <Link to="/finance">Fedha → Akaunti</Link>.</Empty>}
      {recon && <Reconciliation key={recon} accountId={recon} onDone={(m) => { setOk(m); accounts.reload(); }} />}
      {transfer && <TransferForm accounts={list.filter((a) => a.isActive)} onClose={() => setTransfer(false)} onDone={(m) => { setTransfer(false); setOk(m); accounts.reload(); }} />}
    </>
  );
}

function TransferForm({ accounts, onClose, onDone }: { accounts: Account[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ fromAccountId: '', toAccountId: '', amount: '', txnDate: today(), description: '', reference: '' });
  const { busy, error, run } = useAction();
  const from = accounts.find((a) => a.id === f.fromAccountId);
  const valid = f.fromAccountId && f.toAccountId && f.fromAccountId !== f.toAccountId && Number(f.amount) > 0 && f.description.trim().length >= 3;
  return (
    <Modal open title="Uhamisho kati ya akaunti" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!valid} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string } }>('/bank/transfers', { method: 'POST', body: { ...f, reference: f.reference || null } }));
        if (r) onDone(`Uhamisho umetumwa kwa Meneja (${r.approval.requestNo}). Baada ya idhini, ukamilishe kwenye Miamala.`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Mf. kuweka benki fedha taslimu za ada, au kutoa benki fedha za malipo ya taslimu. Pande zote mbili zinaandikwa pamoja.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <SelectField label="Kutoka akaunti *" value={f.fromAccountId} onChange={(v) => setF({ ...f, fromAccountId: v })} placeholder="Chagua…" options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` }))} />
        <SelectField label="Kwenda akaunti *" value={f.toAccountId} onChange={(v) => setF({ ...f, toAccountId: v })} placeholder="Chagua…" options={accounts.filter((a) => a.id !== f.fromAccountId).map((a) => ({ value: a.id, label: a.name }))} />
        <TextField label="Kiasi (TSh) *" type="number" min="1" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} help={from ? `Salio: ${tsh(from.balance)}` : undefined} />
        <TextField label="Tarehe" type="date" value={f.txnDate} onChange={(v) => setF({ ...f, txnDate: v })} />
        <TextField label="Namba ya slip / kumbukumbu" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} />
      </div>
      <TextField label="Maelezo *" value={f.description} onChange={(v) => setF({ ...f, description: v })} placeholder="mf. Kuweka benki makusanyo ya ada za wiki" />
    </Modal>
  );
}

interface ReconData {
  account: Account; statementDate: string; bookBalance: string; clearedBefore: string;
  uncleared: { id: string; txnNo: string; txnDate: string; description: string; reference: string | null; direction: 'IN' | 'OUT'; amount: string }[];
  history: { id: string; statementDate: string; statementBalance: string; bookBalance: string; unclearedIn: string; unclearedOut: string; createdBy: string | null; createdAt: string; items: number; notes: string | null }[];
}

function Reconciliation({ accountId, onDone }: { accountId: string; onDone: (m: string) => void }) {
  const { may } = useAuth();
  const [statementDate, setStatementDate] = useState(today());
  const { data, reload } = useFetch<ReconData>(`/bank/reconciliation/${accountId}`, { statementDate });
  const [stmt, setStmt] = useState('');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { busy, error, run } = useAction();
  useEffect(() => setPicked(new Set()), [data?.statementDate, accountId]);
  const cleared = useMemo(() => {
    if (!data) return 0;
    return Number(data.clearedBefore) + data.uncleared.filter((u) => picked.has(u.id)).reduce((s, u) => s + (u.direction === 'IN' ? Number(u.amount) : -Number(u.amount)), 0);
  }, [data, picked]);
  if (!data) return <Loading />;
  const diff = stmt === '' ? null : Number(stmt) - cleared;
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  const manage = may('accounting.manage');
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <Section title={`Usuluhishi: ${data.account.name}`} actions={<span className="muted">Salio la cashbook hadi {date(data.statementDate)}: <strong>{tsh(data.bookBalance)}</strong></span>}>
        <div className="form-grid">
          <TextField label="Tarehe ya taarifa ya benki" type="date" max={today()} value={statementDate} onChange={setStatementDate} />
          <TextField label="Salio kwenye taarifa ya benki (TSh)" type="number" value={stmt} onChange={setStmt} />
          <TextField label="Maelezo" value={notes} onChange={setNotes} placeholder="mf. Taarifa ya NMB ya Oktoba" />
        </div>
        <p className="muted" style={{ marginBottom: 8 }}>Weka alama kwenye miamala inayoonekana kwenye taarifa ya benki. Isiyowekwa alama ni "njiani" (mf. cheki ambazo hazijatolewa).</p>
        {data.uncleared.length === 0 ? <Empty>Miamala yote imeshasuluhishwa hadi tarehe hii.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Chagua yote" checked={picked.size === data.uncleared.length} onChange={(e) => setPicked(e.target.checked ? new Set(data.uncleared.map((u) => u.id)) : new Set())} /></th><th>Tarehe</th><th>Namba</th><th>Maelezo</th><th className="num">Ndani</th><th className="num">Nje</th></tr></thead>
            <tbody>{data.uncleared.map((u) => (
              <tr key={u.id} onClick={() => toggle(u.id)} style={{ cursor: 'pointer' }} className={picked.has(u.id) ? 'row-picked' : ''}>
                <td><input type="checkbox" aria-label={`Imeonekana benki ${u.txnNo}`} checked={picked.has(u.id)} onChange={() => toggle(u.id)} onClick={(e) => e.stopPropagation()} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{date(u.txnDate)}</td><td>{u.txnNo}</td><td>{u.description}{u.reference && <span className="muted"> · {u.reference}</span>}</td>
                <td className="num money-pos">{u.direction === 'IN' ? tsh(u.amount) : ''}</td><td className="num money-neg">{u.direction === 'OUT' ? tsh(u.amount) : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="recon-sum">
          <div><span>Salio lililosuluhishwa awali</span><strong>{tsh(data.clearedBefore)}</strong></div>
          <div><span>+ Miamala iliyowekwa alama</span><strong>{tsh(cleared - Number(data.clearedBefore))}</strong></div>
          <div><span>= Salio linalotarajiwa benki</span><strong>{tsh(cleared)}</strong></div>
          <div className={diff === null ? '' : Math.abs(diff) < 0.005 ? 'ok' : 'bad'}><span>Tofauti na taarifa ya benki</span><strong>{diff === null ? '—' : tsh(diff)}</strong></div>
        </div>
        {diff !== null && Math.abs(diff) >= 0.005 && <Alert kind="warn">Tofauti haijawa sifuri. Kama taarifa ya benki ina gharama za benki au riba ambazo hazijarekodiwa, zirekodi kwanza kwenye Miamala (Gharama za benki / Riba ya benki).</Alert>}
        <Alert>{error}</Alert>
        {manage && <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <Button busy={busy} disabled={diff === null || Math.abs(diff) >= 0.005} onClick={async () => {
            const r = await run(() => api('/bank/reconciliation/' + accountId, { method: 'POST', body: { statementDate, statementBalance: stmt, clearedTxnIds: [...picked], notes: notes || null } }));
            if (r) { onDone(`Usuluhishi wa ${data.account.name} hadi ${date(statementDate)} umekamilika`); setStmt(''); setNotes(''); reload(); }
          }}>Kamilisha usuluhishi</Button>
        </div>}
      </Section>
      <Section pad={false} title="Historia ya usuluhishi">
        {data.history.length === 0 ? <Empty>Bado hakuna usuluhishi.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Hadi tarehe</th><th className="num">Salio la benki</th><th className="num">Cashbook</th><th className="num">Njiani (ndani / nje)</th><th>Aliyefanya</th></tr></thead>
            <tbody>{data.history.map((h) => (
              <tr key={h.id}><td>{date(h.statementDate)}<div className="muted" style={{ fontSize: 12 }}>{h.items} miamala{h.notes ? ` · ${h.notes}` : ''}</div></td>
                <td className="num">{tsh(h.statementBalance)}</td><td className="num">{tsh(h.bookBalance)}</td>
                <td className="num">{tsh(h.unclearedIn)} / {tsh(h.unclearedOut)}</td><td>{h.createdBy}<div className="muted" style={{ fontSize: 12 }}>{dateTime(h.createdAt)}</div></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}

// Hati rasmi (Stakabadhi / Hati ya Malipo) zimehamia pages/FinanceDoc.tsx (v0.42)
