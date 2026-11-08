// =====================================================================
//  UHASIBU (Mhasibu): dashibodi ya fedha, daftari kuu (chati, journal, taarifa ya akaunti), ripoti kuu
//  Meneja: anaona ripoti tu na anaidhinisha journal kupitia Idhini.
// =====================================================================
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { APPROVAL_TYPE_LABEL, date, dateTime, num, tsh } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';
import { DateRangeFilter, Kpi, presetRange, Section, Tabs, type Range } from '../components/owner-ui';
import { BarChart } from '../components/charts';
import { Amt, DocHead, GL_TYPE_LABEL, GlSelect, PrintButton, today, useChart, type GlAccount } from './acc-common';

// ------------------------------ DASHIBODI YA FEDHA ------------------------------
interface Dash {
  cash: { total: string; accounts: { id: string; code: string; name: string; balance: string; lastReconciled: string | null; financeAccountId: string | null }[] };
  receivables: { farmers: string; buyers: string; other: string };
  payables: { suppliers: string; farmers: string; statutory: string; salaries: string; loans: string };
  inventory: string; fixedAssets: string;
  ytd: { from: string; income: string; expense: string; surplus: string };
  monthly: { month: string; income: string; expense: string }[];
  pending: Record<string, { count: number; amount: string }>;
  toPost: { count: number; amount: string };
  unpaidFarmers: { count: number; amount: string };
  farmerLedgerCheck: { memberLedger: string; generalLedger: string; matches: boolean };
  recent: { id: string; entryNo: string; date: string; description: string; sourceLabel: string; amount: string }[];
}

