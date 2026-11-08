import { useState } from 'react';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { CATEGORY_LABEL, date, dateTime, MOVE_LABEL, num, tsh, UNIT_LABEL } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, SelectField, TextField } from '../components/ui';
import { Tabs } from '../components/owner-ui';

interface Item { id: string; name: string; category: string; unit: string; isActive: boolean; reorderLevel: string | null }
interface Price { id: string; inputItemId: string; unitPrice: string }
interface Stock { inputItemId: string; received: string; issued: string; returned: string; adjusted: string; damaged: string; expired: string; balance: string; low: boolean }

export function Inputs() {
  const { may } = useAuth();
  const [tab, setTab] = useState<'stock' | 'expiring' | 'history'>('stock');
  const items = useFetch<{ data: Item[] }>('/inputs/items');
  const prices = useFetch<{ data: Price[] }>('/inputs/prices');
  const stock = useFetch<{ data: Stock[] }>('/inputs/stock');
  const [modal, setModal] = useState<null | { kind: 'item' | 'price' | 'receive' | 'adjust'; item?: Item } | { kind: 'count' }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reloadAll = () => { items.reload(); prices.reload(); stock.reload(); };
  const done = (msg?: string) => { setModal(null); reloadAll(); setNotice(msg ?? null); };

  if (items.loading && !items.data) return <Loading />;
  const priceOf = new Map(prices.data?.data.map((p) => [p.inputItemId, p.unitPrice]));
  const stockOf = new Map(stock.data?.data.map((s) => [s.inputItemId, s]));

  return (
    <>
      <PageHead title="Bidhaa na Stoo" sub="Pembejeo za chama, bei za msimu, salio la stoo na historia ya kila bidhaa">
        {may('reports.stock') && <Button variant="secondary" onClick={() => apiDownload('/store/stock.csv', { filename: 'stoo.csv' })}>Pakua ripoti (Excel)</Button>}
        {may('stock.adjust.request') && <Button variant="secondary" onClick={() => setModal({ kind: 'count' })}>Hesabu ya stoo</Button>}
        {may('products.manage') && <Button onClick={() => setModal({ kind: 'item' })}>+ Bidhaa mpya</Button>}
      </PageHead>
      <Alert>{items.error ?? prices.error ?? stock.error}</Alert>
      <Alert kind="ok">{notice}</Alert>
      <Tabs value={tab} onChange={setTab} items={[['stock', 'Salio la stoo'], ['expiring', 'Zinazoisha muda'], ['history', 'Historia ya bidhaa']]} />

      {tab === 'stock' && (
        <section className="card">
          {items.data?.data.length === 0 ? <Empty>Bado hakuna bidhaa. {may('products.manage') ? 'Anza kwa kusajili bidhaa.' : 'Stokipa ndiye anasajili bidhaa.'}</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Bidhaa</th><th className="num">Bei</th><th className="num">Zilizoingia</th><th className="num">Zilizotoka</th><th className="num">Zilizoharibika / muda</th><th className="num">Salio</th><th /></tr></thead>
                <tbody>
                  {items.data?.data.map((it) => {
                    const s = stockOf.get(it.id);
                    const price = priceOf.get(it.id);
                    return (
                      <tr key={it.id}>
                        <td>
                          <strong>{it.name}</strong> {!it.isActive && <Badge status="CANCELLED" label="Imesitishwa" />}
                          <div className="muted" style={{ fontSize: 13 }}>{CATEGORY_LABEL[it.category]} · {UNIT_LABEL[it.unit]}{it.reorderLevel ? ` · kiwango cha chini ${num(it.reorderLevel)}` : ''}</div>
                        </td>
                        <td className="num">{price ? tsh(price) : <span className="badge badge-warn">Haijawekwa</span>}</td>
                        <td className="num">{num(s?.received)}</td>
                        <td className="num">{num(s?.issued)}</td>
                        <td className="num">{num(Number(s?.damaged ?? 0) + Number(s?.expired ?? 0))}</td>
                        <td className="num"><strong className={s?.low || Number(s?.balance ?? 0) <= 0 ? 'money-neg' : ''}>{num(s?.balance)}</strong>{s?.low && <div><span className="badge badge-warn">Stoo ndogo</span></div>}</td>
                        <td className="num">
                          <span className="actions" style={{ justifyContent: 'flex-end' }}>
                            {may('stock.receive') && <Button size="sm" variant="secondary" onClick={() => setModal({ kind: 'receive', item: it })}>Pokea</Button>}
                            {may('stock.adjust.request') && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'adjust', item: it })}>Omba marekebisho</Button>}
                            {may('prices.manage') && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'price', item: it })}>Bei</Button>}
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
        </section>
      )}
      {tab === 'expiring' && <Expiring />}
      {tab === 'history' && <History items={items.data?.data ?? []} />}

      {modal?.kind === 'item' && <ItemModal item={'item' in modal ? modal.item : undefined} onClose={() => setModal(null)} onDone={() => done()} />}
      {modal?.kind === 'price' && 'item' in modal && modal.item && <PriceModal item={modal.item} current={priceOf.get(modal.item.id)} onClose={() => setModal(null)} onDone={() => done('Bei imehifadhiwa')} />}
      {modal?.kind === 'receive' && 'item' in modal && modal.item && <ReceiveModal item={modal.item} onClose={() => setModal(null)} onDone={() => done('Mzigo umepokelewa na stoo imeongezeka')} />}
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
  const { busy, error, run } = useAction();
  const save = async () => {
    const body = { name, category, unit, reorderLevel: reorder || null, ...(item ? { isActive: active } : {}) };
    const r = await run(() => api(item ? `/inputs/items/${item.id}` : '/inputs/items', { method: item ? 'PATCH' : 'POST', body }));
    if (r) onDone();
  };
  return (
    <Modal open title={item ? `Hariri: ${item.name}` : 'Bidhaa mpya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={name.trim().length < 2} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina *" placeholder="mf. NPK 10:18:24 (50kg)" value={name} onChange={setName} />
      <div className="form-grid">
        <SelectField label="Aina" value={category} onChange={setCategory} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
        <SelectField label="Kipimo" value={unit} onChange={setUnit} options={Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextField label="Kiwango cha chini (onyo la stoo ndogo)" type="number" min="0" value={reorder} onChange={setReorder} />
        {item && <SelectField label="Hali" value={active ? 'on' : 'off'} onChange={(v) => setActive(v === 'on')} options={[{ value: 'on', label: 'Inatumika' }, { value: 'off', label: 'Imesitishwa' }]} />}
      </div>
    </Modal>
  );
}

function PriceModal({ item, current, onClose, onDone }: { item: Item; current?: string; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(current ? String(Number(current)) : '');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Bei ya ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!price} onClick={async () => { if (await run(() => api('/inputs/prices', { method: 'PUT', body: { inputItemId: item.id, unitPrice: price } }))) onDone(); }}>Hifadhi bei</Button></>}>
      <Alert kind="warn">Bei mpya inatumika kwa ugawaji wa sasa na ujao tu. Pembejeo zilizokwisha tolewa zinabaki na bei yao.</Alert>
      <Alert>{error}</Alert>
      <TextField label={`Bei kwa ${UNIT_LABEL[item.unit].toLowerCase()} (TSh) *`} type="number" min="1" step="1" value={price} onChange={setPrice} />
    </Modal>
  );
}

