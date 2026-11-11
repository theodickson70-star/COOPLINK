import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PortalSummary } from '../components/FarmerPortalAccess';
import { useT } from '../lib/prefs';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { date, phone } from '../lib/format';
import { useAuth } from '../lib/auth';
import { NameNote, PhoneNameFields, usePhoneName } from '../components/PhoneName';
import { Alert, Badge, Button, Empty, Input, Loading, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';

export interface Member {
  id: string; memberNo: string; firstName: string; middleName: string | null; lastName: string; gender: 'MALE' | 'FEMALE'; maritalStatus?: 'MARRIED' | 'SINGLE' | null;
  dateOfBirth: string | null; nidaNumber: string | null; voterIdNumber: string | null; phone: string | null; village: string | null; hamlet: string | null;
  status: string; joinedAt: string; mobileMoneyNumber: string | null; mobileMoneyProvider: string | null; mobileMoneyName: string | null;
  bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; preferredPayment: string;
  phoneOwnerName?: string | null; nameOverrideReason?: string | null; nameOverrideById?: string | null; nameOverrideAt?: string | null;
  sharesCount: number; nextOfKinName: string | null; nextOfKinPhone: string | null; nextOfKinRelation: string | null; amcosId: string;
  entryFee: string | null; entryFeePaid: boolean; entryFeePaidAt: string | null; entryFeeReference: string | null;
  guarantorName: string | null; guarantorPhone: string | null;
}

export function Members() {
  const t = useT();
  const { may } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, error, loading } = useFetch<Paged<Member>>('/members', { search: q, status, page, pageSize: 25 });

  return (
    <>
      <PageHead title="Wanachama" sub="Orodha ya wanachama wote wa chama">
        {may('members.approve') && <Link className="btn btn-secondary" to="/members/import">Pakia daftari (CSV)</Link>}
        {may('members.write') && <Link className="btn btn-primary" to="/members/new">{t('+ Sajili mwanachama')}</Link>}
      </PageHead>
      <PortalSummary />
      <section className="card">
        <div className="toolbar">
          <Input aria-label="Tafuta" placeholder="Tafuta jina, namba ya uanachama, simu, NIDA au kadi ya mpiga kura…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('Hali zote')}</option>
            <option value="ACTIVE">{t('Hai')}</option>
            <option value="PENDING">{t('Wanasubiri uthibitisho')}</option>
            <option value="SUSPENDED">{t('Amesimamishwa')}</option>
            <option value="EXITED">{t('Ametoka')}</option>
            <option value="DECEASED">{t('Marehemu')}</option>
          </Select>
        </div>
        {error && <div className="card-pad"><Alert>{error}</Alert></div>}
        {loading && !data ? <Loading /> : data && data.data.length === 0 ? <Empty>{t('Hakuna mwanachama aliyepatikana.')}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Namba')}</th><th>{t('Jina')}</th><th>{t('Simu')}</th><th>{t('Kijiji')}</th><th>{t('Alijiunga')}</th><th>{t('Hali')}</th></tr></thead>
              <tbody>
                {data?.data.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{m.memberNo}</td>
                    <td><Link className="row-link" to={`/members/${m.id}`}>{m.firstName} {m.lastName}</Link></td>
                    <td>{phone(m.phone)}</td>
                    <td>{m.village ?? '—'}</td>
                    <td>{date(m.joinedAt)}</td>
                    <td><Badge status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
    </>
  );
}

const REASONS = ['Namba ni ya mke / mume wake', 'Namba ni ya mzazi wake', 'Namba ni ya mtoto wake', 'Namba ni ya ndugu yake', 'Namba haijasajiliwa kwenye mobile money', 'Jina kwenye mobile money limekosewa'];

const EMPTY = {
  memberNo: '', firstName: '', middleName: '', lastName: '', gender: 'MALE', maritalStatus: '', dateOfBirth: '', nidaNumber: '', voterIdNumber: '', phone: '', village: '', hamlet: '',
  mobileMoneyNumber: '', mobileMoneyProvider: 'MPESA', mobileMoneyName: '', bankName: '', bankAccountName: '', bankAccountNumber: '',
  preferredPayment: 'MOBILE_MONEY', sharesCount: '0', nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelation: '',
  entryFee: '', entryFeePaid: 'no', entryFeePaidAt: '', entryFeeReference: '', guarantorName: '', guarantorPhone: '',
  nameOverrideReason: '',
};
type Form = typeof EMPTY;

/** Hali ya ndoa kulingana na jinsia: mwanaume ameoa / hajaoa; mwanamke ameolewa / hajaolewa */
export const maritalLabel = (s: string | null | undefined, gender: string) =>
  s === 'MARRIED' ? (gender === 'FEMALE' ? 'Ameolewa' : 'Ameoa') : s === 'SINGLE' ? (gender === 'FEMALE' ? 'Hajaolewa' : 'Hajaoa') : '';
const maritalOptions = (gender: string) => [{ value: 'MARRIED', label: maritalLabel('MARRIED', gender) }, { value: 'SINGLE', label: maritalLabel('SINGLE', gender) }];
type IdType = 'NIDA' | 'VOTER' | 'NONE';

export function toPayload(f: Form, idType: IdType = 'NIDA') {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'sharesCount') out[k] = Number(v || 0);
    else if (k === 'entryFeePaid') out[k] = v === 'yes';
    else out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  }
  if (!out.mobileMoneyNumber) out.mobileMoneyProvider = null;
  // Kitambulisho kimoja kulingana na aina iliyochaguliwa
  if (idType !== 'NIDA') out.nidaNumber = null;
  if (idType !== 'VOTER') out.voterIdNumber = null;
  if (!out.entryFeePaid) { out.entryFeePaidAt = null; out.entryFeeReference = null; }
  return out;
}