export function AccountingHome({ embedded }: { embedded?: boolean }) {
  const { may } = useAuth();
  const { data, error, loading } = useFetch<Dash>('/accounting/dashboard');
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const pendingTotal = Object.values(data.pending).reduce((s, p) => s + p.count, 0);
  const manage = may('accounting.manage');
  return (
    <div className="stack">
      {!embedded && <PageHead title="Dashibodi ya fedha" sub="Hali ya fedha za chama kutoka daftari kuu (double-entry) — kila shilingi ina pande mbili." />}
      {manage && (
        <div className="quick-actions no-print">
          <Link className="qa" to="/finance"><strong>Vocha na miamala</strong><span>Mapato, matumizi, malipo</span></Link>
          <Link className="qa" to="/sales"><strong>Mauzo ya tumbaku</strong><span>Soko, mabelo, makato</span></Link>
          <Link className="qa" to="/bank"><strong>Benki</strong><span>Uhamisho na usuluhishi</span></Link>
          <Link className="qa" to="/payroll"><strong>Mishahara</strong><span>PAYE, NSSF, hati</span></Link>
          <Link className="qa" to="/ledger"><strong>Daftari kuu</strong><span>Chati, journal</span></Link>
          <Link className="qa" to="/accounting/reports"><strong>Ripoti kuu</strong><span>TB, mizania, cash flow</span></Link>
        </div>
      )}
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Fedha zilizopo (taslimu, benki, simu)" value={tsh(data.cash.total)} />
        <Kpi label={`Mapato tangu ${date(data.ytd.from)}`} value={tsh(data.ytd.income)} />
        <Kpi label="Matumizi (mwaka huu)" value={tsh(data.ytd.expense)} />
        <Kpi tone={Number(data.ytd.surplus) < 0 ? 'bad' : undefined} label="Ziada / (upungufu)" value={<Amt v={data.ytd.surplus} zero="0" />} />
        <Kpi tone={data.unpaidFarmers.count ? 'gold' : undefined} label="Wakulima wanaosubiri malipo" value={num(data.unpaidFarmers.count)} hint={tsh(data.unpaidFarmers.amount)} />
        <Kpi tone={pendingTotal ? 'warn' : undefined} label="Yanasubiri idhini ya Meneja" value={num(pendingTotal)} hint={data.toPost.count ? `${data.toPost.count} yameidhinishwa — kamilisha` : undefined} />
      </div>
      <Alert kind={data.farmerLedgerCheck.matches ? 'ok' : 'warn'}>
        {data.farmerLedgerCheck.matches
          ? <>Ledger za wakulima zinalingana na daftari kuu ✓ (salio halisi {tsh(data.farmerLedgerCheck.memberLedger)})</>
          : <>Tofauti: ledger za wakulima {tsh(data.farmerLedgerCheck.memberLedger)} · daftari kuu {tsh(data.farmerLedgerCheck.generalLedger)}. Kagua journal za mkono zinazogusa 1200/2200.</>}
      </Alert>
      <div className="grid grid-2">
        <Section title="Mapato na matumizi kwa mwezi">
          {data.monthly.length ? (
            <BarChart title="Mapato na matumizi" data={data.monthly.map((m) => ({ month: m.month, income: Number(m.income), expense: Number(m.expense) }))} xKey="month"
              series={[{ key: 'income', label: 'Mapato', color: '#1F7A52' }, { key: 'expense', label: 'Matumizi', color: '#D4A017' }]} />
          ) : <Empty>Hakuna mapato wala matumizi bado.</Empty>}
        </Section>
        <Section pad={false} title="Akaunti za fedha" actions={manage ? <Link to="/bank">Usuluhishi →</Link> : undefined}>
          {data.cash.accounts.length === 0 ? <Empty>Ongeza akaunti ya fedha (taslimu/benki/simu).</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{data.cash.accounts.map((a) => (
              <tr key={a.id}>
                <td><span className="muted">{a.code}</span> {a.name}<div className="muted" style={{ fontSize: 12 }}>{a.lastReconciled ? `Imesuluhishwa hadi ${date(a.lastReconciled)}` : 'Haijasuluhishwa'}</div></td>
                <td className="num"><strong>{tsh(a.balance)}</strong></td>
              </tr>
            ))}</tbody></table></div>
          )}
        </Section>
      </div>
      <div className="grid grid-2">
        <Section pad={false} title="Wadaiwa na wadai">
          <div className="table-wrap"><table className="table"><tbody>
            <tr><td>Madeni ya wakulima (pembejeo/mikopo)</td><td className="num">{tsh(data.receivables.farmers)}</td></tr>
            <tr><td>Makampuni ya ununuzi wanadaiwa</td><td className="num">{tsh(data.receivables.buyers)}</td></tr>
            <tr><td>Stoo ya pembejeo (kwa gharama)</td><td className="num">{tsh(data.inventory)}</td></tr>
            <tr><td>Mali za kudumu (thamani halisi)</td><td className="num">{tsh(data.fixedAssets)}</td></tr>
            <tr className="row-sep"><td>Malipo ya wakulima yanayodaiwa</td><td className="num money-neg">{tsh(data.payables.farmers)}</td></tr>
            <tr><td>Wazabuni na deni la pembejeo</td><td className="num money-neg">{tsh(data.payables.suppliers)}</td></tr>
            <tr><td>Ushuru, PAYE, NSSF, WCF, SDL</td><td className="num money-neg">{tsh(data.payables.statutory)}</td></tr>
            <tr><td>Mishahara inayodaiwa</td><td className="num money-neg">{tsh(data.payables.salaries)}</td></tr>
            <tr><td>Mikopo ya chama</td><td className="num money-neg">{tsh(data.payables.loans)}</td></tr>
          </tbody></table></div>
        </Section>
        <Section pad={false} title="Maombi yanayosubiri idhini" actions={<Link to="/approvals">Fungua →</Link>}>
          {pendingTotal === 0 ? <Empty>Hakuna ombi linalosubiri.</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{Object.entries(data.pending).map(([k, p]) => (
              <tr key={k}><td>{APPROVAL_TYPE_LABEL[k] ?? k}</td><td className="num">{p.count}</td><td className="num">{Number(p.amount) ? tsh(p.amount) : '—'}</td></tr>
            ))}</tbody></table></div>
          )}
        </Section>
      </div>
      <Section pad={false} title="Journal za karibuni" actions={<Link to="/ledger?tab=journals">Zote →</Link>}>
        {data.recent.length === 0 ? <Empty>Bado hakuna journal.</Empty> : (
          <div className="table-wrap"><table className="table stack-sm"><tbody>{data.recent.map((r) => (
            <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}><strong>{r.entryNo}</strong><div className="muted" style={{ fontSize: 12 }}>{date(r.date)}</div></td>
              <td>{r.description}<div className="muted" style={{ fontSize: 12 }}>{r.sourceLabel}</div></td><td className="num">{tsh(r.amount)}</td></tr>
          ))}</tbody></table></div>
        )}
      </Section>
    </div>
  );
}

