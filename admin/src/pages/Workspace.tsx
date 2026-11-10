// Dashibodi za watumishi: Meneja, Mhasibu, Stokipa — kila mmoja anaona kazi zake
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, MOVE_LABEL, num, STAFF_DUTY, tsh, UNIT_LABEL } from '../lib/format';
import { Alert, Badge, Empty, Loading, PageHead } from '../components/ui';
import { Kpi, Section } from '../components/owner-ui';
import { Dashboard } from './Dashboard';
import { useT } from '../lib/prefs';
import { FinanceAlerts } from '../components/FinanceAlerts';
import { AccountingHome } from './Accounting';

interface Summary {
  role: string; title: string | null;
  season: { id: string; name: string; status: string } | null;
  members: { total: number; active: number; pending: number; female: number };
  production?: { approvedKg: string; draft: number; acres: string; inputsIssuedValue: string; farmersWithInputs: number; pendingIssues: number };
  approvals?: { total: number; byType: { type: string; label: string; count: number; amount: string }[]; recent: { id: string; requestNo: string; typeLabel: string; title: string; amount: string | null; status: string; createdAt: string; decisionNote: string | null }[] };
  finance?: {
    accounts: { id: string; name: string; kind: string; balance: string }[]; cashTotal: string; seasonIncome: string; seasonOut: string;
    awaitingApproval: number; awaitingApprovalAmount: string; toPost: number; toPostAmount: string;
    farmerDebts: string; farmersOwing: number; owedToFarmers: string; budget: { total: string; spent: string } | null;
  };
  stock?: {
    items: number; low: { id: string; name: string; unit: string; balance: string; reorderLevel: string }[]; outOfStock: number;
    received: string; issued: string; damaged: string; expired: string; purchasesAwaitingApproval: number; purchasesAwaitingReceipt: number;
    pendingAdjustments: number; expiringSoon: number; recent: { id: string; type: string; quantity: string; reference: string | null; createdAt: string; name: string }[];
  };
}

const APPROVAL_STATUS: Record<string, string> = { PENDING: 'Inasubiri', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };

export function Workspace() {
  const t = useT();
  const { user } = useAuth();
  const isStaff = user && ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'].includes(user.role);
  const { data, error, loading } = useFetch<Summary>(isStaff ? '/workspace/summary' : null);
  if (!isStaff) return <Dashboard />;
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const first = user!.fullName.split(' ')[0];
  return (
    <>
      <PageHead title={t('Habari, {name}', { name: first })} sub={<><strong>{t(data.title ?? '')}</strong> · {t(STAFF_DUTY[data.role])}{data.season ? <> · {t('Msimu')} <strong>{data.season.name}</strong></> : null}</>}>
        {data.role === 'CLERK' && <>
          <Link className="btn btn-secondary" to="/inputs">{t('Ingiza pembejeo')}</Link>
          <Link className="btn btn-gold" to="/input-issues/new">{t('Toa pembejeo')}</Link>
          <Link className="btn btn-primary" to="/purchases">{t('Ombi la manunuzi')}</Link>
        </>}
        {data.role === 'ACCOUNTANT' && <>
          <Link className="btn btn-gold" to="/sales">{t('Mauzo ya tumbaku')}</Link>
          <Link className="btn btn-primary" to="/finance">{t('Rekodi muamala')}</Link>
        </>}
        {data.role === 'AMCOS_ADMIN' && <Link className="btn btn-secondary" to="/accounting/reports">{t('Ripoti za fedha')}</Link>}
        {data.role === 'AMCOS_ADMIN' && <Link className="btn btn-gold" to="/approvals">{t('Idhini')} ({data.approvals?.total ?? 0})</Link>}
      </PageHead>
      {data.role === 'AMCOS_ADMIN' && <SetupChecklist />}
      {data.role === 'AMCOS_ADMIN' && <Manager d={data} />}
      {data.role === 'ACCOUNTANT' && <div className="stack"><AccountingHome embedded /><Pending d={data} title={t('Maombi yangu')} /></div>}
      {data.role === 'CLERK' && <Storekeeper d={data} />}
    </>
  );
}

