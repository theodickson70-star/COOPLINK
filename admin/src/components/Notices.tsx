// Tangazo la juu (banner), matangazo ya ndani ya mfumo na skrini ya matengenezo
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Banner ya mfumo mzima (inawekwa na Owner kwenye System Control Center). */
export function SystemBanner() {
  const [banner, setBanner] = useState<{ message: string; tone: 'info' | 'warn' } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ banner: { message: string; tone: 'info' | 'warn' } | null }>('/public/status').then((r) => alive && setBanner(r.banner)).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    window.addEventListener('cl:banner', load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('cl:banner', load); };
  }, []);
  if (!banner?.message) return null;
  return <div className={`sys-banner ${banner.tone}`} role="status">{banner.message}</div>;
}

/** Skrini ya matengenezo: inaonekana API ikirudisha MAINTENANCE (503). */
export function MaintenanceOverlay() {
  const { logout } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg((e as CustomEvent<string>).detail || 'Mfumo uko kwenye matengenezo.');
    window.addEventListener('cl:maintenance', on);
    return () => window.removeEventListener('cl:maintenance', on);
  }, []);
  if (!msg) return null;
  return (
    <div className="maint-overlay" role="alertdialog" aria-modal="true" aria-labelledby="maint-title">
      <div className="maint-card">
        <div className="maint-icon" aria-hidden="true">⚙</div>
        <h2 id="maint-title">Matengenezo ya mfumo</h2>
        <p>{msg}</p>
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Jaribu tena</button>
          <button className="btn btn-ghost" onClick={logout}>Toka</button>
        </div>
      </div>
    </div>
  );
}
