import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Alert, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { BarChart, LineChart } from '../components/charts';
import { Kpi, money, nfmt, Section, Tabs } from '../components/owner-ui';

interface Profile { companyName: string; productName: string; slogan: string; ownerName: string; poweredBy: string; phone: string; email: string; address: string; tin: string; website: string; supportPhone: string; supportEmail: string }
interface Target { id: string; period: string; metric: string; targetValue: string; notes: string | null; actual: number; progress: number | null }
interface Analytics {
  series: Record<string, string | number | null>[];
  totals: { active_amcos: number; paying_amcos: number; ever_trial: number; churned: number; revenue_12m: string | null; conversionRate: number | null; arpu12m: string | null };
}
const METRIC: Record<string, string> = { REVENUE: 'Mapato (TSh)', NEW_AMCOS: 'AMCOS mpya', ACTIVE_SUBSCRIPTIONS: 'Subscriptions hai zinazolipiwa' };

export function OwnerBusiness() {
  const [tab, setTab] = useState<'analytics' | 'targets' | 'profile'>('analytics');
  return (
    <>
      <PageHead title="DUKALANGU SOLUTION — Business Center" sub="Ukuaji wa CoopLink, malengo ya biashara na wasifu wa kampuni">
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>Chapisha / PDF</Button>
      </PageHead>
      <div className="no-print"><Tabs value={tab} onChange={setTab} items={[['analytics', 'Uchambuzi wa ukuaji'], ['targets', 'Malengo'], ['profile', 'Wasifu wa kampuni']]} /></div>
      <div className="print-area">
        {tab === 'analytics' && <AnalyticsView />}
        {tab === 'targets' && <Targets />}
        {tab === 'profile' && <ProfileView />}
      </div>
    </>
  );
}

function AnalyticsView() {
  const { data, loading, error } = useFetch<Analytics>('/owner/business/analytics');
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const t = data.totals;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="AMCOS hai" value={nfmt(t.active_amcos)} />
        <Kpi label="AMCOS zinazolipa" value={nfmt(t.paying_amcos)} hint={`Kati ya ${nfmt(t.ever_trial)} zilizowahi kuwa trial`} />
        <Kpi tone="gold" label="Trial → kulipa" value={t.conversionRate === null ? '—' : `${t.conversionRate}%`} />
        <Kpi tone={t.churned ? 'warn' : undefined} label="Zimesitishwa (subscription imeisha)" value={nfmt(t.churned)} />
        {t.revenue_12m !== null && <Kpi label="Mapato miezi 12" value={money(t.revenue_12m)} hint={t.arpu12m ? `Wastani kwa chama: ${money(t.arpu12m)}` : undefined} />}
      </div>
      <div className="grid grid-2">
        <Section title="Usajili na idhini za AMCOS"><BarChart title="Usajili" data={data.series} xKey="month" series={[{ key: 'registered', label: 'Zimesajiliwa', color: '#0B2F23' }, { key: 'approved', label: 'Zimeidhinishwa', color: '#1F7A52' }]} /></Section>
        <Section title="Trial na walioanza kulipa"><BarChart title="Ubadilishaji" data={data.series} xKey="month" series={[{ key: 'trials', label: 'Trial mpya', color: '#C9A227' }, { key: 'converted', label: 'Walianza kulipa', color: '#1F7A52' }]} /></Section>
      </div>
      {t.revenue_12m !== null && (
        <Section title="Mapato dhidi ya matumizi ya CoopLink">
          <LineChart title="Mapato na matumizi" data={data.series} xKey="month" series={[{ key: 'revenue', label: 'Mapato', color: '#1F7A52' }, { key: 'expenses', label: 'Matumizi', color: '#B4413C' }]} />
        </Section>
      )}
      <p className="muted" style={{ fontSize: 12 }}>Takwimu zote zinatoka moja kwa moja kwenye database. Mapato ya CoopLink pekee — fedha za vyama na wakulima hazijumuishwi.</p>
    </div>
  );
}

