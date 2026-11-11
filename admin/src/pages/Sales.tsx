// =====================================================================
//  MAUZO YA TUMBAKU NA MAKATO (Mhasibu)
//   Masoko -> mabelo -> hesabu za wakulima (settlement) -> idhini -> orodha ya malipo -> malipo yaliyothibitishwa
// =====================================================================
import { useT } from '../lib/prefs';
import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, apiDownload } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, num, phone, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { Amt, DocHead, PrintButton, Signatures, today } from './acc-common';
import { TTB_2026_27, TTB_2026_27_LABEL } from '../lib/ttb-grades';

const usd = (v: string | number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { MOBILE_MONEY: 'Simu', BANK: 'Benki', CASH: 'Taslimu' };
const SETTLE: Record<string, string> = { DRAFT: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — haijalipwa', PAID: 'Imelipwa', CANCELLED: 'Imefutwa' };

interface Market {
  id: string; seasonId?: string; marketNo: string; marketDate: string; location: string | null; buyerName: string | null; exchangeRate: string | null; status: string; notes: string | null; buyerDueDate?: string | null;
  bales: number; rejected: number; farmers: number; kg: string; usd: string; settlement: string | null; grossTzs?: string; netTzs?: string; paid?: string; approvalId: string | null;
}
interface Limits { rate: { min: number; max: number; warnMin: number; warnMax: number }; price: { max: number; warn: number }; kg: { max: number; warn: number } }
const DEFAULT_LIMITS: Limits = { rate: { min: 1000, max: 10000, warnMin: 2000, warnMax: 4000 }, price: { max: 20, warn: 6 }, kg: { max: 300, warn: 150 } };
const TTB = ['TTB', 'TOBACCOBOARD', 'TANZANIATOBACCOBOARD', 'BODIYATUMBAKU'];
const isTtb = (n: string) => TTB.includes(n.trim().toUpperCase().replace(/[^A-Z]/g, ''));
/** Hali ya kiwango cha fedha: kosa (kinakataliwa), onyo, au sawa */
function rateCheck(v: string | number | null | undefined, L: Limits): { level: 'error' | 'warn' | null; text: string | null } {
  if (v === '' || v === null || v === undefined) return { level: null, text: null };
  const r = Number(v);
  if (!(r >= L.rate.min && r <= L.rate.max)) return { level: 'error', text: `Kiwango ${num(r)} si halisi. Weka shilingi ngapi kwa dola 1 (mf. 2,550): kati ya ${num(L.rate.min)} na ${num(L.rate.max)}.` };
  if (r < L.rate.warnMin || r > L.rate.warnMax) return { level: 'warn', text: `Kiwango ${num(r)} si cha kawaida — hakiki na kiwango cha BoT cha siku ya soko.` };
  return { level: null, text: null };
}
/** Hali ya mstari wa belo */
function baleCheck(r: { grossKg: string; netKg?: string | null; priceUsd?: string | null; rejected?: boolean }, L: Limits): { level: 'error' | 'warn' | null; text: string | null } {
  const kg = Number(r.grossKg), net = r.netKg ? Number(r.netKg) : null, price = r.priceUsd ? Number(r.priceUsd) : null;
  if (kg > L.kg.max) return { level: 'error', text: `Kilo ${num(kg)} ni nyingi mno kwa belo moja (mwisho ${L.kg.max})` };
  if (net !== null && net > kg) return { level: 'error', text: 'Kilo halisi zinazidi kilo za belo' };
  if (!r.rejected && price !== null && price > L.price.max) return { level: 'error', text: `Bei $${num(price)}/kg si halisi — inaonekana ni bei ya shilingi. Weka bei kwa DOLA (mf. 2.35)` };
  if (!r.rejected && price !== null && price > L.price.warn) return { level: 'warn', text: `Bei $${num(price)}/kg iko juu kuliko kawaida — hakiki` };
  if (kg > L.kg.warn) return { level: 'warn', text: `Kilo ${num(kg)} ni nyingi kuliko kawaida — hakiki` };
  return { level: null, text: null };
}

interface Rule { id: string; name: string; code: string; basis: string; basisLabel: string; rate: string; currency: string; priority: number; glAccountCode: string | null; glCode: string; isActive: boolean }

export function Sales() {
  const t = useT();
  const { may } = useAuth();
  const [tab, setTab] = useState<'markets' | 'buyers' | 'rules' | 'grades'>(() => { const q = new URLSearchParams(window.location.search).get('tab'); return q === 'buyers' || q === 'grades' ? q : 'markets'; });
  const sum = useFetch<{ season: { name: string }; pending: { markets: number; open: number; waiting: number; bales: number; kg: string; usd: string; tzs: string }; farmers: number; kg: string; grossTzs: string; deductions: string; netTzs: string; paid: string; unpaid: string; deductionsByRule: { name: string; amount: string }[] }>('/sales/summary');
  return (
    <>
      <PageHead title="Mauzo ya tumbaku na makato" sub={<>{t('Masoko, mabelo, makato ya kisheria, deni la pembejeo na malipo ya wakulima')}{sum.data ? <> {t('· Msimu')} <strong>{sum.data.season.name}</strong></> : null}</>} />
      {sum.data && sum.data.pending.markets > 0 && (
        <div className="pending-note" role="status">
          <span className="pn-dot" />
          <div>
            <strong>{sum.data.pending.open > 0 && `Masoko ${sum.data.pending.open} yako wazi`}{sum.data.pending.open > 0 && sum.data.pending.waiting > 0 && ' · '}{sum.data.pending.waiting > 0 && `${sum.data.pending.waiting} yanasubiri idhini ya Meneja`}</strong>
            {' '}— mabelo {num(sum.data.pending.bales)} · kilo {num(sum.data.pending.kg)} · {usd(sum.data.pending.usd)}{Number(sum.data.pending.tzs) > 0 && <> (≈ {tsh(sum.data.pending.tzs)})</>}.
            <div className="muted">{t('Takwimu za juu zinahesabu mauzo yaliyoidhinishwa na Meneja tu. Mauzo haya yataingia baada ya hesabu za wakulima kuidhinishwa.')}</div>
          </div>
        </div>
      )}
      {sum.data && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Mauzo ya wakulima (ghafi)" value={tsh(sum.data.grossTzs)} hint={`Kilo ${num(sum.data.kg)} · wakulima ${num(sum.data.farmers)}`} />
          <Kpi label="Makato yote" value={tsh(sum.data.deductions)} />
          <Kpi label="Malipo halisi ya wakulima" value={tsh(sum.data.netTzs)} />
          <Kpi tone={Number(sum.data.unpaid) > 0 ? 'gold' : undefined} label="Bado hawajalipwa" value={tsh(sum.data.unpaid)} hint={`Wamelipwa ${tsh(sum.data.paid)}`} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[['markets', 'Masoko'], ['grades', 'Bei za madaraja'], ['buyers', 'Malipo ya mnunuzi'], ['rules', 'Kanuni za makato']]} />
      {tab === 'grades' && <GradePrices canManage={may('sales.manage')} />}
      {tab === 'buyers' && <Buyers canRecord={may('finance.record')} />}
      {tab === 'markets' && <Markets canManage={may('sales.manage')} />}
      {tab === 'rules' && <Rules canManage={may('sales.manage')} byRule={sum.data?.deductionsByRule ?? []} />}
    </>
  );
}

function Markets({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { data, loading, reload } = useFetch<{ data: Market[] }>('/sales/markets');
  const [add, setAdd] = useState(false);
  const nav = useNavigate();
  return (
    <section className="card">
      <div className="toolbar"><div className="grow" />{canManage && <Button onClick={() => setAdd(true)}>{t('+ Soko jipya')}</Button>}</div>
      {loading && !data ? <Loading /> : !data?.data.length ? <Empty>{t('Bado hakuna soko msimu huu. Anza kwa kuweka kanuni za makato, kisha fungua soko.')}</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('Soko')}</th><th>{t('Mnunuzi')}</th><th className="num">{t('Mabelo / kilo')}</th><th className="num">{t('Thamani')}</th><th className="num">{t('Malipo halisi')}</th><th>{t('Hali')}</th></tr></thead>
          <tbody>{data.data.map((m) => (
            <tr key={m.id} onClick={() => nav(`/sales/markets/${m.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{m.marketNo}</strong><div className="muted" style={{ fontSize: 12 }}>{date(m.marketDate)}{m.location ? ` · ${m.location}` : ''}</div></td>
              <td>{m.buyerName ?? '—'}<div className={rateCheck(m.exchangeRate, DEFAULT_LIMITS).level === 'error' ? 'money-neg' : 'muted'} style={{ fontSize: 12 }}>{m.exchangeRate ? `1 USD = ${num(m.exchangeRate)} TZS` : ''}{rateCheck(m.exchangeRate, DEFAULT_LIMITS).level === 'error' ? ' · kiwango si halisi' : ''}</div></td>
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
  const t = useT();
  const [f, setF] = useState({ marketDate: market?.marketDate ?? today(), buyerName: market?.buyerName ?? '', exchangeRate: market?.exchangeRate ?? '', location: market?.location ?? '', notes: market?.notes ?? '', buyerDueDate: market?.buyerDueDate ?? '' });
  const opts = useFetch<{ data: { name: string; official: boolean }[]; limits: Limits }>('/sales/buyer-options');
  const L = opts.data?.limits ?? DEFAULT_LIMITS;
  const known = opts.data?.data ?? [];
  const [other, setOther] = useState(false);
  const inList = known.some((b) => b.name.toUpperCase() === f.buyerName.trim().toUpperCase());
  const typing = other || (!!f.buyerName && !inList && !!opts.data) || (opts.data !== undefined && known.length === 0);
  const rc = rateCheck(f.exchangeRate, L);
  const ttb = isTtb(f.buyerName);
  const { busy, error, run } = useAction();
  const valid = f.buyerName.trim().length >= 2 && !ttb && Number(f.exchangeRate) > 0 && rc.level !== 'error';
  return (
    <Modal open title={market ? `Hariri ${market.marketNo}` : 'Soko jipya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={!valid} onClick={async () => {
        const body = { ...f, location: f.location || null, notes: f.notes || null, buyerDueDate: f.buyerDueDate || null };
        const r = await run(() => market ? api<{ market: Market }>(`/sales/markets/${market.id}`, { method: 'PATCH', body }) : api<{ market: Market }>('/sales/markets', { method: 'POST', body }));
        if (r) onDone(r.market.id);
      }}>{t('Hifadhi')}</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Tarehe ya soko *" type="date" value={f.marketDate} onChange={(v) => setF({ ...f, marketDate: v })} />
        <div>
          {!typing ? (
            <SelectField label="Kampuni ya ununuzi *" value={inList ? known.find((b) => b.name.toUpperCase() === f.buyerName.trim().toUpperCase())!.name : ''} placeholder="Chagua mnunuzi"
              onChange={(v) => { if (v === '__other') { setOther(true); setF({ ...f, buyerName: '' }); } else setF({ ...f, buyerName: v }); }}
              options={[...known.map((b) => ({ value: b.name, label: b.name })), { value: '__other', label: '+ Mnunuzi mwingine (andika jina)' }]} />
          ) : (
            <TextField label="Kampuni ya ununuzi *" value={f.buyerName} onChange={(v) => setF({ ...f, buyerName: v })} placeholder="mf. Alliance One, TLTC" autoFocus={other}
              help={known.length ? undefined : 'Jina kamili la kampuni inayonunua tumbaku'} />
          )}
          {typing && known.length > 0 && <button type="button" className="link-btn" onClick={() => { setOther(false); setF({ ...f, buyerName: '' }); }}>{t('← Chagua kutoka orodha')}</button>}
          {ttb && <p className="name-note bad">TTB (Bodi ya Tumbaku) ni msimamizi, si mnunuzi. Weka kampuni inayonunua tumbaku.</p>}
        </div>
        <div>
          <TextField label="Kiwango: 1 USD = TZS *" type="number" min="1" value={f.exchangeRate} onChange={(v) => setF({ ...f, exchangeRate: v })} placeholder="mf. 2550" help={rc.text ? undefined : 'Shilingi ngapi kwa dola 1 siku ya soko (mf. kiwango cha BoT)'} />
          {rc.text && <p className={`name-note ${rc.level === 'error' ? 'bad' : 'warn'}`}>{rc.text}</p>}
        </div>
        <TextField label="Mahali" value={f.location} onChange={(v) => setF({ ...f, location: v })} />
        <TextField label="Tarehe mnunuzi atalipa (hiari)" type="date" min={f.marketDate} value={f.buyerDueDate} onChange={(v) => setF({ ...f, buyerDueDate: v })} help="Isipowekwa: siku 30 baada ya soko" />
      </div>
      <TextField label="Maelezo" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
    </Modal>
  );
}

function Rules({ canManage, byRule }: { canManage: boolean; byRule: { name: string; amount: string }[] }) {
  const t = useT();
  const { data, reload } = useFetch<{ data: Rule[]; season: { name: string } }>('/sales/deduction-rules');
  const [edit, setEdit] = useState<Rule | 'new' | null>(null);
  const deducted = new Map(byRule.map((b) => [b.name, b.amount]));
  return (
    <section className="card">
      <div className="toolbar">
        <span className="muted">Makato yanakatwa kwa mpangilio (namba ndogo kwanza). Deni la pembejeo linawekwa mwisho ili ushuru wa kisheria ukatwe kwanza.</span>
        <div className="grow" />
        {canManage && <Button onClick={() => setEdit('new')}>{t('+ Kanuni mpya')}</Button>}
      </div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty>Hakuna kanuni za makato msimu huu. Ongeza mf. Ushuru wa Halmashauri (3%), Ushuru wa Chama Kikuu, Ushuru wa chama, Deni la pembejeo.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>#</th><th>{t('Kanuni')}</th><th>{t('Msingi')}</th><th className="num">{t('Kiwango')}</th><th>{t('Akaunti')}</th><th className="num">{t('Imekatwa msimu huu')}</th><th /></tr></thead>
          <tbody>{data.data.map((r) => (
            <tr key={r.id} style={{ opacity: r.isActive ? 1 : 0.5 }}>
              <td>{r.priority}</td>
              <td><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.code}{!r.isActive && ' · imezimwa'}</div></td>
              <td>{r.basisLabel}</td>
              <td className="num">{r.basis === 'OUTSTANDING_LOAN' ? 'Deni lote' : r.basis === 'PERCENT_OF_GROSS' ? `${num(r.rate)}%` : `${r.currency === 'USD' ? usd(r.rate) : tsh(r.rate)}${r.basis === 'PER_KG' ? ' /kg' : ''}`}</td>
              <td>{r.glCode}</td>
              <td className="num">{deducted.has(r.name) ? tsh(deducted.get(r.name)!) : '—'}</td>
              <td className="num">{canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>{t('Hariri')}</Button>}</td>
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
  const t = useT();
  const [f, setF] = useState({ name: rule?.name ?? '', code: rule?.code ?? '', basis: rule?.basis ?? 'PERCENT_OF_GROSS', rate: rule?.rate ?? '', currency: rule?.currency ?? 'TZS', priority: String(rule?.priority ?? 100), glAccountCode: rule?.glAccountCode ?? '', isActive: rule?.isActive ?? true });
  const { busy, error, run } = useAction();
  const loan = f.basis === 'OUTSTANDING_LOAN';
  return (
    <Modal open title={rule ? `Hariri: ${rule.name}` : 'Kanuni mpya ya makato'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={f.name.trim().length < 3 || (!rule && !/^[A-Za-z0-9_]{2,20}$/.test(f.code)) || (!loan && f.rate === '')} onClick={async () => {
        const body = { name: f.name, basis: f.basis, rate: loan ? '0' : f.rate, currency: f.currency, priority: Number(f.priority), glAccountCode: f.glAccountCode || null, ...(rule ? { isActive: f.isActive } : { code: f.code.toUpperCase() }) };
        if (await run(() => rule ? api(`/sales/deduction-rules/${rule.id}`, { method: 'PATCH', body }) : api('/sales/deduction-rules', { method: 'POST', body }))) onDone();
      }}>{t('Hifadhi')}</Button></>}>
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
      {rule && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> {t('Kanuni iko hai')}</label>}
    </Modal>
  );
}

// ------------------------------ SOKO MOJA ------------------------------
interface Bale { id: string; baleNo: string; memberId: string; memberNo: string; memberName: string; grossKg: string; netKg: string | null; grade: string | null; priceUsd: string | null; listPriceUsd?: string | null; priceNote?: string | null; valueUsd: string | null; status: string; rejectReason: string | null }
interface Settlement { id: string; settlementNo: string; memberId: string; memberNo: string; memberName: string; totalKg: string; grossUsd: string; grossTzs: string; totalDeductions: string; netTzs: string; status: string; paid: string; lines: { id: string; description: string; amount: string }[] }
interface Batch { id: string; batchNo: string; totalAmount: string; status: string; payments: number; paid: string; createdAt: string }
interface PreviewRow { memberId: string; memberNo: string; name: string; bales: number; groupName: string | null; coveredByGroup: string; totalKg: string; grossUsd: string; grossTzs: string; deductions: { code: string; description: string; amount: string; kind?: string }[]; totalDeductions: string; netTzs: string; debtBefore: string }

export function MarketDetail() {
  const t = useT();
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<{ market: Market; limits?: Limits; bales: Bale[]; settlements: Settlement[]; batches: Batch[]; approval: { requestNo: string; status: string; decisionNote: string | null } | null }>(`/sales/markets/${id}`);
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
  const L = data.limits ?? DEFAULT_LIMITS;
  const rc = rateCheck(m.exchangeRate, L);
  const badBales = data.bales.filter((b) => b.status === 'SOLD' && baleCheck(b, L).level === 'error');
  const pendingApproval = data.approval?.status === 'PENDING';
  // Hatua inayofuata kwa soko hili
  const step: { n: number; title: string; text: string; action?: { label: string; go: () => void } } | null =
    m.status === 'OPEN' && !data.settlements.length
      ? rc.level === 'error' ? { n: 1, title: 'Rekebisha kiwango cha fedha', text: rc.text!, action: manage ? { label: 'Hariri soko', go: () => setEdit(true) } : undefined }
      : badBales.length ? { n: 1, title: 'Rekebisha mabelo yasiyo halisi', text: `Mabelo ${badBales.length} yana bei au kilo zisizo halisi. Yaondoe na uyaingize upya kabla ya kuwasilisha hesabu.`, action: { label: 'Nenda kwenye mabelo', go: () => setTab('bales') } }
      : !m.bales ? { n: 1, title: 'Ingiza mabelo', text: 'Weka mabelo ya kila mkulima (namba ya mkulima, belo, kilo, daraja, bei kwa dola).', action: { label: 'Ingiza mabelo', go: () => setTab('bales') } }
      : { n: 2, title: 'Wasilisha hesabu za wakulima kwa Meneja', text: `Mabelo ${m.bales} yameingizwa. Hakiki hesabu (mauzo, makato, deni) kisha uziwasilishe kwa Meneja aidhinishe.`, action: { label: 'Hakiki na wasilisha', go: () => setTab('settle') } }
    : pendingApproval ? { n: 3, title: 'Inasubiri idhini ya Meneja', text: `Hesabu (${data.approval!.requestNo}) zimetumwa. Meneja akiidhinisha, mauzo yanaingia kwenye daftari kuu na madeni ya wakulima.` }
    : unpaidApproved.length && !data.batches.some((b) => b.status !== 'CANCELLED') ? { n: 4, title: 'Andaa orodha ya malipo', text: `Wakulima ${unpaidApproved.length} wako tayari kulipwa.`, action: { label: 'Nenda kwenye hesabu', go: () => setTab('settle') } }
    : null;
  return (
    <>
      <PageHead title={<>{m.marketNo} <Badge status={m.settlement ?? m.status} label={m.settlement ? SETTLE[m.settlement] : m.status === 'OPEN' ? 'Wazi' : undefined} /></>}
        sub={<>{date(m.marketDate)} · {m.buyerName}{m.location ? ` · ${m.location}` : ''} · 1 USD = {num(m.exchangeRate ?? 0)} TZS</>}>
        <Link className="btn btn-secondary" to="/sales">{t('← Masoko')}</Link>
        {manage && editable && <Button variant="secondary" onClick={() => setEdit(true)}>{t('Hariri soko')}</Button>}
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {step && (
        <div className={`next-step${step.title.startsWith('Rekebisha') ? ' bad' : ''}`}>
          <div className="ns-steps" aria-hidden>{[1, 2, 3, 4].map((k) => <span key={k} className={k < step.n ? 'done' : k === step.n ? 'cur' : ''}>{k}</span>)}</div>
          <div className="ns-body"><div className="ns-label">{t('Hatua inayofuata')}</div><strong>{step.title}</strong><div className="muted">{step.text}</div></div>
          {step.action && <Button onClick={step.action.go}>{step.action.label}</Button>}
        </div>
      )}
      <div className="grid grid-kpi">
        <Kpi label="Mabelo yaliyouzwa" value={num(m.bales)} hint={m.rejected ? `${m.rejected} yamekataliwa` : undefined} />
        <Kpi label="Kilo" value={num(m.kg)} hint={`Wakulima ${m.farmers}`} />
        <Kpi tone="dark" label="Thamani (USD)" value={usd(m.usd)} hint={m.exchangeRate ? `≈ ${tsh(Number(m.usd) * Number(m.exchangeRate))}` : undefined} />
        <Kpi label="Wastani wa bei" value={Number(m.kg) ? `${usd(Number(m.usd) / Number(m.kg))}/kg` : '—'} />
      </div>
      <Tabs value={tab} onChange={setTab} items={[['bales', `Mabelo (${data.bales.length})`], ['settle', 'Hesabu za wakulima'], ['pay', `Malipo (${data.batches.length})`]]} />
      {tab === 'bales' && <Bales marketId={m.id} seasonId={m.seasonId} rate={m.exchangeRate} limits={L} bales={data.bales} editable={manage && editable} onChanged={(msg) => { setOk(msg); reload(); }} />}
      {tab === 'settle' && (data.settlements.length ? (
        <Section pad={false} title="Hesabu za wakulima (settlement)" actions={<PrintButton />}>
          <div className="print-doc">
            <div className="print-only"><DocHead title="HESABU ZA MALIPO YA WAKULIMA" no={m.marketNo} sub={`${date(m.marketDate)} · ${m.buyerName ?? ''}`} /></div>
            <div className="table-wrap"><table className="table fin-table">
              <thead><tr><th>{t('Mkulima')}</th><th className="num">{t('Kilo')}</th><th className="num">Mauzo (TZS)</th><th>{t('Makato')}</th><th className="num">{t('Malipo halisi')}</th><th>{t('Hali')}</th></tr></thead>
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
              <span>{t('Wakulima')} <strong>{unpaidApproved.length}</strong> wako tayari kulipwa ({tsh(unpaidApproved.reduce((t, s) => t + Number(s.netTzs), 0))})</span>
              <Button busy={busy} onClick={async () => {
                const r = await run(() => api<{ batch: Batch; approval: { requestNo: string } }>(`/sales/markets/${m.id}/payment-batch`, { method: 'POST' }));
                if (r) nav(`/sales/batches/${r.batch.id}`);
              }}>{t('Andaa orodha ya malipo')}</Button>
            </div>
          )}
        </Section>
      ) : <SettlementPreview market={m} canSubmit={manage && editable} onDone={(msg) => { setOk(msg); reload(); }} />)}
      {tab === 'pay' && (
        <Section pad={false} title="Orodha za malipo">
          {data.batches.length === 0 ? <Empty>Hakuna orodha ya malipo bado. Hesabu zikiidhinishwa, andaa orodha kwenye "Hesabu za wakulima".</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('Orodha')}</th><th className="num">{t('Wakulima')}</th><th className="num">{t('Jumla')}</th><th className="num">{t('Imelipwa')}</th><th>{t('Hali')}</th></tr></thead>
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

interface Row { memberNo: string; baleNo: string; grossKg: string; netKg: string; grade: string; priceUsd: string; priceNote: string; rejected: boolean }
const emptyRow = (): Row => ({ memberNo: '', baleNo: '', grossKg: '', netKg: '', grade: '', priceUsd: '', priceNote: '', rejected: false });
const normGrade = (g: string) => g.toUpperCase().replace(/[\s.\-_/]+/g, '');
interface GradeList { season: { id: string; name: string; status: string }; prices: { grade: string; priceUsd: string }[]; count: number; average: string | null; updatedAt: string | null; updatedBy: string | null; balesPriced: number }

function Bales({ marketId, seasonId, rate, limits: L, bales, editable, onChanged }: { marketId: string; seasonId?: string; rate: string | null; limits: Limits; bales: Bale[]; editable: boolean; onChanged: (m: string) => void }) {
  const t = useT();
  // Orodha ya bei za madaraja ya msimu: ikiwepo, daraja linaweka bei (ya juu zaidi inahitaji sababu; ya chini haikubaliki)
  const gl = useFetch<GradeList>('/sales/grade-prices', seasonId ? { seasonId } : undefined);
  const list = new Map((gl.data?.prices ?? []).map((p) => [p.grade, Number(p.priceUsd)]));
  const hasList = list.size > 0;
  const listPrice = (r: Row) => (hasList && r.grade ? list.get(normGrade(r.grade)) ?? null : null);
  const priceOf = (r: Row) => (r.priceUsd !== '' ? r.priceUsd : listPrice(r) != null ? String(listPrice(r)) : '');
  const gradeCheck = (r: Row): { level: 'error' | 'warn' | null; text: string | null } => {
    if (!hasList || r.rejected || !(r.memberNo.trim() || r.baleNo.trim())) return { level: null, text: null };
    if (!r.grade.trim()) return { level: 'error', text: 'Weka daraja — bei inatoka kwenye orodha ya bei za madaraja' };
    const lp = listPrice(r);
    if (lp == null) return { level: 'error', text: `Daraja ${normGrade(r.grade)} halipo kwenye orodha ya bei ya msimu` };
    if (r.priceUsd !== '' && Number(r.priceUsd) < lp) return { level: 'error', text: `Bei $${num(r.priceUsd)} iko chini ya bei ya daraja ($${num(lp)})` };
    if (r.priceUsd !== '' && Number(r.priceUsd) > lp && r.priceNote.trim().length < 3) return { level: 'error', text: `Bei iko juu ya bei ya daraja ($${num(lp)}) — eleza sababu` };
    return { level: null, text: null };
  };
  const fx = rateCheck(rate, L).level === 'error' ? 0 : Number(rate ?? 0);
  const tzsOf = (kg: string, price: string) => (fx && Number(kg) > 0 && price !== '' ? Number(kg) * Number(price) * fx : null);
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const { busy, error, run } = useAction();
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const filled = rows.filter((r) => r.memberNo.trim() || r.baleNo.trim());
  const checks = rows.map((r) => { const g = gradeCheck(r); return g.level ? g : baleCheck({ ...r, priceUsd: priceOf(r) }, L); });
  const errors = rows.filter((r, i) => (r.memberNo.trim() || r.baleNo.trim()) && checks[i].level === 'error').length;
  const warns = rows.filter((r, i) => (r.memberNo.trim() || r.baleNo.trim()) && checks[i].level === 'warn').length;
  const valid = errors === 0 && filled.length > 0 && filled.every((r) => r.memberNo.trim() && r.baleNo.trim() && Number(r.grossKg) > 0 && (r.rejected || Number(priceOf(r)) >= 0 && priceOf(r) !== ''));
  const save = async () => {
    const r = await run(() => api<{ bales: unknown[] }>(`/sales/markets/${marketId}/bales`, { method: 'POST', body: { bales: filled.map((x) => ({
      memberNo: x.memberNo.trim(), baleNo: x.baleNo.trim(), grossKg: x.grossKg, netKg: x.netKg || null, grade: x.grade || null,
      priceUsd: x.rejected ? null : (x.priceUsd || (hasList ? null : x.priceUsd)), priceNote: x.priceNote.trim() || null, rejected: x.rejected || undefined,
    })) } }));
    if (r) { setRows([emptyRow(), emptyRow(), emptyRow()]); onChanged(`Mabelo ${r.bales.length} yamehifadhiwa`); }
  };
  const applyPaste = () => {
    const parsed = pasteText.split(/\r?\n/).map((l) => l.split(/\t|;|,/).map((c) => c.trim())).filter((c) => c.length >= 3 && c[0])
      .map(([memberNo, baleNo, grossKg, grade = '', priceUsd = '']) => ({ ...emptyRow(), memberNo, baleNo, grossKg, grade: normGrade(grade), priceUsd: hasList && priceUsd && list.get(normGrade(grade)) === Number(priceUsd) ? '' : priceUsd }));
    if (parsed.length) setRows(parsed);
    setPaste(false); setPasteText('');
  };
  const sold = bales.filter((b) => b.status === 'SOLD');
  return (
    <div className="stack">
      {editable && (
        <Section title="Ingiza mabelo" actions={<Button size="sm" variant="secondary" onClick={() => setPaste(true)}>{t('Bandika kutoka Excel')}</Button>}>
          <Alert>{error}</Alert>
          {gl.data && (hasList
            ? <p className="muted" style={{ margin: '0 0 10px' }}>{t('Bei inatoka kwenye orodha ya bei za madaraja')} ({gl.data.count} · {t('msimu')} {gl.data.season.name}). {t('Andika daraja tu; bei ya juu zaidi inahitaji sababu, ya chini haikubaliki.')}</p>
            : <Alert kind="warn">{t('Orodha ya bei za madaraja ya msimu huu haijawekwa — bei inaandikwa kwa mkono.')} <Link to="/sales?tab=grades">{t('Weka bei za madaraja')}</Link></Alert>)}
          <datalist id="grade-list">{[...list.keys()].map((g) => <option key={g} value={g}>{`$${list.get(g)}`}</option>)}</datalist>
          <div className="table-wrap"><table className="table bale-entry">
            <thead><tr><th>{t('Namba ya mkulima')}</th><th>{t('Namba ya belo / tiketi')}</th><th>{t('Kilo')}</th><th>{t('Kilo halisi')}</th><th>{t('Daraja')}</th><th>{t('Bei USD/kg')}</th><th className="num">Thamani (TZS)</th><th>{t('Limekataliwa')}</th><th /></tr></thead>
            <tbody>{rows.map((r, i) => (<Fragment key={i}>
              <tr className={checks[i].level ? `row-${checks[i].level}` : undefined}>
                <td><input className="input" value={r.memberNo} onChange={(e) => set(i, { memberNo: e.target.value })} aria-label={`Namba ya mkulima ${i + 1}`} /></td>
                <td><input className="input" value={r.baleNo} onChange={(e) => set(i, { baleNo: e.target.value })} aria-label={`Namba ya belo ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" value={r.grossKg} onChange={(e) => set(i, { grossKg: e.target.value })} aria-label={`Kilo ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" value={r.netKg} onChange={(e) => set(i, { netKg: e.target.value })} aria-label={`Kilo halisi ${i + 1}`} placeholder="hiari" /></td>
                <td><input className="input" list="grade-list" value={r.grade} onChange={(e) => set(i, { grade: e.target.value.toUpperCase() })} aria-label={`Daraja ${i + 1}`} /></td>
                <td><input className="input" type="number" min="0" step="0.0001" disabled={r.rejected} value={r.priceUsd} placeholder={listPrice(r) != null ? String(listPrice(r)) : undefined} onChange={(e) => set(i, { priceUsd: e.target.value })} aria-label={`Bei ${i + 1}`} />
                  {!r.rejected && listPrice(r) != null && <div className="muted" style={{ fontSize: 11 }}>{t('daraja')}: ${num(listPrice(r)!)}</div>}</td>
                <td className="num bale-tzs">{!r.rejected && tzsOf(r.netKg || r.grossKg, priceOf(r)) !== null ? tsh(tzsOf(r.netKg || r.grossKg, priceOf(r))!) : '—'}</td>
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.rejected} onChange={(e) => set(i, { rejected: e.target.checked })} aria-label={`Limekataliwa ${i + 1}`} /></td>
                <td>{rows.length > 1 && <Button size="sm" variant="ghost" aria-label="Ondoa" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</Button>}</td>
              </tr>
              {!r.rejected && listPrice(r) != null && r.priceUsd !== '' && Number(r.priceUsd) > listPrice(r)! && (
                <tr className="row-msg"><td colSpan={9}><input className="input" value={r.priceNote} onChange={(e) => set(i, { priceNote: e.target.value })} placeholder={t('Sababu ya bei ya juu (mf. mnunuzi ameongeza bei)')} aria-label={`Sababu ya bei ${i + 1}`} /></td></tr>)}
              {checks[i].text && (r.memberNo.trim() || r.baleNo.trim() || r.grossKg || r.priceUsd) && <tr className={`row-msg row-${checks[i].level}`}><td colSpan={9}>⚠ {checks[i].text}</td></tr>}
            </Fragment>))}</tbody>
          </table></div>
          {!fx && <Alert kind="warn">Kiwango cha fedha cha soko hili si sahihi — thamani kwa shilingi haiwezi kuonyeshwa. Bonyeza "Hariri soko" kukirekebisha.</Alert>}
          {(errors > 0 || warns > 0) && <p className={`name-note ${errors ? 'bad' : 'warn'}`}>{errors ? `Mistari ${errors} ina makosa — rekebisha kabla ya kuhifadhi.` : `Mistari ${warns} ina takwimu zisizo za kawaida — hakiki kabla ya kuhifadhi.`}</p>}
          <div className="actions" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <Button size="sm" variant="secondary" onClick={() => setRows([...rows, emptyRow()])}>{t('+ Mstari')}</Button>
            <Button busy={busy} disabled={!valid} onClick={save}>Hifadhi mabelo {filled.length || ''}</Button>
          </div>
        </Section>
      )}
      <Section pad={false} title={`Mabelo yaliyoingizwa (${bales.length})`}>
        {bales.length === 0 ? <Empty>{t('Bado hakuna mabelo.')}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Belo')}</th><th>{t('Mkulima')}</th><th className="num">{t('Kilo')}</th><th>{t('Daraja')}</th><th className="num">{t('Bei')}</th><th className="num">Thamani (USD)</th><th className="num">Thamani (TZS)</th><th /></tr></thead>
            <tbody>{bales.map((b) => { const bc = b.status === 'SOLD' ? baleCheck(b, L) : { level: null, text: null }; return (
              <tr key={b.id} className={bc.level ? `row-${bc.level}` : undefined} style={{ opacity: b.status === 'REJECTED' ? 0.6 : 1 }}>
                <td><strong>{b.baleNo}</strong>{bc.text && <div className={`name-note ${bc.level === 'error' ? 'bad' : 'warn'}`} style={{ margin: '2px 0 0' }}>{bc.level === 'error' ? 'Si halisi: ' : ''}{bc.text}</div>}{b.status === 'REJECTED' && <div><span className="badge badge-bad">{t('Limekataliwa')}</span> <span className="muted" style={{ fontSize: 12 }}>{b.rejectReason}</span></div>}</td>
                <td>{b.memberName}<div className="muted" style={{ fontSize: 12 }}>{b.memberNo}</div></td>
                <td className="num">{num(b.netKg ?? b.grossKg)}</td><td>{b.grade ?? '—'}</td>
                <td className="num">{b.priceUsd ? (Number(b.priceUsd) % 0.01 ? `$${Number(b.priceUsd)}` : usd(b.priceUsd)) : '—'}{b.listPriceUsd && Number(b.priceUsd) > Number(b.listPriceUsd) && <div className="muted" style={{ fontSize: 11 }} title={b.priceNote ?? ''}>{t('daraja')} ${Number(b.listPriceUsd)} · {b.priceNote}</div>}</td><td className="num">{b.valueUsd ? usd(b.valueUsd) : '—'}</td>
                <td className="num">{b.valueUsd && fx ? tsh(Number(b.valueUsd) * fx) : '—'}</td>
                <td className="num">{editable && <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => api(`/sales/bales/${b.id}`, { method: 'DELETE' }))) onChanged(`Belo ${b.baleNo} limeondolewa`); }}>{t('Ondoa')}</Button>}</td>
              </tr>
            ); })}
              <tr className="row-total"><td colSpan={2}>Jumla (yaliyouzwa)</td><td className="num">{num(sold.reduce((t, b) => t + Number(b.netKg ?? b.grossKg), 0))}</td><td /><td />
                <td className="num">{usd(sold.reduce((t, b) => t + Number(b.valueUsd ?? 0), 0))}</td>
                <td className="num">{fx ? tsh(sold.reduce((t, b) => t + Number(b.valueUsd ?? 0), 0) * fx) : '—'}</td><td /></tr>
            </tbody>
          </table></div>
        )}
      </Section>
      {paste && (
        <Modal open title="Bandika mabelo kutoka Excel" onClose={() => setPaste(false)} footer={<><Button variant="secondary" onClick={() => setPaste(false)}>{t('Ghairi')}</Button><Button onClick={applyPaste}>{t('Weka kwenye fomu')}</Button></>}>
          <p className="muted">{t('Nakili safu kutoka Excel kwa mpangilio huu:')} <strong>{t('Namba ya mkulima · Namba ya belo · Kilo · Daraja · Bei USD')}</strong>{hasList ? ` — ${t('bei inaweza kuachwa wazi (inatoka kwenye daraja)')}` : ''}</p>
          <textarea className="textarea" rows={10} value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label="Data ya mabelo" placeholder={'UHA-000001\tT-1001\t102.5\tL1F\t2.10'} />
        </Modal>
      )}
    </div>
  );
}

