// =====================================================================
//  MIKOPO YA WAKULIMA — (1) mkopo wa kuni  (2) mkopo wa grading  (3) mkopo wa miti — kwa DOLA
//   Kila mkopo: mipangilio yake ya msimu · Andaa orodha (kikomo kwa ekari) · Meneja anaidhinisha
//   · Pesa zinatumwa (TSh kwa kiwango cha siku ya kuandaa) · Mhasibu anathibitisha waliolipwa
//   Mkopo wa miti: miti kwa hekta (au ekari) x gharama ya mti mmoja + riba
//   Madeni: deni la dola la kila mkulima (pembejeo + mikopo yote) na jumla ya kila kikundi
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiDownload } from '../lib/api';
import { useAction, useFetch, useDebounced } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, num, phone, tsh } from '../lib/format';
import { usd } from '../lib/fx';
import { useT } from '../lib/prefs';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { DocHead, PrintButton, Signatures } from './acc-common';

type LoanType = 'KUNI' | 'GRADING' | 'TREES';
type Basis = 'ACRE' | 'TRIP' | 'ESTIMATE';
interface Settings { loanType: LoanType; interestRate: string; amountPerAcreUsd: string | null; limitBasis?: Basis; pricePerTripUsd?: string | null; areaUnit?: 'HECTARE' | 'ACRE'; treesPerArea?: number | null; costPerTreeUsd?: string | null; isOpen: boolean; configured?: boolean }
const isSet = (s: Settings) => (s.loanType === 'TREES' ? Number(s.treesPerArea ?? 0) > 0 && Number(s.costPerTreeUsd ?? 0) > 0
  : s.limitBasis === 'TRIP' ? Number(s.pricePerTripUsd ?? 0) > 0 : s.limitBasis === 'ESTIMATE' ? s.configured !== false : Number(s.amountPerAcreUsd ?? 0) > 0);
const AREA: Record<string, string> = { HECTARE: 'hekta', ACRE: 'ekari' };
const trees = (n: number | string | null | undefined) => `miti ${Number(n ?? 0).toLocaleString('en-US')}`;
interface SettingsRes { season: { name: string }; types: Record<LoanType, Settings>; labels: Record<LoanType, string>; rate: { usdToTzs: string; createdAt: string } | null }
interface Eligible { memberId: string; memberNo: string; name: string; village: string | null; group: string | null; acres: string; treeAcres?: string; kuniTrips?: string; gradingUsd?: string; basis?: string; hectares?: string; limitTrees?: number; takenTrees?: number; availableTrees?: number; estimatedKg: string; limit: string; taken: string; available: string; debt: string; debtUsd: string; method: string; destination: string }
const METHOD: Record<string, string> = { MOBILE_MONEY: 'Simu', BANK: 'Benki', CASH: 'Taslimu' };
const B_STATUS: Record<string, string> = { DRAFT: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — tuma pesa', PROCESSING: 'Inalipwa', PARTIAL: 'Sehemu', COMPLETED: 'Imekamilika', CANCELLED: 'Imefutwa' };
export const LOAN: Record<LoanType, { label: string; short: string; about: string }> = {
  KUNI: { label: 'Mkopo wa kuni', short: 'Kuni', about: 'Pesa ya kuandaa kuni za kukaushia (kuchoma) tumbaku. Kikomo kinaweza kutoka trip za kuni kwenye makisio.' },
  GRADING: { label: 'Mkopo wa grading', short: 'Grading', about: 'Hutolewa baada ya kuchoma tumbaku: kupanga madaraja (grading) na kufunga mabelo.' },
  TREES: { label: 'Mkopo wa miti', short: 'Miti', about: 'Pesa ya kupanda miti shambani: kila hekta (au ekari) ina idadi ya miti iliyowekwa na chama, kwa gharama ya kila mti pamoja na riba. Eneo linatoka "ekari za miti" kwenye makisio.' },
};
type Tab = LoanType | 'debts';

export function Kuni() {
  const { may } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = (['KUNI', 'GRADING', 'TREES', 'debts'].includes(sp.get('tab') ?? '') ? sp.get('tab') : 'KUNI') as Tab;
  const setTab = (t: Tab) => setSp({ tab: t }, { replace: true });
  const st = useFetch<SettingsRes>('/kuni/settings');
  const [ok, setOk] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Mikopo" sub={<>Mikopo ya wakulima kwa dola: kuni, grading na miti{st.data ? <> · Msimu <strong>{st.data.season.name}</strong></> : null}. Deni (mkopo + riba) linajumlishwa na deni la pembejeo na kukatwa sokoni kwa kiwango cha siku ya soko.</>} />
      <Alert kind="ok">{ok}</Alert>
      <Tabs value={tab} onChange={(t) => { setOk(null); setTab(t); }} items={[['KUNI', 'Mkopo wa kuni'], ['GRADING', 'Mkopo wa grading'], ['TREES', 'Mkopo wa miti'], ['debts', 'Madeni: wakulima na vikundi']]} />
      <div style={{ marginTop: 16 }}>
        {tab === 'debts' ? <Debts /> : !st.data ? <Loading /> : (
          <LoanPanel key={tab} type={tab} s={st.data.types[tab]} rate={st.data.rate} canEdit={may('finance.record')} manageFx={may('finance.accounts')}
            onSaved={(m) => { st.reload(); setOk(m); }} onDone={setOk} />
        )}
      </div>
    </>
  );
}

