// =====================================================================
//  HATI RASMI ZA FEDHA (v0.42): STAKABADHI YA FEDHA na HATI YA MALIPO
//   - namba kwa mfululizo (R-… / PV-…), mistari mingi na MGAO, kiasi kwa maneno
//   - mnyororo wa idhini (aliyeandaa / aliyeidhinisha / aliyekamilisha) na nafasi za saini
//   - ASILI kwa chapisho la kwanza, NAKALA kwa yanayofuata (yanarekodiwa)
//   - QR ya kuhakiki hati bila kuingia kwenye mfumo · A4 au A5 (nusu ukurasa, kama kitabu)
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import qrcode from 'qrcode-generator';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { date, dateTime } from '../lib/format';
import { amountInWords } from '../lib/words';
import { Alert, Button, Loading, TextField } from '../components/ui';
import { Section } from '../components/owner-ui';
import { DocFoot, DocHead, docOrgLines } from './acc-common';
import { Icon, type IconName } from '../components/icons';
import { LogoMark } from '../components/Logo';
import { RECEIPT_THEMES, type ReceiptTheme } from '../lib/receipt-themes';

/** QR kama SVG (hakuna maktaba ya nje inayohitaji mtandao) */
export function QrCode({ value, size = 96, label }: { value: string; size?: number; label?: string }) {
  const { path, n } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value);
    q.make();
    const c = q.getModuleCount();
    let d = '';
    for (let r = 0; r < c; r++) for (let col = 0; col < c; col++) if (q.isDark(r, col)) d += `M${col + 2} ${r + 2}h1v1h-1z`;
    return { path: d, n: c + 4 };
  }, [value]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label ?? 'QR'} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" /><path d={path} fill="#000" />
    </svg>
  );
}

interface DocData {
  kind: 'RECEIPT' | 'PAYMENT_VOUCHER'; title: string; titleEn: string;
  amcos: { name: string; code: string; regNumber: string | null; region: string | null; district: string | null; ward: string | null; village: string | null; phone: string | null; email: string | null };
  transaction: {
    id: string; txnNo: string; docNo: string; bookRef: string | null; kind: string; txnDate: string; amount: string; amountUsd: string | null; fxRate: string | null; description: string;
    payee: string | null; reference: string | null; status: string; categoryLabel: string; accountName: string | null; accountKind: string | null; bankName: string | null; accountNumber: string | null;
    createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null; memberName: string | null; contraAccount: string | null; reversedBy: string | null;
  };
  lines: { no: number; description: string; amount: string; account: string | null; costCenter: string | null }[];
  allocation: { account: string; costCenter: string | null; amount: string }[];
  approval: { requestNo: string; status: string; decidedBy: string | null; decidedAt: string | null; note: string | null } | null;
  prints: { copyNo: number; printedAt: string; by: string | null }[];
  verifyToken: string;
}

