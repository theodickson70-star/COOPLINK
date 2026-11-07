import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Alert, Button, Empty, Field, Input, Loading, Modal, PageHead, Pager, Select, SelectField, TextField, Textarea } from '../components/ui';
import { ConfirmDialog, money, nfmt, Pill, Tabs } from '../components/owner-ui';
import { RecordPaymentModal } from './Finance';

export interface Plan {
  id: string; name: string; code: string; description: string | null; monthlyPrice: string; annualPrice: string; currency: string;
  trialDays: number; graceDays: number; maxMembers: number | null; features: string[] | null; isActive: boolean;
  activeSubscriptions: number; totalSubscriptions: number;
}
interface SubRow {
  id: string; cycle: string; status: string; startDate: string; endDate: string; graceDays: number; discountPercent: string; price: string; notes: string | null;
  amcos: { id: string; name: string; code: string; status: string }; plan: { id: string; name: string }; paidTotal: string; pendingTotal: string;
}

export function OwnerSubscriptions() {
  const [tab, setTab] = useState<'subs' | 'plans'>('subs');
  return (
    <>
      <PageHead title="Subscriptions & Pricing" sub="Mipango ya bei inabadilishwa hapa — hakuna haja ya kubadilisha code" />
      <Tabs value={tab} onChange={setTab} items={[['subs', 'Subscriptions'], ['plans', 'Mipango na bei']]} />
      {tab === 'plans' ? <Plans /> : <Subs />}
    </>
  );
}

