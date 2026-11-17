import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { CATEGORY_LABEL, date, dateTime, MOVE_LABEL, num, packsAndKg, tsh, UNIT_LABEL } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, SelectField, Stat, TextField } from '../components/ui';
import { Icon } from '../components/icons';
import { Tabs } from '../components/owner-ui';
import { ReceiveInputsModal } from '../components/ReceiveInputs';
import { usd, useFx } from '../lib/fx';

interface Item { id: string; name: string; category: string; unit: string; isActive: boolean; reorderLevel: string | null; packKg: string | null; looseKg: boolean }
interface Price { id: string; inputItemId: string; unitPrice: string; unitPriceUsd: string | null }
type StockStatus = 'OUT' | 'LOW' | 'SOON' | 'OK' | 'NEW';
interface OvItem { id: string; name: string; unit: string; balance: number; received: number; issued: number; lost: number; inPeriod: number; outPeriod: number; avgDaily: number; daysLeft: number | null; suggestedLevel: number | null; value: number; status: StockStatus; lastIn: string | null; lastOut: string | null; reorderLevel: string | null }
interface Overview { season: { name: string }; days: number; kpis: { items: number; out: number; low: number; soon: number; noLevel: number; value: number; movesIn: number; movesOut: number }; items: OvItem[]; daily: { day: string; ins: number; outs: number }[] }
const ST: Record<StockStatus, { label: string; cls: string; rank: number }> = {
  OUT: { label: 'Imeisha', cls: 'st-out', rank: 0 }, LOW: { label: 'Chini ya kiwango', cls: 'st-low', rank: 1 }, SOON: { label: 'Inakaribia kuisha', cls: 'st-soon', rank: 2 },
  OK: { label: 'Inatosha', cls: 'st-ok', rank: 3 }, NEW: { label: 'Bado haijaingia', cls: 'st-new', rank: 4 },
};
interface Stock { inputItemId: string; received: string; issued: string; returned: string; adjusted: string; damaged: string; expired: string; balance: string; low: boolean }

