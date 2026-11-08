// =====================================================================
//  SALIO LA KUANZIA NA KUFUNGA VIPINDI (Mhasibu anaandaa · Meneja anaidhinisha)
//  + MADENI YA CHAMA (Chama Kikuu, ushuru, kodi, NSSF) na kuyalipa
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { APPROVAL_TYPE_LABEL, date, dateTime, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { Amt, GlSelect, today, useChart } from './acc-common';

interface PeriodsData {
  lockedThrough: string | null;
  locks: { id: string; lockedThrough: string; kind: string; note: string | null; createdBy: string | null; createdAt: string; entryNo: string | null }[];
  requests: { id: string; requestNo: string; type: string; status: string; title: string; amount: string | null; createdAt: string; decidedAt: string | null; decisionNote: string | null }[];
  openings: { id: string; entryNo: string; entryDate: string; description: string; amount: string }[];
}
const REQ_STATUS: Record<string, string> = { PENDING: 'Inasubiri Meneja', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };
const daysBefore = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);

export function Periods() {
  const [tab, setTab] = useState<'opening' | 'close'>('opening');
  const data = useFetch<PeriodsData>('/accounting/periods');
  const [ok, setOk] = useState<string | null>(null);
  const done = (m: string) => { setOk(m); data.reload(); };
  return (
    <>
      <PageHead title="Salio la kuanzia na kufunga vipindi" sub="Kuingiza hesabu za chama kilipoanza kutumia CoopLink, na kufunga vipindi vilivyokaguliwa ili visibadilishwe tena." />
      <Alert kind="ok">{ok}</Alert>
      {data.data && (
        <Alert kind={data.data.lockedThrough ? 'warn' : 'ok'}>
          {data.data.lockedThrough ? <>Vitabu vimefungwa hadi <strong>{date(data.data.lockedThrough)}</strong>. Hakuna muamala wala journal unaoweza kuandikwa kwa tarehe hiyo au kabla yake.</> : 'Hakuna kipindi kilichofungwa bado.'}
        </Alert>
      )}
      <Tabs value={tab} onChange={setTab} items={[['opening', 'Salio la kuanzia'], ['close', 'Kufunga kipindi / mwaka']]} />
      {tab === 'opening' ? <Opening data={data.data} onDone={done} /> : <Closing data={data.data} onDone={done} />}
      {data.data && data.data.requests.length > 0 && (
        <Section pad={false} title="Maombi ya karibuni">
          <div className="table-wrap"><table className="table"><tbody>{data.data.requests.map((r) => (
            <tr key={r.id}><td><strong>{r.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{APPROVAL_TYPE_LABEL[r.type]} · {dateTime(r.createdAt)}</div></td>
              <td>{r.title}{r.decisionNote && <div className="muted" style={{ fontSize: 12 }}>"{r.decisionNote}"</div>}</td>
              <td><Badge status={r.status === 'PENDING' ? 'PENDING_APPROVAL' : r.status} label={REQ_STATUS[r.status]} /></td></tr>
          ))}</tbody></table></div>
        </Section>
      )}
    </>
  );
}

interface FRow { memberNo: string; debt: string; credit: string }
interface LRow { glAccountId: string; debit: string; credit: string }

function Opening({ data, onDone }: { data: PeriodsData | null; onDone: (m: string) => void }) {
  const { may } = useAuth();
  const chart = useChart();
  const [d, setD] = useState(today());
  const [desc, setDesc] = useState('Salio la kuanzia kutoka vitabu vya zamani');
  const [farmers, setFarmers] = useState<FRow[]>([{ memberNo: '', debt: '', credit: '' }]);
  const [lines, setLines] = useState<LRow[]>([{ glAccountId: '', debit: '', credit: '' }]);
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const { busy, error, run } = useAction();
  const f = farmers.filter((x) => x.memberNo.trim() && (Number(x.debt) > 0 || Number(x.credit) > 0));
  const l = lines.filter((x) => x.glAccountId && (Number(x.debit) > 0 || Number(x.credit) > 0));
  const dr = f.reduce((s, x) => s + Number(x.debt || 0), 0) + l.reduce((s, x) => s + Number(x.debit || 0), 0);
  const cr = f.reduce((s, x) => s + Number(x.credit || 0), 0) + l.reduce((s, x) => s + Number(x.credit || 0), 0);
  const setF = (i: number, p: Partial<FRow>) => setFarmers(farmers.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const setL = (i: number, p: Partial<LRow>) => setLines(lines.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const applyPaste = () => {
    const rows = pasteText.split(/\r?\n/).map((r) => r.split(/\t|;|,/).map((c) => c.trim().replace(/\s/g, ''))).filter((c) => c[0])
      .map(([memberNo, debt = '', credit = '']) => ({ memberNo, debt, credit }));
    if (rows.length) setFarmers(rows);
    setPaste(false); setPasteText('');
  };
  if (!may('accounting.manage')) return <OpeningHistory data={data} />;
  return (
    <div className="stack">
      <Section title="1. Tarehe na maelezo">
        <Alert kind="warn">Weka hesabu za chama kama zilivyokuwa siku kabla ya kuanza kutumia CoopLink. Fedha za benki/taslimu zinawekwa kama "salio la kuanzia" kwenye akaunti ya fedha (Miamala → Akaunti), si hapa. Tofauti yote inaingia 3900 (Salio la kuanzia) yenyewe.</Alert>
        <div className="form-grid">
          <TextField label="Tarehe ya salio *" type="date" max={today()} value={d} onChange={setD} />
          <TextField label="Maelezo *" value={desc} onChange={setDesc} />
        </div>
      </Section>
      <Section title="2. Madeni ya wakulima" actions={<Button size="sm" variant="secondary" onClick={() => setPaste(true)}>Bandika kutoka Excel</Button>}>
        <p className="muted" style={{ marginTop: 0 }}>Deni = mkulima anadaiwa na chama (pembejeo/mkopo). Chama kinadaiwa = mkulima hajalipwa fedha zake.</p>
        <div className="table-wrap"><table className="table bale-entry">
          <thead><tr><th>Namba ya mkulima</th><th>Deni (TSh)</th><th>Chama kinadaiwa (TSh)</th><th /></tr></thead>
          <tbody>{farmers.map((x, i) => (
            <tr key={i}>
              <td><input className="input" value={x.memberNo} onChange={(e) => setF(i, { memberNo: e.target.value })} aria-label={`Namba ya mkulima ${i + 1}`} /></td>
              <td><input className="input" type="number" min="0" value={x.debt} onChange={(e) => setF(i, { debt: e.target.value, credit: e.target.value ? '' : x.credit })} aria-label={`Deni ${i + 1}`} /></td>
              <td><input className="input" type="number" min="0" value={x.credit} onChange={(e) => setF(i, { credit: e.target.value, debt: e.target.value ? '' : x.debt })} aria-label={`Chama kinadaiwa ${i + 1}`} /></td>
              <td>{farmers.length > 1 && <Button size="sm" variant="ghost" aria-label="Ondoa" onClick={() => setFarmers(farmers.filter((_, k) => k !== i))}>✕</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <Button size="sm" variant="secondary" onClick={() => setFarmers([...farmers, { memberNo: '', debt: '', credit: '' }])}>+ Mstari</Button>
        <span className="muted" style={{ marginLeft: 12 }}>Wakulima {f.length}</span>
      </Section>
      <Section title="3. Akaunti nyingine (madeni, wadaiwa, stoo, hisa…)">
        <p className="muted" style={{ marginTop: 0 }}>Mf. deni la pembejeo kwa Chama Kikuu (2150, credit), madeni ya wazabuni (2100, credit), mnunuzi anadaiwa (1220, debit), stoo (1300, debit), hisa za wanachama (3100, credit), mkopo wa benki (2500, credit).</p>
        {lines.map((x, i) => (
          <div key={i} className="jl-row">
            <GlSelect label={`Akaunti ${i + 1}`} value={x.glAccountId} onChange={(v) => setL(i, { glAccountId: v })} accounts={chart.data?.data} filter={(a) => !['1200', '2200', '3900'].includes(a.code)} />
            <TextField label="Debit" type="number" min="0" value={x.debit} onChange={(v) => setL(i, { debit: v, credit: v ? '' : x.credit })} />
            <TextField label="Credit" type="number" min="0" value={x.credit} onChange={(v) => setL(i, { credit: v, debit: v ? '' : x.debit })} />
            {lines.length > 1 && <Button variant="ghost" size="sm" aria-label="Ondoa mstari" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</Button>}
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { glAccountId: '', debit: '', credit: '' }])}>+ Akaunti</Button>
      </Section>
      <Section title="4. Hakiki na tuma">
        <div className="recon-sum">
          <div><span>Jumla ya debit</span><strong>{tsh(dr)}</strong></div>
          <div><span>Jumla ya credit</span><strong>{tsh(cr)}</strong></div>
          <div><span>3900 Salio la kuanzia (mtaji)</span><strong><Amt v={cr - dr} zero="0" /></strong></div>
        </div>
        <Alert>{error}</Alert>
        <div className="actions" style={{ justifyContent: 'flex-end' }}>
          <Button busy={busy} disabled={(!f.length && !l.length) || desc.trim().length < 3} onClick={async () => {
            const r = await run(() => api<{ approval: { requestNo: string } }>('/accounting/opening-balances', { method: 'POST', body: {
              date: d, description: desc,
              farmers: f.map((x) => ({ memberNo: x.memberNo.trim(), debt: x.debt || null, credit: x.credit || null })),
              lines: l.map((x) => ({ glAccountId: x.glAccountId, debit: x.debit || null, credit: x.credit || null })),
            } }));
            if (r) { onDone(`Salio la kuanzia limetumwa kwa Meneja (${r.approval.requestNo}). Litaingia kwenye ledger za wakulima na daftari kuu baada ya idhini.`); setFarmers([{ memberNo: '', debt: '', credit: '' }]); setLines([{ glAccountId: '', debit: '', credit: '' }]); }
          }}>Tuma kwa Meneja</Button>
        </div>
      </Section>
      <OpeningHistory data={data} />
      {paste && (
        <Modal open title="Bandika madeni ya wakulima kutoka Excel" onClose={() => setPaste(false)} footer={<><Button variant="secondary" onClick={() => setPaste(false)}>Ghairi</Button><Button onClick={applyPaste}>Weka kwenye fomu</Button></>}>
          <p className="muted">Safu: <strong>Namba ya mkulima · Deni · Chama kinadaiwa</strong> (acha tupu isiyohusika)</p>
          <textarea className="textarea" rows={10} value={pasteText} onChange={(e) => setPasteText(e.target.value)} aria-label="Madeni ya wakulima" placeholder={'UHA-000001\t160000\t\nUHA-000002\t\t45000'} />
        </Modal>
      )}
    </div>
  );
}

function OpeningHistory({ data }: { data: PeriodsData | null }) {
  if (!data) return <Loading />;
  return (
    <Section pad={false} title="Salio la kuanzia lililoingizwa">
      {data.openings.length === 0 ? <Empty>Bado hakuna.</Empty> : (
        <div className="table-wrap"><table className="table"><tbody>{data.openings.map((o) => (
          <tr key={o.id}><td><Link to="/ledger?tab=journals">{o.entryNo}</Link><div className="muted" style={{ fontSize: 12 }}>{date(o.entryDate)}</div></td><td>{o.description}</td><td className="num">{tsh(o.amount)}</td></tr>
        ))}</tbody></table></div>
      )}
    </Section>
  );
}

function Closing({ data, onDone }: { data: PeriodsData | null; onDone: (m: string) => void }) {
  const { may } = useAuth();
  const yesterday = daysBefore(today(), 1);
  const [lockDate, setLockDate] = useState(yesterday);
  const [note, setNote] = useState('');
  const [closeDate, setCloseDate] = useState(yesterday);
  const [yNote, setYNote] = useState('');
  const pv = useFetch<{ totalIncome: string; totalExpense: string; surplus: string; lockedThrough: string | null }>('/accounting/year-end-preview', { closeDate });
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const manage = may('accounting.manage');
  return (
    <div className="stack">
      <Alert>{error}</Alert>
      <div className="grid grid-2">
        <Section title="Kufunga kipindi (mf. mwezi uliokaguliwa)">
          <p className="muted" style={{ marginTop: 0 }}>Baada ya Meneja kuidhinisha, hakuna muamala, malipo wala journal unaoweza kuandikwa kwa tarehe hii au kabla yake. Kufunga hakutenguliwi.</p>
          <TextField label="Funga hadi tarehe *" type="date" max={yesterday} value={lockDate} onChange={setLockDate} />
          <TextField label="Maelezo" value={note} onChange={setNote} placeholder="mf. Oktoba imekaguliwa na mkaguzi wa ndani" />
          {manage && <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button busy={busy} onClick={async () => {
            const r = await run(() => api<{ approval: { requestNo: string }; openTransactions: number }>('/accounting/period-close', { method: 'POST', body: { lockedThrough: lockDate, note: note || null } }));
            if (r) onDone(`Ombi la kufunga hadi ${date(lockDate)} limetumwa (${r.approval.requestNo})${r.openTransactions ? `. Tahadhari: miamala ${r.openTransactions} ya kipindi hicho bado haijakamilika — itakamilishwa kwa tarehe mpya.` : ''}`);
          }}>Omba kufunga kipindi</Button></div>}
        </Section>
        <Section title="Kufunga mwaka wa fedha / msimu">
          <p className="muted" style={{ marginTop: 0 }}>Mapato na matumizi yote hadi tarehe hii yanahamishiwa <strong>3200 Akiba na ziada</strong>, kisha kipindi kinafungwa. Ripoti za mwaka uliofungwa zinabaki kama zilivyokuwa.</p>
          <TextField label="Tarehe ya mwisho wa mwaka *" type="date" max={yesterday} value={closeDate} onChange={setCloseDate} />
          {pv.data && (
            <table className="table fin-table"><tbody>
              <tr><td>Mapato</td><td className="num">{tsh(pv.data.totalIncome)}</td></tr>
              <tr><td>Matumizi</td><td className="num">{tsh(pv.data.totalExpense)}</td></tr>
              <tr className="row-total"><td>{Number(pv.data.surplus) >= 0 ? 'Ziada → 3200' : 'Upungufu → 3200'}</td><td className="num"><Amt v={pv.data.surplus} strong zero="0" /></td></tr>
            </tbody></table>
          )}
          <TextField label="Maelezo" value={yNote} onChange={setYNote} placeholder="mf. Mwaka 2026/2027 umekaguliwa na COASCO" />
          {manage && <div className="actions" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button variant="gold" busy={busy} onClick={async () => {
            const r = await run(() => api<{ approval: { requestNo: string } }>('/accounting/year-end-close', { method: 'POST', body: { closeDate, note: yNote || null } }));
            if (r) onDone(`Ombi la kufunga mwaka hadi ${date(closeDate)} limetumwa (${r.approval.requestNo})`);
          }}>Omba kufunga mwaka</Button></div>}
        </Section>
      </div>
      <Section pad={false} title="Historia ya kufunga">
        {data.locks.length === 0 ? <Empty>Bado hakuna kipindi kilichofungwa.</Empty> : (
          <div className="table-wrap"><table className="table"><tbody>{data.locks.map((l) => (
            <tr key={l.id}><td><strong>Hadi {date(l.lockedThrough)}</strong><div className="muted" style={{ fontSize: 12 }}>{l.kind === 'YEAR_END' ? 'Kufunga mwaka' : 'Kufunga kipindi'}{l.entryNo ? ` · ${l.entryNo}` : ''}</div></td>
              <td>{l.note ?? '—'}</td><td>{l.createdBy}<div className="muted" style={{ fontSize: 12 }}>{dateTime(l.createdAt)}</div></td></tr>
          ))}</tbody></table></div>
        )}
      </Section>
    </div>
  );
}

// ------------------------------ MADENI YA CHAMA ------------------------------
interface Payable { id: string; code: string; name: string; subtype: string | null; balance: string; credited: string; debited: string; pendingCount: number; pendingAmount: string; lastPaid: string | null }

export function Payables() {
  const { may } = useAuth();
  const { data, reload } = useFetch<{ data: Payable[] }>('/accounting/payables');
  const [pay, setPay] = useState<Payable | null>(null);
  const [union, setUnion] = useState('');
  const [ok, setOk] = useState<string | null>(null);
  if (!data) return <Loading />;
  const owing = data.data.filter((p) => Number(p.balance) !== 0 || Number(p.credited) > 0);
  const total = owing.reduce((s, p) => s + Number(p.balance), 0);
  const u = data.data.find((p) => p.code === '2150');
  const group = (p: Payable) => (p.code === '2150' || p.code === '2300' ? 'Chama Kikuu' : p.subtype === 'LEVY' ? 'Ushuru' : p.subtype === 'PAYROLL' ? 'Kodi na michango ya mishahara' : p.subtype === 'LOAN' ? 'Mikopo' : 'Wazabuni na wengine');
  return (
    <>
      <PageHead title="Madeni ya chama" sub="Deni la pembejeo kwa Chama Kikuu, ushuru uliokatwa kwa wakulima (Halmashauri, Chama Kikuu), PAYE, NSSF, WCF, SDL na wazabuni — na kuyalipa kwa idhini ya Meneja." />
      <Alert kind="ok">{ok}</Alert>
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Jumla ya madeni" value={tsh(total)} />
        {u && <Kpi tone={Number(u.balance) > 0 ? 'gold' : undefined} label="Deni la pembejeo — Chama Kikuu" value={tsh(u.balance)} />}
        <Kpi label="Ushuru unaosubiri kupelekwa" value={tsh(data.data.filter((p) => p.subtype === 'LEVY').reduce((s, p) => s + Number(p.balance), 0))} />
        <Kpi label="Kodi na michango" value={tsh(data.data.filter((p) => p.subtype === 'PAYROLL').reduce((s, p) => s + Number(p.balance), 0))} />
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        {owing.length === 0 ? <Empty>Chama hakina madeni kwa sasa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Deni</th><th>Kundi</th><th className="num">Limeongezeka</th><th className="num">Limelipwa</th><th className="num">Salio</th><th>Malipo yanayosubiri</th><th /></tr></thead>
            <tbody>{owing.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.code}</strong> {p.name}<div className="muted" style={{ fontSize: 12 }}>{p.lastPaid ? `Malipo ya mwisho ${date(p.lastPaid)}` : 'Bado halijalipwa'}</div></td>
                <td>{group(p)}</td>
                <td className="num">{tsh(p.credited)}</td><td className="num">{tsh(p.debited)}</td>
                <td className="num"><strong className={Number(p.balance) > 0 ? 'money-neg' : ''}>{tsh(p.balance)}</strong></td>
                <td>{p.pendingCount ? <span className="badge badge-warn">{p.pendingCount} · {tsh(p.pendingAmount)}</span> : '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <Link className="btn btn-ghost btn-sm" to={`/ledger?tab=statement&account=${p.id}`}>Taarifa</Link>
                  {may('finance.record') && Number(p.balance) > 0 && <Button size="sm" onClick={() => setPay(p)}>Lipa</Button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {u && (
        <Section title="Linganisha na taarifa ya Chama Kikuu (deni la pembejeo)">
          <div className="form-grid">
            <TextField label="Salio kwenye taarifa ya Chama Kikuu (TSh)" type="number" value={union} onChange={setUnion} />
            <div className="recon-sum" style={{ margin: 0 }}>
              <div><span>Vitabu vya chama (2150)</span><strong>{tsh(u.balance)}</strong></div>
              <div className={union === '' ? '' : Math.abs(Number(union) - Number(u.balance)) < 0.005 ? 'ok' : 'bad'}><span>Tofauti</span><strong>{union === '' ? '—' : tsh(Number(union) - Number(u.balance))}</strong></div>
            </div>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>Tofauti ikiwepo: kagua <Link to={`/ledger?tab=statement&account=${u.id}`}>taarifa ya akaunti 2150</Link> dhidi ya hati za Chama Kikuu (pembejeo zilizoletwa, makato yaliyopelekwa).</p>
        </Section>
      )}
      {pay && <PayLiability p={pay} onClose={() => setPay(null)} onDone={(m) => { setPay(null); setOk(m); reload(); }} />}
    </>
  );
}

function PayLiability({ p, onClose, onDone }: { p: Payable; onClose: () => void; onDone: (m: string) => void }) {
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>('/finance/accounts');
  const [f, setF] = useState({ amount: p.balance, accountId: '', txnDate: today(), payee: p.code === '2150' || p.code === '2300' ? 'Chama Kikuu' : p.code === '2310' ? 'Halmashauri' : p.code.startsWith('24') && p.code !== '2450' ? (p.code === '2420' ? 'NSSF' : p.code === '2430' ? 'WCF' : 'TRA') : '', reference: '', description: `Malipo ya ${p.name.toLowerCase()}` });
  const { busy, error, run } = useAction();
  return (
    <Modal open title={`Lipa: ${p.code} ${p.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!(Number(f.amount) > 0) || f.description.trim().length < 3} onClick={async () => {
        const r = await run(() => api<{ transaction: { txnNo: string } }>('/finance/expenses', { method: 'POST', body: {
          category: 'REMITTANCE', contraGlAccountId: p.id, amount: f.amount, accountId: f.accountId || null, txnDate: f.txnDate, payee: f.payee || null, reference: f.reference || null, description: f.description,
        } }));
        if (r) onDone(`${r.transaction.txnNo} imetumwa kwa Meneja. Baada ya idhini, ikamilishe kwenye Miamala fedha zikitoka.`);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert kind="warn">Salio la deni hili ni {tsh(p.balance)}. Malipo yanapitia idhini ya Meneja kama matumizi mengine, na yanapunguza deni hili kwenye daftari kuu.</Alert>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Kiasi (TSh) *" type="number" min="1" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <TextField label="Tarehe" type="date" value={f.txnDate} onChange={(v) => setF({ ...f, txnDate: v })} />
        <SelectField label="Akaunti ya kulipa" value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} placeholder="Chagua (au wakati wa kukamilisha)" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
        <TextField label="Mlipwaji" value={f.payee} onChange={(v) => setF({ ...f, payee: v })} />
        <TextField label="Kumbukumbu (control no. / cheki)" value={f.reference} onChange={(v) => setF({ ...f, reference: v })} />
      </div>
      <TextField label="Maelezo *" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
    </Modal>
  );
}

