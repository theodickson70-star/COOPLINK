import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, dateTime, fullName, LEDGER_LABEL, num, phone, tsh } from '../lib/format';
import { useAuth, ROLE_GROUPS } from '../lib/auth';
import { Alert, Badge, Button, Loading, Modal, PageHead, SelectField, Stat, TextField } from '../components/ui';
import { fromMember, MemberForm, type Member } from './Members';

interface Farm { id: string; name: string | null; village: string | null; acres: string; isActive: boolean }
interface Balance { totalDebit: string; totalCredit: string; balance: string; amountOwed: string }
interface Entry { id: string; type: string; debit: string; credit: string; description: string; createdAt: string; runningBalance: string }

export function MemberDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useFetch<{ member: Member; farms: Farm[]; balance: Balance }>(`/members/${id}`);
  const st = useFetch<{ entries: Entry[] }>(`/members/${id}/statement`);
  const [edit, setEdit] = useState(false);
  const [farmOpen, setFarmOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const { member: m, farms, balance } = data;
  const staff = can(...ROLE_GROUPS.STAFF);
  const owes = Number(balance.balance) < 0;

  return (
    <>
      <PageHead title={fullName(m)} sub={<><span>{m.memberNo}</span> · <Badge status={m.status} /></>}>
        <Button variant="secondary" onClick={() => window.print()} className="no-print">Chapisha taarifa</Button>
        {staff && <Button variant="secondary" onClick={() => setEdit(true)} className="no-print">Hariri</Button>}
        {can(...ROLE_GROUPS.MANAGERS) && <Button variant="secondary" onClick={() => setStatusOpen(true)} className="no-print">Badilisha hali</Button>}
        {staff && m.status === 'ACTIVE' && <Link className="btn btn-gold no-print" to={`/input-issues/new?member=${m.id}`}>Toa pembejeo</Link>}
      </PageHead>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat accent label={owes ? 'Deni analodaiwa' : 'Salio lake'} value={tsh(Math.abs(Number(balance.balance)))} hint={owes ? 'Litakatwa kwenye mauzo ya tumbaku' : Number(balance.balance) > 0 ? 'Chama kinamdai' : 'Hana deni'} />
        <Stat label="Jumla ya madeni (debit)" value={tsh(balance.totalDebit)} />
        <Stat label="Jumla ya mapato (credit)" value={tsh(balance.totalCredit)} />
        <Stat label="Mashamba" value={num(farms.filter((f) => f.isActive).length)} hint={`Ekari ${num(farms.reduce((s, f) => s + Number(f.acres), 0))}`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card card-pad">
          <h2>Taarifa za mwanachama</h2>
          <dl className="dl">
            <dt>Jinsia</dt><dd>{m.gender === 'FEMALE' ? 'Mwanamke' : 'Mwanaume'}</dd>
            <dt>Simu</dt><dd>{phone(m.phone)}</dd>
            <dt>NIDA</dt><dd>{m.nidaNumber ?? '—'}</dd>
            <dt>Kijiji</dt><dd>{[m.village, m.hamlet].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Alijiunga</dt><dd>{date(m.joinedAt)}</dd>
            <dt>Hisa</dt><dd>{m.sharesCount}</dd>
            <dt>Malipo</dt><dd>{m.preferredPayment === 'BANK' ? `${m.bankName ?? 'Benki'} · ${m.bankAccountNumber ?? '—'}` : m.preferredPayment === 'CASH' ? 'Taslimu' : `${m.mobileMoneyProvider ?? ''} · ${phone(m.mobileMoneyNumber)}`}</dd>
            <dt>Mrithi</dt><dd>{m.nextOfKinName ? `${m.nextOfKinName} (${m.nextOfKinRelation ?? '—'}) · ${phone(m.nextOfKinPhone)}` : '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <div className="card-pad" style={{ paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Mashamba</h2>
            {staff && <Button size="sm" variant="secondary" onClick={() => setFarmOpen(true)} className="no-print">+ Ongeza shamba</Button>}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Jina</th><th>Kijiji</th><th className="num">Ekari</th></tr></thead>
              <tbody>
                {farms.map((f) => <tr key={f.id}><td>{f.name ?? 'Shamba'}</td><td>{f.village ?? '—'}</td><td className="num">{num(f.acres)}</td></tr>)}
                {farms.length === 0 && <tr><td colSpan={3} className="muted">Hakuna shamba lililosajiliwa.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Taarifa ya fedha (statement)</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Tarehe</th><th>Aina</th><th>Maelezo</th><th className="num">Deni (Dr)</th><th className="num">Mapato (Cr)</th><th className="num">Salio</th></tr></thead>
            <tbody>
              {st.data?.entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.createdAt)}</td>
                  <td>{LEDGER_LABEL[e.type] ?? e.type}</td>
                  <td>{e.description}</td>
                  <td className="num">{Number(e.debit) ? tsh(e.debit) : ''}</td>
                  <td className="num">{Number(e.credit) ? tsh(e.credit) : ''}</td>
                  <td className={`num ${Number(e.runningBalance) < 0 ? 'money-neg' : ''}`}>{tsh(e.runningBalance)}</td>
                </tr>
              ))}
              {st.data && st.data.entries.length === 0 && <tr><td colSpan={6} className="muted">Bado hakuna muamala.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={edit} title="Hariri mwanachama" onClose={() => setEdit(false)}>
        <EditMember member={m} onDone={() => { setEdit(false); reload(); }} />
      </Modal>
      <FarmModal open={farmOpen} memberId={m.id} onClose={() => setFarmOpen(false)} onDone={() => { setFarmOpen(false); reload(); }} />
      <StatusModal open={statusOpen} member={m} onClose={() => setStatusOpen(false)} onDone={() => { setStatusOpen(false); reload(); }} />
    </>
  );
}

function EditMember({ member, onDone }: { member: Member; onDone: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <MemberForm initial={fromMember(member)} submitLabel="Hifadhi mabadiliko" busy={busy} error={error}
      onSubmit={async (p) => {
        const r = await run(() => api(`/members/${member.id}`, { method: 'PATCH', body: p }));
        if (r) onDone();
      }} />
  );
}

function FarmModal({ open, memberId, onClose, onDone }: { open: boolean; memberId: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [village, setVillage] = useState('');
  const [acres, setAcres] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api(`/members/${memberId}/farms`, { method: 'POST', body: { name: name || null, village: village || null, acres } }));
    if (r) { setName(''); setVillage(''); setAcres(''); onDone(); }
  };
  return (
    <Modal open={open} title="Ongeza shamba" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} onClick={save} disabled={!acres}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina la shamba" value={name} onChange={setName} />
      <TextField label="Kijiji" value={village} onChange={setVillage} />
      <TextField label="Ukubwa (ekari) *" type="number" step="0.01" min="0.01" value={acres} onChange={setAcres} />
    </Modal>
  );
}

function StatusModal({ open, member, onClose, onDone }: { open: boolean; member: Member; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(member.status);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api(`/members/${member.id}/status`, { method: 'PATCH', body: { status, reason } }));
    if (r) { setReason(''); onDone(); }
  };
  return (
    <Modal open={open} title="Badilisha hali ya uanachama" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} onClick={save} disabled={reason.trim().length < 3 || status === member.status}>Hifadhi</Button></>}>
      <Alert kind="warn">Mwanachama hafutwi kamwe. Historia yake ya fedha inabaki kwa ajili ya ukaguzi.</Alert>
      <Alert>{error}</Alert>
      <SelectField label="Hali mpya" value={status} onChange={setStatus}
        options={[{ value: 'ACTIVE', label: 'Hai' }, { value: 'SUSPENDED', label: 'Amesimamishwa' }, { value: 'EXITED', label: 'Ametoka' }, { value: 'DECEASED', label: 'Marehemu' }]} />
      <TextField label="Sababu *" value={reason} onChange={setReason} />
    </Modal>
  );
}