function LoanPanel({ type, s, rate, canEdit, manageFx, onSaved, onDone }: { type: LoanType; s: Settings; rate: SettingsRes['rate']; canEdit: boolean; manageFx: boolean; onSaved: (m: string) => void; onDone: (m: string) => void }) {
  const [sub, setSub] = useState<'prepare' | 'batches'>('prepare');
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{LOAN[type].about}</p>
      {!rate && <Alert kind="warn">Kiwango cha dola hakijawekwa. Mikopo inatolewa kwa dola, hivyo Mhasibu aweke kiwango kwanza{manageFx ? <> — <Link to="/finance?tab=fx">Fedha → Dola (USD)</Link></> : ' (Fedha → Dola)'}.</Alert>}
      <SettingsCard type={type} s={s} rate={rate} canEdit={canEdit} onSaved={() => onSaved(`Mipangilio ya ${LOAN[type].label.toLowerCase()} imehifadhiwa`)} />
      <Tabs value={sub} onChange={setSub} items={[['prepare', 'Andaa orodha'], ['batches', 'Orodha zilizoandaliwa']]} />
      {sub === 'prepare'
        ? <Prepare type={type} settings={s} rate={rate ? Number(rate.usdToTzs) : null} onDone={(m) => { onDone(m); setSub('batches'); }} />
        : <Batches type={type} />}
    </div>
  );
}