const STATUS_STAMP: Record<string, { text: string; tone: string }> = {
  PENDING_APPROVAL: { text: 'RASIMU · INASUBIRI IDHINI', tone: 'warn' },
  APPROVED: { text: 'IMEIDHINISHWA · HAIJALIPWA', tone: 'info' },
  REJECTED: { text: 'IMEKATALIWA', tone: 'bad' },
  CANCELLED: { text: 'IMEFUTWA', tone: 'bad' },
};
const PAGE_KEY = 'cl:doc-page';
/** Hati rasmi zinaonyesha senti (kama safu ya CTS kwenye vitabu vya karatasi) */
const amt = (v: string | number) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FinanceDocument() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, reload } = useFetch<DocData>(`/bank/voucher/${id}`);
  const [size, setSize] = useState<'A4' | 'A5'>(() => { try { return localStorage.getItem(PAGE_KEY) === 'A5' ? 'A5' : 'A4'; } catch { return 'A4'; } });
  const [copy, setCopy] = useState<number | null>(null);
  const act = useAction();
  const { amcos: myAmcos, refresh } = useAuth();
  const savedTheme = (myAmcos?.docTheme ?? 'KIJANI') as ReceiptTheme;
  const [theme, setTheme] = useState<ReceiptTheme | null>(null); // null = muundo wa chama
  const shownTheme = theme ?? savedTheme;
  const canTheme = !!user && ['AMCOS_ADMIN', 'ACCOUNTANT'].includes(user.role);
  useEffect(() => { try { localStorage.setItem(PAGE_KEY, size); } catch { /* */ } }, [size]);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const t = data.transaction;
  const receipt = data.kind === 'RECEIPT';
  const stamp = t.reversedBy ? { text: `IMESAHIHISHWA · ${t.reversedBy}`, tone: 'bad' } : STATUS_STAMP[t.status];
  const nextCopy = data.prints.length;
  const shownCopy = copy ?? (nextCopy === 0 ? 0 : nextCopy);
  const copyLabel = stamp && !['APPROVED'].includes(t.status) ? null : shownCopy === 0 ? 'ASILI · ORIGINAL' : `NAKALA ${shownCopy} · COPY`;
  const verifyUrl = `${window.location.origin}/verify/${data.verifyToken}`;
  const party = t.payee ?? t.memberName ?? '—';
  const via = [t.accountName, t.accountNumber ? `${t.bankName ?? ''} ${t.accountNumber}`.trim() : null].filter(Boolean).join(' · ');

  const print = async () => {
    const r = await act.run(() => api<{ copyNo: number | null }>(`/bank/voucher/${t.id}/print`, { method: 'POST' }));
    if (r && r.copyNo !== null) setCopy(r.copyNo);
    // Subiri lebo ya ASILI/NAKALA ionekane kabla ya kuchapisha
    window.setTimeout(() => { window.print(); reload(); }, 80);
  };

  return (
    <>
      <style>{`@page { size: ${size}; margin: ${size === 'A5' ? '7mm' : '12mm'}; }`}</style>
      <div className="actions no-print doc-toolbar">
        <Link to={`/finance?txn=${t.id}`}>← Rudi kwenye muamala</Link>
        <div className="actions">
          {receipt && (
            <div className="seg rc-theme-pick" role="group" aria-label="Muundo wa risiti">
              {RECEIPT_THEMES.map((x) => <button key={x.key} type="button" className={shownTheme === x.key ? 'on' : ''} title={x.desc} onClick={() => setTheme(x.key)}>{x.label}</button>)}
            </div>
          )}
          {receipt && canTheme && theme && theme !== savedTheme && (
            <Button variant="secondary" busy={act.busy} onClick={async () => { if (await act.run(() => api('/settings/docs', { method: 'PUT', body: { theme } }))) { await refresh().catch(() => undefined); setTheme(null); } }}>Weka kama muundo wa chama</Button>
          )}
          <div className="seg" role="group" aria-label="Ukubwa wa karatasi">
            {(['A4', 'A5'] as const).map((s) => <button key={s} type="button" className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s}{s === 'A5' ? ' (nusu)' : ''}</button>)}
          </div>
          <Button onClick={print} busy={act.busy}>{nextCopy === 0 ? 'Chapisha asili / PDF' : `Chapisha nakala ${nextCopy}`}</Button>
        </div>
      </div>
      <Alert>{act.error}</Alert>
      {stamp && <Alert kind={stamp.tone === 'bad' ? 'error' : 'warn'} >{stamp.tone === 'bad' ? 'Hati hii si halali kwa malipo.' : t.status === 'PENDING_APPROVAL' ? 'Hii ni rasimu — inasubiri idhini ya Meneja.' : 'Imeidhinishwa — chapisha kwa saini, kisha ukamilishe fedha zikitoka.'} ({stamp.text})</Alert>}

      {receipt ? <ModernReceipt theme={shownTheme} data={data} size={size} stamp={stamp} copyLabel={copyLabel} isCopy={!!shownCopy} verifyUrl={verifyUrl} party={party} printedBy={user?.fullName ?? null} /> : (
      <article className={`card card-pad print-doc fdoc ${size === 'A5' ? 'fdoc-a5' : ''} ${receipt ? 'fdoc-receipt' : 'fdoc-voucher'}`}>
        {stamp && <div className={`fdoc-stamp tone-${stamp.tone}`} aria-hidden="true">{stamp.text}</div>}
        <DocHead title={data.title} org={data.amcos} no={<span className="fdoc-no">Na. {t.docNo}</span>}
          sub={<><span className="fdoc-en">{data.titleEn}</span><br />Tarehe: <b>{date(t.txnDate)}</b></>} />

        <div className="fdoc-party">
          <div className="fdoc-field"><span>{receipt ? 'Tumepokea kutoka kwa' : 'Lipa kwa'}</span><b>{party}</b></div>
          <div className="fdoc-amount"><span>Kiasi (TZS)</span><b>{amt(t.amount)}</b>{t.amountUsd && <em>USD {Number(t.amountUsd).toLocaleString('en-US', { minimumFractionDigits: 2 })} @ {t.fxRate}</em>}</div>
          <div className="fdoc-field wide"><span>Kiasi kwa maneno</span><b className="fdoc-words">{amountInWords(t.amount)}</b></div>
          <div className="fdoc-field wide"><span>{receipt ? 'Ikiwa ni malipo kwa ajili ya' : 'Madhumuni ya malipo'}</span><b>{t.description}</b></div>
          <div className="fdoc-field"><span>{receipt ? 'Imepokelewa kwenye' : 'Imelipwa kutoka'}</span><b>{via || '—'}</b></div>
          <div className="fdoc-field"><span>{receipt ? 'Kumbukumbu (slip / M-Pesa)' : 'Cheki / kumbukumbu'}</span><b>{t.reference ?? '—'}</b></div>
        </div>

        <table className="fdoc-table">
          <thead><tr><th className="sn">S/Na</th><th>Maelezo</th>{!receipt && <th>Akaunti</th>}<th className="num">TZS</th></tr></thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.no}><td className="sn">{l.no}</td><td>{l.description}{l.costCenter && <span className="fdoc-cc"> · {l.costCenter}</span>}</td>{!receipt && <td className="fdoc-acc">{l.account ?? '—'}</td>}<td className="num">{amt(l.amount)}</td></tr>
            ))}
            {Array.from({ length: Math.max(0, (size === 'A5' ? 2 : 4) - data.lines.length) }).map((_, i) => <tr key={`e${i}`} className="empty"><td className="sn" /><td />{!receipt && <td />}<td /></tr>)}
          </tbody>
          <tfoot><tr><td className="fdoc-blank" />{!receipt && <td className="fdoc-blank" />}<td className="fdoc-total-l">JUMLA</td><td className="num fdoc-total">{amt(t.amount)}</td></tr></tfoot>
        </table>

        {!receipt && (
          <table className="fdoc-table fdoc-alloc">
            <caption>MGAO (Allocation)</caption>
            <thead><tr><th>Akaunti ya matumizi</th><th>Kituo cha gharama</th><th className="num">TZS</th></tr></thead>
            <tbody>{data.allocation.map((a) => <tr key={`${a.account}${a.costCenter}`}><td>{a.account}</td><td>{a.costCenter ?? '—'}</td><td className="num">{amt(a.amount)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2} className="fdoc-total-l">JUMLA</td><td className="num fdoc-total">{amt(t.amount)}</td></tr></tfoot>
          </table>
        )}

        <div className="fdoc-sign">
          {receipt ? <>
            <Sign role="Imepokelewa na (Mhasibu / Meneja)" name={t.createdBy} when={t.createdAt} />
            <Sign role="Saini ya Mlipaji" name={party !== '—' ? party : null} />
          </> : <>
            <Sign role="Imeandaliwa na" name={t.createdBy} when={t.createdAt} />
            <Sign role="Imeidhinishwa na" name={data.approval?.status === 'APPROVED' ? data.approval.decidedBy : null} when={data.approval?.status === 'APPROVED' ? data.approval.decidedAt : null} extra={data.approval?.requestNo} />
            <Sign role="Imepokelewa na (Mpokeaji)" name={null} extra="Jina, saini na tarehe" />
          </>}
        </div>

        <div className="fdoc-foot">
          <QrCode value={verifyUrl} size={size === 'A5' ? 64 : 84} label="QR ya kuhakiki hati" />
          <div className="fdoc-foot-text">
            <b>Hakiki hati hii:</b> piga picha ya QR au fungua <span className="fdoc-url">{verifyUrl}</span>
            <div>Kumbukumbu ya mfumo: {t.txnNo}{t.bookRef ? ` · Kitabu Na. ${t.bookRef}` : ''}{t.postedBy ? ` · Imekamilishwa na ${t.postedBy} ${dateTime(t.postedAt!)}` : ''}</div>
            <div>Imechapishwa {dateTime(new Date().toISOString())} na {user?.fullName ?? '—'} · CoopLink</div>
          </div>
          {copyLabel && <div className={`fdoc-copy ${shownCopy ? 'is-copy' : ''}`}>{copyLabel}</div>}
        </div>
        <DocFoot />
      </article>
      )}

      {data.prints.length > 0 && (
        <div className="no-print"><Section title="Historia ya kuchapisha">
          <ul className="fdoc-prints">{data.prints.map((p) => <li key={p.copyNo}><b>{p.copyNo === 0 ? 'Asili' : `Nakala ${p.copyNo}`}</b> · {p.by ?? '—'} · {dateTime(p.printedAt)}</li>)}</ul>
        </Section></div>
      )}
    </>
  );
}

