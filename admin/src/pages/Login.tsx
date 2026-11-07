import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { playTone, setSoundEnabled, soundEnabled } from '../lib/tone';
import { LogoMark, Wordmark } from '../components/Logo';
import { Alert, Button, TextField } from '../components/ui';

function AuthHero() {
  return (
    <section className="auth-hero">
      <LogoMark size={200} animate />
      <Wordmark size={72} animate />
      <div className="tagline">Uwazi · Haki · Maendeleo</div>
      <p className="sub">Mfumo wa kisasa wa kusimamia Vyama vya Msingi: wanachama, pembejeo, masoko na malipo, kila shilingi ikiwa wazi.</p>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(phone, password);
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
          <TextField label="Namba ya simu" type="tel" inputMode="tel" autoComplete="username" placeholder="0712 345 678" value={phone} onChange={setPhone} required />
          <TextField label="Nenosiri" type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
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
