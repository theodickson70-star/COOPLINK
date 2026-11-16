// Dashibodi za watumishi: Meneja, Mhasibu, Storekeeper — kila mmoja anaona kazi zake
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, MOVE_LABEL, num, STAFF_DUTY, tsh, UNIT_LABEL } from '../lib/format';
import { Alert, Badge, Empty, Loading } from '../components/ui';
import { Kpi, Section } from '../components/owner-ui';
import { ComingSoon, Dashboard, HomeHero, QuickLinks, TaskPanel, type Task } from './Dashboard';
import { Icon } from '../components/icons';
import { useT } from '../lib/prefs';
import { FinanceAlerts } from '../components/FinanceAlerts';
import { AccountingHome } from './Accounting';

interface Summary {
  role: string; title: string | null;
  covering?: ('ACCOUNTANT' | 'CLERK')[];
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
  const { user, may } = useAuth();
  const isStaff = user && ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'].includes(user.role);
  const { data, error, loading } = useFetch<Summary>(isStaff ? '/workspace/summary' : null);
  const ov = useFetch<{ findings: { open: number }; directives: { open: number; inProgress: number } }>(isStaff && may('oversight.read') ? '/oversight/summary' : null);
  if (!isStaff) return <Dashboard />;
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const first = user!.fullName.split(' ')[0];
  // Kazi zinazosubiri — kutoka muhtasari wa kazi wa mtumishi (takwimu halisi)
  const tasks: Task[] = [];
  const f = data.finance, st = data.stock, pr = data.production;
  if (data.approvals?.total) tasks.push({ to: '/approvals', icon: 'tasks', tone: 'gold', title: data.role === 'AMCOS_ADMIN' ? `Maombi ${num(data.approvals.total)} yanasubiri uamuzi wako` : `Maombi yako ${num(data.approvals.total)} yanasubiri idhini`, sub: 'Idhini' });
  if (data.members.pending) tasks.push({ to: '/members', icon: 'userPlus', tone: 'green', title: `Wakulima ${num(data.members.pending)} wanasubiri uthibitisho`, sub: 'Wanachama' });
  if (f?.toPost) tasks.push({ to: '/finance', icon: 'receipt', tone: 'blue', title: `Miamala ${num(f.toPost)} imeidhinishwa — ikamilishwe`, sub: 'Miamala na hati', right: tsh(f.toPostAmount) });
  if (pr?.pendingIssues && data.role !== 'AMCOS_ADMIN') tasks.push({ to: '/input-issues', icon: 'inputs', tone: 'gold', title: `Ugawaji ${num(pr.pendingIssues)} unasubiri idhini`, sub: 'Ugawaji wa pembejeo' });
  if (st?.purchasesAwaitingReceipt) tasks.push({ to: '/purchases', icon: 'cart', tone: 'blue', title: `Manunuzi ${num(st.purchasesAwaitingReceipt)} yanasubiri mzigo`, sub: 'Manunuzi na wazabuni' });
  if (st?.low.length) tasks.push({ to: '/inputs', icon: 'inputs', tone: 'red', title: `Bidhaa ${num(st.low.length)} zina stoo ndogo`, sub: st.low.slice(0, 3).map((l) => l.name).join(', ') });
  const ovOpen = (ov.data?.findings.open ?? 0) + (ov.data?.directives.open ?? 0) + (ov.data?.directives.inProgress ?? 0);
  if (ovOpen) tasks.push({ to: '/oversight', icon: 'shield', tone: 'red', title: `Hoja na maagizo ${num(ovOpen)} ya Afisa Ushirika`, sub: 'Ukaguzi na maagizo' });
  const work = (
    <div className="dash2-row">
      <TaskPanel tasks={tasks} allTo={may('approvals.read') ? '/approvals' : undefined} />
      <QuickLinks />
    </div>
  );
  return (
    <>
      <HomeHero name={first} sub={<><strong>{t(data.title ?? '')}</strong> · {t(STAFF_DUTY[data.role])}{data.season ? <> · {t('Msimu')} <strong>{data.season.name}</strong></> : null}</>}>
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
      </HomeHero>
      {data.role === 'AMCOS_ADMIN' && <SetupChecklist />}
      {data.role === 'AMCOS_ADMIN' && <Manager d={data} work={work} />}
      {data.role === 'ACCOUNTANT' && <div className="stack">{work}<AccountingHome embedded /><Pending d={data} title={t('Maombi yangu')} /></div>}
      {data.role === 'CLERK' && <Storekeeper d={data} work={work} />}
      <div style={{ marginTop: 16 }}><ComingSoon /></div>
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

function Manager({ d, work }: { d: Summary; work: ReactNode }) {
  const t = useT();
  const f = d.finance, s = d.stock, p = d.production;
  return (
    <div className="stack">
      {!!d.covering?.length && (
        <section className="card solo-card">
          <span className="solo-ico" aria-hidden="true">🧑‍💼</span>
          <div>
            <strong>{d.covering.length === 2 ? t('Chama hakina Mhasibu wala Storekeeper') : d.covering[0] === 'ACCOUNTANT' ? t('Chama hakina Mhasibu') : t('Chama hakina Storekeeper')}</strong>
            <p>{t('Kwa sasa unafanya kazi zao pia ({roles}). Maombi unayoyaandaa mwenyewe utayaidhinisha kwa nenosiri na maelezo — yanaandikwa "Imejiidhinisha" na yanaonekana kwa CoopLink na Chama Kikuu. Ukimuongeza mtumishi, kazi hizo zinarudi kwake zenyewe.', { roles: d.covering.map((r) => (r === 'ACCOUNTANT' ? t('fedha, mauzo, mishahara') : t('wakulima, stoo, ugawaji'))).join(' · ') })}</p>
          </div>
          <Link className="btn btn-secondary btn-sm" to="/users">{t('+ Ongeza mtumishi')}</Link>
        </section>
      )}
      <FinanceAlerts />
      <div className="grid grid-kpi">
        <Kpi tone={d.approvals?.total ? 'gold' : 'dark'} icon={<Icon name="tasks" />} label={t('Maombi yanayosubiri idhini')} value={num(d.approvals?.total)} hint={d.approvals?.total ? t('Bofya "Idhini" kuamua') : t('Hakuna kinachosubiri')} />
        <Kpi icon={<Icon name="members" />} label={t('Wakulima hai')} value={num(d.members.active)} hint={d.members.pending ? t('{n} wanasubiri uthibitisho', { n: d.members.pending }) : t('{n} wanawake', { n: num(d.members.female) })} tone={d.members.pending ? 'warn' : undefined} />
        {p && <Kpi icon={<Icon name="leaf" />} label={t('Uzalishaji unaotarajiwa')} value={`${num(p.approvedKg)} kg`} hint={t('Ekari {a} · makisio {n} yanasubiri', { a: num(p.acres), n: p.draft })} />}
        {p && <Kpi icon={<Icon name="inputs" />} label={t('Pembejeo zilizotolewa')} value={tsh(p.inputsIssuedValue)} hint={t('Wakulima {n}', { n: num(p.farmersWithInputs) })} />}
        {f && <Kpi icon={<Icon name="bank" />} label={t('Fedha zilizopo')} value={tsh(f.cashTotal)} hint={t('Akaunti {n}', { n: f.accounts.length })} />}
        {f && <Kpi tone={Number(f.farmerDebts) > 0 ? 'warn' : undefined} icon={<Icon name="scale" />} label={t('Madeni ya wakulima')} value={tsh(f.farmerDebts)} hint={t('Wakulima {n}', { n: num(f.farmersOwing) })} />}
      </div>
      {work}
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

function Storekeeper({ d, work }: { d: Summary; work: ReactNode }) {
  const t = useT();
  const s = d.stock!;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi tone="dark" icon={<Icon name="inputs" />} label={t('Bidhaa')} value={num(s.items)} hint={t('{n} zimeisha stoo', { n: s.outOfStock })} />
        <Kpi tone={s.low.length ? 'warn' : undefined} icon={<Icon name="debt" />} label={t('Stoo ndogo')} value={num(s.low.length)} />
        <Kpi icon={<Icon name="arrowIn" />} label={t('Zilizoingia (msimu)')} value={num(s.received)} />
        <Kpi icon={<Icon name="arrowOut" />} label={t('Zilizotoka (msimu)')} value={num(s.issued)} />
        <Kpi tone={Number(s.damaged) + Number(s.expired) > 0 ? 'bad' : undefined} icon={<Icon name="stop" />} label={t('Zilizoharibika / muda umeisha')} value={`${num(s.damaged)} / ${num(s.expired)}`} hint={s.expiringSoon ? t('{n} zinakaribia kuisha muda', { n: s.expiringSoon }) : undefined} />
        <Kpi tone={s.purchasesAwaitingReceipt ? 'gold' : undefined} icon={<Icon name="cart" />} label={t('Manunuzi — subiri mzigo')} value={num(s.purchasesAwaitingReceipt)} hint={t('{n} yanasubiri idhini', { n: s.purchasesAwaitingApproval })} />
        <Kpi icon={<Icon name="issue" />} label={t('Ugawaji unasubiri idhini')} value={num(d.production?.pendingIssues)} />
        <Kpi icon={<Icon name="userPlus" />} label={t('Wakulima wanasubiri uthibitisho')} value={num(d.members.pending)} />
      </div>
      {work}
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