// ------------------------------ DAFTARI KUU ------------------------------
export function Ledger() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'chart' | 'journals' | 'statement') ?? 'chart';
  const setTab = (t: string, extra: Record<string, string> = {}) => setParams({ tab: t, ...extra }, { replace: true });
  return (
    <>
      <PageHead title="Daftari kuu (General Ledger)" sub="Chati ya akaunti, journal zote na taarifa ya kila akaunti. Journal haifutwi — inasahihishwa kwa journal ya kinyume." />
      <Tabs value={tab} onChange={(t) => setTab(t)} items={[['chart', 'Chati ya akaunti'], ['journals', 'Journal'], ['statement', 'Taarifa ya akaunti']]} />
      {tab === 'chart' && <Chart onOpen={(id) => setTab('statement', { account: id })} />}
      {tab === 'journals' && <Journals />}
      {tab === 'statement' && <Statement accountId={params.get('account') ?? ''} onAccount={(id) => setTab('statement', { account: id })} />}
    </>
  );
}

function Chart({ onOpen }: { onOpen: (id: string) => void }) {
  const { may } = useAuth();
  const chart = useChart();
  const [add, setAdd] = useState(false);
  const [q, setQ] = useState('');
  if (chart.loading && !chart.data) return <Loading />;
  const rows = (chart.data?.data ?? []).filter((a) => !q || `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <Alert>{chart.error}</Alert>
      <section className="card">
        <div className="toolbar">
          <input className="input" placeholder="Tafuta akaunti…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta akaunti" />
          <div className="grow" />
          {may('accounting.manage') && <Button onClick={() => setAdd(true)}>+ Akaunti mpya</Button>}
        </div>
        {(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const).map((t) => {
          const list = rows.filter((r) => r.type === t);
          if (!list.length) return null;
          const total = list.filter((r) => r.subtype !== 'CASH_GROUP').reduce((s, r) => s + Number(r.balance), 0);
          return (
            <div key={t} className="table-wrap">
              <table className="table fin-table">
                <thead><tr><th style={{ width: 90 }}>Namba</th><th>{GL_TYPE_LABEL[t]}</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Salio</th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={a.subtype === 'CASH_GROUP' ? 'row-group' : ''} onClick={() => a.subtype !== 'CASH_GROUP' && onOpen(a.id)} style={{ cursor: a.subtype === 'CASH_GROUP' ? 'default' : 'pointer' }}>
                      <td><strong>{a.code}</strong></td>
                      <td style={{ paddingLeft: a.financeAccountId ? 28 : undefined }}>{a.name}{!a.isActive && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>Imefungwa</span>}</td>
                      <td className="num"><Amt v={a.debit} /></td><td className="num"><Amt v={a.credit} /></td>
                      <td className="num"><Amt v={a.subtype === 'CASH_GROUP' ? 0 : a.balance} strong /></td>
                    </tr>
                  ))}
                  <tr className="row-total"><td /><td>Jumla ya {GL_TYPE_LABEL[t].toLowerCase()}</td><td /><td /><td className="num"><Amt v={total} strong zero="0" /></td></tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </section>
      {add && <NewAccount onClose={() => setAdd(false)} onDone={() => { setAdd(false); chart.reload(); }} />}
    </div>
  );
}

function NewAccount({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', type: 'EXPENSE', description: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Akaunti mpya ya daftari kuu" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!/^\d{4,6}$/.test(f.code) || f.name.trim().length < 3} onClick={async () => {
        if (await run(() => api('/accounting/chart', { method: 'POST', body: { ...f, description: f.description || null } }))) onDone();
      }}>Hifadhi</Button></>}>
      <Alert kind="warn">Namba: 1xxx mali · 2xxx madeni · 3xxx mtaji · 4xxx mapato · 5xxx matumizi. Akaunti za fedha (taslimu/benki) zinaundwa zenyewe ukiongeza akaunti ya fedha.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <SelectField label="Aina *" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={Object.entries(GL_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextField label="Namba *" inputMode="numeric" value={f.code} onChange={(v) => setF({ ...f, code: v.replace(/\D/g, '') })} placeholder="mf. 5285" />
      </div>
      <TextField label="Jina la akaunti *" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="mf. Posho za wajumbe wa bodi" />
      <TextField label="Maelezo" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
    </Modal>
  );
}

interface Journal { id: string; entryNo: string; entryDate: string; description: string; source: string; sourceLabel: string; reference: string | null; amount: string; reversed: boolean; createdBy: string | null }
interface JournalDetail extends Journal {
  lines: { id: string; code: string; name: string; debit: string; credit: string; memo: string | null; member: string | null }[];
  totalDebit: string; totalCredit: string; reversedBy: string | null; reversalOfNo: string | null; createdAt: string;
  approval: { requestNo: string; decidedAt: string | null; decisionNote: string | null } | null;
}

function Journals() {
  const { may } = useAuth();
  const [page, setPage] = useState(1);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const list = useFetch<Paged<Journal> & { pending: { id: string; requestNo: string; title: string; amount: string; createdAt: string }[] }>('/accounting/journals', { page, pageSize: 25, source: source || undefined, search: search || undefined });
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <div className="stack">
      <Alert kind="ok">{ok}</Alert>
      {!!list.data?.pending.length && (
        <Alert kind="warn">Journal {list.data.pending.length} zinasubiri idhini ya Meneja: {list.data.pending.map((p) => `${p.requestNo} (${tsh(p.amount)})`).join(', ')}</Alert>
      )}
      <section className="card">
        <div className="toolbar">
          <input className="input" placeholder="Tafuta namba, maelezo…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Tafuta journal" />
          <Select aria-label="Chanzo" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }}>
            <option value="">Vyanzo vyote</option>
            {Object.entries({ FINANCE_TXN: 'Muamala wa fedha', TOBACCO_SALE: 'Mauzo ya tumbaku', INPUT_ISSUE: 'Pembejeo kwa mkopo', STOCK_MOVEMENT: 'Stoo', PAYROLL: 'Mishahara', DEPRECIATION: 'Uchakavu', MANUAL: 'Journal ya mkono', ACCOUNT_OPENING: 'Salio la kuanzia' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <div className="grow" />
          {may('accounting.manage') && <Button onClick={() => setForm(true)}>+ Journal ya mkono</Button>}
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>Hakuna journal.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Namba</th><th>Tarehe</th><th>Maelezo</th><th>Chanzo</th><th className="num">Kiasi</th></tr></thead>
            <tbody>{list.data?.data.map((j) => (
              <tr key={j.id} onClick={() => setSel(j.id)} style={{ cursor: 'pointer' }}>
                <td><strong>{j.entryNo}</strong>{j.reversed && <div><span className="badge badge-neutral">Imesahihishwa</span></div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{date(j.entryDate)}</td>
                <td style={{ minWidth: 220 }}>{j.description}{j.reference && <div className="muted" style={{ fontSize: 12 }}>Kumb: {j.reference}</div>}</td>
                <td>{j.sourceLabel}</td>
                <td className="num">{tsh(j.amount)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={list.data?.meta} onPage={setPage} />
      </section>
      {sel && <JournalModal id={sel} onClose={() => setSel(null)} />}
      {form && <JournalForm onClose={() => setForm(false)} onDone={(m) => { setForm(false); setOk(m); list.reload(); }} />}
    </div>
  );
}

export function JournalModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useFetch<{ journal: JournalDetail }>(`/accounting/journals/${id}`);
  const j = data?.journal;
  return (
    <Modal open title={j ? `${j.entryNo} · ${j.sourceLabel}` : 'Journal'} onClose={onClose} footer={<><PrintButton /><Button variant="secondary" onClick={onClose}>Funga</Button></>}>
      {!j ? <Loading /> : (
        <div className="print-doc">
          <DocHead title="JOURNAL VOUCHER" no={j.entryNo} sub={date(j.entryDate)} />
          <dl className="dl">
            <dt>Maelezo</dt><dd>{j.description}</dd>
            {j.reference && <><dt>Kumbukumbu</dt><dd>{j.reference}</dd></>}
            <dt>Imeandikwa</dt><dd>{j.createdBy ?? 'Mfumo'} · {dateTime(j.createdAt)}</dd>
            {j.approval && <><dt>Idhini</dt><dd>{j.approval.requestNo} · {dateTime(j.approval.decidedAt)}{j.approval.decisionNote && <div className="muted">"{j.approval.decisionNote}"</div>}</dd></>}
            {j.reversalOfNo && <><dt>Inasahihisha</dt><dd>{j.reversalOfNo}</dd></>}
            {j.reversedBy && <><dt>Imesahihishwa na</dt><dd>{j.reversedBy}</dd></>}
          </dl>
          <div className="table-wrap"><table className="table fin-table">
            <thead><tr><th>Akaunti</th><th>Maelezo</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {j.lines.map((l) => (
                <tr key={l.id}><td><strong>{l.code}</strong> {l.name}</td><td className="muted">{[l.memo, l.member].filter(Boolean).join(' · ')}</td>
                  <td className="num"><Amt v={l.debit} /></td><td className="num"><Amt v={l.credit} /></td></tr>
              ))}
              <tr className="row-total"><td colSpan={2}>Jumla</td><td className="num"><Amt v={j.totalDebit} strong /></td><td className="num"><Amt v={j.totalCredit} strong /></td></tr>
            </tbody>
          </table></div>
        </div>
      )}
    </Modal>
  );
}

interface JLine { glAccountId: string; debit: string; credit: string; memo: string }
function JournalForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const chart = useChart();
  const [d, setD] = useState(today());
  const [desc, setDesc] = useState('');
  const [ref, setRef] = useState('');
  const [lines, setLines] = useState<JLine[]>([{ glAccountId: '', debit: '', credit: '', memo: '' }, { glAccountId: '', debit: '', credit: '', memo: '' }]);
  const { busy, error, run } = useAction();
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0), cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const filled = lines.filter((l) => l.glAccountId && (Number(l.debit) > 0) !== (Number(l.credit) > 0));
  const valid = desc.trim().length >= 5 && filled.length >= 2 && filled.length === lines.filter((l) => l.glAccountId || l.debit || l.credit).length && Math.abs(dr - cr) < 0.005 && dr > 0;
  const set = (i: number, p: Partial<JLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  return (
    <Modal open title="Journal ya mkono" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!valid} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string } }>('/accounting/journals', { method: 'POST', body: {
          date: d, description: desc, reference: ref || null,
          lines: filled.map((l) => ({ glAccountId: l.glAccountId, debit: l.debit || undefined, credit: l.credit || undefined, memo: l.memo || null })),
        } }));
        if (r) onDone(`Journal imetumwa kwa Meneja (${r.approval.requestNo}). Itaingia daftari kuu baada ya idhini.`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Tumia journal kwa marekebisho (mf. salio la kuanzia, malipo ya awali, makosa ya kundi). Fedha taslimu/benki zinaguswa kwa miamala tu, si journal.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Tarehe *" type="date" max={today()} value={d} onChange={setD} />
        <TextField label="Kumbukumbu" value={ref} onChange={setRef} />
      </div>
      <TextField label="Maelezo *" value={desc} onChange={setDesc} placeholder="mf. Salio la kuanzia la madeni ya wazabuni" />
      <div className="jl-grid">
        {lines.map((l, i) => (
          <div key={i} className="jl-row">
            <GlSelect label={`Akaunti ${i + 1}`} value={l.glAccountId} onChange={(v) => set(i, { glAccountId: v })} accounts={chart.data?.data} />
            <TextField label="Debit" type="number" min="0" value={l.debit} onChange={(v) => set(i, { debit: v, credit: v ? '' : l.credit })} />
            <TextField label="Credit" type="number" min="0" value={l.credit} onChange={(v) => set(i, { credit: v, debit: v ? '' : l.debit })} />
            {lines.length > 2 && <Button variant="ghost" size="sm" aria-label="Ondoa mstari" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</Button>}
          </div>
        ))}
      </div>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <Button variant="secondary" size="sm" onClick={() => setLines([...lines, { glAccountId: '', debit: '', credit: '', memo: '' }])}>+ Mstari</Button>
        <span className={Math.abs(dr - cr) < 0.005 && dr > 0 ? 'money-pos' : 'money-neg'}>Debit {tsh(dr)} · Credit {tsh(cr)}{Math.abs(dr - cr) >= 0.005 && ` · tofauti ${tsh(Math.abs(dr - cr))}`}</span>
      </div>
    </Modal>
  );
}

interface StatementData {
  account: GlAccount & { description: string | null }; from: string; to: string; opening: string; closing: string; totalDebit: string; totalCredit: string;
  lines: { id: string; entryId: string; entryNo: string; date: string; description: string; member: string | null; reference: string | null; debit: string; credit: string; balance: string }[];
}

function Statement({ accountId, onAccount }: { accountId: string; onAccount: (id: string) => void }) {
  const chart = useChart();
  const [range, setRange] = useState<Range>(presetRange('year'));
  const st = useFetch<StatementData>(accountId ? `/accounting/ledger/${accountId}` : null, { from: range.from, to: range.to });
  const [sel, setSel] = useState<string | null>(null);
  const accounts = chart.data?.data.filter((a) => a.subtype !== 'CASH_GROUP') ?? [];
  return (
    <div className="stack">
      <section className="card card-pad no-print">
        <div className="form-grid">
          <SelectField label="Akaunti" value={accountId} onChange={onAccount} placeholder="Chagua akaunti…" options={accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </section>
      {!accountId ? <Empty>Chagua akaunti kuona taarifa yake.</Empty> : !st.data ? <Loading /> : (
        <section className="card card-pad print-doc">
          <DocHead title="TAARIFA YA AKAUNTI" no={`${st.data.account.code} · ${st.data.account.name}`} sub={`${date(st.data.from)} – ${date(st.data.to)}`} />
          <div className="actions no-print" style={{ justifyContent: 'flex-end' }}><PrintButton /></div>
          <div className="table-wrap"><table className="table fin-table">
            <thead><tr><th>Tarehe</th><th>Journal</th><th>Maelezo</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Salio</th></tr></thead>
            <tbody>
              <tr className="row-group"><td colSpan={5}>Salio la mwanzo</td><td className="num"><Amt v={st.data.opening} strong zero="0" /></td></tr>
              {st.data.lines.map((l) => (
                <tr key={l.id} onClick={() => setSel(l.entryId)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap' }}>{date(l.date)}</td><td>{l.entryNo}</td>
                  <td style={{ minWidth: 200 }}>{l.description}{l.member && <div className="muted" style={{ fontSize: 12 }}>{l.member}</div>}</td>
                  <td className="num"><Amt v={l.debit} /></td><td className="num"><Amt v={l.credit} /></td><td className="num"><Amt v={l.balance} zero="0" /></td>
                </tr>
              ))}
              <tr className="row-total"><td colSpan={3}>Jumla / salio la mwisho</td><td className="num"><Amt v={st.data.totalDebit} strong /></td><td className="num"><Amt v={st.data.totalCredit} strong /></td><td className="num"><Amt v={st.data.closing} strong zero="0" /></td></tr>
            </tbody>
          </table></div>
          {st.data.lines.length === 0 && <Empty>Hakuna miamala kwenye kipindi hiki.</Empty>}
        </section>
      )}
      {sel && <JournalModal id={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

// ------------------------------ RIPOTI KUU ------------------------------
type RLine = { id: string; code: string; name: string; amount: string };
export function FinancialReports() {
  const [tab, setTab] = useState<'is' | 'bs' | 'cf' | 'tb'>('is');
  const [range, setRange] = useState<Range>(presetRange('year'));
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHead title="Ripoti kuu za fedha" sub="Zinatoka moja kwa moja kwenye daftari kuu. Chapisha au hifadhi kama PDF kwa ajili ya bodi, mkutano mkuu na mkaguzi.">
        <PrintButton />
      </PageHead>
      <div className="no-print"><Tabs value={tab} onChange={setTab} items={[['is', 'Mapato na Matumizi'], ['bs', 'Mizania (Balance Sheet)'], ['cf', 'Mtiririko wa Fedha'], ['tb', 'Trial Balance']]} /></div>
      <section className="card card-pad no-print" style={{ marginBottom: 16 }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <DateRangeFilter value={range} onChange={setRange} />
          {tab === 'tb' && <Button variant="secondary" busy={busy} onClick={async () => { setBusy(true); try { await apiDownload('/accounting/reports/trial-balance.csv', { query: { asOf: range.to }, filename: `trial-balance-${range.to}.csv` }); } finally { setBusy(false); } }}>Pakua CSV</Button>}
        </div>
        {(tab === 'bs' || tab === 'tb') && <p className="muted" style={{ margin: '8px 0 0' }}>Hadi tarehe {date(range.to)}</p>}
      </section>
      {tab === 'is' && <IncomeStatement range={range} />}
      {tab === 'bs' && <BalanceSheet asOf={range.to} />}
      {tab === 'cf' && <CashFlow range={range} />}
      {tab === 'tb' && <TrialBalance asOf={range.to} />}
    </>
  );
}

function ReportTable({ title, rows, total, totalLabel }: { title: string; rows: RLine[]; total: string; totalLabel: string }) {
  return (
    <>
      <tr className="row-group"><td colSpan={3}>{title}</td></tr>
      {rows.map((r) => <tr key={r.id}><td className="muted" style={{ width: 80 }}>{r.code}</td><td>{r.name}</td><td className="num"><Amt v={r.amount} /></td></tr>)}
      {rows.length === 0 && <tr><td /><td className="muted">—</td><td /></tr>}
      <tr className="row-total"><td /><td>{totalLabel}</td><td className="num"><Amt v={total} strong zero="0" /></td></tr>
    </>
  );
}

function IncomeStatement({ range }: { range: Range }) {
  const { data } = useFetch<{ from: string; to: string; income: RLine[]; expense: RLine[]; totalIncome: string; totalExpense: string; surplus: string }>('/accounting/reports/income-statement', { from: range.from, to: range.to });
  if (!data) return <Loading />;
  return (
    <section className="card card-pad print-doc">
      <DocHead title="TAARIFA YA MAPATO NA MATUMIZI" sub={`${date(data.from)} – ${date(data.to)}`} />
      <div className="table-wrap"><table className="table fin-table"><tbody>
        <ReportTable title="MAPATO" rows={data.income} total={data.totalIncome} totalLabel="Jumla ya mapato" />
        <ReportTable title="MATUMIZI" rows={data.expense} total={data.totalExpense} totalLabel="Jumla ya matumizi" />
        <tr className="row-grand"><td /><td>{Number(data.surplus) >= 0 ? 'ZIADA YA KIPINDI' : 'UPUNGUFU WA KIPINDI'}</td><td className="num"><Amt v={data.surplus} strong zero="0" /></td></tr>
      </tbody></table></div>
    </section>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const { data } = useFetch<{ asOf: string; assets: RLine[]; liabilities: RLine[]; equity: RLine[]; retainedPrior: string; currentSurplus: string; totalAssets: string; totalLiabilities: string; totalEquity: string; totalLiabilitiesEquity: string; balanced: boolean }>('/accounting/reports/balance-sheet', { asOf });
  if (!data) return <Loading />;
  const equity = [...data.equity, { id: 'rp', code: '', name: 'Ziada iliyolimbikizwa (miaka iliyopita)', amount: data.retainedPrior }, { id: 'cs', code: '', name: 'Ziada / (upungufu) ya mwaka huu', amount: data.currentSurplus }];
  return (
    <section className="card card-pad print-doc">
      <DocHead title="MIZANIA (BALANCE SHEET)" sub={`Hadi ${date(data.asOf)}`} />
      <Alert kind={data.balanced ? 'ok' : 'error'}>{data.balanced ? 'Mizania inalingana: Mali = Madeni + Mtaji ✓' : 'Mizania hailingani — wasiliana na msaada wa CoopLink'}</Alert>
      <div className="table-wrap"><table className="table fin-table"><tbody>
        <ReportTable title="MALI" rows={data.assets} total={data.totalAssets} totalLabel="Jumla ya mali" />
        <ReportTable title="MADENI" rows={data.liabilities} total={data.totalLiabilities} totalLabel="Jumla ya madeni" />
        <ReportTable title="MTAJI NA AKIBA" rows={equity} total={data.totalEquity} totalLabel="Jumla ya mtaji" />
        <tr className="row-grand"><td /><td>JUMLA YA MADENI NA MTAJI</td><td className="num"><Amt v={data.totalLiabilitiesEquity} strong zero="0" /></td></tr>
      </tbody></table></div>
    </section>
  );
}

function CashFlow({ range }: { range: Range }) {
  const { data } = useFetch<{ from: string; to: string; opening: string; net: string; closing: string; balanced: boolean; sections: Record<string, { label: string; lines: RLine[]; total: string }> }>('/accounting/reports/cash-flow', { from: range.from, to: range.to });
  if (!data) return <Loading />;
  return (
    <section className="card card-pad print-doc">
      <DocHead title="TAARIFA YA MTIRIRIKO WA FEDHA" sub={`${date(data.from)} – ${date(data.to)} (njia ya moja kwa moja)`} />
      <div className="table-wrap"><table className="table fin-table"><tbody>
        <tr className="row-total"><td /><td>Fedha mwanzoni mwa kipindi</td><td className="num"><Amt v={data.opening} strong zero="0" /></td></tr>
        {Object.entries(data.sections).filter(([k, s]) => k !== 'TRANSFER' || s.lines.length).map(([k, s]) => (
          <ReportTable key={k} title={s.label.toUpperCase()} rows={s.lines} total={s.total} totalLabel={`Fedha halisi — ${s.label.toLowerCase()}`} />
        ))}
        <tr className="row-total"><td /><td>Mabadiliko ya fedha</td><td className="num"><Amt v={data.net} strong zero="0" /></td></tr>
        <tr className="row-grand"><td /><td>FEDHA MWISHONI MWA KIPINDI</td><td className="num"><Amt v={data.closing} strong zero="0" /></td></tr>
      </tbody></table></div>
      {!data.balanced && <Alert>Mtiririko haulingani na salio la fedha.</Alert>}
    </section>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const { data } = useFetch<{ asOf: string; lines: { id: string; code: string; name: string; typeLabel: string; debit: string; credit: string }[]; totalDebit: string; totalCredit: string; balanced: boolean }>('/accounting/reports/trial-balance', { asOf });
  const grouped = data?.lines ?? [];
  if (!data) return <Loading />;
  return (
    <section className="card card-pad print-doc">
      <DocHead title="TRIAL BALANCE" sub={`Hadi ${date(data.asOf)}`} />
      <Alert kind={data.balanced ? 'ok' : 'error'}>{data.balanced ? 'Debit = Credit ✓' : 'Debit na credit hazilingani'}</Alert>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Namba</th><th>Akaunti</th><th>Aina</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
        <tbody>
          {grouped.map((l) => (
            <tr key={l.id}><td><Link to={`/ledger?tab=statement&account=${l.id}`}>{l.code}</Link></td><td>{l.name}</td><td className="muted">{l.typeLabel}</td>
              <td className="num"><Amt v={l.debit} /></td><td className="num"><Amt v={l.credit} /></td></tr>
          ))}
          <tr className="row-grand"><td /><td>JUMLA</td><td /><td className="num"><Amt v={data.totalDebit} strong /></td><td className="num"><Amt v={data.totalCredit} strong /></td></tr>
        </tbody>
      </table></div>
    </section>
  );
}