function SettlementPreview({ market, canSubmit, onDone }: { market: Market; canSubmit: boolean; onDone: (m: string) => void }) {
  const tt = useT();
  const [nonSellers, setNonSellers] = useState(false);
  const pv = useFetch<{ rows: PreviewRow[]; totals: { farmers: number; kg: string; grossUsd: string; grossTzs: string; deductions: string; netTzs: string }; guarantees: { groupName: string; debtorName: string; remaining: string; covered: string; uncovered: string; sold: boolean }[] }>(market.bales ? `/sales/markets/${market.id}/preview` : null, { includeNonSellers: nonSellers ? 'true' : undefined });
  const { busy, error, run } = useAction();
  if (!market.bales) return <Empty>{tt('Ingiza mabelo kwanza.')}</Empty>;
  if (pv.error) return <Alert>{pv.error}</Alert>;
  if (!pv.data) return <Loading />;
  const t = pv.data.totals;
  return (
    <Section pad={false} title="Hakiki hesabu kabla ya kuwasilisha" actions={canSubmit ? <Button busy={busy} onClick={async () => {
      const r = await run(() => api<{ approval: { requestNo: string } }>(`/sales/markets/${market.id}/settlements`, { method: 'POST', body: { includeNonSellers: nonSellers } }));
      if (r) onDone(`Hesabu za wakulima ${t.farmers} zimetumwa kwa Meneja (${r.approval.requestNo})`);
    }}>{tt('Wasilisha kwa Meneja')}</Button> : undefined}>
      <Alert>{error}</Alert>
      <div className="card-pad stack" style={{ gap: 10 }}>
        <Alert kind="warn">{tt('Hesabu hizi bado si rasmi. Zikiidhinishwa na Meneja, mauzo na makato yanaingia kwenye ledger za wakulima na daftari kuu, na soko linafungwa.')}</Alert>
        {pv.data.guarantees.length > 0 && (
          <div className="alert alert-warn" role="status">
            <strong>{tt('Dhamana ya kikundi')}</strong> — wanachama hawa hawajamaliza madeni yao; salio linakatwa kwa wenzao wa kikundi waliouza soko hili (kwa uwiano wa malipo yao):
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{pv.data.guarantees.map((g, i) => (
              <li key={i}>{g.debtorName} · {g.groupName}{!g.sold ? ' (hajauza soko hili)' : ''}: salio {tsh(g.remaining)} → wenzake wanalipa <strong>{tsh(g.covered)}</strong>{Number(g.uncovered) > 0 ? `, linabaki ${tsh(g.uncovered)}` : ''}</li>
            ))}</ul>
          </div>
        )}
        <label className="check" style={{ marginTop: 0 }}><input type="checkbox" checked={nonSellers} onChange={(e) => setNonSellers(e.target.checked)} /> Kata pia madeni ya wanakikundi ambao hawajauza kwenye soko hili (mf. soko la mwisho la msimu)</label>
      </div>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>{tt('Mkulima')}</th><th className="num">{tt('Kilo')}</th><th className="num">{tt('Mauzo')}</th><th>{tt('Makato')}</th><th className="num">{tt('Malipo halisi')}</th></tr></thead>
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
  const t = useT();
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
        <Button variant="secondary" className="no-print" onClick={() => window.history.back()}>{t('← Rudi')}</Button>
        <Button variant="secondary" onClick={() => apiDownload(`/sales/batches/${b.id}/csv`, { filename: `malipo-${b.batchNo}.csv` })}>{t('CSV ya benki / M-Pesa')}</Button>
        <PrintButton label="Chapisha orodha" />
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {b.status === 'DRAFT' && <Alert kind="warn">{t('Orodha hii inasubiri idhini ya Meneja. Hakuna malipo yanayofanyika kabla ya idhini.')}</Alert>}
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
              }} /></th>}<th>{METHOD[k]} — Mkulima</th><th>{k === 'CASH' ? 'Sahihi ya mpokeaji' : 'Namba / akaunti'}</th><th className="num">{t('Kiasi')}</th><th>{t('Hali')}</th></tr></thead>
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
          <span>{t('Umechagua')} <strong>{picked.size}</strong> · {tsh(pickedTotal)}</span>
          <div className="actions">
            <Button variant="secondary" onClick={() => setMode('fail')}>Weka "yameshindwa"</Button>
            <Button onClick={() => setMode('confirm')}>{t('Thibitisha yamelipwa')}</Button>
          </div>
        </div>
      )}
      {mode === 'confirm' && (
        <Modal open title={`Thibitisha malipo ${picked.size} (${tsh(pickedTotal)})`} onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>{t('Ghairi')}</Button><Button busy={busy} disabled={!accountId || reference.trim().length < 2} onClick={async () => {
            const r = await run(() => api<{ confirmed: number; status: string }>(`/sales/batches/${b.id}/confirm`, { method: 'POST', body: { accountId, paymentIds: [...picked], reference } }));
            if (r) { setOk(`Malipo ${r.confirmed} yamethibitishwa na kuingia kwenye ledger za wakulima`); setPicked(new Set()); setMode(null); reload(); }
          }}>{t('Thibitisha')}</Button></>}>
          <Alert kind="warn">{t('Thibitisha tu malipo ambayo fedha zimeshatoka kweli. Kila mkulima atapata muamala wake na ledger yake itaonyesha malipo.')}</Alert>
          <Alert>{error}</Alert>
          <div className="form-grid">
            <SelectField label="Akaunti iliyolipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
            <TextField label="Kumbukumbu ya malipo *" value={reference} onChange={setReference} placeholder="mf. namba ya bulk payment / cheki" />
          </div>
        </Modal>
      )}
      {mode === 'fail' && (
        <Modal open title="Malipo yameshindwa" onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>{t('Ghairi')}</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
            const r = await run(() => api<{ failed: number }>(`/sales/batches/${b.id}/fail`, { method: 'POST', body: { paymentIds: [...picked], reason } }));
            if (r) { setOk(`Malipo ${r.failed} yamewekwa "yameshindwa" — yatalipwa tena baadaye`); setPicked(new Set()); setMode(null); reload(); }
          }}>{t('Hifadhi')}</Button></>}>
          <TextField label="Sababu *" value={reason} onChange={setReason} placeholder="mf. Namba ya M-Pesa haijasajiliwa" />
        </Modal>
      )}
    </>
  );
}