// ------------------------------ STAKABADHI YA KISASA (v2.6) ------------------------------
//  Muundo: kichwa cha kijani chenye nembo · kiasi kikubwa + "Imepokelewa ✓" · taarifa kwa vigae ·
//  mistari ya malipo · mstari wa kuchana (perforation) · kipande cha kuhakiki (QR, ASILI/NAKALA, saini).
//  Rangi zinachapishwa (print-color-adjust) na bado zinasomeka kwenye printa ya rangi moja.
const ACC_ICON: Record<string, IconName> = { BANK: 'bank', MOBILE_MONEY: 'phone', MOBILE: 'phone', CASH: 'money' };
function ModernReceipt({ theme = 'KIJANI', data, size, stamp, copyLabel, isCopy, verifyUrl, party, printedBy }: {
  theme?: ReceiptTheme; data: DocData; size: 'A4' | 'A5'; stamp?: { text: string; tone: string }; copyLabel: string | null; isCopy: boolean; verifyUrl: string; party: string; printedBy: string | null;
}) {
  const auth = useAuth();
  const t = data.transaction;
  const org = { ...(auth.amcos && auth.amcos.code === data.amcos.code ? auth.amcos : {}), ...data.amcos } as Parameters<typeof docOrgLines>[0] & { logo?: string | null };
  const lines = docOrgLines(org);
  const [whole, cents] = amt(t.amount).split('.');
  const ok = !stamp && t.status === 'POSTED';
  const viaName = t.accountName ?? '—';
  const viaSub = t.accountNumber ? `${t.bankName ?? ''} ${t.accountNumber}`.trim() : null;
  return (
    <article className={`card print-doc rc rc-theme-${theme.toLowerCase()} ${size === 'A5' ? 'rc-a5' : ''}`}>
      <div className="rc-leaves" aria-hidden="true" />
      {stamp && <div className={`fdoc-stamp tone-${stamp.tone}`} aria-hidden="true">{stamp.text}</div>}
      {theme === 'RASMI' && <div className="rc-wm" aria-hidden="true">{Array.from({ length: 14 }).map((_, i) => <span key={i}>{`${org.name} · STAKABADHI HALALI · ${t.docNo} · `.repeat(4)}</span>)}</div>}
      <header className="rc-head">
        <div className="rc-org">
          {org.logo ? <img src={org.logo} alt="" className="rc-logo" /> : <span className="rc-logo rc-logo-mark"><LogoMark size={size === 'A5' ? 34 : 44} ring={false} /></span>}
          <div>
            <b>{org.name}</b>
            {lines.map((l) => <small key={l}>{l}</small>)}
          </div>
        </div>
        <div className="rc-title">
          <span className="rc-kicker">{data.title}</span>
          <span className="rc-en">{data.titleEn}</span>
          <span className="rc-no">Na. {t.docNo}</span>
        </div>
      </header>

      <section className="rc-hero">
        <div className="rc-hero-l">
          <span className="rc-lbl">Tumepokea kutoka kwa</span>
          <b className="rc-party">{party}</b>
          <span className="rc-lbl">Kwa ajili ya</span>
          <span className="rc-purpose">{t.description}</span>
        </div>
        <div className="rc-amount">
          <span className={`rc-status ${ok ? 'ok' : 'wait'}`}>{ok ? <><Icon name="check" />Imepokelewa</> : stamp ? stamp.text : 'Inasubiri kukamilishwa'}</span>
          <div className="rc-big"><small>TSh</small>{whole}<sup>.{cents}</sup></div>
          {t.amountUsd && <span className="rc-usd">USD {Number(t.amountUsd).toLocaleString('en-US', { minimumFractionDigits: 2 })} @ {t.fxRate}</span>}
        </div>
      </section>
      <div className="rc-words"><Icon name="book" /><span><em>Kwa maneno:</em> {amountInWords(t.amount)}</span></div>

      <section className="rc-tiles">
        <div><span className="rc-lbl"><Icon name="history" />Tarehe</span><b>{date(t.txnDate)}</b></div>
        <div><span className="rc-lbl"><Icon name={ACC_ICON[t.accountKind ?? ''] ?? 'money'} />Imepokelewa kwenye</span><b>{viaName}</b>{viaSub && <small>{viaSub}</small>}</div>
        <div><span className="rc-lbl"><Icon name="receipt" />Kumbukumbu</span><b>{t.reference ?? '—'}</b><small>Slip / M-Pesa</small></div>
      </section>

      <table className="rc-items">
        <thead><tr><th className="sn">#</th><th>Maelezo</th><th className="num">Kiasi (TZS)</th></tr></thead>
        <tbody>{data.lines.map((l) => (
          <tr key={l.no}><td className="sn">{String(l.no).padStart(2, '0')}</td><td>{l.description}{l.costCenter && <small> · {l.costCenter}</small>}</td><td className="num">{amt(l.amount)}</td></tr>
        ))}</tbody>
        <tfoot><tr><td /><td className="rc-total-l">Jumla iliyopokelewa</td><td className="num rc-total">{amt(t.amount)}</td></tr></tfoot>
      </table>

      <div className="rc-sign">
        {theme === 'RASMI' && ok && <div className="rc-seal" aria-hidden="true"><span>IMEPOKELEWA</span><b>{date(t.txnDate)}</b><span>{org.code ?? ''}</span></div>}
        <div><span className="fdoc-line" /><b>Imepokelewa na (Mhasibu / Meneja)</b><small>{t.createdBy ?? ' '}{t.createdAt ? ` · ${date(t.createdAt)}` : ''}</small></div>
        <div><span className="fdoc-line" /><b>Saini ya mlipaji</b><small>{party !== '—' ? party : ' '}</small></div>
      </div>

      <div className="rc-perf" aria-hidden="true"><span /></div>

      <footer className="rc-stub">
        <div className="rc-qr"><QrCode value={verifyUrl} size={size === 'A5' ? 62 : 78} label="QR ya kuhakiki stakabadhi" /></div>
        <div className="rc-stub-t">
          <b><Icon name="shield" />Hakiki stakabadhi hii</b>
          <span>Piga picha ya QR kwa simu — utaona kiasi, tarehe na hali yake halisi kwenye mfumo.</span>
          <span className="fdoc-url">{verifyUrl}</span>
          <small>Kumbukumbu: {t.txnNo}{t.bookRef ? ` · Kitabu Na. ${t.bookRef}` : ''}{t.postedBy ? ` · Imekamilishwa na ${t.postedBy} ${dateTime(t.postedAt!)}` : ''}</small>
          <small>Imechapishwa {dateTime(new Date().toISOString())}{printedBy ? ` na ${printedBy}` : ''}</small>
        </div>
        {copyLabel && <div className={`rc-copy ${isCopy ? 'is-copy' : ''}`}>{copyLabel}</div>}
      </footer>
      <div className="rc-brand"><DocFoot /><span>Imetolewa kupitia <b>CoopLink</b> · Connecting Cooperatives. Empowering Farmers.</span></div>
    </article>
  );
}

