import { useEffect, useState } from 'react';
import { useT } from '../lib/prefs';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiDownload, ApiError, type Paged } from '../lib/api';
import { CashOtpModal } from '../components/FarmerOtp';
import { usd, useFx } from '../lib/fx';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { ACCOUNT_KIND_LABEL, APPROVAL_TYPE_LABEL, date, dateTime, num, TXN_KIND_LABEL, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, MemberPicker, Modal, PageHead, Pager, Select, SelectField, TextField, type MemberLite } from '../components/ui';
import { Kpi, Section, Tabs } from '../components/owner-ui';
import { GlSelect, useChart } from './acc-common';
import { FxPanel } from '../components/FxPanel';

interface Txn {
  id: string; txnNo: string; kind: string; direction: 'IN' | 'OUT'; category: string; accountId: string | null; accountName: string | null;
  amount: string; txnDate: string; description: string; reference: string | null; payee: string | null; status: string;
  memberName: string | null; supplierName: string | null; createdBy: string | null; reversed: boolean; reversalPending: boolean;
  purchaseRequestId: string | null; postedAt: string | null;
}
interface Account { id: string; name: string; kind: string; bankName: string | null; accountNumber: string | null; openingBalance: string; balance: string; isActive: boolean }
interface Cats { income: Record<string, string>; expense: Record<string, string>; farmerPayment: Record<string, string>; supplierPayment: Record<string, string> }

const TXN_STATUS: Record<string, string> = { PENDING_APPROVAL: 'Inasubiri idhini', APPROVED: 'Imeidhinishwa — ikamilishwe', POSTED: 'Imekamilika', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };
const tone = (s: string) => (s === 'POSTED' ? 'APPROVED' : s === 'APPROVED' || s === 'PENDING_APPROVAL' ? 'DRAFT' : s);
const todayStr = () => new Date().toLocaleDateString('en-CA');

export function Finance() {
  const [tab, setTab] = useState<'txns' | 'accounts' | 'budget' | 'fx' | 'reports'>(() => { const q = new URLSearchParams(window.location.search).get('tab'); return q === 'budget' || q === 'fx' || q === 'accounts' ? q : 'txns'; });
  return (
    <>
      <PageHead title="Fedha za Chama" sub="Mapato, matumizi, malipo, akaunti na ripoti. Fedha za chama hazichanganywi na za mtu yeyote." />
      <Tabs value={tab} onChange={setTab} items={[['txns', 'Miamala'], ['accounts', 'Akaunti na Cashbook'], ['budget', 'Bajeti'], ['fx', 'Dola (USD)'], ['reports', 'Ripoti']]} />
      {tab === 'txns' && <Transactions />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'budget' && <Budget />}
      {tab === 'fx' && <FxPanel />}
      {tab === 'reports' && <Reports />}
    </>
  );
}

