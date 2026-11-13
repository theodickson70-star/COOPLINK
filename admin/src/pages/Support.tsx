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
  CATEGORY, Composer, PRIORITY, PriorityPill, slaText, StatusPill, Thread, TicketSteps, timeAgo,
  type Message, type TicketCategory, type TicketPriority, type TicketStatus,
} from '../components/Support';

interface Row { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; lastAmcosAt: string; lastPlatformAt: string | null; createdBy: string; unread: boolean }

const VIEWS = [{ k: 'ACTIVE', l: 'Zinazoendelea' }, { k: 'CLOSED', l: 'Zilizofungwa' }, { k: '', l: 'Zote' }];

export function Support() {
  const [view, setView] = useState('ACTIVE');
  const { user } = useAuth();
  const t = useT();
  const { data, loading } = useFetch<{ data: Row[] }>('/support/tickets', { status: view || undefined });
  const rows = data?.data ?? [];
  const yourTurn = rows.filter((r) => r.status === 'ANSWERED').length;
  const teamTurn = rows.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length;
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
      <div className="tk-toolbar">
        <div className="tabs" role="tablist">
          {VIEWS.map((v) => <button key={v.k} role="tab" aria-selected={view === v.k} className={view === v.k ? 'active' : ''} onClick={() => setView(v.k)}>{t(v.l)}</button>)}
        </div>
        {view === 'ACTIVE' && rows.length > 0 && (
          <div className="tk-counts">
            {yourTurn > 0 && <span className="tk-count you">{t('Zinakusubiri wewe: {n}', { n: yourTurn })}</span>}
            {teamTurn > 0 && <span className="tk-count team">{t('Zinasubiri timu: {n}', { n: teamTurn })}</span>}
          </div>
        )}
      </div>
      <section className="card tk-list-card">
        {loading && !data ? <Loading /> : !rows.length ? (
          <div className="tk-empty">
            <span aria-hidden="true">💬</span>
            <strong>{view === 'ACTIVE' ? t('Hakuna tiketi inayoendelea') : t('Hakuna tiketi.')}</strong>
            {view === 'ACTIVE' && <p>{t('Ukikwama mahali popote, fungua tiketi mpya — timu itakujibu hapa.')}</p>}
            {view === 'ACTIVE' && <Link className="btn btn-secondary btn-sm" to="/support/new">{t('+ Tiketi mpya')}</Link>}
          </div>
        ) : (
          <ul className="tk-list">
            {rows.map((r) => {
              const last = r.lastPlatformAt && r.lastPlatformAt > r.lastAmcosAt ? r.lastPlatformAt : r.lastAmcosAt;
              const whoLast = r.lastPlatformAt && r.lastPlatformAt > r.lastAmcosAt ? t('Timu ya CoopLink') : t('Wewe');
              return (
                <li key={r.id}>
                  <Link to={`/support/${r.id}`} className={`tk-row prio-${r.priority.toLowerCase()}${r.unread ? ' unread' : ''}${r.status === 'CLOSED' ? ' closed' : ''}`}>
                    <span className="tk-ico" aria-hidden="true">{CATEGORY[r.category].icon}</span>
                    <div className="tk-row-main">
                      <div className="tk-row-top">
                        <span className="tk-no">{r.number}</span>
                        <span className="tk-cat-label">{t(CATEGORY[r.category].label)}</span>
                        {r.unread && <span className="tk-new">{t('Jibu jipya')}</span>}
                      </div>
                      <strong className="tk-subject">{r.subject}</strong>
                      <span className="tk-last">{whoLast} · {timeAgo(last)}{user?.role === 'AMCOS_ADMIN' ? ` · ${t('imefunguliwa na {who}', { who: r.createdBy })}` : ''}</span>
                    </div>
                    <div className="tk-row-side"><PriorityPill p={r.priority} /><StatusPill s={r.status} /><span className="tk-chev" aria-hidden="true">›</span></div>
                  </Link>
                </li>
              );
            })}
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
        <h3 className="tk-step-h"><span>1</span>{t('Aina ya tatizo')}</h3>
        <div className="tk-cats" role="radiogroup" aria-label={t('Aina ya tatizo')}>
          {(Object.keys(CATEGORY) as TicketCategory[]).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} className={`tk-cat${category === c ? ' on' : ''}`} onClick={() => setCategory(c)}>
              <span className="tk-cat-ico" aria-hidden="true">{CATEGORY[c].icon}</span>
              <strong>{t(CATEGORY[c].label)}</strong><span>{t(CATEGORY[c].hint)}</span>
            </button>
          ))}
        </div>
        <h3 className="tk-step-h"><span>2</span>{t('Kichwa na uzito')}</h3>
        <div className="grid grid-2 tk-new-grid">
          <TextField label={t('Kichwa cha tatizo *')} id="tk-subject" value={subject} onChange={setSubject} placeholder={t('mf. Malipo ya ada yamekatwa lakini chama bado kimefungwa')} maxLength={140} />
          <div className="field">
            <label id="tk-prio-l">{t('Uzito wa tatizo')}</label>
            <div className="tk-prios" role="radiogroup" aria-labelledby="tk-prio-l">
              {(Object.keys(PRIORITY) as TicketPriority[]).map((p) => (
                <button key={p} type="button" role="radio" aria-checked={priority === p} className={`tk-prio-opt prio-${p.toLowerCase()}${priority === p ? ' on' : ''}`} onClick={() => setPriority(p)}>
                  <strong>{t(PRIORITY[p].label)}</strong><span>{t(PRIORITY[p].sla)}</span>
                </button>
              ))}
            </div>
            {priority === 'URGENT' && <span className="help">{t('Dharura ni kazi iliyosimama kabisa (mf. hamwezi kuingia, siku ya soko au malipo).')}</span>}
          </div>
        </div>
        <Alert>{error}</Alert>
        {!category && <p className="name-note">{t('Chagua aina ya tatizo hapo juu.')}</p>}
        <h3 className="tk-step-h"><span>3</span>{t('Eleza tatizo')}</h3>
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
  const { data, error, reload } = useFetch<{ ticket: { id: string; number: string; subject: string; category: TicketCategory; priority: TicketPriority; status: TicketStatus; createdAt: string; createdBy: string; firstResponseAt: string | null; dueAt?: string; rating?: number | null; ratedAt?: string | null }; messages: Message[] }>(`/support/tickets/${id}`);
  const send = useAction();
  const close = useAction();
  const tt = useT();
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.ticket;
  const sla = t.dueAt ? slaText(t.dueAt, t.firstResponseAt, t.status) : null;
  const note = t.status === 'CLOSED' ? tt('Tiketi imefungwa. Ukiandika ujumbe mpya, itafunguliwa upya.')
    : t.status === 'ANSWERED' ? tt('Timu imekujibu. Kama tatizo limetatuliwa, funga tiketi; kama bado, jibu hapa chini.')
      : t.firstResponseAt ? tt('Timu ya CoopLink inaendelea kulishughulikia. Utaona jibu hapa.')
        : tt('Timu ya CoopLink itajibu — {sla}.', { sla: tt(PRIORITY[t.priority].sla) });
  return (
    <>
      <PageHead title={<span className="tk-title"><span className="tk-ico" aria-hidden="true">{CATEGORY[t.category].icon}</span>{t.subject}</span>}
        sub={<><span className="tk-no">{t.number}</span> · {tt(CATEGORY[t.category].label)} · {tt('imefunguliwa na {who}', { who: t.createdBy })} {dateTime(t.createdAt)}</>}>
        <Link className="btn btn-ghost" to="/support">{tt('← Tiketi zote')}</Link>
      </PageHead>
      <section className="card tk-progress">
        <TicketSteps status={t.status} />
        <div className={`tk-progress-note${t.status === 'ANSWERED' ? ' you' : ''}`}>
          <span>{note}{sla && !sla.late ? <> <strong>{sla.text}</strong></> : null}</span>
          {t.status !== 'CLOSED' && (
            <Button variant={t.status === 'ANSWERED' ? 'primary' : 'ghost'} size="sm" busy={close.busy} onClick={async () => { if (await close.run(() => api(`/support/tickets/${t.id}/close`, { method: 'POST' }))) reload(); }}>{tt('✓ Tatizo limetatuliwa — funga')}</Button>
          )}
        </div>
        {t.status === 'CLOSED' && <RateTicket id={t.id} rated={t.ratedAt ? t.rating ?? 0 : null} onDone={reload} />}
      </section>
      <div className="tk-layout">
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
        <aside className="tk-side">
          <section className="card card-pad tk-side-card">
            <h3>{tt('Taarifa za tiketi')}</h3>
            <dl className="tk-dl">
              <dt>{tt('Namba')}</dt><dd><span className="tk-no">{t.number}</span></dd>
              <dt>{tt('Hali')}</dt><dd><StatusPill s={t.status} /></dd>
              <dt>{tt('Uzito')}</dt><dd><PriorityPill p={t.priority} /></dd>
              <dt>{tt('Aina')}</dt><dd>{tt(CATEGORY[t.category].label)}</dd>
              <dt>{tt('Aliyefungua')}</dt><dd>{t.createdBy}</dd>
              <dt>{tt('Ilifunguliwa')}</dt><dd>{dateTime(t.createdAt)}</dd>
              <dt>{tt('Jibu la kwanza')}</dt><dd>{t.firstResponseAt ? dateTime(t.firstResponseAt) : sla ? <span className={sla.late ? 'money-neg' : 'muted'}>{sla.text}</span> : '—'}</dd>
              <dt>{tt('Ujumbe')}</dt><dd>{data.messages.length}</dd>
            </dl>
          </section>
          <section className="card card-pad tk-side-card tk-tips">
            <h3>{tt('Kupata msaada haraka')}</h3>
            <ul>
              <li>{tt('Ambatisha picha ya skrini ya tatizo.')}</li>
              <li>{tt('Taja ulikuwa ukifanya nini na ukurasa gani.')}</li>
              <li>{tt('Tiketi moja kwa tatizo moja.')}</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

/** v0.38: maoni ya mteja baada ya tiketi kufungwa — swali moja tu */
function RateTicket({ id, rated, onDone }: { id: string; rated: number | null; onDone: () => void }) {
  const tt = useT();
  const act = useAction();
  const [pick, setPick] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState('');
  if (rated !== null) return <div className="tk-rate done">{rated === 1 ? '👍' : '👎'} {tt('Asante kwa maoni yako!')}</div>;
  const send = async (r: 1 | -1) => { if (await act.run(() => api(`/support/tickets/${id}/rating`, { method: 'POST', body: { rating: r, comment: comment.trim() || undefined } }))) onDone(); };
  return (
    <div className="tk-rate">
      <span>{tt('Umeridhika na msaada uliopata?')}</span>
      <div className="actions">
        <Button size="sm" variant={pick === 1 ? 'primary' : 'secondary'} onClick={() => setPick(1)}>👍 {tt('Ndiyo')}</Button>
        <Button size="sm" variant={pick === -1 ? 'danger' : 'secondary'} onClick={() => setPick(-1)}>👎 {tt('Hapana')}</Button>
      </div>
      {pick !== null && <>
        <input className="input" maxLength={500} placeholder={pick === 1 ? tt('Maoni (hiari)') : tt('Tuambie tuboreshe nini (hiari)')} value={comment} onChange={(e) => setComment(e.target.value)} aria-label={tt('Maoni')} />
        <Button size="sm" busy={act.busy} onClick={() => send(pick)}>{tt('Tuma')}</Button>
      </>}
      <Alert>{act.error}</Alert>
    </div>
  );
}