function Sign({ role, name, when, extra }: { role: string; name: string | null; when?: string | null; extra?: string | null }) {
  return (
    <div className="fdoc-signbox">
      <span className="fdoc-line" />
      <b>{role}</b>
      <span>{name ?? ' '}{when ? ` · ${date(when)}` : ''}</span>
      {extra && <span className="muted">{extra}</span>}
    </div>
  );
}

// ------------------------------ UKURASA WA UMMA: KUHAKIKI HATI ------------------------------
interface Verify { valid: boolean; title: string; docNo: string; date: string; amount: string; amountUsd: string | null; status: string; reversedBy: string | null; amcos: string; regNumber: string | null; party: string | null; issuedAt: string }
export function VerifyDoc() {
  const { token } = useParams();
  const [d, setD] = useState<Verify | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid'>('loading');
  useEffect(() => {
    fetch(`/api/v1/public/verify/${encodeURIComponent(token ?? '')}`).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (r.ok && j?.valid) { setD(j); setState('ok'); } else setState('invalid');
    }).catch(() => setState('invalid'));
  }, [token]);
  const good = d && d.status === 'POSTED';
  return (
    <main className="verify-page">
      <div className="verify-card">
        <div className="verify-brand">CoopLink · Uhakiki wa hati</div>
        {state === 'loading' && <Loading />}
        {state === 'invalid' && <>
          <div className="verify-icon bad">✕</div>
          <h1>Hati haijatambuliwa</h1>
          <p>QR hii haipo kwenye mfumo wa CoopLink. Usikubali hati hii — wasiliana na chama husika.</p>
        </>}
        {state === 'ok' && d && <>
          <div className={`verify-icon ${good ? 'ok' : 'bad'}`}>{good ? '✓' : '!'}</div>
          <h1>{good ? 'Hati halali' : d.status === 'REVERSED' ? 'Hati imesahihishwa' : 'Hati si halali kwa malipo'}</h1>
          <dl className="verify-dl">
            <dt>Chama</dt><dd>{d.amcos}{d.regNumber ? ` · ${d.regNumber}` : ''}</dd>
            <dt>Hati</dt><dd>{d.title} · <b>{d.docNo}</b></dd>
            <dt>Tarehe</dt><dd>{date(d.date)}</dd>
            <dt>Kiasi</dt><dd><b>TSh {amt(d.amount)}</b>{d.amountUsd ? ` (USD ${d.amountUsd})` : ''}</dd>
            {d.party && <><dt>Mhusika</dt><dd>{d.party}</dd></>}
            <dt>Hali</dt><dd>{good ? 'Imekamilika' : d.status === 'REVERSED' ? `Imesahihishwa na ${d.reversedBy}` : STATUS_STAMP[d.status]?.text ?? d.status}</dd>
          </dl>
          <p className="verify-note">Linganisha kiasi na namba hizi na zilizo kwenye karatasi. Zikitofautiana, hati imebadilishwa.</p>
        </>}
      </div>
    </main>
  );
}

