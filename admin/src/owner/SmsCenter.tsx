// SMS CENTER (Owner) — gharama ya SMS inabebwa na CoopLink, kwa hiyo Owner ndiye anaamua huduma zipi zitumie SMS.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { useT } from '../lib/prefs';
import { dateTime, phone as fmtPhone } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, PageHead, Pager, Select, TextField } from '../components/ui';
import { ConfirmDialog, Kpi, Section, Tabs, money, nfmt } from '../components/owner-ui';

interface Kind { key: string; group: string; label: string; who: string; urgent: boolean; desc: string; on: boolean; month: { sent: number; failed: number; skipped: number; queued: number; segments: number } | null }
interface Limits { broadcastPerMonth: number; pricePerSms: number; quietStart: number; quietEnd: number }
interface Center {
  provider: { provider: string | null; configured: boolean; senderId: string | null; balance: string | null; senderIds: string[]; error: string | null };
  masterOn: boolean; limits: Limits; kinds: Kind[]; groups: Record<string, string>;
  month: { sent: number; failed: number; queued: number; segments: number; cost: number };
  byAmcos: { amcosId: string | null; name: string; code: string | null; sent: number; segments: number; cost: number }[];
}
interface Log { id: string; phone: string; message: string; status: string; kind: string | null; kindLabel: string; amcosName: string | null; segments: number; error: string | null; createdAt: string; sentAt: string | null; attempts: number }

const PROVIDER: Record<string, string> = { RODSMS: 'RodSMS', AT: "Africa's Talking", DRY: 'Majaribio (haitumi)' };

