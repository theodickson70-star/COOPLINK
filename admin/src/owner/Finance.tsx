import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Alert, Button, Empty, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';
import { BarChart } from '../components/charts';
import { ConfirmDialog, DateRangeFilter, Kpi, LABELS, money, nfmt, Pill, presetRange, Section, Tabs, type Range } from '../components/owner-ui';

interface Payment {
  id: string; invoiceNo: string; amount: string; method: string; category: string; status: string; providerRef: string | null;
  paidAt: string; verifiedAt: string | null; failureReason: string | null; refundReason: string | null; periods: number; notes: string | null;
  amcos: { id: string; name: string; code: string } | null; recordedBy: string | null; verifiedBy: string | null; canVerify: boolean;
}
interface Expense {
  id: string; category: string; amount: string; description: string; vendor: string | null; spentAt: string; status: 'PENDING' | 'APPROVED' | 'REJECTED';
  method: string | null; reference: string | null; rejectReason: string | null; recordedBy: string | null; approvedBy: string | null; canApprove: boolean; createdAt: string;
}
interface Overview {
  month: string;
  revenue: { mtd: string; previousMonth: string; previousToDate: string; target: string | null };
  expenses: { mtd: string; pending: string; budget: string }; profitMtd: string;
  queue: { payments: { n: number; sum: string; canAct: number }; expenses: { n: number; sum: string; canAct: number } };
  receivables: { outstanding: string; overdue: string; overdueCount: number; dueSoon: number; debtors: number };
  collection: { label: string; due: string; paid: string; waived: string; rate: number | null } | null;
  byMethod: { method: string; total: string; n: number }[]; series: { month: string; revenue: string; expenses: string }[];
  topDebtors: { amcos_id: string; name: string; code: string; balance: string; oldest: string }[];
}
interface Report {
  revenue: { total: string; subscription: string; other: string; byCategory: { category: string; total: string; n: number }[] };
  refunds: { total: string; n: number }; expenses: { total: string; byCategory: { category: string; total: string; n: number }[] };
  profit: string; transactions: Record<'successful' | 'failed' | 'pending' | 'refunded', number>;
  outstanding: { pending_payments: string; overdue_subscriptions: string; overdue_count: number };
  series: { month: string; revenue: string; expenses: string }[];
}

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());

/** Kurekodi malipo — yanaanza PENDING kila mara; uthibitisho ni hatua tofauti. */
export function RecordPaymentModal({ subscription, onClose, onDone }: {
  subscription?: { id: string; cycle: string; price: string; amcosName: string }; onClose: () => void; onDone: () => void;
}) {
  const [category, setCategory] = useState(subscription ? 'SUBSCRIPTION' : 'OTHER');
  const [amount, setAmount] = useState(subscription ? String(Number(subscription.price) || '') : '');
  const [method, setMethod] = useState('MOBILE_MONEY');
  const [ref, setRef] = useState('');
  const [paidAt, setPaidAt] = useState(todayStr());
  const [periods, setPeriods] = useState('1');
  const [cycle, setCycle] = useState('MONTHLY');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/owner/finance/payments', {
      method: 'POST',
      body: {
        subscriptionId: category === 'SUBSCRIPTION' ? subscription?.id : null, category, amount, method, providerRef: ref || null, paidAt,
        periods: Number(periods), cycle: subscription?.cycle === 'TRIAL' ? cycle : null, notes: notes || null,
      },
    }));
    if (r) onDone();
  };
  return (
    <Modal open title={subscription ? `Rekodi malipo: ${subscription.amcosName}` : 'Rekodi mapato mengine'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!amount} onClick={save}>Rekodi (inasubiri uthibitisho)</Button></>}>
      <Alert kind="warn">Malipo yanarekodiwa kama <strong>Inasubiri</strong>. Yanahesabiwa kama mapato, na subscription inaongezewa muda, <strong>baada tu ya kuthibitishwa</strong> kwenye Finance.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        {!subscription && <SelectField label="Aina" value={category} onChange={setCategory} options={['SETUP', 'TRAINING', 'OTHER'].map((v) => ({ value: v, label: LABELS[v] }))} />}
        <TextField label="Kiasi (TSh) *" type="number" min="1" value={amount} onChange={setAmount} />
        <SelectField label="Njia" value={method} onChange={setMethod} options={['MOBILE_MONEY', 'BANK', 'CASH'].map((v) => ({ value: v, label: LABELS[v] }))} />
        <TextField label="Namba ya muamala" help="Huzuia malipo kurekodiwa mara mbili" value={ref} onChange={setRef} />
        <TextField label="Tarehe ya malipo" type="date" value={paidAt} onChange={setPaidAt} />
        {subscription && <TextField label="Vipindi vinavyolipiwa" type="number" min="1" max="36" value={periods} onChange={setPeriods} />}
        {subscription?.cycle === 'TRIAL' && <SelectField label="Anza kulipia kwa" value={cycle} onChange={setCycle} options={[{ value: 'MONTHLY', label: 'Kila mwezi' }, { value: 'ANNUAL', label: 'Kila mwaka' }]} />}
      </div>
      <TextField label="Maelezo" value={notes} onChange={setNotes} />
    </Modal>
  );
}

type FinTab = 'desk' | 'payments' | 'receivables' | 'expenses' | 'budgets' | 'statement' | 'report';
const FIN_TABS: [FinTab, string][] = [
  ['desk', 'Kazi zangu'], ['payments', 'Malipo'], ['receivables', 'Madeni ya ada'], ['expenses', 'Matumizi'],
  ['budgets', 'Bajeti'], ['statement', 'Taarifa ya mteja'], ['report', 'Ripoti'],
];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('sw-TZ', { month: 'long', year: 'numeric' });