export function Inputs() {
  const { may } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<'stock' | 'expiring' | 'history'>(sp.get('tab') === 'moves' ? 'history' : 'stock');
  const [filter, setFilter] = useState<'all' | 'attention' | 'out' | 'nolevel'>(sp.get('f') === 'attention' ? 'attention' : 'all');
  const [q, setQ] = useState('');
  const ov = useFetch<Overview>('/store/overview', { days: 30 });
  const items = useFetch<{ data: Item[] }>('/inputs/items');
  const prices = useFetch<{ data: Price[] }>('/inputs/prices');
  const stock = useFetch<{ data: Stock[] }>('/inputs/stock');
  const [modal, setModal] = useState<null | { kind: 'item' | 'price' | 'receive' | 'adjust'; item?: Item } | { kind: 'count' }>(null);
  const pending = useFetch<{ data: { id: string; requestNo: string; title: string; amount: string | null; reason: string | null; createdAt: string; requestedBy: string | null }[] }>(may('approvals.read') ? '/approvals' : null, { status: 'PENDING', type: 'STOCK_RECEIPT', pageSize: 50 });
  const [notice, setNotice] = useState<string | null>(null);
  const fx = useFx();
  const reloadAll = () => { items.reload(); prices.reload(); stock.reload(); pending.reload(); ov.reload(); };
  const done = (msg?: string) => { setModal(null); reloadAll(); setNotice(msg ?? null); };

  if (items.loading && !items.data) return <Loading />;
  // Chama cha USD: bei ni ya dola (bei bila dola = haijawekwa)
  const priceOf = new Map(prices.data?.data.filter((p) => !fx.usdMode || p.unitPriceUsd).map((p) => [p.inputItemId, fx.usdMode ? p.unitPriceUsd! : p.unitPrice]));
  const stockOf = new Map(stock.data?.data.map((s) => [s.inputItemId, s]));
  const ovOf = new Map(ov.data?.items.map((x) => [x.id, x]));
  const k = ov.data?.kpis;
  const shownItems = (items.data?.data ?? []).filter((it) => {
    const o = ovOf.get(it.id);
    if (q && !it.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'attention') return !!o && ['OUT', 'LOW', 'SOON'].includes(o.status);
    if (filter === 'out') return o?.status === 'OUT';
    if (filter === 'nolevel') return it.isActive && !it.reorderLevel && !!o && o.status !== 'NEW';
    return true;
  }).sort((a, b) => (ST[ovOf.get(a.id)?.status ?? 'OK'].rank - ST[ovOf.get(b.id)?.status ?? 'OK'].rank) || a.name.localeCompare(b.name));
  const pickFilter = (f: typeof filter) => { setFilter(f); setTab('stock'); setSp(f === 'attention' ? { f } : {}, { replace: true }); };

  return (
    <>
      <PageHead title="Bidhaa na Stoo" sub="Pembejeo za chama, bei za msimu, salio la stoo na historia ya kila bidhaa">
        {may('reports.stock') && <Button variant="secondary" onClick={() => apiDownload('/store/stock.csv', { filename: 'stoo.csv' })}>Pakua ripoti (Excel)</Button>}
        {may('stock.adjust.request') && <Button variant="secondary" onClick={() => setModal({ kind: 'count' })}>Hesabu ya stoo</Button>}
        {may('stock.receive') && <Button variant="gold" onClick={() => setModal({ kind: 'receive' })}>+ Ingiza pembejeo</Button>}
      </PageHead>
      <Alert>{items.error ?? prices.error ?? stock.error}</Alert>
      {fx.usdMode && <div className="fx-strip"><span>💵 Pembejeo zinakopeshwa kwa <strong>dola</strong></span><span>Kiwango cha sasa: <strong>{fx.rate ? `1 USD = TSh ${num(fx.rate)}` : 'hakijawekwa'}</strong></span></div>}
      <Alert kind="ok">{notice}</Alert>
      {!!pending.data?.data.length && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="section-head"><h2>Mizigo inayosubiri idhini ya Meneja ({pending.data.data.length})</h2>{may('approvals.decide') && <Link to="/approvals">Amua →</Link>}</div>
          <div className="table-wrap"><table className="table"><tbody>{pending.data.data.map((p) => (
            <tr key={p.id}><td style={{ whiteSpace: 'nowrap' }}><strong>{p.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{dateTime(p.createdAt)}</div></td>
              <td>{p.title}{p.reason && <div className="muted" style={{ fontSize: 12 }}>{p.reason}</div>}</td>
              <td className="num">{p.amount ? tsh(p.amount) : ''}</td><td><Badge status="PENDING_APPROVAL" label="Haijaingia stoo" /></td></tr>
          ))}</tbody></table></div>
        </section>
      )}
      {k && (
        <div className="grid grid-4 stk-kpis">
          <button type="button" className="stk-kpi" onClick={() => pickFilter('out')}><Stat label="Zimeisha stoo" icon="inputs" tone="red" value={<span className={k.out ? 'money-neg' : ''}>{k.out}</span>} hint={k.out ? 'Wakulima hawawezi kupewa — ingiza mzigo' : 'Hakuna bidhaa iliyoisha'} /></button>
          <button type="button" className="stk-kpi" onClick={() => pickFilter('attention')}><Stat label="Zinakaribia kuisha" icon="activity" tone="gold" value={k.low + k.soon} hint={`${k.low} chini ya kiwango · ${k.soon} kwa kasi ya kutoka`} /></button>
          <button type="button" className="stk-kpi" onClick={() => setTab('history')}><Stat label={`Mienendo · siku ${ov.data!.days}`} icon="arrowIn" tone="green" value={<span className="stk-io"><b>+{k.movesIn}</b> <i>−{k.movesOut}</i></span>} hint="Zilizoingia · zilizotoka" /></button>
          <Stat label="Thamani ya stoo" icon="money" tone="blue" value={k.value ? tsh(k.value) : '—'} hint={k.value ? 'Kwa gharama ya kununua' : 'Gharama za mizigo hazijawekwa'} />
        </div>
      )}
      {ov.data && <Trend daily={ov.data.daily} />}
      <Tabs value={tab} onChange={setTab} items={[['stock', 'Salio la stoo'], ['history', 'Inayoingia na inayotoka'], ['expiring', 'Zinazoisha muda']]} />

      {tab === 'stock' && (
        <section className="card">
          <div className="toolbar stk-bar">
            <div className="seg" role="group" aria-label="Chuja bidhaa">
              {([['all', 'Zote', k?.items], ['attention', 'Zinahitaji hatua', k ? k.out + k.low + k.soon : 0], ['out', 'Zimeisha', k?.out], ['nolevel', 'Bila kiwango cha chini', k?.noLevel]] as const).map(([f, l, n]) => (
                <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => pickFilter(f)}>{l}{!!n && <em className={f === 'attention' || f === 'out' ? 'bad' : ''}>{n}</em>}</button>
              ))}
            </div>
            <input className="input stk-search" placeholder="Tafuta bidhaa…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta bidhaa" />
          </div>
          {items.data?.data.length === 0 ? <Empty>Bado hakuna pembejeo stoo. {may('stock.receive') ? 'Bonyeza "+ Ingiza pembejeo" — unaweza kuandika bidhaa mpya moja kwa moja kwenye fomu.' : 'Storekeeper ndiye anaingiza pembejeo.'}</Empty>
          : !shownItems.length ? <Empty>{filter === 'attention' ? '✓ Hakuna bidhaa inayohitaji hatua — stoo iko sawa.' : 'Hakuna bidhaa inayolingana.'}</Empty> : (
            <div className="table-wrap">
              <table className="table stk-table">
                <thead><tr><th>Bidhaa</th><th>Hali</th><th className="num">Salio</th><th className="num">Ingia / toka (siku 30)</th><th>Itatosha</th><th className="num">Bei</th><th /></tr></thead>
                <tbody>
                  {shownItems.map((it) => {
                    const s = stockOf.get(it.id);
                    const o = ovOf.get(it.id);
                    const price = priceOf.get(it.id);
                    const st = ST[o?.status ?? 'NEW'];
                    const level = it.reorderLevel ? Number(it.reorderLevel) : o?.suggestedLevel ?? null;
                    const pct = o && level ? Math.min(100, Math.round((o.balance / (level * 3)) * 100)) : o && o.balance > 0 ? 100 : 0;
                    const fmtQ = (v: number | string | undefined) => (it.packKg ? packsAndKg(String(v ?? 0), it.packKg) : num(v));
                    return (
                      <tr key={it.id} className={`stk-row ${st.cls}`}>
                        <td>
                          <strong>{it.name}</strong> {!it.isActive && <Badge status="CANCELLED" label="Imesitishwa" />}
                          <div className="muted" style={{ fontSize: 13 }}>{CATEGORY_LABEL[it.category]} · {UNIT_LABEL[it.unit]}{it.packKg ? ` wa kilo ${num(it.packKg)}` : ''}</div>
                          {it.looseKg && <span className="badge badge-info" title="Inagawiwa kwa kilo pia (mf. vitalu)">Inagawiwa kwa kilo</span>}
                        </td>
                        <td><span className={`stk-pill ${st.cls}`}>{st.label}</span></td>
                        <td className="num">
                          <strong className={o?.status === 'OUT' ? 'money-neg' : ''}>{fmtQ(o?.balance ?? s?.balance)}</strong>
                          <div className="stk-meter" title={level ? `Kiwango cha chini: ${num(level)}` : ''}><i style={{ width: `${pct}%` }} />{level && <b style={{ left: '33.3%' }} />}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{it.reorderLevel ? `kiwango cha chini ${num(it.reorderLevel)}` : o?.suggestedLevel ? `pendekezo: kiwango ${num(o.suggestedLevel)}` : ''}</div>
                        </td>
                        <td className="num"><span className="stk-in">+{num(o?.inPeriod)}</span> <span className="stk-out">−{num(o?.outPeriod)}</span>
                          <div className="muted" style={{ fontSize: 12 }}>msimu: ingia {num(o?.received ?? s?.received)} · toka {fmtQ(o?.issued ?? s?.issued)}{o?.lost ? ` · zimepotea ${num(o.lost)}` : ''}</div></td>
                        <td>{o?.status === 'OUT' ? <span className="money-neg">Imeisha{o.lastOut ? ` ${date(o.lastOut)}` : ''}</span>
                          : o?.daysLeft !== null && o?.daysLeft !== undefined ? <><b>≈ siku {o.daysLeft}</b><div className="muted" style={{ fontSize: 12 }}>{num(o.avgDaily)} kwa siku</div></>
                          : <span className="muted">{o?.status === 'NEW' ? '—' : 'Haitoki kwa sasa'}</span>}
                          {o?.lastIn && <div className="muted" style={{ fontSize: 12 }}>iliingia {date(o.lastIn)}</div>}</td>
                        <td className="num">{price ? (fx.usdMode ? <>{usd(price)}{fx.rate && <div className="muted" style={{ fontSize: 12 }}>≈ {tsh(Number(price) * fx.rate)}</div>}</> : tsh(price)) : <span className="badge badge-warn">Haijawekwa</span>}
                          {price && it.looseKg && it.packKg && <div className="muted" style={{ fontSize: 12 }}>{fx.usdMode ? usd(Number(price) / Number(it.packKg)) : tsh(Number(price) / Number(it.packKg))} kwa kilo</div>}</td>
                        <td className="num">
                          <span className="actions" style={{ justifyContent: 'flex-end' }}>
                            {(o?.status === 'OUT' || o?.status === 'LOW' || o?.status === 'SOON') && may('stock.receive') && <Button size="sm" variant="gold" onClick={() => setModal({ kind: 'receive' })}>Ingiza mzigo</Button>}
                            {may('products.manage') && !it.reorderLevel && o?.suggestedLevel && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'item', item: { ...it, reorderLevel: String(o.suggestedLevel) } })}>Weka kiwango</Button>}
                            {may('stock.adjust.request') && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'adjust', item: it })}>Omba marekebisho</Button>}
                            {may('prices.manage') && !price && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'price', item: it })}>Weka bei</Button>}
                            {may('products.manage') && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'item', item: it })}>Hariri</Button>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted st-small" style={{ padding: '0 16px 12px' }}>Bidhaa isiyo na kiwango cha chini inapewa tahadhari ikibakiza chini ya siku 14 kwa kasi ya sasa ya kutoka. Weka kiwango cha chini (Hariri) ili kupata tahadhari mapema; mfumo unapendekeza mahitaji ya siku 14.</p>
        </section>
      )}
      {tab === 'expiring' && <Expiring />}
      {tab === 'history' && <History items={items.data?.data ?? []} canCsv={may('reports.stock')} />}

      {modal?.kind === 'item' && <ItemModal item={'item' in modal ? modal.item : undefined} onClose={() => setModal(null)} onDone={() => done()} />}
      {modal?.kind === 'price' && 'item' in modal && modal.item && <PriceModal item={modal.item} current={priceOf.get(modal.item.id)} usdMode={fx.usdMode} rate={fx.rate} onClose={() => setModal(null)} onDone={() => done('Bei imehifadhiwa')} />}
      {modal?.kind === 'receive' && <ReceiveInputsModal onClose={() => setModal(null)} onDone={(no) => done(`Mzigo umetumwa kwa Meneja (${no}). Stoo itaongezeka na pembejeo zitaweza kutolewa baada ya Meneja kuidhinisha idadi na bei.`)} />}
      {modal?.kind === 'adjust' && 'item' in modal && modal.item && <AdjustModal item={modal.item} balance={stockOf.get(modal.item.id)?.balance ?? '0'} onClose={() => setModal(null)} onDone={() => done('Ombi la marekebisho limetumwa kwa Meneja. Stoo itabadilika baada ya idhini.')} />}
      {modal?.kind === 'count' && <CountModal items={items.data?.data.filter((i) => i.isActive) ?? []} stockOf={stockOf} onClose={() => setModal(null)} onDone={(n) => done(n ? `Tofauti ${n} zimetumwa kwa Meneja kama maombi ya marekebisho.` : 'Hesabu inalingana na mfumo. Hakuna marekebisho.')} />}
    </>
  );
}

