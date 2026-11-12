import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, phone, ROLE_LABEL, OWNER_ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Loading, PageHead, TextField } from '../components/ui';
import { LockedNameField } from '../components/PhoneName';
import { ConfirmDialog, Pill, Section, Tabs } from '../components/owner-ui';

const device = (ua: string | null) => !ua ? '—' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Kifaa kingine';

export function OwnerSettings() {
  const [tab, setTab] = useState<'profile' | 'password' | '2fa' | 'sessions'>('profile');
  return (
    <>
      <PageHead title="Mipangilio yangu" sub="Wasifu, nenosiri, uthibitisho wa hatua mbili (2FA) na vifaa vyako" />
      <Tabs value={tab} onChange={setTab} items={[['profile', 'Wasifu'], ['password', 'Nenosiri'], ['2fa', '2FA'], ['sessions', 'Vifaa na historia']]} />
      {tab === 'profile' && <Profile />}
      {tab === 'password' && <Password />}
      {tab === '2fa' && <TwoFactor />}
      {tab === 'sessions' && <Sessions />}
    </>
  );
}

export function Profile({ ownerNote = true }: { ownerNote?: boolean }) {
  const { user, refresh } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [ok, setOk] = useState(false);
  const act = useAction();
  if (!user) return null;
  return (
    <Section title="Wasifu">
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{ok ? 'Imehifadhiwa.' : null}</Alert>
      <div className="form-grid">
        <LockedNameField phone={user.phone} value={fullName} onChange={setFullName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <TextField label="Simu (namba ya kuingia)" value={phone(user.phone)} disabled onChange={() => undefined} />
        <TextField label="Nafasi" value={user.role === 'SUPER_ADMIN' ? OWNER_ROLE_LABEL : ROLE_LABEL[user.role] ?? user.role} disabled onChange={() => undefined} />
      </div>
      {ownerNote && <p className="muted" style={{ fontSize: 12 }}>Namba ya simu ya Owner inabadilishwa kupitia <code>SEED_ADMIN_PHONE</code> kwenye Railway, si hapa.</p>}
      <div className="actions"><Button busy={act.busy} disabled={fullName.trim().length < 3} onClick={async () => {
        if (await act.run(() => api('/auth/me', { method: 'PATCH', body: { fullName: fullName.trim(), email: email.trim() || null } }))) { setOk(true); await refresh(); }
      }}>Hifadhi</Button></div>
    </Section>
  );
}

export function Password() {
  const { changePassword } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [ok, setOk] = useState(false);
  const act = useAction();
  const mismatch = again.length > 0 && next !== again;
  return (
    <Section title="Badilisha nenosiri">
      <Alert>{act.error ?? (mismatch ? 'Nenosiri jipya halilingani.' : null)}</Alert>
      <Alert kind="ok">{ok ? 'Nenosiri limebadilishwa. Vifaa vingine vyote vimetolewa.' : null}</Alert>
      <div className="form-grid">
        <TextField label="Nenosiri la sasa" type="password" autoComplete="current-password" value={cur} onChange={setCur} />
        <TextField label="Nenosiri jipya (angalau herufi 8)" type="password" autoComplete="new-password" value={next} onChange={setNext} />
        <TextField label="Rudia nenosiri jipya" type="password" autoComplete="new-password" value={again} onChange={setAgain} />
      </div>
      <div className="actions"><Button busy={act.busy} disabled={!cur || next.length < 8 || next !== again} onClick={async () => {
        setOk(false);
        if (await act.run(async () => { await changePassword(cur, next); return true; })) { setOk(true); setCur(''); setNext(''); setAgain(''); }
      }}>Badilisha</Button></div>
    </Section>
  );
}

export function TwoFactor() {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();
  if (!user) return null;
  return (
    <Section title="Uthibitisho wa hatua mbili (2FA)">
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{msg}</Alert>
      {user.totpEnabled ? (
        <>
          <p style={{ marginTop: 0 }}><Pill value="ACTIVE" label="2FA imewashwa" /> Kila unapoingia na kwa hatua nyeti (kuthibitisha malipo, kusitisha chama, export) utaombwa msimbo wa tarakimu 6 kutoka app yako.</p>
          <Button variant="danger" onClick={() => setDisabling(true)}>Zima 2FA</Button>
        </>
      ) : !setup ? (
        <>
          <p style={{ marginTop: 0 }}>Linda akaunti yako kwa msimbo wa muda kutoka app kama <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong> au <strong>Authy</strong>. Inapendekezwa sana.</p>
          <Button busy={act.busy} onClick={async () => { setMsg(null); const r = await act.run(() => api<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', { method: 'POST' })); if (r) setSetup(r); }}>Anza kuwasha 2FA</Button>
        </>
      ) : (
        <div className="stack">
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Fungua app ya authenticator → <em>Ongeza akaunti</em> → <em>Weka ufunguo (Enter a setup key)</em>.</li>
            <li>Andika ufunguo huu (aina: <em>Time based</em>):</li>
          </ol>
          <div className="secret" style={{ letterSpacing: 2 }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Ukiwa kwenye simu yenye app, unaweza pia kubofya: <a href={setup.otpauthUri}>Fungua kwenye app</a></p>
          <div className="form-grid">
            <TextField label="Msimbo wa tarakimu 6 kutoka app" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} />
          </div>
          <div className="actions">
            <Button busy={act.busy} disabled={code.length < 6} onClick={async () => {
              if (await act.run(() => api('/auth/2fa/enable', { method: 'POST', body: { code } }))) { setSetup(null); setCode(''); setMsg('2FA imewashwa.'); await refresh(); }
            }}>Thibitisha na uwashe</Button>
            <Button variant="secondary" onClick={() => { setSetup(null); setCode(''); }}>Ghairi</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={disabling} danger title="Zima 2FA" confirmLabel="Zima" onClose={() => setDisabling(false)}
        message="Akaunti yako itabaki na nenosiri pekee. Weka nenosiri na msimbo wa sasa wa 2FA kuthibitisha."
        onConfirm={async (c) => { await api('/auth/2fa/disable', { method: 'POST', body: c }); setDisabling(false); setMsg('2FA imezimwa.'); await refresh(); }} />
    </Section>
  );
}

export function Sessions() {
  const s = useFetch<{ data: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>('/auth/sessions');
  const h = useFetch<{ data: { id: string; success: boolean; reason: string; ip: string | null; userAgent: string | null; createdAt: string; suspicious: boolean }[] }>('/auth/login-history');
  const act = useAction();
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { if (ok) { const t = setTimeout(() => setOk(null), 4000); return () => clearTimeout(t); } }, [ok]);
  return (
    <div className="stack">
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <Section pad={false} title="Vifaa vilivyoingia" actions={<Button size="sm" variant="secondary" busy={act.busy} onClick={async () => {
        const others = s.data?.data.filter((x) => !x.current) ?? [];
        for (const x of others) await act.run(() => api(`/auth/sessions/${x.id}`, { method: 'DELETE' }));
        setOk(`Vifaa ${others.length} vimetolewa.`); s.reload();
      }}>Toa vifaa vingine vyote</Button>}>
        {s.loading && !s.data ? <Loading /> : s.data?.data.length === 0 ? <Empty>Hakuna.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Kifaa</th><th>IP</th><th>Kilianza</th><th>Mara ya mwisho</th><th /></tr></thead>
            <tbody>{s.data?.data.map((x) => (
              <tr key={x.id}>
                <td>{device(x.userAgent)}{x.current && <> <Pill value="ACTIVE" label="Hiki" /></>}</td><td>{x.ip ?? '—'}</td><td>{dateTime(x.createdAt)}</td><td>{dateTime(x.lastSeenAt)}</td>
                <td className="num">{!x.current && <Button size="sm" variant="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/auth/sessions/${x.id}`, { method: 'DELETE' }))) s.reload(); }}>Toa</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section pad={false} title="Historia yangu ya kuingia">
        {h.loading && !h.data ? <Loading /> : (
          <div className="table-wrap"><table className="table"><tbody>{h.data?.data.map((e) => (
            <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td>{e.success ? <Pill value="SUCCESS" /> : <Pill value="FAILED" label={e.reason} />}{e.suspicious && <> <Pill value="PENDING" label="Isiyo ya kawaida" /></>}</td><td>{e.ip ?? '—'}</td><td>{device(e.userAgent)}</td></tr>
          ))}</tbody></table></div>
        )}
      </Section>
    </div>
  );
}
