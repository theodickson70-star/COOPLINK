// =====================================================================
//  TIKETI ZA MSAADA — vipande vya pamoja (chama na timu ya DUKALANGU)
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { apiBlobUrl } from '../lib/api';
import { date, dateTime } from '../lib/format';
import { Button, Textarea } from './ui';
import { tr, useT } from '../lib/prefs';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'ANSWERED' | 'CLOSED';
export type TicketPriority = 'URGENT' | 'HIGH' | 'NORMAL';
export type TicketCategory = 'PAYMENT' | 'BUG' | 'TRAINING' | 'FEATURE' | 'OTHER';

export const CATEGORY: Record<TicketCategory, { label: string; hint: string; icon: string }> = {
  PAYMENT: { label: 'Malipo / Ada', hint: 'Ada ya CoopLink, malipo kwa simu, risiti', icon: '💳' },
  BUG: { label: 'Hitilafu ya mfumo', hint: 'Ukurasa haufunguki, kitufe hakifanyi kazi, takwimu si sahihi', icon: '🛠️' },
  TRAINING: { label: 'Mafunzo / Swali', hint: 'Jinsi ya kufanya jambo fulani kwenye mfumo', icon: '🎓' },
  FEATURE: { label: 'Ombi la kipengele kipya', hint: 'Kitu ambacho chama kingependa mfumo ufanye', icon: '💡' },
  OTHER: { label: 'Nyingine', hint: 'Jambo lolote jingine', icon: '📌' },
};
export const PRIORITY: Record<TicketPriority, { label: string; sla: string }> = {
  URGENT: { label: 'Dharura', sla: 'jibu ndani ya saa 2' },
  HIGH: { label: 'Kubwa', sla: 'jibu ndani ya saa 8 za kazi' },
  NORMAL: { label: 'Kawaida', sla: 'jibu ndani ya siku 2 za kazi' },
};
export const STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  OPEN: { label: 'Wazi', tone: 'warn' },
  IN_PROGRESS: { label: 'Inashughulikiwa', tone: 'info' },
  ANSWERED: { label: 'Imejibiwa', tone: 'ok' },
  CLOSED: { label: 'Imefungwa', tone: 'neutral' },
};

export function StatusPill({ s }: { s: TicketStatus }) {
  const t = useT();
  return <span className={`badge badge-${STATUS[s].tone}`}>{t(STATUS[s].label)}</span>;
}
export function PriorityPill({ p }: { p: TicketPriority }) {
  const t = useT();
  return <span className={`tk-prio tk-prio-${p.toLowerCase()}`}>{t(PRIORITY[p].label)}</span>;
}

export interface Attachment { id: string; mimeType: string; sizeBytes: number }
export interface Message { id: string; side: 'AMCOS' | 'PLATFORM'; internal?: boolean; body: string; createdAt: string; author: string; attachments: Attachment[] }
export interface NewFile { mimeType: string; data: string; preview: string; name: string }

/** Picha ya skrini inapunguzwa kwenye kifaa (upana 1600px, JPEG) kabla ya kutumwa. */
export async function shrinkImage(file: File): Promise<NewFile> {
  if (!file.type.startsWith('image/')) throw new Error(tr('Weka picha tu (JPEG, PNG)'));
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error(tr('Picha haisomeki'))); i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    let q = 0.82, out = c.toDataURL('image/jpeg', q);
    while (out.length > 900_000 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
    return { mimeType: 'image/jpeg', data: out.split(',')[1], preview: out, name: file.name };
  } finally { URL.revokeObjectURL(url); }
}

