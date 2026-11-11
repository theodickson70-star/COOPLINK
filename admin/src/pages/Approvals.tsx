import { useState, type ReactNode } from 'react';
import { usd } from '../lib/fx';
import { useT } from '../lib/prefs';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { APPROVAL_TYPE_LABEL, dateTime, num, phone, ROLE_LABEL, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, TextField } from '../components/ui';
import { Tabs } from '../components/owner-ui';

export interface Approval {
  id: string; requestNo: string; type: string; typeLabel: string; status: string; title: string; amount: string | null; reason: string | null;
  entityType: string | null; entityId: string | null; payload: Record<string, unknown> | null;
  requestedById: string; requestedRole: string; requestedBy: string | null; createdAt: string;
  decidedBy: string | null; decidedRole: string | null; decidedAt: string | null; decisionNote: string | null;
}

const STATUS: Record<string, string> = { PENDING: 'Inasubiri', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa', CANCELLED: 'Imeondolewa' };

/** Kiungo cha rekodi inayohusika na ombi. */
export function entityLink(a: Pick<Approval, 'entityType' | 'entityId'>) {
  if (!a.entityId) return null;
  if (a.entityType === 'Member') return `/members/${a.entityId}`;
  if (a.entityType === 'InputIssue') return `/input-issues/${a.entityId}`;
  if (a.entityType === 'PurchaseRequest') return `/purchases/${a.entityId}`;
  if (a.entityType === 'FinanceTransaction') return `/finance?txn=${a.entityId}`;
  if (a.entityType === 'Market') return `/sales/markets/${a.entityId}`;
  if (a.entityType === 'PaymentBatch') return `/sales/batches/${a.entityId}`;
  if (a.entityType === 'PayrollRun') return `/payroll/runs/${a.entityId}`;
  if (a.entityType === 'FixedAsset') return '/fixed-assets';
  if (a.entityType === 'MemberGroup') return `/groups/${a.entityId}`;
  if (a.entityType === 'KuniBatch') return `/kuni/batches/${a.entityId}`;
  return null;
}

// ------------------------------ MAKUNDI YA MAOMBI ------------------------------
const ICON = {
  members: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M16.5 14.6c2.5.2 4.4 1.9 5 5.4" /></>,
  inputs: <><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.8" /><path d="M6 9v.01M18 15v.01" /></>,
  leaf: <><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z" /><path d="M5 19l8-8" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h13v4" /><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="16" cy="13.5" r="1.3" /></>,
  book: <><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" /><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z" /></>,
  all: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
};
const Svg = ({ d }: { d: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

type Cat = 'farmers' | 'inputs' | 'finance' | 'sales' | 'loans' | 'books';
export const CATS: Record<Cat, { label: string; icon: ReactNode; types: string[] }> = {
  farmers: { label: 'Wakulima na vikundi', icon: ICON.members, types: ['MEMBER_REGISTRATION', 'GROUP_REGISTRATION', 'GROUP_CHANGE'] },
  inputs: { label: 'Pembejeo na stoo', icon: ICON.inputs, types: ['INPUT_ISSUE', 'STOCK_RECEIPT', 'STOCK_ADJUSTMENT', 'PURCHASE'] },
  finance: { label: 'Fedha na malipo', icon: ICON.money, types: ['EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT', 'TRANSFER', 'REVERSAL', 'PAYROLL'] },
  sales: { label: 'Mauzo ya tumbaku', icon: ICON.leaf, types: ['TOBACCO_SALE', 'PAYMENT_BATCH'] },
  loans: { label: 'Mikopo', icon: ICON.wallet, types: ['KUNI_BATCH'] },
  books: { label: 'Uhasibu', icon: ICON.book, types: ['JOURNAL', 'OPENING_BALANCE', 'PERIOD_CLOSE', 'YEAR_END_CLOSE', 'ASSET_DISPOSAL'] },
};
export const catOf = (type: string): Cat => (Object.entries(CATS).find(([, c]) => c.types.includes(type))?.[0] as Cat) ?? 'books';

/** Kitakachotokea Meneja akiidhinisha — kwa lugha rahisi */
const EFFECT: Record<string, string> = {
  MEMBER_REGISTRATION: 'Mkulima atakuwa mwanachama hai na kupata namba ya uanachama.',
  GROUP_REGISTRATION: 'Kikundi kitakuwa hai; wanachama wake watadhaminiana madeni.',
  GROUP_CHANGE: 'Mabadiliko ya wanachama wa kikundi yataanza kutumika.',
  INPUT_ISSUE: 'Pembejeo zitatoka stoo na thamani yake itaingia kwenye deni la mkulima.',
  STOCK_RECEIPT: 'Mzigo utaingia stoo kwa idadi na bei utakazothibitisha.',
  STOCK_ADJUSTMENT: 'Salio la stoo litarekebishwa kama ilivyoombwa.',
  PURCHASE: 'Ombi la manunuzi litaruhusiwa kuendelea kwa mzabuni.',
  EXPENSE: 'Matumizi yataruhusiwa kulipwa kutoka akaunti ya chama.',
  FARMER_PAYMENT: 'Malipo kwa mkulima yataruhusiwa kutoka akaunti ya chama.',
  SUPPLIER_PAYMENT: 'Mzabuni atalipwa kutoka akaunti ya chama.',
  TRANSFER: 'Fedha zitahamishwa kati ya akaunti za chama.',
  REVERSAL: 'Muamala utasahihishwa (kinyume chake kitaandikwa); historia inabaki.',
  PAYROLL: 'Mishahara itaruhusiwa kulipwa kwa watumishi.',
  TOBACCO_SALE: 'Mauzo yataingia kwenye daftari kuu na madeni ya wakulima yatakatwa.',
  PAYMENT_BATCH: 'Mhasibu ataruhusiwa kuwalipa wakulima kwenye orodha.',
  KUNI_BATCH: 'Mhasibu atatuma pesa kwa wakulima; mkopo na riba vitaingia kwenye deni la dola la mkulima.',
  JOURNAL: 'Journal itaandikwa kwenye daftari kuu.',
  OPENING_BALANCE: 'Salio la kuanzia litaandikwa kwenye vitabu vya chama.',
  PERIOD_CLOSE: 'Vitabu vitafungwa — hakuna muamala wa kipindi hicho utakaoruhusiwa tena.',
  YEAR_END_CLOSE: 'Mwaka utafungwa na ziada/upungufu kuhamishiwa kwenye mtaji.',
  ASSET_DISPOSAL: 'Mali itaondolewa kwenye rejista ya mali za chama.',
};

/** "dakika 5 / saa 3 / siku 2" tangu ombi litumwe */
function waited(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return { text: 'sasa hivi', late: false };
  if (m < 60) return { text: `dakika ${m}`, late: false };
  const h = Math.round(m / 60);
  if (h < 24) return { text: `saa ${h}`, late: false };
  const d = Math.round(h / 24);
  return { text: `siku ${d}`, late: d >= 2 };
}
const initials = (n: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

export function Approvals() {
  const t = useT();
  const { may } = useAuth();
  const decider = may('approvals.decide');
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const [cat, setCat] = useState<Cat | ''>('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch<Paged<Approval>>('/approvals', { status: tab === 'PENDING' ? 'PENDING' : undefined, types: cat ? CATS[cat].types.join(',') : undefined, page, pageSize: 25 });
  const sum = useFetch<{ pending: Record<string, number>; total: number; amountTotal: string; oldestAt: string | null }>('/approvals/summary');
  const [sel, setSel] = useState<Approval | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const catCount = (c: Cat) => CATS[c].types.reduce((n, ty) => n + (sum.data?.pending[ty] ?? 0), 0);
  const old = sum.data?.oldestAt ? waited(sum.data.oldestAt) : null;

  return (
    <>
      <PageHead title={decider ? 'Idhini' : 'Maombi yangu'} sub={decider
        ? 'Maombi yanayosubiri uamuzi wako. Kila uamuzi unahifadhiwa na jina lako, muda na maelezo — hauwezi kubadilishwa baadaye.'
        : 'Maombi uliyotuma kwa Meneja na hali yake'} />
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      {sum.data && (
        <div className="apv-summary">
          <div className="apv-sum-main">
            <span className="apv-sum-n">{num(sum.data.total)}</span>
            <div><strong>{decider ? t('Maombi yanasubiri uamuzi wako') : t('Maombi yako yanasubiri Meneja')}</strong>
              <div className="muted">{Number(sum.data.amountTotal) > 0 ? <>{t('Thamani')}: <strong>{tsh(sum.data.amountTotal)}</strong></> : null}
                {old && sum.data.total > 0 ? <> · {t('la zamani zaidi limesubiri')} <strong className={old.late ? 'money-neg' : ''}>{old.text}</strong></> : null}</div></div>
          </div>
          <div className="apv-cats" role="tablist" aria-label={t('Makundi ya maombi')}>
            <button type="button" role="tab" aria-selected={cat === ''} className={cat === '' ? 'on' : ''} onClick={() => { setCat(''); setPage(1); }}><Svg d={ICON.all} /><span>{t('Yote')}</span>{sum.data.total > 0 && <b>{sum.data.total}</b>}</button>
            {(Object.keys(CATS) as Cat[]).map((c) => (
              <button key={c} type="button" role="tab" aria-selected={cat === c} className={`${cat === c ? 'on' : ''} cat-${c}`} onClick={() => { setCat(c); setPage(1); }}>
                <Svg d={CATS[c].icon} /><span>{t(CATS[c].label)}</span>{catCount(c) > 0 && <b>{catCount(c)}</b>}
              </button>
            ))}
          </div>
        </div>
      )}
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[['PENDING', 'Yanayosubiri'], ['ALL', 'Historia yote']]} />
      {loading && !data ? <Loading /> : data?.data.length === 0 ? <section className="card"><Empty>{tab === 'PENDING' ? 'Hakuna ombi linalosubiri. 👍' : 'Hakuna maombi bado.'}</Empty></section> : (
        <div className="apv-list">
          {data?.data.map((a) => {
            const c = catOf(a.type);
            const w = waited(a.createdAt);
            const pending = a.status === 'PENDING';
            return (
              <article key={a.id} className={`apv-card cat-${c}${pending && w.late ? ' late' : ''}`}>
                <div className="apv-icon"><Svg d={CATS[c].icon} /></div>
                <div className="apv-main">
                  <div className="apv-top">
                    <span className="apv-type">{a.typeLabel ?? APPROVAL_TYPE_LABEL[a.type]}</span>
                    <span className="apv-no">{a.requestNo}</span>
                    <Badge status={pending ? 'DRAFT' : a.status} label={STATUS[a.status]} />{isSelf(a) && <SelfBadge />}
                  </div>
                  <h3 className="apv-title">{a.title}</h3>
                  {a.reason && <p className="apv-reason">“{a.reason}”</p>}
                  <div className="apv-meta">
                    <span className="apv-who"><span className="apv-av">{initials(a.requestedBy)}</span>{a.requestedBy ?? '—'} <span className="muted">· {ROLE_LABEL[a.requestedRole] ?? a.requestedRole}</span></span>
                    <span className="muted">{dateTime(a.createdAt)}</span>
                    {pending ? <span className={w.late ? 'apv-wait late' : 'apv-wait'}>⏱ {w.text === 'sasa hivi' ? t('imetumwa sasa hivi') : `${t('inasubiri')} ${w.text}`}</span>
                      : a.decidedAt && <span className="muted">{STATUS[a.status]}: {a.decidedBy} · {dateTime(a.decidedAt)}</span>}
                  </div>
                </div>
                <div className="apv-side">
                  {a.amount && Number(a.amount) > 0 ? <div className="apv-amount">{tsh(a.amount)}</div> : <span />}
                  <Button size="sm" variant={pending && decider ? 'primary' : 'secondary'} onClick={() => setSel(a)}>{pending && decider ? t('Kagua na uamue') : t('Fungua')}</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />
      {sel && <DecideModal approval={sel} onClose={() => setSel(null)} onDone={(msg) => { setSel(null); setOk(msg); reload(); sum.reload(); }} />}
    </>
  );
}

const SELF_TAG = '[Imejiidhinisha — chama hakina Mhasibu/Storekeeper]';
const isSelf = (a: Approval) => a.status === 'APPROVED' && !!a.decisionNote?.startsWith(SELF_TAG);
function SelfBadge() { const t = useT(); return <span className="badge badge-warn" title={t('Meneja ameidhinisha ombi alilolianzisha mwenyewe (chama hakina Mhasibu/Storekeeper)')}>{t('Imejiidhinisha')}</span>; }

export function DecideModal({ approval: a, onClose, onDone }: { approval: Approval; onClose: () => void; onDone: (msg: string) => void }) {
  const t = useT();
  const { user, may } = useAuth();
  const [note, setNote] = useState('');
  const rp = a.type === 'STOCK_RECEIPT' ? (a.payload as { quantity: string; unitPrice: string; currentPrice: string | null; unitCost: string | null; unitPriceUsd?: string | null; unitCostUsd?: string | null; currentPriceUsd?: string | null; unit: string; itemName: string; source: string | null; reference: string; newItem: { name: string; category: string; unit: string } | null; prNo: string | null } | null) : null;
  const [qty, setQty] = useState(rp ? String(Number(rp.quantity)) : '');
  // Mzigo wa chama cha USD: bei ni ya dola (Meneja akibadilisha, anaandika dola)
  const rpUsd = !!rp?.unitPriceUsd;
  const basePrice = rp ? (rpUsd ? rp.unitPriceUsd! : rp.unitPrice) : '';
  const [price, setPrice] = useState(rp ? String(Number(basePrice)) : '');
  const pm = (v: string | number | null | undefined) => (rpUsd ? usd(v) : tsh(v ?? 0));
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const mine = a.requestedById === user?.id;
  // Chama chenye Meneja pekee: anaweza kujiidhinisha (nenosiri + maelezo ya angalau herufi 10), inaandikwa "Imejiidhinisha"
  const selfOk = mine && user?.role === 'AMCOS_ADMIN' && !!user?.covering?.length;
  const canDecide = a.status === 'PENDING' && may('approvals.decide') && (!mine || selfOk);
  const minNote = selfOk ? 10 : 3;
  const canCancel = a.status === 'PENDING' && mine;
  const link = entityLink(a);
  const act = async (decision: 'APPROVED' | 'REJECTED' | 'CANCEL') => {
    const r = await run(() => decision === 'CANCEL'
      ? api(`/approvals/${a.id}/cancel`, { method: 'POST', body: { note } })
      : api(`/approvals/${a.id}/decide`, { method: 'POST', body: { decision, note, ...(decision === 'APPROVED' ? { confirmPassword: pw, confirmCode: user?.totpEnabled ? code : undefined } : {}), ...(rp && decision === 'APPROVED' && (Number(qty) !== Number(rp.quantity) || Number(price) !== Number(basePrice)) ? { changes: { quantity: qty, unitPrice: price } } : {}) } }));
    if (!r) setPw('');
    if (r) onDone(decision === 'APPROVED' ? `${a.requestNo} imeidhinishwa` : decision === 'REJECTED' ? `${a.requestNo} imekataliwa` : `${a.requestNo} imeondolewa`);
  };
  const p = a.payload as { balanceAtRequest?: string; kind?: string; date?: string; lines?: { code: string; name: string; debit?: string; credit?: string; memo?: string | null }[]; totals?: { farmers: number; kg: string; grossTzs: string; deductions: string; netTzs: string; debit?: string; credit?: string; equity?: string; income?: string; expense?: string; surplus?: string }; farmers?: { memberNo: string; name: string; debt?: string | null; credit?: string | null }[]; lockedThrough?: string; closeDate?: string; openTransactions?: number; members?: { memberNo: string; name: string }[]; guarantees?: { groupName: string; debtorName: string; remaining: string; covered: string; uncovered: string }[]; groupCovered?: string } | null;
  return (
    <Modal open size="lg" title={`${a.requestNo} · ${a.typeLabel ?? APPROVAL_TYPE_LABEL[a.type]}`} onClose={onClose}
      head={<div className={`apv-mhead cat-${catOf(a.type)}`}><div className="apv-icon"><Svg d={CATS[catOf(a.type)].icon} /></div>
        <div><div className="apv-top"><span className="apv-type">{a.typeLabel ?? APPROVAL_TYPE_LABEL[a.type]}</span><span className="apv-no">{a.requestNo}</span><Badge status={a.status === 'PENDING' ? 'DRAFT' : a.status} label={STATUS[a.status]} /></div>
          <h2>{t(CATS[catOf(a.type)].label)}</h2></div></div>}
      footer={canDecide ? <>
        <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('REJECTED')}>{t('Kataa')}</Button>
        <Button busy={busy} disabled={note.trim().length < minNote || !pw || (!!user?.totpEnabled && code.length !== 6)} onClick={() => act('APPROVED')}>{selfOk ? t('Jiidhinishe') : t('Idhinisha')}</Button>
      </> : canCancel ? <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('CANCEL')}>{t('Ondoa ombi')}</Button> : <Button variant="secondary" onClick={onClose}>{t('Funga')}</Button>}>
      {/* 1. Kwa ufupi */}
      <div className="apv-hero">
        <div><div className="apv-label">{t('Ombi')}</div><p className="apv-hero-title">{a.title}</p></div>
        {a.amount && Number(a.amount) > 0 && <div className="apv-hero-amt"><div className="apv-label">{t('Kiasi')}</div><strong>{tsh(a.amount)}</strong></div>}
      </div>
      <div className="apv-facts">
        <div><span className="apv-label">{t('Aliyeomba')}</span><span className="apv-who"><span className="apv-av">{initials(a.requestedBy)}</span><span>{a.requestedBy}<div className="muted">{ROLE_LABEL[a.requestedRole] ?? a.requestedRole}</div></span></span></div>
        <div><span className="apv-label">{t('Lilitumwa')}</span><span>{dateTime(a.createdAt)}{a.status === 'PENDING' && <div className={waited(a.createdAt).late ? 'money-neg' : 'muted'}>{t('inasubiri')} {waited(a.createdAt).text}</div>}</span></div>
        {a.reason && <div className="wide"><span className="apv-label">{t('Sababu / maelezo ya aliyeomba')}</span><span>“{a.reason}”</span></div>}
        {p?.balanceAtRequest && <div><span className="apv-label">{t('Salio wakati wa ombi')}</span><span>{p.balanceAtRequest}</span></div>}
      </div>
      {a.decidedAt && <div className={`apv-decision ${a.status === 'APPROVED' ? 'ok' : 'bad'}`}><strong>{STATUS[a.status]}</strong> {t('na')} {a.decidedBy} · {dateTime(a.decidedAt)}{isSelf(a) && <> <SelfBadge /></>}
        <div>“{(a.decisionNote ?? '').replace(SELF_TAG, '').trim()}”</div></div>}
      {/* 2. Maelezo ya kina ya ombi hili */}
      <div className="apv-detail">
      {a.type === 'JOURNAL' && p?.lines && (
        <div className="table-wrap"><table className="table fin-table">
          <thead><tr><th>{t('Akaunti')}</th><th className="num">{t('Debit')}</th><th className="num">{t('Credit')}</th></tr></thead>
          <tbody>{p.lines.map((l, i) => <tr key={i}><td><strong>{l.code}</strong> {l.name}{l.memo ? <div className="muted" style={{ fontSize: 12 }}>{l.memo}</div> : null}</td><td className="num">{l.debit ? tsh(l.debit) : ''}</td><td className="num">{l.credit ? tsh(l.credit) : ''}</td></tr>)}</tbody>
        </table><p className="muted" style={{ margin: '6px 0 0' }}>Tarehe ya journal: {p.date}</p></div>
      )}
      {rp && (
        <>
          <dl className="dl">
            <dt>{t('Bidhaa')}</dt><dd>{rp.itemName}{rp.newItem && <> <span className="badge badge-warn">{t('Bidhaa mpya — itasajiliwa ukiidhinisha')}</span></>}</dd>
            {rp.source && <><dt>{t('Kutoka')}</dt><dd>{rp.source} · hati {rp.reference}</dd></>}
            <dt>{t('Bei ya sasa')}</dt><dd>{(rpUsd ? rp.currentPriceUsd : rp.currentPrice) ? pm(rpUsd ? rp.currentPriceUsd : rp.currentPrice) : 'Haijawekwa'}</dd>
            {(rpUsd ? rp.unitCostUsd : rp.unitCost) && <><dt>{t('Gharama ya chama')}</dt><dd>{pm(rpUsd ? rp.unitCostUsd : rp.unitCost)} kwa kipimo</dd></>}
          </dl>
          {canDecide && <div className="form-grid">
            <TextField label="Idadi iliyopokelewa *" type="number" min="0" value={qty} onChange={setQty} />
            <TextField label={rpUsd ? 'Bei ya kumkopesha mkulima (USD) *' : 'Bei ya kumkopesha mkulima (TSh) *'} type="number" min={rpUsd ? '0.01' : '1'} step={rpUsd ? '0.01' : '1'} value={price} onChange={setPrice} />
          </div>}
          {canDecide && <p className="muted" style={{ margin: 0 }}>{t('Thamani:')} <strong>{pm(Number(qty || 0) * Number(price || 0))}</strong>{t('. Ukibadilisha idadi au bei, mabadiliko yako ndiyo yatakayotumika na yatahifadhiwa kwenye kumbukumbu.')}</p>}
        </>
      )}
      {a.type === 'OPENING_BALANCE' && p?.totals && (
        <>
          <dl className="dl"><dt>{t('Tarehe')}</dt><dd>{p.date}</dd><dt>{t('Debit / Credit')}</dt><dd>{tsh(p.totals.debit)} / {tsh(p.totals.credit)}</dd><dt>{t('Wakulima')}</dt><dd>{p.farmers?.length ?? 0}</dd></dl>
          {(p.lines?.length || p.farmers?.length) ? (
            <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="table fin-table"><tbody>
              {p.lines?.map((l, i) => <tr key={'l' + i}><td><strong>{l.code}</strong> {l.name}</td><td className="num">{l.debit ? tsh(l.debit) : ''}</td><td className="num">{l.credit ? tsh(l.credit) : ''}</td></tr>)}
              {p.farmers?.map((f, i) => <tr key={'f' + i}><td>{f.name} <span className="muted">{f.memberNo}</span></td><td className="num">{f.debt ? `Deni ${tsh(f.debt)}` : ''}</td><td className="num">{f.credit ? `Anadai ${tsh(f.credit)}` : ''}</td></tr>)}
            </tbody></table></div>
          ) : null}
        </>
      )}
      {a.type === 'YEAR_END_CLOSE' && p?.totals && (
        <dl className="dl"><dt>{t('Hadi tarehe')}</dt><dd>{p.closeDate}</dd><dt>{t('Mapato')}</dt><dd>{tsh(p.totals.income)}</dd><dt>{t('Matumizi')}</dt><dd>{tsh(p.totals.expense)}</dd><dt>{t('Ziada → 3200')}</dt><dd><strong>{tsh(p.totals.surplus)}</strong></dd></dl>
      )}
      {(a.type === 'PERIOD_CLOSE' || a.type === 'YEAR_END_CLOSE') && <Alert kind="warn">Ukiidhinisha, vitabu vitafungwa hadi {p?.lockedThrough ?? p?.closeDate}: hakuna muamala wala journal wa tarehe hiyo au kabla yake utakaoruhusiwa. Haitenguliwi.{p?.openTransactions ? ` Miamala ${p.openTransactions} ya kipindi hicho bado haijakamilika.` : ''}</Alert>}
      {a.type === 'MEMBER_REGISTRATION' && (a.payload as { nameOverride?: { name: string; phoneOwnerName: string | null; phone: string | null; reason: string } } | null)?.nameOverride && (() => { const n = (a.payload as { nameOverride: { name: string; phoneOwnerName: string | null; phone: string | null; reason: string } }).nameOverride; return (
        <Alert kind="warn">{t('Jina la mkulima')} <b>{n.name}</b> ni tofauti na mwenye namba {n.phone ? phone(n.phone) : ''} {n.phoneOwnerName ? <>(<b>{n.phoneOwnerName}</b>)</> : '(haijasajiliwa kwenye mobile money)'}. Sababu: {n.reason}. Ukiidhinisha usajili, unaidhinisha pia jina hili.</Alert>
      ); })()}
      {a.type === 'INPUT_ISSUE' && (() => { const es = (a.payload as { estimate?: { over: { name: string; estimated: string; issuedBefore: string; thisIssue: string; over: string }[]; note: string | null } } | null)?.estimate; if (!es) return null; return (<>
        {es.over.length > 0 && <Alert kind="warn"><strong>{t('Zaidi ya makisio')}:</strong> {es.over.map((o) => `${o.name}: ${t('makisio')} ${num(o.estimated)}, ${t('amepata')} ${num(o.issuedBefore)}, ${t('sasa')} ${num(o.thisIssue)} → ${t('zaidi')} ${num(o.over)}`).join(' · ')}</Alert>}
        {es.note && <Alert kind="warn">{t(es.note)}</Alert>}
      </>); })()}
      {a.type === 'KUNI_BATCH' && a.payload && (() => { const k = a.payload as { loanType?: 'KUNI' | 'GRADING' | 'TREES'; totalTrees?: number | null; treesPerArea?: number | null; areaUnit?: string; costPerTreeUsd?: string | null; farmers: number; total: string; interest: string; rate: string; amountPerAcre?: string; totalUsd?: string; interestUsd?: string; fxRate?: string; amountPerAcreUsd?: string }; return (
        k.totalUsd
          ? <dl className="dl"><dt>{t('Mkopo')}</dt><dd><strong>{t(k.loanType === 'GRADING' ? 'Mkopo wa grading' : k.loanType === 'TREES' ? 'Mkopo wa miti' : 'Mkopo wa kuni')}</strong></dd><dt>{t('Wakulima')}</dt><dd>{k.farmers}</dd>
            <dt>{t('Kiasi')}</dt><dd><strong>{usd(k.totalUsd)}</strong> <span className="muted">({tsh(k.total)})</span></dd><dt>Riba ({Number(k.rate)}%)</dt><dd>{usd(k.interestUsd)}</dd>
            {k.loanType === 'TREES'
              ? <><dt>{t('Miti')}</dt><dd>{Number(k.totalTrees ?? 0).toLocaleString('en-US')} × {usd(k.costPerTreeUsd, 2)}</dd><dt>{t('Miti kwa eneo')}</dt><dd>{k.treesPerArea} / {k.areaUnit === 'ACRE' ? t('ekari') : t('hekta')}</dd></>
              : <><dt>{t('Kikomo kwa ekari')}</dt><dd>{usd(k.amountPerAcreUsd)}</dd></>}<dt>{t('Kiwango cha dola')}</dt><dd>1 USD = TSh {Number(k.fxRate).toLocaleString('en-US')}</dd></dl>
          : <dl className="dl"><dt>{t('Wakulima')}</dt><dd>{k.farmers}</dd><dt>{t('Pesa ya kuni')}</dt><dd><strong>{tsh(k.total)}</strong></dd><dt>Riba ({Number(k.rate)}%)</dt><dd>{tsh(k.interest)}</dd><dt>{t('Kikomo kwa ekari')}</dt><dd>{tsh(k.amountPerAcre ?? 0)}</dd></dl>
      ); })()}
      {a.type === 'KUNI_BATCH' && <Alert kind="warn">{t('Ukiidhinisha, Mhasibu atatuma pesa kwenye akaunti za wakulima. Mkopo na riba vinaingia kwenye deni la dola la mkulima na kukatwa kwenye mauzo ya tumbaku pamoja na deni la pembejeo.')}</Alert>}
      {a.type === 'GROUP_REGISTRATION' && p?.members && (
        <div className="table-wrap"><table className="table"><tbody>{p.members.map((m) => <tr key={m.memberNo}><td>{m.name}</td><td className="muted">{m.memberNo}</td></tr>)}</tbody></table></div>
      )}
      {a.type === 'TOBACCO_SALE' && !!p?.guarantees?.length && (
        <Alert kind="warn">Dhamana ya kikundi: {p.guarantees.map((g) => `${g.debtorName} (${g.groupName}) — wenzake wanalipa ${tsh(g.covered)}${Number(g.uncovered) > 0 ? `, bado ${tsh(g.uncovered)}` : ''}`).join('; ')}</Alert>
      )}
      {a.type === 'TOBACCO_SALE' && p?.totals && (
        <dl className="dl"><dt>{t('Wakulima')}</dt><dd>{p.totals.farmers} · kilo {Number(p.totals.kg).toLocaleString('en-US')}</dd><dt>{t('Mauzo')}</dt><dd>{tsh(p.totals.grossTzs)}</dd><dt>{t('Makato')}</dt><dd>{tsh(p.totals.deductions)}</dd><dt>{t('Malipo halisi')}</dt><dd><strong>{tsh(p.totals.netTzs)}</strong></dd></dl>
      )}
      {link && <p style={{ margin: 0 }}><Link to={link} onClick={onClose}>{t('Fungua rekodi inayohusika →')}</Link></p>}
      </div>
      {mine && !selfOk && a.status === 'PENDING' && may('approvals.decide') && <Alert kind="warn">{t('Huwezi kuidhinisha ombi ulilolianzisha mwenyewe.')}</Alert>}
      {selfOk && a.status === 'PENDING' && <Alert kind="warn">{t('Ombi hili umeliandaa wewe. Kwa kuwa chama hakina Mhasibu/Storekeeper, unaweza kujiidhinisha — idhini itaandikwa "Imejiidhinisha" na itaonekana kwa CoopLink na Chama Kikuu. Eleza kwa nini ombi ni sahihi.')}</Alert>}
      <Alert>{error}</Alert>
      {/* 3. Uamuzi */}
      {canDecide && EFFECT[a.type] && <div className="apv-effect"><span className="apv-label">{t('Ukiidhinisha')}</span>{t(EFFECT[a.type])}</div>}
      {(canDecide || canCancel) && <div className="apv-decide-title">{canDecide ? t('Uamuzi wako') : t('Kuondoa ombi')}</div>}
      {(canDecide || canCancel) && <TextField label={canDecide ? 'Maelezo ya uamuzi *' : 'Sababu ya kuondoa *'} placeholder={canDecide ? 'mf. Nimekagua risiti, gharama ni sahihi' : ''} value={note} onChange={setNote} />}
      {canDecide && (
        <div className="reauth-box">
          <div className="form-grid">
            <TextField label="Nenosiri lako (la kuingia) *" type="password" autoComplete="current-password" value={pw} onChange={setPw}
              help="Linahitajika kuidhinisha — kuthibitisha kuwa ni wewe, si mtu aliyekuta mfumo wazi" />
            {user?.totpEnabled && <TextField label="Msimbo wa 2FA *" inputMode="numeric" maxLength={6} value={code} onChange={(v) => setCode(v.replace(/\D/g, ''))} />}
          </div>
        </div>
      )}
    </Modal>
  );
}
