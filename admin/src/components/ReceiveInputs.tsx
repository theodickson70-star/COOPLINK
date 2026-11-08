// =====================================================================
//  INGIZA PEMBEJEO — fomu MOJA ya kuingiza mzigo stoo (inatumika Stoo na Manunuzi)
//   Bidhaa iliyopo au mpya · mzigo wa kawaida au wa ombi la manunuzi · idadi na bei ya mkulima
//   -> Meneja anaidhinisha -> stoo inaongezeka
// =====================================================================
import { useEffect, useState } from 'react';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { CATEGORY_LABEL, num, tsh, UNIT_LABEL } from '../lib/format';
import { Alert, Button, Modal, SelectField, TextField } from './ui';

interface Item { id: string; name: string; category: string; unit: string; isActive: boolean }
interface PrLine { id: string; quantity: string; receivedQty: string; unitCost: string; inputItemId?: string; inputItem: { id?: string; name: string; unit: string } }
const NEW = '__new__';

export function ReceiveInputsModal({ itemId: initialItem, purchaseId: initialPr, onClose, onDone }: {
  itemId?: string; purchaseId?: string; onClose: () => void; onDone: (requestNo: string) => void;
}) {
  const items = useFetch<{ data: Item[] }>('/inputs/items');
  const prices = useFetch<{ data: { inputItemId: string; unitPrice: string }[] }>('/inputs/prices');
  const prs = useFetch<Paged<{ id: string; prNo: string; status: string; supplierName?: string | null; supplier?: string | null }>>('/store/purchases', { pageSize: 100 });
  const [mode, setMode] = useState<'normal' | 'purchase'>(initialPr ? 'purchase' : 'normal');
  const [prId, setPrId] = useState(initialPr ?? '');
  const pr = useFetch<{ lines: PrLine[]; purchase: { prNo: string; supplierName: string | null } }>(mode === 'purchase' && prId ? `/store/purchases/${prId}` : null);
  const [lineId, setLineId] = useState('');
  const [itemId, setItemId] = useState(initialItem ?? '');
  const [nItem, setNItem] = useState({ name: '', category: 'FERTILIZER', unit: 'BAG', reorderLevel: '' });
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [source, setSource] = useState('');
  const [reference, setReference] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();

  const priceOf = new Map(prices.data?.data.map((p) => [p.inputItemId, p.unitPrice]));
  const active = items.data?.data.filter((i) => i.isActive) ?? [];
  const openPrs = prs.data?.data.filter((p) => ['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status)) ?? [];
  const openLines = pr.data?.lines.filter((l) => Number(l.receivedQty) < Number(l.quantity)) ?? [];
  const line = openLines.find((l) => l.id === lineId);
  const lineItem = line ? active.find((i) => i.id === line.inputItemId) : undefined;
  const isNew = mode === 'normal' && itemId === NEW;
  const item = mode === 'purchase' ? lineItem : active.find((i) => i.id === itemId);
  const unit = isNew ? UNIT_LABEL[nItem.unit] : item ? UNIT_LABEL[item.unit] : line ? UNIT_LABEL[line.inputItem.unit] : 'kipimo';
  const current = item ? priceOf.get(item.id) : undefined;

  // Chama kisicho na bidhaa bado: fomu inaanza na bidhaa mpya
  useEffect(() => { if (items.data && !initialItem && !itemId && !items.data.data.some((i) => i.isActive)) setItemId(NEW); }, [items.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bei ya sasa inajazwa yenyewe (Stokipa anaweza kupendekeza mpya)
  useEffect(() => { setPrice(current ? String(Number(current)) : ''); }, [current]);
  useEffect(() => { if (line) { setQty(String(Number(line.quantity) - Number(line.receivedQty))); setCost(String(Number(line.unitCost))); } }, [line?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (openLines.length === 1 && !lineId) setLineId(openLines[0].id); }, [openLines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = (mode === 'purchase' ? !!line : isNew ? nItem.name.trim().length >= 2 : !!item) && Number(qty) > 0 && Number(price) > 0 && reference.trim().length >= 2;
  const save = async () => {
    const r = await run(() => api<{ approval: { requestNo: string } }>('/inputs/stock/receipts', { method: 'POST', body: {
      ...(mode === 'purchase' ? { purchaseLineId: lineId } : isNew ? { newItem: { name: nItem.name.trim(), category: nItem.category, unit: nItem.unit, reorderLevel: nItem.reorderLevel || null } } : { inputItemId: itemId }),
      quantity: qty, unitPrice: price, unitCost: mode === 'purchase' ? null : cost || null, source: mode === 'purchase' ? null : source || null,
      reference, batchNo: batchNo || null, expiryDate: expiry || null, notes: notes || undefined,
    } }));
    if (r) onDone(r.approval.requestNo);
  };

  return (
    <Modal open title="Ingiza pembejeo stoo" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!ready} onClick={save}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Mzigo unaingia stoo baada ya Meneja kuidhinisha <strong>idadi</strong> na <strong>bei ya kumkopesha mkulima</strong>. Ndipo pembejeo zinaweza kutolewa kwa wakulima.</Alert>
      <Alert>{error}</Alert>
      {!initialPr && (
        <div className="range-filter"><div className="seg" role="group" aria-label="Chanzo cha mzigo">
          <button type="button" className={mode === 'normal' ? 'on' : ''} aria-pressed={mode === 'normal'} onClick={() => setMode('normal')}>Mzigo wa kawaida (Chama Kikuu, mzabuni…)</button>
          <button type="button" className={mode === 'purchase' ? 'on' : ''} aria-pressed={mode === 'purchase'} onClick={() => setMode('purchase')}>Mzigo wa ombi la manunuzi</button>
        </div></div>
      )}
      {mode === 'purchase' ? (
        <div className="form-grid">
          {!initialPr && <SelectField label="Ombi la manunuzi lililoidhinishwa *" value={prId} onChange={(v) => { setPrId(v); setLineId(''); }} placeholder={openPrs.length ? 'Chagua…' : 'Hakuna ombi lililoidhinishwa'}
            options={openPrs.map((p) => ({ value: p.id, label: `${p.prNo}${p.supplierName ?? p.supplier ? ` · ${p.supplierName ?? p.supplier}` : ''}` }))} />}
          {prId && <SelectField label="Bidhaa ya ombi *" value={lineId} onChange={setLineId} placeholder="Chagua…"
            options={openLines.map((l) => ({ value: l.id, label: `${l.inputItem.name} — imebaki ${num(Number(l.quantity) - Number(l.receivedQty))} ${UNIT_LABEL[l.inputItem.unit].toLowerCase()} (gharama ${tsh(l.unitCost)})` }))} />}
        </div>
      ) : (
        <>
          <SelectField label="Bidhaa *" value={itemId} onChange={setItemId} placeholder="Chagua bidhaa…"
            options={[...active.map((i) => ({ value: i.id, label: `${i.name} (${UNIT_LABEL[i.unit]})` })), { value: NEW, label: '+ Bidhaa mpya (haijasajiliwa)' }]} />
          {isNew && (
            <div className="form-grid">
              <TextField label="Jina la bidhaa mpya *" value={nItem.name} onChange={(v) => setNItem({ ...nItem, name: v })} placeholder="mf. NPK 10:18:24 (50kg)" />
              <SelectField label="Aina" value={nItem.category} onChange={(v) => setNItem({ ...nItem, category: v })} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
              <SelectField label="Kipimo" value={nItem.unit} onChange={(v) => setNItem({ ...nItem, unit: v })} options={Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }))} />
              <TextField label="Kiwango cha chini (onyo)" type="number" min="0" value={nItem.reorderLevel} onChange={(v) => setNItem({ ...nItem, reorderLevel: v })} />
            </div>
          )}
        </>
      )}
      <div className="form-grid">
        <TextField label={`Idadi (${unit.toLowerCase()}) *`} type="number" min="0" step="0.01" value={qty} onChange={setQty} />
        <TextField label={`Bei kwa mkulima, kwa ${unit.toLowerCase()} (TSh) *`} type="number" min="1" value={price} onChange={setPrice} help={current ? `Bei ya sasa: ${tsh(current)}` : 'Bei mpya — Meneja ataiidhinisha'} />
        {mode === 'normal' && <TextField label={`Gharama ya chama kwa ${unit.toLowerCase()} (hiari)`} type="number" min="0" value={cost} onChange={setCost} />}
        {mode === 'normal' && <TextField label="Umetoka wapi" value={source} onChange={setSource} placeholder="mf. Chama Kikuu" />}
        <TextField label="Namba ya hati ya mzigo (delivery note) *" value={reference} onChange={setReference} />
        <TextField label="Namba ya batch" value={batchNo} onChange={setBatchNo} />
        <TextField label="Tarehe ya kuisha muda" type="date" value={expiry} onChange={setExpiry} />
      </div>
      <TextField label="Maelezo" value={notes} onChange={setNotes} />
      {Number(qty) * Number(price) > 0 && <p style={{ margin: 0 }}>Thamani kwa bei ya mkulima: <strong>{tsh(Number(qty) * Number(price))}</strong>{mode === 'purchase' && line ? ` · gharama ya manunuzi ${tsh(Number(qty) * Number(line.unitCost))}` : ''}</p>}
    </Modal>
  );
}