/** Picha iliyoambatishwa (inahitaji token, kwa hiyo inapakuliwa kama blob) */
function AttachmentThumb({ path }: { path: string }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, live = true;
    apiBlobUrl(path).then((u) => { url = u; if (live) setSrc(u); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (!src) return <span className="tk-thumb tk-thumb-wait" aria-label={t('Inapakia picha')} />;
  return <a className="tk-thumb" href={src} target="_blank" rel="noreferrer"><img src={src} alt={t('Picha iliyoambatishwa')} /></a>;
}

/** Mazungumzo ya tiketi. `mine` = upande wa anayesoma (AMCOS au PLATFORM). */
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
function dayLabel(iso: string) {
  const k = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const y = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  return k === today ? tr('Leo') : k === y ? tr('Jana') : date(iso);
}
const initials = (name: string) => name.split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');

export function Thread({ messages, mine, attachmentBase }: { messages: Message[]; mine: 'AMCOS' | 'PLATFORM'; attachmentBase: string }) {
  const t = useT();
  return (
    <ol className="tk-thread">
      {messages.map((m, i) => {
        const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
        const team = m.side === 'PLATFORM';
        const author = m.author.replace('Timu ya CoopLink', t('Timu ya CoopLink'));
        return (
          <li key={m.id} className="tk-li">
            {newDay && <div className="tk-day"><span>{dayLabel(m.createdAt)}</span></div>}
            <div className={`tk-msg-row ${m.side === mine ? 'mine' : 'theirs'}`}>
              <span className={`tk-avatar${team ? ' team' : ''}`} aria-hidden="true">{team ? 'CL' : initials(author)}</span>
              <div className={`tk-msg ${m.side === mine ? 'mine' : 'theirs'}${m.internal ? ' internal' : ''}`}>
                <div className="tk-meta">
                  <strong>{author}</strong>
                  {team && !m.internal && <span className="tk-team-tag">{t('Timu ya msaada')}</span>}
                  {m.internal && <span className="tk-internal-tag">{t('Ndani ya timu tu')}</span>}
                  <time dateTime={m.createdAt} title={dateTime(m.createdAt)}>{new Date(m.createdAt).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' })}</time>
                </div>
                <div className="tk-body">{m.body}</div>
                {m.attachments.length > 0 && <div className="tk-files">{m.attachments.map((a) => <AttachmentThumb key={a.id} path={`${attachmentBase}/${a.id}`} />)}</div>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Mtiririko wa tiketi: Imefunguliwa → Inashughulikiwa → Imejibiwa → Imefungwa */
const STEPS: { s: TicketStatus; label: string; hint: string }[] = [
  { s: 'OPEN', label: 'Imefunguliwa', hint: 'Inasubiri timu' },
  { s: 'IN_PROGRESS', label: 'Inashughulikiwa', hint: 'Timu inaifanyia kazi' },
  { s: 'ANSWERED', label: 'Imejibiwa', hint: 'Inasubiri jibu lako' },
  { s: 'CLOSED', label: 'Imefungwa', hint: 'Tatizo limetatuliwa' },
];
export function TicketSteps({ status }: { status: TicketStatus }) {
  const t = useT();
  const cur = STEPS.findIndex((x) => x.s === status);
  return (
    <ol className="tk-steps" aria-label={t('Hatua za tiketi')}>
      {STEPS.map((x, i) => {
        const state = i === cur ? 'now' : i < cur ? 'done' : 'todo';
        return (
          <li key={x.s} className={`tk-step ${state}`} aria-current={i === cur ? 'step' : undefined}>
            <span className="tk-step-dot">{state === 'done' ? '✓' : i + 1}</span>
            <span className="tk-step-txt"><strong>{t(x.label)}</strong><small>{t(x.hint)}</small></span>
          </li>
        );
      })}
    </ol>
  );
}

/** "dakika 5 zilizopita" */
export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr('sasa hivi');
  if (s < 3600) return tr('dakika {n} zilizopita', { n: Math.round(s / 60) });
  if (s < 86_400) return tr('saa {n} zilizopita', { n: Math.round(s / 3600) });
  if (s < 7 * 86_400) return tr('siku {n} zilizopita', { n: Math.round(s / 86_400) });
  return date(iso);
}

/** Kisanduku cha kuandika ujumbe pamoja na picha za skrini (hadi 3). */
export function Composer({ onSend, busy, placeholder, internalOption, submitLabel }: {
  onSend: (v: { body: string; attachments: { mimeType: string; data: string }[]; internal: boolean }) => Promise<boolean>;
  busy?: boolean; placeholder?: string; internalOption?: boolean; submitLabel?: string;
}) {
  const t = useT();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<NewFile[]>([]);
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const add = async (list: FileList | null) => {
    setErr(null);
    for (const f of Array.from(list ?? []).slice(0, 3 - files.length)) {
      try { const s = await shrinkImage(f); setFiles((x) => [...x, s].slice(0, 3)); } catch (e) { setErr((e as Error).message); }
    }
    if (inp.current) inp.current.value = '';
  };
  return (
    <form className={`tk-composer${internal ? ' internal' : ''}`} onSubmit={async (e) => {
      e.preventDefault();
      if (body.trim().length < 2) return;
      if (await onSend({ body: body.trim(), attachments: files.map(({ mimeType, data }) => ({ mimeType, data })), internal })) { setBody(''); setFiles([]); setInternal(false); }
    }}
      onPaste={(e) => { if (e.clipboardData.files.length) add(e.clipboardData.files); }}>
      <Textarea id="tk-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder ?? t('Andika ujumbe…')} aria-label={t('Ujumbe')} />
      {files.length > 0 && (
        <div className="tk-files">
          {files.map((f, i) => (
            <span key={i} className="tk-thumb">
              <img src={f.preview} alt={f.name} />
              <button type="button" className="tk-x" aria-label={t('Ondoa picha')} onClick={() => setFiles(files.filter((_, k) => k !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      {err && <p className="name-note bad">{err}</p>}
      <div className="tk-composer-bar">
        <div className="tk-composer-tools">
          <input ref={inp} id="tk-file" type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
          <Button type="button" variant="ghost" size="sm" disabled={files.length >= 3} onClick={() => inp.current?.click()}>📎 {t('Picha ya skrini')}</Button>
          {internalOption && (
            <label className="tk-internal-toggle"><input id="tk-internal" type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> {t('Maelezo ya ndani (chama hakioni)')}</label>
          )}
        </div>
        <Button type="submit" busy={busy} disabled={body.trim().length < 2}>{internal ? t('Hifadhi maelezo') : submitLabel ?? t('Tuma')}</Button>
      </div>
    </form>
  );
}

/** Muda uliobaki au uliopita kwa jibu la kwanza */
export function slaText(dueAt: string, firstResponseAt: string | null, status: TicketStatus) {
  if (firstResponseAt || status === 'CLOSED') return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  const h = Math.abs(ms) / 3_600_000;
  const d = h < 1 ? tr('dakika {n}', { n: Math.max(1, Math.round(h * 60)) }) : h < 48 ? tr('saa {n}', { n: Math.round(h) }) : tr('siku {n}', { n: Math.round(h / 24) });
  return ms < 0 ? { late: true, text: tr('Imechelewa {d}', { d }) } : { late: false, text: tr('Zimebaki {d}', { d }) };
}
