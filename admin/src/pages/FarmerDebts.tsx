// =====================================================================
//  MADENI YA WAKULIMA (Mhasibu): pembejeo alizokopa kila mkulima, mauzo, makato, malipo na deni lote
//  Hakuna taarifa binafsi (NIDA, simu) — fedha tu.
// =====================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Paged } from '../lib/api';
import { useFetch, useDebounced } from '../lib/hooks';
import { date, LEDGER_LABEL, num, tsh } from '../lib/format';
import { Badge, Empty, Loading, PageHead, Pager } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { Amt, DocHead, PrintButton, Signatures } from './acc-common';

interface Row { id: string; memberNo: string; firstName: string; lastName: string; village: string | null; status: string; inputs: string; loans: string; sales: string; deductions: string; repaid: string; paid: string; balance: string; amountOwed: string; lastAt: string }

export function FarmerDebts() {
  const [filter, setFilter] = useState<'owing' | 'owed' | 'all'>('owing');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 300);
  const { data, loading } = useFetch<Paged<Row> & { totals: { farmersOwing: string; owedToFarmers: string; inputs: string } }>('/finance/farmers', { filter, search: dq || undefined, page, pageSize: 25 });
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
      <div style={{ marginTop: 16 }}><Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[['owing', 'Wenye deni'], ['owed', 'Wanaodai chama'], ['all', 'Wote']]} /></div>
      <section className="card">
        <div className="toolbar"><input className="input" placeholder="Tafuta jina, namba au kijiji…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Tafuta mkulima" /></div>
        {loading && !data ? <Loading /> : !data?.data.length ? <Empty>Hakuna mkulima kwenye orodha hii.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Mkulima</th><th className="num">Pembejeo</th><th className="num">Mikopo ya fedha</th><th className="num">Mauzo</th><th className="num">Makato</th><th className="num">Malipo / marejesho</th><th className="num">Salio</th></tr></thead>
            <tbody>{data.data.map((r) => (
              <tr key={r.id} onClick={() => nav(`/farmer-debts/${r.id}`)} style={{ cursor: 'pointer' }}>
                <td><strong>{r.firstName} {r.lastName}</strong><div className="muted" style={{ fontSize: 12 }}>{r.memberNo}{r.village ? ` · ${r.village}` : ''}</div></td>
                <td className="num">{Number(r.inputs) ? tsh(r.inputs) : '—'}</td>
                <td className="num">{Number(r.loans) ? tsh(r.loans) : '—'}</td>
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
    </>
  );
}

interface Detail {
  member: { id: string; memberNo: string; firstName: string; lastName: string; village: string | null; status: string };
  balance: string; amountOwed: string;
  inputsSummary: { name: string; unit: string; quantity: string; amount: string }[];
  issues: { id: string; issueNo: string; issuedAt: string; status: string; totalAmount: string; cancelReason: string | null; lines: { name: string; unit: string; quantity: string; unitPrice: string; amount: string }[] }[];
  statement: { id: string; date: string; type: string; description: string; debit: string; credit: string; balance: string }[];
}
const ISSUE_STATUS: Record<string, string> = { ISSUED: 'Imetolewa', CANCELLED: 'Imefutwa', PENDING_APPROVAL: 'Inasubiri idhini' };

export function FarmerDebtDetail() {
  const { id } = useParams();
  const { data } = useFetch<Detail>(`/finance/farmers/${id}`);
  const [tab, setTab] = useState<'inputs' | 'statement'>('inputs');
  if (!data) return <Loading />;
  const m = data.member;
  const owes = Number(data.balance) < 0;
  return (
    <>
      <PageHead title={`${m.firstName} ${m.lastName}`} sub={<>{m.memberNo}{m.village ? ` · ${m.village}` : ''}</>}>
        <Link className="btn btn-secondary no-print" to="/farmer-debts">← Madeni ya wakulima</Link>
        <PrintButton label="Chapisha taarifa" />
      </PageHead>
      <div className="grid grid-kpi no-print">
        <Kpi tone={owes ? 'bad' : 'dark'} label={owes ? 'Deni lote analodaiwa' : Number(data.balance) > 0 ? 'Chama kinamdai' : 'Salio'} value={tsh(owes ? data.amountOwed : data.balance)} />
        <Kpi label="Pembejeo alizokopa (thamani)" value={tsh(data.inputsSummary.reduce((s, x) => s + Number(x.amount), 0))} hint={`Ugawaji ${data.issues.filter((i) => i.status === 'ISSUED').length}`} />
      </div>
      <div className="no-print" style={{ marginTop: 16 }}><Tabs value={tab} onChange={setTab} items={[['inputs', 'Pembejeo alizokopa'], ['statement', 'Taarifa ya deni (ledger)']]} /></div>
      {tab === 'inputs' ? (
        <div className="stack">
          <Section pad={false} title="Muhtasari kwa bidhaa">
            {data.inputsSummary.length === 0 ? <Empty>Hajakopa pembejeo.</Empty> : (
              <div className="table-wrap"><table className="table fin-table"><thead><tr><th>Bidhaa</th><th className="num">Idadi</th><th className="num">Thamani</th></tr></thead>
                <tbody>{data.inputsSummary.map((x) => <tr key={x.name}><td>{x.name}</td><td className="num">{num(x.quantity)}</td><td className="num">{tsh(x.amount)}</td></tr>)}</tbody></table></div>
            )}
          </Section>
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
      ) : null}
      <section className={`card card-pad print-doc ${tab === 'statement' ? '' : 'print-only'}`} style={{ marginTop: 16 }}>
        <DocHead title="TAARIFA YA DENI LA MKULIMA" no={m.memberNo} sub={`${m.firstName} ${m.lastName}`} />
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>Tarehe</th><th>Aina</th><th>Maelezo</th><th className="num">Deni (+)</th><th className="num">Malipo / mauzo (−)</th><th className="num">Salio</th></tr></thead>
          <tbody>
            {data.statement.map((e) => (
              <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{date(e.date)}</td><td>{LEDGER_LABEL[e.type] ?? e.type}</td><td>{e.description}</td>
                <td className="num"><Amt v={e.debit} /></td><td className="num"><Amt v={e.credit} /></td>
                <td className="num">{Number(e.balance) < 0 ? `Deni ${tsh(-Number(e.balance))}` : Number(e.balance) > 0 ? `Anadai ${tsh(e.balance)}` : '0'}</td></tr>
            ))}
            <tr className="row-grand"><td colSpan={5}>{owes ? 'DENI LOTE ANALODAIWA' : 'SALIO'}</td><td className="num">{tsh(owes ? data.amountOwed : data.balance)}</td></tr>
          </tbody>
        </table></div>
        {data.statement.length === 0 && <Empty>Hakuna miamala.</Empty>}
        <Signatures items={['Mhasibu', 'Mkulima']} />
      </section>
    </>
  );
}
