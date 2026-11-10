import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { LogoMark } from './Logo';
import { useT, tr } from '../lib/prefs';

/** Maandishi ya kawaida (string) yanatafsiriwa; vipande vingine vya JSX vinabaki kama vilivyo. */
export const tx = (t: typeof tr, x: ReactNode): ReactNode => (typeof x === 'string' ? t(x) : x);
import { STATUS_LABEL } from '../lib/format';
import { useDebounced, useFetch } from '../lib/hooks';
import type { Paged } from '../lib/api';

type BtnVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'primary', size, busy, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm'; busy?: boolean }) {
  const t = useT();
  children = tx(t, children);
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${rest.className ?? ''}`}>
      {busy && <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} aria-hidden="true" />}
      {children}
    </button>
  );
}

let idSeq = 0;
export function Field({ label, help, children, id }: { label: string; help?: string; children: (id: string) => ReactNode; id?: string }) {
  const ref = useRef(id ?? `f${++idSeq}`);
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={ref.current}>{t(label)}</label>
      {children(ref.current)}
      {help && <span className="help">{t(help)}</span>}
    </div>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  const t = useT();
  return <input {...p} placeholder={p.placeholder ? t(p.placeholder) : undefined} className={`input ${p.className ?? ''}`} />;
}
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`select ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`textarea ${p.className ?? ''}`} />;

/** Sehemu ya fomu kwa urahisi: <TextField label="Jina" value=... onChange=... /> */
export function TextField({ label, help, value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string; help?: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <Field label={label} help={help}>
      {(id) => <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  );
}

export function SelectField({ label, help, value, onChange, options, placeholder, required }: {
  label: string; help?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; required?: boolean;
}) {
  const t = useT();
  return (
    <Field label={label} help={help}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
          {placeholder !== undefined && <option value="">{t(placeholder)}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </Select>
      )}
    </Field>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'warn'; children: ReactNode }) {
  const t = useT();
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{tx(t, children)}</div>;
}

export function Badge({ status, label }: { status: string; label?: string }) {
  const tone = ['ACTIVE', 'APPROVED', 'ISSUED', 'POSTED', 'RECEIVED', 'PAID', 'COMPLETED', 'SUCCESS', 'SOLD'].includes(status) ? 'ok'
    : ['DRAFT', 'PLANNING', 'MARKETING', 'SUSPENDED', 'PENDING', 'PENDING_APPROVAL', 'PARTIALLY_RECEIVED', 'OPEN', 'PROCESSING', 'PARTIAL', 'DISPOSAL_PENDING'].includes(status) ? 'warn'
    : ['REJECTED', 'CANCELLED', 'DECEASED', 'FAILED'].includes(status) ? 'bad' : 'neutral';
  const t = useT();
  return <span className={`badge badge-${tone}`}>{t(label ?? STATUS_LABEL[status] ?? status)}</span>;
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="page-head">
      <div>
        <h1>{tx(t, title)}</h1>
        {sub && <p>{tx(t, sub)}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Loading() {
  const t = useT();
  return (
    <div className="center cl-loading" role="status" aria-label={t('Inapakia')}>
      <LogoMark size={56} spin onDark={false} />
      <div className="cl-loading-txt">{t('Inapakia')}<span className="cl-dots" aria-hidden="true" /></div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const t = useT();
  return <div className="empty">{tx(t, children)}</div>;
}

export function Pager({ meta, onPage }: { meta?: Paged<unknown>['meta']; onPage: (p: number) => void }) {
  const t = useT();
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <div className="pager">
      <span>{from}–{to} {t('kati ya')} {meta.total}</span>
      <div className="actions">
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>{t('Nyuma')}</Button>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>{t('Mbele')}</Button>
      </div>
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t(title)}>
        <div className="modal-head">
          <h2>{t(title)}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('Funga')}>✕</Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  const t = useT();
  return (
    <div className={`card stat ${accent ? 'accent' : ''}`}>
      <span className="label">{t(label)}</span>
      <span className="value">{value}</span>
      {hint && <span className="hint">{tx(t, hint)}</span>}
    </div>
  );
}

export interface MemberLite { id: string; memberNo: string; firstName: string; lastName: string; village?: string | null; status?: string }

/** Kutafuta na kuchagua mwanachama (jina, namba, simu, NIDA). */
export function MemberPicker({ value, onChange, label = 'Mwanachama' }: { value: MemberLite | null; onChange: (m: MemberLite | null) => void; label?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const t = useT();
  const { data } = useFetch<Paged<MemberLite>>(open && dq.length >= 1 ? '/members/lookup' : null, { search: dq, status: 'ACTIVE', pageSize: 8 });

  if (value) {
    return (
      <div className="field">
        <label>{t(label)}</label>
        <div className="card card-pad" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span><strong>{value.firstName} {value.lastName}</strong> <span className="muted">· {value.memberNo}</span></span>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Badilisha</Button>
        </div>
      </div>
    );
  }
  return (
    <Field label={label} help="Andika jina, namba ya mwanachama, simu au NIDA">
      {(id) => (
        <div className="picker">
          <Input id={id} value={q} placeholder="Tafuta mwanachama…" autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
          {open && dq && data && (
            <div className="picker-list">
              {data.data.length === 0 && <div className="empty" style={{ padding: 14 }}>{t('Hakuna mwanachama anayelingana')}</div>}
              {data.data.map((m) => (
                <button type="button" key={m.id} onClick={() => { onChange(m); setOpen(false); setQ(''); }}>
                  <strong>{m.firstName} {m.lastName}</strong> <span className="muted">· {m.memberNo}{m.village ? ` · ${m.village}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

/** Kitambulisho cha kipekee kwa kila ombi (kuzuia kurekodi mara mbili). */
export const clientRef = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
