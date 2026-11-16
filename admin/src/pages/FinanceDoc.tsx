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
import { DocFoot, DocHead } from './acc-common';

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
          <div className="seg" role="group" aria-label="Ukubwa wa karatasi">
            {(['A4', 'A5'] as const).map((s) => <button key={s} type="button" className={size === s ? 'on' : ''} onClick={() => setSize(s)}>{s}{s === 'A5' ? ' (nusu)' : ''}</button>)}
          </div>
          <Button onClick={print} busy={act.busy}>{nextCopy === 0 ? 'Chapisha asili / PDF' : `Chapisha nakala ${nextCopy}`}</Button>
        </div>
      </div>
      <Alert>{act.error}</Alert>
      {stamp && <Alert kind={stamp.tone === 'bad' ? 'error' : 'warn'} >{stamp.tone === 'bad' ? 'Hati hii si halali kwa malipo.' : t.status === 'PENDING_APPROVAL' ? 'Hii ni rasimu — inasubiri idhini ya Meneja.' : 'Imeidhinishwa — chapisha kwa saini, kisha ukamilishe fedha zikitoka.'} ({stamp.text})</Alert>}

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

      {data.prints.length > 0 && (
        <div className="no-print"><Section title="Historia ya kuchapisha">
          <ul className="fdoc-prints">{data.prints.map((p) => <li key={p.copyNo}><b>{p.copyNo === 0 ? 'Asili' : `Nakala ${p.copyNo}`}</b> · {p.by ?? '—'} · {dateTime(p.printedAt)}</li>)}</ul>
        </Section></div>
      )}
    </>
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