function SettingsCard({ type, s, rate, canEdit, onSaved }: { type: LoanType; s: Settings; rate: SettingsRes['rate']; canEdit: boolean; onSaved: () => void }) {
  const t = useT();
  const fresh = s.configured === false || !isSet(s);
  const isTrees = type === 'TREES';
  const [edit, setEdit] = useState(fresh && canEdit);
  const [f, setF] = useState({ interestRate: String(Number(s.interestRate)), amountPerAcreUsd: s.amountPerAcreUsd ? String(Number(s.amountPerAcreUsd)) : '', isOpen: s.isOpen || fresh,
    limitBasis: (s.limitBasis ?? 'ACRE') as Basis, pricePerTripUsd: s.pricePerTripUsd ? String(Number(s.pricePerTripUsd)) : '',
    areaUnit: s.areaUnit ?? 'HECTARE', treesPerArea: s.treesPerArea ? String(s.treesPerArea) : '', costPerTreeUsd: s.costPerTreeUsd ? String(Number(s.costPerTreeUsd)) : '' });
  const { busy, error, run } = useAction();
  const r = rate ? Number(rate.usdToTzs) : null;
  const unit = AREA[s.areaUnit ?? 'HECTARE'];
  if (!edit && isTrees) return (
    <div className="grid grid-kpi">
      <Kpi tone="dark" label={`Miti kwa ${unit}`} value={s.treesPerArea ? Number(s.treesPerArea).toLocaleString('en-US') : '—'} hint={s.treesPerArea && s.costPerTreeUsd ? `= ${usd(Number(s.treesPerArea) * Number(s.costPerTreeUsd))} kwa ${unit} · eneo kutoka makisio` : 'Eneo kutoka makisio yaliyoidhinishwa'} />
      <Kpi tone="gold" label="Gharama ya mti mmoja" value={s.costPerTreeUsd ? usd(s.costPerTreeUsd, 2) : '—'} hint={r && s.costPerTreeUsd ? `≈ ${tsh(Number(s.costPerTreeUsd) * r)} · 1 USD = TSh ${num(r)}` : undefined} />
      <Kpi label="Riba kwa msimu" value={`${num(s.interestRate)}%`} hint="Inaongezwa pesa zikitumwa" />
      <Kpi tone={s.isOpen ? undefined : 'warn'} label="Hali" value={s.isOpen ? t('Wazi') : t('Imefungwa')} hint={canEdit ? <button type="button" className="link-btn" onClick={() => setEdit(true)}>{t('Badilisha mipangilio →')}</button> : 'Inawekwa na Mhasibu'} />
    </div>
  );
  const basis = s.limitBasis ?? 'ACRE';
  if (!edit && basis !== 'ACRE') return (
    <div className="grid grid-kpi">
      {basis === 'TRIP'
        ? <Kpi tone="dark" label="Bei ya trip moja ya kuni" value={s.pricePerTripUsd ? usd(s.pricePerTripUsd) : '—'} hint={`Kikomo = trip za kuni kwenye makisio × bei hii${r && s.pricePerTripUsd ? ` · ≈ ${tsh(Number(s.pricePerTripUsd) * r)}` : ''}`} />
        : <Kpi tone="dark" label="Kikomo" value={t('Makisio ya grading')} hint="Kiasi cha grading (USD) kwenye makisio ya mkulima" />}
      <Kpi label="Riba kwa msimu" value={`${num(s.interestRate)}%`} hint="Inaongezwa pesa zikitumwa" />
      <Kpi tone="gold" label="Kiwango cha dola" value={r ? `TSh ${num(r)}` : '—'} hint={rate ? `Kwa USD 1 · ${dateTime(rate.createdAt)}` : 'Bado hakijawekwa'} />
      <Kpi tone={s.isOpen ? undefined : 'warn'} label="Hali" value={s.isOpen ? t('Wazi') : t('Imefungwa')} hint={canEdit ? <button type="button" className="link-btn" onClick={() => setEdit(true)}>{t('Badilisha mipangilio →')}</button> : 'Inawekwa na Mhasibu'} />
    </div>
  );
  if (!edit) return (
    <div className="grid grid-kpi">
      <Kpi tone="dark" label="Kikomo kwa ekari" value={s.amountPerAcreUsd ? usd(s.amountPerAcreUsd) : '—'} hint={r && s.amountPerAcreUsd ? `≈ ${tsh(Number(s.amountPerAcreUsd) * r)} · ekari za makisio yaliyoidhinishwa` : 'Ekari za makisio yaliyoidhinishwa'} />
      <Kpi label="Riba kwa msimu" value={`${num(s.interestRate)}%`} hint="Inaongezwa pesa zikitumwa" />
      <Kpi tone="gold" label="Kiwango cha dola" value={r ? `TSh ${num(r)}` : '—'} hint={rate ? `Kwa USD 1 · ${dateTime(rate.createdAt)}` : 'Bado hakijawekwa'} />
      <Kpi tone={s.isOpen ? undefined : 'warn'} label="Hali" value={s.isOpen ? t('Wazi') : t('Imefungwa')} hint={canEdit ? <button type="button" className="link-btn" onClick={() => setEdit(true)}>{t('Badilisha mipangilio →')}</button> : 'Inawekwa na Mhasibu'} />
    </div>
  );
  return (
    <Section title={`Mipangilio ya ${LOAN[type].label.toLowerCase()} (msimu huu)`}>
      <Alert>{error}</Alert>
      {isTrees ? <div className="form-grid">
        <SelectField label="Kipimo cha eneo *" value={f.areaUnit} onChange={(v) => setF({ ...f, areaUnit: v as 'HECTARE' | 'ACRE' })} options={[{ value: 'HECTARE', label: 'Hekta (ekari 2.47)' }, { value: 'ACRE', label: 'Ekari' }]}
          help="Makisio yanaandikwa kwa ekari; mfumo unabadilisha kuwa hekta wenyewe" />
        <TextField label={`Idadi ya miti kwa ${AREA[f.areaUnit]} moja *`} type="number" min="1" step="1" value={f.treesPerArea} onChange={(v) => setF({ ...f, treesPerArea: v })}
          help={`Mf. 400 — mkulima mwenye ${AREA[f.areaUnit]} 2 anastahili miti 800`} />
        <TextField label="Gharama ya mti mmoja (USD) *" type="number" min="0" step="0.01" value={f.costPerTreeUsd} onChange={(v) => setF({ ...f, costPerTreeUsd: v })}
          help={Number(f.costPerTreeUsd) > 0 && Number(f.treesPerArea) > 0 ? `${AREA[f.areaUnit]} moja = ${usd(Number(f.costPerTreeUsd) * Number(f.treesPerArea))}${r ? ` (≈ ${tsh(Number(f.costPerTreeUsd) * Number(f.treesPerArea) * r)})` : ''}` : 'Mf. 0.25 — miti 800 = $200'} />
        <TextField label="Riba kwa msimu (%) *" type="number" min="0" step="0.1" value={f.interestRate} onChange={(v) => setF({ ...f, interestRate: v })} help="Mf. 10% — mkopo wa $200 unakuwa deni la $220" />
      </div> : <div className="form-grid">
        <SelectField label="Kikomo kinatoka wapi *" value={f.limitBasis} onChange={(v) => setF({ ...f, limitBasis: v as Basis })}
          options={type === 'KUNI' ? [{ value: 'TRIP', label: 'Trip za kuni kwenye makisio × bei ya trip' }, { value: 'ACRE', label: 'Ekari za tumbaku × dola kwa ekari' }]
            : [{ value: 'ESTIMATE', label: 'Kiasi cha grading kwenye makisio' }, { value: 'ACRE', label: 'Ekari za tumbaku × dola kwa ekari' }]} />
        {f.limitBasis === 'TRIP' && <TextField label="Bei ya trip moja (USD) *" type="number" min="0" step="0.01" value={f.pricePerTripUsd} onChange={(v) => setF({ ...f, pricePerTripUsd: v })}
          help={r && Number(f.pricePerTripUsd) > 0 ? `≈ ${tsh(Number(f.pricePerTripUsd) * r)} leo. Mkulima wa trip 3 = 3 × kiasi hiki` : 'Mkulima wa trip 3 kwenye makisio, kikomo = 3 × kiasi hiki'} />}
        {f.limitBasis === 'ACRE' && <TextField label="Kikomo kwa ekari (USD) *" type="number" min="0" step="0.01" value={f.amountPerAcreUsd} onChange={(v) => setF({ ...f, amountPerAcreUsd: v })}
          help={r && Number(f.amountPerAcreUsd) > 0 ? `≈ ${tsh(Number(f.amountPerAcreUsd) * r)} kwa ekari leo. Mkulima mwenye ekari 2, kikomo = 2 × kiasi hiki` : 'Mkulima mwenye ekari 2 za makisio, kikomo = 2 × kiasi hiki'} />}
        <TextField label="Riba kwa msimu (%) *" type="number" min="0" step="0.1" value={f.interestRate} onChange={(v) => setF({ ...f, interestRate: v })} help="Mf. 10% — mkopo wa $100 unakuwa deni la $110" />
      </div>}
      <label className="check"><input type="checkbox" checked={f.isOpen} onChange={(e) => setF({ ...f, isOpen: e.target.checked })} /> {t(`${LOAN[type].label} uko wazi (unaweza kutolewa)`)}</label>
      <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        {!fresh && <Button variant="secondary" onClick={() => setEdit(false)}>Ghairi</Button>}
        {canEdit && <Button busy={busy} disabled={isTrees ? !f.treesPerArea || !f.costPerTreeUsd : f.limitBasis === 'TRIP' ? !f.pricePerTripUsd : f.limitBasis === 'ACRE' ? !f.amountPerAcreUsd : false} onClick={async () => {
          const body = isTrees ? { loanType: type, interestRate: f.interestRate, isOpen: f.isOpen, areaUnit: f.areaUnit, treesPerArea: Number(f.treesPerArea), costPerTreeUsd: f.costPerTreeUsd }
            : { loanType: type, interestRate: f.interestRate, isOpen: f.isOpen, limitBasis: f.limitBasis,
              ...(f.limitBasis === 'ACRE' ? { amountPerAcreUsd: f.amountPerAcreUsd } : {}), ...(f.limitBasis === 'TRIP' ? { pricePerTripUsd: f.pricePerTripUsd } : {}) };
          if (await run(() => api('/kuni/settings', { method: 'PUT', body }))) { setEdit(false); onSaved(); }
        }}>Hifadhi</Button>}
      </div>
    </Section>
  );
}

