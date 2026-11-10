// =====================================================================
//  PORTAL YA MKULIMA (/mkulima) — mkulima anaona taarifa zake mwenyewe kwenye simu.
//  Token yake ni tofauti kabisa na ya watumishi (cl_farmer_token) na inakubaliwa na /api/v1/farmer tu.
// =====================================================================
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LogoMark, Wordmark } from '../components/Logo';
import { Alert, Button, Loading } from '../components/ui';
import { PrefSwitches, useT } from '../lib/prefs';
import { date, LEDGER_LABEL, num, tsh } from '../lib/format';
import { LegalLinks } from '../components/LegalLinks';
import { StatementDoc, statementSums, type StatementData } from './FarmerDebts';

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';
const KEY = 'cl_farmer_token';
const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const setToken = (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* */ } };

class FarmerApiError extends Error { constructor(msg: string, public code: string, public status: number) { super(msg); } }
async function fapi<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1/farmer${path}`, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch { throw new FarmerApiError('Hakuna mtandao. Angalia internet kisha jaribu tena.', 'NETWORK', 0); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (j as { error?: { message?: string; code?: string; details?: { message: string }[] } }).error;
    throw new FarmerApiError(e?.details?.[0]?.message ?? e?.message ?? 'Hitilafu imetokea', e?.code ?? 'ERROR', res.status);
  }
  return j as T;
}

interface Me {
  member: { memberNo: string; firstName: string; middleName: string | null; lastName: string; village: string | null; status: string; sharesCount: number; entryFee: string | null; entryFeePaid: boolean; joinedAt: string };
  amcos: { name: string; code: string; phone: string | null };
  mustChange: boolean; lastLoginAt: string | null;
}

export function FarmerPortal() {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'ready'>(getToken() ? 'loading' : 'login');
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback((msg?: string) => { setToken(null); setMe(null); setNotice(msg ?? null); setState('login'); }, []);
  const load = useCallback(async () => {
    try { setMe(await fapi<Me>('/me')); setState('ready'); } catch (e) {
      const err = e as FarmerApiError;
      if (err.status === 401 || err.status === 403) logout(err.message); else { setNotice(err.message); setState('login'); }
    }
  }, [logout]);
  useEffect(() => { if (state === 'loading') load(); }, [state, load]);
  useEffect(() => { document.title = `${t('Portal ya mkulima')} · CoopLink`; }, [t]);

  return (
    <div className="fp">
      <header className="fp-top no-print">
        <div className="fp-brand"><LogoMark size={30} /><Wordmark size={18} /></div>
        <div className="fp-top-r">
          <PrefSwitches compact />
          {me && <button type="button" className="fp-out" onClick={() => logout()}>{t('Toka')}</button>}
        </div>
      </header>
      <main className="fp-main">
        {state === 'loading' && <Loading />}
        {state === 'login' && <FarmerLogin notice={notice} onDone={() => { setNotice(null); setState('loading'); }} />}
        {state === 'ready' && me && (me.mustChange
          ? <ChangePin forced onDone={load} />
          : <FarmerHome me={me} onExpired={logout} />)}
      </main>
      <footer className="fp-foot no-print"><LegalLinks /></footer>
    </div>
  );
}

function FarmerLogin({ notice, onDone }: { notice: string | null; onDone: () => void }) {
  const t = useT();
  const [memberNo, setNo] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await fapi<{ token: string }>('/login', { method: 'POST', body: { memberNo, pin } });
      setToken(r.token); onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card fp-card fp-login" onSubmit={submit}>
      <h1>{t('Portal ya mkulima')}</h1>
      <p className="muted">{t('Ingia uone deni lako, mauzo ya tumbaku, pembejeo na malipo yako.')}</p>
      {notice && <Alert kind="warn">{notice}</Alert>}
      <div className="field">
        <label htmlFor="fp-no">{t('Namba ya uanachama')}</label>
        <input id="fp-no" className="input fp-big" autoComplete="username" autoCapitalize="characters" placeholder={t('mf. URM01-000123')} value={memberNo} onChange={(e) => setNo(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="fp-pin">PIN</label>
        <input id="fp-pin" className="input fp-big fp-pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="\d{4,6}" maxLength={6} placeholder="••••••"
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required />
      </div>
      <Alert>{err}</Alert>
      <Button type="submit" busy={busy} disabled={!memberNo.trim() || pin.length < 4}>{t('Ingia')}</Button>
      <p className="fp-help">{t('Huna PIN au umeisahau? Nenda ofisi ya chama chako — Mhasibu au Stokipa atakupa PIN mpya.')}</p>
    </form>
  );
}

function ChangePin({ forced, onDone, onCancel }: { forced?: boolean; onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const [cur, setCur] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pin !== pin2) { setErr(t('PIN mpya hazifanani')); return; }
    setBusy(true);
    try {
      const r = await fapi<{ token: string }>('/change-pin', { method: 'POST', body: { currentPin: cur, newPin: pin } });
      setToken(r.token); onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card fp-card fp-login" onSubmit={submit}>
      <h1>{forced ? t('Weka PIN yako mwenyewe') : t('Badilisha PIN')}</h1>
      {forced && <p className="muted">{t('PIN uliyopewa ofisini ni ya mara moja tu. Chagua PIN mpya ya tarakimu 4 hadi 6 ambayo wewe peke yako unaijua.')}</p>}
      <div className="field"><label htmlFor="fp-cur">{forced ? t('PIN uliyopewa ofisini') : t('PIN ya sasa')}</label>
        <input id="fp-cur" className="input fp-big fp-pin" type="password" inputMode="numeric" autoComplete="current-password" value={cur} onChange={(e) => setCur(digits(e.target.value))} required /></div>
      <div className="field"><label htmlFor="fp-new">{t('PIN mpya')}</label>
        <input id="fp-new" className="input fp-big fp-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(digits(e.target.value))} required /></div>
      <div className="field"><label htmlFor="fp-new2">{t('Rudia PIN mpya')}</label>
        <input id="fp-new2" className="input fp-big fp-pin" type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(digits(e.target.value))} required /></div>
      <p className="fp-help">{t('Usitumie PIN rahisi kama 1111 au 1234, wala usimpe mtu PIN yako.')}</p>
      <Alert>{err}</Alert>
      <Button type="submit" busy={busy} disabled={cur.length < 4 || pin.length < 4 || pin2.length < 4}>{t('Hifadhi PIN')}</Button>
      {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>{t('Ghairi')}</Button>}
    </form>
  );
}

function FarmerHome({ me, onExpired }: { me: Me; onExpired: (msg?: string) => void }) {
  const t = useT();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [data, setData] = useState<StatementData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'sum' | 'sales' | 'inputs' | 'ledger' | 'pin'>('sum');

  useEffect(() => {
    let live = true;
    setErr(null);
    fapi<StatementData>(`/statement${seasonId ? `?seasonId=${seasonId}` : ''}`)
      .then((d) => {
        if (!live) return;
        // Mara ya kwanza: onyesha msimu unaoendelea (au wa karibuni)
        if (seasonId === null && d.seasons.length) { setSeasonId((d.seasons.find((s) => s.isCurrent) ?? d.seasons[0]).id); return; }
        setData(d);
      })
      .catch((e: FarmerApiError) => { if (e.status === 401 || e.status === 403) onExpired(e.message); else if (live) setErr(e.message); });
    return () => { live = false; };
  }, [seasonId, onExpired]);

  const m = me.member;
  const name = [m.firstName, m.middleName, m.lastName].filter(Boolean).join(' ');
  if (view === 'pin') return <ChangePin onDone={() => setView('sum')} onCancel={() => setView('sum')} />;
  return (
    <div className="fp-home">
      <section className="fp-hello no-print">
        <small>{me.amcos.name}</small>
        <h1>{t('Habari, {name}', { name: m.firstName })}</h1>
        <p className="muted">{name} · {m.memberNo}{m.village ? ` · ${m.village}` : ''}</p>
      </section>
      {err && <Alert>{err}</Alert>}
      {!data ? <Loading /> : <Overview data={data} me={me} view={view} setView={setView} seasonId={seasonId ?? ''} setSeasonId={setSeasonId} />}
    </div>
  );
}

function Overview({ data, me, view, setView, seasonId, setSeasonId }: {
  data: StatementData; me: Me; view: string; setView: (v: 'sum' | 'sales' | 'inputs' | 'ledger' | 'pin') => void; seasonId: string; setSeasonId: (v: string) => void;
}) {
  const t = useT();
  const s = statementSums(data);
  const bal = Number(data.balance);
  return (
    <>
      <div className="fp-season no-print">
        <label htmlFor="fp-season">{t('Msimu')}</label>
        <select id="fp-season" className="select" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
          {data.seasons.map((x) => <option key={x.id} value={x.id}>{x.name}{x.isCurrent ? ` (${t('unaoendelea')})` : ''}</option>)}
          <option value="">{t('Misimu yote')}</option>
        </select>
      </div>

      <section className={`fp-balance no-print ${bal < 0 ? 'owes' : bal > 0 ? 'credit' : ''}`}>
        <span>{bal < 0 ? t('Deni lako') : bal > 0 ? t('Chama kinakudai (utalipwa)') : t('Salio lako')}</span>
        <strong>{tsh(bal < 0 ? data.amountOwed : data.balance)}</strong>
        <small>{data.season ? t('Mwisho wa msimu {name}', { name: data.season.name }) : t('Misimu yote')}</small>
      </section>

      <div className="fp-kpis no-print">
        <div><span>{t('Mauzo ya tumbaku')}</span><strong>{tsh(s.salesTzs)}</strong><small>{t('Kilo {n}', { n: num(s.kg) })}</small></div>
        <div><span>{t('Pembejeo')}</span><strong>{tsh(s.inputs)}</strong></div>
        <div><span>{t('Makato')}</span><strong>{tsh(s.deductions)}</strong></div>
        <div><span>{t('Malipo uliyopokea')}</span><strong>{tsh(s.paid)}</strong></div>
        {s.loans > 0 && <div><span>{t('Pesa ya kuni na riba')}</span><strong>{tsh(s.loans)}</strong></div>}
        <div><span>{t('Hisa')}</span><strong>{num(me.member.sharesCount)}</strong><small>{me.member.entryFeePaid ? t('Kiingilio kimelipwa') : t('Kiingilio hakijalipwa')}</small></div>
      </div>

      <nav className="fp-tabs no-print" aria-label={t('Sehemu')}>
        {([['sum', 'Muhtasari'], ['sales', 'Mauzo'], ['inputs', 'Pembejeo'], ['ledger', 'Miamala']] as const).map(([k, l]) => (
          <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setView(k)}>{t(l)}</button>
        ))}
      </nav>

      <div className="no-print">
        {view === 'sum' && (
          <section className="card fp-list">
            <Row label={t('Mauzo ya tumbaku')} v={`+ ${tsh(s.salesTzs)}`} pos />
            {s.repaid > 0 && <Row label={t('Marejesho ya deni')} v={`+ ${tsh(s.repaid)}`} pos />}
            <Row label={t('Pembejeo ulizokopa')} v={`− ${tsh(s.inputs)}`} />
            {s.loans > 0 && <Row label={t('Pesa ya kuni na riba')} v={`− ${tsh(s.loans)}`} />}
            <Row label={t('Makato ya mauzo')} v={`− ${tsh(s.deductions)}`} />
            <Row label={t('Malipo uliyopokea')} v={`− ${tsh(s.paid)}`} />
            {data.season && <Row label={t('Salio la kuanzia msimu')} v={tsh(data.opening)} />}
            {s.other !== 0 && <Row label={t('Marekebisho mengine (salio la zamani, kusahihisha)')} v={`${s.other > 0 ? '+' : '−'} ${tsh(Math.abs(s.other))}`} pos={s.other > 0} />}
            <Row strong label={bal < 0 ? t('Deni lako') : t('Salio')} v={tsh(bal < 0 ? data.amountOwed : data.balance)} />
          </section>
        )}
        {view === 'sales' && (data.sales.length === 0 ? <p className="fp-empty">{t('Hakuna mauzo katika kipindi hiki.')}</p> : (
          <div className="fp-cards">{data.sales.map((x) => (
            <article key={x.id} className="card fp-item">
              <header><strong>{t('Soko')} {x.marketNo}</strong><time>{date(x.marketDate)}</time></header>
              {x.buyer && <p className="muted">{x.buyer}</p>}
              <Row label={t('Kilo')} v={num(x.kg)} />
              <Row label={t('Thamani')} v={tsh(x.grossTzs)} />
              <Row label={t('Makato')} v={`− ${tsh(x.deductions)}`} />
              <Row strong label={t('Baada ya makato')} v={tsh(x.netTzs)} />
            </article>
          ))}</div>
        ))}
        {view === 'inputs' && (data.issues.filter((i) => i.status === 'ISSUED').length === 0 ? <p className="fp-empty">{t('Hakuna pembejeo katika kipindi hiki.')}</p> : (
          <div className="fp-cards">{data.issues.filter((i) => i.status === 'ISSUED').map((i) => (
            <article key={i.id} className="card fp-item">
              <header><strong>{i.issueNo}</strong><time>{date(i.issuedAt)}</time></header>
              {i.lines.map((l, k) => <Row key={k} label={`${l.name} · ${num(l.quantity)} ${l.unit}`} v={tsh(l.amount)} />)}
              <Row strong label={t('Jumla')} v={tsh(i.totalAmount)} />
            </article>
          ))}</div>
        ))}
        {view === 'ledger' && (data.statement.length === 0 ? <p className="fp-empty">{t('Hakuna miamala katika kipindi hiki.')}</p> : (
          <section className="card fp-list">{[...data.statement].reverse().map((e) => {
            const amt = Number(e.credit) - Number(e.debit);
            return (
              <div key={e.id} className="fp-led">
                <div><strong>{t(LEDGER_LABEL[e.type] ?? e.type)}</strong><small>{date(e.date)} · {e.description}</small></div>
                <div className="fp-led-r"><span className={amt >= 0 ? 'money-pos' : 'money-neg'}>{amt >= 0 ? '+' : '−'} {tsh(Math.abs(amt))}</span><small>{t('Salio')} {tsh(e.balance)}</small></div>
              </div>
            );
          })}</section>
        ))}
      </div>

      <div className="fp-actions no-print">
        <Button variant="secondary" onClick={() => window.print()}>{t('Pakua taarifa (PDF)')}</Button>
        <Button variant="ghost" onClick={() => setView('pin')}>{t('Badilisha PIN')}</Button>
      </div>
      <p className="fp-help no-print">{t('Ukiona kosa kwenye taarifa zako, wasiliana na Mhasibu wa chama ndani ya siku 14.')}{me.amcos.phone ? ` ${t('Simu ya chama')}: ${me.amcos.phone}` : ''}</p>

      <div className="print-only"><StatementDoc data={data} /></div>
    </>
  );
}

function Row({ label, v, strong, pos }: { label: string; v: string; strong?: boolean; pos?: boolean }) {
  return <div className={`fp-row${strong ? ' strong' : ''}`}><span>{label}</span><span className={pos ? 'money-pos' : undefined}>{v}</span></div>;
}
