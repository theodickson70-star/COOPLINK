import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { APPROVAL_TYPE_LABEL, dateTime, ROLE_LABEL, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, Select, TextField } from '../components/ui';
import { Tabs } from '../components/owner-ui';

export interface Approval {
  id: string; requestNo: string; type: string; typeLabel: string; status: string; title: string; amount: string | null; reason: string | null;
  entityType: string | null; entityId: string | null; payload: Record<string, unknown> | null;
  requestedById: string; requestedRole: string; requestedBy: string | null; createdAt: string;
  decidedBy: string | null; decidedRole: string | null; decidedAt: string | null; decisionNote: string | null;
}

const STATUS: Record<string, string> = { PENDING: 'Inasubiri', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };

/** Kiungo cha rekodi inayohusika na ombi. */
export function entityLink(a: Pick<Approval, 'entityType' | 'entityId'>) {
  if (!a.entityId) return null;
  if (a.entityType === 'Member') return `/members/${a.entityId}`;
  if (a.entityType === 'InputIssue') return `/input-issues/${a.entityId}`;
  if (a.entityType === 'PurchaseRequest') return `/purchases/${a.entityId}`;
  if (a.entityType === 'FinanceTransaction') return `/finance?txn=${a.entityId}`;
  return null;
}

export function Approvals() {
  const { may } = useAuth();
  const decider = may('approvals.decide');
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch<Paged<Approval>>('/approvals', { status: tab === 'PENDING' ? 'PENDING' : undefined, type: type || undefined, page, pageSize: 25 });
  const [sel, setSel] = useState<Approval | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <>
      <PageHead title={decider ? 'Idhini' : 'Maombi yangu'} sub={decider
        ? 'Maombi yanayosubiri uamuzi wako. Kila uamuzi unahifadhiwa na jina lako, muda na maelezo — hauwezi kubadilishwa baadaye.'
        : 'Maombi uliyotuma kwa Meneja na hali yake'} />
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[['PENDING', 'Yanayosubiri'], ['ALL', 'Historia yote']]} />
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Aina ya ombi" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">Aina zote</option>
            {Object.entries(APPROVAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>{tab === 'PENDING' ? 'Hakuna ombi linalosubiri. 👍' : 'Hakuna maombi bado.'}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ombi</th><th>Maelezo</th><th className="num">Kiasi</th><th>Aliyeomba</th><th>Hali</th><th /></tr></thead>
            <tbody>{data?.data.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{a.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{a.typeLabel}</div></td>
                <td style={{ minWidth: 240 }}>{a.title}{a.reason && <div className="muted" style={{ fontSize: 13 }}>Sababu: {a.reason}</div>}</td>
                <td className="num">{a.amount ? tsh(a.amount) : '—'}</td>
                <td>{a.requestedBy ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[a.requestedRole] ?? a.requestedRole} · {dateTime(a.createdAt)}</div></td>
                <td><Badge status={a.status === 'PENDING' ? 'DRAFT' : a.status} label={STATUS[a.status]} />
                  {a.decidedAt && <div className="muted" style={{ fontSize: 12 }}>{a.decidedBy} · {dateTime(a.decidedAt)}</div>}</td>
                <td className="num"><Button size="sm" variant={a.status === 'PENDING' && decider ? 'primary' : 'secondary'} onClick={() => setSel(a)}>{a.status === 'PENDING' && decider ? 'Amua' : 'Fungua'}</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
      {sel && <DecideModal approval={sel} onClose={() => setSel(null)} onDone={(msg) => { setSel(null); setOk(msg); reload(); }} />}
    </>
  );
}

export function DecideModal({ approval: a, onClose, onDone }: { approval: Approval; onClose: () => void; onDone: (msg: string) => void }) {
  const { user, may } = useAuth();
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const mine = a.requestedById === user?.id;
  const canDecide = a.status === 'PENDING' && may('approvals.decide') && !mine;
  const canCancel = a.status === 'PENDING' && mine;
  const link = entityLink(a);
  const act = async (decision: 'APPROVED' | 'REJECTED' | 'CANCEL') => {
    const r = await run(() => decision === 'CANCEL'
      ? api(`/approvals/${a.id}/cancel`, { method: 'POST', body: { note } })
      : api(`/approvals/${a.id}/decide`, { method: 'POST', body: { decision, note } }));
    if (r) onDone(decision === 'APPROVED' ? `${a.requestNo} imeidhinishwa` : decision === 'REJECTED' ? `${a.requestNo} imekataliwa` : `${a.requestNo} imeondolewa`);
  };
  const p = a.payload as { balanceAtRequest?: string; kind?: string } | null;
  return (
    <Modal open title={`${a.requestNo} · ${a.typeLabel ?? APPROVAL_TYPE_LABEL[a.type]}`} onClose={onClose}
      footer={canDecide ? <>
        <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('REJECTED')}>Kataa</Button>
        <Button busy={busy} disabled={note.trim().length < 3} onClick={() => act('APPROVED')}>Idhinisha</Button>
      </> : canCancel ? <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('CANCEL')}>Ondoa ombi</Button> : <Button variant="secondary" onClick={onClose}>Funga</Button>}>
      <dl className="dl">
        <dt>Ombi</dt><dd>{a.title}</dd>
        {a.amount && <><dt>Kiasi</dt><dd><strong>{tsh(a.amount)}</strong></dd></>}
        {a.reason && <><dt>Sababu</dt><dd>{a.reason}</dd></>}
        {p?.balanceAtRequest && <><dt>Salio wakati wa ombi</dt><dd>{p.balanceAtRequest}</dd></>}
        <dt>Aliyeomba</dt><dd>{a.requestedBy} ({ROLE_LABEL[a.requestedRole] ?? a.requestedRole}) · {dateTime(a.createdAt)}</dd>
        {a.decidedAt && <><dt>Uamuzi</dt><dd>{STATUS[a.status]} na {a.decidedBy} · {dateTime(a.decidedAt)}<div className="muted">"{a.decisionNote}"</div></dd></>}
      </dl>
      {link && <p style={{ margin: 0 }}><Link to={link} onClick={onClose}>Fungua rekodi inayohusika →</Link></p>}
      {mine && a.status === 'PENDING' && may('approvals.decide') && <Alert kind="warn">Huwezi kuidhinisha ombi ulilolianzisha mwenyewe.</Alert>}
      <Alert>{error}</Alert>
      {(canDecide || canCancel) && <TextField label={canDecide ? 'Maelezo ya uamuzi *' : 'Sababu ya kuondoa *'} placeholder={canDecide ? 'mf. Nimekagua risiti, gharama ni sahihi' : ''} value={note} onChange={setNote} />}
    </Modal>
  );
}
