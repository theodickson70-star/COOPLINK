// =====================================================================
//  ADA YA COOPLINK (Meneja): kingilio + ada ya msimu kwa control number ya TeePay.
//  Malipo yakithibitishwa na TeePay chama kinafunguka papo hapo na risiti inatolewa.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { date, dateTime, tsh } from '../lib/format';
import { amountInWords } from '../lib/words';
import { Alert, Badge, Button, Empty, Loading, PageHead } from '../components/ui';
import { Section } from '../components/owner-ui';
import { LogoMark } from '../components/Logo';
import { PrintButton } from './acc-common';

interface Cn { id: string; amount: string; number: string | null; status: 'ISSUING' | 'ISSUED' | 'PAID' | 'FAILED'; collected: string; lastError: string | null; createdAt: string }
interface Fee {
  id: string; kind: 'ENTRANCE' | 'SEASON'; label: string; amount: string; paid: string; outstanding: string; installments: number;
  dueDate: string; status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'WAIVED'; overdue: boolean; allowed: string[]; waivedReason: string | null;
  controlNumbers: Cn[]; payments: { id: string; receiptNo: string; amount: string; paidAt: string }[];
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
  const active = data?.fees.some((f) => f.controlNumbers.some((c) => c.status === 'ISSUING' || c.status === 'ISSUED'));
  // Control number ikiwa hai, angalia kila sekunde 15 — webhook ya TeePay ikifika, chama kinafunguka bila kubonyeza chochote
  useEffect(() => {
    if (!active) return;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [active, reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const c = data.config;
  const open = data.fees.filter((f) => f.status === 'UNPAID' || f.status === 'PARTIAL');
  const done = data.fees.filter((f) => f.status === 'PAID' || f.status === 'WAIVED');
  return (
    <>
      <PageHead title="Ada ya CoopLink" sub="Malipo ya huduma ya mfumo wa CoopLink kwa control number. Malipo yakithibitishwa, unapata risiti papo hapo." />
      <Alert kind="ok">{ok}</Alert>
      {data.lock && (
        <div className="lock-card">
          <strong>Chama kimefungwa kwa muda</strong>
          <p>{data.lock.label} ({tsh(data.lock.outstanding)}) haijalipwa tangu {date(data.lock.dueDate)}. Wafanyakazi wengine hawawezi kuingia kwenye mfumo mpaka ilipwe. Lipa kwa control number hapa chini — mfumo utafunguka papo hapo malipo yakithibitishwa.</p>
        </div>
      )}
      {!data.teepayEnabled && <Alert kind="warn">Malipo kwa control number bado hayajawashwa na CoopLink. Wasiliana na CoopLink.</Alert>}
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
          <li>Lipa kwa control number tu: M-Pesa, Airtel Money, Mixx by Yas, HaloPesa au benki. Kiasi kiwe kamili kama kilivyoandikwa.</li>
        </ul>
      </Section>
    </>
  );
}

function FeeCard({ f, canPay, onChange }: { f: Fee; canPay: boolean; onChange: (msg?: string) => void }) {
  const act = useAction();
  const live = f.controlNumbers.find((c) => c.status === 'ISSUING' || c.status === 'ISSUED');
  const failed = !live ? f.controlNumbers.find((c) => c.status === 'FAILED') : undefined;
  const inst = Number(f.amount) / f.installments;
  const create = async (amount: string) => {
    const r = await act.run(() => api<{ controlNumber: Cn }>(`/billing/fees/${f.id}/control-number`, { method: 'POST', body: { amount } }));
    if (r) onChange(r.controlNumber.number ? `Control number ${r.controlNumber.number} imetengenezwa. Lipa ${tsh(r.controlNumber.amount)}.` : 'Ombi limetumwa TeePay — namba itaonekana baada ya sekunde chache.');
  };
  const sync = async (id: string) => {
    const r = await act.run(() => api<{ recorded: { receiptNo: string; amount: string }[]; status: string; number: string | null }>(`/billing/control-numbers/${id}/sync`, { method: 'POST', body: {} }));
    if (r) onChange(r.recorded.length ? `Malipo ${r.recorded.map((x) => `${x.receiptNo} (${tsh(x.amount)})`).join(', ')} yamethibitishwa.` : r.number ? 'Bado hakuna malipo yaliyothibitishwa kwenye namba hii. Ukishalipa, subiri kidogo kisha hakiki tena.' : 'TeePay bado inatoa namba. Jaribu tena baada ya muda mfupi.');
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

      {live && (
        <div className="cn-box">
          <div className="cn-label">Control number</div>
          <div className="cn-number">{live.number ? live.number.replace(/(\d{4})(?=\d)/g, '$1 ') : 'Inatolewa…'}</div>
          <div className="cn-amount">Lipa <strong>{tsh(live.amount)}</strong> kamili</div>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            {live.number ? 'Lipa kupitia M-Pesa, Airtel Money, Mixx by Yas, HaloPesa au benki ukitumia namba hii. Malipo yakithibitishwa, risiti inatokea hapa na chama kinafunguka papo hapo.' : 'TeePay bado inatoa namba. Bonyeza "Hakiki" baada ya sekunde chache.'}
          </p>
          <div className="actions">
            {live.number && <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(live.number!)}>Nakili namba</Button>}
            <Button busy={act.busy} onClick={() => sync(live.id)}>{live.number ? 'Nimelipa — hakiki malipo' : 'Hakiki'}</Button>
          </div>
          {Number(live.collected) > 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Imepokelewa kwenye namba hii: {tsh(live.collected)}</p>}
        </div>
      )}
      {!live && canPay && f.allowed.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {failed?.lastError && <Alert kind="warn">Control number iliyopita haikutolewa: {failed.lastError}</Alert>}
          <div className="actions">
            {f.allowed.map((a) => (
              <Button key={a} variant={Number(a) < Number(f.outstanding) ? 'secondary' : 'primary'} busy={act.busy} onClick={() => create(a)}>
                {f.kind === 'ENTRANCE' ? `Tengeneza control number · ${tsh(a)}` : Number(a) < Number(f.outstanding) ? `Lipa awamu moja · ${tsh(a)}` : f.status === 'PARTIAL' ? `Lipa awamu ya mwisho · ${tsh(a)}` : `Lipa yote · ${tsh(a)}`}
              </Button>
            ))}
          </div>
        </div>
      )}

      {f.payments.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Risiti</th><th>Tarehe</th><th className="num">Kiasi</th><th /></tr></thead>
          <tbody>{f.payments.map((p) => (
            <tr key={p.id}><td><strong>{p.receiptNo}</strong></td><td>{dateTime(p.paidAt)}</td><td className="num">{tsh(p.amount)}</td>
              <td style={{ textAlign: 'right' }}><Link className="btn btn-secondary btn-sm" to={`/billing/receipts/${p.id}`}>Risiti</Link></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

interface Receipt {
  receipt: { receiptNo: string; amount: string; paidAt: string; providerRef: string | null; controlNumber: string | null };
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
            <div className="doc-title">RISITI YA MALIPO</div>
            <div className="doc-no">{r.receiptNo}</div>
            <div className="doc-org-sub">{dateTime(r.paidAt)}</div>
          </div>
        </div>
        <div className="receipt-msg">{data.message}</div>
        <dl className="dl receipt-dl">
          <dt>Imepokelewa kutoka</dt><dd><strong>{data.amcos.name}</strong> ({data.amcos.code})</dd>
          <dt>Kwa ajili ya</dt><dd>{f.label}</dd>
          <dt>Kiasi</dt><dd><strong>{tsh(r.amount)}</strong><div className="muted" style={{ fontSize: 13 }}>{amountInWords(r.amount)}</div></dd>
          <dt>Njia ya malipo</dt><dd>Control number {r.controlNumber ?? '—'} (TeePay){r.providerRef ? ` · kumb. ${r.providerRef}` : ''}</dd>
          {f.kind === 'SEASON' && <><dt>Ada ya msimu</dt><dd>{tsh(f.amount)} · imelipwa {tsh(f.paidToDate)} · salio {tsh(f.balance)}{Number(f.balance) > 0 ? ` (mwisho ${date(f.dueDate)})` : ''}</dd></>}
        </dl>
        <p className="muted" style={{ fontSize: 12, marginTop: 24 }}>Risiti hii imetolewa na mfumo wa {b.productName} baada ya malipo kuthibitishwa na TeePay. Haihitaji sahihi.</p>
      </section>
    </>
  );
}
