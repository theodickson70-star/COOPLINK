// =====================================================================
//  STAFF MANAGEMENT — wafanyakazi wa DUKALANGU SOLUTION / CoopLink (Owner pekee)
//   Usajili wa hatua 3: taarifa -> cheo na ruhusa -> thibitisha. Nenosiri la muda linatumwa kwa SMS kwa
//   mfanyakazi mwenyewe (Owner halioni); linaisha baada ya saa 72 na mfanyakazi analibadilisha akiingia.
// =====================================================================
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import type { Permission, Role } from '../lib/auth';
import { date, dateTime, phone, ROLE_LABEL, OWNER_ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { LockedNameField, PhoneNameFields } from '../components/PhoneName';
import { Kpi, Pill, Tabs } from '../components/owner-ui';

interface Staff {
  id: string; fullName: string; phone: string; email: string | null; role: Role; jobTitle: string | null; isActive: boolean;
  mustChangePassword: boolean; totpEnabled: boolean; lastLoginAt: string | null; permissions: Permission[]; customPermissions: boolean;
  tempPasswordExpiresAt: string | null; createdAt: string;
}
interface Catalog { permissions: Record<Permission, string>; roleDefaults: Record<string, Permission[]>; roles: Role[] }
interface Delivery { status: string; phone: string; error: string | null }
type Sent = { name: string; delivery: Delivery; password: string | null; again?: () => Promise<void> };

const ROLE_INFO: Record<string, { icon: string; blurb: string; does: string[] }> = {
  FINANCE_MANAGER: { icon: '💼', blurb: 'Anasimamia mapato na matumizi ya kampuni.', does: ['Kurekodi malipo na kufuatilia madeni ya ada', 'Matumizi, bajeti na ripoti za kampuni', 'Kukumbusha vyama kulipa ada', 'Hathibitishi malipo aliyorekodi mwenyewe'] },
  CUSTOMER_SUPPORT: { icon: '🤝', blurb: 'Anahudumia vyama na kuleta wateja wapya.', does: ['Leads (CRM) na kusajili vyama vipya', 'Tiketi za msaada na msaada wa akaunti', 'Matangazo na SMS kwa vyama', 'Haoni nenosiri wala fedha za kampuni'] },
};
const initials = (n: string) => n.split(' ').slice(0, 2).map((x) => x[0]).join('').toUpperCase();

/** Hali ya akaunti ya mfanyakazi kwa lugha rahisi */
function stateOf(s: Staff): { key: 'off' | 'expired' | 'waiting' | 'active'; label: string } {
  if (!s.isActive) return { key: 'off', label: 'Amezimwa' };
  if (s.mustChangePassword) {
    const exp = s.tempPasswordExpiresAt ? new Date(s.tempPasswordExpiresAt) : null;
    if (exp && exp.getTime() < Date.now()) return { key: 'expired', label: 'Nenosiri la muda limeisha' };
    return { key: 'waiting', label: exp ? `Anasubiri kuingia · nenosiri linaisha ${dateTime(exp.toISOString())}` : 'Anasubiri kuingia mara ya kwanza' };
  }
  return { key: 'active', label: s.lastLoginAt ? `Aliingia ${dateTime(s.lastLoginAt)}` : 'Hai' };
}

export function OwnerStaff() {
  const { data, error, loading, reload } = useFetch<{ data: Staff[] }>('/owner/staff');
  const cat = useFetch<Catalog>('/owner/staff/permissions');
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<Staff | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [filter, setFilter] = useState<'all' | 'waiting' | 'active' | 'off'>('all');
  const act = useAction();
  const team = (data?.data ?? []).filter((s) => s.role !== 'SUPER_ADMIN');
  const owners = (data?.data ?? []).filter((s) => s.role === 'SUPER_ADMIN');
  const counts = useMemo(() => ({
    active: team.filter((s) => stateOf(s).key === 'active').length,
    waiting: team.filter((s) => ['waiting', 'expired'].includes(stateOf(s).key)).length,
    no2fa: team.filter((s) => s.isActive && !s.totpEnabled).length,
    off: team.filter((s) => !s.isActive).length,
  }), [team]);
  const shown = team.filter((s) => filter === 'all' || (filter === 'waiting' ? ['waiting', 'expired'].includes(stateOf(s).key) : stateOf(s).key === filter));
  const resend = async (s: Staff) => {
    const r = await act.run(() => api<{ delivery: Delivery; temporaryPassword: string | null }>(`/owner/staff/${s.id}/reset-password`, { method: 'POST' }));
    if (r) { setSent({ name: s.fullName, delivery: r.delivery, password: r.temporaryPassword }); reload(); }
  };

  return (
    <>
      <PageHead title="Staff Management" sub="Wafanyakazi wa DUKALANGU SOLUTION / CoopLink. Hawana access ya data za ndani za vyama.">
        <Button onClick={() => setCreating(true)} disabled={!cat.data}>+ Sajili mfanyakazi</Button>
      </PageHead>
      <Alert>{error ?? act.error}</Alert>
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Wafanyakazi hai" value={counts.active} hint={`${team.length} kwa jumla`} />
        <Kpi tone={counts.waiting ? 'warn' : undefined} label="Wanasubiri kuingia" value={counts.waiting} hint="Wametumiwa nenosiri la muda kwa SMS" />
        <Kpi tone={counts.no2fa ? 'warn' : 'gold'} label="Bila 2FA" value={counts.no2fa} hint="Washauri kuwasha 2FA kwenye Akaunti yangu" />
        <Kpi label="Waliozimwa" value={counts.off} hint="Historia yao inabaki" />
      </div>
      <div className="no-print" style={{ margin: '16px 0 8px' }}>
        <Tabs value={filter} onChange={setFilter} items={[['all', 'Wote'], ['active', 'Hai'], ['waiting', 'Wanasubiri kuingia'], ['off', 'Waliozimwa']]} />
      </div>
      {loading && !data ? <Loading /> : (
        <div className="staff-grid">
          {filter === 'all' && owners.map((s) => (
            <div key={s.id} className="staff-card owner">
              <span className="sc-av">{initials(s.fullName)}</span>
              <div className="sc-body"><b>{s.fullName}</b><span className="muted">{phone(s.phone)}</span><Pill value="ACTIVE" label={OWNER_ROLE_LABEL} /></div>
            </div>
          ))}
          {shown.length === 0 && filter !== 'all' && <Empty>Hakuna mfanyakazi kwenye kundi hili.</Empty>}
          {shown.map((s) => {
            const st = stateOf(s);
            return (
              <div key={s.id} className={`staff-card st-${st.key}`}>
                <span className="sc-av">{initials(s.fullName)}</span>
                <div className="sc-body">
                  <b>{s.fullName}</b>
                  <span className="muted">{ROLE_LABEL[s.role]}{s.jobTitle ? ` · ${s.jobTitle}` : ''}</span>
                  <span className="muted st-small">{phone(s.phone)}{s.email ? ` · ${s.email}` : ''}</span>
                  <span className={`sc-state ${st.key}`}>{st.label}</span>
                  <span className="sc-tags">
                    {s.totpEnabled ? <Pill value="ACTIVE" label="2FA" /> : s.isActive && <Pill value="neutral" label="Bila 2FA" />}
                    <Pill value="neutral" label={`Ruhusa ${s.permissions.length}${s.customPermissions ? ' (maalum)' : ''}`} />
                  </span>
                </div>
                <div className="sc-actions">
                  {s.isActive && (st.key === 'waiting' || st.key === 'expired') && <Button size="sm" variant={st.key === 'expired' ? 'primary' : 'secondary'} busy={act.busy} onClick={() => resend(s)}>Tuma nenosiri tena</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setSel(s)}>Simamia</Button>
                </div>
              </div>
            );
          })}
          {filter === 'all' && team.length === 0 && <Empty>Bado hakuna mfanyakazi. Bonyeza "Sajili mfanyakazi".</Empty>}
        </div>
      )}
      {creating && cat.data && <StaffWizard cat={cat.data} onClose={() => setCreating(false)} onSaved={() => reload()} />}
      {sel && cat.data && <StaffDetail staff={sel} cat={cat.data} onClose={() => setSel(null)} onChanged={(r) => { reload(); if (r) setSent({ name: sel.fullName, ...r }); }} />}
      {sent && <SentModal sent={sent} onClose={() => setSent(null)} />}
    </>
  );
}

/** Matokeo ya kutuma nenosiri: SMS imetumwa (Owner haoni nenosiri) au imeshindwa (nenosiri linaonyeshwa mara moja). */
function SentModal({ sent, onClose }: { sent: Sent; onClose: () => void }) {
  const ok = sent.delivery.status === 'SENT';
  return (
    <Modal open title={ok ? 'Nenosiri limetumwa kwa SMS' : 'SMS haikutumwa'} onClose={onClose} footer={<Button onClick={onClose}>{ok ? 'Sawa' : 'Nimelinakili'}</Button>}>
      <SentBody sent={sent} />
    </Modal>
  );
}
function SentBody({ sent }: { sent: Sent }) {
  const ok = sent.delivery.status === 'SENT';
  return ok ? (
    <div className="sent-ok">
      <span className="sent-ic" aria-hidden="true">✓</span>
      <p><strong>{sent.name}</strong> ametumiwa SMS kwenye <strong>{sent.delivery.phone}</strong> yenye namba ya kuingia na nenosiri la muda.</p>
      <ul className="sent-steps"><li>Aingie kwenye CoopLink kwa simu yake na nenosiri hilo.</li><li>Ataombwa kuweka nenosiri lake mwenyewe mara moja.</li><li>Nenosiri la muda linaisha baada ya <strong>saa 72</strong> — likiisha, bonyeza "Tuma nenosiri tena".</li></ul>
      <p className="muted st-small">🔐 Kwa usalama, nenosiri halionyeshwi hapa wala halihifadhiwi kwenye kumbukumbu za SMS.</p>
    </div>
  ) : (
    <>
      <Alert kind="warn">SMS haikutumwa kwa {sent.delivery.phone}{sent.delivery.error ? ` (${sent.delivery.error})` : ''}. Mpe <strong>{sent.name}</strong> nenosiri hili kwa njia salama — linaonyeshwa mara moja tu.</Alert>
      {sent.password && <div className="secret">{sent.password}</div>}
    </>
  );
}

// ------------------------------ USAJILI WA HATUA 3 ------------------------------
function StaffWizard({ cat, onClose, onSaved }: { cat: Catalog; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [ph, setPh] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<Role>(cat.roles[0]);
  const [custom, setCustom] = useState(false);
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const [done, setDone] = useState<Sent | null>(null);
  const [reactivate, setReactivate] = useState(false);
  const { busy, error, run } = useAction();
  // Namba moja = akaunti moja: inakaguliwa mapema (kabla ya hatua ya mwisho)
  const digits = ph.replace(/\D/g, '');
  const dph = useDebounced(digits.length >= 9 ? ph : '', 400);
  const check = useFetch<{ available: boolean; holder: { fullName: string; title: string; reusable: boolean; isMe: boolean; message: string } | null }>(dph ? '/owner/staff/phone-check' : null, { phone: dph });
  const holder = dph && check.data && !check.loading ? check.data.holder : null;
  const blocked = !!holder && !(holder.reusable && reactivate);
  const emailOk = !email || /^\S+@\S+\.\S+$/.test(email);
  const step1Ok = fullName.trim().length >= 3 && digits.length >= 9 && emailOk && !blocked && !!dph && !check.loading;
  const effective = perms ?? cat.roleDefaults[role] ?? [];
  const first = fullName.split(' ')[0] || 'Jina';
  const submit = async () => {
    const r = await run(() => api<{ staff: Staff; delivery: Delivery; temporaryPassword: string | null }>('/owner/staff', {
      method: 'POST', body: { fullName, phone: ph, email: email || null, jobTitle: jobTitle || null, role, permissions: custom ? perms : null, reactivate: holder?.reusable && reactivate ? true : undefined },
    }));
    if (r) { setDone({ name: r.staff.fullName, delivery: r.delivery, password: r.temporaryPassword }); onSaved(); }
  };
  const steps = ['Taarifa', 'Cheo na ruhusa', 'Thibitisha'];
  return (
    <Modal open size="lg" title={done ? 'Mfanyakazi amesajiliwa' : 'Sajili mfanyakazi wa CoopLink'} onClose={onClose}
      footer={done ? <Button onClick={onClose}>{done.delivery.status === 'SENT' ? 'Maliza' : 'Nimelinakili'}</Button> : <>
        {step > 0 ? <Button variant="secondary" onClick={() => setStep(step - 1)}>← Rudi</Button> : <Button variant="secondary" onClick={onClose}>Ghairi</Button>}
        {step < 2 ? <Button disabled={step === 0 && !step1Ok} onClick={() => setStep(step + 1)}>Endelea →</Button>
          : <Button busy={busy} onClick={submit}>{holder?.reusable && reactivate ? 'Rejesha na tuma SMS' : 'Sajili na tuma SMS'}</Button>}
      </>}>
      {done ? <SentBody sent={done} /> : (
        <>
          <ol className="wiz-steps">{steps.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''}><span>{i < step ? '✓' : i + 1}</span>{s}</li>)}</ol>
          <Alert>{error}</Alert>
          {step === 0 && (
            <div className="form-grid">
              <PhoneNameFields phoneLabel="Simu ya mfanyakazi *" phone={ph} onPhone={setPh} name={fullName} onName={(v) => setFullName(v)} autoFocus
                phoneHelp="Nenosiri la muda litatumwa kwa namba hii" />
              <div className="phone-check" aria-live="polite" style={{ gridColumn: '1 / -1' }}>
                {!dph ? null : check.loading ? <span className="muted st-small">Inakagua namba…</span>
                  : check.error ? <Alert>{check.error}</Alert>
                  : !holder ? <span className="pc-ok">✓ Namba hii iko wazi — inaweza kusajiliwa</span>
                  : <div className={`pc-taken ${holder.reusable ? 'reuse' : ''}`}>
                      <b>{holder.reusable ? 'Mfanyakazi wa zamani' : 'Namba hii haiwezi kutumika'}</b>
                      <span>{holder.message}</span>
                      {holder.reusable && <label className="chk"><input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} /> Rejesha akaunti ya {holder.fullName} (historia yake inabaki) na umpe cheo kipya</label>}
                    </div>}
              </div>
              <TextField label="Email (hiari)" type="email" value={email} onChange={setEmail} help={emailOk ? undefined : 'Email si sahihi'} />
              <TextField label="Wadhifa (hiari)" placeholder="mf. Afisa Mauzo — Tabora" value={jobTitle} onChange={setJobTitle} />
            </div>
          )}
          {step === 1 && (
            <>
              <div className="role-cards" role="radiogroup" aria-label="Cheo">
                {cat.roles.map((r) => {
                  const info = ROLE_INFO[r];
                  return (
                    <label key={r} className={`role-card ${role === r ? 'on' : ''}`}>
                      <input type="radio" name="role" checked={role === r} onChange={() => { setRole(r); setPerms(null); setCustom(false); }} />
                      <span className="rc-ic" aria-hidden="true">{info?.icon ?? '👤'}</span>
                      <b>{ROLE_LABEL[r]}</b>
                      <span className="muted st-small">{info?.blurb}</span>
                      <ul>{(info?.does ?? []).map((d) => <li key={d}>{d}</li>)}</ul>
                    </label>
                  );
                })}
              </div>
              <label className="chk" style={{ marginTop: 14 }}><input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setPerms(e.target.checked ? [...(cat.roleDefaults[role] ?? [])] : null); }} /> Rekebisha ruhusa (hiari)</label>
              {custom && <PermissionPicker cat={cat} role={role} value={perms} onChange={setPerms} />}
              <p className="muted st-small">Msaada wa kiufundi (mfumo, backup, usalama) unabaki kwa Owner.</p>
            </>
          )}
          {step === 2 && (
            <div className="wiz-review">
              <dl className="dl">
                <dt>Jina</dt><dd>{fullName}</dd>
                <dt>Simu</dt><dd>{ph}</dd>
                {email && <><dt>Email</dt><dd>{email}</dd></>}
                {jobTitle && <><dt>Wadhifa</dt><dd>{jobTitle}</dd></>}
                <dt>Cheo</dt><dd>{ROLE_LABEL[role]}</dd>
                <dt>Ruhusa</dt><dd>{effective.length}{custom ? ' (maalum)' : ' (za kawaida za cheo)'}</dd>
              </dl>
              <div className="sms-preview" aria-label="Hakikisho la SMS">
                <span className="muted st-small">SMS itakayotumwa kwa {ph}</span>
                <p>CoopLink: Karibu {first}! Umesajiliwa kama {ROLE_LABEL[role]}. Ingia: …/login Simu: {ph} Nenosiri la muda: <b>••••••••</b> (linaisha baada ya saa 72). Utaweka nenosiri lako. Usimpe mtu yeyote.</p>
              </div>
              <p className="muted st-small">🔐 Owner haoni nenosiri. SMS ikishindwa kutumwa, nenosiri litaonyeshwa hapa mara moja ili umpe kwa njia salama.</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function PermissionPicker({ cat, role, value, onChange }: { cat: Catalog; role: Role; value: Permission[] | null; onChange: (v: Permission[] | null) => void }) {
  const custom = value !== null;
  const effective = value ?? cat.roleDefaults[role] ?? [];
  const all = (Object.keys(cat.permissions) as Permission[]).filter((p) => p !== 'staff.manage');
  return (
    <fieldset className="perm-box">
      <legend>Ruhusa</legend>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={custom} onChange={(e) => onChange(e.target.checked ? [...effective] : null)} />
        Weka ruhusa maalum (bila hivyo zinatumika ruhusa za kawaida za {ROLE_LABEL[role]})
      </label>
      <div className="perm-grid">
        {all.map((p) => (
          <label key={p} className={custom ? '' : 'muted'}>
            <input type="checkbox" disabled={!custom} checked={effective.includes(p)}
              onChange={(e) => onChange(e.target.checked ? [...effective, p] : effective.filter((x) => x !== p))} />
            {cat.permissions[p]}
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>"Kusimamia wafanyakazi" ni ya Owner pekee na haitolewi kwa mfanyakazi.</p>
    </fieldset>
  );
}

function StaffDetail({ staff, cat, onClose, onChanged }: { staff: Staff; cat: Catalog; onClose: () => void; onChanged: (r?: { delivery: Delivery; password: string | null }) => void }) {
  const [tab, setTab] = useState<'edit' | 'logins' | 'activity'>('edit');
  const [fullName, setFullName] = useState(staff.fullName);
  const [jobTitle, setJobTitle] = useState(staff.jobTitle ?? '');
  const [role, setRole] = useState<Role>(staff.role);
  const [perms, setPerms] = useState<Permission[] | null>(staff.customPermissions ? staff.permissions : null);
  const logins = useFetch<{ data: { id: string; success: boolean; reason: string; ip: string | null; createdAt: string; suspicious: boolean }[] }>(tab === 'logins' ? `/owner/staff/${staff.id}/logins` : null);
  const activity = useFetch<{ data: { id: string; action: string; entity: string; createdAt: string }[] }>(tab === 'activity' ? `/owner/staff/${staff.id}/activity` : null);
  const act = useAction();
  return (
    <Modal open title={staff.fullName} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} items={[['edit', 'Taarifa na ruhusa'], ['logins', 'Historia ya kuingia'], ['activity', 'Shughuli']]} />
      <Alert>{act.error}</Alert>
      {tab === 'edit' && (
        <>
          <div className="form-grid">
            <LockedNameField label="Jina" phone={staff.phone} value={fullName} onChange={setFullName} />
            <TextField label="Cheo" value={jobTitle} onChange={setJobTitle} />
            <SelectField label="Role" value={role} onChange={(v) => { setRole(v as Role); setPerms(null); }}
              options={[...(cat.roles.includes(staff.role) ? [] : [{ value: staff.role, label: `${ROLE_LABEL[staff.role]} (cheo cha zamani)` }]), ...cat.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
          </div>
          <PermissionPicker cat={cat} role={role} value={perms} onChange={setPerms} />
          <p className="muted st-small">Amesajiliwa {date(staff.createdAt)}. Ukibadilisha cheo au ruhusa, atatolewa kwenye vifaa vyote na kuingia upya. Nenosiri jipya linatumwa kwa SMS kwake moja kwa moja.</p>
          <div className="actions">
            <Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/staff/${staff.id}`, { method: 'PATCH', body: { fullName, jobTitle: jobTitle || null, ...(role !== staff.role ? { role } : {}), permissions: perms } }))) { onChanged(); onClose(); } }}>Hifadhi</Button>
            {staff.isActive && <Button variant="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api<{ delivery: Delivery; temporaryPassword: string | null }>(`/owner/staff/${staff.id}/reset-password`, { method: 'POST' })); if (r) { onChanged({ delivery: r.delivery, password: r.temporaryPassword }); onClose(); } }}>Tuma nenosiri jipya kwa SMS</Button>}
            <Button variant={staff.isActive ? 'danger' : 'primary'} busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/staff/${staff.id}/active`, { method: 'POST', body: { isActive: !staff.isActive } }))) { onChanged(); onClose(); } }}>
              {staff.isActive ? 'Zima akaunti' : 'Washa akaunti'}
            </Button>
          </div>
        </>
      )}
      {tab === 'logins' && (logins.loading ? <Loading /> : (
        <table className="table"><tbody>
          {logins.data?.data.length === 0 && <tr><td className="muted">Hajawahi kuingia.</td></tr>}
          {logins.data?.data.map((e) => <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td>{e.success ? <Pill value="SUCCESS" /> : <Pill value="FAILED" label={e.reason} />}{e.suspicious && <> <Pill value="PENDING" label="Isiyo ya kawaida" /></>}</td><td className="muted">{e.ip ?? ''}</td></tr>)}
        </tbody></table>
      ))}
      {tab === 'activity' && (activity.loading ? <Loading /> : (
        <table className="table"><tbody>
          {activity.data?.data.length === 0 && <tr><td className="muted">Hakuna shughuli bado.</td></tr>}
          {activity.data?.data.map((e) => <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td>{e.action}</td><td className="muted">{e.entity}</td></tr>)}
        </tbody></table>
      ))}
    </Modal>
  );
}
