import { useEffect, useState } from 'react';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Button, Empty, Loading, PageHead, Pager, SelectField, TextField } from '../components/ui';
import { ConfirmDialog, LABELS, Pill, Section, Tabs } from '../components/owner-ui';

interface Health {
  backend: { status: string; version: string; node: string; uptimeSec: number; startedAt: string; memoryMb: number };
  frontend: { built: boolean }; api: { status: string };
  database: { status: string; latencyMs: number; size: { pretty: string } | null };
  migrations: { applied: number; total: number; latest: string | null; upToDate: boolean };
  deployment: Record<string, string | null>;
  jobs: { name: string; status: string; started_at: string; finished_at: string | null; details: Record<string, unknown> | null }[];
  errors: { h24: number; d7: number };
  integrations: Record<'sms' | 'email' | 'payments', string>;
  maintenance: { enabled: boolean; message: string }; banner: { enabled: boolean; message: string; tone: 'info' | 'warn' };
}
interface Config { defaultTrialDays: number; defaultGraceDays: number; expiringWindowDays: number; enforceSubscriptions: boolean; currency: 'TZS' | 'USD' }

const uptime = (s: number) => (s > 86400 ? `${Math.floor(s / 86400)} siku ${Math.floor((s % 86400) / 3600)} saa` : s > 3600 ? `${Math.floor(s / 3600)} saa ${Math.floor((s % 3600) / 60)} dk` : `${Math.floor(s / 60)} dk`);

export function OwnerSystem() {
  const { has } = useAuth();
  const [tab, setTab] = useState<'health' | 'errors' | 'settings'>('health');
  const h = useFetch<Health>('/owner/system/health');
  const act = useAction();
  return (
    <>
      <PageHead title="System Control Center" sub="Hali ya mfumo, makosa na mipangilio. Siri (DB URL, API keys) hazionyeshwi hapa.">
        <Button variant="secondary" onClick={h.reload}>Onyesha upya</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} items={[['health', 'Hali ya mfumo'], ['errors', 'Makosa'], ['settings', 'Mipangilio']]} />
      <Alert>{h.error ?? act.error}</Alert>
      {tab === 'health' && (h.loading && !h.data ? <Loading /> : h.data && (
        <div className="stack">
          {h.data.maintenance.enabled && <Alert kind="warn"><strong>Maintenance imewashwa:</strong> {h.data.maintenance.message}</Alert>}
          <div className="grid grid-kpi">
            <StatusCard title="Backend" status={h.data.backend.status} detail={`v${h.data.backend.version} · ${h.data.backend.node}`} />
            <StatusCard title="Frontend (Admin)" status={h.data.frontend.built ? 'ok' : 'down'} detail={h.data.frontend.built ? 'Imejengwa na inahudumiwa' : 'admin/dist haipo'} />
            <StatusCard title="API" status={h.data.api.status} detail="/api/v1" />
            <StatusCard title="Database" status={h.data.database.status} detail={`${h.data.database.latencyMs} ms · ${h.data.database.size?.pretty ?? '—'}`} />
            <StatusCard title="Migrations" status={h.data.migrations.upToDate ? 'ok' : 'PENDING'} detail={`${h.data.migrations.applied}/${h.data.migrations.total} · ${h.data.migrations.latest ?? '—'}`} />
          </div>
          <div className="grid grid-2">
            <Section title="Server na deployment">
              <dl className="dl">
                <dt>Imewaka tangu</dt><dd>{dateTime(h.data.backend.startedAt)} ({uptime(h.data.backend.uptimeSec)})</dd>
                <dt>Kumbukumbu (RAM)</dt><dd>{h.data.backend.memoryMb} MB</dd>
                <dt>Jukwaa</dt><dd>{h.data.deployment.platform} {h.data.deployment.environment ? `· ${h.data.deployment.environment}` : ''}</dd>
                <dt>Service</dt><dd>{h.data.deployment.service ?? '—'}</dd>
                <dt>Commit</dt><dd>{h.data.deployment.commit ?? '—'} {h.data.deployment.branch ? `(${h.data.deployment.branch})` : ''}</dd>
                <dt>Deployment ID</dt><dd style={{ wordBreak: 'break-all' }}>{h.data.deployment.deploymentId ?? '—'}</dd>
              </dl>
            </Section>
            <Section title="Kazi za nyuma (background jobs)" actions={(has('system.manage') || has('subscriptions.manage')) && (
              <Button size="sm" variant="secondary" busy={act.busy} onClick={async () => { if (await act.run(() => api('/owner/system/jobs/subscriptions/run', { method: 'POST' }))) h.reload(); }}>Endesha sasa</Button>
            )}>
              {h.data.jobs.length === 0 ? <p className="muted">Bado hakuna kazi iliyoendeshwa. Kazi ya subscriptions inaendeshwa kila saa.</p> : (
                <table className="table"><tbody>{h.data.jobs.map((j) => (
                  <tr key={j.name}><td><strong>{j.name}</strong><div className="muted" style={{ fontSize: 12 }}>{j.details ? Object.entries(j.details).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}</div></td>
                    <td><Pill value={j.status} /></td><td className="muted">{dateTime(j.started_at)}</td></tr>
                ))}</tbody></table>
              )}
            </Section>
            <Section title="Integrations">
              <dl className="dl">
                <dt>SMS (Africa's Talking)</dt><dd><Pill value={h.data.integrations.sms} /></dd>
                <dt>Email</dt><dd><Pill value={h.data.integrations.email} /></dd>
                <dt>Malipo</dt><dd><Pill value="PENDING" label={LABELS[h.data.integrations.payments]} /></dd>
              </dl>
              {h.data.integrations.sms !== 'configured' && <p className="muted" style={{ fontSize: 13 }}>SMS zitarekodiwa kama "Imerukwa" hadi uweke AT_USERNAME na AT_API_KEY kwenye Railway Variables.</p>}
            </Section>
            <Section title="Makosa ya mfumo">
              <dl className="dl"><dt>Saa 24</dt><dd>{h.data.errors.h24}</dd><dt>Siku 7</dt><dd>{h.data.errors.d7}</dd></dl>
            </Section>
          </div>
        </div>
      ))}
      {tab === 'errors' && <Errors />}
      {tab === 'settings' && h.data && <Settings h={h.data} canManage={has('system.manage')} onSaved={h.reload} />}
    </>
  );
}

