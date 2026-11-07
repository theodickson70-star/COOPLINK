import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { date, phone } from '../lib/format';
import { useAuth, ROLE_GROUPS } from '../lib/auth';
import { Alert, Badge, Button, Empty, Input, Loading, PageHead, Pager, Select, SelectField, TextField } from '../components/ui';

export interface Member {
  id: string; memberNo: string; firstName: string; middleName: string | null; lastName: string; gender: 'MALE' | 'FEMALE';
  dateOfBirth: string | null; nidaNumber: string | null; phone: string | null; village: string | null; hamlet: string | null;
  status: string; joinedAt: string; mobileMoneyNumber: string | null; mobileMoneyProvider: string | null; mobileMoneyName: string | null;
  bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; preferredPayment: string;
  sharesCount: number; nextOfKinName: string | null; nextOfKinPhone: string | null; nextOfKinRelation: string | null; amcosId: string;
}

export function Members() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, error, loading } = useFetch<Paged<Member>>('/members', { search: q, status, page, pageSize: 25 });

  return (
    <>
      <PageHead title="Wanachama" sub="Orodha ya wanachama wote wa chama">
        {can(...ROLE_GROUPS.STAFF) && <Link className="btn btn-primary" to="/members/new">+ Sajili mwanachama</Link>}
      </PageHead>
      <section className="card">
        <div className="toolbar">
          <Input aria-label="Tafuta" placeholder="Tafuta jina, namba, simu au NIDA…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Hali zote</option>
            <option value="ACTIVE">Hai</option>
            <option value="SUSPENDED">Amesimamishwa</option>
            <option value="EXITED">Ametoka</option>
            <option value="DECEASED">Marehemu</option>
          </Select>
        </div>
        {error && <div className="card-pad"><Alert>{error}</Alert></div>}
        {loading && !data ? <Loading /> : data && data.data.length === 0 ? <Empty>Hakuna mwanachama aliyepatikana.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Namba</th><th>Jina</th><th>Simu</th><th>Kijiji</th><th>Alijiunga</th><th>Hali</th></tr></thead>
              <tbody>
                {data?.data.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{m.memberNo}</td>
                    <td><Link className="row-link" to={`/members/${m.id}`}>{m.firstName} {m.lastName}</Link></td>
                    <td>{phone(m.phone)}</td>
                    <td>{m.village ?? '—'}</td>
                    <td>{date(m.joinedAt)}</td>
                    <td><Badge status={m.status} /></td>
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

const EMPTY = {
  firstName: '', middleName: '', lastName: '', gender: 'MALE', dateOfBirth: '', nidaNumber: '', phone: '', village: '', hamlet: '',
  mobileMoneyNumber: '', mobileMoneyProvider: 'MPESA', mobileMoneyName: '', bankName: '', bankAccountName: '', bankAccountNumber: '',
  preferredPayment: 'MOBILE_MONEY', sharesCount: '0', nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelation: '',
};
type Form = typeof EMPTY;

export function toPayload(f: Form) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (k === 'sharesCount') out[k] = Number(v || 0);
    else out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  }
  if (!out.mobileMoneyNumber) out.mobileMoneyProvider = null;
  return out;
}

export function fromMember(m: Member): Form {
  const f = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Form)[]) {
    const v = (m as unknown as Record<string, unknown>)[k];
    f[k] = v === null || v === undefined ? (k === 'mobileMoneyProvider' ? 'MPESA' : '') : String(v);
  }
  if (f.phone) f.phone = f.phone.replace(/^255/, '0');
  if (f.mobileMoneyNumber) f.mobileMoneyNumber = f.mobileMoneyNumber.replace(/^255/, '0');
  if (f.nextOfKinPhone) f.nextOfKinPhone = f.nextOfKinPhone.replace(/^255/, '0');
  return f;
}

