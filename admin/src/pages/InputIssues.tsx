import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { dateTime, fullName, num, packsAndKg, tsh, UNIT_LABEL } from '../lib/format';
import { useAuth } from '../lib/auth';
import { usd, useFx } from '../lib/fx';
import { Alert, Badge, Button, clientRef, Empty, Loading, MemberPicker, Modal, PageHead, Pager, Select, TextField, type MemberLite } from '../components/ui';

interface Issue {
  id: string; issueNo: string; issuedAt: string; totalAmount: string; status: string; notes: string | null; cancelReason: string | null;
  currency?: 'TZS' | 'USD'; fxRate?: string | null; totalUsd?: string | null;
  member: { id: string; memberNo: string; firstName: string; lastName: string };
  lines?: { id: string; quantity: string; unitPrice: string; amount: string; kg?: string | null; unitPriceUsd?: string | null; amountUsd?: string | null; inputItem: { name: string; unit: string; packKg?: string | null } }[];
}

export function InputIssues() {
  const { may } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useFetch<Paged<Issue>>('/input-issues', { status, page, pageSize: 25 });
  return (
    <>
      <PageHead title="Utoaji wa Pembejeo" sub="Pembejeo zilizotolewa kwa mkopo. Kila utoaji unaingia kwenye deni la mkulima.">
        {may('issues.request') && <Link className="btn btn-gold" to="/input-issues/new">+ Andaa ugawaji</Link>}
      </PageHead>
      <Alert>{error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Hali zote</option><option value="PENDING_APPROVAL">Inasubiri idhini</option><option value="ISSUED">Imetolewa</option><option value="REJECTED">Imekataliwa</option><option value="CANCELLED">Imefutwa</option>
          </Select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>Bado hakuna utoaji wa pembejeo.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Namba</th><th>Mwanachama</th><th>Tarehe</th><th className="num">Kiasi</th><th>Hali</th></tr></thead>
              <tbody>
                {data?.data.map((i) => (
                  <tr key={i.id}>
                    <td><Link className="row-link" to={`/input-issues/${i.id}`}>{i.issueNo}</Link></td>
                    <td>{i.member.firstName} {i.member.lastName}<div className="muted" style={{ fontSize: 13 }}>{i.member.memberNo}</div></td>
                    <td>{dateTime(i.issuedAt)}</td>
                    <td className="num">{i.currency === 'USD' && i.totalUsd ? <>{usd(i.totalUsd)}<div className="muted" style={{ fontSize: 12 }}>{tsh(i.totalAmount)}</div></> : tsh(i.totalAmount)}</td>
                    <td><Badge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
    </>
  );
}

interface Item { id: string; name: string; unit: string; isActive: boolean; packKg?: string | null; looseKg?: boolean }
interface Price { inputItemId: string; unitPrice: string; unitPriceUsd: string | null }
interface Stock { inputItemId: string; balance: string }

export function InputIssueNew() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [member, setMember] = useState<MemberLite | null>(null);
  // unit KG: mbolea ya vitalu inayopimwa kwa kilo (kilo nzima)
  const [lines, setLines] = useState<{ inputItemId: string; quantity: string; unit: 'PACK' | 'KG' }[]>([{ inputItemId: '', quantity: '', unit: 'PACK' }]);
  const [notes, setNotes] = useState('');
  const [ref] = useState(clientRef);
  const items = useFetch<{ data: Item[] }>('/inputs/items', { active: 'true' });
  const prices = useFetch<{ data: Price[] }>('/inputs/prices');
  const stock = useFetch<{ data: Stock[] }>('/inputs/stock');
  const { busy, error, run } = useAction();
  // Makisio ya mkulima: kilichokisiwa dhidi ya kilichokwisha gawiwa (zaidi ya makisio -> Meneja anaonyeshwa)
  const est = useFetch<{ estimate: { status: string; hasInputs: boolean } | null; items: Record<string, { estimated: string; issued: string }> }>(member ? '/estimates/check' : null, member ? { memberId: member.id } : undefined);
  const fx = useFx();
  const U = fx.usdMode;
  const money = (v: number) => (U ? usd(v) : tsh(v));

  useEffect(() => {
    const id = params.get('member');
    if (id && !member) api<{ member: MemberLite }>(`/members/${id}`).then((r) => setMember(r.member)).catch(() => {});
  }, [params, member]);

  // Chama cha USD: bei ni ya dola; deni la mkulima litakuwa la dola
  const priceOf = useMemo(() => new Map(prices.data?.data.filter((p) => !U || p.unitPriceUsd).map((p) => [p.inputItemId, Number(U ? p.unitPriceUsd : p.unitPrice)])), [prices.data, U]);
  const stockOf = useMemo(() => new Map(stock.data?.data.map((s) => [s.inputItemId, Number(s.balance)])), [stock.data]);
  const itemOf = useMemo(() => new Map(items.data?.data.map((i) => [i.id, i])), [items.data]);
  // Bei kwa mstari: kwa kilo = bei ya mfuko / kilo za mfuko; idadi ya mifuko inayotoka stoo = kilo / kilo za mfuko
  const lineCalc = (l: { inputItemId: string; quantity: string; unit: 'PACK' | 'KG' }) => {
    const it = itemOf.get(l.inputItemId);
    const price = priceOf.get(l.inputItemId);
    const kgMode = l.unit === 'KG' && !!it?.looseKg && Number(it?.packKg) > 0;
    const unitPrice = price == null ? undefined : kgMode ? price / Number(it!.packKg) : price;
    const packs = kgMode ? Number(l.quantity || 0) / Number(it!.packKg) : Number(l.quantity || 0);
    return { it, kgMode, unitPrice, packs, amount: unitPrice == null ? 0 : Math.round(unitPrice * Number(l.quantity || 0) * 100) / 100 };
  };
  const total = lines.reduce((s, l) => s + lineCalc(l).amount, 0);
  const valid = member && lines.every((l) => l.inputItemId && Number(l.quantity) > 0 && (l.unit !== 'KG' || Number.isInteger(Number(l.quantity))));

  const setLine = (i: number, patch: Partial<{ inputItemId: string; quantity: string; unit: 'PACK' | 'KG' }>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const r = await run(() => api<{ issue: Issue }>('/input-issues', { method: 'POST', body: { memberId: member!.id, notes: notes || undefined, clientRef: ref, lines } }));
    if (r) nav(`/input-issues/${r.issue.id}`, { replace: true });
  };

  if (items.loading && !items.data) return <Loading />;
  return (
    <>
      <PageHead title="Toa pembejeo kwa mkopo" sub="Kiasi chote kitaingia kama deni kwenye ledger ya mwanachama" />
      <div className="stack">
        <Alert>{error}</Alert>
        <section className="card card-pad stack">
          <MemberPicker value={member} onChange={setMember} />
          {member && <MemberGroupNote memberId={member.id} />}
          {member && est.data && (!est.data.estimate
            ? <Alert kind="warn">Mkulima huyu hana makisio ya msimu huu. Ugawaji unaruhusiwa, lakini Meneja ataona kuwa hakuna makisio.</Alert>
            : est.data.estimate.status !== 'APPROVED' ? <Alert kind="warn">Makisio ya mkulima huyu bado hayajaidhinishwa na Meneja.</Alert> : null)}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Pembejeo</th><th style={{ width: 140 }}>Kiasi</th><th className="num">Bei</th><th className="num">Stoo</th><th className="num">Makisio</th><th className="num">Jumla</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const { it, kgMode, unitPrice: price, packs } = lineCalc(l);
                  const bal = stockOf.get(l.inputItemId) ?? 0;
                  const over = !!l.inputItemId && packs > bal + 1e-9;
                  return (
                    <tr key={i}>
                      <td>
                        <Select aria-label={`Pembejeo ${i + 1}`} value={l.inputItemId} onChange={(e) => setLine(i, { inputItemId: e.target.value, unit: 'PACK' })}>
                          <option value="">Chagua pembejeo…</option>
                          {items.data?.data.map((o) => (
                            <option key={o.id} value={o.id} disabled={lines.some((x, j) => j !== i && x.inputItemId === o.id)}>{o.name}</option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <input className="input" aria-label={`Kiasi ${i + 1}`} type="number" min={kgMode ? '1' : '0.01'} step={kgMode ? '1' : '0.01'} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                        {it?.looseKg && Number(it.packKg) > 0 && (
                          <div className="unit-toggle" role="group" aria-label="Kipimo">
                            <button type="button" className={!kgMode ? 'on' : ''} onClick={() => setLine(i, { unit: 'PACK' })}>{UNIT_LABEL[it.unit]}</button>
                            <button type="button" className={kgMode ? 'on' : ''} onClick={() => setLine(i, { unit: 'KG' })}>Kilo</button>
                          </div>
                        )}
                        {kgMode && l.quantity && !Number.isInteger(Number(l.quantity)) && <div className="money-neg" style={{ fontSize: 12 }}>Kilo nzima tu</div>}
                      </td>
                      <td className="num">{l.inputItemId ? (price != null ? <>{money(price)}{kgMode && <div className="muted" style={{ fontSize: 12 }}>kwa kilo</div>}</> : <span className="badge badge-warn">Hakuna bei</span>) : '—'}</td>
                      <td className={`num ${over ? 'money-neg' : ''}`}>{l.inputItemId ? (it?.packKg ? packsAndKg(bal, it.packKg, UNIT_LABEL[it.unit].toLowerCase()) : `${num(bal)} ${it ? UNIT_LABEL[it.unit].toLowerCase() : ''}`) : '—'}</td>
                      <td className="num">{(() => {
                        if (!l.inputItemId || !est.data?.estimate?.hasInputs) return <span className="muted">—</span>;
                        const c = est.data.items[l.inputItemId];
                        const e = Number(c?.estimated ?? 0), done = Number(c?.issued ?? 0), left = e - done;
                        const beyond = packs > left + 1e-9;
                        return <span className={beyond ? 'money-neg' : ''} title="Makisio / tayari amegawiwa">{num(e)}<div className="muted" style={{ fontSize: 11 }}>{done > 0 ? `amepata ${num(done)} · ` : ''}{beyond ? `zaidi ${num(Math.round((packs - left) * 10000) / 10000)}` : `baki ${num(Math.round(left * 10000) / 10000)}`}</div></span>;
                      })()}</td>
                      <td className="num">{price && l.quantity ? money(price * Number(l.quantity)) : '—'}</td>
                      <td className="num">{lines.length > 1 && <Button size="sm" variant="ghost" aria-label="Ondoa mstari" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { inputItemId: '', quantity: '', unit: 'PACK' }])}>+ Ongeza pembejeo</Button>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, color: 'var(--head)' }}>Jumla: {money(total)}</div>
              {U && fx.rate && total > 0 && <div className="muted" style={{ fontSize: 13 }}>≈ {tsh(total * fx.rate)} kwa kiwango cha leo ({num(fx.rate)}). Deni la mkulima ni la dola — litakatwa kwa kiwango cha siku ya soko.</div>}
            </div>
          </div>
          <TextField label="Maelezo" value={notes} onChange={setNotes} />
        </section>
        {est.data?.estimate?.hasInputs && lines.some((l) => { const c = est.data!.items[l.inputItemId]; return l.inputItemId && lineCalc(l).packs > Number(c?.estimated ?? 0) - Number(c?.issued ?? 0) + 1e-9; })
          && <Alert kind="warn">Baadhi ya pembejeo zinazidi makisio ya mkulima. Unaweza kutuma, lakini Meneja ataona "ZAIDI YA MAKISIO" kwenye idhini.</Alert>}
        <div className="actions">
          <Button variant="gold" busy={busy} disabled={!valid} onClick={save} style={{ minHeight: 48 }}>Tuma kwa Meneja kwa idhini</Button>
          <Link className="btn btn-secondary" to="/input-issues">Ghairi</Link>
        </div>
      </div>
    </>
  );
}

export function InputIssueDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, loading, error, reload } = useFetch<{ issue: Issue }>(`/input-issues/${id}`);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const i = data.issue;
  const cancel = async () => {
    const r = await act.run(() => api(`/input-issues/${i.id}/cancel`, { method: 'POST', body: { reason } }));
    if (r) { setCancelOpen(false); reload(); }
  };

  return (
    <>
      <PageHead title={`Utoaji ${i.issueNo}`} sub={<><Badge status={i.status} /> · {dateTime(i.issuedAt)}</>}>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>Chapisha risiti</Button>
        {i.status === 'ISSUED' && may('issues.cancel') && <Button variant="danger" className="no-print" onClick={() => setCancelOpen(true)}>Futa utoaji</Button>}
        {i.status === 'PENDING_APPROVAL' && may('approvals.decide') && <Link className="btn btn-primary no-print" to="/approvals">Amua kwenye Idhini</Link>}
      </PageHead>
      {i.status === 'PENDING_APPROVAL' && <div style={{ marginBottom: 16 }}><Alert kind="warn">Ugawaji huu unasubiri idhini ya Meneja. Stoo na deni la mkulima vitabadilika baada ya idhini.</Alert></div>}
      {i.status === 'REJECTED' && <div style={{ marginBottom: 16 }}><Alert kind="warn">Ugawaji huu umekataliwa: {i.cancelReason}. Stoo haikubadilika.</Alert></div>}
      {i.status === 'CANCELLED' && <div style={{ marginBottom: 16 }}><Alert kind="warn">Utoaji huu umefutwa: {i.cancelReason}. Stoo ilirudishwa na deni likafutwa kwa REVERSAL.</Alert></div>}
      <section className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <h2>Mwanachama: <Link to={`/members/${i.member.id}`}>{fullName(i.member)}</Link> <span className="muted" style={{ fontSize: 15 }}>· {i.member.memberNo}</span></h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Pembejeo</th><th className="num">Kiasi</th><th className="num">Bei</th><th className="num">Jumla</th></tr></thead>
            <tbody>
              {i.lines?.map((l) => (
                <tr key={l.id}><td>{l.inputItem.name}</td><td className="num">{l.kg ? `kilo ${num(l.kg)}` : `${num(l.quantity)} ${UNIT_LABEL[l.inputItem.unit].toLowerCase()}`}</td>
                  <td className="num">{l.kg && l.inputItem.packKg
                    ? <>{l.unitPriceUsd ? usd(Number(l.unitPriceUsd) / Number(l.inputItem.packKg)) : tsh(Number(l.amount) / Number(l.kg))}<div className="muted" style={{ fontSize: 12 }}>kwa kilo</div></>
                    : l.unitPriceUsd ? usd(l.unitPriceUsd) : tsh(l.unitPrice)}</td><td className="num">{l.amountUsd ? <>{usd(l.amountUsd)}<div className="muted" style={{ fontSize: 12 }}>{tsh(l.amount)}</div></> : tsh(l.amount)}</td></tr>
              ))}
              <tr><td colSpan={3} style={{ fontWeight: 700 }}>Jumla ya deni{i.currency === 'USD' && i.fxRate ? <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>Kiwango cha siku ya ugawaji: 1 USD = TSh {num(i.fxRate)} · deni linakatwa kwa kiwango cha siku ya soko</div> : null}</td>
                <td className="num" style={{ fontWeight: 700, fontSize: 18 }}>{i.currency === 'USD' && i.totalUsd ? <>{usd(i.totalUsd)}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{tsh(i.totalAmount)}</div></> : tsh(i.totalAmount)}</td></tr>
            </tbody>
          </table>
        </div>
        {i.notes && <div className="card-pad muted">Maelezo: {i.notes}</div>}
      </section>
      <Modal open={cancelOpen} title="Futa utoaji huu?" onClose={() => setCancelOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)}>Hapana</Button><Button variant="danger" busy={act.busy} disabled={reason.trim().length < 5} onClick={cancel}>Ndiyo, futa</Button></>}>
        <Alert kind="warn">Pembejeo zitarudi stoo na deni la {i.currency === 'USD' && i.totalUsd ? `${usd(i.totalUsd)} (${tsh(i.totalAmount)})` : tsh(i.totalAmount)} litafutwa kwa rekodi ya REVERSAL. Historia itabaki.</Alert>
        <Alert>{act.error}</Alert>
        <TextField label="Sababu ya kufuta *" value={reason} onChange={setReason} />
      </Modal>
    </>
  );
}

/** Kikundi cha dhamana cha mkulima (pembejeo zinatolewa kwa wanakikundi; kikundi kinadhamini deni). */
function MemberGroupNote({ memberId }: { memberId: string }) {
  const { data } = useFetch<{ group: { groupId: string; name: string; groupNo: string } | null; balance: { amountOwed: string } | null }>(`/members/${memberId}`);
  if (!data) return null;
  return data.group
    ? <Alert kind="ok">Kikundi: <strong>{data.group.name}</strong> ({data.group.groupNo}) — kikundi kinadhamini deni la pembejeo hizi.{data.balance && Number(data.balance.amountOwed) > 0 ? ` Deni la sasa: TSh ${Number(data.balance.amountOwed).toLocaleString('en-US')}.` : ''}</Alert>
    : <Alert kind="warn">Mkulima huyu hayuko kwenye kikundi cha dhamana. Kwa utaratibu wa chama, mweke kwenye kikundi kwanza (Vikundi vya wakulima).</Alert>;
}
