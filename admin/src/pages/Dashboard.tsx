import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { num, tsh } from '../lib/format';
import { useAuth, ROLE_GROUPS } from '../lib/auth';
import type { Paged } from '../lib/api';
import { Alert, Loading, PageHead, Stat } from '../components/ui';

interface Summary {
  season: { id: string; name: string; status: string };
  members: { total: number; active: number; female: number };
  estimates: { count: number; approvedKg: string; totalKg: string; acres: string };
  inputs: { issues: number; value: string; farmers: number };
  ledger: { debit: string; credit: string };
}
interface Owing { memberId: string; memberNo: string; firstName: string; lastName: string; village: string | null; balance: string }

export function Dashboard() {
  const { user, can } = useAuth();
  const { data, error, loading } = useFetch<Summary>('/reports/season-summary');
  const owing = useFetch<Paged<Owing>>('/reports/member-balances', { onlyOwing: true, pageSize: 6 });

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const s = data;
  const outstanding = Number(s.ledger.debit) - Number(s.ledger.credit);

  return (
    <>
      <PageHead title={`Habari, ${user?.fullName.split(' ')[0]}`} sub={<>Msimu <strong>{s.season.name}</strong> · muhtasari wa leo</>}>
        {can(...ROLE_GROUPS.STAFF) && <Link className="btn btn-gold" to="/input-issues/new">Toa pembejeo</Link>}
        {can(...ROLE_GROUPS.STAFF) && <Link className="btn btn-primary" to="/members/new">Sajili mwanachama</Link>}
      </PageHead>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat accent label="Wanachama hai" value={num(s.members.active)} hint={`${num(s.members.total)} jumla · ${num(s.members.female)} wanawake`} />
        <Stat label="Makisio yaliyoidhinishwa" value={`${num(s.estimates.approvedKg)} kg`} hint={`${num(s.estimates.count)} makisio · ekari ${num(s.estimates.acres)}`} />
        <Stat label="Pembejeo zilizotolewa" value={tsh(s.inputs.value)} hint={`Kwa wakulima ${num(s.inputs.farmers)} · utoaji ${num(s.inputs.issues)}`} />
        <Stat label="Madeni yanayodaiwa" value={tsh(Math.max(outstanding, 0))} hint="Pembejeo na makato ambayo bado hayajalipwa" />
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-pad" style={{ paddingBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Wenye madeni makubwa</h2>
            <Link to="/balances">Ona wote</Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {owing.data?.data.map((r) => (
                  <tr key={r.memberId}>
                    <td><Link className="row-link" to={`/members/${r.memberId}`}>{r.firstName} {r.lastName}</Link><div className="muted" style={{ fontSize: 13 }}>{r.memberNo}{r.village ? ` · ${r.village}` : ''}</div></td>
                    <td className="num money-neg">{tsh(Math.abs(Number(r.balance)))}</td>
                  </tr>
                ))}
                {owing.data && owing.data.data.length === 0 && <tr><td className="muted">Hakuna mwanachama mwenye deni.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card card-pad">
          <h2>Mzunguko wa msimu</h2>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: 'var(--muted)' }}>
            <li><strong style={{ color: 'var(--forest)' }}>Usajili na makisio</strong> — wanachama, mashamba, kilo zinazotarajiwa</li>
            <li><strong style={{ color: 'var(--forest)' }}>Pembejeo kwa mkopo</strong> — kila mfuko unaingia kwenye ledger ya mkulima</li>
            <li>Masoko — mabelo, madaraja na bei <span className="badge badge-neutral">Awamu 2</span></li>
            <li>Makato na malipo kwa M-Pesa / benki <span className="badge badge-neutral">Awamu 2</span></li>
          </ol>
        </section>
      </div>
    </>
  );
}
