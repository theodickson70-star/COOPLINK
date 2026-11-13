// =====================================================================
//  SUPPORT TICKETS (Owner / timu ya DUKALANGU): foleni ya vyama vyote, kugawa, kujibu, SLA
// =====================================================================
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, phone, ROLE_LABEL } from '../lib/format';
import { Alert, Empty, Input, Loading, PageHead, SelectField } from '../components/ui';
import { Kpi, Tabs } from '../components/owner-ui';
import {
  CATEGORY, Composer, PRIORITY, PriorityPill, slaText, STATUS, StatusPill, Thread, TicketSteps,
  type Message, type TicketCategory, type TicketPriority, type TicketStatus,
} from '../components/Support';

type View = 'active' | 'waiting' | 'overdue' | 'unassigned' | 'mine' | 'closed' | 'all';
interface Row {
  id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus;
  createdAt: string; dueAt: string; firstResponseAt: string | null; lastAmcosAt: string; lastPlatformAt: string | null;
  amcosId: string; amcosName: string; createdBy: string; createdByRole: string; assignee: string | null; overdue: boolean; waiting: boolean;
}
interface Summary { open: number; waiting: number; overdue: number; unassigned: number; mine: number; closed30: number; avgFirstHours: string | null; csatUp?: number; csatDown?: number }

