import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { playTone, setSoundEnabled, soundEnabled } from '../lib/tone';
import { LogoMark, Wordmark } from '../components/Logo';
import { Alert, Button, TextField } from '../components/ui';

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
  const [idx, setIdx] = useState(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    SLIDES.forEach((s) => { const img = new Image(); img.src = s.src; }); // pakia mapema
  }, []);
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
            style={{ backgroundImage: `url(${sl.src})`, backgroundPosition: sl.pos }} />
        ))}
      </div>
      <div className="hero-scrim" aria-hidden="true" />

      <div className="hero-content">
        <LogoMark size={190} animate />
        <div className="hero-word"><Wordmark size={72} animate /></div>
        <div className="tagline">Uwazi · Haki · Maendeleo</div>
        <p className="sub">Mfumo wa kisasa wa kusimamia Vyama vya Msingi: wanachama, pembejeo, masoko na malipo, kila shilingi ikiwa wazi.</p>
      </div>

      <div className="hero-caption">
        <p aria-live="polite"><strong>{s.title}</strong><span> · {s.text}</span></p>
        <div className="hero-dots" role="group" aria-label="Chagua picha">
          {SLIDES.map((sl, i) => (
            <button key={sl.src} type="button" aria-label={`Picha ${i + 1}: ${sl.title}`} aria-pressed={i === idx}
              className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(soundEnabled());
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(phone.trim(), password);
      playTone();
      nav(u.mustChangePassword ? '/change-password' : '/', { replace: true });
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
        <form className="auth-card" onSubmit={submit}>
          <div>
            <h1>Karibu tena</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>Ingia kwa namba yako ya simu na nenosiri.</p>
          </div>
          <Alert>{error}</Alert>
          <TextField label="Namba ya simu" type="tel" inputMode="tel" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="0712 345 678" value={phone} onChange={setPhone} required />
          <TextField label="Nenosiri" type={showPw ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={password} onChange={setPassword} required />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)', marginTop: -8 }}>
            <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> Onyesha nenosiri
          </label>
          <Button type="submit" variant="primary" busy={busy} style={{ minHeight: 48 }}>Ingia</Button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--muted)' }}>
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setSoundEnabled(e.target.checked); }} />
            Cheza tone ya CoopLink nikiingia
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>CoopLink v{__APP_VERSION__}</p>
        </form>
      </section>
    </div>
  );
}

export function ChangePassword() {
  const { changePassword, user, logout } = useAuth();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError('Nenosiri jipya na uthibitisho havilingani');
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      nav('/', { replace: true });
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
        <form className="auth-card" onSubmit={submit}>
          <div>
            <h1>Weka nenosiri jipya</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {user?.mustChangePassword ? 'Kwa usalama, badilisha nenosiri la muda ulilopewa kabla ya kuendelea.' : 'Badilisha nenosiri lako.'}
            </p>
          </div>
          <Alert>{error}</Alert>
          <TextField label="Nenosiri la sasa (la muda)" type="password" autoComplete="current-password" value={current} onChange={setCurrent} required />
          <TextField label="Nenosiri jipya" help="Herufi 8 au zaidi, liwe na herufi na namba" type="password" autoComplete="new-password" value={next} onChange={setNext} required />
          <TextField label="Rudia nenosiri jipya" type="password" autoComplete="new-password" value={confirm} onChange={setConfirm} required />
          <Button type="submit" busy={busy} style={{ minHeight: 48 }}>Hifadhi na endelea</Button>
          <Button variant="ghost" onClick={logout}>Toka</Button>
        </form>
      </section>
    </div>
  );
}
