import { useState } from 'react';
import { ReceiveInputsModal } from '../components/ReceiveInputs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, num, phone, tsh, UNIT_LABEL } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';
import { Section, Tabs } from '../components/owner-ui';
import { usd, useFx } from '../lib/fx';

interface Purchase { id: string; prNo: string; status: string; supplierId: string | null; supplierName: string | null; totalAmount: string; paid: string; currency?: 'TZS' | 'USD'; totalUsd?: string | null; paidUsd?: string; fxRate?: string | null; neededBy: string | null; notes: string | null; requestedBy: string | null; createdAt: string }
interface Supplier { id: string; name: string; phone: string | null; email: string | null; tin: string | null; address: string | null; isActive: boolean }
const PR_STATUS: Record<string, string> = { PENDING_APPROVAL: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — subiri mzigo', REJECTED: 'Imekataliwa', PARTIALLY_RECEIVED: 'Imepokelewa sehemu', RECEIVED: 'Imepokelewa yote', CANCELLED: 'Imeondolewa' };
const tone = (s: string) => (s === 'RECEIVED' ? 'APPROVED' : ['APPROVED', 'PARTIALLY_RECEIVED', 'PENDING_APPROVAL'].includes(s) ? 'DRAFT' : s);

export function Purchases() {
  const { may } = useAuth();
  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useFetch<Paged<Purchase>>(tab === 'purchases' ? '/store/purchases' : null, { status: status || undefined, page, pageSize: 25 });
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <PageHead title="Manunuzi na Wazabuni" sub="Storekeeper anaomba → Meneja anaidhinisha → Mhasibu analipa → Storekeeper anapokea mzigo">
        {tab === 'purchases' && may('purchases.request') && <Button onClick={() => setOpen(true)}>+ Ombi la manunuzi</Button>}
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[['purchases', 'Maombi ya manunuzi'], ['suppliers', 'Wazabuni']]} />
      {tab === 'purchases' ? (
        <section className="card">
          <div className="toolbar">
            <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Hali zote</option>
              {Object.entries(PR_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </div>
          <Alert>{list.error}</Alert>
          {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>Hakuna maombi ya manunuzi.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Namba</th><th>Mzabuni</th><th className="num">Thamani</th><th className="num">Limelipwa</th><th>Hali</th><th>Aliyeomba</th></tr></thead>
              <tbody>{list.data?.data.map((p) => (
                <tr key={p.id}>
                  <td><Link className="row-link" to={`/purchases/${p.id}`}>{p.prNo}</Link><div className="muted" style={{ fontSize: 12 }}>{date(p.createdAt)}</div></td>
                  <td>{p.supplierName ?? '—'}</td>
                  <td className="num">{p.currency === 'USD' && p.totalUsd ? <>{usd(p.totalUsd)}<div className="muted" style={{ fontSize: 12 }}>{tsh(p.totalAmount)}</div></> : tsh(p.totalAmount)}</td>
                  <td className="num">{p.currency === 'USD' ? usd(p.paidUsd) : tsh(p.paid)}</td>
                  <td><Badge status={tone(p.status)} label={PR_STATUS[p.status]} /></td>
                  <td>{p.requestedBy}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <Pager meta={list.data?.meta} onPage={setPage} />
        </section>
      ) : <Suppliers />}
      {open && <NewPurchase onClose={() => setOpen(false)} onDone={(id) => nav(`/purchases/${id}`)} />}
    </>
  );
}

function NewPurchase({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const items = useFetch<{ data: { id: string; name: string; unit: string; isActive: boolean }[] }>('/inputs/items', { active: 'true' });
  const suppliers = useFetch<{ data: Supplier[] }>('/store/suppliers');
  const [supplierId, setSupplierId] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ inputItemId: '', quantity: '', unitCost: '' }]);
  const { busy, error, run } = useAction();
  const fx = useFx();
  const U = fx.usdMode; // chama cha USD: gharama kwa dola
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const valid = notes.trim().length >= 3 && lines.every((l) => l.inputItemId && Number(l.quantity) > 0 && l.unitCost !== '');
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal open title="Ombi la manunuzi" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!valid} onClick={async () => {
        const body = { supplierId: supplierId || null, neededBy: neededBy || null, notes, lines: lines.map((l) => (U ? { inputItemId: l.inputItemId, quantity: l.quantity, unitCostUsd: l.unitCost } : l)) };
        const r = await run(() => api<{ purchase: { id: string } }>('/store/purchases', { method: 'POST', body }));
        if (r) onDone(r.purchase.id);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <SelectField label="Mzabuni" value={supplierId} onChange={setSupplierId} placeholder="Bado haijulikani" options={suppliers.data?.data.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name })) ?? []} />
        <TextField label="Inahitajika kabla ya" type="date" value={neededBy} onChange={setNeededBy} />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
          <SelectField label={`Bidhaa ${i + 1}`} value={l.inputItemId} onChange={(v) => setLine(i, { inputItemId: v })} placeholder="Chagua…" options={items.data?.data.map((it) => ({ value: it.id, label: `${it.name} (${UNIT_LABEL[it.unit]})` })) ?? []} />
          <TextField label={`Kiasi ${i + 1}`} type="number" min="0" value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} />
          <TextField label={`Bei kwa kimoja ${i + 1} (${U ? 'USD' : 'TSh'})`} type="number" min="0" step={U ? '0.01' : '1'} value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} />
        </div>
      ))}
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { inputItemId: '', quantity: '', unitCost: '' }])}>+ Ongeza bidhaa</Button>
        <strong>Jumla: {U ? usd(total) : tsh(total)}{U && fx.rate && total > 0 ? <span className="muted" style={{ fontWeight: 400 }}> ≈ {tsh(total * fx.rate)}</span> : null}</strong>
      </div>
      <TextField label="Sababu ya manunuzi *" value={notes} onChange={setNotes} />
    </Modal>
  );
}

