// =====================================================================
//  MKOA → WILAYA → KATA (v2.5) — vinachaguliwa kwenye orodha rasmi, si kuandikwa
//   - Orodha inapakuliwa mara moja kutoka /api/v1/public/locations (ina cache ya siku 1)
//   - Kila sehemu ni orodha yenye kutafuta (andika herufi chache → chagua), inafanya kazi kwa kibodi
//   - Ukibadili mkoa, wilaya na kata zinafutwa; ukibadili wilaya, kata inafutwa
//   - Thamani ya zamani isiyo kwenye orodha inaonyeshwa ili mtumiaji aichague upya
//   Backend nayo inakataa thamani isiyo kwenye orodha (src/lib/locations.ts).
// =====================================================================
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../lib/prefs';
import { Icon } from './icons';

export interface TzLocations { regions: { name: string; districts: { name: string; wards: string[] }[] }[] }
let cache: Promise<TzLocations> | null = null;
export function loadLocations() {
  cache ??= fetch('/api/v1/public/locations').then((r) => { if (!r.ok) throw new Error('locations'); return r.json(); }).catch((e) => { cache = null; throw e; });
  return cache;
}
export function useLocations() {
  const [d, setD] = useState<TzLocations | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let on = true; loadLocations().then((x) => on && setD(x)).catch(() => on && setErr(true)); return () => { on = false; }; }, []);
  return { data: d, error: err };
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'");

