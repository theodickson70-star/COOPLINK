import { useState } from 'react';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';
import { BarChart } from '../components/charts';
import { ConfirmDialog, DateRangeFilter, Kpi, LABELS, money, nfmt, Pill, presetRange, Section, Tabs, type Range } from '../components/owner-ui';

interface Payment {
  id: string; invoiceNo: string; amount: string; method: string; category: string; status: string; providerRef: string | null;
  paidAt: string; verifiedAt: string | null; failureReason: string | null; refundReason: string | null; periods: number; notes: string | null;
  amcos: { id: string; name: string; code: string } | null;
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

export function OwnerFinance() {
  const { has } = useAuth();
  const [range, setRange] = useState<Range>(presetRange('month'));
  const [tab, setTab] = useState<'payments' | 'expenses' | 'report'>('payments');
  const rep = useFetch<Report>('/owner/finance/report', { from: range.from, to: range.to });
  const r = rep.data;

  return (
    <div className="print-area">
      <PageHead title="Finance & Revenue" sub="Mapato ya CoopLink pekee — fedha za vyama na wakulima hazichanganywi hapa">
        <DateRangeFilter value={range} onChange={setRange} />
      </PageHead>
      <Alert>{rep.error}</Alert>
      {rep.loading && !r ? <Loading /> : r && (
        <div className="stack">
          <div className="grid grid-kpi">
            <Kpi tone="dark" label="Mapato yaliyothibitishwa" value={money(r.revenue.total)} hint={`${range.from} → ${range.to}`} />
            <Kpi label="Subscriptions" value={money(r.revenue.subscription)} />
            <Kpi label="Mapato mengine" value={money(r.revenue.other)} />
            <Kpi label="Matumizi" value={money(r.expenses.total)} />
            <Kpi tone={Number(r.profit) < 0 ? 'bad' : 'gold'} label="Faida / Hasara" value={money(r.profit)} hint={`Baada ya marejesho ${money(r.refunds.total)}`} />
          </div>
          <div className="grid grid-kpi">
            <Kpi label="Malipo yaliyofanikiwa" value={nfmt(r.transactions.successful)} />
            <Kpi tone={r.transactions.pending ? 'warn' : undefined} label="Yanasubiri uthibitisho" value={nfmt(r.transactions.pending)} hint={money(r.outstanding.pending_payments)} />
            <Kpi tone={r.transactions.failed ? 'bad' : undefined} label="Yaliyoshindwa" value={nfmt(r.transactions.failed)} />
            <Kpi label="Yaliyorudishwa" value={nfmt(r.transactions.refunded)} />
            <Kpi tone={r.outstanding.overdue_count ? 'warn' : undefined} label="Madeni ya subscriptions" value={money(r.outstanding.overdue_subscriptions)} hint={`${r.outstanding.overdue_count} zimepita muda`} />
          </div>
          <Section title="Mapato na matumizi (miezi 12)">
            <BarChart title="Mapato na matumizi kwa mwezi" data={r.series} xKey="month"
              series={[{ key: 'revenue', label: 'Mapato', color: '#1F7A52' }, { key: 'expenses', label: 'Matumizi', color: '#E3A83A' }]} />
          </Section>
          <div className="no-print"><Tabs value={tab} onChange={setTab} items={[['payments', 'Malipo'], ['expenses', 'Matumizi'], ['report', 'Ripoti na export']]} /></div>
          {tab === 'payments' && <Payments canManage={has('finance.manage')} onChange={rep.reload} />}
          {tab === 'expenses' && <Expenses canManage={has('finance.manage')} range={range} onChange={rep.reload} />}
          {tab === 'report' && <ReportTab r={r} range={range} />}
        </div>
      )}
    </div>
  );
}

function Payments({ canManage, onChange }: { canManage: boolean; onChange: () => void }) {
  const [status, setStatus] = useState('');
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
      <Alert>{error ?? act.error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna malipo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Ankara</th><th>Tarehe</th><th>AMCOS</th><th>Aina</th><th>Njia / Kumbukumbu</th><th className="num">Kiasi</th><th>Hali</th><th /></tr></thead>
          <tbody>{data?.data.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.invoiceNo}</strong></td><td>{date(p.paidAt)}</td><td>{p.amcos?.name ?? '—'}</td>
              <td><Pill value={p.category} />{p.periods > 1 ? <span className="muted"> ×{p.periods}</span> : null}</td>
              <td>{LABELS[p.method]}<div className="muted" style={{ fontSize: 12 }}>{p.providerRef ?? '—'}</div></td>
              <td className="num">{money(p.amount)}</td>
              <td><Pill value={p.status} />{(p.failureReason || p.refundReason) && <div className="muted" style={{ fontSize: 12 }}>{p.failureReason ?? p.refundReason}</div>}</td>
              <td className="num">{canManage && (
                <span className="actions" style={{ justifyContent: 'flex-end' }}>
                  {p.status === 'PENDING' && <><Button size="sm" onClick={() => setSel({ p, kind: 'verify' })}>Thibitisha</Button><Button size="sm" variant="ghost" onClick={() => setSel({ p, kind: 'fail' })}>Kataa</Button></>}
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

function Expenses({ canManage, range, onChange }: { canManage: boolean; range: Range; onChange: () => void }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<Paged<{ id: string; category: string; amount: string; description: string; vendor: string | null; spentAt: string }>>(
    '/owner/finance/expenses', { from: range.from, to: range.to, page, pageSize: 25 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'SERVER', amount: '', description: '', vendor: '', spentAt: todayStr() });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const act = useAction();
  return (
    <section className="card">
      {canManage && <div className="toolbar"><Button onClick={() => setOpen(true)}>+ Rekodi matumizi</Button></div>}
      <Alert>{error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna matumizi kwenye kipindi hiki.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Tarehe</th><th>Aina</th><th>Maelezo</th><th>Mtoa huduma</th><th className="num">Kiasi</th></tr></thead>
          <tbody>{data?.data.map((e) => <tr key={e.id}><td>{date(e.spentAt)}</td><td><Pill value={e.category} /></td><td>{e.description}</td><td>{e.vendor ?? '—'}</td><td className="num">{money(e.amount)}</td></tr>)}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      {open && (
        <Modal open title="Rekodi matumizi" onClose={() => setOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Ghairi</Button><Button busy={act.busy} disabled={!f.amount || f.description.length < 3} onClick={async () => {
            if (await act.run(() => api('/owner/finance/expenses', { method: 'POST', body: { ...f, vendor: f.vendor || null } }))) { setOpen(false); setF({ ...f, amount: '', description: '', vendor: '' }); reload(); onChange(); }
          }}>Hifadhi</Button></>}>
          <Alert>{act.error}</Alert>
          <div className="form-grid">
            <SelectField label="Aina" value={f.category} onChange={set('category')} options={['SERVER', 'SMS', 'SALARY', 'MARKETING', 'OFFICE', 'TRANSPORT', 'OTHER'].map((v) => ({ value: v, label: LABELS[v] }))} />
            <TextField label="Kiasi (TSh) *" type="number" min="1" value={f.amount} onChange={set('amount')} />
            <TextField label="Tarehe" type="date" value={f.spentAt} onChange={set('spentAt')} />
            <TextField label="Mtoa huduma" value={f.vendor} onChange={set('vendor')} />
          </div>
          <TextField label="Maelezo *" value={f.description} onChange={set('description')} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Kumbukumbu za matumizi hazifutwi. Kosa linasahihishwa kwa kurekodi marekebisho.</p>
        </Modal>
      )}
    </section>
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
