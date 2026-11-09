import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import type { Permission, Role } from '../lib/auth';
import { dateTime, phone, ROLE_LABEL, OWNER_ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { LockedNameField, PhoneNameFields } from '../components/PhoneName';
import { Pill, Tabs } from '../components/owner-ui';

interface Staff {
  id: string; fullName: string; phone: string; email: string | null; role: Role; jobTitle: string | null; isActive: boolean;
  mustChangePassword: boolean; totpEnabled: boolean; lastLoginAt: string | null; permissions: Permission[]; customPermissions: boolean;
}
interface Catalog { permissions: Record<Permission, string>; roleDefaults: Record<string, Permission[]>; roles: Role[] }

export function OwnerStaff() {
  const { data, error, loading, reload } = useFetch<{ data: Staff[] }>('/owner/staff');
  const cat = useFetch<Catalog>('/owner/staff/permissions');
  const [creating, setCreating] = useState(false);
  const [sel, setSel] = useState<Staff | null>(null);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);

  return (
    <>
      <PageHead title="Staff Management" sub="Wafanyakazi wa NAYA GROUP / CoopLink. Hawana access ya data za vyama.">
        <Button onClick={() => setCreating(true)}>+ Mfanyakazi mpya</Button>
      </PageHead>
      <Alert>{error}</Alert>
      <section className="card">
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna wafanyakazi.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Jina</th><th>Wadhifa</th><th>Simu</th><th>Ruhusa</th><th>2FA</th><th>Aliingia mwisho</th><th>Hali</th><th /></tr></thead>
            <tbody>{data?.data.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.fullName}</strong><div className="muted" style={{ fontSize: 13 }}>{s.jobTitle ?? ''}</div></td>
                <td>{s.role === 'SUPER_ADMIN' ? <Pill value="ACTIVE" label={OWNER_ROLE_LABEL} /> : ROLE_LABEL[s.role]}</td>
                <td>{phone(s.phone)}</td>
                <td>{s.role === 'SUPER_ADMIN' ? 'Zote' : `${s.permissions.length}${s.customPermissions ? ' (maalum)' : ''}`}</td>
                <td>{s.totpEnabled ? <Pill value="ACTIVE" label="Imewashwa" /> : <span className="muted">Hapana</span>}</td>
                <td>{s.lastLoginAt ? dateTime(s.lastLoginAt) : '—'}</td>
                <td>{s.isActive ? <Pill value="ACTIVE" /> : <Pill value="CANCELLED" label="Amezimwa" />}{s.mustChangePassword && <div className="muted" style={{ fontSize: 12 }}>Nenosiri la muda</div>}</td>
                <td className="num">{s.role !== 'SUPER_ADMIN' && <Button size="sm" variant="secondary" onClick={() => setSel(s)}>Simamia</Button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {creating && cat.data && <StaffForm cat={cat.data} onClose={() => setCreating(false)} onSaved={(name, pw) => { setCreating(false); reload(); if (pw) setSecret({ name, password: pw }); }} />}
      {sel && cat.data && <StaffDetail staff={sel} cat={cat.data} onClose={() => setSel(null)} onChanged={(pw) => { reload(); if (pw) setSecret({ name: sel.fullName, password: pw }); }} />}
      <Modal open={!!secret} title="Nenosiri la muda" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Nimelinakili</Button>}>
        <p style={{ margin: 0 }}>Mpe <strong>{secret?.name}</strong> nenosiri hili. Ataombwa kulibadilisha akiingia.</p>
        <div className="secret">{secret?.password}</div>
        <Alert kind="warn">Linaonyeshwa mara moja tu.</Alert>
      </Modal>
    </>
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

function StaffForm({ cat, onClose, onSaved }: { cat: Catalog; onClose: () => void; onSaved: (name: string, pw?: string) => void }) {
  const [fullName, setFullName] = useState('');
  const [ph, setPh] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<Role>('CUSTOMER_SUPPORT');
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Mfanyakazi mpya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={fullName.length < 3 || !ph} onClick={async () => {
        const r = await run(() => api<{ temporaryPassword: string }>('/owner/staff', { method: 'POST', body: { fullName, phone: ph, email: email || null, jobTitle: jobTitle || null, role, permissions: perms } }));
        if (r) onSaved(fullName, r.temporaryPassword);
      }}>Unda</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <PhoneNameFields phoneLabel="Simu *" phone={ph} onPhone={setPh} name={fullName} onName={(v) => setFullName(v)} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <TextField label="Cheo" placeholder="mf. Afisa Mauzo" value={jobTitle} onChange={setJobTitle} />
        <SelectField label="Role *" value={role} onChange={(v) => { setRole(v as Role); setPerms(null); }} options={cat.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      </div>
      <PermissionPicker cat={cat} role={role} value={perms} onChange={setPerms} />
    </Modal>
  );
}

function StaffDetail({ staff, cat, onClose, onChanged }: { staff: Staff; cat: Catalog; onClose: () => void; onChanged: (pw?: string) => void }) {
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
            <SelectField label="Role" value={role} onChange={(v) => { setRole(v as Role); setPerms(null); }} options={cat.roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </div>
          <PermissionPicker cat={cat} role={role} value={perms} onChange={setPerms} />
          <Alert kind="warn">Ukibadilisha role au ruhusa, mfanyakazi atatolewa kwenye vifaa vyote na kuingia upya.</Alert>
          <div className="actions">
            <Button busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/staff/${staff.id}`, { method: 'PATCH', body: { fullName, jobTitle: jobTitle || null, role, permissions: perms } }))) { onChanged(); onClose(); } }}>Hifadhi</Button>
            <Button variant="secondary" busy={act.busy} onClick={async () => { const r = await act.run(() => api<{ temporaryPassword: string }>(`/owner/staff/${staff.id}/reset-password`, { method: 'POST' })); if (r) { onChanged(r.temporaryPassword); onClose(); } }}>Nenosiri jipya</Button>
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