// ------------------------------ TAARIFA YA MKULIMA ------------------------------
export function SettlementStatement() {
  const t = useT();
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
      <div className="actions no-print" style={{ justifyContent: 'space-between', marginBottom: 12 }}><a href="#" onClick={(e) => { e.preventDefault(); history.back(); }}>{t('← Rudi')}</a><PrintButton /></div>
      <article className="card card-pad print-doc">
        <DocHead title="TAARIFA YA MAUZO YA MKULIMA" no={s.settlementNo} sub={data.market ? `${data.market.marketNo} · ${date(data.market.marketDate)}` : undefined} />
        <dl className="dl">
          <dt>{t('Mkulima')}</dt><dd><strong>{data.member.firstName} {data.member.lastName}</strong> · {data.member.memberNo}{data.member.village ? ` · ${data.member.village}` : ''}</dd>
          <dt>{t('Mnunuzi')}</dt><dd>{data.market?.buyerName ?? '—'} · 1 USD = {num(s.exchangeRate)} TZS</dd>
          <dt>{t('Hali')}</dt><dd><Badge status={s.status} label={SETTLE[s.status]} /></dd>
        </dl>
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>{t('Belo')}</th><th>{t('Daraja')}</th><th className="num">{t('Kilo')}</th><th className="num">Bei (USD)</th><th className="num">Thamani (USD)</th></tr></thead>
          <tbody>
            {data.bales.map((b) => <tr key={b.id} style={{ opacity: b.status === 'REJECTED' ? 0.55 : 1 }}><td>{b.baleNo}{b.status === 'REJECTED' && ' (limekataliwa)'}</td><td>{b.grade ?? '—'}</td><td className="num">{num(b.netKg ?? b.grossKg)}</td><td className="num">{b.priceUsd ? usd(b.priceUsd) : '—'}</td><td className="num">{b.valueUsd ? usd(b.valueUsd) : '—'}</td></tr>)}
            <tr className="row-total"><td colSpan={2}>{t('Jumla')}</td><td className="num">{num(s.totalKg)}</td><td /><td className="num">{usd(s.grossUsd)}</td></tr>
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
interface BuyerRow { id: string; marketNo: string; marketDate: string; buyerName: string | null; due: string; paid: string; outstanding: string; lastPaid: string | null; days: number; bucket: string; dueDate: string; overdueDays: number; state: 'PAID' | 'OVERDUE' | 'NOT_DUE' }
interface BuyerSum { name: string; outstanding: string; overdue: string; markets: number; oldestDue: string | null }
interface BuyersData { data: BuyerRow[]; buckets: Record<string, string>; unallocated: string; totalOutstanding: string; termsDays: number; overdue: { count: number; amount: string }; byBuyer: BuyerSum[] }
const BUCKET: Record<string, string> = { '0-30': 'Siku 0–30', '31-60': 'Siku 31–60', '61-90': 'Siku 61–90', '90+': 'Zaidi ya siku 90' };

function Buyers({ canRecord }: { canRecord: boolean }) {
  const t = useT();
  const { may } = useAuth();
  const { data, reload } = useFetch<BuyersData>('/sales/buyers');
  const [pay, setPay] = useState<BuyerRow | null>(null);
  const [dueEdit, setDueEdit] = useState<BuyerRow | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!data) return <Loading />;
  if (letter !== null) return <BuyerLetter name={letter} data={data} onBack={() => setLetter(null)} />;
  return (
    <div className="stack">
      <Alert kind="ok">{ok}</Alert>
      <div className="grid grid-kpi">
        <Kpi tone={Number(data.totalOutstanding) > 0 ? 'gold' : 'dark'} label="Wanunuzi wanadaiwa" value={tsh(data.totalOutstanding)} />
        <Kpi tone={data.overdue.count ? 'bad' : undefined} label="Yamepita tarehe ya kulipa" value={tsh(data.overdue.amount)} hint={data.overdue.count ? `Masoko ${data.overdue.count}` : 'Hakuna lililochelewa'} />
        {Object.entries(data.buckets).map(([k, v]) => <Kpi key={k} tone={k === '90+' && Number(v) > 0 ? 'bad' : k === '61-90' && Number(v) > 0 ? 'warn' : undefined} label={`Umri: ${BUCKET[k]}`} value={tsh(v)} />)}
      </div>
      {Number(data.unallocated) !== 0 && <Alert kind="warn">Malipo ya {tsh(data.unallocated)} yalirekodiwa kama "Mauzo ya tumbaku" bila kuunganishwa na soko. Yanapunguza deni la wanunuzi kwenye daftari kuu, lakini hayaonekani kwenye soko lolote hapa chini.</Alert>}
      {data.byBuyer.length > 0 && (
        <Section pad={false} title="Kwa kila mnunuzi">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Mnunuzi')}</th><th className="num">{t('Masoko')}</th><th className="num">{t('Anadaiwa')}</th><th className="num">{t('Imechelewa')}</th><th>{t('Tarehe ya zamani zaidi')}</th><th /></tr></thead>
            <tbody>{data.byBuyer.map((b) => (
              <tr key={b.name}><td><strong>{b.name}</strong></td><td className="num">{b.markets}</td><td className="num">{tsh(b.outstanding)}</td>
                <td className="num">{Number(b.overdue) > 0 ? <strong className="money-neg">{tsh(b.overdue)}</strong> : '—'}</td>
                <td>{b.oldestDue ? date(b.oldestDue) : '—'}</td>
                <td className="num"><Button size="sm" variant="secondary" onClick={() => setLetter(b.name)}>{t('Barua ya madai')}</Button></td></tr>
            ))}</tbody>
          </table></div>
        </Section>
      )}
      <section className="card">
        {data.data.length === 0 ? <Empty>{t('Hakuna soko lililoidhinishwa bado.')}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Soko')}</th><th>{t('Mnunuzi')}</th><th className="num">{t('Anadaiwa')}</th><th className="num">{t('Amelipa')}</th><th className="num">{t('Salio')}</th><th>{t('Tarehe ya kulipa')}</th><th /></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id} className={r.state === 'OVERDUE' ? 'row-error' : undefined}>
                <td><Link to={`/sales/markets/${r.id}`}><strong>{r.marketNo}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{date(r.marketDate)} · siku {r.days}</div></td>
                <td>{r.buyerName ?? '—'}</td>
                <td className="num">{tsh(r.due)}</td><td className="num">{tsh(r.paid)}{r.lastPaid && <div className="muted" style={{ fontSize: 12 }}>{date(r.lastPaid)}</div>}</td>
                <td className="num"><strong className={Number(r.outstanding) > 0 ? 'money-neg' : ''}>{tsh(r.outstanding)}</strong></td>
                <td>{r.state === 'PAID' ? <Badge status="PAID" /> : <>
                  <div>{date(r.dueDate)}</div>
                  {r.state === 'OVERDUE' ? <span className="badge badge-bad">Imechelewa siku {r.overdueDays}</span> : <span className="badge badge-neutral">{t('Bado haijafika')}</span>}
                  {may('sales.manage') && <button className="link-btn" style={{ display: 'block', fontSize: 12 }} onClick={() => setDueEdit(r)}>{t('Badili tarehe')}</button>}
                </>}</td>
                <td className="num">{canRecord && Number(r.outstanding) > 0 && <Button size="sm" onClick={() => setPay(r)}>{t('Rekodi malipo')}</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <p className="muted" style={{ fontSize: 12.5 }}>Soko lisilowekewa tarehe ya kulipa, mnunuzi anatakiwa kulipa ndani ya siku {data.termsDays} baada ya soko.</p>
      {pay && <BuyerPayment row={pay} onClose={() => setPay(null)} onDone={(m) => { setPay(null); setOk(m); reload(); }} />}
      {dueEdit && <BuyerDue row={dueEdit} onClose={() => setDueEdit(null)} onDone={() => { setDueEdit(null); setOk(`Tarehe ya kulipa ya ${dueEdit.marketNo} imehifadhiwa`); reload(); }} />}
    </div>
  );
}

function BuyerDue({ row, onClose, onDone }: { row: BuyerRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [d, setD] = useState(row.dueDate);
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Tarehe ya kulipa — ${row.marketNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={!d} onClick={async () => {
        if (await run(() => api(`/sales/markets/${row.id}/buyer-due`, { method: 'PUT', body: { dueDate: d } }))) onDone();
      }}>{t('Hifadhi')}</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Tarehe mnunuzi aliyokubali kulipa" type="date" min={row.marketDate} value={d} onChange={setD} help={`${row.buyerName ?? 'Mnunuzi'} · soko la ${date(row.marketDate)}. Baada ya tarehe hii, deni linaonekana "limechelewa".`} />
    </Modal>
  );
}

/** Barua ya madai kwa mnunuzi (ya kuchapisha au kuhifadhi PDF) */
function BuyerLetter({ name, data, onBack }: { name: string; data: BuyersData; onBack: () => void }) {
  const t = useT();
  const { amcos } = useAuth();
  const rows = data.data.filter((r) => (r.buyerName ?? '—') === name && Number(r.outstanding) > 0);
  const total = rows.reduce((t, r) => t + Number(r.outstanding), 0);
  const overdue = rows.filter((r) => r.state === 'OVERDUE').reduce((t, r) => t + Number(r.outstanding), 0);
  return (
    <div className="stack">
      <div className="actions no-print"><Button variant="secondary" onClick={onBack}>{t('← Rudi')}</Button><PrintButton label="Chapisha / Hifadhi PDF" /></div>
      <section className="card card-pad print-doc">
        <DocHead title="TAARIFA YA DENI LA MNUNUZI" sub={`Tarehe: ${date(new Date().toISOString())}`} />
        <p style={{ marginTop: 16 }}>{t('Kwa:')} <strong>{name}</strong></p>
        <p><strong>YAH: MADAI YA MALIPO YA TUMBAKU ILIYONUNULIWA KUTOKA {(amcos?.name ?? 'CHAMA').toUpperCase()}</strong></p>
        <p>{t('Kwa mujibu wa kumbukumbu zetu, kampuni yenu bado haijakamilisha malipo ya tumbaku mliyonunua kwenye masoko yafuatayo. Jumla ya kiasi kinachodaiwa ni')} <strong>{tsh(total)}</strong>{overdue > 0 ? <>{t(', ambapo')} <strong>{tsh(overdue)}</strong> {t('kimepita tarehe ya kulipa')}</> : null}.</p>
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>{t('Soko')}</th><th>{t('Tarehe ya soko')}</th><th className="num">{t('Thamani')}</th><th className="num">{t('Imelipwa')}</th><th className="num">{t('Salio')}</th><th>{t('Tarehe ya kulipa')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.marketNo}</td><td>{date(r.marketDate)}</td><td className="num">{tsh(r.due)}</td><td className="num">{tsh(r.paid)}</td>
              <td className="num">{tsh(r.outstanding)}</td><td>{date(r.dueDate)}{r.state === 'OVERDUE' ? ` (imechelewa siku ${r.overdueDays})` : ''}</td></tr>
          ))}
            <tr className="row-grand"><td colSpan={4}>JUMLA INAYODAIWA</td><td className="num">{tsh(total)}</td><td /></tr>
          </tbody>
        </table></div>
        <p>{t('Tunaomba malipo yafanyike haraka iwezekanavyo kwenye akaunti ya chama. Mkiwa na tofauti yoyote na kumbukumbu hizi, tafadhali wasiliana nasi ndani ya siku 7 ili tuzilinganishe.')}</p>
        <Signatures items={['Meneja', 'Mhasibu']} />
      </section>
    </div>
  );
}