function Pending({ d, title }: { d: Summary; title: string }) {
  const t = useT();
  const a = d.approvals;
  if (!a) return null;
  return (
    <Section pad={false} title={title} actions={<Link to="/approvals">{t('Fungua yote →')}</Link>}>
      {a.total > 0 && (
        <div className="actions" style={{ padding: '0 16px 12px' }}>
          {a.byType.map((x) => <span key={x.type} className="badge badge-warn">{t(x.label)}: {x.count}{Number(x.amount) > 0 ? ` · ${tsh(x.amount)}` : ''}</span>)}
        </div>
      )}
      {a.recent.length === 0 ? <Empty>{t('Hakuna maombi.')}</Empty> : (
        <div className="table-wrap"><table className="table stack-sm"><tbody>{a.recent.map((r) => (
          <tr key={r.id}>
            <td style={{ whiteSpace: 'nowrap' }}><strong>{r.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{t(r.typeLabel)}</div></td>
            <td>{r.title}{r.decisionNote && <div className="muted" style={{ fontSize: 12 }}>"{r.decisionNote}"</div>}</td>
            <td className="num">{r.amount ? tsh(r.amount) : ''}</td>
            <td><Badge status={r.status === 'PENDING' ? 'DRAFT' : r.status} label={t(APPROVAL_STATUS[r.status])} /></td>
          </tr>
        ))}</tbody></table></div>
      )}
    </Section>
  );
}

function LowStock({ s }: { s: NonNullable<Summary['stock']> }) {
  const t = useT();
  return (
    <Section pad={false} title={t('Bidhaa zenye stoo ndogo')} actions={<Link to="/inputs">{t('Stoo →')}</Link>}>
      {s.low.length === 0 ? <Empty>{t('Hakuna bidhaa iliyo chini ya kiwango.')}</Empty> : (
        <div className="table-wrap"><table className="table"><tbody>{s.low.map((i) => (
          <tr key={i.id}><td>{i.name}</td><td className="num money-neg">{num(i.balance)} {t(UNIT_LABEL[i.unit])}</td><td className="num muted">{t('kiwango')} {num(i.reorderLevel)}</td></tr>
        ))}</tbody></table></div>
      )}
    </Section>
  );
}

function Manager({ d }: { d: Summary }) {
  const t = useT();
  const f = d.finance, s = d.stock, p = d.production;
  return (
    <div className="stack">
      <FinanceAlerts />
      <div className="grid grid-kpi">
        <Kpi tone={d.approvals?.total ? 'gold' : 'dark'} label={t('Maombi yanayosubiri idhini')} value={num(d.approvals?.total)} hint={d.approvals?.total ? t('Bofya "Idhini" kuamua') : t('Hakuna kinachosubiri')} />
        <Kpi label={t('Wakulima hai')} value={num(d.members.active)} hint={d.members.pending ? t('{n} wanasubiri uthibitisho', { n: d.members.pending }) : t('{n} wanawake', { n: num(d.members.female) })} tone={d.members.pending ? 'warn' : undefined} />
        {p && <Kpi label={t('Uzalishaji unaotarajiwa')} value={`${num(p.approvedKg)} kg`} hint={t('Ekari {a} · makisio {n} yanasubiri', { a: num(p.acres), n: p.draft })} />}
        {p && <Kpi label={t('Pembejeo zilizotolewa')} value={tsh(p.inputsIssuedValue)} hint={t('Wakulima {n}', { n: num(p.farmersWithInputs) })} />}
        {f && <Kpi label={t('Fedha zilizopo')} value={tsh(f.cashTotal)} hint={t('Akaunti {n}', { n: f.accounts.length })} />}
        {f && <Kpi tone={Number(f.farmerDebts) > 0 ? 'warn' : undefined} label={t('Madeni ya wakulima')} value={tsh(f.farmerDebts)} hint={t('Wakulima {n}', { n: num(f.farmersOwing) })} />}
      </div>
      <Pending d={d} title={t('Maombi ya karibuni')} />
      <div className="grid grid-2">
        {f && (
          <Section title={t('Fedha za msimu')} actions={<Link to="/finance">{t('Ripoti →')}</Link>}>
            <dl className="dl">
              <dt>{t('Mapato')}</dt><dd className="money-pos">{tsh(f.seasonIncome)}</dd>
              <dt>{t('Matumizi na malipo')}</dt><dd className="money-neg">{tsh(f.seasonOut)}</dd>
              <dt>{t('Yanasubiri idhini')}</dt><dd>{f.awaitingApproval} · {tsh(f.awaitingApprovalAmount)}</dd>
              <dt>{t('Yaliyoidhinishwa, hayajalipwa')}</dt><dd>{f.toPost} · {tsh(f.toPostAmount)}</dd>
              {f.budget && <><dt>{t('Bajeti')}</dt><dd>{tsh(f.budget.spent)} {t('kati ya')} {tsh(f.budget.total)}</dd></>}
            </dl>
          </Section>
        )}
        {s && (
          <Section title={t('Hali ya stoo')} actions={<Link to="/inputs">{t('Stoo →')}</Link>}>
            <dl className="dl">
              <dt>{t('Bidhaa')}</dt><dd>{s.items} · {t('{n} zimeisha', { n: s.outOfStock })}</dd>
              <dt>{t('Stoo ndogo')}</dt><dd>{s.low.length ? <span className="money-neg">{s.low.map((l) => l.name).join(', ')}</span> : t('Hakuna')}</dd>
              <dt>{t('Marekebisho yanasubiri')}</dt><dd>{s.pendingAdjustments}</dd>
              <dt>{t('Manunuzi')}</dt><dd>{t('{a} yanasubiri idhini · {b} yanasubiri mzigo', { a: s.purchasesAwaitingApproval, b: s.purchasesAwaitingReceipt })}</dd>
              <dt>{t('Zilizoharibika / muda')}</dt><dd>{num(s.damaged)} / {num(s.expired)}</dd>
            </dl>
          </Section>
        )}
      </div>
    </div>
  );
}

function Storekeeper({ d }: { d: Summary }) {
  const t = useT();
  const s = d.stock!;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi tone="dark" label={t('Bidhaa')} value={num(s.items)} hint={t('{n} zimeisha stoo', { n: s.outOfStock })} />
        <Kpi tone={s.low.length ? 'warn' : undefined} label={t('Stoo ndogo')} value={num(s.low.length)} />
        <Kpi label={t('Zilizoingia (msimu)')} value={num(s.received)} />
        <Kpi label={t('Zilizotoka (msimu)')} value={num(s.issued)} />
        <Kpi tone={Number(s.damaged) + Number(s.expired) > 0 ? 'bad' : undefined} label={t('Zilizoharibika / muda umeisha')} value={`${num(s.damaged)} / ${num(s.expired)}`} hint={s.expiringSoon ? t('{n} zinakaribia kuisha muda', { n: s.expiringSoon }) : undefined} />
        <Kpi tone={s.purchasesAwaitingReceipt ? 'gold' : undefined} label={t('Manunuzi — subiri mzigo')} value={num(s.purchasesAwaitingReceipt)} hint={t('{n} yanasubiri idhini', { n: s.purchasesAwaitingApproval })} />
        <Kpi label={t('Ugawaji unasubiri idhini')} value={num(d.production?.pendingIssues)} />
        <Kpi label={t('Wakulima wanasubiri uthibitisho')} value={num(d.members.pending)} />
      </div>
      <div className="grid grid-2">
        <LowStock s={s} />
        <Section pad={false} title={t('Mienendo ya stoo ya karibuni')}>
          {s.recent.length === 0 ? <Empty>{t('Hakuna bado.')}</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{s.recent.map((m) => (
              <tr key={m.id}><td>{m.name}<div className="muted" style={{ fontSize: 12 }}>{dateTime(m.createdAt)}</div></td><td>{t(MOVE_LABEL[m.type] ?? m.type)}</td><td className={`num ${Number(m.quantity) < 0 ? 'money-neg' : 'money-pos'}`}>{Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Section>
      </div>
      <Pending d={d} title={t('Maombi yangu kwa Meneja')} />
    </div>
  );
}

/** Hatua za kuanza kutumia CoopLink (Meneja) — inajificha hatua zote zikikamilika */
function SetupChecklist() {
  const t = useT();
  const { data } = useFetch<{ steps: { key: string; title: string; done: boolean; detail: string; to: string }[]; done: number; total: number }>('/workspace/setup');
  const [open, setOpen] = useState(true);
  if (!data || !data.total || data.done === data.total) return null;
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <section className="card setup-card">
      <button type="button" className="setup-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div><strong>{t('Hatua za kuanza kutumia CoopLink')}</strong><span className="muted"> · {t('{a} kati ya {b} zimekamilika', { a: data.done, b: data.total })}</span></div>
        <span className="muted">{open ? t('Ficha ▲') : t('Onyesha ▼')}</span>
      </button>
      <div className="setup-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      {open && (
        <ol className="setup-steps">
          {data.steps.map((s) => (
            <li key={s.key} className={s.done ? 'done' : ''}>
              <span className="setup-dot">{s.done ? '✓' : ''}</span>
              <div><Link to={s.to}>{t(s.title)}</Link><div className="muted" style={{ fontSize: 12.5 }}>{t(s.detail)}</div></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