/** FINANCE & REVENUE — kituo cha kazi cha Finance Manager (fedha za KAMPUNI pekee). */
export function OwnerFinance() {
  const { has } = useAuth();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('tab') as FinTab | null;
  const tab: FinTab = q && FIN_TABS.some(([k]) => k === q) ? q : 'desk';
  const go = (k: FinTab, extra?: Record<string, string>) => setSp({ ...(k === 'desk' ? {} : { tab: k }), ...(extra ?? {}) }, { replace: true });
  const manage = has('finance.manage');
  return (
    <div className="print-area">
      <PageHead title="Finance & Revenue" sub="Mapato na matumizi ya CoopLink pekee — fedha za vyama na wakulima hazichanganywi hapa" />
      <div className="no-print fin-tabs"><Tabs value={tab} onChange={(k) => go(k)} items={FIN_TABS} /></div>
      {tab === 'desk' && <FinanceDesk go={go} />}
      {tab === 'payments' && <Payments canManage={manage} initialStatus={sp.get('status') ?? ''} onChange={() => undefined} />}
      {tab === 'receivables' && <Receivables canManage={manage} go={go} />}
      {tab === 'expenses' && <Expenses canManage={manage} initialStatus={sp.get('status') ?? ''} />}
      {tab === 'budgets' && <Budgets canManage={manage} />}
      {tab === 'statement' && <Statement amcosId={sp.get('amcos')} onPick={(id) => go('statement', { amcos: id })} />}
      {tab === 'report' && <ReportView />}
    </div>
  );
}

// ------------------------------ KAZI ZANGU ------------------------------
function FinanceDesk({ go }: { go: (k: FinTab, extra?: Record<string, string>) => void }) {
  const { user, has } = useAuth();
  const { data: d, error, loading } = useFetch<Overview>('/owner/finance/overview');
  if (loading && !d) return <Loading />;
  if (!d) return <Alert>{error}</Alert>;
  const rev = Number(d.revenue.mtd), target = d.revenue.target ? Number(d.revenue.target) : null;
  const vsPrev = Number(d.revenue.previousToDate) > 0 ? Math.round(((rev - Number(d.revenue.previousToDate)) / Number(d.revenue.previousToDate)) * 100) : null;
  const budget = Number(d.expenses.budget), spent = Number(d.expenses.mtd);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Habari za asubuhi' : hour < 16 ? 'Habari za mchana' : 'Habari za jioni';
  return (
    <div className="stack">
      <div className="desk-hello">
        <div><h2>{hello}, {user?.fullName.split(' ')[0]}</h2><p className="muted">{monthLabel(d.month)} · kazi zinazokusubiri leo</p></div>
      </div>
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Mapato ya mwezi huu" value={money(d.revenue.mtd)}
          hint={target ? `${pct(rev, target)}% ya lengo (${money(target)})` : vsPrev !== null ? `${vsPrev >= 0 ? '+' : ''}${vsPrev}% dhidi ya mwezi uliopita` : 'Weka lengo kwenye Business Center'} />
        <Kpi tone={budget && spent > budget ? 'bad' : undefined} label="Matumizi ya mwezi" value={money(d.expenses.mtd)}
          hint={budget ? `${pct(spent, budget)}% ya bajeti (${money(budget)})` : 'Bajeti ya mwezi haijawekwa'} />
        <Kpi tone={Number(d.profitMtd) < 0 ? 'bad' : 'gold'} label="Faida ya mwezi" value={money(d.profitMtd)} hint="Mapato − matumizi yaliyoidhinishwa" />
        <Kpi tone={d.receivables.overdueCount ? 'warn' : undefined} label="Madeni yaliyopita muda" value={money(d.receivables.overdue)}
          hint={`${d.receivables.overdueCount} ada · jumla ya madeni ${money(d.receivables.outstanding)}`} />
      </div>
      <div className="desk-queue">
        <button type="button" className={`dq ${d.queue.payments.canAct ? 'hot' : ''}`} onClick={() => go('payments', { status: 'PENDING' })}>
          <span className="dq-n">{d.queue.payments.n}</span>
          <span className="dq-t"><b>Malipo yanasubiri uthibitisho</b><span>{money(d.queue.payments.sum)}{d.queue.payments.n > d.queue.payments.canAct ? ` · ${d.queue.payments.n - d.queue.payments.canAct} uliyorekodi wewe (mtu wa pili athibitishe)` : ''}</span></span>
        </button>
        <button type="button" className={`dq ${d.queue.expenses.canAct ? 'hot' : ''}`} onClick={() => go('expenses', { status: 'PENDING' })}>
          <span className="dq-n">{d.queue.expenses.n}</span>
          <span className="dq-t"><b>Matumizi yanasubiri idhini</b><span>{money(d.queue.expenses.sum)}{d.queue.expenses.n > d.queue.expenses.canAct ? ` · ${d.queue.expenses.n - d.queue.expenses.canAct} ni yako` : ''}</span></span>
        </button>
        <button type="button" className={`dq ${d.receivables.dueSoon ? 'warm' : ''}`} onClick={() => go('receivables', {})}>
          <span className="dq-n">{d.receivables.dueSoon}</span>
          <span className="dq-t"><b>Ada zinaisha ndani ya siku 7</b><span>Wakumbushe mapema — chama kinafungwa tarehe ikipita</span></span>
        </button>
        <button type="button" className="dq" onClick={() => go('budgets')}>
          <span className="dq-n">{budget ? `${pct(spent, budget)}%` : '—'}</span>
          <span className="dq-t"><b>Bajeti ya mwezi</b><span>{budget ? `${money(spent)} kati ya ${money(budget)}` : 'Weka bajeti ya kila aina ya matumizi'}</span></span>
        </button>
      </div>

      <div className="grid grid-2">
        <Section title="Wadaiwa wakubwa" actions={<Button size="sm" variant="ghost" onClick={() => go('receivables')}>Madeni yote →</Button>}>
          {d.topDebtors.length === 0 ? <Empty>Hakuna madeni ya ada. Kazi nzuri! 🎉</Empty> : (
            <ul className="desk-list">
              {d.topDebtors.map((x) => (
                <li key={x.amcos_id}>
                  <span className="grow"><b>{x.name}</b><span className="muted">{x.code} · mwisho wa mapema {date(x.oldest)}</span></span>
                  <strong>{money(x.balance)}</strong>
                  <Button size="sm" variant="ghost" onClick={() => go('statement', { amcos: x.amcos_id })}>Taarifa</Button>
                </li>
              ))}
            </ul>
          )}
          {has('finance.manage') && d.topDebtors.length > 0 && <p className="muted st-small">Kukumbusha: chagua madeni kwenye "Madeni ya ada" — chama kimoja hakisumbuliwi zaidi ya mara moja kwa saa 24.</p>}
        </Section>
        <Section title={d.collection ? `Ukusanyaji: ${d.collection.label}` : 'Ukusanyaji wa ada ya msimu'}>
          {!d.collection ? <Empty>Bado hakuna ada ya msimu iliyotozwa.</Empty> : (
            <>
              <div className="st-meter-top"><strong>{d.collection.rate ?? 0}%</strong><span>{money(d.collection.paid)} kati ya {money(d.collection.due)}</span></div>
              <div className={`st-prog ${Number(d.collection.rate) < 50 ? 'warn' : ''}`}><i style={{ width: `${Math.min(100, d.collection.rate ?? 0)}%` }} /></div>
              {Number(d.collection.waived) > 0 && <p className="muted st-small">Zilizosamehewa: {money(d.collection.waived)}</p>}
            </>
          )}
          <h3 className="desk-h3">Mapato ya mwezi kwa njia</h3>
          {d.byMethod.length === 0 ? <p className="muted st-small">Hakuna mapato yaliyothibitishwa mwezi huu bado.</p> : (
            <table className="table"><tbody>{d.byMethod.map((m) => <tr key={m.method}><td>{LABELS[m.method] ?? m.method}</td><td className="num muted">{m.n}</td><td className="num">{money(m.total)}</td></tr>)}</tbody></table>
          )}
        </Section>
      </div>
      <Section title="Mapato na matumizi (miezi 6)">
        <BarChart title="Mapato na matumizi kwa mwezi" data={d.series} xKey="month"
          series={[{ key: 'revenue', label: 'Mapato', color: '#1F7A52' }, { key: 'expenses', label: 'Matumizi', color: '#E3A83A' }]} />
      </Section>
    </div>
  );
}

