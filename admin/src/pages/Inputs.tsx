import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { CATEGORY_LABEL, num, tsh, UNIT_LABEL } from '../lib/format';
import { useAuth, ROLE_GROUPS } from '../lib/auth';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';

interface Item { id: string; name: string; category: string; unit: string; isActive: boolean }
interface Price { id: string; inputItemId: string; unitPrice: string; item: { id: string; name: string; unit: string } }
interface Stock { inputItemId: string; name: string; unit: string; received: string; issued: string; returned: string; adjusted: string; balance: string }

export function Inputs() {
  const { can } = useAuth();
  const items = useFetch<{ data: Item[] }>('/inputs/items');
  const prices = useFetch<{ data: Price[] }>('/inputs/prices');
  const stock = useFetch<{ data: Stock[] }>('/inputs/stock');
  const [itemOpen, setItemOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<Item | null>(null);
  const [receiveFor, setReceiveFor] = useState<Item | null>(null);
  const [adjustFor, setAdjustFor] = useState<Item | null>(null);
  const reloadAll = () => { items.reload(); prices.reload(); stock.reload(); };

  if (items.loading && !items.data) return <Loading />;
  const priceOf = new Map(prices.data?.data.map((p) => [p.inputItemId, p.unitPrice]));
  const stockOf = new Map(stock.data?.data.map((s) => [s.inputItemId, s]));
  const managers = can(...ROLE_GROUPS.MANAGERS);
  const staff = can(...ROLE_GROUPS.STAFF);

  return (
    <>
      <PageHead title="Pembejeo na Stoo" sub="Aina za pembejeo, bei za msimu huu na salio la stoo">
        {managers && <Button onClick={() => setItemOpen(true)}>+ Aina mpya ya pembejeo</Button>}
      </PageHead>
      <Alert>{items.error ?? prices.error ?? stock.error}</Alert>
      <section className="card">
        {items.data?.data.length === 0 ? <Empty>Bado hakuna pembejeo. Anza kwa kuongeza aina ya pembejeo.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pembejeo</th><th>Aina</th><th className="num">Bei / kipimo</th><th className="num">Imepokelewa</th><th className="num">Imetolewa</th><th className="num">Salio</th><th /></tr></thead>
              <tbody>
                {items.data?.data.map((it) => {
                  const s = stockOf.get(it.id);
                  const price = priceOf.get(it.id);
                  const low = s && Number(s.balance) <= 10;
                  return (
                    <tr key={it.id}>
                      <td><strong>{it.name}</strong> {!it.isActive && <Badge status="CANCELLED" label="Imesitishwa" />}<div className="muted" style={{ fontSize: 13 }}>{UNIT_LABEL[it.unit]}</div></td>
                      <td>{CATEGORY_LABEL[it.category]}</td>
                      <td className="num">{price ? tsh(price) : <span className="badge badge-warn">Bei haijawekwa</span>}</td>
                      <td className="num">{num(s?.received)}</td>
                      <td className="num">{num(s?.issued)}</td>
                      <td className={`num ${low ? 'money-neg' : ''}`}>{num(s?.balance)}</td>
                      <td className="num">
                        <span className="actions" style={{ justifyContent: 'flex-end' }}>
                          {staff && <Button size="sm" variant="secondary" onClick={() => setReceiveFor(it)}>Pokea</Button>}
                          {managers && <Button size="sm" variant="ghost" onClick={() => setPriceFor(it)}>Bei</Button>}
                          {managers && <Button size="sm" variant="ghost" onClick={() => setAdjustFor(it)}>Rekebisha</Button>}
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

      <ItemModal open={itemOpen} onClose={() => setItemOpen(false)} onDone={() => { setItemOpen(false); reloadAll(); }} />
      {priceFor && <PriceModal item={priceFor} current={priceOf.get(priceFor.id)} onClose={() => setPriceFor(null)} onDone={() => { setPriceFor(null); reloadAll(); }} />}
      {receiveFor && <StockModal kind="receive" item={receiveFor} onClose={() => setReceiveFor(null)} onDone={() => { setReceiveFor(null); reloadAll(); }} />}
      {adjustFor && <StockModal kind="adjust" item={adjustFor} onClose={() => setAdjustFor(null)} onDone={() => { setAdjustFor(null); reloadAll(); }} />}
    </>
  );
}

function ItemModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('FERTILIZER');
  const [unit, setUnit] = useState('BAG');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/inputs/items', { method: 'POST', body: { name, category, unit } }));
    if (r) { setName(''); onDone(); }
  };
  return (
    <Modal open={open} title="Aina mpya ya pembejeo" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={name.trim().length < 2} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina *" placeholder="mf. NPK 10:18:24 (50kg)" value={name} onChange={setName} />
      <SelectField label="Aina" value={category} onChange={setCategory} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
      <SelectField label="Kipimo" value={unit} onChange={setUnit} options={Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }))} />
    </Modal>
  );
}

function PriceModal({ item, current, onClose, onDone }: { item: Item; current?: string; onClose: () => void; onDone: () => void }) {
  const [price, setPrice] = useState(current ? String(Number(current)) : '');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/inputs/prices', { method: 'PUT', body: { inputItemId: item.id, unitPrice: price } }));
    if (r) onDone();
  };
  return (
    <Modal open title={`Bei ya ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!price} onClick={save}>Hifadhi bei</Button></>}>
      <Alert kind="warn">Bei mpya inatumika kwa utoaji wa sasa na ujao tu. Pembejeo zilizokwisha tolewa zinabaki na bei yao ya awali.</Alert>
      <Alert>{error}</Alert>
      <TextField label={`Bei kwa ${UNIT_LABEL[item.unit].toLowerCase()} (TSh) *`} type="number" min="1" step="1" value={price} onChange={setPrice} />
    </Modal>
  );
}

function StockModal({ kind, item, onClose, onDone }: { kind: 'receive' | 'adjust'; item: Item; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const save = async () => {
    const path = kind === 'receive' ? '/inputs/stock/receipts' : '/inputs/stock/adjustments';
    const r = await run(() => api(path, { method: 'POST', body: { inputItemId: item.id, quantity: qty, reference: reference || undefined, notes: notes || undefined } }));
    if (r) onDone();
  };
  const receive = kind === 'receive';
  return (
    <Modal open title={`${receive ? 'Pokea stoo' : 'Rekebisha stoo'}: ${item.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!qty || (!receive && notes.trim().length < 5)} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label={`Kiasi (${UNIT_LABEL[item.unit]}) *`} help={receive ? undefined : 'Tumia namba hasi kupunguza (mf. -3), chanya kuongeza'} type="number" step="0.01" value={qty} onChange={setQty} />
      {receive && <TextField label="Namba ya hati ya kupokelea (delivery note)" value={reference} onChange={setReference} />}
      <TextField label={receive ? 'Maelezo' : 'Sababu ya marekebisho *'} value={notes} onChange={setNotes} />
    </Modal>
  );
}
