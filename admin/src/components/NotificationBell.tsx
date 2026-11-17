// =====================================================================
//  KENGELE YA ARIFA (v2.2) — ujumbe kutoka CoopLink kwa mtumishi wa chama
//   - matangazo ya Owner (Marketing & Communication → "Ndani ya mfumo")
//   - majibu ya timu ya CoopLink kwenye tiketi za msaada
//  "Imesomwa" inahifadhiwa kwenye server (kila mtumiaji), si kwenye kivinjari.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useT } from '../lib/prefs';
import { dateTime } from '../lib/format';
import { Icon, type IconName } from './icons';
import { LogoMark } from './Logo';

export interface Notif {
  type: 'ANNOUNCEMENT' | 'SUPPORT' | 'RECEIPT' | 'STOCK'; id: string; kind: string; title: string; body: string; at: string; unread: boolean;
  author?: string | null; status?: string;
}
const KIND: Record<string, { label: string; icon: IconName; tone: string }> = {
  ANNOUNCEMENT: { label: 'Tangazo', icon: 'megaphone', tone: 'gold' },
  SYSTEM_UPDATE: { label: 'Toleo jipya', icon: 'sparkle', tone: 'green' },
  EXPIRY_REMINDER: { label: 'Kumbusho la ada', icon: 'card', tone: 'red' },
  MARKETING: { label: 'Habari', icon: 'megaphone', tone: 'blue' },
  SUPPORT: { label: 'Jibu la msaada', icon: 'inbox', tone: 'blue' },
  FEE_RECEIPT: { label: 'Risiti ya CoopLink', icon: 'receipt', tone: 'green' },
  STOCK_OUT: { label: 'Stoo imeisha', icon: 'inputs', tone: 'red' },
  STOCK_LOW: { label: 'Stoo ndogo', icon: 'inputs', tone: 'gold' },
  STOCK_SOON: { label: 'Inakaribia kuisha', icon: 'inputs', tone: 'gold' },
};
const POLL_MS = 90_000;

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'sasa hivi';
  if (s < 3600) return `dakika ${Math.floor(s / 60)} zilizopita`;
  if (s < 86400) return `saa ${Math.floor(s / 3600)} zilizopita`;
  if (s < 7 * 86400) return `siku ${Math.floor(s / 86400)} zilizopita`;
  return dateTime(iso);
}

