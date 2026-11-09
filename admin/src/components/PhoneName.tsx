// =====================================================================
//  NAMBA YA SIMU -> JINA (Abliner Name Lookup)
//  Mtumiaji anaandika namba ya simu tu; jina linajitokeza lenyewe kutoka usajili wa mobile money
//  na haliwezi kuhaririwa. Huduma ikiwa haipo/haipatikani kwa muda, jina linaandikwa (ili kazi isisimame).
// =====================================================================
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TextField } from './ui';

export interface NameParts { firstName: string; middleName: string | null; lastName: string }
interface LookupRes { enabled: boolean; status: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE' | 'DISABLED' | 'INVALID'; phone: string; name?: string; network?: string | null; firstName?: string; middleName?: string | null; lastName?: string }
export type NameState = 'empty' | 'typing' | 'loading' | 'found' | 'not_found' | 'manual';

const cache = new Map<string, LookupRes>();
/** 0712345678 / 712345678 / +255712345678 -> 0712345678 (au null) */
export function localPhone(v: string) {
  let d = v.replace(/[^\d]/g, '');
  if (d.startsWith('255') && d.length === 12) d = '0' + d.slice(3);
  else if (d.length === 9) d = '0' + d;
  return /^0[67]\d{8}$/.test(d) ? d : null;
}

/** Hali ya jina kwa namba hii. */
export function usePhoneName(phone: string) {
  const p = localPhone(phone ?? '');
  const [res, setRes] = useState<LookupRes | null>(p ? cache.get(p) ?? null : null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!p) { setRes(null); setLoading(false); return; }
    const hit = cache.get(p);
    if (hit) { setRes(hit); setLoading(false); return; }
    let live = true;
    setLoading(true); setRes(null);
    const t = setTimeout(async () => {
      try {
        const r = await api<LookupRes>('/lookup/name', { query: { phone: p } });
        if (r.status === 'FOUND' || r.status === 'NOT_FOUND') cache.set(p, r);
        if (live) setRes(r);
      } catch {
        if (live) setRes({ enabled: true, status: 'UNAVAILABLE', phone: p });
      } finally { if (live) setLoading(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [p]);
  const state: NameState = !phone?.trim() ? 'empty' : !p ? 'typing' : loading ? 'loading'
    : res?.status === 'FOUND' ? 'found' : res?.status === 'NOT_FOUND' ? 'not_found'
    : res && (res.status === 'DISABLED' || res.status === 'UNAVAILABLE') ? 'manual' : 'loading';
  const parts: NameParts | null = res?.status === 'FOUND' && res.firstName && res.lastName ? { firstName: res.firstName, middleName: res.middleName ?? null, lastName: res.lastName } : null;
  return { state, name: res?.status === 'FOUND' ? res.name ?? '' : '', parts, network: res?.network ?? null, locked: state !== 'empty' && state !== 'manual' };
}

/**
 * Ujumbe mdogo chini ya jina: unaonekana tu panapohitajika hatua ya mtumiaji.
 * Jina likipatikana linajijaza kimya kimya (bila maneno ya kuthibitisha).
 */
export function NameNote({ state, emptyHint }: { state: NameState; network?: string | null; emptyHint?: string }) {
  if (state === 'not_found') return <p className="name-note bad">Namba hii haijasajiliwa kwenye mobile money — jina haliwezi kupatikana. Hakikisha namba ni sahihi.</p>;
  if (state === 'manual') return <p className="name-note warn">Huduma ya majina haipatikani kwa sasa — andika jina kamili.</p>;
  if (state === 'empty' && emptyHint) return <p className="name-note">{emptyHint}</p>;
  return null;
}

/**
 * Sehemu mbili: namba ya simu + jina (linajitokeza lenyewe).
 * `onName` inaitwa jina likipatikana; mzazi anahifadhi jina kwenye fomu yake.
 */
export function PhoneNameFields({ phoneLabel = 'Namba ya simu *', nameLabel = 'Jina kamili', phone, onPhone, name, onName, phoneHelp, emptyHint = 'Jina litajitokeza lenyewe ukiweka namba ya simu', optionalPhone = false, autoFocus }: {
  phoneLabel?: string; nameLabel?: string; phone: string; onPhone: (v: string) => void; name: string; onName: (v: string, parts: NameParts | null) => void;
  phoneHelp?: string; emptyHint?: string; optionalPhone?: boolean; autoFocus?: boolean;
}) {
  const r = usePhoneName(phone);
  useEffect(() => {
    if (r.state === 'found' && r.name !== name) onName(r.name, r.parts);
    else if ((r.state === 'not_found' || r.state === 'typing') && name) onName('', null);
  }, [r.state, r.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = r.state === 'manual' || (optionalPhone && r.state === 'empty');
  return (
    <>
      <TextField label={phoneLabel} type="tel" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={onPhone} help={phoneHelp} autoFocus={autoFocus} />
      <div className={!editable ? 'locked-field' : undefined}>
        <TextField label={nameLabel} value={editable ? name : r.state === 'found' ? r.name : ''} onChange={(v) => onName(v, null)}
          readOnly={!editable} tabIndex={!editable ? -1 : undefined}
          placeholder={editable ? 'Andika jina kamili' : r.state === 'loading' ? 'Inatafuta…' : '—'} />
        <NameNote state={r.state} network={r.network} emptyHint={optionalPhone ? undefined : emptyHint} />
      </div>
    </>
  );
}

/** Jina la mtu ambaye namba yake haibadiliki hapa (mf. kuhariri mtumishi): linatoka mobile money, halihaririwi. */
export function LockedNameField({ label = 'Jina kamili', phone, value, onChange }: { label?: string; phone: string; value: string; onChange: (v: string) => void }) {
  const r = usePhoneName(phone);
  useEffect(() => { if (r.state === 'found' && r.name !== value) onChange(r.name); }, [r.state, r.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const editable = r.state === 'manual' || r.state === 'empty';
  return (
    <div className={!editable ? 'locked-field' : undefined}>
      <TextField label={label} value={r.state === 'found' ? r.name : value} onChange={onChange} readOnly={!editable} tabIndex={!editable ? -1 : undefined} />
      <NameNote state={r.state} network={r.network} />
    </div>
  );
}
