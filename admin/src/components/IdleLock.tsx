// =====================================================================
//  SKRINI YA KUFUNGA (kama mifumo ya benki)
//   Mtumishi asipotumia mfumo kwa dakika IDLE_MIN, skrini yenye chapa ya COOPLINK inafunika kila kitu.
//   Kufungua: nenosiri (+2FA kama imewashwa) — linahakikiwa kwenye server (/auth/unlock).
//   Hali ya kufungwa inashirikiwa kwenye tab zote za kivinjari, na inabaki hata ukurasa ukisomwa upya.
// =====================================================================
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/prefs';
import { LogoMark } from './Logo';
import { K_ACT, K_LOCK, lsGet, lsPut, markActive } from '../lib/session';

export const IDLE_MIN = 5;
const IDLE_MS = IDLE_MIN * 60_000;
const get = lsGet;
const put = lsPut;

function isIdle() {
  const last = Number(get(K_ACT) || 0);
  return get(K_LOCK) === '1' || (last > 0 && Date.now() - last > IDLE_MS);
}

export function IdleLock({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(isIdle);
  const lastWrite = useRef(0);

  const lock = useCallback(() => { put(K_LOCK, '1'); setLocked(true); }, []);
  useEffect(() => {
    if (!get(K_ACT)) put(K_ACT, String(Date.now()));
    const activity = () => {
      if (get(K_LOCK) === '1') return;
      const now = Date.now();
      if (now - lastWrite.current > 5000) { lastWrite.current = now; put(K_ACT, String(now)); }
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    evs.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    const tick = setInterval(() => { if (isIdle()) lock(); }, 10_000);
    const vis = () => { if (document.visibilityState === 'visible' && isIdle()) lock(); };
    document.addEventListener('visibilitychange', vis);
    // tab nyingine ikifunga / kufungua, hii inafuata
    const sync = (e: StorageEvent) => { if (e.key === K_LOCK) setLocked(e.newValue === '1'); };
    window.addEventListener('storage', sync);
    return () => { evs.forEach((e) => window.removeEventListener(e, activity)); clearInterval(tick); document.removeEventListener('visibilitychange', vis); window.removeEventListener('storage', sync); };
  }, [lock]);

  return (
    <>
      <div aria-hidden={locked} style={locked ? { visibility: 'hidden' } : undefined}>{children}</div>
      {locked && <LockScreen onUnlock={() => { markActive(); setLocked(false); }} />}
    </>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { user, logout } = useAuth();
  const t = useT();
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [need2fa, setNeed2fa] = useState(!!user?.totpEnabled);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(i); }, []);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api('/auth/unlock', { method: 'POST', body: { confirmPassword: pw, confirmCode: code || undefined } });
      onUnlock();
    } catch (x) {
      const ex = x as ApiError;
      if (ex.code === 'REAUTH_LOCKED') { await logout(); return; }
      if (/2FA/.test(ex.message)) setNeed2fa(true);
      setErr(ex.message); setPw('');
    } finally { setBusy(false); }
  };
  if (!user) return null;
  const time = now.toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label={t('Mfumo umefungwa')}>
      <div className="lock-bg" /><div className="lock-sh" />
      <div className="lock-brand"><LogoMark size={44} animate /><span><b>Coop<i>Link</i></b><small>COOPERATIVE MANAGEMENT SYSTEM</small></span></div>
      <div className="lock-side">
        <div className="lock-time">{time}</div>
        <div className="lock-day">{day}</div>
        <h2>Connecting Cooperatives.<em>Empowering Farmers</em></h2>
      </div>
      <form className="lock-card" onSubmit={submit}>
        <div className="lock-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg></div>
        <span className="lock-av">{user.fullName.charAt(0)}</span>
        <strong className="lock-name">{user.fullName}</strong>
        <p className="lock-msg">{t('Kwa usalama, mfumo umefungwa baada ya dakika {n} bila kutumika. Weka nenosiri lako kuendelea.', { n: IDLE_MIN })}</p>
        {err && <div className="lock-err">{err}</div>}
        <input className="input" type="password" autoComplete="current-password" placeholder={t('Nenosiri')} value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
        {need2fa && <input className="input" inputMode="numeric" maxLength={6} placeholder={t('Msimbo wa 2FA')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
        <button type="submit" className="btn btn-primary lock-go" disabled={busy || !pw}>{busy ? '…' : t('Fungua mfumo')}</button>
        <button type="button" className="lock-out" onClick={() => void logout()}>{t('Si wewe? Toka')}</button>
      </form>
    </div>
  );
}