// ------------------------------ MIAMALA ------------------------------
function Transactions() {
  const tt = useT();
  const t = useT();
  const { may } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const list = useFetch<Paged<Txn>>('/finance/transactions', { status: status || undefined, kind: kind || undefined, page, pageSize: 25 });
  const [form, setForm] = useState<null | 'INCOME' | 'EXPENSE' | 'FARMER_PAYMENT' | 'SUPPLIER_PAYMENT'>(null);
  const [sel, setSel] = useState<string | null>(params.get('txn'));
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { const t = params.get('txn'); if (t) setSel(t); }, [params]);
  const close = () => { setSel(null); if (params.get('txn')) setParams({}, { replace: true }); };

  return (
    <div className="stack">
      {may('finance.record') && (
        <div className="actions">
          <Button onClick={() => setForm('INCOME')}>{t('+ Mapato')}</Button>
          <Button variant="secondary" onClick={() => setForm('EXPENSE')}>{t('+ Matumizi')}</Button>
          <Button variant="secondary" onClick={() => setForm('FARMER_PAYMENT')}>{t('+ Malipo kwa mkulima')}</Button>
          <Button variant="secondary" onClick={() => setForm('SUPPLIER_PAYMENT')}>{t('+ Malipo kwa mzabuni')}</Button>
        </div>
      )}
      <Alert kind="ok">{ok}</Alert>
      <Alert>{list.error}</Alert>
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Hali" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('Hali zote')}</option>
            {Object.entries(TXN_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Aina" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
            <option value="">{t('Aina zote')}</option>
            {Object.entries(TXN_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.data.length === 0 ? <Empty>{t('Hakuna miamala bado.')}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Namba / tarehe')}</th><th>{t('Aina')}</th><th>{t('Maelezo')}</th><th>{t('Akaunti')}</th><th className="num">{t('Kiasi')}</th><th>{t('Hali')}</th><th /></tr></thead>
            <tbody>{list.data?.data.map((t) => (
              <tr key={t.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{t.txnNo}</strong><div className="muted" style={{ fontSize: 12 }}>{date(t.txnDate)}</div></td>
                <td>{TXN_KIND_LABEL[t.kind]}</td>
                <td style={{ minWidth: 200 }}>{t.description}{t.payee && <div className="muted" style={{ fontSize: 12 }}>{t.payee}</div>}</td>
                <td>{t.accountName ?? '—'}</td>
                <td className={`num ${t.direction === 'OUT' ? 'money-neg' : 'money-pos'}`}>{t.direction === 'OUT' ? '−' : '+'}{tsh(t.amount)}</td>
                <td><Badge status={tone(t.status)} label={TXN_STATUS[t.status]} />{t.reversed && <div><span className="badge badge-neutral">{tt('Imesahihishwa')}</span></div>}</td>
                <td className="num"><Button size="sm" variant={t.status === 'APPROVED' && may('finance.post') ? 'primary' : 'ghost'} onClick={() => setSel(t.id)}>{t.status === 'APPROVED' && may('finance.post') ? 'Kamilisha' : 'Fungua'}</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={list.data?.meta} onPage={setPage} />
      </section>
      {form && <TxnForm kind={form} onClose={() => setForm(null)} onDone={(msg) => { setForm(null); setOk(msg); list.reload(); }} />}
      {sel && <TxnDetail id={sel} onClose={close} onChanged={(msg) => { setOk(msg); list.reload(); close(); }} />}
    </div>
  );
}

function TxnForm({ kind, onClose, onDone }: { kind: 'INCOME' | 'EXPENSE' | 'FARMER_PAYMENT' | 'SUPPLIER_PAYMENT'; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const cats = useFetch<Cats>('/finance/categories');
  const accounts = useFetch<{ data: Account[] }>('/finance/accounts');
  const suppliers = useFetch<{ data: { id: string; name: string }[] }>(kind === 'SUPPLIER_PAYMENT' ? '/store/suppliers' : null);
  const purchases = useFetch<Paged<{ id: string; prNo: string; status: string; supplierId: string | null; totalAmount: string; paid: string; currency?: 'TZS' | 'USD'; totalUsd?: string | null; paidUsd?: string }>>(kind === 'SUPPLIER_PAYMENT' ? '/store/purchases' : null, { pageSize: 100 });
  const fx = useFx();
  const [category, setCategory] = useState(kind === 'FARMER_PAYMENT' ? 'PAYMENT' : '');
  const [amount, setAmount] = useState('');
  const [txnDate, setTxnDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [reference, setReference] = useState('');
  const [accountId, setAccountId] = useState('');
  const [member, setMember] = useState<MemberLite | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [prId, setPrId] = useState('');
  const [contra, setContra] = useState('');
  const { may } = useAuth();
  const chart = useChart((kind === 'EXPENSE' || kind === 'INCOME') && may('accounting.read'));
  const { busy, error, run } = useAction();
  const catMap = kind === 'INCOME' ? cats.data?.income : kind === 'EXPENSE' ? cats.data?.expense : kind === 'FARMER_PAYMENT' ? cats.data?.farmerPayment : null;
  const needsMember = kind === 'FARMER_PAYMENT' || (kind === 'INCOME' && category === 'FARMER_REPAYMENT');
  const openPrs = purchases.data?.data.filter((p) => ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(p.status) && (!supplierId || !p.supplierId || p.supplierId === supplierId)) ?? [];
  const title = { INCOME: 'Rekodi mapato', EXPENSE: 'Andaa matumizi', FARMER_PAYMENT: 'Andaa malipo kwa mkulima', SUPPLIER_PAYMENT: 'Andaa malipo kwa mzabuni' }[kind];
  // Onyo la bajeti: matumizi haya yatafikisha kundi hili wapi?
  const dAmount = useDebounced(amount, 400);
  const budgetCheck = useFetch<{ budget: string | null; label?: string; actual?: string; after?: string; percentAfter?: number | null; exceeds?: boolean; over?: string }>(
    kind === 'EXPENSE' && category ? '/finance/budgets/check' : null, { category, amount: Number(dAmount) || 0 });
  // Ombi la manunuzi la dola: kiasi kinaandikwa kwa USD; TSh = dola x kiwango cha leo
  const usdPr = kind === 'SUPPLIER_PAYMENT' ? purchases.data?.data.find((p) => p.id === prId && p.currency === 'USD') : undefined;
  const valid = Number(amount) > 0 && description.trim().length >= 3 && (kind === 'SUPPLIER_PAYMENT' ? !!supplierId : !!category) && (!needsMember || !!member) && (kind !== 'INCOME' || !!accountId);

  const save = async () => {
    const path = { INCOME: '/finance/income', EXPENSE: '/finance/expenses', FARMER_PAYMENT: '/finance/farmer-payments', SUPPLIER_PAYMENT: '/finance/supplier-payments' }[kind];
    const body = {
      amount, txnDate, description, reference: reference || null, payee: payee || null, accountId: accountId || null,
      ...(kind === 'SUPPLIER_PAYMENT' ? { supplierId, purchaseRequestId: prId || null, ...(usdPr ? { amountUsd: amount, amount: fx.rate ? (Number(amount) * fx.rate).toFixed(2) : amount } : {}) } : { category }),
      ...(needsMember && member ? { memberId: member.id } : {}),
      ...(contra && (kind === 'EXPENSE' || (kind === 'INCOME' && !['FARMER_REPAYMENT', 'MEMBER_FEES'].includes(category))) ? { contraGlAccountId: contra } : {}),
    };
    const r = await run(() => api<{ transaction: { txnNo: string; status: string } }>(path, { method: 'POST', body }));
    if (r) onDone(r.transaction.status === 'POSTED' ? `${r.transaction.txnNo} imerekodiwa` : r.transaction.status === 'APPROVED' ? `${r.transaction.txnNo} iko tayari kukamilishwa (manunuzi yameshaidhinishwa)` : `${r.transaction.txnNo} imetumwa kwa Meneja kwa idhini`);
  };
  return (
    <Modal open title={title} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={!valid} onClick={save}>{kind === 'INCOME' ? 'Rekodi' : 'Tuma kwa Meneja'}</Button></>}>
      {kind !== 'INCOME' && <Alert kind="warn">{kind === 'SUPPLIER_PAYMENT' && prId ? 'Malipo ya ombi la manunuzi lililoidhinishwa hayaombi idhini tena. Utayakamilisha fedha zikitoka.' : 'Hii itasubiri idhini ya Meneja. Baada ya idhini, utaikamilisha fedha zikitoka kweli.'}</Alert>}
      <Alert>{error}</Alert>
      <div className="form-grid">
        {catMap && <SelectField label="Kundi *" value={category} onChange={setCategory} placeholder="Chagua…" options={Object.entries(catMap).map(([value, label]) => ({ value, label }))} />}
        {kind === 'SUPPLIER_PAYMENT' && <SelectField label="Mzabuni *" value={supplierId} onChange={(v) => { setSupplierId(v); setPrId(''); }} placeholder="Chagua…" options={suppliers.data?.data.map((s) => ({ value: s.id, label: s.name })) ?? []} />}
        {kind === 'SUPPLIER_PAYMENT' && <SelectField label="Ombi la manunuzi (hiari)" value={prId} onChange={setPrId} placeholder="Bila ombi"
          options={openPrs.map((p) => ({ value: p.id, label: p.currency === 'USD' && p.totalUsd ? `${p.prNo} · ${usd(p.totalUsd)} (limelipwa ${usd(p.paidUsd)})` : `${p.prNo} · ${tsh(p.totalAmount)} (limelipwa ${tsh(p.paid)})` }))} />}
        <TextField label={usdPr ? 'Kiasi (USD) *' : 'Kiasi (TSh) *'} type="number" min={usdPr ? '0.01' : '1'} step={usdPr ? '0.01' : '1'} value={amount} onChange={setAmount}
          help={usdPr ? (fx.rate ? `≈ ${tsh(Number(amount || 0) * fx.rate)} kwa kiwango cha leo (${num(fx.rate)}). Tofauti na kiwango cha ombi inaandikwa kama faida/hasara ya kiwango.` : 'Kiwango cha dola hakijawekwa') : undefined} />
        <TextField label="Tarehe" type="date" value={txnDate} onChange={setTxnDate} />
        <SelectField label={kind === 'INCOME' ? 'Akaunti iliyopokea *' : 'Akaunti ya kulipa (hiari sasa)'} value={accountId} onChange={setAccountId} placeholder="Chagua…"
          options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
        {!needsMember && kind !== 'SUPPLIER_PAYMENT' && <TextField label={kind === 'INCOME' ? 'Aliyelipa' : 'Mlipwaji'} value={payee} onChange={setPayee} />}
        <TextField label="Namba ya risiti / kumbukumbu" value={reference} onChange={setReference} />
      </div>
      {needsMember && <MemberPicker label="Mkulima *" value={member} onChange={setMember} />}
      {chart.data && (kind === 'EXPENSE' || (kind === 'INCOME' && !['FARMER_REPAYMENT', 'MEMBER_FEES'].includes(category))) && (
        <GlSelect label="Akaunti ya daftari kuu (hiari)" value={contra} onChange={setContra} accounts={chart.data.data} placeholder="Kwa kundi (kiotomatiki)"
          help={kind === 'EXPENSE' ? 'mf. 1500 kununua mali, 2410 kulipa PAYE, 2420 NSSF, 2300 ushuru wa Chama Kikuu, 2150 deni la pembejeo' : 'mf. 2500 mkopo uliopokelewa, 1250 marejesho ya madeni mengine'} />
      )}
      {kind === 'EXPENSE' && budgetCheck.data?.budget && Number(amount) > 0 && (
        budgetCheck.data.exceeds
          ? <Alert kind="error"><strong>{t('Yatazidi bajeti:')}</strong> {budgetCheck.data.label} — bajeti {tsh(budgetCheck.data.budget)}, imeshatumika {tsh(budgetCheck.data.actual ?? 0)}. Haya yatafikisha {tsh(budgetCheck.data.after ?? 0)} ({num(budgetCheck.data.percentAfter ?? 0)}%), yaani zaidi kwa {tsh(budgetCheck.data.over ?? 0)}. Meneja ataona onyo hili akiidhinisha.</Alert>
          : (budgetCheck.data.percentAfter ?? 0) >= 90
            ? <Alert kind="warn">Bajeti ya {budgetCheck.data.label} itafikia {num(budgetCheck.data.percentAfter ?? 0)}% ({tsh(budgetCheck.data.after ?? 0)} kati ya {tsh(budgetCheck.data.budget)}).</Alert>
            : <p className="name-note">Bajeti ya {budgetCheck.data.label}: baada ya haya {num(budgetCheck.data.percentAfter ?? 0)}% imetumika ({tsh(budgetCheck.data.after ?? 0)} kati ya {tsh(budgetCheck.data.budget)}).</p>
      )}
      <TextField label="Maelezo *" value={description} onChange={setDescription} />
    </Modal>
  );
}

function TxnDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: string) => void }) {
  const tt = useT();
  const { may } = useAuth();
  const { data, loading } = useFetch<{ transaction: Txn; approvals: { id: string; requestNo: string; type: string; status: string; decisionNote: string | null; decidedAt: string | null; createdAt: string }[] }>(`/finance/transactions/${id}`);
  const accounts = useFetch<{ data: Account[] }>(may('finance.post') ? '/finance/accounts' : null);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'view' | 'reverse' | 'cash'>('view');
  const { busy, error, setError, run } = useAction();
  useEffect(() => { if (data?.transaction.accountId) setAccountId(data.transaction.accountId); }, [data]);
  // v0.40: malipo ya taslimu kwa mkulima — mkulima anathibitisha kwa OTP (backend ikirudisha CASH_OTP_REQUIRED)
  const post = async (cashOverride?: string) => {
    setError(null);
    const r = await run(async () => {
      try { return await api(`/finance/transactions/${id}/post`, { method: 'POST', body: { accountId, reference: reference || undefined, cashOverride } }); }
      catch (e) { if (e instanceof ApiError && e.code === 'CASH_OTP_REQUIRED' && mode !== 'cash') { setMode('cash'); return null; } throw e; }
    });
    if (r && data) onChanged(`${data.transaction.txnNo} imekamilishwa`);
  };
  if (loading || !data) return <Modal open title="Muamala" onClose={onClose}><Loading /></Modal>;
  const t = data.transaction;
  const canPost = t.status === 'APPROVED' && may('finance.post') && !(t.kind === 'TRANSFER' && t.direction === 'IN');
  const canReverse = t.status === 'POSTED' && t.kind !== 'REVERSAL' && !t.reversed && !t.reversalPending && may('finance.record');
  if (mode === 'cash') return <CashOtpModal type="txn" busy={busy} error={error} onClose={() => setMode('view')} onConfirm={(o) => post(o)}
    items={[{ id: t.id, memberNo: '', name: t.payee ?? '', amount: t.amount }]} />;
  return (
    <Modal open title={`${t.txnNo} · ${TXN_KIND_LABEL[t.kind]}`} onClose={onClose}
      footer={canPost ? <Button busy={busy} disabled={!accountId} onClick={() => post()}>{tt('Kamilisha — fedha zimetoka')}</Button>
        : mode === 'reverse' ? <Button variant="danger" busy={busy} disabled={reason.trim().length < 5} onClick={async () => {
          if (await run(() => api(`/finance/transactions/${id}/reverse`, { method: 'POST', body: { reason } }))) onChanged(`Ombi la kusahihisha ${t.txnNo} limetumwa kwa Meneja`);
        }}>{tt('Tuma ombi la kusahihisha')}</Button>
        : canReverse ? <Button variant="secondary" onClick={() => setMode('reverse')}>Sahihisha (reversal)</Button> : <Button variant="secondary" onClick={onClose}>{tt('Funga')}</Button>}>
      <dl className="dl">
        <dt>{tt('Kiasi')}</dt><dd><strong className={t.direction === 'OUT' ? 'money-neg' : 'money-pos'}>{t.direction === 'OUT' ? '−' : '+'}{tsh(t.amount)}</strong></dd>
        <dt>{tt('Hali')}</dt><dd><Badge status={tone(t.status)} label={TXN_STATUS[t.status]} /></dd>
        <dt>{tt('Maelezo')}</dt><dd>{t.description}</dd>
        {t.payee && <><dt>{tt('Mhusika')}</dt><dd>{t.payee}</dd></>}
        <dt>{tt('Tarehe')}</dt><dd>{date(t.txnDate)}</dd>
        <dt>{tt('Akaunti')}</dt><dd>{t.accountName ?? '—'}</dd>
        {t.reference && <><dt>{tt('Kumbukumbu')}</dt><dd>{t.reference}</dd></>}
        <dt>{tt('Aliandaa')}</dt><dd>{t.createdBy}</dd>
        {t.postedAt && <><dt>{tt('Imekamilishwa')}</dt><dd>{dateTime(t.postedAt)}</dd></>}
        <dt>{t.direction === 'IN' ? 'Risiti' : 'Vocha'}</dt><dd><Link to={`/vouchers/${t.id}`} onClick={onClose}>{t.direction === 'IN' ? 'Chapisha risiti →' : 'Chapisha vocha ya malipo →'}</Link></dd>
      </dl>
      {t.kind === 'TRANSFER' && t.direction === 'IN' && t.status === 'APPROVED' && <Alert kind="warn">{tt('Huu ni upande wa kupokea wa uhamisho. Kamilisha upande wa kutoa fedha — pande zote mbili zitakamilika pamoja.')}</Alert>}
      {data.approvals.length > 0 && (
        <div className="table-wrap"><table className="table"><tbody>{data.approvals.map((a) => (
          <tr key={a.id}><td>{a.requestNo}</td><td>{APPROVAL_TYPE_LABEL[a.type]}</td><td><Badge status={a.status === 'PENDING' ? 'DRAFT' : a.status} label={a.status === 'PENDING' ? 'Inasubiri' : undefined} /></td><td className="muted">{a.decisionNote ?? ''}</td></tr>
        ))}</tbody></table></div>
      )}
      {t.reversalPending && <Alert kind="warn">{tt('Kuna ombi la kusahihisha muamala huu linalosubiri Meneja.')}</Alert>}
      <Alert>{error}</Alert>
      {canPost && (
        <div className="form-grid">
          <SelectField label="Akaunti iliyolipa *" value={accountId} onChange={setAccountId} placeholder="Chagua…" options={accounts.data?.data.filter((a) => a.isActive).map((a) => ({ value: a.id, label: `${a.name} · ${tsh(a.balance)}` })) ?? []} />
          <TextField label="Namba ya muamala / risiti" value={reference} onChange={setReference} />
        </div>
      )}
      {mode === 'reverse' && <>
        <Alert kind="warn">Muamala hautafutwa. Muamala kinyume (reversal) utaandikwa baada ya Meneja kuidhinisha, na historia yote itabaki.</Alert>
        <TextField label="Sababu ya kusahihisha *" value={reason} onChange={setReason} />
      </>}
    </Modal>
  );
}

// ------------------------------ AKAUNTI ------------------------------
function Accounts() {
  const t = useT();
  const { may } = useAuth();
  const { data, loading, reload } = useFetch<{ data: Account[] }>('/finance/accounts');
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<string>('');
  const now = todayStr();
  const [from, setFrom] = useState(`${now.slice(0, 7)}-01`);
  const [to, setTo] = useState(now);
  const cb = useFetch<{ opening: string; closing: string; lines: { id: string; txnNo: string; txnDate: string; description: string; payee: string | null; moneyIn: string | null; moneyOut: string | null; balance: string }[] }>(book ? '/finance/reports/cashbook' : null, { accountId: book, from, to });
  return (
    <div className="stack">
      <Section title="Akaunti za fedha" actions={may('finance.accounts') && <Button size="sm" onClick={() => setOpen(true)}>{t('+ Akaunti')}</Button>}>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>{t('Ongeza akaunti ya fedha taslimu, benki au simu.')}</Empty> : (
          <div className="grid grid-3">
            {data?.data.map((a) => (
              <button key={a.id} type="button" className={`card kpi ${book === a.id ? 'kpi-dark' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => setBook(a.id)}>
                <div className="kpi-top"><span className="label">{a.name}{!a.isActive ? ' (imefungwa)' : ''}</span></div>
                <span className="value">{tsh(a.balance)}</span>
                <span className="hint">{ACCOUNT_KIND_LABEL[a.kind]}{a.bankName ? ` · ${a.bankName}` : ''}{a.accountNumber ? ` · ${a.accountNumber}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
      {book && (
        <Section pad={false} title="Cashbook" actions={<div className="actions"><input className="input" type="date" aria-label="Kuanzia" value={from} onChange={(e) => setFrom(e.target.value)} /><input className="input" type="date" aria-label="Hadi" value={to} onChange={(e) => setTo(e.target.value)} /></div>}>
          {cb.loading && !cb.data ? <Loading /> : cb.data && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>{t('Tarehe')}</th><th>{t('Namba')}</th><th>{t('Maelezo')}</th><th className="num">{t('Ndani')}</th><th className="num">{t('Nje')}</th><th className="num">{t('Salio')}</th></tr></thead>
              <tbody>
                <tr><td colSpan={5}><strong>{t('Salio la mwanzo')}</strong></td><td className="num"><strong>{tsh(cb.data.opening)}</strong></td></tr>
                {cb.data.lines.map((l) => (
                  <tr key={l.id}><td>{date(l.txnDate)}</td><td>{l.txnNo}</td><td>{l.description}{l.payee && <div className="muted" style={{ fontSize: 12 }}>{l.payee}</div>}</td>
                    <td className="num money-pos">{l.moneyIn ? tsh(l.moneyIn) : ''}</td><td className="num money-neg">{l.moneyOut ? tsh(l.moneyOut) : ''}</td><td className="num">{tsh(l.balance)}</td></tr>
                ))}
                <tr><td colSpan={5}><strong>{t('Salio la mwisho')}</strong></td><td className="num"><strong>{tsh(cb.data.closing)}</strong></td></tr>
              </tbody>
            </table></div>
          )}
        </Section>
      )}
      {open && <AccountModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </div>
  );
}

function AccountModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: '', kind: 'CASH', bankName: '', accountNumber: '', openingBalance: '0' });
  const { busy, error, run } = useAction();
  return (
    <Modal open title="Akaunti mpya ya fedha" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('Ghairi')}</Button><Button busy={busy} disabled={f.name.trim().length < 2} onClick={async () => {
        if (await run(() => api('/finance/accounts', { method: 'POST', body: { ...f, bankName: f.bankName || null, accountNumber: f.accountNumber || null } }))) onDone();
      }}>{t('Hifadhi')}</Button></>}>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <TextField label="Jina *" placeholder="mf. CRDB — Akaunti ya chama" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <SelectField label="Aina" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        {f.kind !== 'CASH' && <TextField label={f.kind === 'BANK' ? 'Benki' : 'Mtoa huduma'} value={f.bankName} onChange={(v) => setF({ ...f, bankName: v })} />}
        {f.kind !== 'CASH' && <TextField label="Namba ya akaunti" value={f.accountNumber} onChange={(v) => setF({ ...f, accountNumber: v })} />}
        <TextField label="Salio la kuanzia (TSh)" help="Haliwezi kubadilishwa baada ya miamala ya kwanza" type="number" min="0" value={f.openingBalance} onChange={(v) => setF({ ...f, openingBalance: v })} />
      </div>
    </Modal>
  );
}

// ------------------------------ BAJETI ------------------------------
interface BudgetRow { category: string; label: string; budget: string | null; actual: string; remaining: string | null; percent: number | null; state: 'OK' | 'NEAR' | 'OVER' | 'FAST' | 'NO_BUDGET'; byMonth: Record<string, string> }
export const BUDGET_STATE: Record<string, { label: string; cls: string }> = {
  OK: { label: 'Sawa', cls: 'badge-ok' }, NEAR: { label: 'Karibu kuisha', cls: 'badge-warn' }, OVER: { label: 'Imezidi', cls: 'badge-bad' },
  FAST: { label: 'Inatumika haraka', cls: 'badge-warn' }, NO_BUDGET: { label: 'Haina bajeti', cls: 'badge-neutral' },
};
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('sw-TZ', { month: 'short', year: '2-digit' });

function Budget() {
  const tt = useT();
  const { may } = useAuth();
  const cats = useFetch<Cats>('/finance/categories');
  const { data, loading, reload } = useFetch<{ data: BudgetRow[]; months: string[]; season?: { name: string }; elapsedPercent?: number; totals: { budget: string; actual: string; remaining: string; percent: number | null } | null }>('/finance/budgets');
  const [edit, setEdit] = useState<{ category: string; amount: string } | null>(null);
  const [view, setView] = useState<'summary' | 'months'>('summary');
  const act = useAction();
  const t = data?.totals;
  const warn = data?.data.filter((b) => b.state === 'OVER' || b.state === 'NEAR' || b.state === 'FAST') ?? [];
  return (
    <div className="stack">
      {t && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label={`Bajeti ya msimu ${data?.season?.name ?? ''}`} value={tsh(t.budget)} />
          <Kpi label="Imetumika" value={tsh(t.actual)} hint={t.percent !== null ? `${num(t.percent)}% ya bajeti` : undefined} />
          <Kpi tone={Number(t.remaining) < 0 ? 'bad' : undefined} label={Number(t.remaining) < 0 ? 'Imezidi bajeti' : 'Inayobaki'} value={tsh(Math.abs(Number(t.remaining)))} />
          <Kpi label="Muda wa msimu uliopita" value={`${data?.elapsedPercent ?? 0}%`} hint="Matumizi yakizidi sana asilimia hii, yanaenda kasi" />
        </div>
      )}
      {warn.length > 0 && (
        <Alert kind={warn.some((w) => w.state === 'OVER') ? 'error' : 'warn'}>
          {warn.map((w) => <div key={w.category}><strong>{w.label}:</strong> {BUDGET_STATE[w.state].label.toLowerCase()} — {num(w.percent ?? 0)}% ({tsh(w.actual)} kati ya {tsh(w.budget ?? 0)})</div>)}
        </Alert>
      )}
      <Section pad={false} title="Bajeti ya msimu dhidi ya matumizi halisi"
        actions={<div className="actions">
          <div className="seg" role="tablist">
            <button className={view === 'summary' ? 'on' : ''} onClick={() => setView('summary')}>{tt('Muhtasari')}</button>
            <button className={view === 'months' ? 'on' : ''} onClick={() => setView('months')}>{tt('Kila mwezi')}</button>
          </div>
          {may('finance.accounts') && <Button size="sm" onClick={() => setEdit({ category: '', amount: '' })}>{tt('+ Weka bajeti')}</Button>}
        </div>}>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>{tt('Bado hakuna bajeti ya msimu huu. Weka bajeti ya kila kundi la matumizi ili mfumo ukuonye matumizi yakikaribia kuzidi.')}</Empty> : view === 'summary' ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{tt('Kundi')}</th><th className="num">{tt('Bajeti')}</th><th className="num">{tt('Imetumika')}</th><th className="num">{tt('Inayobaki')}</th><th style={{ minWidth: 150 }}>{tt('Matumizi')}</th><th>{tt('Hali')}</th><th /></tr></thead>
            <tbody>{data?.data.map((b) => {
              const pct = Math.min(100, b.percent ?? 0);
              return (
                <tr key={b.category}>
                  <td>{b.label}</td><td className="num">{b.budget ? tsh(b.budget) : <span className="muted">—</span>}</td><td className="num">{tsh(b.actual)}</td>
                  <td className="num">{b.remaining === null ? '—' : <span className={Number(b.remaining) < 0 ? 'money-neg' : ''}>{tsh(b.remaining)}</span>}</td>
                  <td><div className="progress"><span style={{ width: `${pct}%`, background: (b.percent ?? 0) > 100 ? 'var(--danger)' : pct >= 90 ? 'var(--gold)' : 'var(--green)' }} /></div><small className="muted">{b.percent === null ? 'Hakuna bajeti' : `${num(b.percent)}%`}</small></td>
                  <td><span className={`badge ${BUDGET_STATE[b.state].cls}`}>{BUDGET_STATE[b.state].label}</span></td>
                  <td className="num">{may('finance.accounts') && <Button size="sm" variant="ghost" onClick={() => setEdit({ category: b.category, amount: b.budget ? String(Number(b.budget)) : '' })}>{tt('Badilisha')}</Button>}</td>
                </tr>
              );
            })}</tbody>
            {t && <tfoot><tr className="row-grand"><td>{tt('Jumla')}</td><td className="num">{tsh(t.budget)}</td><td className="num">{tsh(t.actual)}</td><td className="num">{tsh(t.remaining)}</td><td colSpan={3}>{t.percent !== null ? `${num(t.percent)}%` : ''}</td></tr></tfoot>}
          </table></div>
        ) : (
          <div className="table-wrap"><table className="table fin-table">
            <thead><tr><th>{tt('Kundi')}</th>{data?.months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">{tt('Jumla')}</th><th className="num">{tt('Bajeti')}</th></tr></thead>
            <tbody>{data?.data.map((b) => (
              <tr key={b.category}><td>{b.label}</td>{data.months.map((m) => <td key={m} className="num">{Number(b.byMonth[m] ?? 0) ? tsh(b.byMonth[m]) : <span className="muted">—</span>}</td>)}
                <td className="num"><strong>{tsh(b.actual)}</strong></td><td className="num">{b.budget ? tsh(b.budget) : '—'}</td></tr>
            ))}</tbody>
            <tfoot><tr className="row-grand"><td>{tt('Jumla')}</td>{data?.months.map((m) => <td key={m} className="num">{tsh(data.data.reduce((x, b) => x + Number(b.byMonth[m] ?? 0), 0))}</td>)}<td className="num">{tsh(t?.actual ?? 0)}</td><td className="num">{tsh(t?.budget ?? 0)}</td></tr></tfoot>
          </table></div>
        )}
        {edit && (
          <Modal open title="Bajeti" onClose={() => setEdit(null)}
            footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{tt('Ghairi')}</Button><Button busy={act.busy} disabled={!edit.category || !edit.amount} onClick={async () => {
              if (await act.run(() => api('/finance/budgets', { method: 'PUT', body: edit }))) { setEdit(null); reload(); }
            }}>{tt('Hifadhi')}</Button></>}>
            <Alert>{act.error}</Alert>
            <SelectField label="Kundi la matumizi *" value={edit.category} onChange={(v) => setEdit({ ...edit, category: v })} placeholder="Chagua…" options={Object.entries(cats.data?.expense ?? {}).map(([value, label]) => ({ value, label }))} />
            <TextField label="Kiasi cha msimu (TSh) *" type="number" min="0" value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} />
          </Modal>
        )}
      </Section>
    </div>
  );
}

// ------------------------------ RIPOTI ------------------------------
function Reports() {
  const tt = useT();
  const now = todayStr();
  const [from, setFrom] = useState(`${now.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(now);
  const s = useFetch<{ totals: Record<string, string>; breakdown: { kind: string; category: string; label: string; total: string }[]; pending: { count: number; amount: string } }>('/finance/reports/summary', { from, to });
  const ap = useFetch<{ data: { id: string; prNo: string; supplier: string | null; received: string; paid: string; owing: string }[]; totalOwing: string }>('/finance/reports/payables');
  const ar = useFetch<Paged<{ memberId: string; memberNo: string; firstName: string; lastName: string; balance: string }>>('/reports/member-balances', { onlyOwing: true, pageSize: 10 });
  const t = s.data?.totals;
  return (
    <div className="stack print-area">
      <div className="actions no-print">
        <input className="input" style={{ width: 'auto' }} type="date" aria-label="Kuanzia" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" style={{ width: 'auto' }} type="date" aria-label="Hadi" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" onClick={() => apiDownload('/finance/reports/transactions.csv', { query: { from, to }, filename: `miamala-${from}-${to}.csv` })}>Pakua miamala (Excel)</Button>
        <Button variant="secondary" onClick={() => window.print()}>{tt('Chapisha / PDF')}</Button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Kipindi: {date(from)} – {date(to)} · miamala iliyokamilika tu</p>
      {t && (
        <div className="grid grid-kpi">
          <Kpi tone="dark" label="Mapato" value={tsh(t.income)} />
          <Kpi label="Matumizi" value={tsh(t.expense)} />
          <Kpi label="Malipo kwa wakulima" value={tsh(t.farmerPayments)} />
          <Kpi label="Malipo kwa wazabuni" value={tsh(t.supplierPayments)} />
          <Kpi tone={Number(t.net) < 0 ? 'bad' : 'gold'} label="Ziada / Upungufu" value={tsh(t.net)} hint={s.data!.pending.count ? `${s.data!.pending.count} yanasubiri (${tsh(s.data!.pending.amount)})` : undefined} />
        </div>
      )}
      <div className="grid grid-2">
        <Section pad={false} title="Mapato na matumizi kwa kundi">
          {s.data?.breakdown.length === 0 ? <Empty>{tt('Hakuna miamala kwenye kipindi hiki.')}</Empty> : (
            <div className="table-wrap"><table className="table"><tbody>{s.data?.breakdown.map((b) => (
              <tr key={b.kind + b.category}><td>{b.label}<div className="muted" style={{ fontSize: 12 }}>{TXN_KIND_LABEL[b.kind]}</div></td><td className={`num ${b.kind === 'INCOME' ? 'money-pos' : ''}`}>{tsh(b.total)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Section>
        <div className="stack">
          <Section pad={false} title={`Madeni ya wazabuni (payables): ${tsh(ap.data?.totalOwing)}`}>
            {ap.data?.data.length === 0 ? <Empty>{tt('Hakuna.')}</Empty> : (
              <div className="table-wrap"><table className="table"><tbody>{ap.data?.data.map((p) => (
                <tr key={p.id}><td>{p.prNo}<div className="muted" style={{ fontSize: 12 }}>{p.supplier ?? '—'}</div></td><td className="num">Mzigo {tsh(p.received)}<div className="muted" style={{ fontSize: 12 }}>Limelipwa {tsh(p.paid)}</div></td><td className="num money-neg">{tsh(p.owing)}</td></tr>
              ))}</tbody></table></div>
            )}
          </Section>
          <Section pad={false} title="Madeni ya wakulima (receivables) — 10 wakubwa">
            {ar.data?.data.length === 0 ? <Empty>{tt('Hakuna mkulima mwenye deni.')}</Empty> : (
              <div className="table-wrap"><table className="table"><tbody>{ar.data?.data.map((r) => (
                <tr key={r.memberId}><td>{r.firstName} {r.lastName}<div className="muted" style={{ fontSize: 12 }}>{r.memberNo}</div></td><td className="num money-neg">{tsh(Math.abs(Number(r.balance)))}</td></tr>
              ))}</tbody></table></div>
            )}
          </Section>
        </div>
      </div>
      <p className="muted no-print" style={{ fontSize: 12 }}>Trial Balance, Balance Sheet, Cash Flow, mishahara (payroll) na bank reconciliation zitakuja kwenye awamu inayofuata (double-entry).</p>
    </div>
  );
}
