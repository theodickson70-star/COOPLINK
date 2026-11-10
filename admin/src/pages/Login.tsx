import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { homeFor, useAuth, type User } from '../lib/auth';
import { api } from '../lib/api';
import { playTone, unlockAudio } from '../lib/tone';
import { LegalLinks } from '../components/LegalLinks';
import { LogoMark, Wordmark } from '../components/Logo';
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

      <div className="hero-content">
        <LogoMark size={190} animate />
        <div className="hero-word"><Wordmark size={72} animate /></div>
        <div className="tagline">{t('Uwazi · Haki · Maendeleo')}</div>
        <p className="sub">{t('Mfumo wa kisasa wa kusimamia Vyama vya Msingi: wanachama, pembejeo, masoko na malipo, kila shilingi ikiwa wazi.')}</p>
      </div>

      <div className="hero-caption">
        <p aria-live="polite"><strong>{t(s.title)}</strong><span> · {t(s.text)}</span></p>
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

interface PublicStatus { maintenance: { enabled: boolean; message: string }; banner: { message: string; tone: 'info' | 'warn' } | null; brand: { companyName: string; slogan: string; poweredBy?: string } }

export function Login() {
  const { login, verify2fa } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<PublicStatus | null>(null);

  useEffect(() => {
    api<PublicStatus>('/public/status').then(setStatus).catch(() => {});
  }, []);

  const done = (u: User) => {
    playTone();
    nav(u.mustChangePassword ? '/change-password' : homeFor(u), { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        done(await verify2fa(challenge, code.trim()));
        return;
      }
      const r = await login(phone.trim(), password);
      if ('twoFactor' in r) {
        setChallenge(r.challenge);
        return;
      }
      done(r.user);
    } catch (err) {
      setError((err as Error).message);
      if (challenge && /Ingia tena/.test((err as Error).message)) setChallenge(null);
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
          {status?.maintenance.enabled && <Alert kind="warn"><strong>{t('Matengenezo:')}</strong> {status.maintenance.message}</Alert>}
          {status?.banner && <Alert kind={status.banner.tone === 'warn' ? 'warn' : 'ok'}>{status.banner.message}</Alert>}
          {!challenge ? (
            <>
              <div>
                <h1>{t('Karibu tena')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Ingia kwa namba yako ya simu na nenosiri.')}</p>
              </div>
              <Alert>{error}</Alert>
              <TextField label={t('Namba ya simu')} type="tel" inputMode="tel" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="0712 345 678" value={phone} onChange={setPhone} required />
              <TextField label={t('Nenosiri')} type={showPw ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={password} onChange={setPassword} required />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)', marginTop: -8 }}>
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> {t('Onyesha nenosiri')}
              </label>
              <Button type="submit" variant="primary" busy={busy} style={{ minHeight: 48 }}>{t('Ingia')}</Button>
            </>
          ) : (
            <>
              <div>
                <h1>{t('Uthibitisho wa hatua mbili')}</h1>
                <p className="muted" style={{ margin: '6px 0 0' }}>{t('Weka msimbo wa tarakimu 6 kutoka kwenye app yako ya Authenticator.')}</p>
              </div>
              <Alert>{error}</Alert>
              <TextField label={t('Msimbo wa 2FA')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} required autoFocus />
              <Button type="submit" variant="primary" busy={busy} disabled={code.length !== 6} style={{ minHeight: 48 }}>{t('Thibitisha')}</Button>
              <Button variant="ghost" onClick={() => { setChallenge(null); setCode(''); setError(null); }}>{t('Rudi nyuma')}</Button>
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