export function OwnerSupport() {
  const [sp, setSp] = useSearchParams();
  const amcosId = sp.get('amcosId') ?? undefined;
  const [view, setView] = useState<View>((sp.get('view') as View) ?? (amcosId ? 'all' : 'active'));
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const sum = useFetch<Summary>('/owner/support/summary');
  const { data, loading } = useFetch<{ data: Row[] }>('/owner/support/tickets', { view, amcosId, q: dq || undefined });
  const s = sum.data;
  return (
    <>
      <PageHead title="Support Tickets" sub="Maombi ya msaada kutoka vyama vyote — jibu la kwanza ndani ya muda wa mkataba (Dharura saa 2 · Kubwa saa 8 · Kawaida siku 2)" />
      {s && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Zinasubiri jibu letu" value={s.waiting} hint={`Zilizo wazi ${s.open}`} />
          <Kpi tone={s.overdue ? 'bad' : undefined} label="Zimechelewa (SLA)" value={s.overdue} hint="Hazijajibiwa ndani ya muda" />
          <Kpi tone={s.unassigned ? 'warn' : undefined} label="Hazijagawiwa" value={s.unassigned} hint={`Zangu ${s.mine}`} />
          <Kpi label="Muda wa wastani wa jibu la kwanza" value={s.avgFirstHours ? `saa ${s.avgFirstHours}` : '—'} hint={`Zilizofungwa siku 30: ${s.closed30}`} />
          <Kpi tone="gold" label="Kuridhika kwa wateja (siku 30)" value={(s.csatUp ?? 0) + (s.csatDown ?? 0) ? `${Math.round(((s.csatUp ?? 0) / ((s.csatUp ?? 0) + (s.csatDown ?? 0))) * 100)}%` : '—'} hint={`👍 ${s.csatUp ?? 0} · 👎 ${s.csatDown ?? 0}`} />
        </div>
      )}
      {amcosId && <Alert kind="warn">Unaona tiketi za chama kimoja tu. <button className="link-btn" onClick={() => { sp.delete('amcosId'); setSp(sp); setView('active'); }}>Onyesha vyama vyote</button></Alert>}
      <Tabs value={view} onChange={setView} items={[['active', 'Zinazoendelea'], ['waiting', 'Zinasubiri jibu'], ['overdue', 'Zimechelewa'], ['unassigned', 'Hazijagawiwa'], ['mine', 'Zangu'], ['closed', 'Zilizofungwa'], ['all', 'Zote']]} />
      <section className="card">
        <div className="section-head"><Input id="tk-search" placeholder="Tafuta TK-namba, kichwa au chama…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} /></div>
        {loading && !data ? <Loading /> : !data?.data.length ? <Empty>Hakuna tiketi kwenye orodha hii.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tiketi</th><th>Chama</th><th>Aina</th><th>Uzito</th><th>Hali</th><th>Muda wa jibu</th><th>Anayeshughulikia</th></tr></thead>
              <tbody>{data.data.map((t) => {
                const sla = slaText(t.dueAt, t.firstResponseAt, t.status);
                return (
                  <tr key={t.id} className={t.overdue ? 'row-error' : undefined}>
                    <td><Link to={`/owner/support/${t.id}`}><span aria-hidden="true">{CATEGORY[t.category].icon} </span><strong>{t.subject}</strong></Link>
                      <div className="muted" style={{ fontSize: 12 }}><span className="tk-no">{t.number}</span> · {t.createdBy} ({ROLE_LABEL[t.createdByRole] ?? t.createdByRole}){t.waiting && t.status !== 'OPEN' ? ' · ujumbe mpya' : ''}</div></td>
                    <td>{t.amcosName}</td>
                    <td>{CATEGORY[t.category].label}</td>
                    <td><PriorityPill p={t.priority} /></td>
                    <td><StatusPill s={t.status} /></td>
                    <td>{sla ? <span className={sla.late ? 'money-neg' : 'muted'}>{sla.text}</span> : t.firstResponseAt ? <span className="muted">Imejibiwa</span> : '—'}</td>
                    <td>{t.assignee ?? <span className="muted">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface Detail {
  ticket: { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; dueAt: string; firstResponseAt: string | null; assignedToId: string | null; overdue: boolean; context: Record<string, string> | null };
  amcos: { id: string; name: string; code: string; phone: string | null };
  createdBy: { fullName: string; role: string; phone: string };
  otherTickets: number;
  messages: (Message & { authorRole?: string })[];
}

export function OwnerSupportDetail() {
  const { id } = useParams();
  const { has } = useAuth();
  const manage = has('support.manage');
  const { data, error, reload } = useFetch<Detail>(`/owner/support/tickets/${id}`);
  const team = useFetch<{ data: { id: string; fullName: string; role: string }[] }>(manage ? '/owner/support/assignees' : null);
  const send = useAction();
  const upd = useAction();
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.ticket;
  const patch = async (body: Record<string, unknown>) => { if (await upd.run(() => api(`/owner/support/tickets/${t.id}`, { method: 'PATCH', body }))) reload(); };
  const sla = slaText(t.dueAt, t.firstResponseAt, t.status);
  // ujumbe wa chama unaonyeshwa na cheo cha mwandishi
  const messages = data.messages.map((m) => (m.side === 'AMCOS' && m.authorRole ? { ...m, author: `${m.author} · ${ROLE_LABEL[m.authorRole] ?? m.authorRole}` } : m));
  return (
    <>
      <PageHead title={t.subject} sub={<><span className="tk-no">{t.number}</span> · {data.amcos.name} · {dateTime(t.createdAt)}</>}>
        <Link className="btn btn-ghost" to="/owner/support">← Foleni</Link>
      </PageHead>
      <section className="card tk-progress"><TicketSteps status={t.status} /></section>
      <div className="tk-layout">
        <section className="card tk-card">
          <Thread messages={messages} mine="PLATFORM" attachmentBase="/owner/support/attachments" />
          <Alert>{send.error}</Alert>
          {manage ? (
            <Composer busy={send.busy} internalOption placeholder="Jibu kwa chama… (au weka alama ya 'maelezo ya ndani' kwa timu tu)"
              onSend={async ({ body, attachments, internal }) => {
                const ok = await send.run(() => api(`/owner/support/tickets/${t.id}/messages`, { method: 'POST', body: { body, attachments, internal } }));
                if (ok) reload();
                return !!ok;
              }} />
          ) : <p className="muted card-pad">Una ruhusa ya kuona tu (support.read).</p>}
        </section>
        <aside className="tk-side">
          <section className="card card-pad tk-side-card">
            <h3>Hali ya tiketi</h3>
            {sla && <p className={sla.late ? 'money-neg' : 'muted'} style={{ margin: 0 }}><strong>{sla.text}</strong> kwa jibu la kwanza</p>}
            {manage ? (
              <>
                <SelectField label="Hali" value={t.status} onChange={(v) => patch({ status: v })} options={(Object.keys(STATUS) as TicketStatus[]).map((k) => ({ value: k, label: STATUS[k].label }))} />
                <SelectField label="Uzito" value={t.priority} onChange={(v) => patch({ priority: v })} options={(Object.keys(PRIORITY) as TicketPriority[]).map((k) => ({ value: k, label: `${PRIORITY[k].label} (${PRIORITY[k].sla})` }))} />
                <SelectField label="Anayeshughulikia" value={t.assignedToId ?? ''} placeholder="— Hajagawiwa —" onChange={(v) => patch({ assignedToId: v || null })}
                  options={(team.data?.data ?? []).map((u) => ({ value: u.id, label: `${u.fullName} (${ROLE_LABEL[u.role] ?? u.role})` }))} />
              </>
            ) : (<div className="tk-facts"><StatusPill s={t.status} /><PriorityPill p={t.priority} /></div>)}
            <Alert>{upd.error}</Alert>
          </section>
          <section className="card card-pad tk-side-card">
            <h3>Chama</h3>
            <dl className="tk-dl">
              <dt>Jina</dt><dd><Link to={`/owner/amcos/${data.amcos.id}`}>{data.amcos.name}</Link> ({data.amcos.code})</dd>
              <dt>Aliyefungua</dt><dd>{data.createdBy.fullName} · {ROLE_LABEL[data.createdBy.role] ?? data.createdBy.role}</dd>
              <dt>Simu</dt><dd>{phone(data.createdBy.phone)}</dd>
              <dt>Aina</dt><dd>{CATEGORY[t.category].label}</dd>
              {t.context?.page && <><dt>Ukurasa</dt><dd><code>{t.context.page}</code></dd></>}
              {t.context?.version && <><dt>Toleo</dt><dd>v{t.context.version}</dd></>}
              {t.context?.userAgent && <><dt>Kifaa</dt><dd className="tk-ua">{t.context.userAgent}</dd></>}
            </dl>
            {data.otherTickets > 0 && <Link className="link-btn" to={`/owner/support?amcosId=${data.amcos.id}`}>Tiketi nyingine {data.otherTickets} za chama hiki →</Link>}
          </section>
        </aside>
      </div>
    </>
  );
}
