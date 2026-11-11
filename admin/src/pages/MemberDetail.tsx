import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiBlobUrl } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, dateTime, fullName, LEDGER_LABEL, num, phone, tsh } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Loading, Modal, PageHead, SelectField, Stat, TextField } from '../components/ui';
import { fromMember, maritalLabel, MemberForm, type Member } from './Members';
import { PortalAccess } from '../components/FarmerPortalAccess';

interface Farm { id: string; name: string | null; village: string | null; acres: string; isActive: boolean }
interface Balance { totalDebit: string; totalCredit: string; balance: string; amountOwed: string }
interface Entry { id: string; type: string; debit: string; credit: string; description: string; createdAt: string; runningBalance: string }

export function MemberDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch<{ member: Member; farms: Farm[]; balance: Balance | null; group: { groupId: string; name: string; groupNo: string } | null; photo: { updatedAt: string } | null }>(`/members/${id}`);
  const photoUrl = useMemberPhoto(id, data?.photo?.updatedAt);
  const { may } = useAuth();
  const st = useFetch<{ entries: Entry[] }>(may('ledger.read') ? `/members/${id}/statement` : null);
  const [edit, setEdit] = useState(false);
  const [farmOpen, setFarmOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const { member: m, farms, balance } = data;
  const staff = may('members.write');
  const owes = Number(balance?.balance ?? 0) < 0;

  return (
    <>
      <PageHead title={<span className="member-title">{photoUrl ? <img className="member-avatar" src={photoUrl} alt="" /> : <span className="member-avatar">{m.firstName.charAt(0)}</span>}{fullName(m)}</span>} sub={<><span>Namba ya uanachama: <strong>{m.memberNo}</strong></span> · <Badge status={m.status} />{data.group && <> · Kikundi: <Link to={`/groups/${data.group.groupId}`}>{data.group.name}</Link></>}</>}>
        <Button variant="secondary" onClick={() => window.print()} className="no-print">Chapisha taarifa</Button>
        {staff && <Button variant="secondary" onClick={() => setEdit(true)} className="no-print">Hariri</Button>}
        {may('members.approve') && m.status !== 'PENDING' && <Button variant="secondary" onClick={() => setStatusOpen(true)} className="no-print">Badilisha hali</Button>}
        {may('issues.request') && m.status === 'ACTIVE' && <Link className="btn btn-gold no-print" to={`/input-issues/new?member=${m.id}`}>Toa pembejeo</Link>}
      </PageHead>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {balance && <>
          <Stat accent label={owes ? 'Deni analodaiwa' : 'Salio lake'} value={tsh(Math.abs(Number(balance.balance)))} hint={owes ? 'Litakatwa kwenye mauzo ya tumbaku' : Number(balance.balance) > 0 ? 'Chama kinamdai' : 'Hana deni'} />
          <Stat label="Jumla ya madeni (debit)" value={tsh(balance.totalDebit)} />
          <Stat label="Jumla ya mapato (credit)" value={tsh(balance.totalCredit)} />
        </>}
        <Stat label="Mashamba" value={num(farms.filter((f) => f.isActive).length)} hint={`Ekari ${num(farms.reduce((s, f) => s + Number(f.acres), 0))}`} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card card-pad">
          <h2>Taarifa za mwanachama</h2>
          <dl className="dl">
            <dt>Jinsia</dt><dd>{m.gender === 'FEMALE' ? 'Mwanamke' : 'Mwanaume'}</dd>
            {m.maritalStatus && <><dt>Hali ya ndoa</dt><dd>{maritalLabel(m.maritalStatus, m.gender)}</dd></>}
            <dt>Simu</dt><dd>{phone(m.phone)}{m.nameOverrideReason && <div className="muted" style={{ fontSize: 12.5 }}>
              {m.phoneOwnerName ? <>Namba imesajiliwa kwa jina la <b>{m.phoneOwnerName}</b></> : 'Namba haijasajiliwa kwenye mobile money'} · sababu: {m.nameOverrideReason} · {m.nameOverrideById ? <Badge status="APPROVED" label="Jina limeidhinishwa na Meneja" /> : <Badge status="PENDING" label="Jina linasubiri idhini ya Meneja" />}
            </div>}</dd>
            <dt>Kitambulisho</dt><dd>{m.nidaNumber ? `NIDA · ${m.nidaNumber}` : m.voterIdNumber ? `Kadi ya mpiga kura · ${m.voterIdNumber}` : '—'}</dd>
            <dt>Kijiji</dt><dd>{[m.village, m.hamlet].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Alijiunga</dt><dd>{date(m.joinedAt)}</dd>
            <dt>Hisa</dt><dd>{m.sharesCount}</dd>
            <dt>Kiingilio</dt><dd>{m.entryFee ? tsh(m.entryFee) : '—'} {m.entryFeePaid ? <Badge status="APPROVED" label="Kimelipwa" /> : m.entryFee ? <Badge status="DRAFT" label="Hakijalipwa" /> : null}{m.entryFeePaid && m.entryFeeReference ? <span className="muted"> · {m.entryFeeReference}</span> : null}</dd>
            <dt>Mzamini</dt><dd>{m.guarantorName ? `${m.guarantorName} · ${phone(m.guarantorPhone)}` : '—'}</dd>
            <dt>Malipo</dt><dd>{m.preferredPayment === 'BANK' ? (m.bankAccountNumber ? `${m.bankName ?? 'Benki'} · ${m.bankAccountNumber}` : 'Benki · —') : m.preferredPayment === 'CASH' ? 'Taslimu' : m.mobileMoneyNumber ? `${({ MPESA: 'M-Pesa', AIRTEL_MONEY: 'Airtel Money', MIXX_BY_YAS: 'Mixx by Yas', HALOPESA: 'HaloPesa', TPESA: 'T-Pesa' } as Record<string, string>)[m.mobileMoneyProvider ?? ''] ?? ''} · ${phone(m.mobileMoneyNumber)}` : '—'}</dd>
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

      {(may('members.portal') || may('members.read')) && <div style={{ marginBottom: 16 }}><PortalAccess memberId={m.id} memberName={fullName(m)} /></div>}
      {m.status === 'PENDING' && <div style={{ marginBottom: 16 }}><Alert kind="warn">Mkulima huyu anasubiri uthibitisho wa Meneja. Hawezi kupewa pembejeo hadi athibitishwe.{may('approvals.decide') ? ' Fungua ukurasa wa Idhini kumthibitisha.' : ''}</Alert></div>}
      {may('ledger.read') && <section className="card">
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
      </section>}

      <Modal open={edit} title="Hariri mwanachama" onClose={() => setEdit(false)}>
        <EditMember member={m} photoUrl={photoUrl} onDone={() => { setEdit(false); reload(); }} />
      </Modal>
      <FarmModal open={farmOpen} memberId={m.id} onClose={() => setFarmOpen(false)} onDone={() => { setFarmOpen(false); reload(); }} />
      <StatusModal open={statusOpen} member={m} onClose={() => setStatusOpen(false)} onDone={() => { setStatusOpen(false); reload(); }} />
    </>
  );
}

function EditMember({ member, photoUrl, onDone }: { member: Member; photoUrl: string | null; onDone: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <MemberForm initial={fromMember(member)} editing currentPhoto={photoUrl} submitLabel="Hifadhi mabadiliko" busy={busy} error={error}
      onSubmit={async (p, photo) => {
        const r = await run(async () => {
          const res = await api(`/members/${member.id}`, { method: 'PATCH', body: p });
          if (photo) await api(`/members/${member.id}/photo`, { method: 'PUT', body: { mimeType: photo.mimeType, data: photo.data } });
          return res;
        });
        if (r) onDone();
      }} />
  );
}

/** Picha ya mkulima (inahitaji token, kwa hiyo inapakuliwa kama blob). */
function useMemberPhoto(id: string | undefined, version: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    if (id && version) apiBlobUrl(`/members/${id}/photo`).then((u) => { made = u; if (alive) setUrl(u); else if (u) URL.revokeObjectURL(u); }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [id, version]);
  return url;
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
