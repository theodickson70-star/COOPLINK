// =====================================================================
//  VIKUNDI VYA WAKULIMA (dhamana ya pamoja)
//   Stokipa anaunda kikundi -> Meneja anaidhinisha. Kila mkulima ana deni lake; kikundi kinadhamini:
//   mwanachama akishindwa kumaliza deni kwenye mauzo, wenzake wanakatwa kwa uwiano wa malipo yao.
// =====================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, MemberPicker, Modal, PageHead, SelectField, TextField, type MemberLite } from '../components/ui';
import { Kpi, Section } from '../components/owner-ui';

interface Group { id: string; groupNo: string; name: string; village: string | null; status: string; members: number; owing: string; inputs: string; leader: string | null; createdAt: string; leaderMemberId: string | null; notes: string | null }
const G_STATUS: Record<string, string> = { PENDING: 'Inasubiri idhini', ACTIVE: 'Hai', REJECTED: 'Imekataliwa', INACTIVE: 'Hakitumiki' };

export function Groups() {
  const { may } = useAuth();
  const { data, reload } = useFetch<{ data: Group[] }>('/groups');
  const [add, setAdd] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const nav = useNavigate();
  const active = data?.data.filter((g) => g.status === 'ACTIVE') ?? [];
  return (
    <>
      <PageHead title="Vikundi vya wakulima" sub="Wanachama wanaunda kikundi kidogo; kila mmoja anakopa pembejeo zake, na kikundi kizima kinadhamini madeni ya wanachama wake.">
        {may('members.write') && <Button onClick={() => setAdd(true)}>+ Kikundi kipya</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      {data && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Vikundi hai" value={active.length} hint={`Wanachama ${active.reduce((s, g) => s + g.members, 0)}`} />
          <Kpi label="Pembejeo zilizokopeshwa kwa vikundi" value={tsh(active.reduce((s, g) => s + Number(g.inputs), 0))} />
          <Kpi tone={active.some((g) => Number(g.owing) > 0) ? 'gold' : undefined} label="Madeni ya vikundi" value={tsh(active.reduce((s, g) => s + Number(g.owing), 0))} />
        </div>
      )}
      <section className="card" style={{ marginTop: 16 }}>
        {!data ? <Loading /> : data.data.length === 0 ? <Empty>Bado hakuna kikundi. Unda kikundi kwa kuchagua wanachama waliothibitishwa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Kikundi</th><th>Kiongozi</th><th className="num">Wanachama</th><th className="num">Pembejeo</th><th className="num">Deni la kikundi</th><th>Hali</th></tr></thead>
            <tbody>{data.data.map((g) => (
              <tr key={g.id} onClick={() => nav(`/groups/${g.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong>{g.name}</strong><div className="muted" style={{ fontSize: 12 }}>{g.groupNo}{g.village ? ` · ${g.village}` : ''}</div></td>
                <td>{g.leader ?? '—'}</td><td className="num">{g.members}</td><td className="num">{tsh(g.inputs)}</td>
                <td className="num"><strong className={Number(g.owing) > 0 ? 'money-neg' : ''}>{tsh(g.owing)}</strong></td>
                <td><Badge status={g.status === 'PENDING' ? 'PENDING_APPROVAL' : g.status} label={G_STATUS[g.status]} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {add && <GroupForm onClose={() => setAdd(false)} onDone={(m) => { setAdd(false); setOk(m); reload(); }} />}
    </>
  );
}

function GroupForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState('');
  const [village, setVillage] = useState('');
  const [notes, setNotes] = useState('');
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [leader, setLeader] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Kikundi kipya cha wakulima" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={name.trim().length < 2 || members.length < 2} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string }; group: { groupNo: string } }>('/groups', { method: 'POST', body: { name, village: village || null, notes: notes || null, memberIds: members.map((m) => m.id), leaderMemberId: leader || null } }));
        if (r) onDone(`Kikundi ${r.group.groupNo} kimetumwa kwa Meneja (${r.approval.requestNo}).`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Wanachama wote wanadhaminiana: mmoja akishindwa kumaliza deni lake la pembejeo kwenye mauzo, salio linakatwa kwa wenzake. Hakikisha wote wamekubali.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina la kikundi *" value={name} onChange={setName} placeholder="mf. Tumaini" />
        <TextField label="Kijiji / kitongoji" value={village} onChange={setVillage} />
      </div>
      <MemberPicker label={`Ongeza mwanachama (${members.length})`} value={null} onChange={(m) => { if (m && !members.some((x) => x.id === m.id)) setMembers([...members, m]); }} />
      {members.length > 0 && (
        <div className="table-wrap"><table className="table"><tbody>{members.map((m) => (
          <tr key={m.id}><td>{m.firstName} {m.lastName} <span className="muted">· {m.memberNo}</span></td>
            <td className="num"><Button size="sm" variant="ghost" onClick={() => { setMembers(members.filter((x) => x.id !== m.id)); if (leader === m.id) setLeader(''); }}>Ondoa</Button></td></tr>
        ))}</tbody></table></div>
      )}
      <SelectField label="Kiongozi wa kikundi" value={leader} onChange={setLeader} placeholder="Chagua…" options={members.map((m) => ({ value: m.id, label: `${m.firstName} ${m.lastName}` }))} />
      <TextField label="Maelezo" value={notes} onChange={setNotes} />
    </Modal>
  );
}

interface GMember { memberId: string; memberNo: string; name: string; village: string | null; status: string; joinedAt: string; leftAt: string | null; removeReason: string | null; inputs: string; guaranteedFor: string; coveredByGroup: string; balance: string }

export function GroupDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<{ group: Group; members: GMember[]; pending: { id: string; requestNo: string; title: string; createdAt: string }[] }>(`/groups/${id}`);
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<GMember | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!data) return <Loading />;
  const g = data.group;
  const current = data.members.filter((m) => !m.leftAt);
  const canEdit = may('members.write') && g.status === 'ACTIVE';
  const memberLink = (mid: string) => (may('members.read') ? `/members/${mid}` : `/farmer-debts/${mid}`);
  return (
    <>
      <PageHead title={<>{g.name} <Badge status={g.status === 'PENDING' ? 'PENDING_APPROVAL' : g.status} label={G_STATUS[g.status]} /></>} sub={<>{g.groupNo}{g.village ? ` · ${g.village}` : ''}{g.leader ? ` · Kiongozi: ${g.leader}` : ''}</>}>
        <Link className="btn btn-secondary" to={may('members.read') ? '/groups' : '/farmer-debts?tab=groups'}>← Vikundi</Link>
        {canEdit && <Button onClick={() => setAdd(true)}>+ Ongeza mwanachama</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      {data.pending.map((p) => <Alert key={p.id} kind="warn">{p.requestNo}: {p.title} — inasubiri idhini ya Meneja</Alert>)}
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Wanachama" value={current.length} />
        <Kpi label="Pembejeo walizokopa" value={tsh(g.inputs)} />
        <Kpi tone={Number(g.owing) > 0 ? 'bad' : undefined} label="Deni la kikundi (jumla)" value={tsh(g.owing)} hint="Kikundi kizima kinawajibika" />
      </div>
      <Section pad={false} title="Wanachama na madeni yao">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Mwanachama</th><th className="num">Pembejeo</th><th className="num">Amewalipia wenzake</th><th className="num">Amelipiwa na kikundi</th><th className="num">Salio</th><th /></tr></thead>
          <tbody>{data.members.map((m) => (
            <tr key={m.memberId} style={{ opacity: m.leftAt ? 0.5 : 1 }}>
              <td><Link to={memberLink(m.memberId)}>{m.name}</Link><div className="muted" style={{ fontSize: 12 }}>{m.memberNo}{m.memberId === g.leaderMemberId ? ' · Kiongozi' : ''}{m.leftAt ? ` · alitoka ${date(m.leftAt)}${m.removeReason ? ` (${m.removeReason})` : ''}` : ''}</div></td>
              <td className="num">{Number(m.inputs) ? tsh(m.inputs) : '—'}</td>
              <td className="num">{Number(m.guaranteedFor) ? tsh(m.guaranteedFor) : '—'}</td>
              <td className="num">{Number(m.coveredByGroup) ? tsh(m.coveredByGroup) : '—'}</td>
              <td className="num"><strong className={Number(m.balance) < 0 ? 'money-neg' : ''}>{Number(m.balance) < 0 ? `Deni ${tsh(-Number(m.balance))}` : Number(m.balance) > 0 ? `Anadai ${tsh(m.balance)}` : '0'}</strong></td>
              <td className="num">{canEdit && !m.leftAt && <Button size="sm" variant="ghost" onClick={() => setRemove(m)}>Toa</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Section>
      {add && <AddMember groupId={g.id} onClose={() => setAdd(false)} onDone={(m) => { setAdd(false); setOk(m); reload(); }} />}
      {remove && <RemoveMember groupId={g.id} m={remove} onClose={() => setRemove(null)} onDone={(msg) => { setRemove(null); setOk(msg); reload(); }} />}
    </>
  );
}

function AddMember({ groupId, onClose, onDone }: { groupId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [m, setM] = useState<MemberLite | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Ongeza mwanachama kwenye kikundi" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!m} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string } }>(`/groups/${groupId}/members`, { method: 'POST', body: { memberId: m!.id } }));
        if (r) onDone(`Ombi ${r.approval.requestNo} limetumwa kwa Meneja`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert>{error}</Alert>
      <MemberPicker value={m} onChange={setM} />
    </Modal>
  );
}

function RemoveMember({ groupId, m, onClose, onDone }: { groupId: string; m: GMember; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Kumtoa ${m.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string } }>(`/groups/${groupId}/members/${m.memberId}/remove`, { method: 'POST', body: { reason } }));
        if (r) onDone(`Ombi ${r.approval.requestNo} limetumwa kwa Meneja`);
      }}>Tuma kwa Meneja</Button></>}>
      {Number(m.balance) < 0 && <Alert kind="warn">Mwanachama huyu ana deni la {tsh(-Number(m.balance))}. Hawezi kutoka kikundi mpaka amalize deni.</Alert>}
      <Alert>{error}</Alert>
      <TextField label="Sababu *" value={reason} onChange={setReason} />
    </Modal>
  );
}
