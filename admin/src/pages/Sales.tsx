// =====================================================================
//  MAUZO YA TUMBAKU NA MAKATO (Mhasibu)
//   Masoko -> mabelo -> hesabu za wakulima (settlement) -> idhini -> orodha ya malipo -> malipo yaliyothibitishwa
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiDownload } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, num, phone, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { Amt, DocHead, PrintButton, Signatures, today } from './acc-common';

const usd = (v: string | number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { MOBILE_MONEY: 'Simu', BANK: 'Benki', CASH: 'Taslimu' };
const SETTLE: Record<string, string> = { DRAFT: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — haijalipwa', PAID: 'Imelipwa', CANCELLED: 'Imefutwa' };

interface Market {
  id: string; marketNo: string; marketDate: string; location: string | null; buyerName: string | null; exchangeRate: string | null; status: string; notes: string | null;
  bales: number; rejected: number; farmers: number; kg: string; usd: string; settlement: string | null; grossTzs?: string; netTzs?: string; paid?: string; approvalId: string | null;
}
interface Rule { id: string; name: string; code: string; basis: string; basisLabel: string; rate: string; currency: string; priority: number; glAccountCode: string | null; glCode: string; isActive: boolean }

export function Sales() {
  const { may } = useAuth();
  const [tab, setTab] = useState<'markets' | 'buyers' | 'rules'>('markets');
  const sum = useFetch<{ season: { name: string }; farmers: number; kg: string; grossTzs: string; deductions: string; netTzs: string; paid: string; unpaid: string; deductionsByRule: { name: string; amount: string }[] }>('/sales/summary');
  return (
    <>
      <PageHead title="Mauzo ya tumbaku na makato" sub={<>Masoko, mabelo, makato ya kisheria, deni la pembejeo na malipo ya wakulima{sum.data ? <> · Msimu <strong>{sum.data.season.name}</strong></> : null}</>} />
      {sum.data && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Mauzo ya wakulima (ghafi)" value={tsh(sum.data.grossTzs)} hint={`Kilo ${num(sum.data.kg)} · wakulima ${num(sum.data.farmers)}`} />
          <Kpi label="Makato yote" value={tsh(sum.data.deductions)} />
          <Kpi label="Malipo halisi ya wakulima" value={tsh(sum.data.netTzs)} />
          <Kpi tone={Number(sum.data.unpaid) > 0 ? 'gold' : undefined} label="Bado hawajalipwa" value={tsh(sum.data.unpaid)} hint={`Wamelipwa ${tsh(sum.data.paid)}`} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[['markets', 'Masoko'], ['buyers', 'Malipo ya mnunuzi'], ['rules', 'Kanuni za makato']]} />
      {tab === 'buyers' && <Buyers canRecord={may('finance.record')} />}
      {tab === 'markets' && <Markets canManage={may('sales.manage')} />}
      {tab === 'rules' && <Rules canManage={may('sales.manage')} byRule={sum.data?.deductionsByRule ?? []} />}
    </>
  );
}

function Markets({ canManage }: { canManage: boolean }) {
  const { data, loading, reload } = useFetch<{ data: Market[] }>('/sales/markets');
  const [add, setAdd] = useState(false);
  const nav = useNavigate();
  return (
    <section className="card">
      <div className="toolbar"><div className="grow" />{canManage && <Button onClick={() => setAdd(true)}>+ Soko jipya</Button>}</div>
      {loading && !data ? <Loading /> : !data?.data.length ? <Empty>Bado hakuna soko msimu huu. Anza kwa kuweka kanuni za makato, kisha fungua soko.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Soko</th><th>Mnunuzi</th><th className="num">Mabelo / kilo</th><th className="num">Thamani</th><th className="num">Malipo halisi</th><th>Hali</th></tr></thead>
          <tbody>{data.data.map((m) => (
            <tr key={m.id} onClick={() => nav(`/sales/markets/${m.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{m.marketNo}</strong><div className="muted" style={{ fontSize: 12 }}>{date(m.marketDate)}{m.location ? ` · ${m.location}` : ''}</div></td>
              <td>{m.buyerName ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{m.exchangeRate ? `1 USD = ${num(m.exchangeRate)} TZS` : ''}</div></td>
              <td className="num">{num(m.bales)} / {num(m.kg)} kg<div className="muted" style={{ fontSize: 12 }}>wakulima {m.farmers}</div></td>
              <td className="num">{usd(m.usd)}{Number(m.grossTzs) > 0 && <div className="muted" style={{ fontSize: 12 }}>{tsh(m.grossTzs!)}</div>}</td>
              <td className="num">{Number(m.netTzs) > 0 ? tsh(m.netTzs!) : '—'}{Number(m.paid) > 0 && <div className="muted" style={{ fontSize: 12 }}>Imelipwa {tsh(m.paid!)}</div>}</td>
              <td><Badge status={m.settlement ?? m.status} label={m.settlement ? SETTLE[m.settlement] : m.status === 'OPEN' ? 'Wazi — mabelo yanaingizwa' : undefined} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {add && <MarketForm onClose={() => setAdd(false)} onDone={(id) => { setAdd(false); reload(); nav(`/sales/markets/${id}`); }} />}
    </section>
  );
}

function MarketForm({ market, onClose, onDone }: { market?: Market; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ marketDate: market?.marketDate ?? today(), buyerName: market?.buyerName ?? '', exchangeRate: market?.exchangeRate ?? '', location: market?.location ?? '', notes: market?.notes ?? '' });
  const { busy, error, run } = useAction();
  const valid = f.buyerName.trim().length >= 2 && Number(f.exchangeRate) > 0;
  return (
    <Modal open title={market ? `Hariri ${market.marketNo}` : 'Soko jipya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!valid} onClick={async () => {
        const body = { ...f, location: f.location || null, notes: f.notes || null };
        const r = await run(() => market ? api<{ market: Market }>(`/sales/markets/${market.id}`, { method: 'PATCH', body }) : api<{ market: Market }>('/sales/markets', { method: 'POST', body }));
        if (r) onDone(r.market.id);
      }}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Tarehe ya soko *" type="date" value={f.marketDate} onChange={(v) => setF({ ...f, marketDate: v })} />
        <TextField label="Kampuni ya ununuzi *" value={f.buyerName} onChange={(v) => setF({ ...f, buyerName: v })} placeholder="mf. Alliance One, TLTC" />
        <TextField label="Kiwango: 1 USD = TZS *" type="number" min="1" value={f.exchangeRate} onChange={(v) => setF({ ...f, exchangeRate: v })} help="Kiwango kilichokubaliwa siku ya soko (mf. BoT)" />
        <TextField label="Mahali" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
      </div>
      <TextField label="Maelezo" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
    </Modal>
  );
}

function Rules({ canManage, byRule }: { canManage: boolean; byRule: { name: string; amount: string }[] }) {
  const { data, reload } = useFetch<{ data: Rule[]; season: { name: string } }>('/sales/deduction-rules');
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const deducted = new Map(byRule.map((b) => [b.name, b.amount]));
  return (
    <section className="card">
      <div className="toolbar">
        <span className="muted">Makato yanakatwa kwa mpangilio (namba ndogo kwanza). Deni la pembejeo linawekwa mwisho ili ushuru wa kisheria ukatwe kwanza.</span>
        <div className="grow" />
        {canManage && <Button onClick={() => setEdit('new')}>+ Kanuni mpya</Button>}
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty>Hakuna kanuni za makato msimu huu. Ongeza mf. Ushuru wa Halmashauri (3%), Ushuru wa Chama Kikuu, Ushuru wa chama, Deni la pembejeo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>Kanuni</th><th>Msingi</th><th className="num">Kiwango</th><th>Akaunti</th><th className="num">Imekatwa msimu huu</th><th /></tr></thead>
          <tbody>{data.data.map((r) => (
            <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
              <td>{r.priority}</td>
              <td><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.code}{!r.isActive && ' · imezimwa'}</div></td>
              <td>{r.basisLabel}</td>
              <td className="num">{r.basis === 'OUTSTANDING_LOAN' ? 'Deni lote' : r.basis === 'PERCENT_OF_GROSS' ? `${num(r.rate)}%` : `${r.currency === 'USD' ? usd(r.rate) : tsh(r.rate)}${r.basis === 'PER_KG' ? ' /kg' : ''}`}</td>
              <td>{r.glCode}</td>
              <td className="num">{deducted.has(r.name) ? tsh(deducted.get(r.name)!) : '—'}</td>
              <td className="num">{canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Hariri</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <RuleForm rule={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

const GL_FOR_RULE = [
  { value: '', label: 'Kwa jina (kiotomatiki)' },
  { value: '2310', label: '2310 · Ushuru wa Halmashauri (deni)' },
  { value: '2300', label: '2300 · Ushuru wa Chama Kikuu (deni)' },
  { value: '2320', label: '2320 · Makato mengine (deni)' },
  { value: '4100', label: '4100 · Ushuru wa chama (mapato ya chama)' },
  { value: '1200', label: '1200 · Deni la mkulima (marejesho)' },
];

function RuleForm({ rule, onClose, onDone }: { rule: Rule | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: rule?.name ?? '', code: rule?.code ?? '', basis: rule?.basis ?? 'PERCENT_OF_GROSS', rate: rule?.rate ?? '', currency: rule?.currency ?? 'TZS', priority: String(rule?.priority ?? 100), glAccountCode: rule?.glAccountCode ?? '', isActive: rule?.isActive ?? true });
  const { busy, error, run } = useAction();
  const loan = f.basis === 'OUTSTANDING_LOAN';
  return (
    <Modal open title={rule ? `Hariri: ${rule.name}` : 'Kanuni mpya ya makato'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={f.name.trim().length < 3 || (!rule && !/^[A-Za-z0-9_]{2,20}$/.test(f.code)) || (!loan && f.rate === '')} onClick={async () => {
        const body = { name: f.name, basis: f.basis, rate: loan ? '0' : f.rate, currency: f.currency, priority: Number(f.priority), glAccountCode: f.glAccountCode || null, ...(rule ? { isActive: f.isActive } : { code: f.code.toUpperCase() }) };
        if (await run(() => rule ? api(`/sales/deduction-rules/${rule.id}`, { method: 'PATCH', body }) : api('/sales/deduction-rules', { method: 'POST', body }))) onDone();
      }}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina *" value={f.name} onChange={(v) => setF({ ...f, name: v })} placeholder="mf. Ushuru wa Halmashauri" />
        {!rule && <TextField label="Code *" value={f.code} onChange={(v) => setF({ ...f, code: v.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="LGA_CESS" />}
        <SelectField label="Msingi wa kukata *" value={f.basis} onChange={(v) => setF({ ...f, basis: v, priority: v === 'OUTSTANDING_LOAN' && !rule ? '900' : f.priority })}
          options={[{ value: 'PERCENT_OF_GROSS', label: '% ya thamani ya mauzo' }, { value: 'PER_KG', label: 'Kiasi kwa kila kilo' }, { value: 'FIXED', label: 'Kiasi maalum kwa mkulima' }, { value: 'OUTSTANDING_LOAN', label: 'Deni la pembejeo / mkopo (lote)' }]} />
        {!loan && <TextField label={f.basis === 'PERCENT_OF_GROSS' ? 'Asilimia (%) *' : 'Kiasi *'} type="number" min="0" step="0.0001" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />}
        {!loan && f.basis !== 'PERCENT_OF_GROSS' && <SelectField label="Sarafu" value={f.currency} onChange={(v) => setF({ ...f, currency: v })} options={[{ value: 'TZS', label: 'TZS' }, { value: 'USD', label: 'USD (inabadilishwa kwa kiwango cha soko)' }]} />}
        <TextField label="Mpangilio" type="number" min="1" value={f.priority} onChange={(v) => setF({ ...f, priority: v })} />
        <SelectField label="Akaunti ya daftari kuu" value={f.glAccountCode} onChange={(v) => setF({ ...f, glAccountCode: v })} options={GL_FOR_RULE} />
      </div>
      {rule && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Kanuni iko hai</label>}
    </Modal>
  );
}

// ------------------------------ SOKO MOJA ------------------------------
interface Bale { id: string; baleNo: string; memberId: string; memberNo: string; memberName: string; grossKg: string; netKg: string | null; grade: string | null; priceUsd: string | null; valueUsd: string | null; status: string; rejectReason: string | null }
interface Settlement { id: string; settlementNo: string; memberId: string; memberNo: string; memberName: string; totalKg: string; grossUsd: string; grossTzs: string; totalDeductions: string; netTzs: string; status: string; paid: string; lines: { id: string; description: string; amount: string }[] }
interface Batch { id: string; batchNo: string; totalAmount: string; status: string; payments: number; paid: string; createdAt: string }
interface PreviewRow { memberId: string; memberNo: string; name: string; bales: number; groupName: string | null; coveredByGroup: string; totalKg: string; grossUsd: string; grossTzs: string; deductions: { code: string; description: string; amount: string; kind?: string }[]; totalDeductions: string; netTzs: string; debtBefore: string }

export function MarketDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<{ market: Market; bales: Bale[]; settlements: Settlement[]; batches: Batch[]; approval: { requestNo: string; status: string; decisionNote: string | null } | null }>(`/sales/markets/${id}`);
  const [tab, setTab] = useState<'bales' | 'settle' | 'pay'>('bales');
  const [edit, setEdit] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const nav = useNavigate();
  useEffect(() => { if (data?.settlements.length) setTab((t) => (t === 'bales' ? 'settle' : t)); }, [data?.settlements.length]);
  if (!data) return <Loading />;
  const m = data.market;
  const manage = may('sales.manage');
  const editable = m.status === 'OPEN' && data.settlements.length === 0;
  const unpaidApproved = data.settlements.filter((s) => s.status === 'APPROVED' && Number(s.netTzs) > 0);
  return (
    <>
      <PageHead title={<>{m.marketNo} <Badge status={m.settlement ?? m.status} label={m.settlement ? SETTLE[m.settlement] : m.status === 'OPEN' ? 'Wazi' : undefined} /></>}
        sub={<>{date(m.marketDate)} · {m.buyerName}{m.location ? ` · ${m.location}` : ''} · 1 USD = {num(m.exchangeRate ?? 0)} TZS</>}>
        <Link className="btn btn-secondary" to="/sales">← Masoko</Link>
        {manage && editable && <Button variant="secondary" onClick={() => setEdit(true)}>Hariri soko</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {data.approval && data.approval.status === 'PENDING' && <Alert kind="warn">Hesabu za wakulima ({data.approval.requestNo}) zinasubiri idhini ya Meneja.</Alert>}
      <div className="grid grid-kpi">
        <Kpi label="Mabelo yaliyouzwa" value={num(m.bales)} hint={m.rejected ? `${m.rejected} yamekataliwa` : undefined} />
        <Kpi label="Kilo" value={num(m.kg)} hint={`Wakulima ${m.farmers}`} />
        <Kpi tone="dark" label="Thamani (USD)" value={usd(m.usd)} hint={m.exchangeRate ? tsh(Number(m.usd) * Number(m.exchangeRate)) : undefined} />
        <Kpi label="Wastani wa bei" value={Number(m.kg) ? `${usd(Number(m.usd) / Number(m.kg))}/kg` : '—'} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[['bales', `Mabelo (${data.bales.length})`], ['settle', 'Hesabu za wakulima'], ['pay', `Malipo (${data.batches.length})`]]} />
      {tab === 'bales' && <Bales marketId={m.id} bales={data.bales} editable={manage && editable} onChanged={(msg) => { setOk(msg); reload(); }} />}
      {tab === 'settle' && (data.settlements.length ? (
        <Section pad={false} title="Hesabu za wakulima (settlement)" actions={<PrintButton />}>
          <div className="print-doc">
            <div className="print-only"><DocHead title="HESABU ZA MALIPO YA WAKULIMA" no={m.marketNo} sub={`${date(m.marketDate)} · ${m.buyerName ?? ''}`} /></div>
            <div className="table-wrap"><table className="table fin-table">
              <thead><tr><th>Mkulima</th><th className="num">Kilo</th><th className="num">Mauzo (TZS)</th><th>Makato</th><th className="num">Malipo halisi</th><th>Hali</th></tr></thead>
              <tbody>{data.settlements.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/sales/settlements/${s.id}`}>{s.memberName}</Link><div className="muted" style={{ fontSize: 12 }}>{s.memberNo} · {s.settlementNo}</div></td>
                  <td className="num">{num(s.totalKg)}</td><td className="num">{tsh(s.grossTzs)}<div className="muted" style={{ fontSize: 12 }}>{usd(s.grossUsd)}</div></td>
                  <td style={{ fontSize: 13 }}>{s.lines.map((l) => <div key={l.id}>{l.description}: {tsh(l.amount)}</div>)}</td>
                  <td className="num"><strong>{tsh(s.netTzs)}</strong></td>
                  <td><Badge status={s.status} label={SETTLE[s.status]} /></td>
                </tr>
              ))}
                <tr className="row-grand"><td>JUMLA ({data.settlements.length})</td>
                  <td className="num">{num(data.settlements.reduce((t, s) => t + Number(s.totalKg), 0))}</td>
                  <td className="num">{tsh(data.settlements.reduce((t, s) => t + Number(s.grossTzs), 0))}</td>
                  <td>{tsh(data.settlements.reduce((t, s) => t + Number(s.totalDeductions), 0))}</td>
                  <td className="num">{tsh(data.settlements.reduce((t, s) => t + Number(s.netTzs), 0))}</td><td /></tr>
              </tbody>
            </table></div>
          </div>
          {manage && unpaidApproved.length > 0 && (
            <div className="card-pad no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>Wakulima <strong>{unpaidApproved.length}</strong> wako tayari kulipwa ({tsh(unpaidApproved.reduce((t, s) => t + Number(s.netTzs), 0))})</span>
              <Button busy={busy} onClick={async () => {
                const r = await run(() => api<{ batch: Batch; approval: { requestNo: string } }>(`/sales/markets/${m.id}/payment-batch`, { method: 'POST' }));
                if (r) nav(`/sales/batches/${r.batch.id}`);
              }}>Andaa orodha ya malipo</Button>
            </div>
          )}
        </Section>
      ) : <SettlementPreview market={m} canSubmit={manage && editable} onDone={(msg) => { setOk(msg); reload(); }} />)}
      {tab === 'pay' && (
        <Section pad={false} title="Orodha za malipo">
          {data.batches.length === 0 ? <Empty>Hakuna orodha ya malipo bado. Hesabu zikiidhinishwa, andaa orodha kwenye "Hesabu za wakulima".</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Orodha</th><th className="num">Wakulima</th><th className="num">Jumla</th><th className="num">Imelipwa</th><th>Hali</th></tr></thead>
              <tbody>{data.batches.map((b) => (
                <tr key={b.id} onClick={() => nav(`/sales/batches/${b.id}`)} style={{ cursor: 'pointer' }}>
                  <td><strong>{b.batchNo}</strong><div className="muted" style={{ fontSize: 12 }}>{dateTime(b.createdAt)}</div></td>
                  <td className="num">{b.payments}</td><td className="num">{tsh(b.totalAmount)}</td><td className="num">{tsh(b.paid)}</td>
                  <td><Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Section>
      )}
      {edit && <MarketForm market={m} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </>
  );
}

interface Row { memberNo: string; baleNo: string; grossKg: string; netKg: string; grade: string; priceUsd: string; rejected: boolean }
const emptyRow = (): Row => ({ memberNo: '', baleNo: '', grossKg: '', netKg: '', grade: '', priceUsd: '', rejected: false });

function Bales({ marketId, bales, editable, onChanged }: { marketId: string; bales: Bale[]; editable: boolean; onChanged: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const { busy, error, run } = useAction();
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const filled = rows.filter((r) => r.memberNo.trim() || r.baleNo.trim());
  const valid = filled.length > 0 && filled.every((r) => r.memberNo.trim() && r.baleNo.trim() && Number(r.grossKg) > 0 && (r.rejected || Number(r.priceUsd) >= 0 && r.priceUsd !== ''));
  const save = async () => {
    const r = await run(() => api<{ bales: unknown[] }>(`/sales/markets/${marketId}/bales`, { method: 'POST', body: { bales: filled.map((x) => ({
      memberNo: x.memberNo.trim(), baleNo: x.baleNo.trim(), grossKg: x.grossKg, netKg: x.netKg || null, grade: x.grade || null,
      priceUsd: x.rejected ? null : x.priceUsd, rejected: x.rejected || undefined,
    })) } }));
    if (r) { setRows([emptyRow(), emptyRow(), emptyRow()]); onChanged(`Mabelo ${r.bales.length} yamehifadhiwa`); }
  };
  const applyPaste = () => {
    const parsed = pasteText.split(/\r?\n/).map((l) => l.split(/\t|;|,/).map((c) => c.trim())).filter((c) => c.length >= 3 && c[0])
      .map(([memberNo, baleNo, grossKg, grade = '', priceUsd = '']) => ({ ...emptyRow(), memberNo, baleNo, grossKg, grade, priceUsd }));
    if (parsed.length) setRows(parsed);
    setPaste(false); setPasteText('');
  };
  const sold = bales.filter((b) => b.status === 'SOLD');
  return (
    <div className="stack">
      {editable && (
        <Section title="Ingiza mabelo" actions={<Button size="sm" variant="secondary" onClick={() => setPaste(true)}>Bandika kutoka Excel</Button>}>
          <Alert>{error}</Alert>
          <div className="table-wrap"><table className="table bale-entry">
            <thead><tr><th>Namba ya mkulima</th><th>Namba ya belo / tiketi</th><th>Kilo</th><th>Kilo halisi</th><th>Daraja</th><th>Bei USD/kg</th><th>Limekataliwa</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>
                <td><input className="input" value={r.memberNo} onChange={(e) => set(i, { memberNo: e.target.value })} aria-label={`Namba ya mkulima ${i + 1}`} /></td>
                <td><input className="input" value={r.baleNo} onChange={(e) => set(i, { baleNo: e.target.value })} aria-label={`Namba ya belo ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" value={r.grossKg} onChange={(e) => set(i, { grossKg: e.target.value })} aria-label={`Kilo ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" value={r.netKg} onChange={(e) => set(i, { netKg: e.target.value })} aria-label={`Kilo halisi ${i + 1}`} placeholder="hiari" /></td>
                <td><input className="input" value={r.grade} onChange={(e) => set(i, { grade: e.target.value.toUpperCase() })} aria-label={`Daraja ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" step="0.0001" disabled={r.rejected} value={r.priceUsd} onChange={(e) => set(i, { priceUsd: e.target.value })} aria-label={`Bei ${i + 1}`} /></td>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.rejected} onChange={(e) => set(i, { rejected: e.target.checked })} aria-label={`Limekataliwa ${i + 1}`} /></td>
                <td>{rows.length > 1 && <Button size="sm" variant="ghost" aria-label="Ondoa" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <Button size="sm" variant="secondary" onClick={() => setRows([...rows, emptyRow()])}>+ Mstari</Button>
            <Button busy={busy} disabled={!valid} onClick={save}>Hifadhi mabelo {filled.length || ''}</Button>
          </div>
        </Section>
      )}
      <Section pad={false} title={`Mabelo yaliyoingizwa (${bales.length})`}>
        {bales.length === 0 ? <Empty>Bado hakuna mabelo.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Belo</th><th>Mkulima</th><th className="num">Kilo</th><th>Daraja</th><th className="num">Bei</th><th className="num">Thamani</th><th /></tr></thead>
            <tbody>{bales.map((b) => (
              <tr key={b.id} style={{ opacity: b.status === 'REJECTED' ? 0.6 : 1 }}>
                <td><strong>{b.baleNo}</strong>{b.status === 'REJECTED' && <div><span className="badge badge-bad">Limekataliwa</span> <span className="muted" style={{ fontSize: 12 }}>{b.rejectReason}</span></div>}</td>
                <td>{b.memberName}<div className="muted" style={{ fontSize: 12 }}>{b.memberNo}</div></td>
                <td className="num">{num(b.netKg ?? b.grossKg)}</td><td>{b.grade ?? '—'}</td>
                <td className="num">{b.priceUsd ? usd(b.priceUsd) : '—'}</td><td className="num">{b.valueUsd ? usd(b.valueUsd) : '—'}</td>
                <td className="num">{editable && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api(`/sales/bales/${b.id}`, { method: 'DELETE' }))) onChanged(`Belo ${b.baleNo} limeondolewa`); }}>Ondoa</Button>}</td>
              </tr>
            ))}
              <tr className="row-total"><td colSpan={2}>Jumla (yaliyouzwa)</td><td className="num">{num(sold.reduce((t, b) => t + Number(b.netKg ?? b.grossKg), 0))}</td><td /><td />
                <td className="num">{usd(sold.reduce((t, b) => t + Number(b.valueUsd ?? 0), 0))}</td><td /></tr>
            </tbody>
          </table></div>
        )}
      </Section>
      {paste && (
        <Modal open title="Bandika mabelo kutoka Excel" onClose={() => setPaste(false)} footer={<><Button variant="secondary" onClick={() => setPaste(false)}>Ghairi</Button><Button onClick={applyPaste}>Weka kwenye fomu</Button></>}>
          <p className="muted">Nakili safu kutoka Excel kwa mpangilio huu: <strong>Namba ya mkulima · Namba ya belo · Kilo · Daraja · Bei USD</strong></p>
          <textarea className="textarea" rows={10} value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label="Data ya mabelo" placeholder={'UHA-000001\tT-1001\t102.5\tL1F\t2.10'} />
        </Modal>
      )}
    </div>
  );
}

function SettlementPreview({ market, canSubmit, onDone }: { market: Market; canSubmit: boolean; onDone: (m: string) => void }) {
  const [nonSellers, setNonSellers] = useState(false);
  const pv = useFetch<{ rows: PreviewRow[]; totals: { farmers: number; kg: string; grossUsd: string; grossTzs: string; deductions: string; netTzs: string }; guarantees: { groupName: string; debtorName: string; remaining: string; covered: string; uncovered: string; sold: boolean }[] }>(market.bales ? `/sales/markets/${market.id}/preview` : null, { includeNonSellers: nonSellers ? 'true' : undefined });
  const { busy, error, run } = useAction();
  if (!market.bales) return <Empty>Ingiza mabelo kwanza.</Empty>;
  if (pv.error) return <Alert>{pv.error}</Alert>;
  if (!pv.data) return <Loading />;
  const t = pv.data.totals;
  return (
    <Section pad={false} title="Hakiki hesabu kabla ya kuwasilisha" actions={canSubmit ? <Button busy={busy} onClick={async () => {
      const r = await run(() => api<{ approval: { requestNo: string } }>(`/sales/markets/${market.id}/settlements`, { method: 'POST', body: { includeNonSellers: nonSellers } }));
      if (r) onDone(`Hesabu za wakulima ${t.farmers} zimetumwa kwa Meneja (${r.approval.requestNo})`);
    }}>Wasilisha kwa Meneja</Button> : undefined}>
      <Alert>{error}</Alert>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <Alert kind="warn">Hesabu hizi bado si rasmi. Zikiidhinishwa na Meneja, mauzo na makato yanaingia kwenye ledger za wakulima na daftari kuu, na soko linafungwa.</Alert>
        {pv.data.guarantees.length > 0 && (
          <div className="alert alert-warn" role="status">
            <strong>Dhamana ya kikundi</strong> — wanachama hawa hawajamaliza madeni yao; salio linakatwa kwa wenzao wa kikundi waliouza soko hili (kwa uwiano wa malipo yao):
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pv.data.guarantees.map((g, i) => (
              <li key={i}>{g.debtorName} · {g.groupName}{!g.sold ? ' (hajauza soko hili)' : ''}: salio {tsh(g.remaining)} → wenzake wanalipa <strong>{tsh(g.covered)}</strong>{Number(g.uncovered) > 0 ? `, linabaki ${tsh(g.uncovered)}` : ''}</li>
            ))}</ul>
          </div>
        )}
        <label className="check" style={{ marginTop: 0 }}><input type="checkbox" checked={nonSellers} onChange={(e) => setNonSellers(e.target.checked)} /> Kata pia madeni ya wanakikundi ambao hawajauza kwenye soko hili (mf. soko la mwisho la msimu)</label>
      </div>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Mkulima</th><th className="num">Kilo</th><th className="num">Mauzo</th><th>Makato</th><th className="num">Malipo halisi</th></tr></thead>
        <tbody>{pv.data.rows.map((r) => (
          <tr key={r.memberId}>
            <td>{r.name}<div className="muted" style={{ fontSize: 12 }}>{r.memberNo}{r.groupName ? ` · ${r.groupName}` : ''} · mabelo {r.bales}{Number(r.debtBefore) > 0 ? ` · deni ${tsh(r.debtBefore)}` : ''}</div></td>
            <td className="num">{num(r.totalKg)}</td>
            <td className="num">{tsh(r.grossTzs)}<div className="muted" style={{ fontSize: 12 }}>{usd(r.grossUsd)}</div></td>
            <td style={{ fontSize: 13 }}>{r.deductions.map((d, k) => <div key={k} className={d.kind === 'GROUP_GUARANTEE' ? 'money-neg' : ''}>{d.description}: {tsh(d.amount)}</div>)}
              {Number(r.coveredByGroup) > 0 && <div className="money-pos">Salio la deni limelipwa na kikundi: {tsh(r.coveredByGroup)}</div>}</td>
            <td className="num"><strong>{tsh(r.netTzs)}</strong></td>
          </tr>
        ))}
          <tr className="row-grand"><td>JUMLA · wakulima {t.farmers}</td><td className="num">{num(t.kg)}</td><td className="num">{tsh(t.grossTzs)}</td><td>{tsh(t.deductions)}</td><td className="num">{tsh(t.netTzs)}</td></tr>
        </tbody>
      </table></div>
    </Section>
  );
}

// ------------------------------ ORODHA YA MALIPO ------------------------------
interface Payment { id: string; memberId: string; memberNo: string; memberName: string; phone: string | null; amount: string; method: string; provider: string | null; destination: string; status: string; providerRef: string | null; failureReason: string | null; settlementNo: string | null; txnNo: string | null; paidAt: string | null }
interface BatchData {
  batch: { id: string; batchNo: string; totalAmount: string; status: string; createdAt: string };
  market: { marketNo: string; marketDate: string; buyerName: string | null } | null;
  approval: { requestNo: string; decidedBy: string | null; decidedAt: string | null; status: string } | null;
  payments: Payment[]; summary: { MOBILE_MONEY: string; BANK: string; CASH: string; paid: string; pending: number };
}

export function BatchDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<BatchData>(`/sales/batches/${id}`);
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>(may('sales.manage') ? '/finance/accounts' : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'confirm' | 'fail' | null>(null);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const b = data.batch;
  const payable = ['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status) && may('sales.manage');
  const open = data.payments.filter((p) => p.status === 'PENDING' || p.status === 'FAILED');
  const pickedTotal = data.payments.filter((p) => picked.has(p.id)).reduce((t, p) => t + Number(p.amount), 0);
  const toggle = (pid: string) => { const n = new Set(picked); if (n.has(pid)) n.delete(pid); else n.add(pid); setPicked(n); };
  const groups = (['MOBILE_MONEY', 'BANK', 'CASH'] as const).map((k) => [k, data.payments.filter((p) => p.method === k)] as const).filter(([, l]) => l.length);
  return (
    <>
      <PageHead title={<>{b.batchNo} <Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} /></>} sub={<>{data.market ? `Soko ${data.market.marketNo} · ${date(data.market.marketDate)} · ` : ''}Jumla {tsh(b.totalAmount)} · Imelipwa {tsh(data.summary.paid)}</>}>
        <Button variant="secondary" className="no-print" onClick={() => window.history.back()}>← Rudi</Button>
        <Button variant="secondary" onClick={() => apiDownload(`/sales/batches/${b.id}/csv`, { filename: `malipo-${b.batchNo}.csv` })}>CSV ya benki / M-Pesa</Button>
        <PrintButton label="Chapisha orodha" />
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {b.status === 'DRAFT' && <Alert kind="warn">Orodha hii inasubiri idhini ya Meneja. Hakuna malipo yanayofanyika kabla ya idhini.</Alert>}
      {payable && open.length > 0 && <Alert kind="warn">Fanya malipo halisi (bulk M-Pesa, benki au taslimu), kisha chagua waliolipwa na uthibitishe hapa kwa kumbukumbu ya malipo. Mfumo hauweki malipo "yamefanikiwa" wenyewe.</Alert>}
      <div className="grid grid-kpi no-print">
        <Kpi label="Kwa simu (M-Pesa n.k.)" value={tsh(data.summary.MOBILE_MONEY)} />
        <Kpi label="Kwa benki" value={tsh(data.summary.BANK)} />
        <Kpi label="Taslimu" value={tsh(data.summary.CASH)} />
        <Kpi tone={data.summary.pending ? 'gold' : undefined} label="Hawajalipwa bado" value={num(data.summary.pending)} />
      </div>
      <section className="card card-pad print-doc">
        <DocHead title="ORODHA YA MALIPO YA WAKULIMA" no={b.batchNo} sub={data.market ? `Soko ${data.market.marketNo} · ${data.market.buyerName ?? ''}` : undefined} />
        {groups.map(([k, list]) => (
          <div key={k} className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="table fin-table">
              <thead><tr>{payable && <th className="no-print" style={{ width: 36 }}><input type="checkbox" aria-label={`Chagua wote ${METHOD[k]}`} onChange={(e) => {
                const n = new Set(picked); list.filter((p) => p.status === 'PENDING' || p.status === 'FAILED').forEach((p) => (e.target.checked ? n.add(p.id) : n.delete(p.id))); setPicked(n);
              }} /></th>}<th>{METHOD[k]} — Mkulima</th><th>{k === 'CASH' ? 'Sahihi ya mpokeaji' : 'Namba / akaunti'}</th><th className="num">Kiasi</th><th>Hali</th></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className={picked.has(p.id) ? 'row-picked' : ''}>
                    {payable && <td className="no-print">{(p.status === 'PENDING' || p.status === 'FAILED') && <input type="checkbox" aria-label={`Chagua ${p.memberName}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />}</td>}
                    <td>{p.memberName}<div className="muted" style={{ fontSize: 12 }}>{p.memberNo}{p.phone ? ` · ${phone(p.phone)}` : ''}</div></td>
                    <td>{k === 'CASH' ? <span className="sign-line" /> : <>{p.provider ? `${p.provider === 'MPESA' ? 'M-Pesa' : p.provider} · ` : ''}{k === 'MOBILE_MONEY' ? phone(p.destination) : p.destination}</>}</td>
                    <td className="num"><strong>{tsh(p.amount)}</strong></td>
                    <td><Badge status={p.status} />{p.txnNo && <div className="muted" style={{ fontSize: 12 }}>{p.txnNo} · {p.providerRef}</div>}{p.failureReason && <div className="muted" style={{ fontSize: 12 }}>{p.failureReason}</div>}</td>
                  </tr>
                ))}
                <tr className="row-total">{payable && <td className="no-print" />}<td colSpan={2}>Jumla — {METHOD[k]} ({list.length})</td><td className="num"><strong>{tsh(list.reduce((t, p) => t + Number(p.amount), 0))}</strong></td><td /></tr>
              </tbody>
            </table>
          </div>
        ))}
        {data.approval && <p className="muted">Idhini: {data.approval.requestNo}{data.approval.decidedBy ? ` · ${data.approval.decidedBy} · ${dateTime(data.approval.decidedAt)}` : ''}</p>}
        <Signatures items={['Ameandaa (Mhasibu)', 'Ameidhinisha (Meneja)', 'Mwenyekiti wa Bodi']} />
      </section>
      {payable && picked.size > 0 && (
        <div className="sticky-bar no-print">
          <span>Umechagua <strong>{picked.size}</strong> · {tsh(pickedTotal)}</span>
          <div className="actions">
            <Button variant="secondary" onClick={() => setMode('fail')}>Weka "yameshindwa"</Button>
            <Button onClick={() => setMode('confirm')}>Thibitisha yamelipwa</Button>
          </div>
        </div>
      )}
      {mode === 'confirm' && (
        <Modal open title={`Thibitisha malipo ${picked.size} (${tsh(pickedTotal)})`} onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button busy={busy} disabled={!accountId || reference.trim().length < 2} onClick={async () => {
            const r = await run(() => api<{ confirmed: number; status: string }>(`/sales/batches/${b.id}/confirm`, { method: 'POST', body: { accountId, paymentIds: [...picked], reference } }));
            if (r) { setOk(`Malipo ${r.confirmed} yamethibitishwa na kuingia kwenye ledger za wakulima`); setPicked(new Set()); setMode(null); reload(); }
          }}>Thibitisha</Button></>}>
          <Alert kind="warn">Thibitisha tu malipo ambayo fedha zimeshatoka kweli. Kila mkulima atapata muamala wake na ledger yake itaonyesha malipo.</Alert>
          <Alert>{error}</Alert>
          <div className="form-grid">
            <SelectField label="Akaunti iliyolipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
            <TextField label="Kumbukumbu ya malipo *" value={reference} onChange={setReference} placeholder="mf. namba ya bulk payment / cheki" />
          </div>
        </Modal>
      )}
      {mode === 'fail' && (
        <Modal open title="Malipo yameshindwa" onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
            const r = await run(() => api<{ failed: number }>(`/sales/batches/${b.id}/fail`, { method: 'POST', body: { paymentIds: [...picked], reason } }));
            if (r) { setOk(`Malipo ${r.failed} yamewekwa "yameshindwa" — yatalipwa tena baadaye`); setPicked(new Set()); setMode(null); reload(); }
          }}>Hifadhi</Button></>}>
          <TextField label="Sababu *" value={reason} onChange={setReason} placeholder="mf. Namba ya M-Pesa haijasajiliwa" />
        </Modal>
      )}
    </>
  );
}

