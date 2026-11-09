// Dashibodi za watumishi: Meneja, Mhasibu, Stokipa — kila mmoja anaona kazi zake
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, MOVE_LABEL, num, STAFF_DUTY, tsh, UNIT_LABEL } from '../lib/format';
import { Alert, Badge, Empty, Loading, PageHead } from '../components/ui';
import { Kpi, Section } from '../components/owner-ui';
import { Dashboard } from './Dashboard';
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
  const { user } = useAuth();
  const isStaff = user && ['AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK'].includes(user.role);
  const { data, error, loading } = useFetch<Summary>(isStaff ? '/workspace/summary' : null);
  if (!isStaff) return <Dashboard />;
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const first = user!.fullName.split(' ')[0];
  return (
    <>
      <PageHead title={`Habari, ${first}`} sub={<><strong>{data.title}</strong> · {STAFF_DUTY[data.role]}{data.season ? <> · Msimu <strong>{data.season.name}</strong></> : null}</>}>
        {data.role === 'CLERK' && <>
          <Link className="btn btn-secondary" to="/inputs">Ingiza pembejeo</Link>
          <Link className="btn btn-gold" to="/input-issues/new">Toa pembejeo</Link>
          <Link className="btn btn-primary" to="/purchases">Ombi la manunuzi</Link>
        </>}
        {data.role === 'ACCOUNTANT' && <>
          <Link className="btn btn-gold" to="/sales">Mauzo ya tumbaku</Link>
          <Link className="btn btn-primary" to="/finance">Rekodi muamala</Link>
        </>}
        {data.role === 'AMCOS_ADMIN' && <Link className="btn btn-secondary" to="/accounting/reports">Ripoti za fedha</Link>}
        {data.role === 'AMCOS_ADMIN' && <Link className="btn btn-gold" to="/approvals">Idhini ({data.approvals?.total ?? 0})</Link>}
      </PageHead>
      {data.role === 'AMCOS_ADMIN' && <SetupChecklist />}
      {data.role === 'AMCOS_ADMIN' && <Manager d={data} />}
      {data.role === 'ACCOUNTANT' && <div className="stack"><AccountingHome embedded /><Pending d={data} title="Maombi yangu" /></div>}
      {data.role === 'CLERK' && <Storekeeper d={data} />}
    </>
  );
}

function Pending({ d, title }: { d: Summary; title: string }) {
  const a = d.approvals;
  if (!a) return null;
  return (
    <Section pad={false} title={title} actions={<Link to="/approvals">Fungua yote →</Link>}>
      {a.total > 0 && (
        <div className="actions" style={{ padding: '0 16px 12px' }}>
          {a.byType.map((t) => <span key={t.type} className="badge badge-warn">{t.label}: {t.count}{Number(t.amount) > 0 ? ` · ${tsh(t.amount)}` : ''}</span>)}
        </div>
      )}
      {a.recent.length === 0 ? <Empty>Hakuna maombi.</Empty> : (
        <div className="table-wrap"><table className="table stack-sm"><tbody>{a.recent.map((r) => (
          <tr key={r.id}>
            <td style={{ whiteSpace: 'nowrap' }}><strong>{r.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{r.typeLabel}</div></td>
            <td>{r.title}{r.decisionNote && <div className="muted" style={{ fontSize: 12 }}>"{r.decisionNote}"</div>}</td>
            <td className="num">{r.amount ? tsh(r.amount) : ''}</td>
            <td><Badge status={r.status === 'PENDING' ? 'DRAFT' : r.status} label={APPROVAL_STATUS[r.status]} /></td>
          </tr>
        ))}</tbody></table></div>
      )}
    </Section>
  );
}

function LowStock({ s }: { s: NonNullable<Summary['stock']> }) {
  return (
    <Section pad={false} title="Bidhaa zenye stoo ndogo" actions={<Link to="/inputs">Stoo →</Link>}>
      {s.low.length === 0 ? <Empty>Hakuna bidhaa iliyo chini ya kiwango.</Empty> : (
        <div className="table-wrap"><table className="table"><tbody>{s.low.map((i) => (
          <tr key={i.id}><td>{i.name}</td><td className="num money-neg">{num(i.balance)} {UNIT_LABEL[i.unit]}</td><td className="num muted">kiwango {num(i.reorderLevel)}</td></tr>
        ))}</tbody></table></div>
      )}
    </Section>
  );
}

function Manager({ d }: { d: Summary }) {
  const f = d.finance, s = d.stock, p = d.production;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi tone={d.approvals?.total ? 'gold' : 'dark'} label="Maombi yanayosubiri idhini" value={num(d.approvals?.total)} hint={d.approvals?.total ? 'Bofya "Idhini" kuamua' : 'Hakuna kinachosubiri'} />
        <Kpi label="Wakulima hai" value={num(d.members.active)} hint={d.members.pending ? `${d.members.pending} wanasubiri uthibitisho` : `${num(d.members.female)} wanawake`} tone={d.members.pending ? 'warn' : undefined} />
        {p && <Kpi label="Uzalishaji unaotarajiwa" value={`${num(p.approvedKg)} kg`} hint={`Ekari ${num(p.acres)} · makisio ${p.draft} yanasubiri`} />}
        {p && <Kpi label="Pembejeo zilizotolewa" value={tsh(p.inputsIssuedValue)} hint={`Wakulima ${num(p.farmersWithInputs)}`} />}
        {f && <Kpi label="Fedha zilizopo" value={tsh(f.cashTotal)} hint={`Akaunti ${f.accounts.length}`} />}
        {f && <Kpi tone={Number(f.farmerDebts) > 0 ? 'warn' : undefined} label="Madeni ya wakulima" value={tsh(f.farmerDebts)} hint={`Wakulima ${num(f.farmersOwing)}`} />}
      </div>
      <Pending d={d} title="Maombi ya karibuni" />
      <div className="grid grid-2">
        {f && (
          <Section title="Fedha za msimu" actions={<Link to="/finance">Ripoti →</Link>}>
            <dl className="dl">
              <dt>Mapato</dt><dd className="money-pos">{tsh(f.seasonIncome)}</dd>
              <dt>Matumizi na malipo</dt><dd className="money-neg">{tsh(f.seasonOut)}</dd>
              <dt>Yanasubiri idhini</dt><dd>{f.awaitingApproval} · {tsh(f.awaitingApprovalAmount)}</dd>
              <dt>Yaliyoidhinishwa, hayajalipwa</dt><dd>{f.toPost} · {tsh(f.toPostAmount)}</dd>
              {f.budget && <><dt>Bajeti</dt><dd>{tsh(f.budget.spent)} kati ya {tsh(f.budget.total)}</dd></>}
            </dl>
          </Section>
        )}
        {s && (
          <Section title="Hali ya stoo" actions={<Link to="/inputs">Stoo →</Link>}>
            <dl className="dl">
              <dt>Bidhaa</dt><dd>{s.items} · {s.outOfStock} zimeisha</dd>
              <dt>Stoo ndogo</dt><dd>{s.low.length ? <span className="money-neg">{s.low.map((l) => l.name).join(', ')}</span> : 'Hakuna'}</dd>
              <dt>Marekebisho yanasubiri</dt><dd>{s.pendingAdjustments}</dd>
              <dt>Manunuzi</dt><dd>{s.purchasesAwaitingApproval} yanasubiri idhini · {s.purchasesAwaitingReceipt} yanasubiri mzigo</dd>
              <dt>Zilizoharibika / muda</dt><dd>{num(s.damaged)} / {num(s.expired)}</dd>
            </dl>
          </Section>
        )}
      </div>
    </div>
  );
}

