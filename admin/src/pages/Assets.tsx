// =====================================================================
//  MALI ZA CHAMA (Mhasibu): rejista, uchakavu wa kila mwezi, kuondoa mali kwa idhini
// =====================================================================
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, num, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { DocHead, PrintButton, thisMonth, today } from './acc-common';

interface Asset {
  id: string; assetNo: string; name: string; category: string; categoryLabel: string; acquisitionDate: string; cost: string; residualValue: string; usefulLifeMonths: number;
  location: string | null; serialNo: string | null; status: string; fundingTxnNo: string | null; accumulated: string; netBookValue: string; monthly: string; disposedAt: string | null;
}

export function Assets() {
  const { may } = useAuth();
  const [tab, setTab] = useState<'register' | 'depreciation'>('register');
  const list = useFetch<{ data: Asset[]; totals: { cost: string; accumulated: string; netBookValue: string } }>('/assets');
  const [add, setAdd] = useState(false);
  const [dispose, setDispose] = useState<Asset | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const manage = may('accounting.manage');
  return (
    <>
      <PageHead title="Mali za chama" sub="Rejista ya mali (maghala, mizani, magari, kompyuta…), uchakavu wa kila mwezi na kuondoa mali kwa idhini ya Meneja.">
        {manage && <Button onClick={() => setAdd(true)}>+ Sajili mali</Button>}
        <PrintButton />
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      {list.data && (
        <div className="grid grid-kpi no-print">
          <Kpi label="Gharama ya mali zilizopo" value={tsh(list.data.totals.cost)} />
          <Kpi label="Uchakavu uliolimbikizwa" value={tsh(list.data.totals.accumulated)} />
          <Kpi tone="dark" label="Thamani halisi (NBV)" value={tsh(list.data.totals.netBookValue)} />
        </div>
      )}
      <div className="no-print"><Tabs value={tab} onChange={setTab} items={[['register', 'Rejista ya mali'], ['depreciation', 'Uchakavu wa kila mwezi']]} /></div>
      {tab === 'register' ? (
        <section className="card card-pad print-doc">
          <DocHead title="REJISTA YA MALI ZA CHAMA" sub={`Hadi ${date(today())}`} />
          {!list.data ? <Loading /> : list.data.data.length === 0 ? <Empty>Bado hakuna mali iliyosajiliwa.</Empty> : (
            <div className="table-wrap"><table className="table fin-table">
              <thead><tr><th>Mali</th><th>Aina</th><th>Tarehe</th><th className="num">Gharama</th><th className="num">Uchakavu/mwezi</th><th className="num">Uchakavu jumla</th><th className="num">NBV</th><th className="no-print" /></tr></thead>
              <tbody>{list.data.data.map((a) => (
                <tr key={a.id} style={{ opacity: a.status === 'DISPOSED' ? 0.55 : 1 }}>
                  <td><strong>{a.name}</strong><div className="muted" style={{ fontSize: 12 }}>{a.assetNo}{a.location ? ` · ${a.location}` : ''}{a.serialNo ? ` · ${a.serialNo}` : ''}{a.fundingTxnNo ? ` · ${a.fundingTxnNo}` : ''}</div>
                    {a.status !== 'ACTIVE' && <Badge status={a.status} />}</td>
                  <td>{a.categoryLabel}<div className="muted" style={{ fontSize: 12 }}>{a.usefulLifeMonths ? `Miaka ${num(a.usefulLifeMonths / 12)}` : 'Haichakai'}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{date(a.acquisitionDate)}</td>
                  <td className="num">{tsh(a.cost)}</td><td className="num">{Number(a.monthly) ? tsh(a.monthly) : '—'}</td>
                  <td className="num">{tsh(a.accumulated)}</td><td className="num"><strong>{tsh(a.netBookValue)}</strong></td>
                  <td className="num no-print">{manage && a.status === 'ACTIVE' && <Button size="sm" variant="ghost" onClick={() => setDispose(a)}>Ondoa</Button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      ) : <Depreciation manage={manage} onDone={(m) => { setOk(m); list.reload(); }} />}
      {add && <AssetForm onClose={() => setAdd(false)} onDone={(m) => { setAdd(false); setOk(m); list.reload(); }} />}
      {dispose && <DisposeForm asset={dispose} onClose={() => setDispose(null)} onDone={(m) => { setDispose(null); setOk(m); list.reload(); }} />}
    </>
  );
}

function AssetForm({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const cats = useFetch<Record<string, string>>('/assets/categories');
  const txns = useFetch<{ data: { id: string; txnNo: string; amount: string; description: string; kind: string; status: string }[] }>('/finance/transactions', { kind: 'EXPENSE', status: 'POSTED', pageSize: 100 });
  const [f, setF] = useState({ name: '', category: 'EQUIPMENT', acquisitionDate: today(), cost: '', residualValue: '0', years: '5', location: '', serialNo: '', fundingTxnId: '' });
  const { busy, error, run } = useAction();
  const s = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const life = Math.round(Number(f.years) * 12);
  return (
    <Modal open title="Sajili mali ya chama" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={f.name.trim().length < 2 || !(Number(f.cost) > 0)} onClick={async () => {
        const r = await run(() => api<{ asset: { assetNo: string } }>('/assets', { method: 'POST', body: {
          name: f.name, category: f.category, acquisitionDate: f.acquisitionDate, cost: f.cost, residualValue: f.residualValue || '0', usefulLifeMonths: f.category === 'LAND' ? 0 : life,
          location: f.location || null, serialNo: f.serialNo || null, fundingTxnId: f.fundingTxnId || null,
        } }));
        if (r) onDone(`${r.asset.assetNo} imesajiliwa`);
      }}>Sajili</Button></>}>
      <Alert kind="warn">Mali mpya inayonunuliwa sasa: kwanza andaa matumizi ukichagua akaunti <strong>1500 Mali za kudumu</strong>, kisha iunganishe hapa. Mali iliyokuwepo kabla ya mfumo: acha "muamala" wazi — itaingia kama salio la kuanzia.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina la mali *" value={f.name} onChange={s('name')} placeholder="mf. Mizani ya kidijitali" />
        <SelectField label="Aina *" value={f.category} onChange={s('category')} options={Object.entries(cats.data ?? {}).map(([value, label]) => ({ value, label }))} />
        <TextField label="Tarehe ya kununua *" type="date" max={today()} value={f.acquisitionDate} onChange={s('acquisitionDate')} />
        <TextField label="Gharama (TSh) *" type="number" min="1" value={f.cost} onChange={s('cost')} />
        {f.category !== 'LAND' && <TextField label="Muda wa matumizi (miaka)" type="number" min="0.5" step="0.5" value={f.years} onChange={s('years')} help={Number(f.cost) > 0 && life > 0 ? `Uchakavu ≈ ${tsh((Number(f.cost) - Number(f.residualValue || 0)) / life)} kwa mwezi` : undefined} />}
        <TextField label="Thamani ya mwisho (TSh)" type="number" min="0" value={f.residualValue} onChange={s('residualValue')} />
        <TextField label="Mahali" value={f.location} onChange={s('location')} />
        <TextField label="Namba ya utambulisho (serial/plate)" value={f.serialNo} onChange={s('serialNo')} />
      </div>
      <SelectField label="Muamala uliolipia (hiari)" value={f.fundingTxnId} onChange={s('fundingTxnId')} placeholder="Mali iliyokuwepo (salio la kuanzia)"
        options={txns.data?.data.map((t) => ({ value: t.id, label: `${t.txnNo} · ${tsh(t.amount)} · ${t.description}` })) ?? []} />
    </Modal>
  );
}

function DisposeForm({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (m: string) => void }) {
  const [d, setD] = useState(today());
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Ondoa ${asset.assetNo}: ${asset.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={async () => {
        const r = await run(() => api<{ approval: { requestNo: string } }>(`/assets/item/${asset.id}/dispose`, { method: 'POST', body: { date: d, reason } }));
        if (r) onDone(`Ombi la kuondoa ${asset.assetNo} limetumwa kwa Meneja (${r.approval.requestNo})`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Thamani iliyobaki ({tsh(asset.netBookValue)}) itaandikwa kama hasara baada ya idhini. Kama mali imeuzwa, rekodi fedha zilizopokelewa kwenye Mapato → "Mauzo ya mali za chama".</Alert>
      <Alert>{error}</Alert>
      <TextField label="Tarehe *" type="date" max={today()} value={d} onChange={setD} />
      <TextField label="Sababu *" value={reason} onChange={setReason} placeholder="mf. Imeuzwa kwa mnada / imeharibika kabisa" />
    </Modal>
  );
}

function Depreciation({ manage, onDone }: { manage: boolean; onDone: (m: string) => void }) {
  const runs = useFetch<{ data: { id: string; period: string; total: string; assets: number; createdAt: string }[] }>('/assets/depreciation');
  const [period, setPeriod] = useState(thisMonth());
  const pv = useFetch<{ alreadyRun: boolean; total: string; lines: { assetId: string; assetNo: string; name: string; amount: string }[] }>('/assets/depreciation/preview', { period });
  const { busy, error, run } = useAction();
  return (
    <div className="grid grid-2">
      <Section title="Endesha uchakavu wa mwezi">
        <TextField label="Mwezi" type="month" max={thisMonth()} value={period} onChange={setPeriod} />
        <Alert>{error}</Alert>
        {!pv.data ? <Loading /> : pv.data.alreadyRun ? <Alert kind="ok">Uchakavu wa mwezi huu umeshaandikwa.</Alert> : pv.data.lines.length === 0 ? <Empty>Hakuna uchakavu wa mwezi huu.</Empty> : (
          <>
            <div className="table-wrap"><table className="table fin-table"><tbody>
              {pv.data.lines.map((l) => <tr key={l.assetId}><td>{l.assetNo} · {l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
              <tr className="row-total"><td>Jumla (Dr 5900 / Cr 1590)</td><td className="num">{tsh(pv.data.total)}</td></tr>
            </tbody></table></div>
            {manage && <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button busy={busy} onClick={async () => {
              if (await run(() => api('/assets/depreciation', { method: 'POST', body: { period } }))) { onDone(`Uchakavu wa ${period} umeandikwa`); pv.reload(); runs.reload(); }
            }}>Andika uchakavu</Button></div>}
          </>
        )}
      </Section>
      <Section pad={false} title="Historia">
        {!runs.data?.data.length ? <Empty>Bado hakuna.</Empty> : (
          <div className="table-wrap"><table className="table"><tbody>{runs.data.data.map((r) => (
            <tr key={r.id}><td><strong>{r.period}</strong><div className="muted" style={{ fontSize: 12 }}>mali {r.assets} · {dateTime(r.createdAt)}</div></td><td className="num">{tsh(r.total)}</td></tr>
          ))}</tbody></table></div>
        )}
      </Section>
    </div>
  );
}