// ------------------------------ TAARIFA YA MKULIMA ------------------------------
export function SettlementStatement() {
  const { id } = useParams();
  const { data } = useFetch<{
    settlement: { settlementNo: string; totalKg: string; grossUsd: string; exchangeRate: string; grossTzs: string; totalDeductions: string; netTzs: string; status: string; approvedAt: string | null };
    member: { firstName: string; lastName: string; memberNo: string; village: string | null; phone: string | null };
    market: { marketNo: string; marketDate: string; buyerName: string | null } | null;
    bales: { id: string; baleNo: string; grossKg: string; netKg: string | null; grade: string | null; priceUsd: string | null; valueUsd: string | null; status: string }[];
    lines: { id: string; description: string; amount: string }[];
    payments: { id: string; amount: string; method: string; status: string; providerRef: string | null; paidAt: string | null }[];
  }>(`/sales/settlements/${id}`);
  if (!data) return <Loading />;
  const s = data.settlement;
  return (
    <>
      <div className="actions no-print" style={{ justifyContent: 'space-between', marginBottom: 12 }}><a href="#" onClick={(e) => { e.preventDefault(); history.back(); }}>← Rudi</a><PrintButton /></div>
      <article className="card card-pad print-doc">
        <DocHead title="TAARIFA YA MAUZO YA MKULIMA" no={s.settlementNo} sub={data.market ? `${data.market.marketNo} · ${date(data.market.marketDate)}` : undefined} />
        <dl className="dl">
          <dt>Mkulima</dt><dd><strong>{data.member.firstName} {data.member.lastName}</strong> · {data.member.memberNo}{data.member.village ? ` · ${data.member.village}` : ''}</dd>
          <dt>Mnunuzi</dt><dd>{data.market?.buyerName ?? '—'} · 1 USD = {num(s.exchangeRate)} TZS</dd>
          <dt>Hali</dt><dd><Badge status={s.status} label={SETTLE[s.status]} /></dd>
        </dl>
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>Belo</th><th>Daraja</th><th className="num">Kilo</th><th className="num">Bei (USD)</th><th className="num">Thamani (USD)</th></tr></thead>
          <tbody>
            {data.bales.map((b) => <tr key={b.id} style={{ opacity: b.status === 'REJECTED' ? 0.55 : 1 }}><td>{b.baleNo}{b.status === 'REJECTED' && ' (limekataliwa)'}</td><td>{b.grade ?? '—'}</td><td className="num">{num(b.netKg ?? b.grossKg)}</td><td className="num">{b.priceUsd ? usd(b.priceUsd) : '—'}</td><td className="num">{b.valueUsd ? usd(b.valueUsd) : '—'}</td></tr>)}
            <tr className="row-total"><td colSpan={2}>Jumla</td><td className="num">{num(s.totalKg)}</td><td /><td className="num">{usd(s.grossUsd)}</td></tr>
          </tbody>
        </table></div>
        <table className="table fin-table" style={{ maxWidth: 520, marginLeft: 'auto' }}><tbody>
          <tr><td>Thamani ya mauzo (TZS)</td><td className="num"><Amt v={s.grossTzs} strong /></td></tr>
          {data.lines.map((l) => <tr key={l.id}><td>Toa: {l.description}</td><td className="num">(<Amt v={l.amount} />)</td></tr>)}
          <tr className="row-grand"><td>MALIPO HALISI</td><td className="num"><Amt v={s.netTzs} strong zero="0" /></td></tr>
          {data.payments.filter((p) => p.status === 'SUCCESS').map((p) => <tr key={p.id}><td>Imelipwa ({METHOD[p.method]}) {p.providerRef ?? ''} · {date(p.paidAt)}</td><td className="num"><Amt v={p.amount} /></td></tr>)}
        </tbody></table>
        <Signatures items={['Mhasibu', 'Mkulima']} />
      </article>
    </>
  );
}

