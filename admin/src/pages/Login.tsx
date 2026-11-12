import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, useAuth, type User } from '../lib/auth';
import { api } from '../lib/api';
import { playTone, unlockAudio } from '../lib/tone';
import { LegalLinks } from '../components/LegalLinks';
import { LogoMark } from '../components/Logo';
import { Alert, Button, TextField } from '../components/ui';
import { PrefSwitches, useT } from '../lib/prefs';

// Picha za mzunguko mzima wa tumbaku: shamba -> kukausha -> daraja -> ghala -> chama -> soko
const SLIDES = [
  { src: '/login/uvunaji.webp', title: 'Uvunaji', text: 'Uvunaji wa tumbaku shambani', pos: '40% center' },
  { src: '/login/shambani.webp', title: 'Shambani', text: 'Makisio sahihi tangu kitalu', pos: '35% center' },
  { src: '/login/kukausha2.webp', title: 'Kukausha', text: 'Kukausha tumbaku (curing)', pos: '55% center' },
  { src: '/login/kukausha.webp', title: 'Kukausha', text: 'Ubora unaoonekana kwenye kila jani', pos: '55% center' },
  { src: '/login/uchambuzi.webp', title: 'Uchambuzi', text: 'Uchambuzi na upangaji wa daraja', pos: '35% center' },
  { src: '/login/ghalani.webp', title: 'Ghalani', text: 'Kila belo linarekodiwa kwa uwazi', pos: '30% center' },
  { src: '/login/ufungashaji.webp', title: 'Ufungashaji', text: 'Ufungashaji na kuhifadhi', pos: '40% center' },
  { src: '/login/chamani.webp', title: 'Chamani', text: 'Mikutano ya Chama cha Ushirika', pos: '60% center' },
  { src: '/login/usafirishaji.webp', title: 'Usafirishaji', text: 'Usafirishaji kwenda sokoni', pos: '50% center' },
];
const SLIDE_MS = 12_000; // kila picha inakaa sekunde 12

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