// ------------------------------ MIPANGILIO: NAMBA ZA HATI ------------------------------
type DocNos = Record<'RECEIPT' | 'PAYMENT_VOUCHER', { prefix: string; title: string; lastIssued: number; next: number }>;
export function DocNumbers() {
  const { may } = useAuth();
  const { data, reload } = useFetch<DocNos>('/finance/doc-numbers');
  const [edit, setEdit] = useState<'RECEIPT' | 'PAYMENT_VOUCHER' | null>(null);
  const [next, setNext] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction();
  if (!data) return null;
  const save = async () => {
    if (await act.run(() => api('/finance/doc-numbers', { method: 'PUT', body: { type: edit, next: Number(next), reason } }))) { setEdit(null); setNext(''); setReason(''); reload(); }
  };
  return (
    <Section title="Namba za hati rasmi" actions={<span className="muted small">Stakabadhi na Hati ya Malipo zina mfululizo wake, bila pengo</span>}>
      <div className="docno-grid">
        {(Object.keys(data) as (keyof DocNos)[]).map((k) => (
          <div key={k} className="docno-card">
            <span className="muted small">{data[k].title}</span>
            <b>{data[k].prefix}{String(data[k].next).padStart(6, '0')}</b>
            <span className="muted small">{data[k].lastIssued ? `Iliyotolewa mwisho: ${data[k].prefix}${String(data[k].lastIssued).padStart(6, '0')}` : 'Bado haijatolewa'}</span>
            {may('approvals.decide') && <Button size="sm" variant="secondary" onClick={() => { setEdit(k); setNext(String(data[k].next)); }}>Endelea kutoka kitabu…</Button>}
          </div>
        ))}
      </div>
      {edit && (
        <div className="docno-edit">
          <Alert kind="warn">Weka namba inayofuata baada ya ukurasa wa mwisho uliotumika kwenye kitabu cha karatasi (mf. kitabu kimeishia 578 → weka 579). Namba inaweza kusogezwa mbele tu, si nyuma, na mabadiliko yanarekodiwa.</Alert>
          <div className="form-grid">
            <TextField label={`Namba inayofuata — ${data[edit].title}`} type="number" min={String(data[edit].lastIssued + 1)} value={next} onChange={setNext} />
            <TextField label="Sababu *" value={reason} onChange={setReason} placeholder="mf. Tunaendelea kutoka kitabu cha stakabadhi Na. 578" />
          </div>
          <Alert>{act.error}</Alert>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setEdit(null)}>Ghairi</Button>
            <Button busy={act.busy} disabled={!(Number(next) > data[edit].lastIssued) || reason.trim().length < 5} onClick={save}>Hifadhi</Button>
          </div>
        </div>
      )}
    </Section>
  );
}