export function PurchaseDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, loading, error, reload } = useFetch<{
    purchase: Purchase;
    lines: { id: string; quantity: string; unitCost: string; amount: string; unitCostUsd?: string | null; amountUsd?: string | null; receivedQty: string; inputItem: { name: string; unit: string } }[];
    receipts: { id: string; quantity: string; reference: string | null; batchNo: string | null; expiryDate: string | null; createdAt: string; inputItemId: string }[];
    payments: { id: string; txnNo: string; amount: string; amountUsd?: string | null; status: string; kind: string; txnDate: string }[];
    approval: { requestNo: string; status: string; decisionNote: string | null; decidedAt: string | null } | null;
  }>(`/store/purchases/${id}`);
  const [receive, setReceive] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const p = data.purchase;
  const canReceive = may('purchases.receive') && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status);
  return (
    <>
      <PageHead title={`Manunuzi ${p.prNo}`} sub={<><Badge status={tone(p.status)} label={PR_STATUS[p.status]} /> · {p.supplierName ?? 'Mzabuni hajachaguliwa'} · aliomba {p.requestedBy}</>}>
        <Link className="btn btn-secondary" to="/purchases">← Orodha</Link>
        {canReceive && <Button onClick={() => setReceive(true)}>Ingiza mzigo stoo</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <div className="stack">
        <div className="grid grid-3">
          <section className="card kpi"><span className="label">Thamani ya ombi</span><span className="value">{p.currency === 'USD' && p.totalUsd ? usd(p.totalUsd) : tsh(p.totalAmount)}</span>{p.currency === 'USD' && <span className="hint">{tsh(p.totalAmount)} kwa kiwango {num(p.fxRate)} · deni kwa mzabuni ni la dola</span>}</section>
          <section className="card kpi"><span className="label">Limelipwa</span><span className="value">{p.currency === 'USD' ? usd(p.paidUsd) : tsh(p.paid)}</span><span className="hint">{p.currency === 'USD' ? `${tsh(p.paid)} · ` : ''}Malipo yanafanywa na Mhasibu</span></section>
          <section className="card kpi"><span className="label">Idhini</span><span className="value" style={{ fontSize: 18 }}>{data.approval?.requestNo ?? '—'}</span><span className="hint">{data.approval?.decisionNote ? `"${data.approval.decisionNote}"` : data.approval?.status === 'PENDING' ? 'Inasubiri Meneja' : ''}</span></section>
        </div>
        <Section pad={false} title="Bidhaa">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Bidhaa</th><th className="num">Kiasi</th><th className="num">Bei</th><th className="num">Jumla</th><th className="num">Imepokelewa</th></tr></thead>
            <tbody>{data.lines.map((l) => (
              <tr key={l.id}><td>{l.inputItem.name}</td><td className="num">{num(l.quantity)} {UNIT_LABEL[l.inputItem.unit]}</td><td className="num">{l.unitCostUsd ? usd(l.unitCostUsd) : tsh(l.unitCost)}</td><td className="num">{l.amountUsd ? usd(l.amountUsd) : tsh(l.amount)}</td>
                <td className="num">{num(l.receivedQty)} {Number(l.receivedQty) >= Number(l.quantity) ? <span className="badge badge-ok">Kamili</span> : null}</td></tr>
            ))}</tbody>
          </table></div>
          {p.notes && <p className="muted" style={{ padding: '0 16px' }}>Sababu: {p.notes}</p>}
        </Section>
        <div className="grid grid-2">
          <Section pad={false} title="Mzigo uliopokelewa">
            {data.receipts.length === 0 ? <Empty>Bado haujapokelewa.</Empty> : (
              <div className="table-wrap"><table className="table"><tbody>{data.receipts.map((r) => (
                <tr key={r.id}><td>{dateTime(r.createdAt)}</td><td>{r.reference}{r.batchNo ? ` · ${r.batchNo}` : ''}</td><td className="num">+{num(r.quantity)}</td></tr>
              ))}</tbody></table></div>
            )}
          </Section>
          <Section pad={false} title="Malipo">
            {data.payments.length === 0 ? <Empty>Bado halijalipwa.</Empty> : (
              <div className="table-wrap"><table className="table"><tbody>{data.payments.map((t) => (
                <tr key={t.id}><td>{t.txnNo}</td><td>{date(t.txnDate)}</td><td className="num">{t.amountUsd ? <>{usd(t.amountUsd)}<div className="muted" style={{ fontSize: 12 }}>{tsh(t.amount)}</div></> : tsh(t.amount)}</td><td><Badge status={t.status === 'POSTED' ? 'APPROVED' : 'DRAFT'} label={t.status === 'POSTED' ? 'Imelipwa' : 'Inaandaliwa'} /></td></tr>
              ))}</tbody></table></div>
            )}
          </Section>
        </div>
      </div>
      {receive && <ReceiveInputsModal purchaseId={p.id} onClose={() => setReceive(false)} onDone={(no) => { setReceive(false); setOk(`Mzigo umetumwa kwa Meneja (${no}). Utaingia stoo baada ya idhini ya idadi na bei.`); reload(); }} />}
    </>
  );
}


