import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Loading, PageHead } from '../components/ui';
import { BarChart, LineChart } from '../components/charts';
import { DateRangeFilter, Kpi, money, nfmt, Pill, presetRange, Section, type Range } from '../components/owner-ui';

interface Dash {
  range: { from: string; to: string };
  amcos: Record<'total' | 'active' | 'suspended' | 'pending' | 'rejected' | 'new_in_range', number>;
  users: Record<'total' | 'active' | 'staff' | 'logged_in_range', number>;
  subscriptions: Record<'active' | 'trial' | 'past_due' | 'expired' | 'expiring' | 'expiringWindowDays', number>;
  revenue: Record<'in_range' | 'this_month' | 'this_year' | 'all_time', string> & { payments: number } | null;
  series: { month: string; new_amcos: number; new_paid_subs: number; new_trials: number; revenue: string | null }[];
  health: { db: string; dbMs: number; errors_24h: number; last_job_status: string | null; last_job_at: string | null; maintenance: boolean };
}

export function OwnerDashboard() {
  const { user, has } = useAuth();
  const [range, setRange] = useState<Range>(presetRange('30d'));
  const support = useFetch<{ open: number; waiting: number; overdue: number; unassigned: number }>(has('support.read') ? '/owner/support/summary' : null);
  const { data, error, loading } = useFetch<Dash>('/owner/dashboard', { from: range.from, to: range.to });

  return (
    <>
      <PageHead title={`Karibu, ${user?.fullName.split(' ')[0]}`} sub="Muhtasari wa biashara ya CoopLink — takwimu zote zinatoka kwenye database">
        <DateRangeFilter value={range} onChange={setRange} />
      </PageHead>
      <Alert>{error}</Alert>
      {loading && !data ? <Loading /> : data && (
        <div className="stack">
          {support.data && support.data.open > 0 && (
            <Link to={`/owner/support${support.data.overdue ? '?view=overdue' : ''}`} className={`support-strip${support.data.overdue ? ' bad' : ''}`}>
              <strong>Support Tickets:</strong> {support.data.waiting} zinasubiri jibu
              {support.data.overdue > 0 && <> · <span className="money-neg">{support.data.overdue} zimechelewa</span></>}
              {support.data.unassigned > 0 && <> · {support.data.unassigned} hazijagawiwa</>}
              <span className="grow" />Fungua foleni →
            </Link>
          )}
          <div className="grid grid-kpi">
            <Kpi tone="dark" label="AMCOS zilizosajiliwa" value={nfmt(data.amcos.total)} hint={`+${data.amcos.new_in_range} kwenye kipindi hiki`} />
            <Kpi label="AMCOS hai" value={nfmt(data.amcos.active)} />
            <Kpi tone={data.amcos.suspended ? 'bad' : undefined} label="Zimesitishwa" value={nfmt(data.amcos.suspended)} />
            <Kpi tone={data.amcos.pending ? 'warn' : undefined} label="Zinasubiri idhini" value={nfmt(data.amcos.pending)}
              hint={data.amcos.pending ? <Link to="/owner/amcos?status=PENDING">Ziidhinishe →</Link> : 'Hakuna'} />
            <Kpi label="Watumiaji wa vyama" value={nfmt(data.users.total)} hint={`${nfmt(data.users.active)} hai · ${nfmt(data.users.logged_in_range)} waliingia kipindi hiki`} />
          </div>

          <div className="grid grid-kpi">
            <Kpi label="Subscriptions hai" value={nfmt(data.subscriptions.active)} hint={`${nfmt(data.subscriptions.trial)} kwenye trial`} />
            <Kpi tone={data.subscriptions.expiring ? 'warn' : undefined} label="Zinakaribia kuisha" value={nfmt(data.subscriptions.expiring)} hint={`Ndani ya siku ${data.subscriptions.expiringWindowDays}`} />
            <Kpi tone={data.subscriptions.past_due ? 'warn' : undefined} label="Kwenye grace" value={nfmt(data.subscriptions.past_due)} />
            <Kpi tone={data.subscriptions.expired ? 'bad' : undefined} label="Zimeisha" value={nfmt(data.subscriptions.expired)} />
            {data.revenue && <Kpi tone="gold" label="Mapato (kipindi hiki)" value={money(data.revenue.in_range)} hint={`${range.from} → ${range.to}`} />}
          </div>

          {data.revenue && (
            <div className="grid grid-3">
              <Kpi label="Mapato ya mwezi huu" value={money(data.revenue.this_month)} />
              <Kpi label="Mapato ya mwaka huu" value={money(data.revenue.this_year)} />
              <Kpi label="Mapato yote" value={money(data.revenue.all_time)} hint={`Malipo ${nfmt(data.revenue.payments)} yaliyothibitishwa`} />
            </div>
          )}

          <div className="grid grid-2">
            {data.revenue && (
              <Section title="Mapato kwa mwezi (miezi 12)">
                <LineChart title="Mapato kwa mwezi" data={data.series} xKey="month" series={[{ key: 'revenue', label: 'Mapato (TSh)', color: '#1F7A52' }]} />
              </Section>
            )}
            <Section title="Ukuaji wa wateja">
              <BarChart title="AMCOS mpya kwa mwezi" data={data.series} xKey="month" series={[{ key: 'new_amcos', label: 'AMCOS mpya', color: '#0B2F23' }]} />
            </Section>
            <Section title="Ukuaji wa subscriptions">
              <BarChart title="Subscriptions mpya kwa mwezi" data={data.series} xKey="month"
                series={[{ key: 'new_paid_subs', label: 'Za kulipia', color: '#1F7A52' }, { key: 'new_trials', label: 'Trial', color: '#E3A83A' }]} />
            </Section>
            <Section title="Hali ya mfumo" actions={<Link to="/owner/system">Maelezo →</Link>}>
              <dl className="dl">
                <dt>Database</dt><dd><Pill value={data.health.db} /> <span className="muted">{data.health.dbMs} ms</span></dd>
                <dt>Kazi ya mwisho</dt><dd>{data.health.last_job_status ? <><Pill value={data.health.last_job_status} /> <span className="muted">{dateTime(data.health.last_job_at)}</span></> : <span className="muted">Bado haijaendeshwa</span>}</dd>
                <dt>Makosa (saa 24)</dt><dd>{data.health.errors_24h ? <Pill value="FAILED" label={`${data.health.errors_24h} makosa`} /> : <Pill value="ok" label="Hakuna" />}</dd>
                <dt>Maintenance</dt><dd>{data.health.maintenance ? <Pill value="PENDING" label="Imewashwa" /> : <Pill value="ok" label="Imezimwa" />}</dd>
              </dl>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
