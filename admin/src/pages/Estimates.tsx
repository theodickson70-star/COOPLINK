// =====================================================================
//  MAKISIO YA MSIMU — kama fomu ya makisio ya chama (mf. NSANJO):
//   TTB · mabani · ekari za tumbaku (kilo = ekari x kilo kwa ekari) · mahindi · miti
//   · pembejeo zilizokisiwa (bidhaa za chama) · trip za kuni · grading · sahihi
//   Fomu nzima ya chama inachapishwa (A4 landscape) kwa sahihi za wakulima.
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, num } from '../lib/format';
import { usd } from '../lib/fx';
import { useT } from '../lib/prefs';
import { useAuth } from '../lib/auth';
import { ConfirmDialog, Section, Tabs } from '../components/owner-ui';
import { Alert, Badge, Button, Empty, Loading, MemberPicker, PageHead, Pager, Select, Stat, TextField, type MemberLite } from '../components/ui';
import { PrintButton } from './acc-common';

interface EstInput { inputItemId: string; name: string; unit: string; quantity: string; kg: string | null; packKg?: string | null }
interface Estimate {
  id: string; acresPlanted: string; estimatedKg: string; status: string; notes: string | null; createdAt: string;
  ttbNo: string | null; barnsExisting: number | null; barnsNew: number | null; maizeAcres: string | null; treeAcres: string | null; kuniTrips: string | null; gradingUsd: string | null;
  member: { id: string; memberNo: string; firstName: string; lastName: string }; inputs?: EstInput[];
}
interface Summary { season: { name: string }; kgPerAcre: string | null; byStatus: { status: string; members: number; acres: string; kg: string; barns: number; trips: string }[] }
interface Item { id: string; name: string; unit: string; isActive: boolean; packKg?: string | null; looseKg?: boolean }
const UNIT: Record<string, string> = { BAG: 'mifuko', KG: 'kg', LITRE: 'lita', PIECE: 'vipande', PACKET: 'pakiti', BOTTLE: 'chupa', ROLL: 'roli', SPOOL: 'spools', METRE: 'mita' };
const unitOf = (u: string) => UNIT[u] ?? u.toLowerCase();
const n = (v: string | number | null | undefined) => (v == null || v === '' || Number(v) === 0 ? '' : num(v));

export function Estimates() {
  const { may } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'sheet' ? 'sheet' : 'list';
  const sum = useFetch<Summary>('/estimates/summary');
  const by = (s: string) => sum.data?.byStatus.find((b) => b.status === s);
  return (
    <>
      <div className={tab === 'sheet' ? 'est-print-hide' : undefined}>
      <PageHead title="Makisio ya msimu" sub={sum.data ? <>Msimu {sum.data.season.name} · kilo {num(sum.data.kgPerAcre)} kwa ekari ya tumbaku</> : undefined}>
        {may('estimates.write') && <Link className="btn btn-primary" to="/estimates/new">+ Ongeza makisio</Link>}
      </PageHead>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat accent label="Kilo zilizoidhinishwa" value={`${num(by('APPROVED')?.kg)} kg`} hint={`Wakulima ${num(by('APPROVED')?.members)} · ekari ${num(by('APPROVED')?.acres)}`} />
        <Stat label="Mabani (yaliyoidhinishwa)" value={num(by('APPROVED')?.barns)} hint={`Trip za kuni ${num(by('APPROVED')?.trips)}`} />
        <Stat label="Zinasubiri idhini" value={num(by('DRAFT')?.members)} hint={`${num(by('DRAFT')?.kg)} kg`} />
        <Stat label="Zimekataliwa" value={num(by('REJECTED')?.members)} />
      </div>
      <Tabs value={tab} onChange={(v) => setSp(v === 'sheet' ? { tab: 'sheet' } : {}, { replace: true })} items={[['list', 'Orodha ya makisio'], ['sheet', 'Fomu ya makisio (kuchapisha)']]} />
      </div>
      <div style={{ marginTop: 16 }}>{tab === 'sheet' ? <Sheet /> : <List onChange={sum.reload} />}</div>
    </>
  );
}