function Plans() {
  const { has } = useAuth();
  const { data, error, loading, reload } = useFetch<{ data: Plan[] }>('/owner/subscriptions/plans');
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const [del, setDel] = useState<Plan | null>(null);
  const act = useAction();
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <Alert>{error ?? act.error}</Alert>
      {has('subscriptions.manage') && <div><Button onClick={() => setEdit('new')}>+ Mpango mpya</Button></div>}
      {data?.data.length === 0 ? <Empty>Bado hakuna mpango. Unda mpango wa kwanza (mf. Msingi, Kawaida, Premium).</Empty> : (
        <div className="grid grid-3">
          {data?.data.map((p) => (
            <article key={p.id} className={`card plan-card ${p.isActive ? '' : 'plan-off'}`}>
              <div className="plan-head"><h3>{p.name}</h3>{p.isActive ? <Pill value="ACTIVE" /> : <Pill value="CANCELLED" label="Imesitishwa" />}</div>
              <div className="plan-price">{money(p.monthlyPrice, p.currency === 'USD' ? '$' : 'TSh')}<small>/mwezi</small></div>
              <div className="muted">{money(p.annualPrice, p.currency === 'USD' ? '$' : 'TSh')} kwa mwaka</div>
              {p.description && <p style={{ margin: '10px 0 0' }}>{p.description}</p>}
              <ul className="plan-features">
                <li>Trial: siku {p.trialDays}</li><li>Grace: siku {p.graceDays}</li>
                <li>Wanachama: {p.maxMembers ? `hadi ${nfmt(p.maxMembers)}` : 'bila kikomo'}</li>
                {(p.features ?? []).map((f) => <li key={f}>{f}</li>)}
              </ul>
              <div className="muted" style={{ fontSize: 13 }}>{p.activeSubscriptions} hai · {p.totalSubscriptions} jumla · code {p.code}</div>
              {has('subscriptions.manage') && (
                <div className="actions" style={{ marginTop: 12 }}>
                  <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>Hariri</Button>
                  <Button size="sm" variant="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/subscriptions/plans/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }))) reload(); }}>
                    {p.isActive ? 'Sitisha' : 'Washa'}
                  </Button>
                  {p.totalSubscriptions === 0 && <Button size="sm" variant="ghost" onClick={() => setDel(p)}>Futa</Button>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {edit && <PlanModal plan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      <ConfirmDialog open={!!del} danger title={`Futa mpango ${del?.name}?`} confirmLabel="Futa" onClose={() => setDel(null)}
        message="Mpango huu haujawahi kutumiwa na chama chochote, kwa hiyo ni salama kuufuta."
        onConfirm={async (c) => { await api(`/owner/subscriptions/plans/${del!.id}`, { method: 'DELETE', body: c }); setDel(null); reload(); }} />
    </div>
  );
}

function PlanModal({ plan, onClose, onDone }: { plan: Plan | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    name: plan?.name ?? '', code: plan?.code ?? '', description: plan?.description ?? '', monthlyPrice: plan ? String(Number(plan.monthlyPrice)) : '',
    annualPrice: plan ? String(Number(plan.annualPrice)) : '', currency: plan?.currency ?? 'TZS', trialDays: String(plan?.trialDays ?? 14),
    graceDays: String(plan?.graceDays ?? 7), maxMembers: plan?.maxMembers ? String(plan.maxMembers) : '', features: (plan?.features ?? []).join('\n'),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const { busy, error, run } = useAction();
  const save = async () => {
    const body = {
      name: f.name, description: f.description || null, monthlyPrice: f.monthlyPrice, annualPrice: f.annualPrice, currency: f.currency,
      trialDays: Number(f.trialDays), graceDays: Number(f.graceDays), maxMembers: f.maxMembers ? Number(f.maxMembers) : null,
      features: f.features.split('\n').map((x) => x.trim()).filter(Boolean),
      ...(plan ? {} : { code: f.code }),
    };
    const r = await run(() => api(plan ? `/owner/subscriptions/plans/${plan.id}` : '/owner/subscriptions/plans', { method: plan ? 'PATCH' : 'POST', body }));
    if (r) onDone();
  };
  return (
    <Modal open title={plan ? `Hariri ${plan.name}` : 'Mpango mpya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!f.name || (!plan && !f.code) || !f.monthlyPrice || !f.annualPrice} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      {plan && <Alert kind="warn">Bei mpya itatumika kwa subscriptions mpya tu. Zilizopo zinabaki na bei yao ya sasa.</Alert>}
      <div className="form-grid">
        <TextField label="Jina *" value={f.name} onChange={set('name')} />
        <TextField label="Code *" value={f.code} disabled={!!plan} onChange={(v) => set('code')(v.toUpperCase())} />
        <TextField label="Bei kwa mwezi *" type="number" min="0" value={f.monthlyPrice} onChange={set('monthlyPrice')} />
        <TextField label="Bei kwa mwaka *" type="number" min="0" value={f.annualPrice} onChange={set('annualPrice')} />
        <SelectField label="Sarafu" value={f.currency} onChange={set('currency')} options={[{ value: 'TZS', label: 'TZS' }, { value: 'USD', label: 'USD' }]} />
        <TextField label="Siku za trial" type="number" min="0" value={f.trialDays} onChange={set('trialDays')} />
        <TextField label="Siku za grace" type="number" min="0" value={f.graceDays} onChange={set('graceDays')} />
        <TextField label="Kikomo cha wanachama" type="number" min="1" help="Acha tupu = bila kikomo" value={f.maxMembers} onChange={set('maxMembers')} />
      </div>
      <TextField label="Maelezo" value={f.description} onChange={set('description')} />
      <Field label="Vipengele (kimoja kwa kila mstari)">{(id) => <Textarea id={id} value={f.features} onChange={(e) => set('features')(e.target.value)} />}</Field>
    </Modal>
  );
}

export function AssignPlanModal({ amcosId, amcosName, onClose, onDone }: { amcosId: string; amcosName: string; onClose: () => void; onDone: () => void }) {
  const plans = useFetch<{ data: Plan[] }>('/owner/subscriptions/plans');
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState('MONTHLY');
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const plan = plans.data?.data.find((p) => p.id === planId);
  const price = plan ? (cycle === 'ANNUAL' ? Number(plan.annualPrice) : cycle === 'MONTHLY' ? Number(plan.monthlyPrice) : 0) * (100 - Number(discount || 0)) / 100 : 0;
  return (
    <Modal open title={`Weka mpango: ${amcosName}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button>
        <Button busy={busy} disabled={!planId} onClick={async () => { if (await run(() => api('/owner/subscriptions/assign', { method: 'POST', body: { amcosId, planId, cycle, discountPercent: discount || '0', notes: notes || null } }))) onDone(); }}>Weka mpango</Button></>}>
      <Alert>{error}</Alert>
      <SelectField label="Mpango *" value={planId} onChange={setPlanId} placeholder="Chagua…"
        options={(plans.data?.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} · ${money(p.monthlyPrice)}/mwezi` }))} />
      <SelectField label="Mzunguko" value={cycle} onChange={setCycle} options={[{ value: 'TRIAL', label: `Trial${plan ? ` (siku ${plan.trialDays})` : ''}` }, { value: 'MONTHLY', label: 'Kila mwezi' }, { value: 'ANNUAL', label: 'Kila mwaka' }]} />
      {cycle !== 'TRIAL' && <TextField label="Punguzo (%)" type="number" min="0" max="100" value={discount} onChange={setDiscount} />}
      <TextField label="Maelezo" value={notes} onChange={setNotes} />
      {plan && cycle !== 'TRIAL' && <Alert kind="warn">Bei ya kipindi kimoja: <strong>{money(price)}</strong>. Subscription itaanza bila kulipiwa; grace ya siku {plan.graceDays} inaanza leo. Muda unaongezwa tu malipo yakithibitishwa.</Alert>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Subscription ya sasa ya chama hiki (kama ipo) itafutwa na hii mpya kuchukua nafasi yake.</p>
    </Modal>
  );
}

function Subs() {
  const { has } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, error, loading, reload } = useFetch<Paged<SubRow>>('/owner/subscriptions', { status, search: q, page, pageSize: 25 });
  const [sel, setSel] = useState<{ s: SubRow; kind: 'extend' | 'edit' | 'cancel' | 'pay' } | null>(null);
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const [discount, setDiscount] = useState('');
  const [grace, setGrace] = useState('');
  const act = useAction();
  const close = () => { setSel(null); setReason(''); };
  const done = () => { close(); reload(); };

  return (
    <section className="card">
      <div className="toolbar">
        <Input aria-label="Tafuta" placeholder="Tafuta AMCOS…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Zote (zisizofutwa)</option><option value="ACTIVE">Hai</option><option value="TRIAL">Trial</option>
          <option value="EXPIRING">Zinakaribia kuisha</option><option value="PAST_DUE">Kwenye grace</option><option value="EXPIRED">Zimeisha</option>
          <option value="PAID">Zimelipwa</option><option value="UNPAID">Hazijalipwa</option><option value="CANCELLED">Zimefutwa</option>
        </Select>
      </div>
      <Alert>{error ?? act.error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna subscriptions.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>AMCOS</th><th>Mpango</th><th>Hali</th><th>Hadi</th><th className="num">Bei</th><th className="num">Imelipwa</th><th className="num">Inasubiri</th><th /></tr></thead>
          <tbody>{data?.data.map((s) => (
            <tr key={s.id}>
              <td><Link className="row-link" to={`/owner/amcos/${s.amcos.id}`}>{s.amcos.name}</Link><div className="muted" style={{ fontSize: 13 }}>{s.amcos.code}</div></td>
              <td>{s.plan.name}<div className="muted" style={{ fontSize: 13 }}>{s.cycle === 'TRIAL' ? 'Trial' : s.cycle === 'ANNUAL' ? 'Kila mwaka' : 'Kila mwezi'}{Number(s.discountPercent) ? ` · -${Number(s.discountPercent)}%` : ''}</div></td>
              <td><Pill value={s.status} /></td>
              <td>{date(s.endDate)}<div className="muted" style={{ fontSize: 12 }}>grace siku {s.graceDays}</div></td>
              <td className="num">{money(s.price)}</td>
              <td className="num">{money(s.paidTotal)}</td>
              <td className="num">{Number(s.pendingTotal) ? money(s.pendingTotal) : '—'}</td>
              <td className="num">{s.status !== 'CANCELLED' && (
                <span className="actions" style={{ justifyContent: 'flex-end' }}>
                  {has('finance.manage') && <Button size="sm" variant="gold" onClick={() => setSel({ s, kind: 'pay' })}>Malipo</Button>}
                  {has('subscriptions.manage') && <>
                    <Button size="sm" variant="secondary" onClick={() => setSel({ s, kind: 'extend' })}>Ongeza muda</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDiscount(String(Number(s.discountPercent))); setGrace(String(s.graceDays)); setSel({ s, kind: 'edit' }); }}>Punguzo/grace</Button>
                    <Button size="sm" variant="ghost" onClick={() => setSel({ s, kind: 'cancel' })}>Futa</Button>
                  </>}
                </span>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />

      <ConfirmDialog open={sel?.kind === 'extend'} title={`Ongeza muda: ${sel?.s.amcos.name}`} confirmLabel="Ongeza" onClose={close}
        message="Hii ni nyongeza bila malipo (mf. fidia ya hitilafu). Malipo ya kawaida yanaongeza muda yenyewe yakithibitishwa."
        onConfirm={async (c) => { await api(`/owner/subscriptions/${sel!.s.id}/extend`, { method: 'POST', body: { days: Number(days), reason, ...c } }); done(); }}>
        <TextField label="Siku *" type="number" min="1" value={days} onChange={setDays} />
        <TextField label="Sababu *" value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog open={sel?.kind === 'cancel'} danger title={`Futa subscription ya ${sel?.s.amcos.name}?`} confirmLabel="Futa subscription" onClose={close}
        message="Chama hakitasitishwa moja kwa moja, lakini hakitakuwa na mpango hadi upewe mpya."
        onConfirm={async (c) => { await api(`/owner/subscriptions/${sel!.s.id}/cancel`, { method: 'POST', body: { reason, ...c } }); done(); }}>
        <TextField label="Sababu *" value={reason} onChange={setReason} />
      </ConfirmDialog>
      {sel?.kind === 'edit' && (
        <Modal open title={`Punguzo na grace: ${sel.s.amcos.name}`} onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button busy={act.busy} disabled={reason.trim().length < 3} onClick={async () => {
            if (await act.run(() => api(`/owner/subscriptions/${sel.s.id}`, { method: 'PATCH', body: { discountPercent: discount || '0', graceDays: Number(grace), reason } }))) done();
          }}>Hifadhi</Button></>}>
          <TextField label="Punguzo (%)" type="number" min="0" max="100" value={discount} onChange={setDiscount} />
          <TextField label="Siku za grace" type="number" min="0" max="90" value={grace} onChange={setGrace} />
          <TextField label="Sababu *" value={reason} onChange={setReason} />
        </Modal>
      )}
      {sel?.kind === 'pay' && <RecordPaymentModal subscription={{ id: sel.s.id, cycle: sel.s.cycle, price: sel.s.price, amcosName: sel.s.amcos.name }} onClose={close} onDone={done} />}
    </section>
  );
}