// ------------------------------ MALIPO ------------------------------
function Payments({ canManage, initialStatus, onChange }: { canManage: boolean; initialStatus: string; onChange: () => void }) {
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<Paged<Payment>>('/owner/finance/payments', { status, page, pageSize: 25 });
  const [sel, setSel] = useState<{ p: Payment; kind: 'verify' | 'fail' | 'refund' } | null>(null);
  const [other, setOther] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAction();
  const close = () => { setSel(null); setReason(''); };
  const done = () => { close(); reload(); onChange(); };
  return (
    <section className="card">
      <div className="toolbar">
        <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Hali zote</option><option value="PENDING">Yanasubiri</option><option value="VERIFIED">Yamethibitishwa</option>
          <option value="FAILED">Yameshindwa</option><option value="REFUNDED">Yamerudishwa</option>
        </Select>
        {canManage && <Button variant="secondary" onClick={() => setOther(true)}>+ Mapato mengine</Button>}
      </div>
      <div className="fin-note">🔐 Malipo uliyorekodi wewe yanathibitishwa na <strong>mtu wa pili</strong> (mfanyakazi mwingine wa fedha au Owner). Hii inalinda pesa za kampuni.</div>
      <Alert>{error ?? act.error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna malipo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ankara</th><th>Tarehe</th><th>AMCOS</th><th>Aina</th><th>Njia / Kumbukumbu</th><th className="num">Kiasi</th><th>Hali</th><th /></tr></thead>
          <tbody>{data?.data.map((p) => (
            <tr key={p.id}>
              <td data-label="Ankara"><strong>{p.invoiceNo}</strong><div className="muted st-small">{p.recordedBy ? `Amerekodi: ${p.recordedBy}` : 'Mfumo (TeePay)'}</div></td>
              <td data-label="Tarehe">{date(p.paidAt)}</td><td data-label="AMCOS">{p.amcos?.name ?? '—'}</td>
              <td data-label="Aina"><Pill value={p.category} />{p.periods > 1 ? <span className="muted"> ×{p.periods}</span> : null}</td>
              <td data-label="Njia">{LABELS[p.method]}<div className="muted st-small">{p.providerRef ?? '—'}</div></td>
              <td data-label="Kiasi" className="num">{money(p.amount)}</td>
              <td data-label="Hali"><Pill value={p.status} />
                {p.verifiedBy && <div className="muted st-small">na {p.verifiedBy}</div>}
                {(p.failureReason || p.refundReason) && <div className="muted st-small">{p.failureReason ?? p.refundReason}</div>}</td>
              <td className="num">{canManage && (
                <span className="actions" style={{ justifyContent: 'flex-end' }}>
                  {p.status === 'PENDING' && (p.canVerify
                    ? <><Button size="sm" onClick={() => setSel({ p, kind: 'verify' })}>Thibitisha</Button><Button size="sm" variant="ghost" onClick={() => setSel({ p, kind: 'fail' })}>Kataa</Button></>
                    : <span className="badge badge-neutral" title="Uliyarekodi wewe — mtu wa pili athibitishe">Mtu wa pili athibitishe</span>)}
                  {p.status === 'VERIFIED' && <Button size="sm" variant="ghost" onClick={() => setSel({ p, kind: 'refund' })}>Rudisha</Button>}
                </span>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      <ConfirmDialog open={sel?.kind === 'verify'} title={`Thibitisha ${sel?.p.invoiceNo}?`} confirmLabel="Nimethibitisha, pesa imeingia" onClose={close}
        message={<>Hakikisha <strong>{money(sel?.p.amount)}</strong> imeingia kweli kwenye akaunti ya kampuni ({sel ? LABELS[sel.p.method] : ''}{sel?.p.providerRef ? ` · ${sel.p.providerRef}` : ''}). Ikithibitishwa, subscription itaongezewa muda na chama kilichositishwa kwa kuisha kwa subscription kitawashwa.</>}
        onConfirm={async (c) => { await api(`/owner/finance/payments/${sel!.p.id}/verify`, { method: 'POST', body: c }); done(); }} />
      <ConfirmDialog open={sel?.kind === 'refund'} danger title={`Rudisha ${sel?.p.invoiceNo}?`} confirmLabel="Rekodi marejesho" onClose={close}
        message="Marejesho yanaondolewa kwenye faida. Muda wa subscription haupunguzwi wenyewe; ukihitaji, ufute au uubadilishe kwenye Subscriptions."
        onConfirm={async (c) => { await api(`/owner/finance/payments/${sel!.p.id}/refund`, { method: 'POST', body: { reason, ...c } }); done(); }}>
        <TextField label="Sababu *" value={reason} onChange={setReason} />
      </ConfirmDialog>
      {sel?.kind === 'fail' && (
        <Modal open title={`Kataa ${sel.p.invoiceNo}`} onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button variant="danger" busy={act.busy} disabled={reason.trim().length < 3} onClick={async () => { if (await act.run(() => api(`/owner/finance/payments/${sel.p.id}/fail`, { method: 'POST', body: { reason } }))) done(); }}>Kataa</Button></>}>
          <TextField label="Sababu *" placeholder="mf. Muamala haukupatikana" value={reason} onChange={setReason} />
        </Modal>
      )}
      {other && <RecordPaymentModal onClose={() => setOther(false)} onDone={() => { setOther(false); reload(); onChange(); }} />}
    </section>
  );
}

// ------------------------------ MADENI YA ADA ------------------------------
interface Recv {
  id: string; amcos_id: string; amcos_name: string; amcos_code: string; amcos_status: string; kind: string; label: string; amount: string; paid: string;
  balance: string; due_date: string; status: string; days_overdue: number; bucket: string; last_reminder_at: string | null;
  manager: string | null; accountant: string | null; phone: string | null;
}
const BUCKETS: [string, string][] = [['CURRENT', 'Bado muda'], ['D1_30', 'Siku 1–30'], ['D31_60', 'Siku 31–60'], ['D61_90', 'Siku 61–90'], ['D90_PLUS', 'Zaidi ya siku 90']];

function Receivables({ canManage, go }: { canManage: boolean; go: (k: FinTab, extra?: Record<string, string>) => void }) {
  const [bucket, setBucket] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useFetch<{ data: Recv[]; buckets: { bucket: string; total: string; n: number }[];
    collection: { label: string; kind: string; due_date: string; fees: number; billed: string; collected: string; waived: string; paid_n: number; open_n: number }[];
    overdueSubscriptions: { total: string; n: number } }>('/owner/finance/receivables', { bucket: bucket || undefined, q: dq || undefined });
  const [sel, setSel] = useState<string[]>([]);
  const act = useAction();
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => setSel([]), [bucket, dq]);
  const total = (data?.buckets ?? []).reduce((s, b) => s + Number(b.total), 0);
  const remind = async (ids: string[]) => {
    setOk(null);
    const r = await act.run(() => api<{ targets: number; skipped: string[] }>('/owner/finance/receivables/remind', { method: 'POST', body: { feeIds: ids } }));
    if (r) { setOk(`Ukumbusho umetumwa kwa vyama ${r.targets}.${r.skipped.length ? ` Vimerukwa (vimekumbushwa ndani ya saa 24): ${r.skipped.join(', ')}.` : ''}`); setSel([]); reload(); }
  };
  return (
    <div className="stack">
      <AutoReminders canManage={canManage} />
      <div className="aging">
        <button type="button" className={!bucket ? 'on' : ''} onClick={() => setBucket('')}><span>Madeni yote</span><strong>{money(total)}</strong></button>
        {BUCKETS.map(([k, label]) => {
          const b = data?.buckets.find((x) => x.bucket === k);
          return <button key={k} type="button" className={`${bucket === k ? 'on' : ''} ${k !== 'CURRENT' && b?.n ? 'late' : ''}`} onClick={() => setBucket(k)}>
            <span>{label}</span><strong>{money(b?.total ?? 0)}</strong><small>{b?.n ?? 0} ada</small></button>;
        })}
      </div>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error ?? act.error}</Alert>
      <section className="card">
        <div className="toolbar">
          <input className="input" placeholder="Tafuta chama au code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta chama" />
          {canManage && <Button disabled={!sel.length} busy={act.busy} onClick={() => remind(sel)}>Tuma ukumbusho ({sel.length})</Button>}
        </div>
        {loading && !data ? <Loading /> : !data?.data.length ? <Empty>Hakuna madeni kwenye kundi hili.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr>
              {canManage && <th style={{ width: 32 }}><input type="checkbox" aria-label="Chagua yote" checked={sel.length === data.data.length} onChange={(e) => setSel(e.target.checked ? data.data.map((x) => x.id) : [])} /></th>}
              <th>Chama</th><th>Ada</th><th>Mwisho</th><th className="num">Deni</th><th>Umri</th><th>Ukumbusho wa mwisho</th><th />
            </tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id}>
                {canManage && <td><input type="checkbox" aria-label={`Chagua ${r.amcos_name}`} checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>}
                <td data-label="Chama"><strong>{r.amcos_name}</strong><div className="muted st-small">{r.amcos_code}{r.accountant ? ` · Mhasibu: ${r.accountant}` : r.manager ? ` · Meneja: ${r.manager}` : ''}</div></td>
                <td data-label="Ada">{r.label}{Number(r.paid) > 0 && <div className="muted st-small">Amelipa {money(r.paid)} kati ya {money(r.amount)}</div>}</td>
                <td data-label="Mwisho">{date(r.due_date)}</td>
                <td data-label="Deni" className="num"><strong>{money(r.balance)}</strong></td>
                <td data-label="Umri">{r.bucket === 'CURRENT' ? <Pill value="ACTIVE" label="Bado muda" /> : <Pill value={r.days_overdue > 60 ? 'FAILED' : 'PENDING'} label={`Siku ${r.days_overdue}`} />}</td>
                <td data-label="Ukumbusho">{r.last_reminder_at ? dateTime(r.last_reminder_at) : <span className="muted">Hajakumbushwa</span>}</td>
                <td className="num"><Button size="sm" variant="ghost" onClick={() => go('statement', { amcos: r.amcos_id })}>Taarifa</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <Section title="Ukusanyaji kwa kila ada">
        {!data?.collection.length ? <Empty>Bado hakuna ada iliyotozwa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ada</th><th className="num">Vyama</th><th className="num">Imetozwa</th><th className="num">Imekusanywa</th><th>Kiwango</th><th className="num">Imesamehewa</th></tr></thead>
            <tbody>{data.collection.map((c) => {
              const r = pct(Number(c.collected), Number(c.billed)) ?? 0;
              return <tr key={c.label}>
                <td data-label="Ada"><strong>{c.label}</strong><div className="muted st-small">{c.kind === 'SEASON' ? 'Ada ya msimu' : 'Kingilio'} · mwisho {date(c.due_date)}</div></td>
                <td data-label="Vyama" className="num">{c.paid_n}/{c.fees}</td>
                <td data-label="Imetozwa" className="num">{money(c.billed)}</td>
                <td data-label="Imekusanywa" className="num">{money(c.collected)}</td>
                <td data-label="Kiwango" style={{ minWidth: 140 }}><div className={`st-prog ${r < 50 ? 'warn' : ''}`} style={{ margin: 0 }}><i style={{ width: `${r}%` }} /></div><span className="st-small">{r}%</span></td>
                <td data-label="Imesamehewa" className="num">{money(c.waived)}</td>
              </tr>;
            })}</tbody>
          </table></div>
        )}
        {data && data.overdueSubscriptions.n > 0 && <p className="muted st-small">Pia: subscriptions {data.overdueSubscriptions.n} za zamani zimepita muda ({money(data.overdueSubscriptions.total)}) — angalia Subscriptions.</p>}
      </Section>
    </div>
  );
}

// ------------------------------ MATUMIZI ------------------------------
const EXP_CATS = ['SERVER', 'SMS', 'SALARY', 'MARKETING', 'OFFICE', 'TRANSPORT', 'OTHER'];

function Expenses({ canManage, initialStatus }: { canManage: boolean; initialStatus: string }) {
  const { user } = useAuth();
  const [range, setRange] = useState<Range>(presetRange('month'));
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<Paged<Expense>>('/owner/finance/expenses', { from: range.from, to: range.to, status: status || undefined, page, pageSize: 25 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'SERVER', amount: '', description: '', vendor: '', spentAt: todayStr(), method: 'MOBILE_MONEY', reference: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [rej, setRej] = useState<Expense | null>(null);
  const [reason, setReason] = useState('');
  const act = useAction();
  const owner = user?.role === 'SUPER_ADMIN';
  const decide = async (e: Expense, approve: boolean, why?: string) => {
    if (await act.run(() => api(`/owner/finance/expenses/${e.id}/decision`, { method: 'POST', body: { approve, reason: why } }))) { setRej(null); setReason(''); reload(); }
  };
  return (
    <section className="card">
      <div className="toolbar">
        <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Hali zote</option><option value="PENDING">Yanasubiri idhini</option><option value="APPROVED">Yameidhinishwa</option><option value="REJECTED">Yamekataliwa</option>
        </Select>
        {status !== 'PENDING' && <DateRangeFilter value={range} onChange={setRange} />}
        {canManage && <Button onClick={() => setOpen(true)}>+ Rekodi matumizi</Button>}
      </div>
      <Alert>{error ?? act.error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna matumizi kwenye kundi hili.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tarehe</th><th>Aina</th><th>Maelezo</th><th>Njia / Kumbukumbu</th><th className="num">Kiasi</th><th>Hali</th><th /></tr></thead>
          <tbody>{data?.data.map((e) => (
            <tr key={e.id}>
              <td data-label="Tarehe">{date(e.spentAt)}</td>
              <td data-label="Aina"><Pill value={e.category} /></td>
              <td data-label="Maelezo">{e.description}<div className="muted st-small">{e.vendor ?? ''}{e.recordedBy ? `${e.vendor ? ' · ' : ''}Amerekodi: ${e.recordedBy}` : ''}</div></td>
              <td data-label="Njia">{e.method ? LABELS[e.method] : '—'}<div className="muted st-small">{e.reference ?? ''}</div></td>
              <td data-label="Kiasi" className="num">{money(e.amount)}</td>
              <td data-label="Hali"><Pill value={e.status} label={e.status === 'PENDING' ? 'Inasubiri idhini' : undefined} />
                {e.approvedBy && e.status !== 'PENDING' && <div className="muted st-small">na {e.approvedBy}</div>}
                {e.rejectReason && <div className="muted st-small">{e.rejectReason}</div>}</td>
              <td className="num">{canManage && e.status === 'PENDING' && (e.canApprove
                ? <span className="actions" style={{ justifyContent: 'flex-end' }}><Button size="sm" busy={act.busy} onClick={() => decide(e, true)}>Idhinisha</Button><Button size="sm" variant="ghost" onClick={() => setRej(e)}>Kataa</Button></span>
                : <span className="badge badge-neutral">Mtu wa pili aidhinishe</span>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      {open && (
        <Modal open title="Rekodi matumizi" onClose={() => setOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Ghairi</Button><Button busy={act.busy} disabled={!f.amount || f.description.length < 3} onClick={async () => {
            if (await act.run(() => api('/owner/finance/expenses', { method: 'POST', body: { ...f, vendor: f.vendor || null, reference: f.reference || null } }))) { setOpen(false); setF({ ...f, amount: '', description: '', vendor: '', reference: '' }); reload(); }
          }}>{owner ? 'Hifadhi' : 'Hifadhi (inasubiri idhini)'}</Button></>}>
          <Alert>{act.error}</Alert>
          {!owner && <Alert kind="warn">Matumizi yanahesabiwa kwenye ripoti <strong>baada ya kuidhinishwa</strong> na mtu wa pili (Owner au mfanyakazi mwingine wa fedha).</Alert>}
          <div className="form-grid">
            <SelectField label="Aina" value={f.category} onChange={set('category')} options={EXP_CATS.map((v) => ({ value: v, label: LABELS[v] }))} />
            <TextField label="Kiasi (TSh) *" type="number" min="1" value={f.amount} onChange={set('amount')} />
            <TextField label="Tarehe" type="date" value={f.spentAt} max={todayStr()} onChange={set('spentAt')} />
            <TextField label="Mtoa huduma" value={f.vendor} onChange={set('vendor')} />
            <SelectField label="Njia ya malipo" value={f.method} onChange={set('method')} options={['MOBILE_MONEY', 'BANK', 'CASH'].map((v) => ({ value: v, label: LABELS[v] }))} />
            <TextField label="Namba ya muamala / risiti" value={f.reference} onChange={set('reference')} />
          </div>
          <TextField label="Maelezo *" value={f.description} onChange={set('description')} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Kumbukumbu za matumizi hazifutwi. Kosa linasahihishwa kwa kurekodi marekebisho.</p>
        </Modal>
      )}
      {rej && (
        <Modal open title="Kataa matumizi" onClose={() => setRej(null)}
          footer={<><Button variant="secondary" onClick={() => setRej(null)}>Ghairi</Button><Button variant="danger" busy={act.busy} disabled={reason.trim().length < 3} onClick={() => decide(rej, false, reason)}>Kataa</Button></>}>
          <p>{rej.description} · <strong>{money(rej.amount)}</strong></p>
          <TextField label="Sababu *" placeholder="mf. Risiti haijaambatishwa" value={reason} onChange={setReason} />
        </Modal>
      )}
    </section>
  );
}

// ------------------------------ BAJETI ------------------------------
interface BudgetView { month: string; previousMonth: string; items: { category: string; budget: string | null; previous: string | null; actual: string; pending: string; used: number | null }[]; totals: { budget: string; actual: string; pending: string } }

function Budgets({ canManage }: { canManage: boolean }) {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const { data, error, loading, reload } = useFetch<BudgetView>('/owner/finance/budgets', { month });
  const base = useMemo(() => Object.fromEntries((data?.items ?? []).map((i) => [i.category, i.budget === null ? '' : String(Number(i.budget))])), [data]);
  const [v, setV] = useState<Record<string, string>>({});
  useEffect(() => setV(base), [base]);
  const dirty = JSON.stringify(v) !== JSON.stringify(base);
  const act = useAction();
  const [ok, setOk] = useState<string | null>(null);
  const save = async () => {
    const items = Object.entries(v).filter(([k, x]) => x !== '' && x !== base[k]).map(([category, amount]) => ({ category, amount }));
    if (!items.length) return;
    if (await act.run(() => api('/owner/finance/budgets', { method: 'PUT', body: { month, items } }))) { setOk('Bajeti imehifadhiwa.'); reload(); }
  };
  return (
    <div className="stack">
      <section className="card">
        <div className="toolbar">
          <input className="input" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Mwezi" style={{ maxWidth: 200 }} />
          {canManage && data && <Button variant="ghost" onClick={() => setV(Object.fromEntries(data.items.map((i) => [i.category, i.previous === null ? (v[i.category] ?? '') : String(Number(i.previous))])))}>Nakili ya {monthLabel(data.previousMonth)}</Button>}
        </div>
        <Alert>{error ?? act.error}</Alert>
        <Alert kind="ok">{ok}</Alert>
        {loading && !data ? <Loading /> : data && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Aina</th><th className="num">Bajeti</th><th className="num">Halisi</th><th className="num">Inasubiri idhini</th><th>Matumizi ya bajeti</th></tr></thead>
            <tbody>{data.items.map((i) => {
              const u = i.used ?? 0;
              return <tr key={i.category}>
                <td data-label="Aina"><strong>{LABELS[i.category] ?? i.category}</strong>{i.previous !== null && <div className="muted st-small">Mwezi uliopita: {money(i.previous)}</div>}</td>
                <td data-label="Bajeti" className="num">{canManage
                  ? <input className="input st-num" type="number" min="0" inputMode="decimal" placeholder="—" aria-label={`Bajeti ya ${LABELS[i.category]}`} value={v[i.category] ?? ''} onChange={(e) => setV({ ...v, [i.category]: e.target.value })} />
                  : i.budget === null ? '—' : money(i.budget)}</td>
                <td data-label="Halisi" className="num">{money(i.actual)}</td>
                <td data-label="Inasubiri" className="num muted">{Number(i.pending) ? money(i.pending) : '—'}</td>
                <td data-label="Matumizi" style={{ minWidth: 160 }}>{i.used === null ? <span className="muted st-small">Hakuna bajeti</span> : <>
                  <div className={`st-prog ${u > 100 ? 'bad' : u > 85 ? 'warn' : ''}`} style={{ margin: 0 }}><i style={{ width: `${Math.min(100, u)}%` }} /></div>
                  <span className={`st-small ${u > 100 ? 'money-neg' : ''}`}>{u}%{u > 100 ? ' — imezidi bajeti' : ''}</span></>}</td>
              </tr>;
            })}
            <tr className="total-row"><td><strong>Jumla</strong></td><td className="num"><strong>{money(data.totals.budget)}</strong></td><td className="num"><strong>{money(data.totals.actual)}</strong></td><td className="num">{money(data.totals.pending)}</td><td /></tr>
            </tbody>
          </table></div>
        )}
        {canManage && <div className={`st-save ${dirty ? 'dirty' : ''}`}><span>{dirty ? 'Una mabadiliko ambayo hayajahifadhiwa' : 'Hakuna mabadiliko'}</span>
          <div className="actions">{dirty && <Button variant="ghost" onClick={() => setV(base)}>Rudisha</Button>}<Button busy={act.busy} disabled={!dirty} onClick={save}>Hifadhi bajeti</Button></div></div>}
      </section>
    </div>
  );
}

// ------------------------------ TAARIFA YA MTEJA ------------------------------
interface StatementData {
  amcos: { id: string; name: string; code: string; region: string | null; district: string | null; status: string; createdAt: string };
  fees: { id: string; label: string; kind: string; dueDate: string; amount: string; paid: string; status: string }[];
  payments: { id: string; invoiceNo: string; paidAt: string; category: string; method: string; providerRef: string | null; amount: string; status: string }[];
  totals: { billed: string; waived: string; paid: string; refunded: string; balance: string }; generatedAt: string;
}
function Statement({ amcosId, onPick }: { amcosId: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const list = useFetch<Paged<{ id: string; name: string; code: string }>>(!amcosId || dq ? '/owner/amcos' : null, { search: dq || undefined, pageSize: 12 });
  const { data: s, error, loading } = useFetch<StatementData>(amcosId ? `/owner/finance/statement/${amcosId}` : null);
  const act = useAction();
  return (
    <div className="stack">
      <section className="card no-print">
        <div className="toolbar">
          <input className="input" placeholder="Tafuta chama kwa jina au code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta chama" />
          {s && <>
            <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => apiDownload(`/owner/finance/statement/${s.amcos.id}/csv`, { filename: `taarifa-${s.amcos.code}.csv` }))}>Pakua Excel (CSV)</Button>
            <Button variant="secondary" onClick={() => window.print()}>Chapisha / PDF</Button>
          </>}
        </div>
        {(dq || !amcosId) && (list.data?.data.length ? (
          <ul className="desk-list">{list.data.data.map((a) => <li key={a.id}><span className="grow"><b>{a.name}</b><span className="muted">{a.code}</span></span><Button size="sm" variant="ghost" onClick={() => { setQ(''); onPick(a.id); }}>Fungua taarifa</Button></li>)}</ul>
        ) : <p className="muted st-small" style={{ padding: '0 16px 16px' }}>Chagua chama kuona ada, malipo na salio lake.</p>)}
      </section>
      <Alert>{error ?? act.error}</Alert>
      {amcosId && loading && !s ? <Loading /> : s && (
        <section className="card card-pad statement">
          <div className="stmt-head">
            <div><h2>Taarifa ya Mteja</h2><p className="muted">CoopLink · {dateTime(s.generatedAt)}</p></div>
            <div style={{ textAlign: 'right' }}><strong>{s.amcos.name}</strong><div className="muted">{s.amcos.code}{s.amcos.district ? ` · ${s.amcos.district}` : ''}</div><Pill value={s.amcos.status} /></div>
          </div>
          <div className="grid grid-kpi">
            <Kpi label="Ada zilizotozwa" value={money(s.totals.billed)} />
            <Kpi label="Malipo yaliyothibitishwa" value={money(s.totals.paid)} />
            <Kpi label="Zilizosamehewa" value={money(s.totals.waived)} />
            <Kpi tone={Number(s.totals.balance) > 0 ? 'warn' : 'gold'} label="Salio linalodaiwa" value={money(s.totals.balance)} />
          </div>
          <h3 className="desk-h3">Ada</h3>
          {s.fees.length === 0 ? <p className="muted">Hakuna ada.</p> : <div className="table-wrap"><table className="table">
            <thead><tr><th>Ada</th><th>Mwisho</th><th className="num">Kiasi</th><th className="num">Imelipwa</th><th>Hali</th></tr></thead>
            <tbody>{s.fees.map((f) => <tr key={f.id}><td>{f.label}</td><td>{date(f.dueDate)}</td><td className="num">{money(f.amount)}</td><td className="num">{money(f.paid)}</td><td><Pill value={f.status === 'UNPAID' ? 'PENDING' : f.status === 'PAID' ? 'VERIFIED' : f.status === 'WAIVED' ? 'CANCELLED' : 'PAST_DUE'} label={{ UNPAID: 'Haijalipwa', PARTIAL: 'Sehemu', PAID: 'Imelipwa', WAIVED: 'Imesamehewa' }[f.status] ?? f.status} /></td></tr>)}</tbody>
          </table></div>}
          <h3 className="desk-h3">Malipo</h3>
          {s.payments.length === 0 ? <p className="muted">Hakuna malipo.</p> : <div className="table-wrap"><table className="table">
            <thead><tr><th>Risiti</th><th>Tarehe</th><th>Njia</th><th>Kumbukumbu</th><th className="num">Kiasi</th><th>Hali</th></tr></thead>
            <tbody>{s.payments.map((p) => <tr key={p.id}><td>{p.invoiceNo}</td><td>{date(p.paidAt)}</td><td>{LABELS[p.method] ?? p.method}</td><td className="muted">{p.providerRef ?? '—'}</td><td className="num">{money(p.amount)}</td><td><Pill value={p.status} /></td></tr>)}</tbody>
          </table></div>}
          <p className="muted st-small no-print"><Link to={`/owner/amcos/${s.amcos.id}`}>Fungua wasifu wa chama →</Link></p>
        </section>
      )}
    </div>
  );
}

// ------------------------------ RIPOTI ------------------------------
function ReportView() {
  const [range, setRange] = useState<Range>(presetRange('month'));
  const rep = useFetch<Report>('/owner/finance/report', { from: range.from, to: range.to });
  const r = rep.data;
  return (
    <div className="stack">
      <div className="toolbar no-print" style={{ padding: 0 }}><DateRangeFilter value={range} onChange={setRange} /></div>
      <Alert>{rep.error}</Alert>
      {rep.loading && !r ? <Loading /> : r && (
        <>
          <div className="grid grid-kpi">
            <Kpi tone="dark" label="Mapato yaliyothibitishwa" value={money(r.revenue.total)} hint={`${range.from} → ${range.to}`} />
            <Kpi label="Subscriptions" value={money(r.revenue.subscription)} />
            <Kpi label="Mapato mengine (ada n.k.)" value={money(r.revenue.other)} />
            <Kpi label="Matumizi yaliyoidhinishwa" value={money(r.expenses.total)} />
            <Kpi tone={Number(r.profit) < 0 ? 'bad' : 'gold'} label="Faida / Hasara" value={money(r.profit)} hint={`Baada ya marejesho ${money(r.refunds.total)}`} />
          </div>
          <div className="grid grid-kpi">
            <Kpi label="Malipo yaliyofanikiwa" value={nfmt(r.transactions.successful)} />
            <Kpi tone={r.transactions.pending ? 'warn' : undefined} label="Yanasubiri uthibitisho" value={nfmt(r.transactions.pending)} hint={money(r.outstanding.pending_payments)} />
            <Kpi tone={r.transactions.failed ? 'bad' : undefined} label="Yaliyoshindwa" value={nfmt(r.transactions.failed)} />
            <Kpi label="Yaliyorudishwa" value={nfmt(r.transactions.refunded)} />
          </div>
          <Section title="Mapato na matumizi (miezi 12)">
            <BarChart title="Mapato na matumizi kwa mwezi" data={r.series} xKey="month"
              series={[{ key: 'revenue', label: 'Mapato', color: '#1F7A52' }, { key: 'expenses', label: 'Matumizi', color: '#E3A83A' }]} />
          </Section>
          <ReportTab r={r} range={range} />
        </>
      )}
    </div>
  );
}

function ReportTab({ r, range }: { r: Report; range: Range }) {
  const act = useAction();
  return (
    <div className="stack">
      <div className="actions no-print">
        <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => apiDownload('/owner/finance/export.csv', { query: { from: range.from, to: range.to }, filename: 'cooplink-fedha.csv' }))}>Pakua Excel (CSV)</Button>
        <Button variant="secondary" onClick={() => window.print()}>Chapisha / Hifadhi PDF</Button>
      </div>
      <Alert>{act.error}</Alert>
      <div className="grid grid-2">
        <Section title="Mapato kwa aina">
          <table className="table"><tbody>
            {r.revenue.byCategory.length === 0 && <tr><td className="muted">Hakuna mapato kwenye kipindi hiki.</td></tr>}
            {r.revenue.byCategory.map((c) => <tr key={c.category}><td>{LABELS[c.category] ?? c.category}</td><td className="num">{c.n}</td><td className="num">{money(c.total)}</td></tr>)}
            <tr><td><strong>Jumla</strong></td><td /><td className="num"><strong>{money(r.revenue.total)}</strong></td></tr>
          </tbody></table>
        </Section>
        <Section title="Matumizi kwa aina">
          <table className="table"><tbody>
            {r.expenses.byCategory.length === 0 && <tr><td className="muted">Hakuna matumizi kwenye kipindi hiki.</td></tr>}
            {r.expenses.byCategory.map((c) => <tr key={c.category}><td>{LABELS[c.category] ?? c.category}</td><td className="num">{c.n}</td><td className="num">{money(c.total)}</td></tr>)}
            <tr><td><strong>Jumla</strong></td><td /><td className="num"><strong>{money(r.expenses.total)}</strong></td></tr>
          </tbody></table>
        </Section>
      </div>
      <Section title={`Faida na hasara · ${range.from} → ${range.to}`}>
        <table className="table"><tbody>
          <tr><td>Mapato yaliyothibitishwa</td><td className="num">{money(r.revenue.total)}</td></tr>
          <tr><td>Marejesho</td><td className="num">− {money(r.refunds.total)}</td></tr>
          <tr><td>Matumizi</td><td className="num">− {money(r.expenses.total)}</td></tr>
          <tr><td><strong>Faida / Hasara</strong></td><td className={`num ${Number(r.profit) < 0 ? 'money-neg' : 'money-pos'}`}><strong>{money(r.profit)}</strong></td></tr>
        </tbody></table>
      </Section>
    </div>
  );
}

/** v0.38: vikumbusho vya ada kiotomatiki (siku 14 na 3 kabla, siku 1 baada) */
function AutoReminders({ canManage }: { canManage: boolean }) {
  const { data, reload } = useFetch<{ feesAuto: boolean; schedule: string[]; lastAuto: string | null; auto30d: number }>('/owner/finance/reminders');
  const act = useAction();
  if (!data) return null;
  const toggle = async () => { if (await act.run(() => api('/owner/finance/reminders', { method: 'PUT', body: { feesAuto: !data.feesAuto } }))) reload(); };
  return (
    <div className={`auto-rem ${data.feesAuto ? 'on' : ''}`}>
      <span className="auto-rem-ic" aria-hidden="true">⏰</span>
      <div className="grow">
        <b>Vikumbusho vya ada kiotomatiki: {data.feesAuto ? 'VIMEWASHWA' : 'VIMEZIMWA'}</b>
        <span className="muted st-small">{data.schedule.join(' · ')} — saa za kazi, kwa SMS na arifa ya mfumo.{' '}
          {data.lastAuto ? `Mara ya mwisho: ${dateTime(data.lastAuto)} · siku 30: ${data.auto30d}` : 'Bado havijatumwa.'}</span>
        <Alert>{act.error}</Alert>
      </div>
      {canManage && <Button size="sm" variant={data.feesAuto ? 'secondary' : 'primary'} busy={act.busy} onClick={toggle}>{data.feesAuto ? 'Zima' : 'Washa'}</Button>}
    </div>
  );
}
