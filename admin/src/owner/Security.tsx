import { useState } from 'react';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, phone, ROLE_LABEL, OWNER_ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Input, Loading, Modal, PageHead, Pager, Select } from '../components/ui';
import { DateRangeFilter, Kpi, Pill, presetRange, Section, Tabs, type Range } from '../components/owner-ui';

const roleName = (r: string) => (r === 'SUPER_ADMIN' ? OWNER_ROLE_LABEL : r === 'SYSTEM' ? 'Mfumo (kiotomatiki)' : ROLE_LABEL[r] ?? r);

type T = 'overview' | 'logins' | 'sessions' | 'audit';
const REASONS: Record<string, string> = {
  OK: 'Amefanikiwa', UNKNOWN_PHONE: 'Namba haijulikani', BAD_PASSWORD: 'Nenosiri si sahihi', INACTIVE: 'Akaunti imezimwa',
  AMCOS_SUSPENDED: 'Chama kimesitishwa', BAD_2FA: 'Msimbo wa 2FA si sahihi',
};
const device = (ua: string | null) => !ua ? '—' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Kifaa kingine';

export function OwnerSecurity() {
  const [tab, setTab] = useState<T>('overview');
  return (
    <>
      <PageHead title="Security & Audit" sub="Kuingia, vikao (sessions), arifa za usalama na kumbukumbu zisizofutika" />
      <Tabs value={tab} onChange={setTab} items={[['overview', 'Muhtasari na arifa'], ['logins', 'Historia ya kuingia'], ['sessions', 'Vikao hai'], ['audit', 'Audit log']]} />
      {tab === 'overview' && <Overview />}
      {tab === 'logins' && <Logins />}
      {tab === 'sessions' && <Sessions />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

function Overview() {
  const { data, loading, error } = useFetch<{
    summary: { failed_24h: number; success_24h: number; suspicious_7d: number };
    suspicious: { id: string; ip: string | null; userAgent: string | null; createdAt: string; user: { fullName: string; role: string } | null }[];
    failedBursts: { phone: string; attempts: number; last_attempt: string; ips: number }[];
  }>('/owner/security/alerts');
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <Alert>{error}</Alert>
      {data && <>
        <div className="grid grid-3">
          <Kpi label="Waliofanikiwa kuingia (saa 24)" value={data.summary.success_24h} />
          <Kpi tone={data.summary.failed_24h > 20 ? 'warn' : undefined} label="Majaribio yaliyoshindwa (saa 24)" value={data.summary.failed_24h} />
          <Kpi tone={data.summary.suspicious_7d ? 'bad' : undefined} label="Kuingia kusiko kwa kawaida (siku 7)" value={data.summary.suspicious_7d} />
        </div>
        <Section pad={false} title="Arifa: kuingia kutoka kifaa/mtandao mpya (wasimamizi wa jukwaa)">
          {data.suspicious.length === 0 ? <Empty>Hakuna arifa.</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{data.suspicious.map((e) => (
              <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td><strong>{e.user?.fullName}</strong><div className="muted" style={{ fontSize: 12 }}>{e.user ? roleName(e.user.role) : ''}</div></td><td>{e.ip}</td><td>{device(e.userAgent)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Section>
        <Section pad={false} title="Majaribio mengi yaliyoshindwa (≥5 ndani ya saa 24)">
          {data.failedBursts.length === 0 ? <Empty>Hakuna.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Namba</th><th className="num">Majaribio</th><th className="num">IP tofauti</th><th>La mwisho</th></tr></thead>
              <tbody>{data.failedBursts.map((f) => <tr key={f.phone}><td>{phone(f.phone)}</td><td className="num">{f.attempts}</td><td className="num">{f.ips}</td><td>{dateTime(f.last_attempt)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Section>
      </>}
    </div>
  );
}

function Logins() {
  const [success, setSuccess] = useState('');
  const [range, setRange] = useState<Range>(presetRange('7d'));
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch<Paged<{ id: string; phone: string | null; success: boolean; reason: string; suspicious: boolean; ip: string | null; userAgent: string | null; createdAt: string; user: { fullName: string; role: string } | null }>>(
    '/owner/security/logins', { success, from: range.from, to: range.to, page, pageSize: 50 });
  return (
    <section className="card">
      <div className="toolbar">
        <Select aria-label="Matokeo" value={success} onChange={(e) => { setSuccess(e.target.value); setPage(1); }}>
          <option value="">Yote</option><option value="true">Yaliyofanikiwa</option><option value="false">Yaliyoshindwa</option>
        </Select>
        <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
      </div>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna kumbukumbu.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Mtumiaji</th><th>Matokeo</th><th>IP</th><th>Kifaa</th></tr></thead>
          <tbody>{data?.data.map((e) => (
            <tr key={e.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.createdAt)}</td>
              <td>{e.user ? <><strong>{e.user.fullName}</strong><div className="muted" style={{ fontSize: 12 }}>{roleName(e.user.role)}</div></> : <span className="muted">{phone(e.phone)}</span>}</td>
              <td>{e.success ? <Pill value="SUCCESS" /> : <Pill value="FAILED" label={REASONS[e.reason] ?? e.reason} />}{e.suspicious && <> <Pill value="PENDING" label="Isiyo ya kawaida" /></>}</td>
              <td>{e.ip ?? '—'}</td><td>{device(e.userAgent)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </section>
  );
}

function Sessions() {
  const { has, user } = useAuth();
  const [platformOnly, setPlatformOnly] = useState('true');
  const { data, loading, reload } = useFetch<{ data: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean; user: { id: string; fullName: string; role: string } }[] }>(
    '/owner/security/sessions', { platformOnly });
  const act = useAction();
  return (
    <section className="card">
      <div className="toolbar">
        <Select aria-label="Watumiaji" value={platformOnly} onChange={(e) => setPlatformOnly(e.target.value)}>
          <option value="true">Wasimamizi wa jukwaa</option><option value="false">Watumiaji wote</option>
        </Select>
      </div>
      <Alert>{act.error}</Alert>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna vikao hai.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Mtumiaji</th><th>Kifaa</th><th>IP</th><th>Kilianza</th><th>Mara ya mwisho</th><th /></tr></thead>
          <tbody>{data?.data.map((s) => (
            <tr key={s.id}>
              <td><strong>{s.user.fullName}</strong>{s.current && <> <Pill value="ACTIVE" label="Hiki ni chako" /></>}<div className="muted" style={{ fontSize: 12 }}>{roleName(s.user.role)}</div></td>
              <td>{device(s.userAgent)}</td><td>{s.ip ?? '—'}</td><td>{dateTime(s.createdAt)}</td><td>{dateTime(s.lastSeenAt)}</td>
              <td className="num">{has('security.manage') && !s.current && (s.user.role !== 'SUPER_ADMIN' || s.user.id === user?.id) && (
                <Button size="sm" variant="ghost" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/security/sessions/${s.id}`, { method: 'DELETE' }))) reload(); }}>Futa kikao</Button>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

interface Log { id: string; action: string; entity: string; entityId: string | null; userRole: string | null; amcosName: string | null; ip: string | null; before: unknown; after: unknown; createdAt: string; user: { fullName: string } | null }

function Audit() {
  const [scope, setScope] = useState('platform');
  const [action, setAction] = useState('');
  const [role, setRole] = useState('');
  const [range, setRange] = useState<Range>(presetRange('30d'));
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Log | null>(null);
  const { data, loading } = useFetch<Paged<Log>>('/owner/security/audit', { scope, action: action.trim().toUpperCase(), role, from: range.from, to: range.to, page, pageSize: 50 });
  return (
    <section className="card">
      <div className="toolbar">
        <Select aria-label="Wigo" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }}>
          <option value="platform">Owner, wafanyakazi na mfumo</option><option value="all">Wote (pamoja na vyama)</option>
        </Select>
        <Select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">Role zote</option><option value="SUPER_ADMIN">Owner</option>
          {['FINANCE_MANAGER', 'TECH_SUPPORT', 'CUSTOMER_SUPPORT', 'MARKETING_MANAGER', 'AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          <option value="SYSTEM">Mfumo</option>
        </Select>
        <Input aria-label="Kitendo" placeholder="Kitendo (mf. PLATFORM_PAYMENT_VERIFY)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
        <DateRangeFilter value={range} onChange={(r) => { setRange(r); setPage(1); }} />
      </div>
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna kumbukumbu.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Mtumiaji</th><th>Kitendo</th><th>Rekodi</th><th>AMCOS</th><th>IP</th><th /></tr></thead>
          <tbody>{data?.data.map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{dateTime(l.createdAt)}</td>
              <td>{l.user?.fullName ?? (l.userRole === 'SYSTEM' ? 'Mfumo' : '—')}<div className="muted" style={{ fontSize: 12 }}>{l.userRole ? roleName(l.userRole) : ''}</div></td>
              <td><code>{l.action}</code></td><td>{l.entity}</td><td>{l.amcosName ?? '—'}</td><td>{l.ip ?? '—'}</td>
              <td className="num">{(l.before || l.after) ? <Button size="sm" variant="ghost" onClick={() => setSel(l)}>Mabadiliko</Button> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      <Modal open={!!sel} title={sel?.action ?? ''} onClose={() => setSel(null)}>
        <p className="muted" style={{ margin: 0 }}>Kumbukumbu hii haiwezi kubadilishwa wala kufutwa.</p>
        <div className="grid grid-2">
          <div><strong>Kabla</strong><pre className="json">{JSON.stringify(sel?.before ?? null, null, 2)}</pre></div>
          <div><strong>Baada</strong><pre className="json">{JSON.stringify(sel?.after ?? null, null, 2)}</pre></div>
        </div>
      </Modal>
    </section>
  );
}