function BuyerPayment({ row, onClose, onDone }: { row: BuyerRow; onClose: () => void; onDone: (m: string) => void }) {
  const t = useT();
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>('/finance/accounts');
  const [f, setF] = useState({ amount: row.outstanding, accountId: '', txnDate: today(), reference: '' });
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Malipo ya ${row.buyerName ?? 'mnunuzi'} — ${row.marketNo}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={!f.accountId || !(Number(f.amount) > 0)} onClick={async () => {
        const r = await run(() => api<{ transaction: { txnNo: string } }>('/finance/income', { method: 'POST', body: {
          category: 'TOBACCO_SALES', marketId: row.id, amount: f.amount, accountId: f.accountId, txnDate: f.txnDate, reference: f.reference || null,
          payee: row.buyerName, description: `Malipo ya mnunuzi ${row.buyerName ?? ''} soko ${row.marketNo}`.replace('  ', ' '),
        } }));
        if (r) onDone(`${r.transaction.txnNo}: malipo ya ${row.marketNo} yamerekodiwa`);
      }}>{t('Rekodi')}</Button></>}>
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

// ------------------------------ BEI ZA MADARAJA (orodha ya TTB ya msimu) ------------------------------
/** Kila msimu Halmashauri ya Tumbaku inatoa bei mpya ya kila daraja; Mhasibu anaiingiza hapa. */
function GradePrices({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { data, reload, error } = useFetch<GradeList>('/sales/grade-prices');
  const [edit, setEdit] = useState(false);
  const [rows, setRows] = useState<{ grade: string; priceUsd: string }[]>([]);
  const [paste, setPaste] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const act = useAction();
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const start = (from: { grade: string; priceUsd: string }[]) => { setRows(from.map((r) => ({ grade: r.grade, priceUsd: String(Number(r.priceUsd)) }))); setEdit(true); setOk(null); };
  const grades = rows.map((r) => normGrade(r.grade));
  const rowProblem = (r: { grade: string; priceUsd: string }, i: number) => {
    const g = normGrade(r.grade);
    if (!g && !r.priceUsd) return null;
    if (!/^[A-Z0-9]{1,8}$/.test(g)) return 'Daraja si sahihi';
    if (grades.indexOf(g) !== i) return 'Limerudiwa';
    if (!(Number(r.priceUsd) > 0)) return 'Weka bei';
    if (Number(r.priceUsd) > 20) return 'Bei ya dola kwa kilo (mf. 2.124)';
    return null;
  };
  const filled = rows.filter((r) => r.grade.trim() || r.priceUsd);
  const bad = rows.some((r, i) => rowProblem(r, i));
  const parsePaste = (text: string) => {
    // Mstari mmoja kila daraja: "X1O 2.124" au "1  X1O  2.124" (kutoka Excel/karatasi)
    const out: { grade: string; priceUsd: string }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(/[\t,;]|\s{1,}/).map((c) => c.trim()).filter(Boolean);
      for (let k = 0; k < cells.length - 1; k++) {
        const g = normGrade(cells[k]), p = cells[k + 1].replace(/^\$/, '');
        if (/^[A-Z]{1,3}[0-9A-Z]{0,5}$/.test(g) && /[A-Z]/.test(g) && /^\d+(\.\d+)?$/.test(p)) { out.push({ grade: g, priceUsd: p }); k++; }
      }
    }
    return out;
  };
  const save = async () => {
    const r = await act.run(() => api<{ count: number; changed: number; removed: number }>('/sales/grade-prices', { method: 'PUT', body: { prices: filled.map((x) => ({ grade: normGrade(x.grade), priceUsd: x.priceUsd })) } }));
    if (r) { setEdit(false); setOk(`Bei za madaraja ${r.count} zimehifadhiwa (${r.changed} zimebadilika${r.removed ? `, ${r.removed} zimeondolewa` : ''})`); reload(); }
  };
  const avg = filled.length ? filled.reduce((x, r) => x + Number(r.priceUsd || 0), 0) / filled.length : 0;
  const cols = 3, per = Math.ceil(data.prices.length / cols);
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{act.error}</Alert>
      {!edit && <>
        <div className="grid grid-kpi no-print">
          <Kpi tone="dark" label="Madaraja yenye bei" value={num(data.count)} hint={`Msimu ${data.season.name}`} />
          <Kpi tone="gold" label="Wastani wa bei" value={data.average ? `$${data.average}/kg` : '—'} hint="Wastani wa madaraja (si wa uzani)" />
          <Kpi label="Mabelo yaliyouzwa kwa orodha" value={num(data.balesPriced)} hint="Yanabaki na bei yao orodha ikibadilika" />
          <Kpi label="Ilisasishwa" value={data.updatedAt ? date(data.updatedAt) : '—'} hint={data.updatedBy ?? undefined} />
        </div>
        {data.count === 0 ? (
          <section className="card card-pad stack">
            <Empty>{t('Bei za madaraja za msimu huu bado hazijawekwa. Mpaka ziwekwe, bei ya kila belo inaandikwa kwa mkono.')}</Empty>
            {canManage && <div className="actions" style={{ justifyContent: 'center' }}>
              <Button onClick={() => start(TTB_2026_27.map(([grade, priceUsd]) => ({ grade, priceUsd })))}>{t('Jaza orodha ya TTB 2026/2027')}</Button>
              <Button variant="secondary" onClick={() => { start([]); setPaste(''); }}>{t('Bandika kutoka Excel / karatasi')}</Button>
              <Button variant="secondary" onClick={() => start([{ grade: '', priceUsd: '' }])}>{t('Andika moja moja')}</Button>
            </div>}
          </section>
        ) : (
          <Section title={`Bei za madaraja — msimu ${data.season.name} (USD kwa kilo)`} actions={<>{canManage && <Button size="sm" onClick={() => start(data.prices)}>{t('Badilisha bei')}</Button>}<PrintButton /></>}>
            <div className="print-doc">
              <div className="print-only"><DocHead title="BEI ZA MADARAJA YA TUMBAKU" sub={`Msimu ${data.season.name} · USD kwa kilo`} /></div>
              <div className="grade-cols">{Array.from({ length: cols }, (_, c) => data.prices.slice(c * per, (c + 1) * per)).map((part, c) => (
                <table key={c} className="table fin-table grade-table"><thead><tr><th>S/N</th><th>{t('Daraja')}</th><th className="num">{t('Bei kwa kilo')}</th></tr></thead>
                  <tbody>{part.map((p, k) => <tr key={p.grade}><td className="muted">{c * per + k + 1}</td><td><strong>{p.grade}</strong></td><td className="num">${Number(p.priceUsd).toFixed(3)}</td></tr>)}</tbody></table>
              ))}</div>
            </div>
          </Section>
        )}
      </>}
      {edit && (
        <Section title={`Bei za madaraja — msimu ${data.season.name}`} actions={<>
          <Button size="sm" variant="secondary" onClick={() => setPaste('')}>{t('Bandika kutoka Excel / karatasi')}</Button>
          <Button size="sm" variant="secondary" onClick={() => { if (!rows.length || window.confirm(t('Kubadilisha orodha yote kwa ya TTB 2026/2027?'))) setRows(TTB_2026_27.map(([grade, priceUsd]) => ({ grade, priceUsd }))); }}>{t('Jaza ya TTB 2026/2027')}</Button>
        </>}>
          <Alert kind="warn">{t('Kagua kila bei dhidi ya karatasi rasmi ya Halmashauri ya Tumbaku kabla ya kuhifadhi.')} {rows.length === TTB_2026_27.length && rows.every((r, i) => r.grade === TTB_2026_27[i][0]) ? `(${TTB_2026_27_LABEL})` : ''} {data.balesPriced > 0 ? t('Mabelo yaliyokwisha andikwa hayabadiliki.') : ''}</Alert>
          <div className="grade-cols">{Array.from({ length: 3 }, (_, c) => { const per3 = Math.ceil(rows.length / 3) || 1; return (
            <table key={c} className="table grade-table"><thead><tr><th>S/N</th><th>{t('Daraja')}</th><th>{t('Bei (USD/kg)')}</th><th /></tr></thead>
              <tbody>{rows.slice(c * per3, (c + 1) * per3).map((r, k) => { const i = c * per3 + k; const pr = rowProblem(r, i); return (
                <tr key={i} className={pr ? 'row-error' : undefined}>
                  <td className="muted">{i + 1}</td>
                  <td><input className="input" value={r.grade} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, grade: e.target.value.toUpperCase() } : x)))} aria-label={`Daraja ${i + 1}`} style={{ maxWidth: 90 }} /></td>
                  <td><input className="input" type="number" min="0" step="0.001" value={r.priceUsd} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, priceUsd: e.target.value } : x)))} aria-label={`Bei ${i + 1}`} style={{ maxWidth: 100 }} />{pr && <div className="money-neg" style={{ fontSize: 11 }}>{t(pr)}</div>}</td>
                  <td><Button size="sm" variant="ghost" aria-label="Ondoa" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</Button></td>
                </tr>); })}</tbody></table>); })}</div>
          <div className="actions" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            <div className="actions"><Button size="sm" variant="secondary" onClick={() => setRows([...rows, { grade: '', priceUsd: '' }])}>{t('+ Daraja')}</Button>
              <span className="muted">{t('Madaraja')} {filled.length} · {t('wastani')} ${avg.toFixed(3)}</span></div>
            <div className="actions"><Button variant="secondary" onClick={() => setEdit(false)}>{t('Ghairi')}</Button><Button busy={act.busy} disabled={bad || !filled.length} onClick={save}>{t('Hifadhi bei')}</Button></div>
          </div>
        </Section>
      )}
      {paste !== null && (
        <Modal open title="Bandika bei za madaraja" onClose={() => setPaste(null)} footer={<><Button variant="secondary" onClick={() => setPaste(null)}>{t('Ghairi')}</Button>
          <Button disabled={!parsePaste(paste).length} onClick={() => { const p = parsePaste(paste); setRows(p); setEdit(true); setPaste(null); }}>{t('Weka')} {parsePaste(paste).length || ''}</Button></>}>
          <p className="muted">{t('Nakili kutoka Excel au andika daraja na bei kila mstari, mf.')} <strong>X1O 2.124</strong>. {t('Safu za S/N zinarukwa; mstari unaweza kuwa na madaraja kadhaa.')}</p>
          <textarea className="textarea" rows={12} value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Bei za madaraja" placeholder={'1\tX1O\t2.124\n2\tX1L\t2.024\n…'} />
          {paste && <p className="muted">{t('Yamesomwa')}: {parsePaste(paste).length}</p>}
        </Modal>
      )}
    </div>
  );
}
