// =====================================================================
//  ADA YA COOPLINK (Meneja): kingilio + ada ya msimu kwa mitandao ya simu (TeePay au Abliner).
//  Malipo yakithibitishwa na mtoa huduma, chama kinafunguka papo hapo na risiti inatolewa.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, dateTime, phone, tsh } from '../lib/format';
import { useAuth } from '../lib/auth';
import { amountInWords } from '../lib/words';
import { Alert, Badge, Button, Empty, Loading, PageHead, TextField } from '../components/ui';
import { Section } from '../components/owner-ui';
import { LogoMark } from '../components/Logo';
import { PrintButton } from './acc-common';

interface MobilePay { id: string; provider: 'TEEPAY' | 'ABLINER'; amount: string; phoneLocal: string; payerName: string; reference: string | null; status: 'SENDING' | 'PENDING' | 'SUCCEEDED' | 'FAILED'; statusDetail: string | null; lastError: string | null; createdAt: string; platformPaymentId: string | null; isTest: boolean; abandonedAt: string | null }
interface Fee {
  id: string; kind: 'ENTRANCE' | 'SEASON'; label: string; amount: string; paid: string; outstanding: string; installments: number;
  dueDate: string; status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED'; overdue: boolean; allowed: string[]; waivedReason: string | null; testAmount: string | null;
  mobilePayments: MobilePay[]; payments: { id: string; receiptNo: string; amount: string; paidAt: string; isTest?: boolean }[];
}
export interface BillingData {
  teepayEnabled: boolean;
  lock: { kind: string; label: string; dueDate: string; outstanding: string } | null;
  fees: Fee[];
  config: { entranceFee: number; seasonFee: number; seasonInstallments: number; entranceDays: number; deadlineDay: number; deadlineMonth: number };
}
const FEE_STATUS: Record<string, string> = { UNPAID: 'Haijalipwa', PARTIAL: 'Imelipwa sehemu', PAID: 'Imelipwa', WAIVED: 'Imesamehewa' };
const MONTHS = ['', 'Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

export function Billing() {
  const { data, reload, error } = useFetch<BillingData>('/billing');
  const [ok, setOk] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const c = data.config;
  const open = data.fees.filter((f) => f.status === 'UNPAID' || f.status === 'PARTIAL');
  const done = data.fees.filter((f) => f.status === 'PAID' || f.status === 'WAIVED');
  return (
    <>
      <PageHead title="Ada ya CoopLink" sub="Malipo ya huduma ya mfumo wa CoopLink kwa simu (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa). Malipo yakithibitishwa, unapata risiti papo hapo." />
      <Alert kind="ok">{ok}</Alert>
      {data.lock && (
        <div className="lock-card">
          <strong>Chama kimefungwa kwa muda</strong>
          <p>{data.lock.label} ({tsh(data.lock.outstanding)}) haijalipwa tangu {date(data.lock.dueDate)}. Wafanyakazi wengine hawawezi kuingia kwenye mfumo mpaka ilipwe. Lipa kwa simu hapa chini — mfumo utafunguka papo hapo malipo yakithibitishwa.</p>
        </div>
      )}
      {!data.teepayEnabled && <Alert kind="warn">Malipo kwa simu bado hayajawashwa na CoopLink. Wasiliana na CoopLink.</Alert>}
      {open.length === 0 && done.length > 0 && !data.lock && <Alert kind="ok">Hakuna ada inayodaiwa kwa sasa. Asante!</Alert>}
      {data.fees.length === 0 && <Empty>Chama hiki hakina ada inayodaiwa kwa sasa.</Empty>}
      <div className="stack" style={{ gap: 16 }}>
        {open.map((f) => <FeeCard key={f.id} f={f} canPay={data.teepayEnabled} onChange={(m) => { if (m) setOk(m); reload(); }} />)}
        {done.map((f) => <FeeCard key={f.id} f={f} canPay={false} onChange={() => reload()} />)}
      </div>
      <div style={{ marginTop: 16 }} />
      <Section title="Utaratibu wa ada za CoopLink">
        <ul className="rules">
          <li><strong>Ada ya kingilio — {tsh(c.entranceFee)}</strong>: inalipwa mara moja, ndani ya siku {c.entranceDays} baada ya akaunti ya chama kufunguliwa.</li>
          <li><strong>Ada ya msimu — {tsh(c.seasonFee)}</strong> kwa kila msimu wa tumbaku, kwa awamu {c.seasonInstallments} ({tsh(c.seasonFee / c.seasonInstallments)} kila moja). Mwisho wa kulipa kwa vyama vyote ni tarehe {c.deadlineDay} {MONTHS[c.deadlineMonth]} kila mwaka.</li>
          <li>Ada isipolipwa kufikia tarehe yake, chama kinafungwa mpaka ilipwe. Meneja anaendelea kuingia ili alipe.</li>
          <li>Malipo ni kwa simu: weka namba, kisha thibitisha kwa PIN ombi litakalokuja kwenye simu hiyo (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa).</li>
        </ul>
      </Section>
    </>
  );
}

const PNAME: Record<string, string> = { TEEPAY: 'TeePay', ABLINER: 'Abliner' };
const DETAIL: Record<string, string> = { cancelled: 'Ombi limeghairiwa kwenye simu', expired: 'Muda wa kuweka PIN umeisha' };

function FeeCard({ f, canPay, onChange }: { f: Fee; canPay: boolean; onChange: (msg?: string) => void }) {
  const { user } = useAuth();
  const act = useAction();
  const inst = Number(f.amount) / f.installments;
  const open = f.mobilePayments.find((m) => (m.status === 'SENDING' || m.status === 'PENDING') && !m.abandonedAt);
  const last = f.mobilePayments.find((m) => !m.abandonedAt);
  const [amount, setAmount] = useState(f.allowed[0] ?? '');
  const [payer, setPayer] = useState({ phone: user?.phone ? phone(user.phone) : '', name: user?.fullName ?? '', email: user?.email ?? '' });
  const [waited, setWaited] = useState(0);
  useEffect(() => { if (!f.allowed.includes(amount)) setAmount(f.allowed[f.allowed.length - 1] ?? ''); }, [f.allowed.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ombi likiwa wazi: uliza mtoa huduma kila sekunde 5 (webhook nayo inafungua chama yenyewe)
  useEffect(() => {
    if (!open) { setWaited(0); return; }
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ status: string; recorded: { receiptNo: string; amount: string } | null }>(`/billing/payments/${open.id}/sync`, { method: 'POST', body: {} });
        if (stop) return;
        if (r.recorded) onChange(`Malipo ${r.recorded.receiptNo} (${tsh(r.recorded.amount)}) yamethibitishwa. Asante!`);
        else if (r.status !== 'PENDING' && r.status !== 'SENDING') onChange();
      } catch { /* jaribu tena */ }
      setWaited((w) => w + 5);
    };
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    const r = await act.run(() => api<{ payment: MobilePay; failedOver: { from: string; to: string } | null }>(`/billing/fees/${f.id}/pay`, { method: 'POST', body: { amount, ...payer } }));
    if (r) onChange(r.payment.status === 'FAILED' ? undefined
      : `${r.failedOver ? `${r.failedOver.from} imeshindwa, kwa hiyo ombi limetumwa kupitia ${r.failedOver.to}. ` : ''}Ombi la malipo la ${tsh(r.payment.amount)} limetumwa kwa ${r.payment.phoneLocal}. Thibitisha kwa PIN kwenye simu.`);
  };
  return (
    <section className={`card fee-card ${f.overdue ? 'fee-overdue' : ''}`}>
      <div className="fee-head">
        <div>
          <h3>{f.label}</h3>
          <span className="muted">{f.kind === 'SEASON' ? `Awamu ${f.installments} · ${tsh(inst)} kila moja` : 'Inalipwa mara moja'}</span>
        </div>
        <Badge status={f.status === 'UNPAID' ? (f.overdue ? 'FAILED' : 'PENDING') : f.status} label={f.overdue ? 'Imepita tarehe' : FEE_STATUS[f.status]} />
      </div>
      <div className="fee-figs">
        <div><span>Kiasi</span><strong>{tsh(f.amount)}</strong></div>
        <div><span>Imelipwa</span><strong>{tsh(f.paid)}</strong></div>
        <div><span>Salio</span><strong>{f.status === 'WAIVED' ? '—' : tsh(f.outstanding)}</strong></div>
        <div><span>Mwisho wa kulipa</span><strong className={f.overdue ? 'text-bad' : ''}>{date(f.dueDate)}</strong></div>
      </div>
      {f.status === 'WAIVED' && f.waivedReason && <p className="muted" style={{ margin: 0 }}>Imesamehewa na CoopLink: {f.waivedReason}</p>}
      <Alert>{act.error}</Alert>

      {open && (
        <div className="cn-box pay-wait">
          <div className="cn-label">Inasubiri uthibitisho kwenye simu · kupitia {PNAME[open.provider] ?? open.provider}</div>
          <div className="cn-number">{open.phoneLocal}</div>
          <div className="cn-amount">Ombi la kulipa <strong>{tsh(open.amount)}</strong> limetumwa</div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {open.status === 'SENDING' ? 'Tunatuma ombi kwa mtandao wa simu…' : 'Fungua simu yako, weka PIN kuthibitisha malipo. Ukurasa huu utajisasisha wenyewe malipo yakithibitishwa.'}
            {waited >= 120 && ' Kama ombi halijafika kwenye simu, subiri dakika chache kisha jaribu tena.'}
          </p>
          {open.lastError && <p className="text-bad" style={{ margin: '6px 0 0', fontSize: 13 }}>{open.lastError}</p>}
          <div className="actions" style={{ marginTop: 12 }}>
            <Button variant="secondary" busy={act.busy} onClick={async () => {
              if (!window.confirm('Push haijafika kwenye simu? Ombi hili litaghairiwa ili uombe tena.\n\nKama ulishaweka PIN, usighairi — subiri kidogo.')) return;
              const r = await act.run(() => api<{ status: string; abandoned?: boolean; message?: string }>(`/billing/payments/${open.id}/cancel`, { method: 'POST', body: {} }));
              if (r) onChange(r.message ?? 'Ombi limeghairiwa. Unaweza kuomba tena sasa.');
            }}>Push haijafika? Ghairi ombi</Button>
          </div>
        </div>
      )}
      {f.testAmount && (f.status === 'UNPAID' || f.status === 'PARTIAL') && (
        <Alert kind="warn">Malipo ya majaribio yamewashwa na CoopLink: lipa {tsh(f.testAmount)} tu kujaribu mfumo. Ada halisi ya {tsh(f.amount)} haitapungua; jaribio likifanikiwa, kiasi kinarudi {tsh(f.amount)}.</Alert>
      )}
      {!open && canPay && f.allowed.length > 0 && (
        <div className="pay-form">
          {last?.status === 'FAILED' && <Alert kind="warn">Malipo ya mwisho ({tsh(last.amount)} · {last.phoneLocal} · {PNAME[last.provider] ?? last.provider}) hayakufanikiwa: {last.statusDetail ? DETAIL[last.statusDetail] ?? last.statusDetail : last.lastError ?? 'yamekataliwa'}. Jaribu tena.</Alert>}
          {f.allowed.length > 1 && (
            <div className="choice-2">
              {f.allowed.map((a) => (
                <button key={a} type="button" className={amount === a ? 'on' : ''} onClick={() => setAmount(a)}>
                  <strong>{Number(a) < Number(f.outstanding) ? 'Awamu moja' : f.status === 'PARTIAL' ? 'Awamu ya mwisho' : 'Yote'}</strong><span>{tsh(a)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="form-grid">
            <TextField label="Namba ya simu itakayolipa *" value={payer.phone} onChange={(v) => setPayer({ ...payer, phone: v })} placeholder="07xxxxxxxx" help="Ombi la PIN litakuja kwenye simu hii" />
            <TextField label="Jina kamili la mwenye namba *" value={payer.name} onChange={(v) => setPayer({ ...payer, name: v })} help="La kwanza na la mwisho" />
            <TextField label="Email *" type="email" value={payer.email} onChange={(v) => setPayer({ ...payer, email: v })} help="TeePay wanaihitaji kwa malipo ya Tanzania" />
          </div>
          <div className="actions"><Button busy={act.busy} disabled={!amount || !payer.phone || !payer.name || !payer.email} onClick={pay}>Lipa {amount ? tsh(amount) : ''} kwa simu</Button></div>
        </div>
      )}

      {f.payments.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Risiti</th><th>Tarehe</th><th className="num">Kiasi</th><th /></tr></thead>
          <tbody>{f.payments.map((p) => (
            <tr key={p.id}><td><strong>{p.receiptNo}</strong>{p.isTest && <> <Badge status="DRAFT" label="Jaribio" /></>}</td><td>{dateTime(p.paidAt)}</td><td className="num">{tsh(p.amount)}</td>
              <td style={{ textAlign: 'right' }}><Link className="btn btn-secondary btn-sm" to={`/billing/receipts/${p.id}`}>Risiti</Link></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

interface Receipt {
  isTest?: boolean;
  receipt: { receiptNo: string; amount: string; paidAt: string; providerRef: string | null; method: string };
  fee: { kind: string; label: string; amount: string; paidToDate: string; balance: string; dueDate: string };
  amcos: { name: string; code: string };
  message: string;
  business: { companyName: string; productName: string; phone: string; email: string; address: string; tin: string; website: string };
}

export function BillingReceipt({ base = '/billing' }: { base?: string }) {
  const { id } = useParams();
  const { data, error } = useFetch<Receipt>(`${base}/receipts/${id}`);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { receipt: r, fee: f, business: b } = data;
  return (
    <>
      <PageHead title={`Risiti ${r.receiptNo}`}>
        <Link className="btn btn-secondary no-print" to={base === '/billing' ? '/billing' : '/owner/subscriptions?tab=fees'}>← Rudi</Link>
        <PrintButton label="Chapisha / PDF" />
      </PageHead>
      <section className="card card-pad print-doc receipt-doc">
        <div className="doc-head">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <LogoMark size={44} onDark={false} />
            <div>
              <div className="doc-org">{b.productName} · {b.companyName}</div>
              <div className="doc-org-sub">{[b.address, b.phone, b.email].filter(Boolean).join(' · ')}{b.tin ? ` · TIN ${b.tin}` : ''}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="doc-title">{data.isTest ? 'RISITI YA MALIPO YA MAJARIBIO' : 'RISITI YA MALIPO'}</div>
            <div className="doc-no">{r.receiptNo}</div>
            <div className="doc-org-sub">{dateTime(r.paidAt)}</div>
          </div>
        </div>
        <div className="receipt-msg">{data.message}</div>
        <dl className="dl receipt-dl">
          <dt>Imepokelewa kutoka</dt><dd><strong>{data.amcos.name}</strong> ({data.amcos.code})</dd>
          <dt>Kwa ajili ya</dt><dd>{f.label}</dd>
          <dt>Kiasi</dt><dd><strong>{tsh(r.amount)}</strong><div className="muted" style={{ fontSize: 13 }}>{amountInWords(r.amount)}</div></dd>
          <dt>Njia ya malipo</dt><dd>{r.method}{r.providerRef ? ` · kumb. ${r.providerRef}` : ''}</dd>
          {f.kind === 'SEASON' && <><dt>Ada ya msimu</dt><dd>{tsh(f.amount)} · imelipwa {tsh(f.paidToDate)} · salio {tsh(f.balance)}{Number(f.balance) > 0 ? ` (mwisho ${date(f.dueDate)})` : ''}</dd></>}
        </dl>
        <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>Risiti hii imetolewa na mfumo wa {b.productName} baada ya malipo kuthibitishwa na mtoa huduma wa malipo. Haihitaji sahihi.</p>
      </section>
    </>
  );
}