export function OwnerSmsCenter() {
  const t = useT();
  const { user } = useAuth();
  const owner = user?.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<'kinds' | 'logs' | 'usage'>('kinds');
  const c = useFetch<Center>('/owner/sms');
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [confirm, setConfirm] = useState<'events' | 'limits' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState(false);

  if (c.loading && !c.data) return <Loading />;
  if (!c.data) return <Alert>{c.error}</Alert>;
  const d = c.data;
  const on = (k: Kind) => (draft && k.key in draft ? draft[k.key] : k.on);
  const changed = draft ? Object.keys(draft).filter((k) => d.kinds.find((x) => x.key === k)?.on !== draft[k]) : [];
  const L = limits ?? d.limits;

  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ status: string; error?: string }>('/owner/sms/test', { method: 'POST', body: { phone: testPhone.trim() || undefined } });
      setMsg(r.status === 'SENT' ? t('SMS ya majaribio imetumwa.') : `${t('SMS haikutumwa')}: ${r.error ?? r.status}`);
      c.reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const flush = async () => {
    setBusy(true);
    try { const r = await api<{ sent?: number; failed?: number }>('/owner/sms/flush', { method: 'POST' }); setMsg(`${t('Foleni imetumwa')}: ${r.sent ?? 0} ✓ · ${r.failed ?? 0} ✗`); c.reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <PageHead title="SMS Center" sub="Huduma zipi zitumie SMS, gharama na kumbukumbu za kila SMS">
        <Button variant="secondary" onClick={flush} busy={busy}>{t('Tuma foleni sasa')}</Button>
      </PageHead>

      {!d.provider.configured && <Alert kind="warn">{t('Mtoa huduma wa SMS hajasanidiwa. Weka RODSMS_API_KEY na RODSMS_SENDER_ID kwenye Railway (Variables). Mpaka hapo SMS zinarekodiwa kama Imerukwa.')}</Alert>}
      {d.provider.configured && !d.masterOn && <Alert kind="warn">{t('Swichi kuu ya SMS imezimwa (System Control Center). Hakuna SMS itakayotumwa hata kama aina imewashwa hapa chini.')} <Link to="/owner/system">System Control Center →</Link></Alert>}
      {d.provider.error && <Alert kind="warn">{t('Mtoa huduma:')} {d.provider.error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="grid grid-kpi">
        <Kpi label="Mtoa huduma" value={d.provider.provider ? PROVIDER[d.provider.provider] ?? d.provider.provider : t('Hajasanidiwa')} hint={d.provider.senderId ? `Sender ID: ${d.provider.senderId}` : undefined} tone="dark" />
        <Kpi label="Salio la SMS" value={d.provider.balance ?? '—'} hint={d.provider.senderIds.length ? d.provider.senderIds.join(', ') : undefined} />
        <Kpi label="SMS mwezi huu" value={nfmt(d.month.segments)} hint={`${nfmt(d.month.sent)} ${t('ujumbe')} · ${nfmt(d.month.failed)} ${t('zimeshindwa')} · ${nfmt(d.month.queued)} ${t('foleni')}`} />
        <Kpi label="Gharama ya mwezi" value={money(d.month.cost)} hint={`${money(d.limits.pricePerSms)} ${t('kwa SMS')}`} tone="gold" />
      </div>

      <Tabs value={tab} onChange={setTab} items={[['kinds', 'Huduma za SMS'], ['usage', 'Matumizi kwa chama'], ['logs', 'Kumbukumbu']]} />

      {tab === 'kinds' && (
        <>
          {Object.entries(d.groups).map(([g, label]) => (
            <Section key={g} title={label}>
              <div className="sms-kinds">
                {d.kinds.filter((k) => k.group === g).map((k) => (
                  <label key={k.key} className={`sms-kind ${on(k) ? 'on' : ''}`}>
                    <input type="checkbox" checked={on(k)} disabled={!owner} onChange={(e) => setDraft({ ...(draft ?? {}), [k.key]: e.target.checked })} />
                    <div>
                      <strong>{t(k.label)}</strong> {k.urgent && <span className="pill">{t('Haraka')}</span>}
                      <div className="muted small">{t(k.desc)}</div>
                      <div className="muted small">{t('Anayepokea:')} {t(k.who)}{k.month ? ` · ${t('Mwezi huu')}: ${nfmt(k.month.segments)} SMS${k.month.failed ? ` · ${k.month.failed} ${t('zimeshindwa')}` : ''}` : ''}</div>
                    </div>
                  </label>
                ))}
              </div>
            </Section>
          ))}
          {owner && changed.length > 0 && (
            <div className="sticky-actions">
              <span>{changed.length} {t('mabadiliko hayajahifadhiwa')}</span>
              <Button variant="secondary" onClick={() => setDraft(null)}>{t('Ghairi')}</Button>
              <Button onClick={() => setConfirm('events')}>{t('Hifadhi swichi')}</Button>
            </div>
          )}

          <Section title="Vikomo na saa za utulivu">
            <div className="form-grid">
              <TextField label={t('SMS za matangazo kwa chama kwa mwezi')} type="number" min={0} value={String(L.broadcastPerMonth)} disabled={!owner} onChange={(v) => setLimits({ ...L, broadcastPerMonth: Number(v) })} />
              <TextField label={t('Bei ya SMS moja (TSh)')} type="number" min={0} value={String(L.pricePerSms)} disabled={!owner} onChange={(v) => setLimits({ ...L, pricePerSms: Number(v) })} />
              <TextField label={t('Utulivu kuanzia saa (0-23)')} type="number" min={0} max={23} value={String(L.quietStart)} disabled={!owner} onChange={(v) => setLimits({ ...L, quietStart: Number(v) })} />
              <TextField label={t('Utulivu mpaka saa (0-23)')} type="number" min={0} max={23} value={String(L.quietEnd)} disabled={!owner} onChange={(v) => setLimits({ ...L, quietEnd: Number(v) })} />
            </div>
            <p className="muted small">{t('Saa za utulivu: SMS za taarifa zinasubiri asubuhi. OTP na tahadhari za usalama zinatumwa muda wowote.')}</p>
            {owner && limits && <Button onClick={() => setConfirm('limits')}>{t('Hifadhi vikomo')}</Button>}
          </Section>

          {owner && (
            <Section title="SMS ya majaribio">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 220px' }}><TextField label={t('Namba (acha wazi = namba yako)')} type="tel" value={testPhone} onChange={setTestPhone} /></div>
                <Button variant="secondary" busy={busy} onClick={test}>{t('Tuma SMS ya majaribio')}</Button>
              </div>
            </Section>
          )}
        </>
      )}

      {tab === 'usage' && (
        <Section title="Matumizi ya SMS kwa chama (mwezi huu)" pad={false}>
          {d.byAmcos.length === 0 ? <Empty>{t('Hakuna SMS zilizotumwa mwezi huu.')}</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('Chama')}</th><th className="num">{t('Ujumbe')}</th><th className="num">SMS</th><th className="num">{t('Gharama')}</th></tr></thead>
              <tbody>{d.byAmcos.map((r) => (
                <tr key={r.amcosId ?? 'p'}><td>{r.amcosId ? <Link to={`/owner/amcos/${r.amcosId}`}>{r.name}</Link> : t(r.name)}{r.code ? <span className="muted"> · {r.code}</span> : null}</td>
                  <td className="num">{nfmt(r.sent)}</td><td className="num">{nfmt(r.segments)}</td><td className="num">{money(r.cost)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Section>
      )}

      {tab === 'logs' && <SmsLogs kinds={d.kinds} />}

      <ConfirmDialog open={confirm === 'events'} title="Hifadhi swichi za SMS" message={`${changed.length} ${t('aina za SMS zitabadilishwa. Gharama ya SMS inabebwa na CoopLink.')}`} onClose={() => setConfirm(null)}
        onConfirm={async (cf) => { await api('/owner/sms/events', { method: 'PUT', body: { events: draft, ...cf } }); setDraft(null); setConfirm(null); c.reload(); }} />
      <ConfirmDialog open={confirm === 'limits'} title="Hifadhi vikomo vya SMS" message="Vikomo vipya vitatumika mara moja kwa vyama vyote." onClose={() => setConfirm(null)}
        onConfirm={async (cf) => { await api('/owner/sms/limits', { method: 'PUT', body: { ...L, ...cf } }); setLimits(null); setConfirm(null); c.reload(); }} />
    </div>
  );
}

function SmsLogs({ kinds }: { kinds: Kind[] }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [phone, setPhone] = useState('');
  const r = useFetch<Paged<Log>>('/owner/sms/logs', { page, pageSize: 30, kind: kind || undefined, status: status || undefined, phone: phone.trim() || undefined });
  return (
    <Section title="Kumbukumbu za SMS (siku 30)" pad={false}>
      <div className="filters" style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}><option value="">{t('Aina zote')}</option>{kinds.map((k) => <option key={k.key} value={k.key}>{t(k.label)}</option>)}</Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('Hali zote')}</option>{['SENT', 'QUEUED', 'FAILED', 'SKIPPED'].map((s) => <option key={s} value={s}>{t(s === 'SENT' ? 'Imetumwa' : s === 'QUEUED' ? 'Foleni' : s === 'FAILED' ? 'Imeshindwa' : 'Imerukwa')}</option>)}
        </Select>
        <input className="input" style={{ maxWidth: 180 }} placeholder={t('Tafuta namba')} value={phone} onChange={(e) => { setPhone(e.target.value); setPage(1); }} />
      </div>
      {r.loading && !r.data ? <Loading /> : !r.data?.data.length ? <Empty>{t('Hakuna SMS.')}</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('Muda')}</th><th>{t('Aina')}</th><th>{t('Namba')}</th><th>{t('Ujumbe')}</th><th>{t('Chama')}</th><th>{t('Hali')}</th></tr></thead>
          <tbody>{r.data.data.map((l) => (
            <tr key={l.id}>
              <td className="nowrap">{dateTime(l.createdAt)}</td>
              <td>{t(l.kindLabel)}</td>
              <td className="nowrap">{fmtPhone(l.phone)}</td>
              <td style={{ minWidth: 220, maxWidth: 420, whiteSpace: 'normal' }}>{l.message}{l.error && <div className="muted small">⚠ {l.error}</div>}</td>
              <td>{l.amcosName ?? '—'}</td>
              <td><Badge status={l.status} />{l.segments > 1 && <div className="muted small">{l.segments} SMS</div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager meta={r.data?.meta} onPage={setPage} />
    </Section>
  );
}