function Storekeeper({ d }: { d: Summary }) {
  const s = d.stock!;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Bidhaa" value={num(s.items)} hint={`${s.outOfStock} zimeisha stoo`} />
        <Kpi tone={s.low.length ? 'warn' : undefined} label="Stoo ndogo" value={num(s.low.length)} />
        <Kpi label="Zilizoingia (msimu)" value={num(s.received)} />
        <Kpi label="Zilizotoka (msimu)" value={num(s.issued)} />
        <Kpi tone={Number(s.damaged) + Number(s.expired) > 0 ? 'bad' : undefined} label="Zilizoharibika / muda umeisha" value={`${num(s.damaged)} / ${num(s.expired)}`} hint={s.expiringSoon ? `${s.expiringSoon} zinakaribia kuisha muda` : undefined} />
        <Kpi tone={s.purchasesAwaitingReceipt ? 'gold' : undefined} label="Manunuzi — subiri mzigo" value={num(s.purchasesAwaitingReceipt)} hint={`${s.purchasesAwaitingApproval} yanasubiri idhini`} />
        <Kpi label="Ugawaji unasubiri idhini" value={num(d.production?.pendingIssues)} />
        <Kpi label="Wakulima wanasubiri uthibitisho" value={num(d.members.pending)} />
      </div>
      <div className="grid grid-2">
        <LowStock s={s} />
        <Section pad={false} title="Mienendo ya stoo ya karibuni">
          {s.recent.length === 0 ? <Empty>Hakuna bado.</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{s.recent.map((m) => (
              <tr key={m.id}><td>{m.name}<div className="muted" style={{ fontSize: 12 }}>{dateTime(m.createdAt)}</div></td><td>{MOVE_LABEL[m.type] ?? m.type}</td><td className={`num ${Number(m.quantity) < 0 ? 'money-neg' : 'money-pos'}`}>{Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Section>
      </div>
      <Pending d={d} title="Maombi yangu kwa Meneja" />
    </div>
  );
}

/** Hatua za kuanza kutumia CoopLink (Meneja) — inajificha hatua zote zikikamilika */
function SetupChecklist() {
  const { data } = useFetch<{ steps: { key: string; title: string; done: boolean; detail: string; to: string }[]; done: number; total: number }>('/workspace/setup');
  const [open, setOpen] = useState(true);
  if (!data || !data.total || data.done === data.total) return null;
  const pct = Math.round((data.done / data.total) * 100);
  return (
    <section className="card setup-card">
      <button type="button" className="setup-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div><strong>Hatua za kuanza kutumia CoopLink</strong><span className="muted"> · {data.done} kati ya {data.total} zimekamilika</span></div>
        <span className="muted">{open ? 'Ficha ▲' : 'Onyesha ▼'}</span>
      </button>
      <div className="setup-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      {open && (
        <ol className="setup-steps">
          {data.steps.map((s) => (
            <li key={s.key} className={s.done ? 'done' : ''}>
              <span className="setup-dot">{s.done ? '✓' : ''}</span>
              <div><Link to={s.to}>{s.title}</Link><div className="muted" style={{ fontSize: 12.5 }}>{s.detail}</div></div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
