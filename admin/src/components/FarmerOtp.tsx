// =====================================================================
//  OTP YA MKULIMA (v0.40) — sehemu moja inayotumika kila mahali mkulima anathibitisha mwenyewe:
//   - namba ya simu (usajili na kubadilisha)          PhoneOtpStep
//   - kupokea fedha taslimu (malipo, mikopo)           CashOtpModal
//   - ridhaa ya kujiunga na kikundi (dhamana)          ConsentOtpModal
//  Kila mstari: "Tuma OTP" -> mkulima anataja namba -> "Thibitisha". Bila simu: Meneja tu, kwa sababu.
// =====================================================================
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { phone as fmtPhone } from '../lib/format';
import { useT } from '../lib/prefs';
import { Alert, Badge, Button, Modal, TextField } from './ui';

export interface OtpConfig { phone: boolean; cash: boolean; group: boolean; pinBySms: boolean; handover: boolean }
export const useOtpConfig = () => useFetch<OtpConfig>('/members/otp-config').data;

export const normTz = (p?: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return d.startsWith('0') ? `255${d.slice(1)}` : d.length === 9 ? `255${d}` : d; };

/** Mstari mmoja wa OTP: tuma -> namba -> thibitisha */
export function OtpRow({ title, sub, send, verify, done, onDone }: {
  title: ReactNode; sub?: ReactNode; send: () => Promise<{ phoneMasked: string }>; verify: (code: string) => Promise<unknown>; done: boolean; onDone: () => void;
}) {
  const t = useT();
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className={`otp-box ${done ? 'ok' : ''}`}>
      <div className="otp-head">
        <div className="grow"><strong>{title}</strong>{sub && <span className="muted st-small">{sub}</span>}</div>
        {done ? <Badge status="APPROVED" label={t('Imethibitishwa')} /> : (
          <Button size="sm" variant="secondary" busy={busy && !sent} onClick={() => go(async () => { const r = await send(); setSent(r.phoneMasked); setCode(''); })}>
            {sent ? t('Tuma upya') : t('Tuma OTP')}
          </Button>
        )}
      </div>
      {!done && sent && (
        <div className="otp-code">
          <span className="muted st-small">{t('Imetumwa kwa')} {sent}</span>
          <TextField label={t('Namba aliyopokea mkulima')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} />
          <Button busy={busy} disabled={code.length !== 6} onClick={() => go(async () => { await verify(code); onDone(); })}>{t('Thibitisha')}</Button>
        </div>
      )}
      {err && <Alert>{err}</Alert>}
    </div>
  );
}

/** Meneja: endelea bila OTP (mkulima hana simu) — sababu inarekodiwa */
export function ManagerOverride({ perm, label, value, onChange }: { perm: string; label: string; value: string | null; onChange: (v: string | null) => void }) {
  const { may } = useAuth();
  const t = useT();
  if (!may(perm as never)) return null;
  return (
    <div className="otp-override">
      <label className="chk"><input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? '' : null)} /> {t(label)}</label>
      {value !== null && <TextField label={t('Sababu (itarekodiwa kwenye kumbukumbu)')} value={value} onChange={onChange} placeholder={t('mf. Mkulima hana simu — amesaini daftari mbele ya mjumbe')} />}
    </div>
  );
}

// ------------------------------ NAMBA YA SIMU ------------------------------
/** Namba ya simu / ya malipo inathibitishwa kwa OTP. Usajili: { registerName }, kubadilisha: { memberId }. */
export function PhoneOtpStep({ target, phones, busy, error, onBack, onVerified, saveLabel }: {
  target: { memberId: string } | { registerName: string }; phones: string[]; busy: boolean; error: string | null;
  onBack: () => void; onVerified: (extra: Record<string, unknown>) => void; saveLabel: string;
}) {
  const t = useT();
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<string | null>(null);
  const reg = 'registerName' in target;
  const allOk = phones.every((ph) => ok[ph]);
  return (
    <div className="stack">
      <Alert kind="warn">{t(reg
        ? 'Thibitisha namba ya mkulima: atapokea namba ya tarakimu 6 kwenye simu yake, kisha aitaje hapa. Hii inahakikisha simu ni yake — malipo yake yataenda kwenye namba hii.'
        : 'Namba mpya ya simu lazima ithibitishwe: mkulima atapokea namba ya tarakimu 6 kwenye simu hiyo mpya, kisha aitaje hapa. Hii inazuia mtu kuweka namba isiyo ya mkulima (malipo yasiende kwa mtu mwingine).')}</Alert>
      {phones.map((ph) => (
        <OtpRow key={ph} title={fmtPhone(normTz(ph))} done={!!ok[ph]} onDone={() => setOk((s) => ({ ...s, [ph]: true }))}
          send={() => (reg
            ? api<{ phoneMasked: string }>('/members/register-otp', { method: 'POST', body: { phone: ph, name: target.registerName } })
            : api<{ phoneMasked: string }>(`/members/${target.memberId}/phone-otp`, { method: 'POST', body: { phone: ph } }))}
          verify={(code) => (reg
            ? api('/members/register-otp/verify', { method: 'POST', body: { phone: ph, code } })
            : api(`/members/${target.memberId}/phone-otp/verify`, { method: 'POST', body: { phone: ph, code } }))} />
      ))}
      <Alert>{error}</Alert>
      <ManagerOverride perm="members.approve" label="Hifadhi bila OTP (Meneja — mkulima hana simu karibu)" value={reason} onChange={setReason} />
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onBack}>{t('Rudi kwenye fomu')}</Button>
        {reason !== null
          ? <Button busy={busy} disabled={reason.trim().length < 10} onClick={() => onVerified({ phoneOtpOverride: reason.trim() })}>{t('Hifadhi bila OTP')}</Button>
          : <Button busy={busy} disabled={!allOk} onClick={() => onVerified({})}>{t(saveLabel)}</Button>}
      </div>
    </div>
  );
}