function Suppliers() {
  const { may } = useAuth();
  const { data, loading, reload } = useFetch<{ data: Supplier[] }>('/store/suppliers');
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const act = useAction();
  return (
    <Section pad={false} title="Wazabuni" actions={may('suppliers.manage') && <Button size="sm" onClick={() => setEdit({})}>+ Mzabuni</Button>}>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Bado hakuna mzabuni.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Jina</th><th>Simu</th><th>TIN</th><th>Anwani</th><th>Hali</th><th /></tr></thead>
          <tbody>{data?.data.map((s) => (
            <tr key={s.id}><td><strong>{s.name}</strong>{s.email && <div className="muted" style={{ fontSize: 12 }}>{s.email}</div>}</td><td>{phone(s.phone)}</td><td>{s.tin ?? '—'}</td><td>{s.address ?? '—'}</td>
              <td>{s.isActive ? <Badge status="ACTIVE" /> : <Badge status="CANCELLED" label="Amesitishwa" />}</td>
              <td className="num">{may('suppliers.manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>Hariri</Button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && (
        <Modal open title={edit.id ? edit.name ?? '' : 'Mzabuni mpya'} onClose={() => setEdit(null)}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Ghairi</Button><Button busy={act.busy} disabled={(edit.name ?? '').trim().length < 2} onClick={async () => {
            const body = { name: edit.name, phone: edit.phone || null, email: edit.email || null, tin: edit.tin || null, address: edit.address || null, ...(edit.id ? { isActive: edit.isActive } : {}) };
            if (await act.run(() => api(edit.id ? `/store/suppliers/${edit.id}` : '/store/suppliers', { method: edit.id ? 'PATCH' : 'POST', body }))) { setEdit(null); reload(); }
          }}>Hifadhi</Button></>}>
          <Alert>{act.error}</Alert>
          <div className="form-grid">
            <TextField label="Jina *" value={edit.name ?? ''} onChange={(v) => setEdit({ ...edit, name: v })} />
            <TextField label="Simu" type="tel" value={edit.phone ? phone(edit.phone) : ''} onChange={(v) => setEdit({ ...edit, phone: v })} />
            <TextField label="Email" type="email" value={edit.email ?? ''} onChange={(v) => setEdit({ ...edit, email: v })} />
            <TextField label="TIN" value={edit.tin ?? ''} onChange={(v) => setEdit({ ...edit, tin: v })} />
            <TextField label="Anwani" value={edit.address ?? ''} onChange={(v) => setEdit({ ...edit, address: v })} />
            {edit.id && <SelectField label="Hali" value={edit.isActive ? 'on' : 'off'} onChange={(v) => setEdit({ ...edit, isActive: v === 'on' })} options={[{ value: 'on', label: 'Hai' }, { value: 'off', label: 'Amesitishwa' }]} />}
          </div>
        </Modal>
      )}
    </Section>
  );
}
