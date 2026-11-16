// =====================================================================
//  TAFUTA KILA KITU (v2) — Ctrl K / ⌘K au kitufe cha "Tafuta" kwenye menyu
//   - kurasa unazoruhusiwa kuziona (kutoka menyu ile ile — hakuna orodha ya pili)
//   - wakulima kwa jina / namba / simu (ruhusa ya members.read inakaguliwa na backend)
// =====================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useT } from '../lib/prefs';
import type { Paged } from '../lib/api';
import type { MemberLite } from './ui';
import { Icon } from './icons';

export interface PaletteItem { to: string; label: string; section?: string; icon: ReactNode }

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({ open, onClose, pages, members }: { open: boolean; onClose: () => void; pages: PaletteItem[]; members: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setDq(''); setSel(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  useEffect(() => { const h = setTimeout(() => setDq(q.trim()), 220); return () => clearTimeout(h); }, [q]);
  const m = useFetch<Paged<MemberLite>>(open && members && dq.length >= 2 ? '/members/lookup' : null, { search: dq, pageSize: 6 });
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pageHits = useMemo(() => {
    const n = norm(q.trim());
    const seen = new Set<string>();
    return pages.filter((p) => (seen.has(p.to) ? false : (seen.add(p.to), true)))
      .filter((p) => !n || norm(`${t(p.label)} ${p.section ? t(p.section) : ''}`).includes(n)).slice(0, n ? 8 : 10);
  }, [pages, q, t]);
  const rows: { key: string; to: string; label: ReactNode; sub?: string; icon: ReactNode }[] = [
    ...(m.data?.data ?? []).map((x) => ({ key: `m${x.id}`, to: `/members/${x.id}`, label: `${x.firstName} ${x.lastName}`, sub: `${x.memberNo}${x.village ? ` · ${x.village}` : ''}`, icon: <Icon name="user" /> })),
    ...pageHits.map((p) => ({ key: p.to, to: p.to, label: t(p.label), sub: p.section ? t(p.section) : undefined, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.icon}</svg> })),
  ];
  useEffect(() => setSel(0), [dq, q]);
  if (!open) return null;
  const go = (to: string) => { onClose(); nav(to); };
  return (
    <div className="cmdk-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t('Tafuta')}>
        <div className="cmdk-in">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={members ? t('Tafuta mkulima au ukurasa…') : t('Tafuta ukurasa…')}
            aria-label={t('Tafuta')} role="combobox" aria-expanded="true" aria-controls="cmdk-list"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter' && rows[sel]) go(rows[sel].to);
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmdk-list" className="cmdk-list" role="listbox">
          {m.loading && dq.length >= 2 && <li className="cmdk-hint">{t('Inatafuta wakulima…')}</li>}
          {rows.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === sel}>
              <button type="button" className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => go(r.to)}>
                <span className="cmdk-ic">{r.icon}</span>
                <span className="cmdk-t">{r.label}{r.sub && <small>{r.sub}</small>}</span>
                <Icon name="chevronRight" className="cmdk-go" />
              </button>
            </li>
          ))}
          {!rows.length && <li className="cmdk-hint">{t('Hakuna kinacholingana.')}</li>}
        </ul>
        <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t('chagua')}</span><span><kbd>Enter</kbd> {t('fungua')}</span><span><kbd>Ctrl</kbd><kbd>K</kbd> {t('popote')}</span></div>
      </div>
    </div>
  );
}
