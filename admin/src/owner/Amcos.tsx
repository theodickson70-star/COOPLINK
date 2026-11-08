import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, phone, STAFF_DUTY } from '../lib/format';
import { Alert, Button, Empty, Input, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';
import { ConfirmDialog, money, nfmt, Pill, Section } from '../components/owner-ui';
import { AssignPlanModal, type Plan } from './Subscriptions';
import { RecordPaymentModal } from './Finance';

interface Row {
  id: string; name: string; code: string; region: string | null; district: string | null; status: string; statusReason: string | null;
  createdAt: string; approvedAt: string | null; users: number; members: number;
  sub: { status: string; endDate: string; cycle: string; plan: string } | null;
}

export function OwnerAmcos() {
  const { has } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const status = params.get('status') ?? '';
  const subscription = params.get('subscription') ?? '';
  const q = useDebounced(search);
  const { data, error, loading, reload } = useFetch<Paged<Row>>('/owner/amcos', { search: q, status, subscription, page, pageSize: 25 });
  const [open, setOpen] = useState(false);
  const setFilter = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); setPage(1); };

  return (
    <>
      <PageHead title="AMCOS Management" sub="Vyama kama wateja wa CoopLink: usajili, idhini, hali na subscriptions">
        {has('amcos.create') && <Button onClick={() => setOpen(true)}>+ Sajili AMCOS</Button>}
      </PageHead>
      <Alert>{error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Input aria-label="Tafuta" placeholder="Tafuta jina, code, wilaya…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select aria-label="Hali" value={status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">Hali zote</option><option value="PENDING">Zinasubiri idhini</option><option value="ACTIVE">Hai</option>
            <option value="SUSPENDED">Zimesitishwa</option><option value="REJECTED">Zimekataliwa</option>
          </Select>
          <Select aria-label="Subscription" value={subscription} onChange={(e) => setFilter('subscription', e.target.value)}>
            <option value="">Subscriptions zote</option><option value="TRIAL">Trial</option><option value="ACTIVE">Hai</option>
            <option value="PAST_DUE">Kwenye grace</option><option value="EXPIRED">Zimeisha</option><option value="NONE">Hazina mpango</option>
          </Select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna AMCOS iliyopatikana.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>AMCOS</th><th>Eneo</th><th>Hali</th><th>Mpango</th><th>Inaisha</th><th className="num">Watumiaji</th><th className="num">Wanachama</th><th>Ilisajiliwa</th></tr></thead>
              <tbody>
                {data?.data.map((a) => (
                  <tr key={a.id} onClick={() => nav(`/owner/amcos/${a.id}`)} style={{ cursor: 'pointer' }}>
                    <td><Link className="row-link" to={`/owner/amcos/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link><div className="muted" style={{ fontSize: 13 }}>{a.code}</div></td>
                    <td>{[a.district, a.region].filter(Boolean).join(', ') || '—'}</td>
                    <td><Pill value={a.status} /></td>
                    <td>{a.sub ? <>{a.sub.plan} <Pill value={a.sub.status} /></> : <span className="muted">Hakuna</span>}</td>
                    <td>{a.sub ? date(a.sub.endDate) : '—'}</td>
                    <td className="num">{nfmt(a.users)}</td>
                    <td className="num">{nfmt(a.members)}</td>
                    <td>{date(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
      {open && <AmcosFormModal onClose={() => setOpen(false)} onSaved={(id) => { setOpen(false); reload(); nav(`/owner/amcos/${id}`); }} />}
    </>
  );
}

interface AmcosFull {
  id: string; name: string; code: string; regNumber: string | null; region: string | null; district: string | null; ward: string | null; village: string | null;
  phone: string | null; email: string | null; contactName: string | null; contactPhone: string | null; status: string; statusReason: string | null;
  createdAt: string; approvedAt: string | null; unionId: string | null;
}

function AmcosFormModal({ initial, onClose, onSaved }: { initial?: AmcosFull; onClose: () => void; onSaved: (id: string) => void }) {
  const { has } = useAuth();
  const plans = useFetch<{ data: Plan[] }>(has('subscriptions.read') ? '/owner/subscriptions/plans' : null);
  const [f, setF] = useState({
    name: initial?.name ?? '', code: initial?.code ?? '', regNumber: initial?.regNumber ?? '', region: initial?.region ?? 'Tabora',
    district: initial?.district ?? '', ward: initial?.ward ?? '', village: initial?.village ?? '', phone: initial?.phone?.replace(/^255/, '0') ?? '',
    email: initial?.email ?? '', contactName: initial?.contactName ?? '', contactPhone: initial?.contactPhone?.replace(/^255/, '0') ?? '',
  });
  const [activate, setActivate] = useState(has('amcos.approve'));
  const [trialPlanId, setTrialPlanId] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const { busy, error, run } = useAction();
  const save = async () => {
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
    if (initial) {
      delete body.code;
      const r = await run(() => api<{ amcos: AmcosFull }>(`/owner/amcos/${initial.id}`, { method: 'PATCH', body }));
      if (r) onSaved(r.amcos.id);
    } else {
      const r = await run(() => api<{ amcos: AmcosFull }>('/owner/amcos', { method: 'POST', body: { ...body, activate, trialPlanId: activate && trialPlanId ? trialPlanId : undefined } }));
      if (r) onSaved(r.amcos.id);
    }
  };
  return (
    <Modal open title={initial ? 'Hariri taarifa za AMCOS' : 'Sajili AMCOS mpya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={f.name.length < 3 || f.code.length < 2} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina la chama *" value={f.name} onChange={set('name')} />
        <TextField label="Code *" help={initial ? 'Code haibadilishwi' : 'mf. URM01 — haibadilishwi baadaye'} value={f.code} disabled={!!initial} onChange={(v) => set('code')(v.toUpperCase())} />
        <TextField label="Namba ya usajili (Mrajis)" value={f.regNumber} onChange={set('regNumber')} />
        <TextField label="Mkoa" value={f.region} onChange={set('region')} />
        <TextField label="Wilaya" value={f.district} onChange={set('district')} />
        <TextField label="Kata" value={f.ward} onChange={set('ward')} />
        <TextField label="Kijiji" value={f.village} onChange={set('village')} />
        <TextField label="Simu ya chama" type="tel" value={f.phone} onChange={set('phone')} />
        <TextField label="Email" type="email" value={f.email} onChange={set('email')} />
        <TextField label="Mtu wa mawasiliano" value={f.contactName} onChange={set('contactName')} />
        <TextField label="Simu ya mawasiliano" type="tel" value={f.contactPhone} onChange={set('contactPhone')} />
      </div>
      {!initial && has('amcos.approve') && (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Idhinisha sasa (bila hivyo itasubiri idhini)
          </label>
          {activate && (
            <SelectField label="Anzisha trial (hiari)" value={trialPlanId} onChange={setTrialPlanId} placeholder="— Bila trial —"
              options={(plans.data?.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} · siku ${p.trialDays}` }))} />
          )}
        </>
      )}
      {!initial && !has('amcos.approve') && <Alert kind="warn">AMCOS hii itasubiri idhini ya Owner kabla watumiaji wake hawajaingia.</Alert>}
    </Modal>
  );
}

