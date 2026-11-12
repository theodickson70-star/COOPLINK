// =====================================================================
//  SIMU: menyu ya chini (bottom nav), menyu ya mtumiaji, na majedwali yanayogeuka kadi
//   Kwenye kompyuta hakuna kinachobadilika — vipengele hivi vinaonekana tu kwenye skrini ndogo (CSS).
// =====================================================================
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../lib/prefs';

export interface BottomItem { to: string; label: string; icon: ReactNode; badge?: number }

/** Menyu ya chini ya simu: vitu 4 vikuu vya cheo + "Zaidi" (inafungua menyu kamili) */
export function BottomNav({ items, onMore }: { items: BottomItem[]; onMore: () => void }) {
  const t = useT();
  return (
    <nav className="bottom-nav" aria-label={t('Menyu ya haraka')}>
      {items.slice(0, 4).map((it) => (
        <NavLink key={it.to} to={it.to} end={it.to === '/'} className="bn-item">
          <span className="bn-ic">{it.icon}{!!it.badge && <span className="bn-badge">{it.badge > 99 ? '99+' : it.badge}</span>}</span>
          <span className="bn-lbl">{t(it.label)}</span>
        </NavLink>
      ))}
      <button type="button" className="bn-item" onClick={onMore}>
        <span className="bn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg></span>
        <span className="bn-lbl">{t('Zaidi')}</span>
      </button>
    </nav>
  );
}

/** Menyu ndogo ya mtumiaji (simu): jina, mwonekano, lugha, mwongozo, kutoka */
export function UserSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const loc = useLocation();
  useEffect(() => { if (open) onClose(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <button type="button" className="sheet-scrim" aria-label="Funga" onClick={onClose} />
      <div className="user-sheet" role="dialog">{children}</div>
    </>
  );
}

const SKIP = ['fin-table', 'est-table', 'bale-entry', 'stack-sm', 'keep-table'];
/**
 * Majedwali kwenye simu: kila seli inapewa jina la safu yake (data-label) ili CSS iyaonyeshe kama kadi.
 * Inafanya kazi kwa majedwali yote ya kawaida (.table) bila kubadilisha kila ukurasa.
 */
export function useTableCards(root: RefObject<HTMLElement | null>) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick((x) => x + 1)); });
    mo.observe(el, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [root]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll<HTMLTableElement>('table.table').forEach((tb) => {
      if (SKIP.some((c) => tb.classList.contains(c))) return;
      const heads = [...tb.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());
      if (!heads.length) return;
      tb.classList.add('tbl-cards');
      tb.querySelectorAll('tbody tr').forEach((tr) => {
        let i = 0;
        tr.querySelectorAll(':scope > td').forEach((td) => {
          const cell = td as HTMLTableCellElement;
          const lbl = cell.colSpan > 1 ? '' : heads[i] ?? '';
          if (cell.getAttribute('data-label') !== lbl) cell.setAttribute('data-label', lbl);
          i += cell.colSpan || 1;
        });
      });
    });
  }, [tick, root]);
}