function AuthHero() {
  const t = useT();
  const [idx, setIdx] = useState(0);
  const reduced = useReducedMotion();

  // Picha zinapakuliwa moja moja: ya sasa na inayofuata tu (si zote 9 kwa mara moja) — ukurasa unafunguka haraka
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => {
    const n = (idx + 1) % SLIDES.length;
    const img = new Image(); img.src = SLIDES[n].src;
    setSeen((x) => (x.has(idx) && x.has(n) ? x : new Set([...x, idx, n])));
  }, [idx]);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [reduced, idx]);

  const s = SLIDES[idx];
  return (
    <section className="auth-hero">
      <div className="hero-slides" aria-hidden="true">
        {SLIDES.map((sl, i) => (
          <div key={sl.src} className={`hero-slide ${i === idx ? 'on' : ''}`}
            style={{ backgroundImage: seen.has(i) ? `url(${sl.src})` : undefined, backgroundPosition: sl.pos }} />
        ))}
      </div>
      <div className="hero-scrim" aria-hidden="true" />

      <div className="hero-brand">
        <LogoMark size={46} animate />
        <div><b>Coop<i>Link</i></b><small>COOPERATIVE MANAGEMENT SYSTEM</small></div>
      </div>
      <div className="hero-head">
        <div className="hero-kicker">{t('KWA VYAMA VYA USHIRIKA TANZANIA')}</div>
        <h2>Connecting Cooperatives.<em>Empowering Farmers</em></h2>
      </div>
      <div className="hero-chips" aria-hidden="true">
        {['Wanachama', 'Pembejeo', 'Mikopo', 'Mauzo', 'Malipo', 'Ripoti'].map((c) => <span key={c}>{t(c)}</span>)}
      </div>

      <div className="hero-caption">
        <p className="sr-only" aria-live="polite">{t(s.title)} · {t(s.text)}</p>
        <div className="hero-dots" role="group" aria-label={t('Chagua picha')}>
          {SLIDES.map((sl, i) => (
            <button key={sl.src} type="button" aria-label={`${t('Picha')} ${i + 1}: ${t(sl.title)}`} aria-pressed={i === idx}
              className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

interface PublicStatus { maintenance: { enabled: boolean; message: string }; banner: { message: string; tone: 'info' | 'warn' } | null; brand: { companyName: string; slogan: string; poweredBy?: string }; sms?: { passwordReset: boolean } }
type Step = 'login' | '2fa' | 'otp' | 'forgot' | 'reset';

/** Hesabu ya sekunde kabla ya kuruhusu kutuma namba upya */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function Login() {
  const { login, verify2fa, verifyOtp } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState('');
  const [remember, setRemember] = useState(true);
  const [totp, setTotp] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wait, setWait] = useCountdown();
  const [status, setStatus] = useState<PublicStatus | null>(null);

  useEffect(() => {
    api<PublicStatus>('/public/status').then(setStatus).catch(() => {});
  }, []);

  const go = (s: Step) => { setStep(s); setCode(''); setError(null); setInfo(null); };
  const done = (u: User) => {
    playTone();
    nav(u.mustChangePassword ? '/change-password' : homeFor(u), { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) {
      setError((err as Error).message);
      if (/Ingia tena|Muda umeisha/.test((err as Error).message)) { setChallenge(null); setStep('login'); }
    } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    void run(async () => {
      if (step === '2fa' && challenge) return done(await verify2fa(challenge, code.trim()));
      if (step === 'otp' && challenge) return done(await verifyOtp(phone.trim(), challenge, code.trim(), remember));
      if (step === 'forgot') {
        const r = await api<{ phoneMasked: string; resendIn: number }>('/auth/password/forgot', { method: 'POST', body: { phone: phone.trim() } });
        setMasked(r.phoneMasked); setWait(r.resendIn); go('reset');
        setInfo(t('Kama namba hii imesajiliwa, SMS yenye namba ya uthibitisho imetumwa.'));
        return;
      }
      if (step === 'reset') {
        if (next !== confirm) throw new Error(t('Nenosiri jipya na uthibitisho havilingani'));
        await api('/auth/password/reset', { method: 'POST', body: { phone: phone.trim(), code: code.trim(), totpCode: totp.trim() || undefined, newPassword: next } });
        setPassword(''); setNext(''); setConfirm(''); setTotp(''); go('login');
        setInfo(t('Nenosiri limebadilishwa. Ingia kwa nenosiri jipya.'));
        return;
      }
      const r = await login(phone.trim(), password);
      if ('twoFactor' in r) { setChallenge(r.challenge); go('2fa'); return; }
      if ('otp' in r) { setChallenge(r.challenge); setMasked(r.phoneMasked); setWait(r.resendIn); go('otp'); return; }
      done(r.user);
    });
  };

  const resend = () => void run(async () => {
    if (step === 'otp' && challenge) {
      const r = await api<{ phoneMasked: string; resendIn: number }>('/auth/login/otp/resend', { method: 'POST', body: { challenge } });
      setWait(r.resendIn); setInfo(t('Namba mpya imetumwa kwa SMS.'));
    } else {
      const r = await api<{ resendIn: number }>('/auth/password/forgot', { method: 'POST', body: { phone: phone.trim() } });
      setWait(r.resendIn); setInfo(t('Namba mpya imetumwa kwa SMS.'));
    }
  });

  const codeField = (
    <>
      <TextField label={t('Namba ya uthibitisho (SMS)')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} required autoFocus />
      <Button variant="ghost" onClick={resend} disabled={wait > 0 || busy}>{wait > 0 ? `${t('Tuma upya baada ya sekunde')} ${wait}` : t('Tuma namba upya')}</Button>
    </>
  );

  return (
    <div className="auth">
      <AuthHero />
      <section className="auth-form">
        <div className="auth-prefs"><PrefSwitches /></div>
        <form className="auth-card" onSubmit={submit}>
          <div className="form-brand"><LogoMark size={36} /><b>Coop<i>Link</i></b></div>
          {status?.maintenance.enabled && <Alert kind="warn"><strong>{t('Matengenezo:')}</strong> {status.maintenance.message}</Alert>}
          {status?.banner && <Alert kind={status.banner.tone === 'warn' ? 'warn' : 'ok'}>{status.banner.message}</Alert>}
          {step === 'login' && (
            <>
              <div>
                <h1>{t('Karibu tena')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Ingia kwa namba yako ya simu na nenosiri.')}</p>
              </div>
              {info && <Alert kind="ok">{info}</Alert>}
              <Alert>{error}</Alert>
              <TextField label={t('Namba ya simu')} type="tel" inputMode="tel" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="0712 345 678" value={phone} onChange={setPhone} required />
              <TextField label={t('Nenosiri')} type={showPw ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={password} onChange={setPassword} required />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)', marginTop: -8 }}>
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> {t('Onyesha nenosiri')}
              </label>
              <Button type="submit" variant="primary" busy={busy} style={{ minHeight: 52 }}>{t('Ingia')}</Button>
              <div className="secure-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>{t('Muunganisho salama')}{status?.sms?.passwordReset ? ` · ${t('OTP kwa SMS')}` : ''}</div>
              {status?.sms?.passwordReset && <Button variant="ghost" onClick={() => go('forgot')}>{t('Umesahau nenosiri?')}</Button>}
            </>
          )}
          {step === '2fa' && (
            <>
              <div>
                <h1>{t('Uthibitisho wa hatua mbili')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Weka msimbo wa tarakimu 6 kutoka kwenye app yako ya Authenticator.')}</p>
              </div>
              <Alert>{error}</Alert>
              <TextField label={t('Msimbo wa 2FA')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} required autoFocus />
              <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6} style={{ minHeight: 48 }}>{t('Thibitisha')}</Button>
              <Button variant="ghost" onClick={() => { setChallenge(null); go('login'); }}>{t('Rudi nyuma')}</Button>
            </>
          )}
          {step === 'otp' && (
            <>
              <div>
                <h1>{t('Thibitisha kwa SMS')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Tumetuma namba ya tarakimu 6 kwa SMS kwenda')} <strong>{masked}</strong>. {t('Inadumu dakika 10.')}</p>
              </div>
              {info && <Alert kind="ok">{info}</Alert>}
              <Alert>{error}</Alert>
              {codeField}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t('Kiamini kifaa hiki kwa siku 30 (usiulizwe tena)')}
              </label>
              <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6} style={{ minHeight: 48 }}>{t('Thibitisha na ingia')}</Button>
              <Button variant="ghost" onClick={() => { setChallenge(null); go('login'); }}>{t('Rudi nyuma')}</Button>
            </>
          )}
          {step === 'forgot' && (
            <>
              <div>
                <h1>{t('Umesahau nenosiri?')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Weka namba ya simu uliyosajiliwa nayo. Tutatuma namba ya uthibitisho kwa SMS.')}</p>
              </div>
              <Alert>{error}</Alert>
              <TextField label={t('Namba ya simu')} type="tel" inputMode="tel" autoComplete="username" placeholder="0712 345 678" value={phone} onChange={setPhone} required autoFocus />
              <Button type="submit" variant="primary" busy={busy} style={{ minHeight: 48 }}>{t('Tuma namba ya uthibitisho')}</Button>
              <Button variant="ghost" onClick={() => go('login')}>{t('Rudi kuingia')}</Button>
            </>
          )}
          {step === 'reset' && (
            <>
              <div>
                <h1>{t('Weka nenosiri jipya')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Namba ya simu:')} <strong>{masked}</strong></p>
              </div>
              {info && <Alert kind="ok">{info}</Alert>}
              <Alert>{error}</Alert>
              {codeField}
              <TextField label={t('Nenosiri jipya')} help={t('Herufi 8 au zaidi, liwe na herufi na namba')} type="password" autoComplete="new-password" value={next} onChange={setNext} required />
              <TextField label={t('Rudia nenosiri jipya')} type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} required />
              <TextField label={t('Msimbo wa 2FA (kama umewasha)')} inputMode="numeric" maxLength={6} value={totp} onChange={(v) => setTotp(v.replace(/\D/g, ''))} />
              <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6} style={{ minHeight: 48 }}>{t('Badilisha nenosiri')}</Button>
              <Button variant="ghost" onClick={() => go('login')}>{t('Rudi kuingia')}</Button>
            </>
          )}
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>
            CoopLink · Powered by <strong>{status?.brand.poweredBy ?? 'DUKALANGU SOLUTION'}</strong><br /><LegalLinks />
          </p>
        </form>
      </section>
    </div>
  );
}

export function ChangePassword() {
  const { changePassword, user, logout } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError(t('Nenosiri jipya na uthibitisho havilingani'));
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      nav(user ? homeFor(user) : '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <AuthHero />
      <section className="auth-form">
        <div className="auth-prefs"><PrefSwitches /></div>
        <form className="auth-card" onSubmit={submit}>
          <div className="form-brand"><LogoMark size={36} /><b>Coop<i>Link</i></b></div>
          <div>
            <h1>{t('Weka nenosiri jipya')}</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {user?.mustChangePassword ? t('Kwa usalama, badilisha nenosiri la muda ulilopewa kabla ya kuendelea.') : t('Badilisha nenosiri lako.')}
            </p>
          </div>
          <Alert>{error}</Alert>
          <TextField label={t('Nenosiri la sasa (la muda)')} type="password" autoComplete="current-password" value={current} onChange={setCurrent} required />
          <TextField label={t('Nenosiri jipya')} help={t('Herufi 8 au zaidi, liwe na herufi na namba')} type="password" autoComplete="new-password" value={next} onChange={setNext} required />
          <TextField label={t('Rudia nenosiri jipya')} type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} required />
          <Button type="submit" busy={busy} style={{ minHeight: 48 }}>{t('Hifadhi na endelea')}</Button>
          <Button variant="ghost" onClick={logout}>{t('Toka')}</Button>
        </form>
      </section>
    </div>
  );
}
