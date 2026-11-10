// =====================================================================
//  MADENI YA WAKULIMA (Mhasibu): pembejeo alizokopa kila mkulima, mauzo, makato, malipo na deni lote
//  Hakuna taarifa binafsi (NIDA, simu) — fedha tu.
// =====================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Paged } from '../lib/api';
import { useFetch, useDebounced } from '../lib/hooks';
import { date, LEDGER_LABEL, num, tsh } from '../lib/format';
import { Badge, Empty, Loading, PageHead, Pager } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { Amt, DocHead, PrintButton, Signatures } from './acc-common';
import { PortalAccess, PortalSummary } from '../components/FarmerPortalAccess';
import { useAuth } from '../lib/auth';

interface Row { id: string; groupName: string | null; interest: string; memberNo: string; firstName: string; lastName: string; village: string | null; status: string; inputs: string; loans: string; sales: string; deductions: string; repaid: string; paid: string; balance: string; amountOwed: string; lastAt: string }

export function FarmerDebts() {
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<'owing' | 'owed' | 'all' | 'groups'>(params.get('tab') === 'groups' ? 'groups' : 'owing');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const { data, loading } = useFetch<Paged<Row> & { totals: { farmersOwing: string; owedToFarmers: string; inputs: string } }>('/finance/farmers', { filter: filter === 'groups' ? 'all' : filter, search: dq || undefined, page, pageSize: 25 });
  const groups = useFetch<{ data: { id: string; groupNo: string; name: string; village: string | null; status: string; members: number; owing: string; inputs: string; leader: string | null }[] }>(filter === 'groups' ? '/groups' : null, { status: 'ACTIVE' });
  const nav = useNavigate();
  return (
    <>
      <PageHead title="Madeni ya wakulima" sub="Pembejeo alizokopa kila mkulima, mikopo, mauzo ya tumbaku, makato, malipo na deni lililobaki." />
      {data && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Wakulima wanadaiwa (jumla)" value={tsh(data.totals.farmersOwing)} />
          <Kpi label="Thamani ya pembejeo zilizokopeshwa" value={tsh(data.totals.inputs)} />
          <Kpi tone={Number(data.totals.owedToFarmers) > 0 ? 'gold' : undefined} label="Chama kinadaiwa na wakulima" value={tsh(data.totals.owedToFarmers)} />
        </div>
      )}
      <div style={{ marginTop: 16 }}><PortalSummary /></div>
      <div style={{ marginTop: 16 }}><Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[['owing', 'Wenye deni'], ['owed', 'Wanaodai chama'], ['all', 'Wote'], ['groups', 'Vikundi']]} /></div>
      {filter === 'groups' ? (
        <section className="card">
          {!groups.data ? <Loading /> : !groups.data.data.length ? <Empty>Hakuna kikundi hai.</Empty> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Kikundi</th><th className="num">Wanachama</th><th className="num">Pembejeo</th><th className="num">Deni la kikundi</th></tr></thead>
              <tbody>{groups.data.data.map((g) => (
                <tr key={g.id} onClick={() => nav(`/groups/${g.id}`)} style={{ cursor: 'pointer' }}>
                  <td><strong>{g.name}</strong><div className="muted" style={{ fontSize: 12 }}>{g.groupNo}{g.leader ? ` · Kiongozi ${g.leader}` : ''}</div></td>
                  <td className="num">{g.members}</td><td className="num">{tsh(g.inputs)}</td>
                  <td className="num"><strong className={Number(g.owing) > 0 ? 'money-neg' : ''}>{tsh(g.owing)}</strong></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      ) : (
      <section className="card">
        <div className="toolbar"><input className="input" placeholder="Tafuta jina, namba au kijiji…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Tafuta mkulima" /></div>
        {loading && !data ? <Loading /> : !data?.data.length ? <Empty>Hakuna mkulima kwenye orodha hii.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Mkulima</th><th className="num">Pembejeo</th><th className="num">Pesa ya kuni (+riba)</th><th className="num">Mauzo</th><th className="num">Makato</th><th className="num">Malipo / marejesho</th><th className="num">Salio</th></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id} onClick={() => nav(`/farmer-debts/${r.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong>{r.firstName} {r.lastName}</strong><div className="muted" style={{ fontSize: 12 }}>{r.memberNo}{r.village ? ` · ${r.village}` : ''}{r.groupName ? ` · Kikundi ${r.groupName}` : ''}</div></td>
                <td className="num">{Number(r.inputs) ? tsh(r.inputs) : '—'}</td>
                <td className="num">{Number(r.loans) ? tsh(r.loans) : '—'}{Number(r.interest) > 0 && <div className="muted" style={{ fontSize: 12 }}>+ riba {tsh(r.interest)}</div>}</td>
                <td className="num">{Number(r.sales) ? tsh(r.sales) : '—'}</td>
                <td className="num">{Number(r.deductions) ? tsh(r.deductions) : '—'}</td>
                <td className="num">{Number(r.paid) + Number(r.repaid) ? tsh(Number(r.paid) + Number(r.repaid)) : '—'}</td>
                <td className="num"><strong className={Number(r.balance) < 0 ? 'money-neg' : Number(r.balance) > 0 ? 'money-pos' : ''}>{Number(r.balance) < 0 ? `Deni ${tsh(r.amountOwed)}` : Number(r.balance) > 0 ? `Anadai ${tsh(r.balance)}` : 'Sawa'}</strong></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
      )}
    </>
  );
}

export interface StatementData {
  member: { id: string; memberNo: string; firstName: string; middleName?: string | null; lastName: string; village: string | null; status: string; group: string | null };
  amcos?: { name: string; code: string };
  seasons: { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean }[];
  season: { id: string; name: string; startDate: string; endDate: string } | null;
  opening: string;
  totals: Record<string, { debit: string; credit: string }>;
  sales: { id: string; settlementNo: string; kg: string; grossTzs: string; deductions: string; netTzs: string; status: string; marketNo: string; marketDate: string; buyer: string | null }[];
  balance: string; amountOwed: string;
  inputsSummary: { name: string; unit: string; quantity: string; amount: string }[];
  issues: { id: string; issueNo: string; issuedAt: string; status: string; totalAmount: string; cancelReason: string | null; lines: { name: string; unit: string; quantity: string; unitPrice: string; amount: string }[] }[];
  statement: { id: string; date: string; type: string; description: string; debit: string; credit: string; balance: string }[];
}
export const ISSUE_STATUS: Record<string, string> = { ISSUED: 'Imetolewa', CANCELLED: 'Imefutwa', PENDING_APPROVAL: 'Inasubiri idhini' };

export const bal = (v: string) => (Number(v) < 0 ? `Deni ${tsh(-Number(v))}` : Number(v) > 0 ? `Anadai ${tsh(v)}` : 'TSh 0');

export function FarmerDebtDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const seasonId = sp.get('season') ?? '';
  const { data } = useFetch<StatementData>(`/finance/farmers/${id}`, { seasonId: seasonId || undefined });
  const [tab, setTab] = useState<'statement' | 'inputs'>('statement');
  const { may } = useAuth();
  if (!data) return <Loading />;
  const m = data.member;
  const { owes, inputs, loans, salesTzs, deductions, paid, repaid, kg, fullName } = statementSums(data);
  return (
    <>
      <PageHead title={fullName} sub={<>{m.memberNo}{m.village ? ` · ${m.village}` : ''}{m.group ? ` · Kikundi ${m.group}` : ''}</>}>
        <Link className="btn btn-secondary no-print" to="/farmer-debts">← Madeni ya wakulima</Link>
        <PrintButton label="Chapisha / Hifadhi PDF" />
      </PageHead>
      <div className="no-print stmt-toolbar">
        <label htmlFor="stmt-season">Kipindi cha taarifa</label>
        <select id="stmt-season" className="select" value={seasonId} onChange={(e) => { if (e.target.value) sp.set('season', e.target.value); else sp.delete('season'); setSp(sp, { replace: true }); }}>
          <option value="">Misimu yote</option>
          {data.seasons.map((x) => <option key={x.id} value={x.id}>Msimu {x.name}{x.isCurrent ? ' (unaoendelea)' : ''}</option>)}
        </select>
      </div>
      <div className="grid grid-kpi no-print">
        <Kpi tone={owes ? 'bad' : 'dark'} label={owes ? 'Deni analodaiwa' : Number(data.balance) > 0 ? 'Chama kinamdai' : 'Salio'} value={tsh(owes ? data.amountOwed : data.balance)} hint={data.season ? `Mwisho wa msimu ${data.season.name}` : undefined} />
        <Kpi label="Mauzo ya tumbaku" value={tsh(salesTzs)} hint={`Kilo ${num(kg)}`} />
        <Kpi label="Pembejeo alizokopa" value={tsh(inputs)} hint={`Ugawaji ${data.issues.filter((i) => i.status === 'ISSUED').length}`} />
        <Kpi label="Malipo aliyopokea" value={tsh(paid)} />
      </div>
      {may('members.portal') && <div style={{ marginTop: 16 }}><PortalAccess memberId={m.id} memberName={fullName} /></div>}
      <div className="no-print" style={{ marginTop: 16 }}><Tabs value={tab} onChange={setTab} items={[['statement', 'Taarifa ya mkulima'], ['inputs', 'Pembejeo kwa undani']]} /></div>
      {tab === 'inputs' && (
        <div className="stack no-print">
          <Section pad={false} title="Kila ugawaji">
            {data.issues.length === 0 ? <Empty>Hakuna.</Empty> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>Namba / tarehe</th><th>Bidhaa</th><th className="num">Jumla</th><th>Hali</th></tr></thead>
                <tbody>{data.issues.map((i) => (
                  <tr key={i.id} style={{ opacity: i.status === 'ISSUED' ? 1 : 0.6 }}>
                    <td><strong>{i.issueNo}</strong><div className="muted" style={{ fontSize: 12 }}>{date(i.issuedAt)}</div></td>
                    <td style={{ fontSize: 13 }}>{i.lines.map((l, k) => <div key={k}>{l.name}: {num(l.quantity)} × {tsh(l.unitPrice)} = {tsh(l.amount)}</div>)}</td>
                    <td className="num">{tsh(i.totalAmount)}</td>
                    <td><Badge status={i.status} label={ISSUE_STATUS[i.status]} />{i.cancelReason && <div className="muted" style={{ fontSize: 12 }}>{i.cancelReason}</div>}</td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </Section>
        </div>
      )}
      <StatementDoc data={data} className={tab === 'statement' ? '' : 'print-only'} />
    </>
  );
}

/** Hesabu za muhtasari wa taarifa (ofisi na portal ya mkulima zinatumia hesabu hizi hizi). */
export function statementSums(data: StatementData) {
  const m = data.member;
  const owes = Number(data.balance) < 0;
  const T = (k: string) => data.totals[k] ?? { debit: '0', credit: '0' };
  const inputs = Number(T('INPUT_LOAN').debit);
  const loans = Number(T('CASH_LOAN').debit) + Number(T('LOAN_INTEREST').debit);
  const salesTzs = Number(T('TOBACCO_SALE').credit);
  const deductions = Number(T('DEDUCTION').debit);
  const paid = Number(T('PAYMENT').debit);
  const repaid = Number(T('REPAYMENT').credit) + Number(T('GROUP_GUARANTEE').credit);
  const kg = data.sales.reduce((t, x) => t + Number(x.kg), 0);
  // Marekebisho, kufutwa (reversal) na salio la zamani lililoingizwa: tofauti iliyobaki ili muhtasari ulingane na salio
  const other = Math.round((Number(data.balance) - (Number(data.opening) + salesTzs + repaid - inputs - loans - deductions - paid)) * 100) / 100;
  const period = data.season ? `Msimu ${data.season.name} (${date(data.season.startDate)} – ${date(data.season.endDate)})` : 'Tangu ajiunge (misimu yote)';
  const fullName = [m.firstName, m.middleName, m.lastName].filter(Boolean).join(' ');
  return { owes, inputs, loans, salesTzs, deductions, paid, repaid, kg, other, period, fullName };
}

/** Hati ya "TAARIFA YA MKULIMA" inayochapishwa (A4) — ofisini na kwenye portal ya mkulima. */
export function StatementDoc({ data, className }: { data: StatementData; className?: string }) {
  const m = data.member;
  const { owes, inputs, loans, salesTzs, deductions, paid, repaid, kg, other, period, fullName } = statementSums(data);
  return (
    <section className={`card card-pad print-doc stmt ${className ?? ''}`} style={{ marginTop: 16 }}>
      <DocHead title="TAARIFA YA MKULIMA" no={m.memberNo} sub={period} org={data.amcos} />
      <div className="stmt-who">
        <div><span>Mkulima</span><strong>{fullName}</strong></div>
        <div><span>Namba</span><strong>{m.memberNo}</strong></div>
        <div><span>Kijiji</span><strong>{m.village ?? '—'}</strong></div>
        <div><span>Kikundi</span><strong>{m.group ?? '—'}</strong></div>
      </div>

      <h3 className="stmt-h">Muhtasari</h3>
      <table className="table fin-table stmt-sum"><tbody>
        {data.season && <tr><td>Salio la kuanzia (kabla ya msimu)</td><td className="num">{bal(data.opening)}</td></tr>}
        <tr><td>Mauzo ya tumbaku (kilo {num(kg)})</td><td className="num money-pos">+ {tsh(salesTzs)}</td></tr>
        {repaid > 0 && <tr><td>Marejesho ya deni</td><td className="num money-pos">+ {tsh(repaid)}</td></tr>}
        <tr><td>Pembejeo alizokopa</td><td className="num money-neg">− {tsh(inputs)}</td></tr>
        {loans > 0 && <tr><td>Pesa ya kuni na riba</td><td className="num money-neg">− {tsh(loans)}</td></tr>}
        <tr><td>Makato ya mauzo (ushuru, ada n.k.)</td><td className="num money-neg">− {tsh(deductions)}</td></tr>
        <tr><td>Malipo aliyopokea</td><td className="num money-neg">− {tsh(paid)}</td></tr>
        {other !== 0 && <tr><td>Marekebisho mengine (salio la zamani, kusahihisha)</td><td className={`num ${other > 0 ? 'money-pos' : 'money-neg'}`}>{other > 0 ? '+' : '−'} {tsh(Math.abs(other))}</td></tr>}
        <tr className="row-grand"><td>{owes ? 'DENI ANALODAIWA' : Number(data.balance) > 0 ? 'CHAMA KINAMDAI (atalipwa)' : 'SALIO'}</td><td className="num">{tsh(owes ? data.amountOwed : data.balance)}</td></tr>
      </tbody></table>

      {data.sales.length > 0 && (<>
        <h3 className="stmt-h">Mauzo ya tumbaku</h3>
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>Soko</th><th>Tarehe</th><th className="num">Kilo</th><th className="num">Thamani</th><th className="num">Makato</th><th className="num">Baada ya makato</th></tr></thead>
          <tbody>{data.sales.map((x) => (
            <tr key={x.id}><td>{x.marketNo}{x.buyer ? <div className="muted" style={{ fontSize: 12 }}>{x.buyer}</div> : null}</td><td>{date(x.marketDate)}</td>
              <td className="num">{num(x.kg)}</td><td className="num">{tsh(x.grossTzs)}</td><td className="num">{tsh(x.deductions)}</td><td className="num">{tsh(x.netTzs)}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}

      {data.inputsSummary.length > 0 && (<>
        <h3 className="stmt-h">Pembejeo alizopokea</h3>
        <div className="table-wrap"><table className="table fin-table"><thead><tr><th>Bidhaa</th><th className="num">Idadi</th><th className="num">Thamani</th></tr></thead>
          <tbody>{data.inputsSummary.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{num(x.quantity)}</td><td className="num">{tsh(x.amount)}</td></tr>)}</tbody></table></div>
      </>)}

      <h3 className="stmt-h">Miamala yote ya kipindi</h3>
      <div className="table-wrap"><table className="table fin-table">
        <thead><tr><th>Tarehe</th><th>Aina</th><th>Maelezo</th><th className="num">Deni (+)</th><th className="num">Mauzo / marejesho (−)</th><th className="num">Salio</th></tr></thead>
        <tbody>
          {data.season && <tr><td colSpan={5}><em>Salio la kuanzia</em></td><td className="num">{bal(data.opening)}</td></tr>}
          {data.statement.map((e) => (
            <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{date(e.date)}</td><td>{LEDGER_LABEL[e.type] ?? e.type}</td><td>{e.description}</td>
              <td className="num"><Amt v={e.debit} /></td><td className="num"><Amt v={e.credit} /></td>
              <td className="num">{bal(e.balance)}</td></tr>
          ))}
          <tr className="row-grand"><td colSpan={5}>{owes ? 'DENI ANALODAIWA' : 'SALIO'}</td><td className="num">{tsh(owes ? data.amountOwed : data.balance)}</td></tr>
        </tbody>
      </table></div>
      {data.statement.length === 0 && <Empty>Hakuna miamala katika kipindi hiki.</Empty>}
      <p className="stmt-note">Mkulima akiona kosa kwenye taarifa hii, aiwasilishe kwa Mhasibu wa chama ndani ya siku 14. Taarifa imetolewa na mfumo wa CoopLink tarehe {date(new Date().toISOString())}.</p>
      <Signatures items={['Mhasibu', 'Meneja', 'Mkulima']} />
    </section>
  );
}