function Targets() {
  const { has } = useAuth();
  const { data, loading, error, reload } = useFetch<{ data: Target[] }>('/owner/business/targets');
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [f, setF] = useState({ period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, metric: 'REVENUE', targetValue: '', notes: '' });
  const act = useAction();
  return (
    <div className="stack">
      <Alert>{error ?? act.error}</Alert>
      <Section pad={false} title="Malengo ya biashara" actions={has('business.manage') && <Button size="sm" className="no-print" onClick={() => setOpen(true)}>+ Weka lengo</Button>}>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Bado hakuna lengo. Weka lengo la mwezi au mwaka.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Kipindi</th><th>Kipimo</th><th className="num">Lengo</th><th className="num">Halisi</th><th style={{ minWidth: 160 }}>Maendeleo</th><th /></tr></thead>
            <tbody>{data?.data.map((t) => {
              const isMoney = t.metric === 'REVENUE';
              const pct = Math.min(100, t.progress ?? 0);
              return (
                <tr key={t.id}>
                  <td><strong>{t.period}</strong>{t.notes && <div className="muted" style={{ fontSize: 12 }}>{t.notes}</div>}</td>
                  <td>{METRIC[t.metric]}</td>
                  <td className="num">{isMoney ? money(t.targetValue) : nfmt(t.targetValue)}</td>
                  <td className="num">{isMoney ? money(t.actual) : nfmt(t.actual)}</td>
                  <td><div className="progress"><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--brand)' : pct >= 50 ? 'var(--gold, #C9A227)' : '#B4413C' }} /></div><small className="muted">{t.progress === null ? '—' : `${t.progress}%`}</small></td>
                  <td className="num">{has('business.manage') && <Button size="sm" variant="ghost" className="no-print" busy={act.busy} onClick={async () => { if (await act.run(() => api(`/owner/business/targets/${t.id}`, { method: 'DELETE' }))) reload(); }}>Futa</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Section>
      {open && (
        <Modal open title="Weka lengo" onClose={() => setOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Ghairi</Button><Button busy={act.busy} disabled={!f.targetValue} onClick={async () => {
            if (await act.run(() => api('/owner/business/targets', { method: 'POST', body: { ...f, notes: f.notes || null } }))) { setOpen(false); reload(); }
          }}>Hifadhi</Button></>}>
          <Alert>{act.error}</Alert>
          <div className="form-grid">
            <TextField label="Kipindi (YYYY au YYYY-MM) *" value={f.period} onChange={(v) => setF({ ...f, period: v })} />
            <SelectField label="Kipimo *" value={f.metric} onChange={(v) => setF({ ...f, metric: v })} options={Object.entries(METRIC).map(([value, label]) => ({ value, label }))} />
            <TextField label="Lengo *" inputMode="decimal" value={f.targetValue} onChange={(v) => setF({ ...f, targetValue: v.replace(/[^0-9.]/g, '') })} />
            <TextField label="Maelezo" value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Lengo la kipindi na kipimo kilekile likiwepo, litasasishwa.</p>
        </Modal>
      )}
    </div>
  );
}

function ProfileView() {
  const { has } = useAuth();
  const { data, loading, reload } = useFetch<{ profile: Profile }>('/owner/business/profile');
  const [p, setP] = useState<Profile | null>(null);
  const act = useAction();
  const [ok, setOk] = useState(false);
  useEffect(() => { if (data) setP(data.profile); }, [data]);
  if (loading && !p) return <Loading />;
  if (!p) return null;
  const ro = !has('business.manage');
  const F = (k: keyof Profile, label: string) => <TextField label={label} value={p[k] ?? ''} disabled={ro} onChange={(v) => { setOk(false); setP({ ...p, [k]: v }); }} />;
  return (
    <Section title="Wasifu wa kampuni">
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{ok ? 'Wasifu umehifadhiwa.' : null}</Alert>
      <div className="form-grid">
        {F('companyName', 'Jina la kampuni')}{F('productName', 'Jina la bidhaa')}{F('slogan', 'Kauli mbiu')}{F('ownerName', 'Mmiliki')}
        {F('address', 'Anwani (mf. S.L.P 45, Urambo – Tabora)')}{F('tin', 'TIN')}{F('website', 'Tovuti')}{F('poweredBy', 'Powered by (chini ya ukurasa wa kuingia)')}
      </div>
      <h3 className="co-form-h">Mawasiliano yanayoonekana kwenye mfumo</h3>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Yanaonekana kwenye ukurasa wa kuingia, ukurasa wa Msaada, chini ya menyu, kwenye risiti na kwenye Masharti/Faragha. Namba zaidi ya moja zitenganishwe kwa "/".</p>
      <div className="form-grid">
        {F('phone', 'Simu ya mauzo')}{F('email', 'Email ya mauzo')}
        {F('supportPhone', 'Simu ya msaada wa kiufundi')}{F('supportEmail', 'Email ya msaada wa kiufundi')}
      </div>
      {!ro && <div className="actions no-print" style={{ marginTop: 12 }}><Button busy={act.busy} onClick={async () => { if (await act.run(() => api('/owner/business/profile', { method: 'PUT', body: p }))) { setOk(true); reload(); } }}>Hifadhi wasifu</Button></div>}
    </Section>
  );
}
