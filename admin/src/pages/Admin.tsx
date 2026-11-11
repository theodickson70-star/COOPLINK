// Madeni, Watumiaji, Vyama na Misimu, Audit log
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { date, dateTime, phone, ROLE_LABEL, tsh } from '../lib/format';
import { useAuth, type Role } from '../lib/auth';
import { PhoneNameFields } from '../components/PhoneName';
import { Alert, Badge, Button, Empty, Input, Loading, Modal, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';

// ------------------------------ MADENI ------------------------------
interface BalanceRow { memberId: string; memberNo: string; firstName: string; lastName: string; village: string | null; totalDebit: string; totalCredit: string; balance: string }

export function Balances() {
  const [onlyOwing, setOnlyOwing] = useState(true);
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<Paged<BalanceRow>>('/reports/member-balances', { onlyOwing, page, pageSize: 50 });
  return (
    <>
      <PageHead title="Madeni na Salio" sub="Salio la kila mwanachama kutoka kwenye ledger. Hasi maana yake ana deni.">
        <Button variant="secondary" onClick={() => window.print()} className="no-print">Chapisha</Button>
      </PageHead>
      <Alert>{error}</Alert>
      <section className="card">
        <div className="toolbar no-print">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyOwing} onChange={(e) => { setOnlyOwing(e.target.checked); setPage(1); }} /> Wenye madeni tu
          </label>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna rekodi.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mwanachama</th><th>Kijiji</th><th className="num">Deni (Dr)</th><th className="num">Mapato (Cr)</th><th className="num">Salio</th></tr></thead>
              <tbody>
                {data?.data.map((r) => (
                  <tr key={r.memberId}>
                    <td><Link className="row-link" to={`/members/${r.memberId}`}>{r.firstName} {r.lastName}</Link><div className="muted" style={{ fontSize: 13 }}>{r.memberNo}</div></td>
                    <td>{r.village ?? '—'}</td>
                    <td className="num">{tsh(r.totalDebit)}</td>
                    <td className="num">{tsh(r.totalCredit)}</td>
                    <td className={`num ${Number(r.balance) < 0 ? 'money-neg' : 'money-pos'}`}>{tsh(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
    </>
  );
}

// ------------------------------ WATUMIAJI ------------------------------
interface UserRow { id: string; fullName: string; phone: string; email: string | null; role: Role; amcosId: string | null; unionId: string | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null }

// Watumishi wa AMCOS (Meneja, Mhasibu, Storekeeper) wanaundwa na Owner kwenye AMCOS Management — mmoja kwa kila cheo.
const CREATABLE: Record<string, Role[]> = {
  SUPER_ADMIN: ['UNION_ADMIN', 'UNION_VIEWER'],
  UNION_ADMIN: ['UNION_ADMIN', 'UNION_VIEWER'],
};

export function Users() {
  const { user } = useAuth();
  const manage = (CREATABLE[user?.role ?? ''] ?? []).length > 0;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useFetch<Paged<UserRow>>('/users', { search: q, page, pageSize: 25 });
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ name: string; phone: string; password: string } | null>(null);
  const act = useAction();

  const reset = async (u: UserRow) => {
    const r = await act.run(() => api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }));
    if (r) setSecret({ name: u.fullName, phone: u.phone, password: r.temporaryPassword });
  };
  const toggle = async (u: UserRow) => {
    const r = await act.run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }));
    if (r) reload();
  };

  return (
    <>
      <PageHead title={manage ? 'Watumiaji' : 'Watumishi wa chama'} sub={manage ? 'Watumiaji wa Chama Kikuu' : 'Meneja, Mhasibu na Storekeeper. Akaunti zinasimamiwa na CoopLink (Owner) — wasiliana nao kubadilisha mtumishi au nenosiri.'}>
        {manage && <Button onClick={() => setOpen(true)}>+ Mtumiaji mpya</Button>}
      </PageHead>
      <Alert>{error ?? act.error}</Alert>
      <section className="card">
        <div className="toolbar"><Input aria-label="Tafuta" placeholder="Tafuta jina au simu…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        {loading && !data ? <Loading /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Jina</th><th>Simu</th><th>Wadhifa</th><th>Aliingia mwisho</th><th>Hali</th><th /></tr></thead>
              <tbody>
                {data?.data.map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.fullName}</strong>{u.mustChangePassword && <div className="muted" style={{ fontSize: 12 }}>Bado hajabadilisha nenosiri la muda</div>}</td>
                    <td>{phone(u.phone)}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
                    <td><Badge status={u.isActive ? 'ACTIVE' : 'CANCELLED'} label={u.isActive ? 'Hai' : 'Amezimwa'} /></td>
                    <td className="num">
                      {manage && u.id !== user?.id && (CREATABLE[user?.role ?? ''] ?? []).includes(u.role) && (
                        <span className="actions" style={{ justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="secondary" busy={act.busy} onClick={() => reset(u)}>Nenosiri jipya</Button>
                          <Button size="sm" variant="ghost" busy={act.busy} onClick={() => toggle(u)}>{u.isActive ? 'Zima' : 'Washa'}</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
      <NewUser open={open} onClose={() => setOpen(false)} onCreated={(s) => { setOpen(false); setSecret(s); reload(); }} />
      <Modal open={!!secret} title="Nenosiri la muda" onClose={() => setSecret(null)} footer={<Button onClick={() => setSecret(null)}>Nimelinakili</Button>}>
        <p style={{ margin: 0 }}>Mpe <strong>{secret?.name}</strong> ({phone(secret?.phone)}) nenosiri hili. Ataombwa kulibadilisha akiingia mara ya kwanza.</p>
        <div className="secret">{secret?.password}</div>
        <Alert kind="warn">Nenosiri hili linaonyeshwa mara moja tu. Usilitume kwenye kikundi cha WhatsApp.</Alert>
      </Modal>
    </>
  );
}

function NewUser({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (s: { name: string; phone: string; password: string }) => void }) {
  const { user } = useAuth();
  const roles = CREATABLE[user?.role ?? ''] ?? [];
  const [fullName, setFullName] = useState('');
  const [ph, setPh] = useState('');
  const [role, setRole] = useState<Role>(roles[0]);
  const [amcosId, setAmcosId] = useState('');
  const [unionId, setUnionId] = useState(user?.unionId ?? '');
  const needsAmcos = ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK', 'AMCOS_VIEWER'].includes(role) && !user?.amcosId;
  const needsUnion = ['UNION_ADMIN', 'UNION_VIEWER'].includes(role) && user?.role === 'SUPER_ADMIN';
  const amcos = useFetch<Paged<{ id: string; name: string; code: string }>>(open && needsAmcos ? '/amcos' : null, { pageSize: 100 });
  const unions = useFetch<{ data: { id: string; name: string }[] }>(open && needsUnion ? '/unions' : null);
  const { busy, error, run } = useAction();

  const save = async () => {
    const r = await run(() => api<{ user: UserRow; temporaryPassword: string }>('/users', {
      method: 'POST',
      body: { fullName, phone: ph, role, amcosId: needsAmcos ? amcosId : undefined, unionId: needsUnion ? unionId : undefined },
    }));
    if (r) { setFullName(''); setPh(''); onCreated({ name: r.user.fullName, phone: r.user.phone, password: r.temporaryPassword }); }
  };
  return (
    <Modal open={open} title="Mtumiaji mpya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={fullName.length < 3 || !ph || (needsAmcos && !amcosId) || (needsUnion && !unionId)} onClick={save}>Unda mtumiaji</Button></>}>
      <Alert>{error}</Alert>
      <PhoneNameFields phoneLabel="Namba ya simu *" phoneHelp="Atatumia namba hii kuingia" phone={ph} onPhone={setPh} nameLabel="Jina kamili" name={fullName} onName={(v) => setFullName(v)} />
      <SelectField label="Wadhifa *" value={role} onChange={(v) => setRole(v as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      {needsAmcos && <SelectField label="Chama *" value={amcosId} onChange={setAmcosId} placeholder="Chagua chama…" options={(amcos.data?.data ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.code})` }))} />}
      {needsUnion && <SelectField label="Chama Kikuu *" value={unionId} onChange={setUnionId} placeholder="Chagua Union…" options={(unions.data?.data ?? []).map((u) => ({ value: u.id, label: u.name }))} />}
    </Modal>
  );
}

// ------------------------------ VYAMA NA MISIMU ------------------------------
interface Season { id: string; name: string; startDate: string; endDate: string; status: string; isCurrent: boolean }

export function Organizations() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const amcos = useFetch<Paged<{ id: string; name: string; code: string; district: string | null; region: string | null; isActive: boolean; unionId: string | null }>>('/amcos', { pageSize: 100 });
  const unions = useFetch<{ data: { id: string; name: string; code: string; region: string | null }[] }>('/unions');
  const seasons = useFetch<{ data: Season[] }>('/seasons');
  const [modal, setModal] = useState<'amcos' | 'union' | 'season' | null>(null);
  const act = useAction();
  const makeCurrent = async (s: Season) => {
    const r = await act.run(() => api(`/seasons/${s.id}`, { method: 'PATCH', body: { isCurrent: true } }));
    if (r) seasons.reload();
  };

  return (
    <>
      <PageHead title="Vyama na Misimu" sub="Vyama Vikuu, Vyama vya Msingi na misimu ya tumbaku">
        <Button onClick={() => setModal('amcos')}>+ Chama cha Msingi</Button>
        {isSuper && <Button variant="secondary" onClick={() => setModal('union')}>+ Chama Kikuu</Button>}
        {isSuper && <Button variant="secondary" onClick={() => setModal('season')}>+ Msimu</Button>}
      </PageHead>
      <Alert>{act.error}</Alert>
      <div className="stack">
        <section className="card">
          <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Vyama vya Msingi (AMCOS)</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Jina</th><th>Code</th><th>Wilaya</th><th>Chama Kikuu</th><th>Hali</th></tr></thead>
              <tbody>
                {amcos.data?.data.map((a) => (
                  <tr key={a.id}><td><strong>{a.name}</strong></td><td>{a.code}</td><td>{[a.district, a.region].filter(Boolean).join(', ') || '—'}</td>
                    <td>{unions.data?.data.find((u) => u.id === a.unionId)?.name ?? '—'}</td>
                    <td><Badge status={a.isActive ? 'ACTIVE' : 'CANCELLED'} label={a.isActive ? 'Hai' : 'Kimesitishwa'} /></td></tr>
                ))}
                {amcos.data?.data.length === 0 && <tr><td colSpan={5} className="muted">Bado hakuna chama.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <div className="grid grid-2">
          <section className="card">
            <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Vyama Vikuu (Unions)</h2></div>
            <div className="table-wrap"><table className="table"><tbody>
              {unions.data?.data.map((u) => <tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.code}</td><td>{u.region ?? '—'}</td></tr>)}
            </tbody></table></div>
          </section>
          <section className="card">
            <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Misimu</h2></div>
            <div className="table-wrap"><table className="table"><tbody>
              {seasons.data?.data.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.isCurrent && <> <span className="badge badge-ok">Wa sasa</span></>}<div className="muted" style={{ fontSize: 13 }}>{date(s.startDate)} – {date(s.endDate)}</div></td>
                  <td><Badge status={s.status} /></td>
                  <td className="num">{isSuper && !s.isCurrent && <Button size="sm" variant="ghost" busy={act.busy} onClick={() => makeCurrent(s)}>Fanya wa sasa</Button>}</td>
                </tr>
              ))}
            </tbody></table></div>
          </section>
        </div>
      </div>
      {modal === 'amcos' && <AmcosModal unions={unions.data?.data ?? []} isSuper={isSuper} onClose={() => setModal(null)} onDone={() => { setModal(null); amcos.reload(); }} />}
      {modal === 'union' && <UnionModal onClose={() => setModal(null)} onDone={() => { setModal(null); unions.reload(); }} />}
      {modal === 'season' && <SeasonModal onClose={() => setModal(null)} onDone={() => { setModal(null); seasons.reload(); }} />}
    </>
  );
}

function AmcosModal({ unions, isSuper, onClose, onDone }: { unions: { id: string; name: string }[]; isSuper: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', code: '', regNumber: '', region: 'Tabora', district: '', ward: '', village: '', unionId: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const { busy, error, run } = useAction();
  const save = async () => {
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
    const r = await run(() => api('/amcos', { method: 'POST', body }));
    if (r) onDone();
  };
  return (
    <Modal open title="Chama kipya cha Msingi" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={f.name.trim().length < 3} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina la chama *" value={f.name} onChange={set('name')} />
      <TextField label="Code" help="Itatolewa na mfumo kutoka jina la chama (mf. Usoke AMCOS → USOKE)" value="Itatolewa na mfumo" disabled onChange={() => undefined} />
      <TextField label="Namba ya usajili (Mrajis)" value={f.regNumber} onChange={set('regNumber')} />
      <div className="form-grid">
        <TextField label="Mkoa" value={f.region} onChange={set('region')} />
        <TextField label="Wilaya" value={f.district} onChange={set('district')} />
        <TextField label="Kata" value={f.ward} onChange={set('ward')} />
        <TextField label="Kijiji" value={f.village} onChange={set('village')} />
      </div>
      {isSuper && <SelectField label="Chama Kikuu" value={f.unionId} onChange={set('unionId')} placeholder="— Hakuna —" options={unions.map((u) => ({ value: u.id, label: u.name }))} />}
    </Modal>
  );
}

function UnionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [region, setRegion] = useState('Tabora');
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/unions', { method: 'POST', body: { name, code, region: region || undefined } }));
    if (r) onDone();
  };
  return (
    <Modal open title="Chama Kikuu kipya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={name.length < 3 || code.length < 2} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina *" value={name} onChange={setName} />
      <TextField label="Code *" placeholder="mf. WETCU" value={code} onChange={(v) => setCode(v.toUpperCase())} />
      <TextField label="Mkoa" value={region} onChange={setRegion} />
    </Modal>
  );
}

function SeasonModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const y = new Date().getFullYear();
  const [name, setName] = useState(`${y}/${y + 1}`);
  const [startDate, setStart] = useState(`${y}-07-01`);
  const [endDate, setEnd] = useState(`${y + 1}-06-30`);
  const { busy, error, run } = useAction();
  const save = async () => {
    const r = await run(() => api('/seasons', { method: 'POST', body: { name, startDate, endDate } }));
    if (r) onDone();
  };
  return (
    <Modal open title="Msimu mpya" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} onClick={save}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <TextField label="Jina *" placeholder="2027/2028" value={name} onChange={setName} />
      <TextField label="Unaanza" type="date" value={startDate} onChange={setStart} />
      <TextField label="Unaisha" type="date" value={endDate} onChange={setEnd} />
    </Modal>
  );
}

// ------------------------------ AUDIT ------------------------------
interface Log { id: string; action: string; entity: string; entityId: string | null; createdAt: string; ip: string | null; user: { fullName: string; role: string } | null }

const ACTION_LABEL: Record<string, string> = {
  MEMBER_CREATE: 'Amesajili mwanachama', MEMBER_UPDATE: 'Amehariri mwanachama', MEMBER_STATUS_CHANGE: 'Amebadilisha hali ya mwanachama',
  FARM_CREATE: 'Ameongeza shamba', FARM_UPDATE: 'Amehariri shamba', ESTIMATE_CREATE: 'Ameongeza makisio', ESTIMATE_UPDATE: 'Amehariri makisio',
  ESTIMATE_APPROVED: 'Ameidhinisha makisio', ESTIMATE_REJECTED: 'Amekataa makisio', INPUT_ITEM_CREATE: 'Ameongeza aina ya pembejeo',
  INPUT_ITEM_UPDATE: 'Amehariri pembejeo', INPUT_PRICE_SET: 'Ameweka bei ya pembejeo', STOCK_RECEIPT: 'Amepokea stoo',
  STOCK_ADJUSTMENT: 'Amerekebisha stoo', INPUT_ISSUE_CREATE: 'Ametoa pembejeo', INPUT_ISSUE_CANCEL: 'Amefuta utoaji wa pembejeo',
  USER_CREATE: 'Ameunda mtumiaji', USER_UPDATE: 'Amehariri mtumiaji', USER_PASSWORD_RESET: 'Ametoa nenosiri jipya', PASSWORD_CHANGE: 'Amebadilisha nenosiri',
  AMCOS_CREATE: 'Ameunda chama', AMCOS_UPDATE: 'Amehariri chama', UNION_CREATE: 'Ameunda Chama Kikuu', SEASON_CREATE: 'Ameunda msimu', SEASON_UPDATE: 'Amebadilisha msimu',
};

export function Audit() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<Paged<Log>>('/audit-logs', { action, page, pageSize: 50 });
  return (
    <>
      <PageHead title="Kumbukumbu za ukaguzi" sub="Kila kitendo muhimu kinarekodiwa: nani, nini, na lini. Kumbukumbu hizi haziwezi kufutwa." />
      <Alert>{error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Kitendo" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">Vitendo vyote</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna kumbukumbu.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Wakati</th><th>Mtumiaji</th><th>Kitendo</th><th>Rekodi</th></tr></thead>
              <tbody>
                {data?.data.map((l) => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(l.createdAt)}</td>
                    <td>{l.user?.fullName ?? 'Mfumo'}<div className="muted" style={{ fontSize: 12 }}>{l.user ? ROLE_LABEL[l.user.role] : ''}</div></td>
                    <td>{ACTION_LABEL[l.action] ?? l.action}</td>
                    <td className="muted">{l.entity === 'Member' && l.entityId ? <Link to={`/members/${l.entityId}`}>Mwanachama</Link> : l.entity === 'InputIssue' && l.entityId ? <Link to={`/input-issues/${l.entityId}`}>Utoaji</Link> : l.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
    </>
  );
}
