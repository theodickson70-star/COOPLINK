import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, num } from '../lib/format';
import { useAuth, ROLE_GROUPS } from '../lib/auth';
import { Alert, Badge, Button, Empty, Loading, MemberPicker, Modal, PageHead, Pager, Select, Stat, TextField, type MemberLite } from '../components/ui';

interface Estimate {
  id: string; acresPlanted: string; estimatedKg: string; status: string; notes: string | null; createdAt: string;
  member: { id: string; memberNo: string; firstName: string; lastName: string };
}
interface Summary { season: { name: string }; byStatus: { status: string; members: number; acres: string; kg: string }[] }

export function Estimates() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useFetch<Paged<Estimate>>('/estimates', { status, page, pageSize: 25 });
  const sum = useFetch<Summary>('/estimates/summary');
  const act = useAction();

  const by = (s: string) => sum.data?.byStatus.find((b) => b.status === s);
  const decide = async (id: string, action: 'approve' | 'reject') => {
    const r = await act.run(() => api(`/estimates/${id}/${action}`, { method: 'POST' }));
    if (r) { list.reload(); sum.reload(); }
  };

  return (
    <>
      <PageHead title="Makisio ya uzalishaji" sub={sum.data ? `Msimu ${sum.data.season.name}` : undefined}>
        {can(...ROLE_GROUPS.STAFF) && <Button onClick={() => setOpen(true)}>+ Ongeza makisio</Button>}
      </PageHead>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat accent label="Kilo zilizoidhinishwa" value={`${num(by('APPROVED')?.kg)} kg`} hint={`Wakulima ${num(by('APPROVED')?.members)}`} />
        <Stat label="Zinasubiri idhini" value={num(by('DRAFT')?.members)} hint={`${num(by('DRAFT')?.kg)} kg`} />
        <Stat label="Zimekataliwa" value={num(by('REJECTED')?.members)} />
      </div>
      <Alert>{act.error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Hali zote</option><option value="DRAFT">Rasimu</option><option value="APPROVED">Imeidhinishwa</option><option value="REJECTED">Imekataliwa</option>
          </Select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>Hakuna makisio bado.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mwanachama</th><th className="num">Ekari</th><th className="num">Kilo</th><th>Tarehe</th><th>Hali</th><th /></tr></thead>
              <tbody>
                {list.data?.data.map((e) => (
                  <tr key={e.id}>
                    <td><Link className="row-link" to={`/members/${e.member.id}`}>{e.member.firstName} {e.member.lastName}</Link><div className="muted" style={{ fontSize: 13 }}>{e.member.memberNo}</div></td>
                    <td className="num">{num(e.acresPlanted)}</td>
                    <td className="num">{num(e.estimatedKg)}</td>
                    <td>{date(e.createdAt)}</td>
                    <td><Badge status={e.status} /></td>
                    <td className="num">
                      {e.status === 'DRAFT' && can(...ROLE_GROUPS.MANAGERS) && (
                        <span className="actions" style={{ justifyContent: 'flex-end' }}>
                          <Button size="sm" busy={act.busy} onClick={() => decide(e.id, 'approve')}>Idhinisha</Button>
                          <Button size="sm" variant="secondary" busy={act.busy} onClick={() => decide(e.id, 'reject')}>Kataa</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={list.data?.meta} onPage={setPage} />
      </section>
      <NewEstimate open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); list.reload(); sum.reload(); }} />
    </>
  );
}

function NewEstimate({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [member, setMember] = useState<MemberLite | null>(null);
  const [acres, setAcres] = useState('');
  const [kg, setKg] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/estimates', { method: 'POST', body: { memberId: member!.id, acresPlanted: acres, estimatedKg: kg, notes: notes || null } }));
    if (r) { setMember(null); setAcres(''); setKg(''); setNotes(''); onDone(); }
  };
  return (
    <Modal open={open} title="Makisio mapya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} onClick={save} disabled={!member || !acres || !kg}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <MemberPicker value={member} onChange={setMember} />
      <TextField label="Ekari zilizopandwa *" type="number" step="0.01" min="0.01" value={acres} onChange={setAcres} />
      <TextField label="Kilo zinazotarajiwa *" type="number" step="1" min="1" value={kg} onChange={setKg} />
      <TextField label="Maelezo" value={notes} onChange={setNotes} />
    </Modal>
  );
}
