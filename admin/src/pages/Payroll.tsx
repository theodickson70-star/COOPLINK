// =====================================================================
//  MISHAHARA (Mhasibu anaandaa · Meneja anaidhinisha · Mhasibu analipa)
// =====================================================================
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime, num, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, SelectField, TextField } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { DocHead, PrintButton, Signatures, thisMonth, today } from './acc-common';

interface Employee {
  id: string; employeeNo: string; fullName: string; position: string; phone: string | null; basicSalary: string; allowances: string; otherDeductions: string;
  nssfNo: string | null; tin: string | null; paymentMethod: string; bankName: string | null; accountNumber: string | null; startDate: string | null; isActive: boolean;
  preview: { gross: string; paye: string; nssfEmployee: string; net: string };
}
interface Run { id: string; runNo: string; period: string; status: string; totalGross: string; totalPaye: string; totalNssfEmployee: string; totalNssfEmployer: string; totalWcf: string; totalSdl: string; totalOtherDeductions: string; totalNet: string; employees: number; createdAt: string }
const RUN_STATUS: Record<string, string> = { PENDING_APPROVAL: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — lipa', PAID: 'Imelipwa', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };
const monthName = (p: string) => { const [y, m] = p.split('-'); return `${['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'][Number(m) - 1]} ${y}`; };

export function Payroll() {
  const [tab, setTab] = useState<'runs' | 'employees' | 'rates'>('runs');
  return (
    <>
      <PageHead title="Mishahara" sub="Wafanyakazi wa chama, hesabu ya PAYE, NSSF, WCF na SDL, hati za mishahara. Mishahara inalipwa baada ya idhini ya Meneja." />
      <Tabs value={tab} onChange={setTab} items={[['runs', 'Mishahara ya kila mwezi'], ['employees', 'Wafanyakazi'], ['rates', 'Viwango vya kodi']]} />
      {tab === 'runs' && <Runs />}
      {tab === 'employees' && <Employees />}
      {tab === 'rates' && <Rates />}
    </>
  );
}

function Runs() {
  const { may } = useAuth();
  const runs = useFetch<{ data: Run[] }>('/payroll/runs');
  const [prep, setPrep] = useState(false);
  const nav = useNavigate();
  return (
    <section className="card">
      <div className="toolbar"><div className="grow" />{may('payroll.manage') && <Button onClick={() => setPrep(true)}>Andaa mishahara ya mwezi</Button>}</div>
      {!runs.data ? <Loading /> : runs.data.data.length === 0 ? <Empty>Bado hakuna mishahara iliyoandaliwa.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Mwezi</th><th className="num">Wafanyakazi</th><th className="num">Ghafi</th><th className="num">PAYE</th><th className="num">NSSF (wote)</th><th className="num">Halisi</th><th>Hali</th></tr></thead>
          <tbody>{runs.data.data.map((r) => (
            <tr key={r.id} onClick={() => nav(`/payroll/runs/${r.id}`)} style={{ cursor: 'pointer' }}>
              <td><strong>{monthName(r.period)}</strong><div className="muted" style={{ fontSize: 12 }}>{r.runNo}</div></td>
              <td className="num">{r.employees}</td><td className="num">{tsh(r.totalGross)}</td><td className="num">{tsh(r.totalPaye)}</td>
              <td className="num">{tsh(Number(r.totalNssfEmployee) + Number(r.totalNssfEmployer))}</td><td className="num"><strong>{tsh(r.totalNet)}</strong></td>
              <td><Badge status={r.status} label={RUN_STATUS[r.status]} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {prep && <PrepareRun onClose={() => setPrep(false)} onDone={(id) => { setPrep(false); nav(`/payroll/runs/${id}`); }} />}
    </section>
  );
}

function PrepareRun({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const pv = useFetch<{ sdlApplies: boolean; lines: (Employee['preview'] & { employee: Employee; wcf: string; sdl: string; nssfEmployer: string; otherDeductions: string })[]; totals: Record<string, string> }>('/payroll/preview');
  const [period, setPeriod] = useState(thisMonth());
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Andaa mishahara" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={!pv.data?.lines.length} onClick={async () => {
        const r = await run(() => api<{ run: Run }>('/payroll/runs', { method: 'POST', body: { period, notes: notes || null } }));
        if (r) onDone(r.run.id);
      }}>Tuma kwa Meneja</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Mwezi *" type="month" max={thisMonth()} value={period} onChange={setPeriod} />
        <TextField label="Maelezo" value={notes} onChange={setNotes} />
      </div>
      {!pv.data ? <Loading /> : pv.data.lines.length === 0 ? <Alert kind="warn">Hakuna wafanyakazi hai. Ongeza wafanyakazi kwanza.</Alert> : (
        <>
          <div className="table-wrap"><table className="table fin-table">
            <thead><tr><th>Mfanyakazi</th><th className="num">Ghafi</th><th className="num">NSSF</th><th className="num">PAYE</th><th className="num">Halisi</th></tr></thead>
            <tbody>{pv.data.lines.map((l) => (
              <tr key={l.employee.id}><td>{l.employee.fullName}<div className="muted" style={{ fontSize: 12 }}>{l.employee.position}</div></td>
                <td className="num">{tsh(l.gross)}</td><td className="num">{tsh(l.nssfEmployee)}</td><td className="num">{tsh(l.paye)}</td><td className="num"><strong>{tsh(l.net)}</strong></td></tr>
            ))}
              <tr className="row-grand"><td>JUMLA</td><td className="num">{tsh(pv.data.totals.gross)}</td><td className="num">{tsh(pv.data.totals.nssfEmployee)}</td><td className="num">{tsh(pv.data.totals.paye)}</td><td className="num">{tsh(pv.data.totals.net)}</td></tr>
            </tbody>
          </table></div>
          <p className="muted" style={{ marginBottom: 0 }}>Michango ya mwajiri: NSSF {tsh(pv.data.totals.nssfEmployer)} · WCF {tsh(pv.data.totals.wcf)}{pv.data.sdlApplies ? ` · SDL ${tsh(pv.data.totals.sdl)}` : ' · SDL haihusiki (wafanyakazi chini ya 10)'}</p>
        </>
      )}
    </Modal>
  );
}

function Employees() {
  const { may } = useAuth();
  const { data, reload } = useFetch<{ data: Employee[] }>('/payroll/employees');
  const [edit, setEdit] = useState<Employee | 'new' | null>(null);
  return (
    <section className="card">
      <div className="toolbar"><div className="grow" />{may('payroll.manage') && <Button onClick={() => setEdit('new')}>+ Mfanyakazi</Button>}</div>
      {!data ? <Loading /> : data.data.length === 0 ? <Empty>Bado hakuna wafanyakazi. Ongeza walinzi, makarani wa ghala, madereva n.k.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Mfanyakazi</th><th>Cheo</th><th className="num">Mshahara + posho</th><th className="num">Halisi (makadirio)</th><th>Malipo</th><th /></tr></thead>
          <tbody>{data.data.map((e) => (
            <tr key={e.id} style={{ opacity: e.isActive ? 1 : 0.5 }}>
              <td><strong>{e.fullName}</strong><div className="muted" style={{ fontSize: 12 }}>{e.employeeNo}{e.nssfNo ? ` · NSSF ${e.nssfNo}` : ''}{!e.isActive && ' · hayuko kazini'}</div></td>
              <td>{e.position}</td>
              <td className="num">{tsh(e.basicSalary)}{Number(e.allowances) > 0 && <div className="muted" style={{ fontSize: 12 }}>+ {tsh(e.allowances)}</div>}</td>
              <td className="num">{tsh(e.preview.net)}</td>
              <td>{e.paymentMethod === 'BANK' ? `${e.bankName ?? 'Benki'} ${e.accountNumber ?? ''}` : e.paymentMethod === 'MOBILE_MONEY' ? `Simu ${e.phone ?? ''}` : 'Taslimu'}</td>
              <td className="num">{may('payroll.manage') && <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Hariri</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <EmployeeForm emp={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

function EmployeeForm({ emp, onClose, onDone }: { emp: Employee | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    fullName: emp?.fullName ?? '', position: emp?.position ?? '', phone: emp?.phone ?? '', basicSalary: emp?.basicSalary ?? '', allowances: emp?.allowances ?? '0',
    otherDeductions: emp?.otherDeductions ?? '0', nssfNo: emp?.nssfNo ?? '', tin: emp?.tin ?? '', paymentMethod: emp?.paymentMethod ?? 'BANK', bankName: emp?.bankName ?? '',
    accountNumber: emp?.accountNumber ?? '', startDate: emp?.startDate ?? '', isActive: emp?.isActive ?? true,
  });
  const { busy, error, run } = useAction();
  const s = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Modal open title={emp ? `Hariri: ${emp.fullName}` : 'Mfanyakazi mpya'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={busy} disabled={f.fullName.trim().length < 3 || f.position.trim().length < 2 || f.basicSalary === ''} onClick={async () => {
        const body = { ...f, phone: f.phone || null, nssfNo: f.nssfNo || null, tin: f.tin || null, bankName: f.bankName || null, accountNumber: f.accountNumber || null, startDate: f.startDate || null, ...(emp ? {} : { isActive: undefined }) };
        if (await run(() => emp ? api(`/payroll/employees/${emp.id}`, { method: 'PATCH', body }) : api('/payroll/employees', { method: 'POST', body }))) onDone();
      }}>Hifadhi</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina kamili *" value={f.fullName} onChange={s('fullName')} />
        <TextField label="Cheo / kazi *" value={f.position} onChange={s('position')} placeholder="mf. Mlinzi wa ghala" />
        <TextField label="Mshahara wa msingi (TSh) *" type="number" min="0" value={f.basicSalary} onChange={s('basicSalary')} />
        <TextField label="Posho (TSh)" type="number" min="0" value={f.allowances} onChange={s('allowances')} />
        <TextField label="Makato mengine kwa mwezi" type="number" min="0" value={f.otherDeductions} onChange={s('otherDeductions')} help="mf. marejesho ya mkopo wa mshahara" />
        <TextField label="Namba ya NSSF" value={f.nssfNo} onChange={s('nssfNo')} />
        <TextField label="TIN" value={f.tin} onChange={s('tin')} />
        <TextField label="Simu" value={f.phone} onChange={s('phone')} />
        <SelectField label="Njia ya malipo" value={f.paymentMethod} onChange={s('paymentMethod')} options={[{ value: 'BANK', label: 'Benki' }, { value: 'MOBILE_MONEY', label: 'Simu' }, { value: 'CASH', label: 'Taslimu' }]} />
        {f.paymentMethod === 'BANK' && <TextField label="Benki" value={f.bankName} onChange={s('bankName')} />}
        {f.paymentMethod === 'BANK' && <TextField label="Namba ya akaunti" value={f.accountNumber} onChange={s('accountNumber')} />}
        <TextField label="Tarehe ya kuanza kazi" type="date" max={today()} value={f.startDate} onChange={s('startDate')} />
      </div>
      {emp && <label className="check"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Bado yuko kazini</label>}
    </Modal>
  );
}

function Rates() {
  const { data } = useFetch<{ bands: { from: number; to: number | null; base: number; rate: number }[]; nssfEmployee: number; nssfEmployer: number; wcf: number; sdl: number; sdlMinEmployees: number }>('/payroll/rates');
  if (!data) return <Loading />;
  return (
    <div className="grid grid-2">
      <Section pad={false} title="PAYE ya mwezi (Tanzania Bara)">
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>Kipato kinachotozwa kodi</th><th>Kodi</th></tr></thead>
          <tbody>{data.bands.map((b) => (
            <tr key={b.from}><td>{tsh(b.from)}{b.to ? ` – ${tsh(b.to)}` : ' na zaidi'}</td><td>{b.rate === 0 ? 'Hakuna' : `${b.base ? `${tsh(b.base)} + ` : ''}${b.rate * 100}% ya kinachozidi ${tsh(b.from)}`}</td></tr>
          ))}</tbody>
        </table></div>
      </Section>
      <Section title="Michango">
        <dl className="dl">
          <dt>NSSF mfanyakazi</dt><dd>{data.nssfEmployee * 100}% ya mshahara ghafi (inapunguzwa kabla ya PAYE)</dd>
          <dt>NSSF mwajiri</dt><dd>{data.nssfEmployer * 100}%</dd>
          <dt>WCF</dt><dd>{data.wcf * 100}% (mwajiri)</dd>
          <dt>SDL</dt><dd>{data.sdl * 100}% (mwajiri, wafanyakazi {data.sdlMinEmployees}+)</dd>
        </dl>
        <p className="muted" style={{ marginBottom: 0 }}>Viwango hivi vinaweza kubadilika kwa Sheria ya Fedha ya kila mwaka. Hakiki na TRA/NSSF.</p>
      </Section>
    </div>
  );
}

interface RunDetail {
  run: Run & { notes: string | null; paidTxnId: string | null };
  amcos: { name: string; code: string; district: string | null };
  approval: { requestNo: string; decidedBy: string | null; decidedAt: string | null; status: string; decisionNote: string | null } | null;
  paidTxn: { id: string; txnNo: string; txnDate: string } | null;
  lines: { id: string; basicSalary: string; allowances: string; gross: string; nssfEmployee: string; taxable: string; paye: string; otherDeductions: string; net: string; nssfEmployer: string; wcf: string; sdl: string;
    employee: { employeeNo: string; fullName: string; position: string; nssfNo: string | null; tin: string | null; paymentMethod: string; bankName: string | null; accountNumber: string | null } }[];
}

export function PayrollRunDetail() {
  const { id } = useParams();
  const { may } = useAuth();
  const { data, reload } = useFetch<RunDetail>(`/payroll/runs/${id}`);
  const accounts = useFetch<{ data: { id: string; name: string; balance: string; isActive: boolean }[] }>(may('payroll.manage') ? '/finance/accounts' : null);
  const [view, setView] = useState<'sheet' | 'slips'>('sheet');
  const [pay, setPay] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const { busy, error, run } = useAction();
  if (!data) return <Loading />;
  const r = data.run;
  return (
    <>
      <PageHead title={<>Mishahara ya {monthName(r.period)} <Badge status={r.status} label={RUN_STATUS[r.status]} /></>} sub={<>{r.runNo}{data.approval?.decidedBy ? ` · Imeidhinishwa na ${data.approval.decidedBy} (${dateTime(data.approval.decidedAt)})` : ''}{data.paidTxn ? ` · Imelipwa ${data.paidTxn.txnNo}` : ''}</>}>
        <Link className="btn btn-secondary no-print" to="/payroll">← Mishahara</Link>
        {r.status === 'APPROVED' && may('payroll.manage') && <Button onClick={() => setPay(true)}>Lipa mishahara</Button>}
        <PrintButton />
      </PageHead>
      <Alert>{error}</Alert>
      {r.status === 'PENDING_APPROVAL' && <Alert kind="warn">Inasubiri idhini ya Meneja.</Alert>}
      <div className="grid grid-kpi no-print">
        <Kpi tone="dark" label="Mishahara halisi" value={tsh(r.totalNet)} hint={`Wafanyakazi ${data.lines.length}`} />
        <Kpi label="PAYE (TRA)" value={tsh(r.totalPaye)} />
        <Kpi label="NSSF (10% + 10%)" value={tsh(Number(r.totalNssfEmployee) + Number(r.totalNssfEmployer))} />
        <Kpi label="WCF / SDL" value={`${tsh(r.totalWcf)} / ${tsh(r.totalSdl)}`} />
      </div>
      <div className="no-print"><Tabs value={view} onChange={setView} items={[['sheet', 'Orodha ya mishahara'], ['slips', 'Hati za mishahara (payslips)']]} /></div>
      {view === 'sheet' ? (
        <section className="card card-pad print-doc">
          <DocHead title="ORODHA YA MISHAHARA" no={r.runNo} sub={monthName(r.period)} />
          <div className="table-wrap"><table className="table fin-table payroll-sheet">
            <thead><tr><th>Mfanyakazi</th><th className="num">Msingi</th><th className="num">Posho</th><th className="num">Ghafi</th><th className="num">NSSF</th><th className="num">PAYE</th><th className="num">Makato</th><th className="num">Halisi</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}><td>{l.employee.fullName}<div className="muted" style={{ fontSize: 12 }}>{l.employee.employeeNo} · {l.employee.position}</div></td>
                  <td className="num">{num(l.basicSalary)}</td><td className="num">{num(l.allowances)}</td><td className="num">{num(l.gross)}</td><td className="num">{num(l.nssfEmployee)}</td>
                  <td className="num">{num(l.paye)}</td><td className="num">{num(l.otherDeductions)}</td><td className="num"><strong>{num(l.net)}</strong></td></tr>
              ))}
              <tr className="row-grand"><td>JUMLA</td><td /><td /><td className="num">{num(r.totalGross)}</td><td className="num">{num(r.totalNssfEmployee)}</td><td className="num">{num(r.totalPaye)}</td><td className="num">{num(r.totalOtherDeductions)}</td><td className="num">{num(r.totalNet)}</td></tr>
            </tbody>
          </table></div>
          <p className="muted">Michango ya mwajiri: NSSF {tsh(r.totalNssfEmployer)} · WCF {tsh(r.totalWcf)} · SDL {tsh(r.totalSdl)}</p>
          <Signatures items={['Ameandaa (Mhasibu)', 'Ameidhinisha (Meneja)']} />
        </section>
      ) : (
        <div className="payslips">
          {data.lines.map((l) => (
            <article key={l.id} className="card card-pad print-doc payslip">
              <DocHead title="HATI YA MSHAHARA" no={monthName(r.period)} sub={r.runNo} />
              <dl className="dl">
                <dt>Mfanyakazi</dt><dd><strong>{l.employee.fullName}</strong> · {l.employee.employeeNo}</dd>
                <dt>Cheo</dt><dd>{l.employee.position}</dd>
                {l.employee.nssfNo && <><dt>NSSF</dt><dd>{l.employee.nssfNo}</dd></>}
                {l.employee.tin && <><dt>TIN</dt><dd>{l.employee.tin}</dd></>}
              </dl>
              <table className="table fin-table"><tbody>
                <tr><td>Mshahara wa msingi</td><td className="num">{tsh(l.basicSalary)}</td></tr>
                <tr><td>Posho</td><td className="num">{tsh(l.allowances)}</td></tr>
                <tr className="row-total"><td>Mshahara ghafi</td><td className="num">{tsh(l.gross)}</td></tr>
                <tr><td>NSSF (10%)</td><td className="num">({tsh(l.nssfEmployee)})</td></tr>
                <tr><td>Kipato kinachotozwa kodi</td><td className="num muted">{tsh(l.taxable)}</td></tr>
                <tr><td>PAYE</td><td className="num">({tsh(l.paye)})</td></tr>
                {Number(l.otherDeductions) > 0 && <tr><td>Makato mengine</td><td className="num">({tsh(l.otherDeductions)})</td></tr>}
                <tr className="row-grand"><td>MSHAHARA HALISI</td><td className="num">{tsh(l.net)}</td></tr>
              </tbody></table>
              <p className="muted" style={{ fontSize: 12 }}>Malipo: {l.employee.paymentMethod === 'BANK' ? `${l.employee.bankName ?? ''} ${l.employee.accountNumber ?? ''}` : l.employee.paymentMethod === 'CASH' ? 'Taslimu' : 'Simu'}{data.paidTxn ? ` · ${date(data.paidTxn.txnDate)}` : ''}</p>
              <Signatures items={['Mhasibu', 'Mfanyakazi']} />
            </article>
          ))}
        </div>
      )}
      {pay && (
        <Modal open title={`Lipa mishahara ${tsh(r.totalNet)}`} onClose={() => setPay(false)}
          footer={<><Button variant="secondary" onClick={() => setPay(false)}>Ghairi</Button><Button busy={busy} disabled={!accountId} onClick={async () => {
            if (await run(() => api(`/payroll/runs/${r.id}/pay`, { method: 'POST', body: { accountId, reference: reference || null } }))) { setPay(false); reload(); }
          }}>Thibitisha malipo</Button></>}>
          <Alert kind="warn">Thibitisha baada ya fedha kutoka kweli (benki/simu/taslimu). PAYE, NSSF, WCF na SDL zinabaki kama madeni ya kisheria hadi utakapozilipa kwenye Miamala (chagua akaunti 2410/2420/2430/2440).</Alert>
          <Alert>{error}</Alert>
          <div className="form-grid">
            <SelectField label="Akaunti ya kulipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
            <TextField label="Kumbukumbu" value={reference} onChange={setReference} />
          </div>
        </Modal>
      )}
    </>
  );
}