// ------------------------------ MALIPO YA MNUNUZI ------------------------------
interface BuyerRow { id: string; marketNo: string; marketDate: string; buyerName: string | null; due: string; paid: string; outstanding: string; lastPaid: string | null; days: number; bucket: string }
const BUCKET: Record<string, string> = { '0-30': 'Siku 0–30', '31-60': 'Siku 31–60', '61-90': 'Siku 61–90', '90+': 'Zaidi ya siku 90' };

function Buyers({ canRecord }: { canRecord: boolean }) {
  const { data, reload } = useFetch<{ data: BuyerRow[]; buckets: Record<string, string>; unallocated: string; totalOutstanding: string; byBuyer: { name: string; outstanding: string }[] }>('/sales/buyers');
  const [pay, setPay] = useState<BuyerRow | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <Alert kind="ok">{ok}</Alert>
      <div className="grid grid-kpi">
        <Kpi tone={Number(data.totalOutstanding) > 0 ? 'gold' : 'dark'} label="Wanunuzi wanadaiwa" value={tsh(data.totalOutstanding)} />
        {Object.entries(data.buckets).map(([k, v]) => <Kpi key={k} tone={k === '90+' && Number(v) > 0 ? 'bad' : k === '61-90' && Number(v) > 0 ? 'warn' : undefined} label={BUCKET[k]} value={tsh(v)} />)}
      </div>
      {Number(data.unallocated) !== 0 && <Alert kind="warn">Malipo ya {tsh(data.unallocated)} yalirekodiwa kama "Mauzo ya tumbaku" bila kuunganishwa na soko. Yanapunguza deni la wanunuzi kwenye daftari kuu, lakini hayaonekani kwenye soko lolote hapa chini.</Alert>}
      <section className="card">
        {data.data.length === 0 ? <Empty>Hakuna soko lililoidhinishwa bado.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Soko</th><th>Mnunuzi</th><th className="num">Anadaiwa</th><th className="num">Amelipa</th><th className="num">Salio</th><th>Umri</th><th /></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/sales/markets/${r.id}`}><strong>{r.marketNo}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{date(r.marketDate)}</div></td>
                <td>{r.buyerName ?? '—'}</td>
                <td className="num">{tsh(r.due)}</td><td className="num">{tsh(r.paid)}{r.lastPaid && <div className="muted" style={{ fontSize: 12 }}>{date(r.lastPaid)}</div>}</td>
                <td className="num"><strong className={Number(r.outstanding) > 0 ? 'money-neg' : ''}>{tsh(r.outstanding)}</strong></td>
                <td>{r.bucket === 'PAID' ? <Badge status="PAID" /> : <span className={`badge ${r.days > 60 ? 'badge-bad' : r.days > 30 ? 'badge-warn' : 'badge-neutral'}`}>Siku {r.days}</span>}</td>
                <td className="num">{canRecord && Number(r.outstanding) > 0 && <Button size="sm" onClick={() => setPay(r)}>Rekodi malipo</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {pay && <BuyerPayment row={pay} onClose={() => setPay(null)} onDone={(m) => { setPay(null); setOk(m); reload(); }} />}
    </div>
  );
}

function BuyerPayment({ row, onClose, onDone }: { row: BuyerRow; onClose: () => void; onDone: (m: string) => void }) {
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>('/finance/accounts');
  const [f, setF] = useState({ amount: row.outstanding, accountId: '', txnDate: today(), reference: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Malipo ya ${row.buyerName ?? 'mnunuzi'} — ${row.marketNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!f.accountId || !(Number(f.amount) > 0)} onClick={async () => {
        const r = await run(() => api<{ transaction: { txnNo: string } }>('/finance/income', { method: 'POST', body: {
          category: 'TOBACCO_SALES', marketId: row.id, amount: f.amount, accountId: f.accountId, txnDate: f.txnDate, reference: f.reference || null,
          payee: row.buyerName, description: `Malipo ya mnunuzi ${row.buyerName ?? ''} soko ${row.marketNo}`.replace('  ', ' '),
        } }));
        if (r) onDone(`${r.transaction.txnNo}: malipo ya ${row.marketNo} yamerekodiwa`);
      }}>Rekodi</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Kiasi kilichopokelewa (TSh) *" type="number" min="1" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} help={`Salio la soko hili: ${tsh(row.outstanding)}`} />
        <SelectField label="Akaunti iliyopokea *" value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name })) ?? []} />
        <TextField label="Tarehe" type="date" max={today()} value={f.txnDate} onChange={(v) => setF({ ...f, txnDate: v })} />
        <TextField label="Kumbukumbu (namba ya malipo ya benki)" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} />
      </div>
    </Modal>
  );
}