interface Detail {
  amcos: AmcosFull;
  union: { name: string } | null;
  subscriptions: { id: string; plan_name: string; cycle: string; status: string; start_date: string; end_date: string; price: string; discount_percent: string; grace_days: number; created_at: string }[];
  payments: { id: string; invoiceNo: string; amount: string; status: string; method: string; paidAt: string; category: string }[];
  counts: { users: number; active_users: number; members: number; last_activity: string | null };
  admins: { fullName: string; phone: string; email: string | null; isActive: boolean }[];
}

export function OwnerAmcosDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const { data, error, loading, reload } = useFetch<Detail>(`/owner/amcos/${id}`);
  const plans = useFetch<{ data: Plan[] }>(has('subscriptions.read') ? '/owner/subscriptions/plans' : null);
  const [modal, setModal] = useState<null | 'edit' | 'approve' | 'reject' | 'suspend' | 'reactivate' | 'assign' | 'pay'>(null);
  const [reason, setReason] = useState('');
  const [trialPlanId, setTrialPlanId] = useState('');
  const act = useAction();
  const close = () => { setModal(null); setReason(''); };
  const done = () => { close(); reload(); };

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const a = data.amcos;
  const current = data.subscriptions.find((s) => ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED'].includes(s.status));

  return (
    <>
      <PageHead title={a.name} sub={<>{a.code} · <Pill value={a.status} />{a.statusReason ? <span className="muted"> · {a.statusReason === 'SUBSCRIPTION_EXPIRED' ? 'Subscription imeisha' : a.statusReason}</span> : null}</>}>
        <Link className="btn btn-secondary" to="/owner/amcos">← Orodha</Link>
        {has('amcos.create') && <Button variant="secondary" onClick={() => setModal('edit')}>Hariri</Button>}
        {a.status === 'PENDING' && has('amcos.approve') && <><Button onClick={() => setModal('approve')}>Idhinisha</Button><Button variant="danger" onClick={() => setModal('reject')}>Kataa</Button></>}
        {a.status === 'ACTIVE' && has('amcos.suspend') && <Button variant="danger" onClick={() => setModal('suspend')}>Sitisha</Button>}
        {(a.status === 'SUSPENDED' || (a.status === 'REJECTED' && has('amcos.approve'))) && has('amcos.suspend') && <Button onClick={() => setModal('reactivate')}>Washa tena</Button>}
      </PageHead>
      <Alert>{act.error}</Alert>

      <div className="grid grid-kpi" style={{ marginBottom: 16 }}>
        <div className="card kpi"><span className="label">Watumiaji</span><span className="value">{nfmt(data.counts.users)}</span><span className="hint">{nfmt(data.counts.active_users)} hai</span></div>
        <div className="card kpi"><span className="label">Wanachama (idadi tu)</span><span className="value">{nfmt(data.counts.members)}</span></div>
        <div className="card kpi"><span className="label">Shughuli ya mwisho</span><span className="value" style={{ fontSize: 18 }}>{data.counts.last_activity ? dateTime(data.counts.last_activity) : '—'}</span></div>
        <div className="card kpi kpi-dark"><span className="label">Subscription</span><span className="value" style={{ fontSize: 20 }}>{current ? current.plan_name : 'Hakuna'}</span>
          <span className="hint">{current ? <><Pill value={current.status} /> hadi {date(current.end_date)}</> : 'Weka mpango'}</span></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Section title="Taarifa za AMCOS">
          <dl className="dl">
            <dt>Mrajis</dt><dd>{a.regNumber ?? '—'}</dd>
            <dt>Eneo</dt><dd>{[a.village, a.ward, a.district, a.region].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Chama Kikuu</dt><dd>{data.union?.name ?? '—'}</dd>
            <dt>Simu / Email</dt><dd>{phone(a.phone)} · {a.email ?? '—'}</dd>
            <dt>Mawasiliano</dt><dd>{a.contactName ?? '—'} {a.contactPhone ? `· ${phone(a.contactPhone)}` : ''}</dd>
            <dt>Ilisajiliwa</dt><dd>{dateTime(a.createdAt)}</dd>
            <dt>Iliidhinishwa</dt><dd>{a.approvedAt ? dateTime(a.approvedAt) : '—'}</dd>
          </dl>
        </Section>
        <StaffSlots amcosId={a.id} disabled={a.status === 'REJECTED'} />
      </div>

      {has('subscriptions.read') && (
        <div style={{ marginBottom: 16 }}>
          <Section pad={false} title="Subscriptions" actions={<>
            {has('subscriptions.manage') && a.status !== 'PENDING' && a.status !== 'REJECTED' && <Button size="sm" onClick={() => setModal('assign')}>Weka mpango</Button>}
            {has('finance.manage') && current && <Button size="sm" variant="gold" onClick={() => setModal('pay')}>Rekodi malipo</Button>}
          </>}>
            {data.subscriptions.length === 0 ? <Empty>Hakuna subscription bado.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Mpango</th><th>Mzunguko</th><th>Hali</th><th>Kuanzia</th><th>Hadi</th><th className="num">Bei</th><th className="num">Punguzo</th></tr></thead>
                <tbody>{data.subscriptions.map((s) => (
                  <tr key={s.id}><td>{s.plan_name}</td><td><Pill value={s.cycle} /></td><td><Pill value={s.status} /></td><td>{date(s.start_date)}</td><td>{date(s.end_date)}</td>
                    <td className="num">{money(s.price)}</td><td className="num">{Number(s.discount_percent)}%</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Section>
        </div>
      )}

      {has('finance.read') && (
        <Section pad={false} title="Historia ya malipo">
          {data.payments.length === 0 ? <Empty>Hakuna malipo yaliyorekodiwa.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Ankara</th><th>Tarehe</th><th>Aina</th><th>Njia</th><th className="num">Kiasi</th><th>Hali</th></tr></thead>
              <tbody>{data.payments.map((p) => (
                <tr key={p.id}><td>{p.invoiceNo}</td><td>{date(p.paidAt)}</td><td><Pill value={p.category} /></td><td>{p.method}</td><td className="num">{money(p.amount)}</td><td><Pill value={p.status} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Section>
      )}

      {modal === 'edit' && <AmcosFormModal initial={a} onClose={close} onSaved={done} />}
      {modal === 'approve' && (
        <Modal open title="Idhinisha AMCOS" onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/amcos/${a.id}/approve`, { method: 'POST', body: { trialPlanId: trialPlanId || undefined } }))) done(); }}>Idhinisha</Button></>}>
          <p>Watumiaji wa <strong>{a.name}</strong> wataweza kuingia mara moja.</p>
          <SelectField label="Anzisha trial (hiari)" value={trialPlanId} onChange={setTrialPlanId} placeholder="— Bila trial —"
            options={(plans.data?.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.name} · siku ${p.trialDays}` }))} />
        </Modal>
      )}
      {modal === 'reject' && (
        <Modal open title="Kataa usajili" onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button variant="danger" busy={act.busy} disabled={reason.trim().length < 3} onClick={async () => { if (await act.run(() => api(`/owner/amcos/${a.id}/reject`, { method: 'POST', body: { reason } }))) done(); }}>Kataa</Button></>}>
          <TextField label="Sababu *" value={reason} onChange={setReason} />
        </Modal>
      )}
      <ConfirmDialog open={modal === 'suspend'} danger title={`Sitisha ${a.name}?`} confirmLabel="Sitisha"
        message="Watumiaji wote wa chama hiki watazuiwa kuingia mara moja. Data yao haitafutwa." onClose={close}
        onConfirm={async (c) => { await api(`/owner/amcos/${a.id}/suspend`, { method: 'POST', body: { reason, ...c } }); done(); }}>
        <TextField label="Sababu *" value={reason} onChange={setReason} />
      </ConfirmDialog>
      <ConfirmDialog open={modal === 'reactivate'} title={`Washa ${a.name} tena?`} confirmLabel="Washa"
        message="Watumiaji wa chama hiki wataweza kuingia tena." onClose={close}
        onConfirm={async (c) => { await api(`/owner/amcos/${a.id}/reactivate`, { method: 'POST', body: c }); done(); }} />
      {modal === 'assign' && <AssignPlanModal amcosId={a.id} amcosName={a.name} onClose={close} onDone={done} />}
      {modal === 'pay' && current && <RecordPaymentModal subscription={{ id: current.id, cycle: current.cycle, price: current.price, amcosName: a.name }} onClose={close} onDone={done} />}
    </>
  );
}


// ------------------------------ WATUMISHI WATATU WA AMCOS ------------------------------
interface StaffUser { id: string; fullName: string; phone: string; email: string | null; role: string; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; updatedAt: string }
interface Slot { role: 'AMCOS_ADMIN' | 'ACCOUNTANT' | 'CLERK'; title: string; holder: StaffUser | null }

function StaffSlots({ amcosId, disabled }: { amcosId: string; disabled: boolean }) {
  const { has } = useAuth();
  const { data, loading, reload } = useFetch<{ slots: Slot[]; history: StaffUser[] }>(`/owner/amcos/${amcosId}/staff`);
  const [assign, setAssign] = useState<Slot | null>(null);
  const [off, setOff] = useState<StaffUser | null>(null);
  const [secret, setSecret] = useState<{ name: string; phone: string; password: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const act = useAction();
  const manage = has('amcos.staff') && !disabled;
  return (
    <Section title="Watumishi (3)" actions={data && data.history.length > 0 ? <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Ficha historia' : `Historia (${data.history.length})`}</Button> : null}>
      <Alert>{act.error}</Alert>
      {loading && !data ? <Loading /> : (
        <div className="staff-slots">
          {data?.slots.map((s) => (
            <div key={s.role} className={`staff-slot ${s.holder ? '' : 'empty'}`}>
              <div className="staff-slot-head"><strong>{s.title}</strong>{s.holder ? <Pill value="ACTIVE" /> : <Pill value="PENDING" label="Nafasi wazi" />}</div>
              <small className="muted">{STAFF_DUTY[s.role]}</small>
              {s.holder ? (
                <div className="staff-slot-body">
                  <div><strong>{s.holder.fullName}</strong> · {phone(s.holder.phone)}</div>
                  <small className="muted">{s.holder.mustChangePassword ? 'Bado hajaingia (nenosiri la muda)' : s.holder.lastLoginAt ? `Aliingia ${dateTime(s.holder.lastLoginAt)}` : ''}</small>
                  {manage && (
                    <div className="actions">
                      <Button size="sm" variant="secondary" busy={act.busy} onClick={async () => {
                        const r = await act.run(() => api<{ temporaryPassword: string }>(`/owner/amcos/${amcosId}/staff/${s.holder!.id}/reset-password`, { method: 'POST' }));
                        if (r) setSecret({ name: s.holder!.fullName, phone: s.holder!.phone, password: r.temporaryPassword });
                      }}>Nenosiri jipya</Button>
                      <Button size="sm" variant="secondary" onClick={() => setAssign(s)}>Badilisha mtumishi</Button>
                      <Button size="sm" variant="ghost" onClick={() => setOff(s.holder)}>Zima</Button>
                    </div>
                  )}
                </div>
              ) : manage && <div className="actions"><Button size="sm" onClick={() => setAssign(s)}>+ Weka {s.title}</Button></div>}
            </div>
          ))}
        </div>
      )}
      {showHistory && data && (
        <table className="table" style={{ marginTop: 12 }}><tbody>
          {data.history.map((h) => <tr key={h.id}><td>{h.fullName}</td><td>{STAFF_TITLE_OF(h.role)}</td><td>{phone(h.phone)}</td><td className="muted">Amezimwa {date(h.updatedAt)}</td></tr>)}
        </tbody></table>
      )}
      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Kila AMCOS ina mtumishi mmoja kwa kila cheo. Mtumishi akibadilishwa, akaunti ya zamani inazimwa (haifutwi) na historia yake yote inabaki.</p>
      {assign && <AssignStaff amcosId={amcosId} slot={assign} onClose={() => setAssign(null)} onDone={(sec) => { setAssign(null); setSecret(sec); reload(); }} />}
      <ConfirmDialog open={!!off} danger title={`Zima ${off?.fullName ?? ''}`} confirmLabel="Zima akaunti" onClose={() => setOff(null)}
        message="Mtumishi atatolewa kwenye mfumo mara moja. Rekodi zake zote zinabaki. Nafasi itakuwa wazi hadi uweke mtu mwingine."
        onConfirm={async (c) => { await api(`/owner/amcos/${amcosId}/staff/${off!.id}/active`, { method: 'POST', body: { isActive: false, ...c } }); setOff(null); reload(); }} />
      <Modal open={!!secret} title="Nenosiri la muda" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Nimelinakili</Button>}>
        <p style={{ margin: 0 }}>Mpe <strong>{secret?.name}</strong> ({phone(secret?.phone)}) nenosiri hili. Ataombwa kulibadilisha akiingia mara ya kwanza.</p>
        <div className="secret">{secret?.password}</div>
        <Alert kind="warn">Linaonyeshwa mara moja tu.</Alert>
      </Modal>
    </Section>
  );
}

const STAFF_TITLE_OF = (r: string) => ({ AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Stokipa', AMCOS_VIEWER: 'Mtazamaji' } as Record<string, string>)[r] ?? r;

function AssignStaff({ amcosId, slot, onClose, onDone }: { amcosId: string; slot: Slot; onClose: () => void; onDone: (s: { name: string; phone: string; password: string }) => void }) {
  const [fullName, setFullName] = useState('');
  const [ph, setPh] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const replace = !!slot.holder;
  return (
    <Modal open title={replace ? `Badilisha ${slot.title}` : `Weka ${slot.title}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button variant={replace ? 'danger' : 'primary'} busy={busy} disabled={fullName.trim().length < 3 || !ph || (replace && !pw)} onClick={async () => {
        const r = await run(() => api<{ user: StaffUser; temporaryPassword: string }>(`/owner/amcos/${amcosId}/staff`, { method: 'POST', body: {
          role: slot.role, fullName, phone: ph, email: email || null, ...(replace ? { replace: true, confirmPassword: pw, confirmCode: code || undefined } : {}),
        } }));
        if (r) onDone({ name: r.user.fullName, phone: r.user.phone, password: r.temporaryPassword });
      }}>{replace ? 'Badilisha' : 'Unda akaunti'}</Button></>}>
      {replace && <Alert kind="warn"><strong>{slot.holder!.fullName}</strong> atazimwa (hafutwi) na kutolewa kwenye mfumo mara moja. Rekodi na audit zake zinabaki.</Alert>}
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina kamili *" value={fullName} onChange={setFullName} />
        <TextField label="Simu (ya kuingia) *" type="tel" value={ph} onChange={setPh} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
      </div>
      {replace && <div className="form-grid">
        <TextField label="Thibitisha kwa nenosiri lako *" type="password" autoComplete="current-password" value={pw} onChange={setPw} />
        <TextField label="Msimbo wa 2FA (kama umewashwa)" inputMode="numeric" value={code} onChange={setCode} />
      </div>}
    </Modal>
  );
}