function StatusCard({ title, status, detail }: { title: string; status: string; detail: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-top"><span className="label">{title}</span><Pill value={status} /></div>
      <span className="hint" style={{ fontSize: 13 }}>{detail}</span>
    </div>
  );
}

function Errors() {
  const [page, setPage] = useState(1);
  const { data, loading } = useFetch<Paged<{ id: string; method: string; path: string; message: string; createdAt: string }>>('/owner/system/errors', { page, pageSize: 25 });
  return (
    <section className="card">
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Hakuna makosa yaliyorekodiwa. 🎉</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Wakati</th><th>Njia</th><th>Ujumbe</th></tr></thead>
          <tbody>{data?.data.map((e) => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.createdAt)}</td><td><code>{e.method} {e.path}</code></td><td>{e.message}</td></tr>)}</tbody>
        </table></div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
    </section>
  );
}

function Settings({ h, canManage, onSaved }: { h: Health; canManage: boolean; onSaved: () => void }) {
  const cfg = useFetch<{ config: Config }>('/owner/system/settings');
  const [c, setC] = useState<Config | null>(null);
  useEffect(() => { if (cfg.data) setC(cfg.data.config); }, [cfg.data]);
  const [mMsg, setMMsg] = useState(h.maintenance.message);
  const [confirmM, setConfirmM] = useState(false);
  const [banner, setBanner] = useState(h.banner);
  const act = useAction();
  const [ok, setOk] = useState<string | null>(null);
  const save = async (fn: () => Promise<unknown>, msg: string) => { setOk(null); if (await act.run(fn)) { setOk(msg); onSaved(); } };
  return (
    <div className="stack">
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <Section title="Maintenance mode">
        <p className="muted" style={{ marginTop: 0 }}>Ikiwashwa, watumiaji wa vyama hawataweza kutumia mfumo; wataona ujumbe huu. Wasimamizi wa CoopLink wanaendelea kufanya kazi.</p>
        <TextField label="Ujumbe kwa watumiaji" value={mMsg} onChange={setMMsg} disabled={!canManage} />
        {canManage && <div className="actions"><Button variant={h.maintenance.enabled ? 'primary' : 'danger'} onClick={() => setConfirmM(true)}>{h.maintenance.enabled ? 'Zima maintenance' : 'Washa maintenance'}</Button></div>}
      </Section>
      <Section title="Tangazo la mfumo (banner)">
        <p className="muted" style={{ marginTop: 0 }}>Linaonekana kwenye ukurasa wa kuingia na juu ya kurasa za vyama.</p>
        <TextField label="Ujumbe" value={banner.message} onChange={(v) => setBanner({ ...banner, message: v })} disabled={!canManage} />
        <div className="form-grid">
          <SelectField label="Aina" value={banner.tone} onChange={(v) => setBanner({ ...banner, tone: v as 'info' | 'warn' })} options={[{ value: 'info', label: 'Taarifa' }, { value: 'warn', label: 'Tahadhari' }]} />
          <SelectField label="Hali" value={banner.enabled ? 'on' : 'off'} onChange={(v) => setBanner({ ...banner, enabled: v === 'on' })} options={[{ value: 'on', label: 'Linaonyeshwa' }, { value: 'off', label: 'Limefichwa' }]} />
        </div>
        {canManage && <div className="actions"><Button busy={act.busy} onClick={() => save(async () => { const r = await api('/owner/system/banner', { method: 'PUT', body: banner }); window.dispatchEvent(new Event('cl:banner')); return r; }, 'Tangazo limehifadhiwa')}>Hifadhi tangazo</Button></div>}
      </Section>
      {c && (
        <Section title="Mipangilio ya subscriptions">
          <div className="form-grid">
            <TextField label="Siku za trial (chaguo-msingi)" type="number" value={String(c.defaultTrialDays)} onChange={(v) => setC({ ...c, defaultTrialDays: Number(v) })} disabled={!canManage} />
            <TextField label="Siku za grace (chaguo-msingi)" type="number" value={String(c.defaultGraceDays)} onChange={(v) => setC({ ...c, defaultGraceDays: Number(v) })} disabled={!canManage} />
            <TextField label="'Inakaribia kuisha' ndani ya siku" type="number" value={String(c.expiringWindowDays)} onChange={(v) => setC({ ...c, expiringWindowDays: Number(v) })} disabled={!canManage} />
            <SelectField label="Sarafu" value={c.currency} onChange={(v) => setC({ ...c, currency: v as 'TZS' | 'USD' })} options={[{ value: 'TZS', label: 'TZS' }, { value: 'USD', label: 'USD' }]} />
            <SelectField label="Kusitisha chama subscription ikiisha" value={c.enforceSubscriptions ? 'on' : 'off'} onChange={(v) => setC({ ...c, enforceSubscriptions: v === 'on' })}
              options={[{ value: 'on', label: 'Ndiyo (baada ya grace)' }, { value: 'off', label: 'Hapana (kuonya tu)' }]} />
          </div>
          {canManage && <div className="actions"><Button busy={act.busy} onClick={() => save(() => api('/owner/system/settings/config', { method: 'PUT', body: c }), 'Mipangilio imehifadhiwa')}>Hifadhi mipangilio</Button></div>}
        </Section>
      )}
      <ConfirmDialog open={confirmM} danger={!h.maintenance.enabled} title={h.maintenance.enabled ? 'Zima maintenance?' : 'Washa maintenance?'} confirmLabel={h.maintenance.enabled ? 'Zima' : 'Washa'}
        message={h.maintenance.enabled ? 'Watumiaji wa vyama wataweza kutumia mfumo tena.' : 'Watumiaji WOTE wa vyama watazuiwa mara moja.'} onClose={() => setConfirmM(false)}
        onConfirm={async (cf) => { await api('/owner/system/maintenance', { method: 'PUT', body: { enabled: !h.maintenance.enabled, message: mMsg, ...cf } }); setConfirmM(false); onSaved(); }} />
    </div>
  );
}
