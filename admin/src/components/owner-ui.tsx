import { useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { Alert, Button, Modal, TextField, tx } from './ui';
import { useT } from '../lib/prefs';

// ------------------------------ TAREHE ------------------------------
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
const shift = (d: string, days: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
export type RangePreset = 'today' | '7d' | '30d' | 'month' | 'year' | 'custom';
export interface Range { preset: RangePreset; from: string; to: string }

export function presetRange(p: RangePreset, custom?: { from: string; to: string }): Range {
  const t = todayStr();
  switch (p) {
    case 'today': return { preset: p, from: t, to: t };
    case '7d': return { preset: p, from: shift(t, -6), to: t };
    case '30d': return { preset: p, from: shift(t, -29), to: t };
    case 'month': return { preset: p, from: `${t.slice(0, 7)}-01`, to: t };
    case 'year': return { preset: p, from: `${t.slice(0, 4)}-01-01`, to: t };
    default: return { preset: 'custom', from: custom?.from ?? shift(t, -29), to: custom?.to ?? t };
  }
}

const PRESETS: [RangePreset, string][] = [['today', 'Leo'], ['7d', 'Siku 7'], ['30d', 'Siku 30'], ['month', 'Mwezi huu'], ['year', 'Mwaka huu'], ['custom', 'Chagua tarehe']];

export function DateRangeFilter({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const t = useT();
  return (
    <div className="range-filter" role="group" aria-label={t('Kipindi')}>
      <div className="seg">
        {PRESETS.map(([k, label]) => (
          <button key={k} type="button" className={value.preset === k ? 'on' : ''} aria-pressed={value.preset === k}
            onClick={() => onChange(presetRange(k, value))}>{t(label)}</button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="actions">
          <input className="input" type="date" aria-label="Kuanzia" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="muted">{t('hadi')}</span>
          <input className="input" type="date" aria-label="Hadi" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

// ------------------------------ UTHIBITISHO (REAUTH) ------------------------------
export interface Confirmation { confirmPassword: string; confirmCode?: string }

/** Dirisha la kuthibitisha kitendo nyeti kwa nenosiri (na 2FA ikiwa imewashwa). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Thibitisha', danger, onClose, onConfirm, children }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onClose: () => void; onConfirm: (c: Confirmation) => Promise<unknown>; children?: ReactNode;
}) {
  const { user } = useAuth();
  const t = useT();
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setPw(''); setCode(''); setError(null); onClose(); };
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ confirmPassword: pw, confirmCode: user?.totpEnabled ? code : undefined });
      setPw(''); setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title={title} onClose={close}
      footer={<><Button variant="secondary" onClick={close}>{t('Ghairi')}</Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!pw || (user?.totpEnabled && code.length !== 6)} onClick={go}>{t(confirmLabel)}</Button></>}>
      <div>{tx(t, message)}</div>
      {children}
      <Alert>{error}</Alert>
      <TextField label="Thibitisha kwa nenosiri lako" type="password" autoComplete="current-password" value={pw} onChange={setPw} />
      {user?.totpEnabled && <TextField label="Msimbo wa 2FA" inputMode="numeric" maxLength={6} value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} />}
    </Modal>
  );
}

// ------------------------------ VIPENGELE VINGINE ------------------------------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  const t = useT();
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{t(label)}</button>
      ))}
    </div>
  );
}

const TONES: Record<string, string> = {
  ACTIVE: 'ok', VERIFIED: 'ok', SUCCESS: 'ok', SENT: 'ok', DELIVERED: 'ok', APPROVED: 'ok', COMPLETED: 'ok', TRIAL: 'info', ok: 'ok',
  PENDING: 'warn', PAST_DUE: 'warn', REQUESTED: 'warn', RUNNING: 'warn', QUEUED: 'warn', SKIPPED: 'neutral', not_configured: 'neutral',
  SUSPENDED: 'bad', EXPIRED: 'bad', FAILED: 'bad', REJECTED: 'bad', REFUNDED: 'neutral', CANCELLED: 'neutral', down: 'bad',
};
export const LABELS: Record<string, string> = {
  ACTIVE: 'Hai', PENDING: 'Inasubiri', SUSPENDED: 'Imesitishwa', REJECTED: 'Imekataliwa', TRIAL: 'Trial', PAST_DUE: 'Imepita muda (grace)',
  EXPIRED: 'Imeisha', CANCELLED: 'Imefutwa', VERIFIED: 'Imethibitishwa', FAILED: 'Imeshindwa', REFUNDED: 'Imerudishwa',
  SUCCESS: 'Imefanikiwa', RUNNING: 'Inaendelea', SKIPPED: 'Imerukwa', SENT: 'Imetumwa', QUEUED: 'Kwenye foleni', DELIVERED: 'Imefika',
  REQUESTED: 'Imeombwa', APPROVED: 'Imeidhinishwa', COMPLETED: 'Imekamilika', ok: 'Sawa', down: 'Haipatikani', not_configured: 'Haijasanidiwa',
  configured: 'Imesanidiwa', manual_verification: 'Uthibitisho wa mkono',
  MONTHLY: 'Kila mwezi', ANNUAL: 'Kila mwaka', SUBSCRIPTION: 'Subscription', SETUP: 'Usanidi', TRAINING: 'Mafunzo', OTHER: 'Nyingine',
  MOBILE_MONEY: 'Simu', BANK: 'Benki', CASH: 'Taslimu', SERVER: 'Server', SMS: 'SMS', SALARY: 'Mishahara', MARKETING: 'Masoko',
  OFFICE: 'Ofisi', TRANSPORT: 'Usafiri', ANNOUNCEMENT: 'Tangazo', SYSTEM_UPDATE: 'Taarifa ya mfumo', EXPIRY_REMINDER: 'Kikumbusho',
  IN_APP: 'Ndani ya mfumo', EMAIL: 'Email', RAILWAY: 'Railway', EXPORT: 'Export ya data',
};
export function Pill({ value, label }: { value: string; label?: string }) {
  const t = useT();
  return <span className={`badge badge-${TONES[value] ?? 'neutral'}`}>{t(label ?? LABELS[value] ?? value)}</span>;
}

export function Kpi({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'dark' | 'gold' | 'warn' | 'bad'; icon?: ReactNode }) {
  const t = useT();
  return (
    <div className={`card kpi ${tone ? `kpi-${tone}` : ''}`}>
      <div className="kpi-top"><span className="label">{t(label)}</span>{icon && <span className="kpi-icon" aria-hidden="true">{icon}</span>}</div>
      <span className="value">{value}</span>
      {hint && <span className="hint">{tx(t, hint)}</span>}
    </div>
  );
}

export function Section({ title, actions, children, pad = true }: { title: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  const t = useT();
  return (
    <section className="card">
      <div className="section-head"><h2>{tx(t, title)}</h2>{actions && <div className="actions">{actions}</div>}</div>
      <div className={pad ? 'card-pad' : ''} style={pad ? { paddingTop: 0 } : undefined}>{children}</div>
    </section>
  );
}

export const money = (v: string | number | null | undefined, cur = 'TSh') => `${cur} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(v ?? 0))}`;
export const nfmt = (v: string | number | null | undefined) => new Intl.NumberFormat('en-US').format(Number(v ?? 0));
