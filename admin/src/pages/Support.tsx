// =====================================================================
//  MSAADA (upande wa chama): kufungua tiketi na kufuatilia majibu ya timu ya CoopLink
// =====================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { CompanyContact } from '../components/CompanyContact';
import { useT } from '../lib/prefs';
import { Alert, Button, Empty, Loading, PageHead, SelectField, TextField } from '../components/ui';
import {
  CATEGORY, Composer, PRIORITY, PriorityPill, StatusPill, Thread,
  type Message, type TicketCategory, type TicketPriority, type TicketStatus,
} from '../components/Support';

interface Row { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; lastAmcosAt: string; lastPlatformAt: string | null; createdBy: string; unread: boolean }

const VIEWS = [{ k: 'ACTIVE', l: 'Zinazoendelea' }, { k: 'CLOSED', l: 'Zilizofungwa' }, { k: '', l: 'Zote' }];

export function Support() {
  const [view, setView] = useState('ACTIVE');
  const { user } = useAuth();
  const t = useT();
  const { data, loading } = useFetch<{ data: Row[] }>('/support/tickets', { status: view || undefined });
  return (
    <>
      <PageHead title={t('Msaada')} sub={t('Uliza swali, ripoti hitilafu au omba kipengele kipya. Timu ya CoopLink inajibu hapa hapa.')}>
        <Link className="btn btn-primary" to="/support/new">{t('+ Tiketi mpya')}</Link>
      </PageHead>
      <CompanyContact variant="card" />
      <div className="tk-sla card">
        <strong>{t('Muda wa kujibiwa:')}</strong>
        {(Object.keys(PRIORITY) as TicketPriority[]).map((p) => <span key={p}><PriorityPill p={p} /> {t(PRIORITY[p].sla)}</span>)}
      </div>
      <div className="tabs" role="tablist">
        {VIEWS.map((v) => <button key={v.k} role="tab" aria-selected={view === v.k} className={view === v.k ? 'active' : ''} onClick={() => setView(v.k)}>{t(v.l)}</button>)}
      </div>
      <section className="card">
        {loading && !data ? <Loading /> : !data?.data.length ? (
          <Empty>{view === 'ACTIVE' ? t('Hakuna tiketi inayoendelea. Ukikwama mahali popote, fungua tiketi mpya.') : t('Hakuna tiketi.')}</Empty>
        ) : (
          <ul className="tk-list">
            {data.data.map((r) => (
              <li key={r.id}>
                <Link to={`/support/${r.id}`} className={`tk-row${r.unread ? ' unread' : ''}`}>
                  <div className="tk-row-main">
                    <div className="tk-row-top"><span className="tk-no">{r.number}</span>{r.unread && <span className="tk-new">{t('Jibu jipya')}</span>}</div>
                    <strong>{r.subject}</strong>
                    <span className="muted">{t(CATEGORY[r.category].label)}{user?.role === 'AMCOS_ADMIN' ? ` · ${r.createdBy}` : ''} · {dateTime(r.lastPlatformAt && r.lastPlatformAt > r.lastAmcosAt ? r.lastPlatformAt : r.lastAmcosAt)}</span>
                  </div>
                  <div className="tk-row-side"><PriorityPill p={r.priority} /><StatusPill s={r.status} /></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function SupportNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const from = sp.get('from') ?? undefined;
  const [category, setCategory] = useState<TicketCategory | ''>(from?.startsWith('/billing') ? 'PAYMENT' : '');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [subject, setSubject] = useState('');
  const { busy, error, run } = useAction();
  const t = useT();
  return (
    <>
      <PageHead title={t('Tiketi mpya ya msaada')} sub={t('Eleza tatizo kwa kifupi na kwa uwazi. Picha ya skrini inasaidia timu kuelewa haraka.')} />
      <section className="card tk-new-card">
        <div className="tk-cats" role="radiogroup" aria-label={t('Aina ya tatizo')}>
          {(Object.keys(CATEGORY) as TicketCategory[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} className={`tk-cat${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
              <strong>{t(CATEGORY[c].label)}</strong><span>{t(CATEGORY[c].hint)}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-2">
          <TextField label={t('Kichwa cha tatizo *')} id="tk-subject" value={subject} onChange={setSubject} placeholder={t('mf. Malipo ya ada yamekatwa lakini chama bado kimefungwa')} maxLength={140} />
          <SelectField label={t('Uzito wa tatizo')} value={priority} onChange={(v) => setPriority(v as TicketPriority)}
            options={(Object.keys(PRIORITY) as TicketPriority[]).map((p) => ({ value: p, label: `${t(PRIORITY[p].label)} — ${t(PRIORITY[p].sla)}` }))}
            help={priority === 'URGENT' ? t('Dharura ni kazi iliyosimama kabisa (mf. hamwezi kuingia, siku ya soko au malipo).') : undefined} />
        </div>
        <Alert>{error}</Alert>
        {!category && <p className="name-note">{t('Chagua aina ya tatizo hapo juu.')}</p>}
        <Composer busy={busy} submitLabel={t('Fungua tiketi')} placeholder={t('Eleza kilichotokea: ulikuwa unafanya nini, ulitarajia nini, na nini kilitokea badala yake.')}
          onSend={async ({ body, attachments }) => {
            if (!category || subject.trim().length < 4) { await run(async () => { throw new Error(!category ? t('Chagua aina ya tatizo') : t('Andika kichwa cha tatizo (angalau herufi 4)')); }); return false; }
            const r = await run(() => api<{ ticket: { id: string } }>('/support/tickets', { method: 'POST', body: {
              category, priority, subject, body, attachments,
              context: { page: from, version: __APP_VERSION__, userAgent: navigator.userAgent.slice(0, 380) },
            } }));
            if (r) { nav(`/support/${r.ticket.id}`, { replace: true }); return true; }
            return false;
          }} />
      </section>
    </>
  );
}

export function SupportDetail() {
  const { id } = useParams();
  const { data, error, reload } = useFetch<{ ticket: { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; createdBy: string; firstResponseAt: string | null }; messages: Message[] }>(`/support/tickets/${id}`);
  const send = useAction();
  const close = useAction();
  const tt = useT();
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.ticket;
  return (
    <>
      <PageHead title={t.subject} sub={<><span className="tk-no">{t.number}</span> · {tt(CATEGORY[t.category].label)} · {tt('imefunguliwa na {who}', { who: t.createdBy })} {dateTime(t.createdAt)}</>}>
        <Link className="btn btn-ghost" to="/support">{tt('← Tiketi zote')}</Link>
      </PageHead>
      <div className="tk-status-bar card">
        <StatusPill s={t.status} /><PriorityPill p={t.priority} />
        <span className="muted">{t.status === 'CLOSED' ? tt('Tiketi imefungwa. Ukiandika ujumbe mpya, itafunguliwa upya.') : t.firstResponseAt ? tt('Timu ya CoopLink imeshajibu. Endelea na mazungumzo hapa chini.') : tt('Timu ya CoopLink itajibu — {sla}.', { sla: tt(PRIORITY[t.priority].sla) })}</span>
        {t.status !== 'CLOSED' && (
          <Button variant="ghost" size="sm" busy={close.busy} onClick={async () => { if (await close.run(() => api(`/support/tickets/${t.id}/close`, { method: 'POST' }))) reload(); }}>{tt('✓ Tatizo limetatuliwa — funga')}</Button>
        )}
      </div>
      <section className="card tk-card">
        <Thread messages={data.messages} mine="AMCOS" attachmentBase="/support/attachments" />
        <Alert>{send.error ?? close.error}</Alert>
        <Composer busy={send.busy} placeholder={t.status === 'CLOSED' ? tt('Andika ujumbe kufungua tiketi upya…') : tt('Jibu au ongeza maelezo…')}
          onSend={async ({ body, attachments }) => {
            const ok = await send.run(() => api(`/support/tickets/${t.id}/messages`, { method: 'POST', body: { body, attachments } }));
            if (ok) reload();
            return !!ok;
          }} />
      </section>
    </>
  );
}
