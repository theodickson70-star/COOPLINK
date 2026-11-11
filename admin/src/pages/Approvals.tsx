import { useState } from 'react';
import { usd } from '../lib/fx';
import { useT } from '../lib/prefs';
import { Link } from 'react-router-dom';
import { api, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { APPROVAL_TYPE_LABEL, dateTime, phone, ROLE_LABEL, tsh } from '../lib/format';
import { Alert, Badge, Button, Empty, Loading, Modal, PageHead, Pager, Select, TextField } from '../components/ui';
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

export function Approvals() {
  const t = useT();
  const { may } = useAuth();
  const decider = may('approvals.decide');
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch<Paged<Approval>>('/approvals', { status: tab === 'PENDING' ? 'PENDING' : undefined, type: type || undefined, page, pageSize: 25 });
  const [sel, setSel] = useState<Approval | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <>
      <PageHead title={decider ? 'Idhini' : 'Maombi yangu'} sub={decider
        ? 'Maombi yanayosubiri uamuzi wako. Kila uamuzi unahifadhiwa na jina lako, muda na maelezo — hauwezi kubadilishwa baadaye.'
        : 'Maombi uliyotuma kwa Meneja na hali yake'} />
      <Alert kind="ok">{ok}</Alert>
      <Alert>{error}</Alert>
      <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }} items={[['PENDING', 'Yanayosubiri'], ['ALL', 'Historia yote']]} />
      <section className="card">
        <div className="toolbar">
          <Select aria-label="Aina ya ombi" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">{t('Aina zote')}</option>
            {Object.entries(APPROVAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {loading && !data ? <Loading /> : data?.data.length === 0 ? <Empty>{tab === 'PENDING' ? 'Hakuna ombi linalosubiri. 👍' : 'Hakuna maombi bado.'}</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('Ombi')}</th><th>{t('Maelezo')}</th><th className="num">{t('Kiasi')}</th><th>{t('Aliyeomba')}</th><th>{t('Hali')}</th><th /></tr></thead>
            <tbody>{data?.data.map((a) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{a.requestNo}</strong><div className="muted" style={{ fontSize: 12 }}>{a.typeLabel}</div></td>
                <td style={{ minWidth: 240 }}>{a.title}{a.reason && <div className="muted" style={{ fontSize: 13 }}>Sababu: {a.reason}</div>}</td>
                <td className="num">{a.amount ? tsh(a.amount) : '—'}</td>
                <td>{a.requestedBy ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{ROLE_LABEL[a.requestedRole] ?? a.requestedRole} · {dateTime(a.createdAt)}</div></td>
                <td><Badge status={a.status === 'PENDING' ? 'DRAFT' : a.status} label={STATUS[a.status]} />{isSelf(a) && <> <SelfBadge /></>}
                  {a.decidedAt && <div className="muted" style={{ fontSize: 12 }}>{a.decidedBy} · {dateTime(a.decidedAt)}</div>}</td>
                <td className="num"><Button size="sm" variant={a.status === 'PENDING' && decider ? 'primary' : 'secondary'} onClick={() => setSel(a)}>{a.status === 'PENDING' && decider ? 'Amua' : 'Fungua'}</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <Pager meta={data?.meta} onPage={setPage} />
      </section>
      {sel && <DecideModal approval={sel} onClose={() => setSel(null)} onDone={(msg) => { setSel(null); setOk(msg); reload(); }} />}
    </>
  );
}

const SELF_TAG = '[Imejiidhinisha — chama hakina Mhasibu/Stokipa]';
const isSelf = (a: Approval) => a.status === 'APPROVED' && !!a.decisionNote?.startsWith(SELF_TAG);
function SelfBadge() { const t = useT(); return <span className="badge badge-warn" title={t('Meneja ameidhinisha ombi alilolianzisha mwenyewe (chama hakina Mhasibu/Stokipa)')}>{t('Imejiidhinisha')}</span>; }

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
    <Modal open title={`${a.requestNo} · ${a.typeLabel ?? APPROVAL_TYPE_LABEL[a.type]}`} onClose={onClose}
      footer={canDecide ? <>
        <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('REJECTED')}>{t('Kataa')}</Button>
        <Button busy={busy} disabled={note.trim().length < minNote || !pw || (!!user?.totpEnabled && code.length !== 6)} onClick={() => act('APPROVED')}>{selfOk ? t('Jiidhinishe') : t('Idhinisha')}</Button>
      </> : canCancel ? <Button variant="danger" busy={busy} disabled={note.trim().length < 3} onClick={() => act('CANCEL')}>{t('Ondoa ombi')}</Button> : <Button variant="secondary" onClick={onClose}>{t('Funga')}</Button>}>
      <dl className="dl">
        <dt>{t('Ombi')}</dt><dd>{a.title}</dd>
        {a.amount && <><dt>{t('Kiasi')}</dt><dd><strong>{tsh(a.amount)}</strong></dd></>}
        {a.reason && <><dt>{t('Sababu')}</dt><dd>{a.reason}</dd></>}
        {p?.balanceAtRequest && <><dt>{t('Salio wakati wa ombi')}</dt><dd>{p.balanceAtRequest}</dd></>}
        <dt>{t('Aliyeomba')}</dt><dd>{a.requestedBy} ({ROLE_LABEL[a.requestedRole] ?? a.requestedRole}) · {dateTime(a.createdAt)}</dd>
        {a.decidedAt && <><dt>{t('Uamuzi')}</dt><dd>{STATUS[a.status]} na {a.decidedBy} · {dateTime(a.decidedAt)}{isSelf(a) && <> <SelfBadge /></>}<div className="muted">"{(a.decisionNote ?? '').replace(SELF_TAG, '').trim()}"</div></dd></>}
      </dl>
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
      {a.type === 'KUNI_BATCH' && a.payload && (() => { const k = a.payload as { farmers: number; total: string; interest: string; rate: string; amountPerAcre: string }; return (
        <dl className="dl"><dt>{t('Wakulima')}</dt><dd>{k.farmers}</dd><dt>{t('Pesa ya kuni')}</dt><dd><strong>{tsh(k.total)}</strong></dd><dt>Riba ({Number(k.rate)}%)</dt><dd>{tsh(k.interest)}</dd><dt>{t('Kikomo kwa ekari')}</dt><dd>{tsh(k.amountPerAcre)}</dd></dl>
      ); })()}
      {a.type === 'KUNI_BATCH' && <Alert kind="warn">{t('Ukiidhinisha, Mhasibu atatuma pesa kwenye akaunti za wakulima. Mkopo na riba vitakatwa kwenye mauzo ya tumbaku pamoja na deni la pembejeo.')}</Alert>}
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
      {mine && !selfOk && a.status === 'PENDING' && may('approvals.decide') && <Alert kind="warn">{t('Huwezi kuidhinisha ombi ulilolianzisha mwenyewe.')}</Alert>}
      {selfOk && a.status === 'PENDING' && <Alert kind="warn">{t('Ombi hili umeliandaa wewe. Kwa kuwa chama hakina Mhasibu/Stokipa, unaweza kujiidhinisha — idhini itaandikwa "Imejiidhinisha" na itaonekana kwa CoopLink na Chama Kikuu. Eleza kwa nini ombi ni sahihi.')}</Alert>}
      <Alert>{error}</Alert>
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