function ItemModal({ item, onClose, onDone }: { item?: Item; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState(item?.category ?? 'FERTILIZER');
  const [unit, setUnit] = useState(item?.unit ?? 'BAG');
  const [reorder, setReorder] = useState(item?.reorderLevel ? String(Number(item.reorderLevel)) : '');
  const [active, setActive] = useState(item?.isActive ?? true);
  const [packKg, setPackKg] = useState(item?.packKg ? String(Number(item.packKg)) : '');
  const [looseKg, setLooseKg] = useState(item?.looseKg ?? false);
  const { busy, error, run } = useAction();
  const save = async () => {
    const body = { name, category, unit, reorderLevel: reorder || null, packKg: packKg || null, looseKg: unit !== 'KG' && looseKg, ...(item ? { isActive: active } : {}) };
    const r = await run(() => api(item ? `/inputs/items/${item.id}` : '/inputs/items', { method: item ? 'PATCH' : 'POST', body }));
    if (r) onDone();
  };
  return (
    <Modal open title={item ? `Hariri: ${item.name}` : 'Bidhaa mpya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={name.trim().length < 2 || (looseKg && unit !== 'KG' && !(Number(packKg) > 0))} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina *" placeholder="mf. NPK 10:18:24 (50kg)" value={name} onChange={setName} />
      <div className="form-grid">
        <SelectField label="Aina" value={category} onChange={setCategory} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
        <SelectField label="Kipimo" value={unit} onChange={setUnit} options={Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextField label="Kiwango cha chini (onyo la stoo ndogo)" type="number" min="0" value={reorder} onChange={setReorder} />
        {item && <SelectField label="Hali" value={active ? 'on' : 'off'} onChange={(v) => setActive(v === 'on')} options={[{ value: 'on', label: 'Inatumika' }, { value: 'off', label: 'Imesitishwa' }]} />}
        {unit !== 'KG' && <TextField label={`Kilo kwa ${UNIT_LABEL[unit]?.toLowerCase() ?? 'kipimo'} kimoja`} type="number" min="0" step="0.1" value={packKg} onChange={setPackKg} placeholder="mf. 50" />}
      </div>
      {unit !== 'KG' && (
        <label className="check-row">
          <input type="checkbox" checked={looseKg} onChange={(e) => setLooseKg(e.target.checked)} />
          <span><strong>Inagawiwa kwa kilo pia</strong> (mf. mbolea ya vitalu). Bei ya kilo = bei ya {UNIT_LABEL[unit]?.toLowerCase()} ÷ kilo zake{packKg && Number(packKg) > 0 ? ` (÷ ${packKg})` : ''}.</span>
        </label>
      )}
      {looseKg && !(Number(packKg) > 0) && unit !== 'KG' && <Alert kind="warn">Weka kilo ngapi kwa {UNIT_LABEL[unit]?.toLowerCase()} kimoja.</Alert>}
    </Modal>
  );
}

function PriceModal({ item, current, usdMode, rate, onClose, onDone }: { item: Item; current?: string; usdMode: boolean; rate: number | null; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(current ? String(Number(current)) : '');
  const { busy, error, run } = useAction();
  const body = usdMode ? { inputItemId: item.id, unitPriceUsd: price } : { inputItemId: item.id, unitPrice: price };
  return (
    <Modal open title={`Bei ya ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!price || (usdMode && !rate)} onClick={async () => { if (await run(() => api('/inputs/prices', { method: 'PUT', body }))) onDone(); }}>Hifadhi bei</Button></>}>
      <Alert kind="warn">Bei mpya inatumika kwa ugawaji wa sasa na ujao tu. Pembejeo zilizokwisha tolewa zinabaki na bei yao.</Alert>
      {usdMode && !rate && <Alert>Mhasibu bado hajaweka kiwango cha dola (Fedha → Dola).</Alert>}
      <Alert>{error}</Alert>
      <TextField label={`Bei kwa ${UNIT_LABEL[item.unit].toLowerCase()} (${usdMode ? 'USD' : 'TSh'}) *`} type="number" min={usdMode ? '0.01' : '1'} step={usdMode ? '0.01' : '1'} value={price} onChange={setPrice}
        help={usdMode && rate && price ? `≈ ${tsh(Number(price) * rate)} kwa kiwango cha leo · deni la mkulima litakuwa la dola` : undefined} />
    </Modal>
  );
}


function AdjustModal({ item, balance, onClose, onDone }: { item: Item; balance: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('DAMAGE');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const signed = kind === 'ADJUSTMENT' ? qty : qty ? `-${Math.abs(Number(qty))}` : '';
  return (
    <Modal open title={`Omba marekebisho: ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!qty || Number(qty) === 0 || notes.trim().length < 5} onClick={async () => {
        if (await run(() => api('/inputs/stock/adjustments', { method: 'POST', body: { inputItemId: item.id, quantity: signed, kind, notes } }))) onDone();
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Stoo haitabadilika hadi Meneja aidhinishe ombi hili. Salio la sasa: <strong>{num(balance)} {UNIT_LABEL[item.unit]}</strong>.</Alert>
      <Alert>{error}</Alert>
      <SelectField label="Aina ya marekebisho" value={kind} onChange={setKind} options={[
        { value: 'DAMAGE', label: 'Bidhaa zimeharibika (inapunguza)' },
        { value: 'EXPIRY', label: 'Muda wa matumizi umeisha (inapunguza)' },
        { value: 'ADJUSTMENT', label: 'Marekebisho ya hesabu (+ au -)' },
      ]} />
      <TextField label={`Kiasi (${UNIT_LABEL[item.unit]}) *`} help={kind === 'ADJUSTMENT' ? 'Hasi kupunguza (mf. -3), chanya kuongeza' : 'Andika idadi iliyoharibika/kuisha muda'} type="number" step="0.01" value={qty} onChange={setQty} />
      <TextField label="Sababu *" value={notes} onChange={setNotes} />
    </Modal>
  );
}

function CountModal({ items, stockOf, onClose, onDone }: { items: Item[]; stockOf: Map<string, Stock>; onClose: () => void; onDone: (n: number) => void }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const filled = Object.entries(counts).filter(([, v]) => v !== '');
  return (
    <Modal open title="Hesabu ya stoo (reconciliation)" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!filled.length || notes.trim().length < 3} onClick={async () => {
        const r = await run(() => api<{ approvals: unknown[] }>('/store/stock-count', { method: 'POST', body: { notes, counts: filled.map(([inputItemId, countedQty]) => ({ inputItemId, countedQty })) } }));
        if (r) onDone(r.approvals.length);
      }}>Linganisha</Button></>}>
      <p className="muted" style={{ margin: 0 }}>Andika idadi halisi uliyohesabu stoo. Tofauti zitatumwa kwa Meneja kama maombi ya marekebisho.</p>
      <Alert>{error}</Alert>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Bidhaa</th><th className="num">Mfumo</th><th className="num">Halisi</th><th className="num">Tofauti</th></tr></thead>
        <tbody>{items.map((it) => {
          const sys = Number(stockOf.get(it.id)?.balance ?? 0);
          const v = counts[it.id] ?? '';
          const diff = v === '' ? null : Number(v) - sys;
          return (
            <tr key={it.id}>
              <td>{it.name}</td><td className="num">{num(sys)}</td>
              <td className="num"><input className="input" style={{ width: 100, textAlign: 'right' }} type="number" min="0" aria-label={`Halisi ${it.name}`} value={v} onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })} /></td>
              <td className={`num ${diff && diff < 0 ? 'money-neg' : ''}`}>{diff === null ? '' : diff === 0 ? 'Sawa' : (diff > 0 ? '+' : '') + num(diff)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <TextField label="Maelezo ya hesabu *" placeholder="mf. Hesabu ya mwisho wa mwezi" value={notes} onChange={setNotes} />
    </Modal>
  );
}

function Expiring() {
  const { data, loading } = useFetch<{ data: { id: string; name: string; unit: string; batchNo: string | null; expiryDate: string; quantity: string; reference: string | null; expired: boolean }[] }>('/store/expiring', { days: 90 });
  return (
    <section className="card">
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna mzigo unaoisha muda ndani ya siku 90.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Bidhaa</th><th>Batch</th><th>Hati</th><th className="num">Kiasi kilichopokelewa</th><th>Muda unaisha</th></tr></thead>
          <tbody>{data?.data.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td>{r.batchNo ?? '—'}</td><td>{r.reference ?? '—'}</td><td className="num">{num(r.quantity)} {UNIT_LABEL[r.unit]}</td>
              <td>{date(r.expiryDate)} {r.expired ? <span className="badge badge-bad">Umeisha</span> : <span className="badge badge-warn">Karibu</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted" style={{ fontSize: 13, padding: '0 16px 12px' }}>Bidhaa zilizoisha muda ziondolewe kwa "Omba marekebisho → Muda umeisha" ili Meneja aidhinishe.</p>
    </section>
  );
}

function History({ items, canCsv }: { items: Item[]; canCsv: boolean }) {
  const [f, setF] = useState({ itemId: '', direction: '' as '' | 'IN' | 'OUT', type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = { inputItemId: f.itemId || undefined, direction: f.direction || undefined, type: f.type || undefined, from: f.from || undefined, to: f.to || undefined };
  const { data, loading } = useFetch<Paged<Move> & { totals: { inQty: string; outQty: string; inCount: number; outCount: number } }>('/inputs/stock/movements', { ...params, page, pageSize: 30 });
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const tot = data?.totals;
  const presets: [string, number][] = [['Leo', 0], ['Siku 7', 6], ['Siku 30', 29]];
  const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  return (
    <section className="card">
      <div className="toolbar stk-bar">
        <div className="seg" role="group" aria-label="Mwelekeo">
          {([['', 'Zote'], ['IN', '+ Zinazoingia'], ['OUT', '− Zinazotoka']] as const).map(([v, l]) => <button key={v} type="button" className={f.direction === v ? 'on' : ''} onClick={() => set('direction')(v)}>{l}</button>)}
        </div>
        <select className="select" aria-label="Bidhaa" value={f.itemId} onChange={(e) => set('itemId')(e.target.value)}>
          <option value="">Bidhaa zote</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select className="select" aria-label="Aina" value={f.type} onChange={(e) => set('type')(e.target.value)}>
          <option value="">Aina zote</option>
          {Object.entries(MOVE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="input" type="date" aria-label="Kuanzia" value={f.from} max={f.to || undefined} onChange={(e) => set('from')(e.target.value)} />
        <input className="input" type="date" aria-label="Mpaka" value={f.to} min={f.from || undefined} onChange={(e) => set('to')(e.target.value)} />
        <span className="stk-presets">{presets.map(([l, d]) => <button key={l} type="button" className="nb-link" onClick={() => { setF((x) => ({ ...x, from: iso(new Date(Date.now() - d * 864e5)), to: iso(new Date()) })); setPage(1); }}>{l}</button>)}</span>
        {canCsv && <Button size="sm" variant="secondary" onClick={() => apiDownload('/store/movements.csv', { query: params, filename: 'stoo-ingia-toka.csv' })}>Pakua (Excel)</Button>}
      </div>
      {tot && (
        <div className="stk-sum">
          <div className="in"><Icon name="arrowIn" /><span><b>{num(tot.inQty)}</b><small>Zilizoingia · mara {tot.inCount}</small></span></div>
          <div className="out"><Icon name="arrowOut" /><span><b>{num(tot.outQty)}</b><small>Zilizotoka · mara {tot.outCount}</small></span></div>
          <p className="muted">{f.itemId ? 'Kwa kipimo cha bidhaa hii.' : 'Jumla inachanganya vipimo tofauti — chagua bidhaa moja kupata idadi halisi.'}</p>
        </div>
      )}
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna mwendo wa stoo kwa vichujio hivi.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Bidhaa</th><th>Aina</th><th className="num">Ingia</th><th className="num">Toka</th><th>Kwa / kutoka</th><th>Kumbukumbu</th><th>Aliyefanya</th></tr></thead>
          <tbody>{data?.data.map((m) => {
            const n = Number(m.quantity);
            return (
              <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(m.createdAt)}</td>
                <td><strong>{m.itemName}</strong><div className="muted" style={{ fontSize: 12 }}>{UNIT_LABEL[m.unit] ?? m.unit}</div></td>
                <td><span className={`stk-type ${n > 0 ? 'in' : 'out'}`}>{MOVE_LABEL[m.type] ?? m.type}</span></td>
                <td className="num stk-in">{n > 0 ? `+${num(n)}` : ''}</td>
                <td className="num stk-out">{n < 0 ? `−${num(-n)}` : ''}</td>
                <td>{m.member ?? m.supplier ?? '—'}</td>
                <td>{m.reference ?? ''}{m.batchNo ? ` · batch ${m.batchNo}` : ''}{m.expiryDate ? <div className="muted" style={{ fontSize: 12 }}>muda unaisha {date(m.expiryDate)}</div> : null}{m.notes ? <div className="muted" style={{ fontSize: 12 }}>{m.notes}</div> : null}</td>
                <td>{m.by ?? '—'}</td></tr>
            );
          })}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </section>
  );
}

interface Move { id: string; inputItemId: string; type: string; quantity: string; reference: string | null; notes: string | null; batchNo: string | null; expiryDate: string | null; createdAt: string; itemName: string; unit: string; by: string | null; member: string | null; supplier: string | null }

/** Mwenendo wa siku 30: mizigo iliyoingia (kijani) na iliyotoka (dhahabu) kila siku */
function Trend({ daily }: { daily: { day: string; ins: number; outs: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.ins, d.outs)));
  const total = useMemo(() => daily.reduce((t, d) => t + d.ins + d.outs, 0), [daily]);
  if (!total) return null;
  return (
    <section className="card stk-trend" aria-label="Mwenendo wa stoo siku 30">
      <div className="stk-trend-h"><b>Mwenendo wa stoo · siku {daily.length}</b><span><i className="in" />Zilizoingia <i className="out" />Zilizotoka</span></div>
      <div className="stk-bars">{daily.map((d) => (
        <div key={d.day} className="stk-day" title={`${date(d.day)}: ingia ${d.ins} · toka ${d.outs}`}>
          <span className="in" style={{ height: `${(d.ins / max) * 100}%` }} /><span className="out" style={{ height: `${(d.outs / max) * 100}%` }} />
        </div>
      ))}</div>
      <div className="stk-trend-x"><span>{date(daily[0].day)}</span><span>Leo</span></div>
    </section>
  );
}