export function NotificationBell() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'ALL' | 'ANNOUNCEMENT' | 'SUPPORT' | 'RECEIPT' | 'STOCK'>('ALL');
  const [view, setView] = useState<Notif | null>(null);
  const [toast, setToast] = useState<Notif | null>(null);
  const [ring, setRing] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<{ items: Notif[]; unread: number }>('/notifications').then((r) => {
      setItems(r.items);
      // Ujumbe mpya ulioingia tangu mara ya mwisho -> kengele inatikisika + dirisha dogo
      const unread = r.items.filter((i) => i.unread);
      if (seen.current) {
        const fresh = unread.find((i) => !seen.current!.has(`${i.type}:${i.id}:${i.at}`));
        if (fresh) { setToast(fresh); setRing(true); setTimeout(() => setRing(false), 1600); }
      } else if (unread.length) { setRing(true); setTimeout(() => setRing(false), 1600); }
      seen.current = new Set(r.items.map((i) => `${i.type}:${i.id}:${i.at}`));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);
  // Ukirudi kutoka kwenye tiketi, hali ya "imesomwa" isomwe upya
  useEffect(() => { if (!loc.pathname.startsWith('/support/')) return; const h = setTimeout(load, 800); return () => clearTimeout(h); }, [loc.pathname, load]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 9000); return () => clearTimeout(h); }, [toast]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const unread = items.filter((i) => i.unread).length;
  const shown = items.filter((i) => tab === 'ALL' || i.type === tab);
  const markRead = (n: Notif) => setItems((xs) => xs.map((x) => (x.type === n.type && x.id === n.id ? { ...x, unread: false } : x)));

  const openItem = (n: Notif) => {
    setOpen(false); setToast(null);
    if (n.type === 'SUPPORT') { markRead(n); nav(`/support/${n.id}`); return; }
    if (n.type === 'STOCK') {
      if (n.unread) { markRead(n); void api(`/notifications/stock/${n.id}/read`, { method: 'POST' }).catch(() => {}); }
      nav('/inputs?f=attention'); return;
    }
    if (n.type === 'RECEIPT') {
      if (n.unread) { markRead(n); void api(`/notifications/receipts/${n.id}/read`, { method: 'POST' }).catch(() => {}); }
      nav(`/billing/receipts/${n.id}`); return;
    }
    setView(n);
    if (n.unread) { markRead(n); void api(`/notifications/announcements/${n.id}/read`, { method: 'POST' }).catch(() => {}); }
  };
  const readAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, unread: false })));
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
  };

  return (
    <div className="nb" ref={box}>
      <button type="button" className={`nb-btn ${ring ? 'ring' : ''} ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? t('Arifa ({n} mpya)', { n: unread }) : t('Arifa')} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {!!unread && <span className="nb-count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label={t('Arifa')}>
          <div className="nb-head">
            <div><b>{t('Arifa')}</b><small>{unread ? t('{n} hazijasomwa', { n: unread }) : t('Zote zimesomwa')}</small></div>
            {!!unread && <button type="button" className="nb-link" onClick={readAll}>{t('Weka zote zimesomwa')}</button>}
          </div>
          <div className="nb-tabs" role="tablist">
            {([['ALL', 'Zote'], ['ANNOUNCEMENT', 'Kutoka CoopLink'], ['SUPPORT', 'Tiketi'], ['RECEIPT', 'Risiti'], ['STOCK', 'Stoo']] as const)
              .filter(([k]) => (k !== 'RECEIPT' && k !== 'STOCK') || items.some((i) => i.type === k)).map(([k, l]) => {
              const n = items.filter((i) => i.unread && (k === 'ALL' || i.type === k)).length;
              return <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}{!!n && <em>{n}</em>}</button>;
            })}
          </div>
          <ul className="nb-list">
            {shown.map((n) => {
              const k = KIND[n.kind] ?? KIND.ANNOUNCEMENT;
              return (
                <li key={`${n.type}${n.id}`}>
                  <button type="button" className={n.unread ? 'unread' : ''} onClick={() => openItem(n)}>
                    <span className={`stat-chip chip-${k.tone}`}><Icon name={k.icon} /></span>
                    <span className="nb-t">
                      <span className="nb-meta">{t(k.label)} · {ago(n.at)}</span>
                      <b>{n.title}</b>
                      {n.body && <span className="nb-snip">{n.type === 'SUPPORT' ? `${n.author ? `${n.author} · ` : ''}Timu ya CoopLink: ` : ''}{n.body}</span>}
                    </span>
                    {n.unread && <span className="nb-dot" aria-label={t('Mpya')} />}
                  </button>
                </li>
              );
            })}
            {!shown.length && (
              <li className="nb-empty"><span className="stat-chip chip-green"><Icon name="bell" /></span><p>{t('Hakuna arifa kwa sasa.')}<small>{t('Ujumbe kutoka timu ya CoopLink utaonekana hapa.')}</small></p></li>
            )}
          </ul>
          <button type="button" className="nb-foot" onClick={() => { setOpen(false); nav('/support'); }}>
            <Icon name="inbox" />{t('Tiketi zangu za msaada')}<Icon name="chevronRight" />
          </button>
        </div>
      )}

      {toast && !open && createPortal(
        <div className="nb-toast" role="status">
          <span className="nb-toast-logo"><LogoMark size={30} ring={false} /></span>
          <span className="nb-t"><span className="nb-meta">{toast.type === 'RECEIPT' ? t('Risiti mpya ya malipo') : toast.type === 'STOCK' ? t('Tahadhari ya stoo') : t('Ujumbe mpya kutoka CoopLink')}</span><b>{toast.title}</b></span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openItem(toast)}>{toast.type === 'RECEIPT' ? t('Fungua risiti') : toast.type === 'STOCK' ? t('Angalia stoo') : t('Soma')}</button>
          <button type="button" className="nb-x" aria-label={t('Funga')} onClick={() => setToast(null)}>×</button>
        </div>, document.body,
      )}

      {view && createPortal(<MessageView n={view} onClose={() => setView(null)} />, document.body)}
    </div>
  );
}

/** Ujumbe kamili kutoka CoopLink — muonekano rasmi wenye nembo */
function MessageView({ n, onClose }: { n: Notif; onClose: () => void }) {
  const t = useT();
  const k = KIND[n.kind] ?? KIND.ANNOUNCEMENT;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="nb-modal-bg" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <article className="nb-modal" role="dialog" aria-modal="true" aria-labelledby="nb-mt">
        <header className="nb-mh">
          <span className="nb-mh-logo"><LogoMark size={40} ring={false} /></span>
          <span className="nb-mh-from"><b>{t('Timu ya CoopLink')}</b><small>{dateTime(n.at)}</small></span>
          <span className={`nb-kind chip-${k.tone}`}><Icon name={k.icon} />{t(k.label)}</span>
          <button type="button" className="nb-x light" aria-label={t('Funga')} onClick={onClose}>×</button>
        </header>
        <div className="nb-mb">
          <h2 id="nb-mt">{n.title}</h2>
          <div className="nb-body">{n.body}</div>
        </div>
        <footer className="nb-mf">
          <small>{t('Ujumbe huu umetumwa na timu ya CoopLink kupitia mfumo.')}</small>
          <button type="button" className="btn btn-primary" onClick={onClose}>{t('Sawa, nimesoma')}</button>
        </footer>
      </article>
    </div>
  );
}