function Prepare({ type, settings, rate, onDone }: { type: LoanType; settings: Settings; rate: number | null; onDone: (m: string) => void }) {
  const { may } = useAuth();
  const t = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const open = settings.isOpen && isSet(settings);
  const isTrees = type === 'TREES';
  const cost = Number(settings.costPerTreeUsd ?? 0);
  const el = useFetch<{ data: Eligible[] }>(open ? '/kuni/eligible' : null, { type, search: dq || undefined });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const pct = Number(settings.interestRate ?? 0);
  const rows = el.data?.data ?? [];
  // Miti: kinachoandikwa ni idadi ya miti; dola = miti x gharama ya mti
  useEffect(() => { setAmounts((a) => ({ ...Object.fromEntries(rows.map((r) => [r.memberId, String(isTrees ? r.availableTrees ?? 0 : Number(r.available))])), ...a })); }, [el.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const usdOf = (id: string) => (isTrees ? Math.round(Number(amounts[id] || 0) * cost * 100) / 100 : Number(amounts[id] || 0));
  const chosen = rows.filter((r) => picked.has(r.memberId) && Number(amounts[r.memberId]) > 0);
  const total = useMemo(() => chosen.reduce((s, r) => s + usdOf(r.memberId), 0), [chosen, amounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalTrees = isTrees ? chosen.reduce((s, r) => s + Number(amounts[r.memberId] || 0), 0) : 0;
  const toggle = (id: string) => { const n = new Set(picked); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  if (!open) return <Alert kind="warn">{t(`${LOAN[type].label} haujafunguliwa msimu huu.`)} {t(isTrees ? 'Weka idadi ya miti kwa hekta, gharama ya mti na riba kwenye mipangilio juu, kisha weka "uko wazi".' : 'Weka kikomo na riba kwenye mipangilio juu, kisha weka "uko wazi".')}</Alert>;
  const tz = (v: number) => (rate ? tsh(v * rate) : '—');
  return (
    <section className="card">
      <div className="toolbar">
        <input className="input" placeholder="Tafuta mkulima…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta mkulima" />
        <div className="grow" />
        <span className="muted">Wakulima wenye makisio yaliyoidhinishwa tu</span>
      </div>
      {!el.data ? <Loading /> : rows.length === 0 ? <Empty>Hakuna mkulima mwenye makisio yaliyoidhinishwa msimu huu. Makisio yanaingizwa na Storekeeper na kuidhinishwa na Meneja.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th style={{ width: 36 }}><input type="checkbox" aria-label="Chagua wote" onChange={(e) => setPicked(e.target.checked ? new Set(rows.filter((r) => Number(r.available) > 0).map((r) => r.memberId)) : new Set())} /></th>
            <th>Mkulima</th><th className="num">{isTrees ? (settings.areaUnit !== 'ACRE' ? 'Hekta za miti' : 'Ekari za miti') : settings.limitBasis === 'TRIP' ? 'Trip za kuni' : settings.limitBasis === 'ESTIMATE' ? 'Grading (makisio)' : 'Ekari'}</th><th className="num">Kikomo</th><th className="num">Amekopa</th><th className="num">Deni la dola sasa</th><th>{isTrees ? 'Miti ya kutoa' : 'Kiasi cha kutoa (USD)'}</th><th>Atalipwa kupitia</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.memberId} className={picked.has(r.memberId) ? 'row-picked' : ''} style={{ opacity: Number(r.available) > 0 ? 1 : 0.55 }}>
              <td>{Number(r.available) > 0 && <input type="checkbox" aria-label={`Chagua ${r.name}`} checked={picked.has(r.memberId)} onChange={() => toggle(r.memberId)} />}</td>
              <td><strong>{r.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.memberNo}{r.group ? ` · ${r.group}` : ''}</div></td>
              {isTrees ? <>
                <td className="num">{settings.areaUnit === 'ACRE' ? num(r.treeAcres) : num(r.hectares)}{settings.areaUnit !== 'ACRE' && <div className="muted" style={{ fontSize: 11 }}>ekari {num(r.treeAcres)}</div>}</td>
                <td className="num">{trees(r.limitTrees)}<div className="muted" style={{ fontSize: 11 }}>{usd(r.limit)}</div></td>
                <td className="num">{r.takenTrees ? <>{trees(r.takenTrees)}<div className="muted" style={{ fontSize: 11 }}>{usd(r.taken)}</div></> : '—'}</td>
              </> : <><td className="num">{settings.limitBasis === 'TRIP' ? num(r.kuniTrips) : settings.limitBasis === 'ESTIMATE' ? usd(r.gradingUsd) : num(r.acres)}</td><td className="num">{usd(r.limit)}</td><td className="num">{Number(r.taken) ? usd(r.taken) : '—'}</td></>}
              <td className="num">{Number(r.debtUsd) ? usd(r.debtUsd) : '—'}{Number(r.debt) > 0 && <div className="muted" style={{ fontSize: 11 }}>{t('vitabu')}: {tsh(r.debt)}</div>}</td>
              <td>{Number(r.available) > 0 ? <>
                <input className="input" style={{ maxWidth: 130 }} type="number" min={isTrees ? 1 : 0.01} step={isTrees ? 1 : 0.01} max={isTrees ? r.availableTrees : Number(r.available)} value={amounts[r.memberId] ?? ''} aria-label={`${isTrees ? 'Miti' : 'Kiasi'} ${r.name}`}
                  onChange={(e) => { setAmounts({ ...amounts, [r.memberId]: e.target.value }); if (!picked.has(r.memberId)) toggle(r.memberId); }} />
                {Number(amounts[r.memberId]) > 0 && <div className="muted" style={{ fontSize: 11 }}>{isTrees ? `= ${usd(usdOf(r.memberId))}${rate ? ` ≈ ${tz(usdOf(r.memberId))}` : ''}` : rate ? `≈ ${tz(Number(amounts[r.memberId]))}` : ''}</div>}
              </> : <span className="muted">Kikomo kimefika</span>}</td>
              <td style={{ fontSize: 13 }}>{t(METHOD[r.method])}{r.method !== 'CASH' ? ` · ${r.method === 'MOBILE_MONEY' ? phone(r.destination) : r.destination}` : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {chosen.length > 0 && (
        <div className="card-pad stack" style={{ gap: 10 }}>
          <div className="recon-sum" style={{ margin: 0 }}>
            <div><span>{t('Wakulima')}</span><strong>{chosen.length}</strong></div>
            {isTrees && <div><span>{t('Miti')}</span><strong>{totalTrees.toLocaleString('en-US')}</strong><small className="muted">× {usd(cost, 2)}</small></div>}
            <div><span>{t(LOAN[type].label)}</span><strong>{usd(total)}</strong><small className="muted">{tz(total)}</small></div>
            <div><span>{t('Riba')} ({num(pct)}%)</span><strong>{usd(total * pct / 100)}</strong></div>
            <div><span>{t('Deni jipya (jumla)')}</span><strong>{usd(total * (1 + pct / 100))}</strong><small className="muted">{tz(total * (1 + pct / 100))}</small></div>
          </div>
          {rate && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('Pesa zitatumwa kwa TSh kwa kiwango cha leo')} (1 USD = TSh {num(rate)}). {t('Deni la mkulima linabaki kwa dola na linakatwa sokoni kwa kiwango cha siku ya soko.')}</p>}
          <TextField label="Maelezo" value={notes} onChange={setNotes} placeholder={type === 'GRADING' ? 'mf. Grading awamu ya kwanza' : isTrees ? 'mf. Miti ya msimu huu' : 'mf. Awamu ya kwanza ya pesa ya kuni'} />
          <Alert>{error}</Alert>
          {may('finance.record') && <div className="actions" style={{ justifyContent: 'flex-end' }}><Button busy={busy} disabled={!rate} onClick={async () => {
            const r = await run(() => api<{ batch: { batchNo: string }; approval: { requestNo: string } }>('/kuni/batches', { method: 'POST', body: { loanType: type, notes: notes || null, loans: chosen.map((c) => (isTrees ? { memberId: c.memberId, trees: Number(amounts[c.memberId]) } : { memberId: c.memberId, amountUsd: amounts[c.memberId] })) } }));
            if (r) { setPicked(new Set()); onDone(`Orodha ${r.batch.batchNo} imetumwa kwa Meneja (${r.approval.requestNo}). Baada ya idhini, tuma pesa na uthibitishe waliolipwa.`); }
          }}>Tuma kwa Meneja</Button></div>}
        </div>
      )}
    </section>
  );
}

interface BatchRow { id: string; batchNo: string; loanType: LoanType; totalTrees?: number | null; status: string; currency: 'TZS' | 'USD'; totalAmount: string; totalInterest: string; totalUsd: string | null; totalInterestUsd: string | null; fxRate: string | null; interestRate: string; farmers: number; paid: string; paidUsd: string; createdAt: string }
const isUsd = (b: { currency: string }) => b.currency === 'USD';
/** Kiasi: dola (na TSh chini yake) kwa orodha za dola; TSh kwa orodha za zamani */
const Money = ({ u, z, usdMode }: { u: string | null | undefined; z: string; usdMode: boolean }) =>
  usdMode ? <>{usd(u)}<div className="muted" style={{ fontSize: 11 }}>{tsh(z)}</div></> : <>{tsh(z)}</>;

function Batches({ type }: { type: LoanType }) {
  const { data } = useFetch<{ data: BatchRow[] }>('/kuni/batches', { type });
  const nav = useNavigate();
  return (
    <section className="card">
      {!data ? <Loading /> : data.data.length === 0 ? <Empty>Bado hakuna orodha.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Orodha</th><th className="num">Wakulima</th><th className="num">Mkopo</th><th className="num">Riba</th><th className="num">Imetumwa</th><th>Hali</th></tr></thead>
          <tbody>{data.data.map((b) => (
            <tr key={b.id} onClick={() => nav(`/kuni/batches/${b.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{b.batchNo}</strong><div className="muted" style={{ fontSize: 12 }}>{dateTime(b.createdAt)}{isUsd(b) && b.fxRate ? ` · 1 USD = TSh ${num(b.fxRate)}` : ' · TSh'}</div></td>
              <td className="num">{b.farmers}{b.totalTrees ? <div className="muted" style={{ fontSize: 11 }}>{trees(b.totalTrees)}</div> : null}</td>
              <td className="num"><Money u={b.totalUsd} z={b.totalAmount} usdMode={isUsd(b)} /></td>
              <td className="num"><Money u={b.totalInterestUsd} z={b.totalInterest} usdMode={isUsd(b)} /><div className="muted" style={{ fontSize: 11 }}>{num(b.interestRate)}%</div></td>
              <td className="num"><Money u={b.paidUsd} z={b.paid} usdMode={isUsd(b)} /></td>
              <td><Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} label={B_STATUS[b.status]} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

interface DebtRow { inputsUsd: string; kuniUsd: string; gradingUsd: string; treesUsd: string; repaidUsd: string; debtUsd: string; bookTzs: string; atCurrentTzs: string | null }
interface DebtsRes {
  rate: { usdToTzs: string; createdAt: string } | null;
  farmers: (DebtRow & { memberId: string; memberNo: string; name: string; village: string | null; groupId: string | null; group: string | null })[];
  groups: (DebtRow & { id: string; name: string; members: number; owing: number })[];
  totals: DebtRow & { farmers: number };
}

/** Deni la dola limejumlishwa: kila mkulima (pembejeo + kuni + grading + miti) na kila kikundi. */
function Debts() {
  const { may } = useAuth();
  const t = useT();
  const [view, setView] = useState<'farmers' | 'groups'>('farmers');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error } = useFetch<DebtsRes>('/kuni/debts', { search: dq || undefined });
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  const tt = data?.totals;
  const cols = (r: DebtRow) => <>
    <td className="num">{Number(r.inputsUsd) ? usd(r.inputsUsd) : '—'}</td>
    <td className="num">{Number(r.kuniUsd) ? usd(r.kuniUsd) : '—'}</td>
    <td className="num">{Number(r.gradingUsd) ? usd(r.gradingUsd) : '—'}</td>
    <td className="num">{Number(r.treesUsd) ? usd(r.treesUsd) : '—'}</td>
    <td className="num">{Number(r.repaidUsd) ? usd(r.repaidUsd) : '—'}</td>
    <td className="num"><strong className={Number(r.debtUsd) > 0 ? 'money-neg' : ''}>{usd(r.debtUsd)}</strong>{r.atCurrentTzs && <div className="muted" style={{ fontSize: 11 }}>≈ {tsh(r.atCurrentTzs)}</div>}</td>
    <td className="num">{Number(r.bookTzs) ? tsh(r.bookTzs) : '—'}</td>
  </>;
  const head = <><th className="num">Pembejeo</th><th className="num">Kuni</th><th className="num">Grading</th><th className="num">Miti</th><th className="num">Amelipa</th><th className="num">Deni la dola</th><th className="num">Deni (vitabu, TSh)</th></>;
  const farmerLink = (id: string) => (may('members.read') ? `/members/${id}` : `/farmer-debts/${id}`);
  return (
    <div className="stack">
      {tt && <div className="grid grid-kpi">
        <Kpi tone="bad" label="Deni la dola (jumla)" value={usd(tt.debtUsd)} hint={tt.atCurrentTzs && data?.rate ? `≈ ${tsh(tt.atCurrentTzs)} kwa 1 USD = TSh ${num(data.rate.usdToTzs)}` : 'Pembejeo + mikopo − marejesho'} />
        <Kpi tone="dark" label="Mkopo wa kuni" value={usd(tt.kuniUsd)} hint="Pamoja na riba" />
        <Kpi tone="gold" label="Mkopo wa grading" value={usd(tt.gradingUsd)} hint="Pamoja na riba" />
        <Kpi label="Mkopo wa miti" value={usd(tt.treesUsd)} hint="Pamoja na riba" />
        <Kpi label="Pembejeo (dola)" value={usd(tt.inputsUsd)} hint={`Wakulima ${num(tt.farmers)}`} />
      </div>}
      <section className="card">
        <div className="toolbar">
          <div className="seg" role="tablist">
            <button type="button" className={view === 'farmers' ? 'on' : ''} onClick={() => setView('farmers')}>{t('Kwa mkulima')}</button>
            <button type="button" className={view === 'groups' ? 'on' : ''} onClick={() => setView('groups')}>{t('Kwa kikundi')}</button>
          </div>
          <input className="input" placeholder={view === 'groups' ? 'Tafuta kikundi au mkulima…' : 'Tafuta mkulima au kikundi…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tafuta" />
          <div className="grow" />
          <span className="muted" style={{ fontSize: 13 }}>{t('Deni la dola linakatwa sokoni kwa kiwango cha siku ya soko')}</span>
        </div>
        {!data ? <Loading /> : view === 'farmers' ? (
          data.farmers.length === 0 ? <Empty>Hakuna mkulima mwenye deni.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Mkulima</th><th>Kikundi</th>{head}</tr></thead>
              <tbody>{data.farmers.map((f) => (
                <tr key={f.memberId}>
                  <td><Link to={farmerLink(f.memberId)}><strong>{f.name}</strong></Link><div className="muted" style={{ fontSize: 12 }}>{f.memberNo}{f.village ? ` · ${f.village}` : ''}</div></td>
                  <td>{f.group ?? <span className="muted">—</span>}</td>{cols(f)}
                </tr>
              ))}
              <tr className="row-total"><td colSpan={2}>{t('Jumla')} ({data.farmers.length})</td>{cols(data.totals)}</tr></tbody>
            </table></div>
          )
        ) : data.groups.length === 0 ? <Empty>Hakuna kikundi chenye deni. Vikundi vinaundwa na Storekeeper na kuidhinishwa na Meneja.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Kikundi</th><th className="num">Wanachama</th>{head}</tr></thead>
            <tbody>{data.groups.map((g) => {
              const mem = data.farmers.filter((f) => f.groupId === g.id);
              const isOpen = openGroup === g.id;
              return [
                <tr key={g.id} onClick={() => setOpenGroup(isOpen ? null : g.id)} style={{ cursor: 'pointer' }} className={isOpen ? 'row-picked' : ''}>
                  <td><strong>{isOpen ? '▾' : '▸'} {g.name}</strong><div className="muted" style={{ fontSize: 12 }}>{t('Wenye deni')}: {g.owing}</div></td>
                  <td className="num">{g.members}</td>{cols(g)}
                </tr>,
                ...(isOpen ? mem.map((f) => (
                  <tr key={`${g.id}-${f.memberId}`} className="row-sub">
                    <td style={{ paddingLeft: 28 }}><Link to={farmerLink(f.memberId)}>{f.name}</Link> <span className="muted" style={{ fontSize: 12 }}>{f.memberNo}</span></td><td />{cols(f)}
                  </tr>
                )) : []),
              ];
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}

interface Loan { id: string; memberId: string; trees?: number | null; memberNo: string; memberName: string; amount: string; interest: string; amountUsd: string | null; interestUsd: string | null; method: string; provider: string | null; destination: string; status: string; providerRef: string | null; failureReason: string | null; txnNo: string | null }

export function KuniBatch() {
  const { id } = useParams();
  const { may } = useAuth();
  const t = useT();
  const { data, reload } = useFetch<{ batch: BatchRow & { label: string }; approval: { requestNo: string; decidedBy: string | null; decidedAt: string | null } | null; loans: Loan[]; summary: { MOBILE_MONEY: string; BANK: string; CASH: string; paid: string; paidUsd: string; pending: number } }>(`/kuni/batches/${id}`);
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>(may('finance.record') ? '/finance/accounts' : null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'confirm' | 'fail' | null>(null);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const b = data.batch;
  const um = isUsd(b);
  const label = LOAN[b.loanType]?.label ?? b.label;
  const payable = ['APPROVED', 'PROCESSING', 'PARTIAL'].includes(b.status) && may('finance.record');
  const pickedTotal = data.loans.filter((l) => picked.has(l.id)).reduce((s, l) => s + Number(l.amount), 0);
  const pickedUsd = data.loans.filter((l) => picked.has(l.id)).reduce((s, l) => s + Number(l.amountUsd ?? 0), 0);
  const toggle = (lid: string) => { const n = new Set(picked); if (n.has(lid)) n.delete(lid); else n.add(lid); setPicked(n); };
  const groups = (['MOBILE_MONEY', 'BANK', 'CASH'] as const).map((k) => [k, data.loans.filter((l) => l.method === k)] as const).filter(([, l]) => l.length);
  const sumOf = (list: readonly Loan[], k: 'amount' | 'interest' | 'amountUsd' | 'interestUsd') => String(list.reduce((s, l) => s + Number(l[k] ?? 0), 0));
  const back = may('finance.record') ? `/kuni?tab=${b.loanType}` : '/approvals';
  const tr = b.loanType === 'TREES';
  return (
    <>
      <PageHead title={<>{b.batchNo} <Badge status={b.status === 'DRAFT' ? 'PENDING_APPROVAL' : b.status} label={B_STATUS[b.status]} /></>}
        sub={<>{t(label)}{b.totalTrees ? ` (${trees(b.totalTrees)})` : ''} {um ? usd(b.totalUsd) : tsh(b.totalAmount)}{um ? ` (${tsh(b.totalAmount)})` : ''} · {t('riba')} {num(b.interestRate)}% ({um ? usd(b.totalInterestUsd) : tsh(b.totalInterest)}) · {t('imetumwa')} {um ? usd(data.summary.paidUsd) : tsh(data.summary.paid)}{um && b.fxRate ? ` · 1 USD = TSh ${num(b.fxRate)}` : ''}</>}>
        <Link className="btn btn-secondary no-print" to={back}>← Rudi</Link>
        <Button variant="secondary" className="no-print" onClick={() => apiDownload(`/kuni/batches/${b.id}/csv`, { filename: `${({ KUNI: 'mkopo-wa-kuni', GRADING: 'mkopo-wa-grading', TREES: 'mkopo-wa-miti' } as const)[b.loanType]}-${b.batchNo}.csv` })}>CSV ya benki / M-Pesa</Button>
        <PrintButton label="Chapisha orodha" />
      </PageHead>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {b.status === 'DRAFT' && <Alert kind="warn">Inasubiri idhini ya Meneja. Hakuna pesa inayotumwa kabla ya idhini.</Alert>}
      {payable && data.summary.pending > 0 && <Alert kind="warn">Tuma pesa (TSh) kwenye akaunti za wakulima (bulk M-Pesa, benki au taslimu), kisha chagua waliotumiwa na uthibitishe hapa. Mkopo na riba vinaingia kwenye deni la dola la mkulima wakati wa kuthibitisha.</Alert>}
      <section className="card card-pad print-doc">
        <DocHead title={`ORODHA YA ${label.toUpperCase()}`} no={b.batchNo} sub={`Riba ${num(b.interestRate)}% kwa msimu${um && b.fxRate ? ` · 1 USD = TSh ${num(b.fxRate)}` : ''}`} />
        {groups.map(([k, list]) => (
          <div key={k} className="table-wrap" style={{ marginBottom: 16 }}>
            <table className="table fin-table">
              <thead><tr>{payable && <th className="no-print" style={{ width: 36 }} />}<th>{t(METHOD[k])} — {t('Mkulima')}</th><th>{k === 'CASH' ? 'Sahihi ya mpokeaji' : 'Namba / akaunti'}</th>
                {tr && <th className="num">Miti</th>}{um && <th className="num">Mkopo (USD)</th>}<th className="num">{um ? 'Kutuma (TSh)' : 'Mkopo'}</th><th className="num">Riba</th><th>Hali</th></tr></thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} className={picked.has(l.id) ? 'row-picked' : ''}>
                    {payable && <td className="no-print">{(l.status === 'PENDING' || l.status === 'FAILED') && <input type="checkbox" aria-label={`Chagua ${l.memberName}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />}</td>}
                    <td>{l.memberName}<div className="muted" style={{ fontSize: 12 }}>{l.memberNo}</div></td>
                    <td>{k === 'CASH' ? <span className="sign-line" /> : <>{l.provider ? `${l.provider === 'MPESA' ? 'M-Pesa' : l.provider} · ` : ''}{k === 'MOBILE_MONEY' ? phone(l.destination) : l.destination}</>}</td>
                    {tr && <td className="num">{Number(l.trees ?? 0).toLocaleString('en-US')}</td>}
                    {um && <td className="num"><strong>{usd(l.amountUsd)}</strong></td>}
                    <td className="num">{um ? tsh(l.amount) : <strong>{tsh(l.amount)}</strong>}</td>
                    <td className="num">{um ? usd(l.interestUsd) : tsh(l.interest)}</td>
                    <td><Badge status={l.status} />{l.txnNo && <div className="muted" style={{ fontSize: 12 }}>{l.txnNo} · {l.providerRef}</div>}{l.failureReason && <div className="muted" style={{ fontSize: 12 }}>{l.failureReason}</div>}</td>
                  </tr>
                ))}
                <tr className="row-total">{payable && <td className="no-print" />}<td colSpan={2}>{t('Jumla')} — {t(METHOD[k])} ({list.length})</td>
                  {tr && <td className="num">{list.reduce((x, l) => x + Number(l.trees ?? 0), 0).toLocaleString('en-US')}</td>}
                  {um && <td className="num">{usd(sumOf(list, 'amountUsd'))}</td>}<td className="num">{tsh(sumOf(list, 'amount'))}</td><td className="num">{um ? usd(sumOf(list, 'interestUsd')) : tsh(sumOf(list, 'interest'))}</td><td /></tr>
              </tbody>
            </table>
          </div>
        ))}
        {data.approval && <p className="muted">Idhini: {data.approval.requestNo}{data.approval.decidedBy ? ` · ${data.approval.decidedBy} · ${dateTime(data.approval.decidedAt)}` : ''}</p>}
        <Signatures items={['Ameandaa (Mhasibu)', 'Ameidhinisha (Meneja)', 'Mwenyekiti wa Bodi']} />
      </section>
      {payable && picked.size > 0 && (
        <div className="sticky-bar no-print">
          <span>{t('Umechagua')} <strong>{picked.size}</strong> · {um ? `${usd(pickedUsd)} (${tsh(pickedTotal)})` : tsh(pickedTotal)}</span>
          <div className="actions"><Button variant="secondary" onClick={() => setMode('fail')}>Weka "imeshindwa"</Button><Button onClick={() => setMode('confirm')}>Thibitisha zimetumwa</Button></div>
        </div>
      )}
      {mode === 'confirm' && (
        <Modal open title={`Thibitisha malipo ${picked.size} (${tsh(pickedTotal)})`} onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button busy={busy} disabled={!accountId || reference.trim().length < 2} onClick={async () => {
            const r = await run(() => api<{ confirmed: number }>(`/kuni/batches/${b.id}/confirm`, { method: 'POST', body: { accountId, loanIds: [...picked], reference } }));
            if (r) { setOk(`Mikopo ${r.confirmed} imethibitishwa — mkopo na riba vimeingia kwenye madeni ya wakulima`); setPicked(new Set()); setMode(null); reload(); }
          }}>Thibitisha</Button></>}>
          <Alert kind="warn">Thibitisha tu pesa zilizotoka kweli.</Alert>
          <div className="form-grid">
            <SelectField label="Akaunti iliyolipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
            <TextField label="Kumbukumbu ya malipo *" value={reference} onChange={setReference} />
          </div>
        </Modal>
      )}
      {mode === 'fail' && (
        <Modal open title="Malipo yameshindwa" onClose={() => setMode(null)}
          footer={<><Button variant="secondary" onClick={() => setMode(null)}>Ghairi</Button><Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={async () => {
            const r = await run(() => api<{ failed: number }>(`/kuni/batches/${b.id}/fail`, { method: 'POST', body: { loanIds: [...picked], reason } }));
            if (r) { setOk(`Malipo ${r.failed} yamewekwa "yameshindwa"`); setPicked(new Set()); setMode(null); reload(); }
          }}>Hifadhi</Button></>}>
          <TextField label="Sababu *" value={reason} onChange={setReason} />
        </Modal>
      )}
    </>
  );
}