/** Orodha ya kuchagua yenye kutafuta (combobox). Thamani lazima itoke kwenye `options`. */
export function ComboSelect({ label, value, options, onChange, placeholder, disabled, help, sub, required, unknownNote, allowCustom }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
  placeholder?: string; disabled?: boolean; help?: string; sub?: (o: string) => string | undefined; required?: boolean; unknownNote?: string;
  /** v2.9: orodha ni mapendekezo — mtumiaji anaweza kuongeza jina lisilo kwenye orodha (mf. kijiji) */
  allowCustom?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const hits = useMemo(() => {
    const n = fold(q.trim());
    if (!n) return options;
    const starts = options.filter((o) => fold(o).startsWith(n));
    return [...starts, ...options.filter((o) => !starts.includes(o) && fold(o).includes(n))];
  }, [options, q]);
  const typed = q.trim().replace(/\s+/g, ' ');
  const customQ = allowCustom && typed.length >= 2 && !options.some((o) => fold(o) === fold(typed)) ? typed.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : null;
  const all = customQ ? [...hits, customQ] : hits;
  const known = allowCustom || !value || options.some((o) => fold(o) === fold(value));

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 300 && r.top > below;
    setPos({ left: r.left, width: Math.max(r.width, 240), top: up ? r.top - 6 : r.bottom + 6, up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { const n = e.target as Node; if (!pop.current?.contains(n) && !btn.current?.contains(n)) setOpen(false); };
    const re = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', re); window.addEventListener('scroll', re, true);
    setTimeout(() => input.current?.focus(), 10);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const choose = (o: string) => { onChange(o); setOpen(false); setQ(''); btn.current?.focus(); };
  const openIt = () => { if (disabled) return; const i = options.findIndex((o) => o === value); setQ(''); setSel(Math.max(0, i)); setOpen(true); };

  return (
    <div className="field">
      <label htmlFor={id}>{t(label)}{required && ' *'}</label>
      <button ref={btn} id={id} type="button" className={`input cbx-btn ${!value ? 'cbx-empty' : ''} ${!known ? 'cbx-unknown' : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openIt())}
        onKeyDown={(e) => { if (['ArrowDown', 'Enter', ' '].includes(e.key) && !open) { e.preventDefault(); openIt(); } else if (e.key.length === 1 && /\S/.test(e.key) && !open) { openIt(); setQ(e.key); } }}>
        <span>{value || t(placeholder ?? 'Chagua…')}</span>
        <Icon name="chevronDown" className="cbx-chev" />
      </button>
      {!known && <span className="help cbx-warn">{t(unknownNote ?? 'Haipo kwenye orodha rasmi — chagua upya')}</span>}
      {help && known && <span className="help">{t(help)}</span>}
      {open && pos && createPortal(
        <div ref={pop} className={`cbx-pop ${pos.up ? 'up' : ''}`} style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}>
          <div className="cbx-search">
            <Icon name="search" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Tafuta {x}…', { x: t(label).toLowerCase() })}
              role="combobox" aria-expanded="true" aria-controls={`${id}-l`} aria-autocomplete="list"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                else if (e.key === 'Enter') { e.preventDefault(); if (all[sel]) choose(all[sel]); }
                else if (e.key === 'Tab') setOpen(false);
              }} />
            <small>{hits.length}</small>
          </div>
          <ul ref={list} id={`${id}-l`} role="listbox" className="cbx-list">
            {hits.map((o, i) => (
              <li key={o} data-i={i} role="option" aria-selected={o === value}
                className={`${i === sel ? 'on' : ''} ${o === value ? 'cur' : ''}`}
                onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
                <span>{o}</span>{sub?.(o) && <small>{sub(o)}</small>}{o === value && <Icon name="check" className="cbx-ok" />}
              </li>
            ))}
            {customQ && (
              <li data-i={hits.length} role="option" aria-selected={false} className={`cbx-add ${sel === hits.length ? 'on' : ''}`}
                onMouseEnter={() => setSel(hits.length)} onMouseDown={(e) => { e.preventDefault(); choose(customQ); }}>
                <span>+ {t('Ongeza')} "<b>{customQ}</b>"</span><small>{t('halipo kwenye orodha')}</small>
              </li>
            )}
            {!hits.length && !customQ && <li className="cbx-none">{t('Hakuna kinacholingana na "{q}"', { q })}</li>}
          </ul>
        </div>, document.body,
      )}
    </div>
  );
}

export interface LocValue { region: string; district: string; ward?: string; village?: string }

/** Mkoa → Wilaya → (Kata). Weka ndani ya `.form-grid`. `levels=2` = mkoa na wilaya tu. */
export function LocationFields({ value, onChange, levels = 3, disabled, requireDistrict, withVillage }: {
  value: LocValue; onChange: (v: LocValue) => void; levels?: 2 | 3; disabled?: boolean; requireDistrict?: boolean;
  /** v2.9: kijiji/mtaa kinapendekezwa kutoka orodha ya kata (unaweza kuongeza kisicho kwenye orodha) */
  withVillage?: boolean;
}) {
  const t = useT();
  const { data, error } = useLocations();
  const f = (s: string) => fold(s.trim());
  const region = data?.regions.find((r) => f(r.name) === f(value.region));
  const district = region?.districts.find((d) => f(d.name) === f(value.district));
  // Herufi za zamani (mf. "TABORA" au "urambo") zinasawazishwa kimya kimya zikilingana na orodha
  useEffect(() => {
    if (!data) return;
    const next = { ...value };
    if (region && region.name !== value.region) next.region = region.name;
    if (district && district.name !== value.district) next.district = district.name;
    const w = district?.wards.find((x) => f(x) === f(value.ward ?? ''));
    if (levels === 3 && w && w !== value.ward) next.ward = w;
    if (next.region !== value.region || next.district !== value.district || next.ward !== value.ward) onChange(next);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const ward = district?.wards.find((x) => f(x) === f(value.ward ?? ''));
  const vils = useVillages(withVillage && region && district && ward ? { region: region.name, district: district.name, ward } : null);
  if (error) return <div className="field"><span className="help cbx-warn">{t('Orodha ya maeneo haikupakia — onyesha ukurasa upya.')}</span></div>;
  const loading = !data;
  return (
    <>
      <ComboSelect label="Mkoa" value={value.region} disabled={disabled || loading} placeholder={loading ? 'Inapakia…' : 'Chagua mkoa'}
        options={data?.regions.map((r) => r.name) ?? []} sub={(o) => `${t('wilaya')} ${data?.regions.find((r) => r.name === o)?.districts.length ?? ''}`}
        onChange={(r) => onChange({ region: r, district: '', ...(levels === 3 ? { ward: '' } : {}), ...(withVillage ? { village: '' } : {}) })} />
      <ComboSelect label="Wilaya" required={requireDistrict} value={value.district} disabled={disabled || loading || !region}
        placeholder={region ? 'Chagua wilaya' : 'Chagua mkoa kwanza'} options={region?.districts.map((d) => d.name) ?? []}
        sub={(o) => `${t('kata')} ${region?.districts.find((d) => d.name === o)?.wards.length ?? ''}`}
        onChange={(d) => onChange({ ...value, district: d, ...(levels === 3 ? { ward: '' } : {}), ...(withVillage ? { village: '' } : {}) })} />
      {levels === 3 && (
        <ComboSelect label="Kata" value={value.ward ?? ''} disabled={disabled || loading || !district}
          placeholder={district ? 'Chagua kata' : 'Chagua wilaya kwanza'} options={district?.wards ?? []}
          onChange={(w) => onChange({ ...value, ward: w, ...(withVillage ? { village: '' } : {}) })} />
      )}
      {withVillage && (
        <ComboSelect label="Kijiji / mtaa" allowCustom value={value.village ?? ''} disabled={disabled}
          placeholder={ward ? (vils.length ? 'Chagua au andika kijiji' : 'Andika jina la kijiji') : 'Chagua kata kwanza (au andika)'} options={vils}
          onChange={(v) => onChange({ ...value, village: v })} />
      )}
    </>
  );
}

/** Vijiji vya kata moja (cache ya kivinjari kwa kila kata) */
const vilCache = new Map<string, Promise<string[]>>();
export function useVillages(w: { region: string; district: string; ward: string } | null) {
  const [list, setList] = useState<string[]>([]);
  const k = w ? `${w.region}|${w.district}|${w.ward}` : '';
  useEffect(() => {
    if (!w) { setList([]); return; }
    let on = true;
    if (!vilCache.has(k)) {
      vilCache.set(k, fetch(`/api/v1/public/locations/villages?${new URLSearchParams(w)}`).then((r) => r.json()).then((j) => (j.villages ?? []) as string[]).catch(() => { vilCache.delete(k); return []; }));
    }
    vilCache.get(k)!.then((x) => on && setList(x));
    return () => { on = false; };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}