function ReceiveModal({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState('');
  const [reference, setReference] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Pokea mzigo: ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!qty || reference.trim().length < 2} onClick={async () => {
        if (await run(() => api('/inputs/stock/receipts', { method: 'POST', body: { inputItemId: item.id, quantity: qty, reference, batchNo: batchNo || null, expiryDate: expiry || null, notes: notes || undefined } }))) onDone();
      }}>Pokea</Button></>}>
      <p className="muted" style={{ margin: 0 }}>Kwa mzigo usiotokana na ombi la manunuzi la chama (mf. pembejeo kutoka Chama Kikuu au kampuni ya tumbaku). Mzigo wa manunuzi upokee kwenye ukurasa wa <strong>Manunuzi</strong>.</p>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label={`Kiasi (${UNIT_LABEL[item.unit]}) *`} type="number" min="0" step="0.01" value={qty} onChange={setQty} />
        <TextField label="Namba ya hati ya mzigo (delivery note) *" value={reference} onChange={setReference} />
        <TextField label="Namba ya batch" value={batchNo} onChange={setBatchNo} />
        <TextField label="Tarehe ya kuisha muda" type="date" value={expiry} onChange={setExpiry} />
      </div>
      <TextField label="Maelezo (mf. umetoka wapi)" value={notes} onChange={setNotes} />
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

function History({ items }: { items: Item[] }) {
  const [itemId, setItemId] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch<Paged<{ id: string; inputItemId: string; type: string; quantity: string; reference: string | null; notes: string | null; batchNo: string | null; createdAt: string }>>(
    '/inputs/stock/movements', { inputItemId: itemId || undefined, page, pageSize: 30 });
  const nameOf = new Map(items.map((i) => [i.id, i.name]));
  return (
    <section className="card">
      <div className="toolbar">
        <select className="select" aria-label="Bidhaa" value={itemId} onChange={(e) => { setItemId(e.target.value); setPage(1); }}>
          <option value="">Bidhaa zote</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna historia.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Bidhaa</th><th>Aina</th><th className="num">Kiasi</th><th>Kumbukumbu</th></tr></thead>
          <tbody>{data?.data.map((m) => (
            <tr key={m.id}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(m.createdAt)}</td><td>{nameOf.get(m.inputItemId) ?? '—'}</td><td>{MOVE_LABEL[m.type] ?? m.type}</td>
              <td className={`num ${Number(m.quantity) < 0 ? 'money-neg' : ''}`}>{Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}</td>
              <td>{m.reference ?? ''}{m.batchNo ? ` · ${m.batchNo}` : ''}{m.notes ? <div className="muted" style={{ fontSize: 12 }}>{m.notes}</div> : null}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </section>
  );
}