export function MemberForm({ initial, onSubmit, submitLabel, busy, error }: {
  initial?: Form; onSubmit: (payload: Record<string, unknown>) => void; submitLabel: string; busy: boolean; error: string | null;
}) {
  const [f, setF] = useState<Form>(initial ?? EMPTY);
  const set = (k: keyof Form) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(toPayload(f));
  };
  return (
    <form onSubmit={submit} className="stack">
      <Alert>{error}</Alert>
      <section className="card card-pad">
        <div className="form-grid">
          <div className="form-section">Taarifa binafsi</div>
          <TextField label="Jina la kwanza *" value={f.firstName} onChange={set('firstName')} required />
          <TextField label="Jina la kati" value={f.middleName} onChange={set('middleName')} />
          <TextField label="Jina la ukoo *" value={f.lastName} onChange={set('lastName')} required />
          <SelectField label="Jinsia *" value={f.gender} onChange={set('gender')} options={[{ value: 'MALE', label: 'Mwanaume' }, { value: 'FEMALE', label: 'Mwanamke' }]} />
          <TextField label="Tarehe ya kuzaliwa" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
          <TextField label="Namba ya NIDA" help="Tarakimu 20" inputMode="numeric" value={f.nidaNumber} onChange={set('nidaNumber')} />
          <TextField label="Simu" type="tel" placeholder="0712 345 678" value={f.phone} onChange={set('phone')} />
          <TextField label="Kijiji" value={f.village} onChange={set('village')} />
          <TextField label="Kitongoji" value={f.hamlet} onChange={set('hamlet')} />
          <TextField label="Idadi ya hisa" type="number" min={0} value={f.sharesCount} onChange={set('sharesCount')} />

          <div className="form-section">Malipo</div>
          <SelectField label="Njia ya malipo" value={f.preferredPayment} onChange={set('preferredPayment')}
            options={[{ value: 'MOBILE_MONEY', label: 'Simu (M-Pesa n.k.)' }, { value: 'BANK', label: 'Benki' }, { value: 'CASH', label: 'Taslimu' }]} />
          <SelectField label="Mtandao wa simu" value={f.mobileMoneyProvider} onChange={set('mobileMoneyProvider')}
            options={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'AIRTEL_MONEY', label: 'Airtel Money' }, { value: 'MIXX_BY_YAS', label: 'Mixx by Yas' }, { value: 'HALOPESA', label: 'HaloPesa' }, { value: 'TPESA', label: 'T-Pesa' }]} />
          <TextField label="Namba ya malipo ya simu" type="tel" value={f.mobileMoneyNumber} onChange={set('mobileMoneyNumber')} />
          <TextField label="Jina lililosajiliwa kwenye namba" value={f.mobileMoneyName} onChange={set('mobileMoneyName')} />
          <TextField label="Benki" value={f.bankName} onChange={set('bankName')} />
          <TextField label="Jina la akaunti" value={f.bankAccountName} onChange={set('bankAccountName')} />
          <TextField label="Namba ya akaunti" value={f.bankAccountNumber} onChange={set('bankAccountNumber')} />

          <div className="form-section">Mrithi / ndugu wa karibu</div>
          <TextField label="Jina" value={f.nextOfKinName} onChange={set('nextOfKinName')} />
          <TextField label="Simu" type="tel" value={f.nextOfKinPhone} onChange={set('nextOfKinPhone')} />
          <TextField label="Uhusiano" placeholder="mf. Mke, Mtoto" value={f.nextOfKinRelation} onChange={set('nextOfKinRelation')} />
        </div>
      </section>
      <div className="actions"><Button type="submit" busy={busy}>{submitLabel}</Button></div>
    </form>
  );
}

export function MemberNew() {
  const nav = useNavigate();
  const { busy, error, run } = useAction();
  return (
    <>
      <PageHead title="Sajili mwanachama" sub="Namba ya mwanachama itatolewa na mfumo" />
      <MemberForm submitLabel="Sajili mwanachama" busy={busy} error={error}
        onSubmit={async (p) => {
          const r = await run(() => api<{ member: Member }>('/members', { method: 'POST', body: p }));
          if (r) nav(`/members/${r.member.id}`);
        }} />
    </>
  );
}