export function fromMember(m: Member): Form {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Form)[]) {
    const v = (m as unknown as Record<string, unknown>)[k];
    f[k] = v === null || v === undefined ? (k === 'mobileMoneyProvider' ? 'MPESA' : '') : String(v);
  }
  f.entryFeePaid = m.entryFeePaid ? 'yes' : 'no';
  if (f.entryFee) f.entryFee = String(Number(f.entryFee));
  for (const k of ['phone', 'mobileMoneyNumber', 'nextOfKinPhone', 'guarantorPhone'] as const) if (f[k]) f[k] = f[k].replace(/^255/, '0');
  return f;
}

/** Inapunguza picha kwenye kifaa (upana 480px, JPEG) ili ifike haraka hata kwa mtandao wa kijijini. */
export async function shrinkPhoto(file: File): Promise<{ mimeType: string; data: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Picha haisomeki')); i.src = url; });
    const scale = Math.min(1, 480 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const preview = c.toDataURL('image/jpeg', 0.82);
    return { mimeType: 'image/jpeg', data: preview.split(',')[1], preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface PhotoChange { mimeType: string; data: string; preview: string }

const STEPS = [
  { key: 'personal', title: 'Taarifa binafsi', hint: 'Jina, kitambulisho na makazi' },
  { key: 'membership', title: 'Uanachama', hint: 'Hisa, kiingilio, mzamini, mrithi' },
  { key: 'payment', title: 'Malipo', hint: 'Atakavyolipwa mauzo' },
  { key: 'review', title: 'Hakiki', hint: 'Kagua kisha hifadhi' },
] as const;
const DRAFT_KEY = 'cl:member-draft';
const readDraft = (): { f: Form; idType: IdType } | null => { try { const v = localStorage.getItem(DRAFT_KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const writeDraft = (v: { f: Form; idType: IdType } | null) => { try { if (v) localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); else localStorage.removeItem(DRAFT_KEY); } catch { /* hifadhi haipatikani */ } };
const PROVIDERS: Record<string, string> = { MPESA: 'M-Pesa', AIRTEL_MONEY: 'Airtel Money', MIXX_BY_YAS: 'Mixx by Yas', HALOPESA: 'HaloPesa', TPESA: 'T-Pesa' };

/** Makosa ya kila hatua (backend inakagua tena). */
function stepErrors(step: number, f: Form, idType: IdType): string[] {
  const e: string[] = [];
  if (step === 0) {
    if (f.firstName.trim().length < 2) e.push('Jina la kwanza (angalau herufi 2)');
    if (f.lastName.trim().length < 2) e.push('Jina la ukoo (angalau herufi 2)');
    if (idType === 'NIDA' && f.nidaNumber && f.nidaNumber.length !== 20) e.push('Namba ya NIDA iwe tarakimu 20');
    if (idType === 'VOTER' && f.voterIdNumber && f.voterIdNumber.trim().length < 6) e.push('Namba ya kadi ya mpiga kura si kamili');
    if (f.phone && f.phone.replace(/\D/g, '').length < 9) e.push('Namba ya simu si kamili');
  }
  if (step === 1) {
    if (f.entryFeePaid === 'yes' && !f.entryFeeReference.trim()) e.push('Namba ya risiti ya kiingilio');
    if (f.guarantorPhone && f.guarantorPhone.replace(/\D/g, '').length < 9) e.push('Simu ya mzamini si kamili');
  }
  if (step === 2) {
    if (f.preferredPayment === 'MOBILE_MONEY' && f.mobileMoneyNumber && f.mobileMoneyNumber.replace(/\D/g, '').length < 9) e.push('Namba ya malipo ya simu si kamili');
  }
  return e;
}

export function MemberForm({ initial, onSubmit, submitLabel, busy, error, editing, currentPhoto }: {
  initial?: Form; onSubmit: (payload: Record<string, unknown>, photo: PhotoChange | null) => void; submitLabel: string; busy: boolean; error: string | null;
  editing?: boolean; currentPhoto?: string | null;
}) {
  const t = useT();
  const { may } = useAuth();
  const draft = !editing ? readDraft() : null;
  const [f, setF] = useState<Form>(initial ?? draft?.f ?? EMPTY);
  const [idType, setIdType] = useState<IdType>(draft?.idType ?? (initial ? (initial.nidaNumber ? 'NIDA' : initial.voterIdNumber ? 'VOTER' : 'NONE') : 'NIDA'));
  const [photo, setPhoto] = useState<PhotoChange | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(editing ? 3 : 0); // hatua ya mbali zaidi iliyofikiwa
  const [tried, setTried] = useState(false);
  const [restored, setRestored] = useState(!!draft);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const paidInSystem = !!editing && initial?.entryFeePaid === 'yes' && /-FN-\d+$/.test(initial.entryFeeReference);
  const canEditNo = !editing || may('members.approve');
  const errs = stepErrors(step, f, idType);

  // Rasimu inahifadhiwa kwenye kifaa hiki (mtandao ukikatika, kazi haipotei)
  useEffect(() => { if (!editing) writeDraft({ f, idType }); }, [f, idType, editing]);
  // Kosa la server linalohusu namba/kitambulisho -> rudi hatua ya 1
  useEffect(() => { if (error && /namba ya uanachama|NIDA|mpiga kura|jina/i.test(error)) setStep(0); }, [error]);

  const go = (to: number) => {
    if (to > step) {
      if (step === 0 && to > 0 && diff && (f.nameOverrideReason ?? '').trim().length < 5) { setTried(true); return; }
      for (let i = step; i < to; i++) if (stepErrors(i, f, idType).length) { setStep(i); setTried(true); return; }
    }
    setTried(false);
    setStep(to);
    setSeen((x) => Math.max(x, to));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (diff && (f.nameOverrideReason ?? '').trim().length < 5) { setStep(0); setTried(true); return; }
    for (let i = 0; i < 3; i++) if (stepErrors(i, f, idType).length) { setStep(i); setTried(true); return; }
    const payload = toPayload(f, idType);
    if (editing && !may('members.approve')) delete payload.memberNo;
    if (paidInSystem) { delete payload.entryFeePaid; delete payload.entryFeePaidAt; delete payload.entryFeeReference; }
    onSubmit(payload, photo);
  };
  const shown = photo?.preview ?? currentPhoto ?? null;
  const fullNameStr = [f.firstName, f.middleName, f.lastName].filter((x) => x.trim()).join(' ');
  // Majina ya mkulima yanatoka kwenye usajili wa mobile money wa simu yake (hayaandikwi kwa mkono)
  const own = usePhoneName(f.phone);
  // Namba si ya mkulima mwenyewe (mf. ni ya mke): jina lake linaandikwa kwa sababu, Meneja anaidhinisha
  const [diff, setDiff] = useState(!!f.nameOverrideReason);
  const [reasonKind, setReasonKind] = useState(() => (REASONS.includes(f.nameOverrideReason ?? '') ? f.nameOverrideReason : f.nameOverrideReason ? 'OTHER' : ''));
  const namesLocked = own.locked && !diff;
  const filled = useRef('');
  useEffect(() => {
    if (diff) return;
    if (own.state === 'found' && own.parts) {
      filled.current = own.name;
      setF((s) => ({ ...s, firstName: own.parts!.firstName, middleName: own.parts!.middleName ?? '', lastName: own.parts!.lastName }));
    } else if ((own.state === 'not_found' || own.state === 'typing') && filled.current) {
      // majina yaliyojazwa na namba iliyopita yasibaki kwenye namba nyingine
      filled.current = '';
      setF((s) => ({ ...s, firstName: '', middleName: '', lastName: '' }));
    }
  }, [own.state, own.name, diff]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = ({ k, v }: { k: string; v: React.ReactNode }) => <><dt>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></>;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (step < 3 && !editing) go(step + 1); else submit(); }} className="wizard">
      <ol className="wizard-steps" aria-label="Hatua za fomu">
        {STEPS.map((st, i) => (
          <li key={st.key} className={i === step ? 'on' : i <= seen ? 'done' : ''}>
            <button type="button" disabled={i > seen} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
              <span className="wz-dot">{i < step || (i <= seen && i !== step) ? '✓' : i + 1}</span>
              <span className="wz-text"><strong>{st.title}</strong><small>{st.hint}</small></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="wizard-progress" aria-hidden="true"><span style={{ width: `${(step / 3) * 100}%` }} /></div>

      {restored && (
        <Alert kind="ok">{t('Tumerejesha fomu uliyokuwa ukijaza kwenye kifaa hiki.')} <button type="button" className="link-btn" onClick={() => { setF(EMPTY); setIdType('NIDA'); setRestored(false); setStep(0); writeDraft(null); }}>{t('Anza upya')}</button></Alert>
      )}
      <Alert>{error}</Alert>
      {tried && errs.length > 0 && <Alert>Kamilisha: {errs.join(' · ')}</Alert>}

      <section className="card card-pad wizard-panel" key={step}>
        <div className="wizard-head"><span className="wz-count">Hatua {step + 1} kati ya 4</span><h2>{STEPS[step].title}</h2></div>

        {step === 0 && (
          <div className="form-grid">
            <div className="photo-field span-2">
              <div className="photo-box">{shown ? <img src={shown} alt="Picha ya mkulima" /> : <span aria-hidden="true">{(f.firstName || '?').charAt(0).toUpperCase()}</span>}</div>
              <div className="stack" style={{ gap: 6 }}>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  {shown ? 'Badilisha picha' : 'Weka picha (hiari)'}
                  <input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = '';
                    if (!file) return;
                    setPhotoErr(null);
                    try { setPhoto(await shrinkPhoto(file)); } catch (err) { setPhotoErr((err as Error).message); }
                  }} />
                </label>
                <small className="muted">{t('Unaweza kupiga picha kwa simu. Inapunguzwa ukubwa yenyewe.')}</small>
                {photoErr && <small className="money-neg">{photoErr}</small>}
              </div>
            </div>
            <TextField label="Namba ya uanachama" value={f.memberNo} onChange={(v) => set('memberNo')(v.toUpperCase())} disabled={!canEditNo}
              placeholder={editing ? '' : 'mf. URM/0123 — au acha wazi'}
              help={editing ? 'Inabadilishwa na Meneja tu' : 'Namba aliyopewa na chama. Ukiacha wazi, mfumo utatoa mpya.'} />
            <div>
              <TextField label="Simu ya mkulima" type="tel" inputMode="tel" placeholder="0712 345 678" value={f.phone} onChange={set('phone')} autoFocus={!editing} />
              {!diff && <NameNote state={own.state} network={own.network} emptyHint="Weka namba ya simu — majina yatajitokeza yenyewe. Mkulima asiye na simu: acha wazi na uandike majina." />}
              {(own.state === 'found' || own.state === 'not_found' || diff) && (
                <button type="button" className="link-btn" onClick={() => {
                  const on = !diff; setDiff(on);
                  if (!on) { setReasonKind(''); setF((s) => ({ ...s, nameOverrideReason: '' })); filled.current = ''; }
                }}>{diff ? '← Tumia jina la mwenye namba' : 'Namba si ya mkulima mwenyewe? Andika jina lake'}</button>
              )}
            </div>
            {diff && (
              <div className="override-box">
                <strong>{t('Jina tofauti na la mwenye namba')}</strong>
                <p>{own.state === 'found' ? <>{t('Namba hii imesajiliwa kwa jina la')} <b>{own.name}</b>.</> : own.state === 'not_found' ? 'Namba hii haijasajiliwa kwenye mobile money.' : null} Andika majina ya mkulima hapa chini na ueleze sababu. {may('members.approve') ? 'Wewe kama Meneja unaidhinisha jina hili ukihifadhi.' : 'Meneja ataidhinisha jina hili pamoja na usajili.'}</p>
                <div className="form-grid">
                  <SelectField label="Sababu *" value={reasonKind} placeholder="Chagua sababu…" onChange={(v) => { setReasonKind(v); setF((s) => ({ ...s, nameOverrideReason: v === 'OTHER' ? '' : v })); }}
                    options={[...REASONS.map((r) => ({ value: r, label: r })), { value: 'OTHER', label: 'Sababu nyingine…' }]} />
                  {reasonKind === 'OTHER' && <TextField label="Eleza sababu *" value={f.nameOverrideReason} onChange={set('nameOverrideReason')} placeholder="mf. Namba ni ya mjomba wake anayemsaidia" />}
                </div>
                {f.nameOverrideReason && f.nameOverrideReason.trim().length < 5 && <p className="name-note bad">Sababu iwe na maelezo ya kutosha (herufi 5+)</p>}
              </div>
            )}
            <div className={namesLocked ? 'locked-field' : undefined}><TextField label="Jina la kwanza *" value={f.firstName} onChange={set('firstName')} readOnly={namesLocked} tabIndex={namesLocked ? -1 : undefined} /></div>
            <div className={namesLocked ? 'locked-field' : undefined}><TextField label="Jina la kati" value={f.middleName} onChange={set('middleName')} readOnly={namesLocked} tabIndex={namesLocked ? -1 : undefined} /></div>
            <div className={namesLocked ? 'locked-field' : undefined}><TextField label="Jina la ukoo *" value={f.lastName} onChange={set('lastName')} readOnly={namesLocked} tabIndex={namesLocked ? -1 : undefined} /></div>
            <SelectField label="Jinsia *" value={f.gender} onChange={set('gender')} options={[{ value: 'MALE', label: 'Mwanaume' }, { value: 'FEMALE', label: 'Mwanamke' }]} />
            <SelectField label="Hali ya ndoa" value={f.maritalStatus} onChange={set('maritalStatus')} placeholder="Chagua…" options={maritalOptions(f.gender)} />
            <TextField label="Tarehe ya kuzaliwa" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
            <SelectField label="Aina ya kitambulisho" value={idType} onChange={(v) => setIdType(v as IdType)}
              options={[{ value: 'NIDA', label: 'NIDA' }, { value: 'VOTER', label: 'Kadi ya mpiga kura' }, { value: 'NONE', label: 'Hana kitambulisho kwa sasa' }]} />
            {idType === 'NIDA' && <TextField label="Namba ya NIDA" help={`Tarakimu 20 (${f.nidaNumber.length}/20)`} inputMode="numeric" maxLength={20} value={f.nidaNumber} onChange={(v) => set('nidaNumber')(v.replace(/\D/g, ''))} />}
            {idType === 'VOTER' && <TextField label="Namba ya kadi ya mpiga kura" placeholder="mf. T-1000-1234-567-8" value={f.voterIdNumber} onChange={(v) => set('voterIdNumber')(v.toUpperCase())} />}
            <TextField label="Kijiji" value={f.village} onChange={set('village')} />
            <TextField label="Kitongoji" value={f.hamlet} onChange={set('hamlet')} />
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <div className="form-section">{t('Hisa na kiingilio')}</div>
            <TextField label="Idadi ya hisa" type="number" min={0} value={f.sharesCount} onChange={set('sharesCount')} />
            <TextField label="Kiingilio cha uanachama (TSh)" type="number" min={0} value={f.entryFee} onChange={set('entryFee')} />
            {paidInSystem ? (
              <div className="field"><label>{t('Hali ya kiingilio')}</label><div><Badge status="APPROVED" label="Kimelipwa" /> <span className="muted">· {f.entryFeeReference}{f.entryFeePaidAt ? ` · ${date(f.entryFeePaidAt)}` : ''}</span></div></div>
            ) : (
              <SelectField label="Hali ya kiingilio" value={f.entryFeePaid} onChange={set('entryFeePaid')}
                options={[{ value: 'no', label: 'Hajalipa' }, { value: 'yes', label: 'Alishalipa zamani' }]} />
            )}
            {!paidInSystem && f.entryFeePaid === 'yes' && <>
              <TextField label="Namba ya risiti ya kiingilio *" value={f.entryFeeReference} onChange={set('entryFeeReference')} />
              <TextField label="Tarehe aliyolipa" type="date" value={f.entryFeePaidAt} onChange={set('entryFeePaidAt')} />
            </>}
            {!paidInSystem && f.entryFeePaid === 'no' && <p className="muted form-note">{t('Mkulima akilipa, Mhasibu atarekodi kwenye')} <strong>{t('Fedha → + Mapato → Ada za uanachama')}</strong> akimchagua mkulima huyu; hali itabadilika kuwa "Kimelipwa" yenyewe.</p>}

            <div className="form-section">{t('Mzamini wa mkulima')}</div>
            <PhoneNameFields phoneLabel="Simu ya mzamini" phone={f.guarantorPhone} onPhone={set('guarantorPhone')} nameLabel="Majina ya mzamini" name={f.guarantorName} onName={(v) => set('guarantorName')(v)} optionalPhone />

            <div className="form-section">{t('Mrithi / ndugu wa karibu')}</div>
            <PhoneNameFields phoneLabel="Simu ya mrithi" phone={f.nextOfKinPhone} onPhone={set('nextOfKinPhone')} nameLabel="Jina la mrithi" name={f.nextOfKinName} onName={(v) => set('nextOfKinName')(v)} optionalPhone />
            <TextField label="Uhusiano" placeholder="mf. Mke, Mtoto" value={f.nextOfKinRelation} onChange={set('nextOfKinRelation')} />
          </div>
        )}

        {step === 2 && (
          <div className="stack">
            <div className="pay-choice" role="radiogroup" aria-label="Njia ya malipo">
              {[['MOBILE_MONEY', 'Simu', 'M-Pesa, Airtel Money n.k.'], ['BANK', 'Benki', 'Akaunti ya benki'], ['CASH', 'Taslimu', 'Fedha mkononi']].map(([v, t, h]) => (
                <button type="button" key={v} role="radio" aria-checked={f.preferredPayment === v} className={f.preferredPayment === v ? 'on' : ''} onClick={() => set('preferredPayment')(v)}>
                  <strong>{t}</strong><small>{h}</small>
                </button>
              ))}
            </div>
            {f.preferredPayment === 'MOBILE_MONEY' && (
              <div className="form-grid">
                <SelectField label="Mtandao wa simu" value={f.mobileMoneyProvider} onChange={set('mobileMoneyProvider')} options={Object.entries(PROVIDERS).map(([value, label]) => ({ value, label }))} />
                <PhoneNameFields phoneLabel="Namba ya malipo ya simu" phone={f.mobileMoneyNumber} onPhone={set('mobileMoneyNumber')} nameLabel="Jina lililosajiliwa kwenye namba" name={f.mobileMoneyName} onName={(v) => set('mobileMoneyName')(v)} optionalPhone />
                {f.phone && !f.mobileMoneyNumber && <div className="field"><label>&nbsp;</label><Button size="sm" variant="ghost" onClick={() => setF((s) => ({ ...s, mobileMoneyNumber: s.phone }))}>Tumia simu yake ({f.phone})</Button></div>}
              </div>
            )}
            {f.preferredPayment === 'BANK' && (
              <div className="form-grid">
                <TextField label="Benki" placeholder="mf. NMB, CRDB" value={f.bankName} onChange={set('bankName')} />
                <TextField label="Jina la akaunti" value={f.bankAccountName} onChange={set('bankAccountName')} />
                <TextField label="Namba ya akaunti" value={f.bankAccountNumber} onChange={set('bankAccountNumber')} />
              </div>
            )}
            {f.preferredPayment === 'CASH' && <p className="muted" style={{ margin: 0 }}>{t('Mkulima atalipwa fedha taslimu ofisini kwa chama.')}</p>}
          </div>
        )}

        {step === 3 && (
          <div className="review">
            <div className="review-head">
              <div className="photo-box">{shown ? <img src={shown} alt="" /> : <span aria-hidden="true">{(f.firstName || '?').charAt(0).toUpperCase()}</span>}</div>
              <div><h3>{fullNameStr || '—'}</h3><span className="muted">{t('Namba ya uanachama:')} <strong>{f.memberNo || 'itatolewa na mfumo'}</strong></span></div>
            </div>
            <div className="review-grid">
              <div className="review-block">
                <div className="review-title"><strong>{t('Taarifa binafsi')}</strong><button type="button" className="link-btn" onClick={() => go(0)}>{t('Badilisha')}</button></div>
                <dl className="dl">
                  <R k="Jinsia" v={f.gender === 'FEMALE' ? 'Mwanamke' : 'Mwanaume'} />
                  <R k="Hali ya ndoa" v={maritalLabel(f.maritalStatus, f.gender)} />
                  <R k="Tarehe ya kuzaliwa" v={f.dateOfBirth ? date(f.dateOfBirth) : ''} />
                  <R k="Simu" v={f.phone} />
                  <R k="Kitambulisho" v={idType === 'NIDA' ? (f.nidaNumber ? `NIDA · ${f.nidaNumber}` : '') : idType === 'VOTER' ? (f.voterIdNumber ? `Mpiga kura · ${f.voterIdNumber}` : '') : 'Hana kwa sasa'} />
                  <R k="Makazi" v={[f.village, f.hamlet].filter(Boolean).join(', ')} />
                </dl>
              </div>
              <div className="review-block">
                <div className="review-title"><strong>{t('Uanachama')}</strong><button type="button" className="link-btn" onClick={() => go(1)}>{t('Badilisha')}</button></div>
                <dl className="dl">
                  <R k="Hisa" v={f.sharesCount} />
                  <R k="Kiingilio" v={f.entryFee ? `TSh ${Number(f.entryFee).toLocaleString()} · ${f.entryFeePaid === 'yes' ? 'Kimelipwa' : 'Hakijalipwa'}` : ''} />
                  <R k="Mzamini" v={f.guarantorName ? `${f.guarantorName}${f.guarantorPhone ? ` · ${f.guarantorPhone}` : ''}` : ''} />
                  <R k="Mrithi" v={f.nextOfKinName ? `${f.nextOfKinName}${f.nextOfKinRelation ? ` (${f.nextOfKinRelation})` : ''}` : ''} />
                </dl>
              </div>
              <div className="review-block">
                <div className="review-title"><strong>{t('Malipo')}</strong><button type="button" className="link-btn" onClick={() => go(2)}>{t('Badilisha')}</button></div>
                <dl className="dl">
                  <R k="Njia" v={f.preferredPayment === 'BANK' ? 'Benki' : f.preferredPayment === 'CASH' ? 'Taslimu' : 'Simu'} />
                  {f.preferredPayment === 'MOBILE_MONEY' && <R k="Namba" v={f.mobileMoneyNumber ? `${PROVIDERS[f.mobileMoneyProvider] ?? ''} · ${f.mobileMoneyNumber}` : ''} />}
                  {f.preferredPayment === 'BANK' && <R k="Akaunti" v={f.bankAccountNumber ? `${f.bankName} · ${f.bankAccountNumber}` : ''} />}
                </dl>
              </div>
            </div>
            {!editing && !may('members.approve') && <Alert kind="warn">{t('Mkulima huyu atasubiri uthibitisho wa Meneja kabla ya kupewa pembejeo.')}</Alert>}
          </div>
        )}
      </section>

      <div className="wizard-actions">
        {step > 0 ? <Button type="button" variant="secondary" onClick={() => go(step - 1)}>{t('← Nyuma')}</Button> : <span />}
        <div className="actions">
          {editing && step < 3 && <Button type="button" variant="secondary" busy={busy} onClick={() => submit()}>{submitLabel}</Button>}
          {/* key tofauti: React isitumie kitufe kilekile (kingegeuka "submit" katikati ya kubofya na kusajili bila kuhakiki) */}
          {step < 3
            ? <Button key="next" type="button" onClick={(e) => { e.preventDefault(); go(step + 1); }}>{t('Endelea →')}</Button>
            : <Button key="submit" type="submit" busy={busy}>{submitLabel}</Button>}
        </div>
      </div>
    </form>
  );
}

/** Futa rasimu baada ya kusajili. */
export const clearMemberDraft = () => writeDraft(null);

export function MemberNew() {
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <>
      <PageHead title="Sajili mwanachama" sub="Weka namba ya uanachama aliyonayo, au acha wazi ili mfumo utoe mpya" />
      <MemberForm submitLabel="Sajili mwanachama" busy={busy} error={error}
        onSubmit={async (p, photo) => {
          const r = await run(async () => {
            const res = await api<{ member: Member }>('/members', { method: 'POST', body: p });
            // Picha ni ya hiari: ikishindwa kupakia, mkulima amesajiliwa na picha inaweza kuwekwa baadaye
            if (photo) await api(`/members/${res.member.id}/photo`, { method: 'PUT', body: { mimeType: photo.mimeType, data: photo.data } }).catch(() => undefined);
            return res;
          });
          if (r) { clearMemberDraft(); nav(`/members/${r.member.id}`); }
        }} />
    </>
  );
}