function List({ onChange }: { onChange: () => void }) {
  const { may } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useFetch<Paged<Estimate>>('/estimates', { status, page, pageSize: 25 });
  const act = useAction();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const settings = useSettingsCard(may('estimates.approve'));
  const reload = () => { list.reload(); onChange(); };
  return (
    <>
      <ConfirmDialog open={!!confirmId} title="Idhinisha makisio" confirmLabel="Idhinisha"
        message="Weka nenosiri lako la kuingia kuthibitisha kuwa ni wewe unayeidhinisha makisio haya."
        onClose={() => setConfirmId(null)}
        onConfirm={async (c) => { await api(`/estimates/${confirmId}/approve`, { method: 'POST', body: c }); setConfirmId(null); reload(); }} />
      {settings}
      <Alert>{act.error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Hali zote</option><option value="DRAFT">Rasimu</option><option value="APPROVED">Imeidhinishwa</option><option value="REJECTED">Imekataliwa</option>
          </Select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>Hakuna makisio bado.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mwanachama</th><th>TTB</th><th className="num">Mabani</th><th className="num">Ekari</th><th className="num">Kilo</th><th className="num">Mahindi / Miti</th><th>Pembejeo</th><th className="num">Kuni / Grading</th><th>Hali</th><th /></tr></thead>
              <tbody>
                {list.data?.data.map((e) => (
                  <tr key={e.id}>
                    <td><Link className="row-link" to={`/members/${e.member.id}`}>{e.member.firstName} {e.member.lastName}</Link><div className="muted" style={{ fontSize: 13 }}>{e.member.memberNo} · {date(e.createdAt)}</div></td>
                    <td>{e.ttbNo ?? <span className="muted">—</span>}</td>
                    <td className="num">{e.barnsExisting != null || e.barnsNew != null ? <>{num(e.barnsExisting ?? 0)}{e.barnsNew ? <span className="muted"> +{e.barnsNew}</span> : null}</> : '—'}</td>
                    <td className="num">{num(e.acresPlanted)}</td>
                    <td className="num">{num(e.estimatedKg)}</td>
                    <td className="num">{n(e.maizeAcres) || '—'} / {n(e.treeAcres) || '—'}</td>
                    <td style={{ fontSize: 12.5, maxWidth: 260 }}>{e.inputs?.length ? e.inputs.map((i) => `${i.name} ${i.kg ? `${num(i.kg)} kg` : num(i.quantity)}`).join(' · ') : <span className="muted">—</span>}</td>
                    <td className="num">{e.kuniTrips ? `${num(e.kuniTrips)} trip` : '—'}{e.gradingUsd && Number(e.gradingUsd) > 0 ? <div className="muted" style={{ fontSize: 12 }}>{usd(e.gradingUsd)}</div> : null}</td>
                    <td><Badge status={e.status} /></td>
                    <td className="num">
                      <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {e.status === 'DRAFT' && may('estimates.write') && <Link className="btn btn-secondary btn-sm" to={`/estimates/${e.id}/edit`}>Hariri</Link>}
                        {e.status === 'DRAFT' && may('estimates.approve') && <>
                          <Button size="sm" busy={act.busy} onClick={() => setConfirmId(e.id)}>Idhinisha</Button>
                          <Button size="sm" variant="secondary" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/estimates/${e.id}/reject`, { method: 'POST' }))) reload(); }}>Kataa</Button>
                        </>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={list.data?.meta} onPage={setPage} />
      </section>
    </>
  );
}

/** Kilo kwa ekari na S.L.P ya chama (Meneja) */
function useSettingsCard(canEdit: boolean) {
  const t = useT();
  const s = useFetch<{ kgPerAcre: string; postalAddress: string | null }>('/estimates/settings');
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ kgPerAcre: '', postalAddress: '' });
  const { busy, error, run } = useAction();
  if (!canEdit || !s.data) return null;
  if (!edit) return (
    <p className="muted no-print" style={{ margin: '0 0 12px' }}>{t('Kilo za tumbaku kwa ekari')}: <strong>{num(s.data.kgPerAcre)}</strong>{s.data.postalAddress ? <> · {s.data.postalAddress}</> : null} ·{' '}
      <button type="button" className="link-btn" onClick={() => { setF({ kgPerAcre: String(Number(s.data!.kgPerAcre)), postalAddress: s.data!.postalAddress ?? '' }); setEdit(true); }}>{t('Badilisha')}</button></p>
  );
  return (
    <Section title="Mipangilio ya makisio">
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Kilo za tumbaku kwa ekari *" type="number" min="1" value={f.kgPerAcre} onChange={(v) => setF({ ...f, kgPerAcre: v })} help="Mf. 560 — makisio ya ekari 2 = kilo 1,120" />
        <TextField label="Anwani ya posta ya chama" value={f.postalAddress} onChange={(v) => setF({ ...f, postalAddress: v })} placeholder="mf. S.L.P 149 Urambo" help="Inaonekana juu ya fomu iliyochapishwa" />
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={() => setEdit(false)}>Ghairi</Button>
        <Button busy={busy} onClick={async () => { if (await run(() => api('/estimates/settings', { method: 'PUT', body: f }))) { setEdit(false); s.reload(); } }}>Hifadhi</Button>
      </div>
    </Section>
  );
}

// ------------------------------ FOMU YA MAKISIO (kuongeza / kuhariri) ------------------------------
type Line = { quantity: string; unit: 'PACK' | 'KG' };
export function EstimateForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const t = useT();
  const editing = !!id;
  const existing = useFetch<{ estimate: Estimate & { memberId: string; inputs: (EstInput & { packKg: string | null })[] } }>(id ? `/estimates/${id}` : null);
  const items = useFetch<{ data: Item[] }>('/inputs/items', { active: 'true' });
  const st = useFetch<{ kgPerAcre: string }>('/estimates/settings');
  const [member, setMember] = useState<MemberLite | null>(null);
  const [f, setF] = useState({ ttbNo: '', barnsExisting: '', barnsNew: '', acresPlanted: '', estimatedKg: '', maizeAcres: '', treeAcres: '', kuniTrips: '', gradingUsd: '', notes: '' });
  const [kgTouched, setKgTouched] = useState(false);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const { busy, error, run } = useAction();
  const kpa = Number(st.data?.kgPerAcre ?? 560);

  useEffect(() => {
    const e = existing.data?.estimate;
    if (!e) return;
    const s = (v: unknown) => (v == null ? '' : String(Number(v)));
    setF({ ttbNo: e.ttbNo ?? '', barnsExisting: s(e.barnsExisting), barnsNew: s(e.barnsNew), acresPlanted: s(e.acresPlanted), estimatedKg: s(e.estimatedKg), maizeAcres: s(e.maizeAcres), treeAcres: s(e.treeAcres), kuniTrips: s(e.kuniTrips), gradingUsd: s(e.gradingUsd), notes: e.notes ?? '' });
    setKgTouched(Number(e.estimatedKg) !== Math.round(Number(e.acresPlanted) * kpa * 100) / 100);
    setLines(Object.fromEntries(e.inputs.map((i) => [i.inputItemId, i.kg ? { quantity: String(Number(i.kg)), unit: 'KG' as const } : { quantity: String(Number(i.quantity)), unit: 'PACK' as const }])));
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoKg = f.acresPlanted ? Math.round(Number(f.acresPlanted) * kpa * 100) / 100 : 0;
  const kg = kgTouched ? f.estimatedKg : autoKg ? String(autoKg) : '';
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const its = useMemo(() => {
    const all = items.data?.data ?? [];
    // Bidhaa zilizosimamishwa lakini ziko kwenye makisio haya zinaonyeshwa pia
    const extra = (existing.data?.estimate.inputs ?? []).filter((i) => !all.some((a) => a.id === i.inputItemId)).map((i): Item => ({ id: i.inputItemId, name: i.name, unit: i.unit, isActive: false, packKg: i.packKg ?? null, looseKg: !!i.kg }));
    return [...all, ...extra];
  }, [items.data, existing.data]);
  const est = existing.data?.estimate;
  if ((editing && !est) || (items.loading && !items.data)) return <Loading />;
  if (est && est.status !== 'DRAFT') return <Alert kind="warn">Makisio yaliyoidhinishwa/kukataliwa hayabadilishwi.</Alert>;
  const valid = (editing || member) && Number(f.acresPlanted) > 0 && Number(kg) > 0
    && Object.entries(lines).every(([iid, l]) => !l.quantity || (Number(l.quantity) > 0 && (l.unit !== 'KG' || Number.isInteger(Number(l.quantity))) && its.some((i) => i.id === iid)));
  const optional = (v: string) => (v === '' ? null : v);
  const save = async () => {
    const inputs = Object.entries(lines).filter(([, l]) => Number(l.quantity) > 0).map(([inputItemId, l]) => ({ inputItemId, quantity: l.quantity, unit: l.unit }));
    const body = {
      ttbNo: optional(f.ttbNo.trim()), barnsExisting: optional(f.barnsExisting), barnsNew: optional(f.barnsNew), acresPlanted: f.acresPlanted, estimatedKg: kg,
      maizeAcres: optional(f.maizeAcres), treeAcres: optional(f.treeAcres), kuniTrips: optional(f.kuniTrips), gradingUsd: optional(f.gradingUsd), notes: optional(f.notes.trim()), inputs,
    };
    const r = await run(() => editing ? api(`/estimates/${id}`, { method: 'PATCH', body }) : api('/estimates', { method: 'POST', body: { ...body, memberId: member!.id } }));
    if (r) nav('/estimates', { replace: true });
  };
  return (
    <>
      <PageHead title={editing ? 'Hariri makisio' : 'Makisio mapya'} sub={editing && est ? `${est.member.firstName} ${est.member.lastName} (${est.member.memberNo}) · rasimu — inabadilika mpaka Meneja aidhinishe` : 'Makisio ya mkulima kwa msimu huu: uzalishaji, pembejeo na mikopo'}>
        <Link className="btn btn-secondary" to="/estimates">← Makisio</Link>
      </PageHead>
      <div className="stack">
        <Alert>{error}</Alert>
        <Section title="Mkulima na shamba">
          {!editing && <MemberPicker value={member} onChange={setMember} />}
          <div className="form-grid">
            <TextField label="Namba ya TTB" value={f.ttbNo} onChange={set('ttbNo')} placeholder="mf. TTB/URM/1234" help="Namba ya usajili ya Bodi ya Tumbaku ya msimu huu" />
            <TextField label="Mabani yaliyopo" type="number" min="0" step="1" value={f.barnsExisting} onChange={set('barnsExisting')} />
            <TextField label="Mabani yanayoongezeka" type="number" min="0" step="1" value={f.barnsNew} onChange={set('barnsNew')} />
          </div>
          <div className="form-grid">
            <TextField label="Ekari za tumbaku *" type="number" min="0.01" step="0.01" value={f.acresPlanted} onChange={set('acresPlanted')} />
            <TextField label={`Kilo za tumbaku * (@${num(kpa)} kwa ekari)`} type="number" min="1" step="1" value={kg} onChange={(v) => { setKgTouched(true); set('estimatedKg')(v); }}
              help={kgTouched && autoKg ? `Kwa @${num(kpa)}: kilo ${num(autoKg)}` : 'Inajihesabu: ekari × kilo kwa ekari'} />
            <TextField label="Ekari za mahindi" type="number" min="0" step="0.01" value={f.maizeAcres} onChange={set('maizeAcres')} />
            <TextField label="Ekari za miti" type="number" min="0" step="0.01" value={f.treeAcres} onChange={set('treeAcres')} help="Kikomo cha mkopo wa miti" />
          </div>
          {kgTouched && autoKg > 0 && <button type="button" className="link-btn" onClick={() => setKgTouched(false)}>{t('Rudisha kilo za kujihesabu')}</button>}
        </Section>
        <Section title="Pembejeo zilizokisiwa" pad={false}>
          {its.length === 0 ? <Empty>Chama bado hakina pembejeo zilizosajiliwa (Bidhaa na Stoo).</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Pembejeo</th><th style={{ width: 220 }}>Kiasi</th><th>Kipimo</th></tr></thead>
              <tbody>{its.map((i) => {
                const l = lines[i.id] ?? { quantity: '', unit: 'PACK' as const };
                const kgMode = l.unit === 'KG';
                const upd = (p: Partial<Line>) => setLines((x) => ({ ...x, [i.id]: { ...l, ...p } }));
                return (
                  <tr key={i.id} className={Number(l.quantity) > 0 ? 'row-picked' : ''}>
                    <td><strong>{i.name}</strong>{!i.isActive && <span className="muted"> (imesitishwa)</span>}</td>
                    <td><input className="input" type="number" min="0" step={kgMode ? 1 : 0.01} value={l.quantity} aria-label={`Kiasi ${i.name}`} onChange={(e) => upd({ quantity: e.target.value })} />
                      {kgMode && l.quantity && !Number.isInteger(Number(l.quantity)) && <div className="money-neg" style={{ fontSize: 12 }}>{t('Kilo nzima tu')}</div>}</td>
                    <td>{i.looseKg && Number(i.packKg) > 0 ? (
                      <div className="unit-toggle" role="group" aria-label="Kipimo">
                        <button type="button" className={!kgMode ? 'on' : ''} onClick={() => upd({ unit: 'PACK' })}>{unitOf(i.unit)}</button>
                        <button type="button" className={kgMode ? 'on' : ''} onClick={() => upd({ unit: 'KG' })}>{t('Kilo')}</button>
                      </div>) : <span className="muted">{unitOf(i.unit)}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Section>
        <Section title="Kuni na grading">
          <div className="form-grid">
            <TextField label="Trip za kuni" type="number" min="0" step="0.5" value={f.kuniTrips} onChange={set('kuniTrips')} help="Kikomo cha mkopo wa kuni (trip × bei ya trip)" />
            <TextField label="Grading (USD)" type="number" min="0" step="0.01" value={f.gradingUsd} onChange={set('gradingUsd')} help="Kikomo cha mkopo wa grading" />
          </div>
          <TextField label="Maelezo" value={f.notes} onChange={set('notes')} />
        </Section>
        <div className="actions">
          <Button variant="gold" busy={busy} disabled={!valid} onClick={save} style={{ minHeight: 48 }}>{editing ? 'Hifadhi mabadiliko' : 'Hifadhi makisio'}</Button>
          <Link className="btn btn-secondary" to="/estimates">Ghairi</Link>
        </div>
      </div>
    </>
  );
}

// ------------------------------ FOMU YA CHAMA (KUCHAPISHA) ------------------------------
interface SheetRow extends Omit<Estimate, 'member' | 'inputs'> { memberId: string; memberNo: string; name: string; village: string | null; inputs: Record<string, { quantity: string; kg: string | null }> }
interface SheetRes {
  amcos: { name: string; code: string; regNumber: string | null; postalAddress: string | null; district: string | null; village: string | null };
  season: { name: string }; kgPerAcre: string; items: { id: string; name: string; unit: string; looseKg: boolean }[]; data: SheetRow[]; totals: Record<string, string>;
}
function Sheet() {
  const t = useT();
  const [status, setStatus] = useState<'ALL' | 'APPROVED' | 'DRAFT'>('ALL');
  const { data, error } = useFetch<SheetRes>('/estimates/sheet', { status });
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const a = data.amcos;
  // Bidhaa zinazopimwa kwa kilo kwa vitalu zinaonyesha kilo kama zimekisiwa kwa kilo
  const cell = (r: SheetRow, iid: string) => { const v = r.inputs[iid]; return v ? (v.kg ? `${num(v.kg)}` : num(v.quantity)) : ''; };
  const head = (i: SheetRes['items'][number]) => `${i.name} (${data.data.some((r) => r.inputs[i.id]?.kg) ? 'kg' : unitOf(i.unit)})`;
  return (
    <>
      <div className="toolbar no-print" style={{ padding: 0, marginBottom: 12 }}>
        <Select aria-label="Hali" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="ALL">Yote (isipokuwa yaliyokataliwa)</option><option value="APPROVED">Yaliyoidhinishwa</option><option value="DRAFT">Rasimu</option>
        </Select>
        <div className="grow" />
        <PrintButton label="Chapisha fomu (A4 landscape)" />
      </div>
      <section className="card card-pad print-doc est-sheet">
        <div className="est-sheet-head">
          <div className="est-org">{a.name.toUpperCase()}</div>
          <div>{[a.regNumber ? `REG NO: ${a.regNumber}` : null, a.postalAddress, a.district].filter(Boolean).join(' · ')}</div>
          <div className="est-title">{t('MAKISIO YA PEMBEJEO KWA KILA MKULIMA KWA MSIMU')} {data.season.name}</div>
        </div>
        {data.data.length === 0 ? <Empty>Hakuna makisio ya msimu huu.</Empty> : (
          <div className="table-wrap"><table className="table est-table">
            <thead>
              <tr>
                <th rowSpan={2}>S/N</th><th rowSpan={2}>{t('Jina la mkulima')}</th><th rowSpan={2}>TTB</th>
                <th colSpan={2}>{t('Idadi ya bani')}</th><th colSpan={4}>{t('Ekari')}</th>
                {data.items.map((i) => <th key={i.id} rowSpan={2} className="est-vert"><span>{head(i)}</span></th>)}
                <th rowSpan={2} className="est-vert"><span>{t('Kuni (trip)')}</span></th><th rowSpan={2} className="est-vert"><span>Grading ($)</span></th><th rowSpan={2}>{t('Sahihi')}</th>
              </tr>
              <tr><th>{t('Zilizopo')}</th><th>{t('Ongezeka')}</th><th>{t('Tumbaku')}</th><th>{t('Kilo')} @{num(data.kgPerAcre)}</th><th>{t('Mahindi')}</th><th>{t('Miti')}</th></tr>
            </thead>
            <tbody>
              {data.data.map((r, k) => (
                <tr key={r.id}>
                  <td>{k + 1}</td><td className="est-name">{r.name}<div className="muted">{r.memberNo}</div></td><td>{r.ttbNo ?? ''}</td>
                  <td className="num">{n(r.barnsExisting)}</td><td className="num">{n(r.barnsNew)}</td>
                  <td className="num">{n(r.acresPlanted)}</td><td className="num">{n(r.estimatedKg)}</td><td className="num">{n(r.maizeAcres)}</td><td className="num">{n(r.treeAcres)}</td>
                  {data.items.map((i) => <td key={i.id} className="num">{cell(r, i.id)}</td>)}
                  <td className="num">{n(r.kuniTrips)}</td><td className="num">{n(r.gradingUsd)}</td><td className="est-sign" />
                </tr>
              ))}
              <tr className="row-total">
                <td /><td>{t('JUMLA')} ({data.data.length})</td><td />
                {['barnsExisting', 'barnsNew', 'acresPlanted', 'estimatedKg', 'maizeAcres', 'treeAcres'].map((k) => <td key={k} className="num">{n(data.totals[k])}</td>)}
                {data.items.map((i) => <td key={i.id} className="num">{n(data.totals[`item:${i.id}`])}</td>)}
                <td className="num">{n(data.totals.kuniTrips)}</td><td className="num">{n(data.totals.gradingUsd)}</td><td />
              </tr>
            </tbody>
          </table></div>
        )}
        <div className="doc-sign" style={{ marginTop: 28 }}>
          {['Ameandaa (Stokipa / Afisa ugani)', 'Ameidhinisha (Meneja)', 'Mwenyekiti wa Bodi'].map((s) => <div key={s}><span />{t(s)}</div>)}
        </div>
      </section>
    </>
  );
}