// ------------------------------ FEDHA TASLIMU ------------------------------
export interface CashItem { id: string; memberNo: string; name: string; amount: string }
/**
 * Malipo ya taslimu: kila mkulima anathibitisha kwa OTP akishashika fedha. Baada ya wote, "Thibitisha malipo" inaendelea.
 * type: 'payment' (orodha ya malipo ya mauzo), 'loan' (mikopo), 'txn' (malipo moja ya mkulima)
 */
export function CashOtpModal({ type, items, busy, error, onClose, onConfirm }: {
  type: 'payment' | 'loan' | 'txn'; items: CashItem[]; busy: boolean; error: string | null; onClose: () => void; onConfirm: (cashOverride?: string) => void;
}) {
  const t = useT();
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<string | null>(null);
  const done = items.filter((i) => ok[i.id]).length;
  const tsh = (v: string) => `TSh ${Math.round(Number(v)).toLocaleString('en-US')}`;
  return (
    <Modal open title={t('Taslimu: mkulima athibitishe amepokea')} onClose={onClose} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('Funga')}</Button>
        <Button busy={busy} disabled={reason !== null ? reason.trim().length < 10 : done < items.length}
          onClick={() => onConfirm(reason !== null ? reason.trim() : undefined)}>
          {reason !== null ? t('Thibitisha (Meneja, kwa sababu)') : `${t('Thibitisha malipo')} (${done}/${items.length})`}
        </Button>
      </>}>
      <div className="stack">
        <Alert kind="warn">{t('Mkabidhi kila mkulima fedha zake, kisha bonyeza "Tuma OTP". Atapokea namba kwenye simu yake na kuitaja akishashika fedha. Hii inathibitisha kwamba fedha zimemfikia yeye mwenyewe.')}</Alert>
        <div className="otp-list">
          {items.map((i) => (
            <OtpRow key={i.id} title={<>{i.name}{i.memberNo && <span className="muted"> · {i.memberNo}</span>}</>} sub={tsh(i.amount)} done={!!ok[i.id]}
              onDone={() => setOk((s) => ({ ...s, [i.id]: true }))}
              send={() => api<{ phoneMasked: string }>(`/cash-otp/${type}/${i.id}/otp`, { method: 'POST' })}
              verify={(code) => api(`/cash-otp/${type}/${i.id}/otp/verify`, { method: 'POST', body: { code } })} />
          ))}
        </div>
        <Alert>{error}</Alert>
        <ManagerOverride perm="approvals.decide" label="Thibitisha bila OTP kwa walio bila simu (Meneja)" value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

// ------------------------------ RIDHAA YA KIKUNDI ------------------------------
export interface ConsentItem { id: string; memberNo: string; name: string }
export function ConsentOtpModal({ groupName, items, busy, error, onClose, onConfirm }: {
  groupName: string; items: ConsentItem[]; busy: boolean; error: string | null; onClose: () => void; onConfirm: (consentOverride?: string) => void;
}) {
  const t = useT();
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<string | null>(null);
  const done = items.filter((i) => ok[i.id]).length;
  return (
    <Modal open title={t('Ridhaa ya dhamana ya kikundi')} onClose={onClose} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t('Funga')}</Button>
        <Button busy={busy} disabled={reason !== null ? reason.trim().length < 10 : done < items.length}
          onClick={() => onConfirm(reason !== null ? reason.trim() : undefined)}>
          {reason !== null ? t('Endelea (Meneja, kwa sababu)') : `${t('Endelea')} (${done}/${items.length})`}
        </Button>
      </>}>
      <div className="stack">
        <Alert kind="warn">{t('Wanakikundi wanadhaminiana: mmoja asipolipa deni, mauzo ya wenzake yanalipa. Kila mkulima anapokea maelezo haya kwa SMS na kukubali kwa kutaja namba aliyotumiwa.')}</Alert>
        <p className="muted" style={{ margin: 0 }}>{t('Kikundi')}: <b>{groupName}</b></p>
        <div className="otp-list">
          {items.map((i) => (
            <OtpRow key={i.id} title={<>{i.name} <span className="muted">· {i.memberNo}</span></>} done={!!ok[i.id]}
              onDone={() => setOk((s) => ({ ...s, [i.id]: true }))}
              send={() => api<{ phoneMasked: string }>('/groups/consent-otp', { method: 'POST', body: { memberId: i.id, groupName } })}
              verify={(code) => api('/groups/consent-otp/verify', { method: 'POST', body: { memberId: i.id, code } })} />
          ))}
        </div>
        <Alert>{error}</Alert>
        <ManagerOverride perm="approvals.decide" label="Endelea bila OTP kwa walio bila simu (Meneja)" value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}
