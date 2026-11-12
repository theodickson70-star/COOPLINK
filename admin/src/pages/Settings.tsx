// =====================================================================
//  MIPANGILIO — watumishi wote wa chama (Meneja, Mhasibu, Storekeeper)
//   Nani anaweza kubadilisha nini kinatoka kwenye server (GET /settings → access); UI inasoma tu.
//   Sehemu zenye kurasa zao (bei za madaraja, makato, mikopo, dola) zinaonyesha HALI + KIUNGO tu — hazirudiwi hapa.
// =====================================================================
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { PrefSwitches, useT } from '../lib/prefs';
import { CATEGORY_LABEL, UNIT_LABEL, date, dateTime, num, phone, ROLE_LABEL } from '../lib/format';
import { Alert, Button, Empty, Loading, PageHead, TextField } from '../components/ui';
import { Pill } from '../components/owner-ui';
import { PortalSummary } from '../components/FarmerPortalAccess';
import { Password, Profile as MyProfile, Sessions, TwoFactor } from '../owner/Settings';
import { DocFoot, DocHead } from './acc-common';
import { IDLE_MIN } from '../components/IdleLock';

type TabKey = 'account' | 'profile' | 'season' | 'farmers' | 'finance' | 'stock' | 'docs' | 'sms';
type Leader = { role: LeaderRole; name: string; phone: string | null };
type LeaderRole = 'CHAIR' | 'VICE_CHAIR' | 'SECRETARY' | 'TREASURER';
interface Data {
  access: { view: Record<TabKey, boolean>; edit: Record<Exclude<TabKey, 'account' | 'sms'> | 'identity', boolean> };
  profile: {
    name: string; code: string; regNumber: string | null; regDate: string | null; tin: string | null;
    region: string | null; district: string | null; ward: string | null; village: string | null; phone: string | null; email: string | null; postalAddress: string | null;
    leaders: Leader[]; logo: string | null; completeness: { pct: number; missing: string[] }; training: boolean;
  };
  season: { current: { name: string; status: string; startDate: string; endDate: string } | null; kgPerAcre: string };
  farmers: { portal: boolean; members: number; lastMemberNo: string | null; code: string };
  finance: null | {
    inputCurrency: 'TZS' | 'USD'; hasFxRate: boolean; mainAccountId: string | null;
    accounts: { id: string; name: string; kind: string; bankName: string | null; accountNumber: string | null }[];
    status: { gradePrices: number; deductions: number; loanBatches: number };
  };
  stock: null | { items: StockItem[]; low: number; withoutLevel: number };
  sms: null | { enabled: boolean; limit: number; used: number; remaining: number; allThisMonth: number; failedThisMonth: number };
  docs: { footer: string | null; showBank: boolean; bank: { name: string; bankName: string | null; accountNumber: string | null } | null };
  recent: { id: string; action: string; createdAt: string; by: string | null; role: string | null }[];
}
interface StockItem { id: string; name: string; unit: string; category: string; reorderLevel: string | null; balance: string; low: boolean }

const SEASON_LABEL: Record<string, string> = { PLANNING: 'Maandalizi', ACTIVE: 'Unaendelea', MARKETING: 'Masoko', CLOSED: 'Umefungwa' };
const LEADERS: [LeaderRole, string][] = [['CHAIR', 'Mwenyekiti'], ['VICE_CHAIR', 'Makamu Mwenyekiti'], ['SECRETARY', 'Katibu'], ['TREASURER', 'Mweka Hazina']];
const ACTION_LABEL: Record<string, string> = {
  AMCOS_PROFILE_UPDATE: 'Profaili ya chama', AMCOS_DOCS_UPDATE: 'Nyaraka / nembo', AMCOS_MAIN_ACCOUNT_SET: 'Akaunti kuu ya benki',
  ESTIMATE_SETTINGS_UPDATE: 'Kilo kwa ekari', INPUT_CURRENCY_SET: 'Sarafu ya pembejeo', AMCOS_UPDATE: 'Taarifa za chama / portal', INPUT_ITEM_UPDATE: 'Bidhaa ya stoo',
};
/** Nani anabadilisha kila sehemu (kwa ujumbe wa "unasoma tu") */
const OWNER_OF: Record<string, string> = {
  profile: 'Meneja', season: 'Meneja', farmers: 'Meneja', finance: 'Mhasibu', stock: 'Storekeeper', docs: 'Meneja au Mhasibu',
};

const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const ICON: Record<TabKey, ReactNode> = {
  account: svg(<><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-1.5A5.5 5.5 0 0 1 10.5 14h3a5.5 5.5 0 0 1 5.5 5.5V21" /></>),
  profile: svg(<><path d="M3 21h18M5 21V9l7-5 7 5v12" /><path d="M10 21v-6h4v6" /></>),
  season: svg(<><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" /><path d="M5 19 13 11" /></>),
  farmers: svg(<><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" /></>),
  finance: svg(<><ellipse cx="9" cy="7" rx="6" ry="2.6" /><path d="M3 7v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7" /><path d="M3 11v4c0 1.4 2.7 2.6 6 2.6" /><circle cx="17" cy="16" r="4" /></>),
  stock: svg(<><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>),
  docs: svg(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>),
  sms: svg(<><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>),
};
const LOCK = svg(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>);
const EYE = svg(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
const ARROW = svg(<path d="M9 6l6 6-6 6" />);

export function Settings() {
  const t = useT();
  const { data, error, reload } = useFetch<Data>('/settings');
  const [sp, setSp] = useSearchParams();
  const tabs: [TabKey, string][] = [['account', 'Akaunti yangu'], ['profile', 'Profaili ya chama'], ['season', 'Msimu'], ['farmers', 'Wakulima'],
    ['finance', 'Fedha'], ['stock', 'Stoo'], ['docs', 'Nyaraka'], ['sms', 'SMS']];
  const visible = tabs.filter(([k]) => k === 'account' || !!data?.access.view[k]);
  const q = sp.get('tab') as TabKey | null;
  const tab: TabKey = q && visible.some(([k]) => k === q) ? q : 'account';
  const go = (k: TabKey) => { setSp(k === 'account' ? {} : { tab: k }, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const canEdit = (k: TabKey) => k === 'account' || (k !== 'sms' && !!data?.access.edit[k as keyof Data['access']['edit']]);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => { navRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [tab]);

  return (
    <>
      <PageHead title="Mipangilio" sub={t('Akaunti yako na mipangilio ya chama. Kila badiliko linarekodiwa kwenye Audit.')} />
      <Alert>{error}</Alert>
      <div className="st-wrap">
        <nav className="st-nav" ref={navRef} aria-label={t('Sehemu za mipangilio')}>
          {visible.map(([k, label], i) => (
            <div key={k} style={{ display: 'contents' }}>
              {i === 1 && <hr />}
              <button type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
                {ICON[k]}<span>{t(label)}</span>
                {data && <small className={canEdit(k) ? 'ed' : ''}>{canEdit(k) ? t('Unabadilisha') : t('Kusoma')}</small>}
              </button>
            </div>
          ))}
        </nav>
        <div className="st-body">
          {tab === 'account' ? <AccountTab /> : !data ? <Loading /> : (
            <>
              {!canEdit(tab) && tab !== 'sms' && (
                <div className="st-ro" role="note">{EYE}<span>{t('Unasoma tu — sehemu hii inabadilishwa na {who}.', { who: t(OWNER_OF[tab] ?? 'Meneja') })}</span></div>
              )}
              {tab === 'profile' && <ProfileTab d={data} onSaved={reload} go={go} />}
              {tab === 'season' && <SeasonTab d={data} onSaved={reload} />}
              {tab === 'farmers' && <FarmersTab d={data} />}
              {tab === 'finance' && data.finance && <FinanceTab d={data} onSaved={reload} />}
              {tab === 'stock' && data.stock && <StockTab d={data} onSaved={reload} />}
              {tab === 'docs' && <DocsTab d={data} onSaved={reload} />}
              {tab === 'sms' && data.sms && <SmsTab d={data} />}
              {data.recent.length > 0 && tab !== 'sms' && <Recent rows={data.recent} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------ VIPANDE VYA PAMOJA ------------------------------
function Sec({ title, sub, children, aside }: { title: string; sub?: string; children: ReactNode; aside?: ReactNode }) {
  const t = useT();
  return (
    <section className="st-sec">
      <div className="st-sec-h"><div><h3>{t(title)}</h3>{sub && <p className="sub">{t(sub)}</p>}</div>{aside}</div>
      {children}
    </section>
  );
}

function LinkRow({ to, title, detail, state }: { to: string; title: string; detail: ReactNode; state?: 'ok' | 'warn' }) {
  const t = useT();
  return (
    <Link className="st-link" to={to}>
      <span className={`st-dot ${state ?? ''}`} aria-hidden="true" />
      <span className="grow"><b>{t(title)}</b><span>{detail}</span></span>
      {ARROW}
    </Link>
  );
}

/** Upau wa kuhifadhi unaobaki chini mabadiliko yakiwa hayajahifadhiwa */
function SaveBar({ dirty, busy, onSave, onReset, label = 'Hifadhi mabadiliko' }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void; label?: string }) {
  const t = useT();
  return (
    <div className={`st-save ${dirty ? 'dirty' : ''}`}>
      <span>{dirty ? t('Una mabadiliko ambayo hayajahifadhiwa') : t('Hakuna mabadiliko')}</span>
      <div className="actions">
        {dirty && <Button variant="ghost" onClick={onReset}>{t('Rudisha')}</Button>}
        <Button busy={busy} disabled={!dirty} onClick={onSave}>{t(label)}</Button>
      </div>
    </div>
  );
}

function useFlash() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (msg) { const i = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(i); } }, [msg]);
  return [msg, setMsg] as const;
}

// ------------------------------ AKAUNTI YANGU ------------------------------
function AccountTab() {
  const t = useT();
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="stack">
      <section className="st-sec st-me">
        <span className="st-av" aria-hidden="true">{user.fullName.charAt(0)}</span>
        <div className="grow">
          <h2>{user.fullName}</h2>
          <p>{t(ROLE_LABEL[user.role] ?? user.role)} · {phone(user.phone)}</p>
        </div>
        <div className="st-badges">
          {user.totpEnabled ? <Pill value="ACTIVE" label="2FA imewashwa" /> : <Pill value="PENDING" label="2FA haijawashwa" />}
        </div>
      </section>
      <MyProfile ownerNote={false} />
      <Password />
      <TwoFactor />
      <Sec title="Mapendeleo" sub="Mwonekano na lugha ya mfumo kwenye kifaa hiki.">
        <div className="st-prefs"><PrefSwitches /></div>
        <p className="muted st-small">{t('Kwa usalama, mfumo unajifunga baada ya dakika {n} bila kutumika — utaweka nenosiri lako kuendelea.', { n: IDLE_MIN })}</p>
      </Sec>
      <Sessions />
    </div>
  );
}

// ------------------------------ PROFAILI YA CHAMA ------------------------------
type ProfileForm = { region: string; district: string; ward: string; village: string; phone: string; email: string; postalAddress: string; tin: string; regDate: string; leaders: Record<LeaderRole, { name: string; phone: string }> };
function profileForm(p: Data['profile']): ProfileForm {
  const leaders = Object.fromEntries(LEADERS.map(([r]) => {
    const l = p.leaders.find((x) => x.role === r);
    return [r, { name: l?.name ?? '', phone: l?.phone ? phone(l.phone) : '' }];
  })) as ProfileForm['leaders'];
  return { region: p.region ?? '', district: p.district ?? '', ward: p.ward ?? '', village: p.village ?? '', phone: p.phone ? phone(p.phone) : '', email: p.email ?? '',
    postalAddress: p.postalAddress ?? '', tin: p.tin ?? '', regDate: p.regDate ?? '', leaders };
}

function ProfileTab({ d, onSaved, go }: { d: Data; onSaved: () => void; go: (k: TabKey) => void }) {
  const t = useT();
  const { refresh } = useAuth();
  const p = d.profile;
  const edit = d.access.edit.profile;
  const base = useMemo(() => profileForm(p), [p]);
  const [f, setF] = useState(base);
  useEffect(() => setF(base), [base]);
  const dirty = JSON.stringify(f) !== JSON.stringify(base);
  const act = useAction();
  const [ok, setOk] = useFlash();
  const set = (k: keyof Omit<ProfileForm, 'leaders'>) => (v: string) => setF({ ...f, [k]: v });
  const setL = (r: LeaderRole, k: 'name' | 'phone') => (v: string) => setF({ ...f, leaders: { ...f.leaders, [r]: { ...f.leaders[r], [k]: v } } });
  const save = async () => {
    const leaders = LEADERS.filter(([r]) => f.leaders[r].name.trim()).map(([r]) => ({ role: r, name: f.leaders[r].name.trim(), phone: f.leaders[r].phone.trim() || null }));
    const { leaders: _l, ...rest } = f; void _l;
    if (await act.run(() => api('/settings/profile', { method: 'PUT', body: { ...rest, leaders } }))) { setOk('Profaili ya chama imehifadhiwa.'); onSaved(); refresh().catch(() => undefined); }
  };
  const c = p.completeness;
  return (
    <div className="stack">
      <section className="st-sec">
        <div className="st-hd">
          <button type="button" className="st-logo" onClick={() => go('docs')} title={t('Nembo inawekwa kwenye Nyaraka')}>
            {p.logo ? <img src={p.logo} alt={t('Nembo ya chama')} /> : <span>{t('Nembo')}</span>}
          </button>
          <div className="grow">
            <h2>{p.name}{p.training && <> <Pill value="PENDING" label="Mafunzo" /></>}</h2>
            <p>Code: <b>{p.code}</b> · {t('Namba ya usajili')}: <b>{p.regNumber ?? '—'}</b></p>
            <div className="st-prog" role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${c.pct}%` }} /></div>
            <span className="st-small muted">{c.pct === 100 ? t('Profaili imekamilika') : t('Profaili imekamilika {p}% — bado: {m}', { p: c.pct, m: c.missing.map((x) => t(x)).join(', ') })}</span>
          </div>
        </div>
        <div className="st-lock">{LOCK}<span>{t('Jina, code na namba ya usajili vinabadilishwa na CoopLink tu. Kuomba mabadiliko, tumia')} <Link to="/support/new">Help &amp; Support</Link>.</span></div>
      </section>
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <Sec title="Usajili" sub="Taarifa rasmi za usajili wa chama.">
        <div className="form-grid">
          <TextField label="Tarehe ya usajili" type="date" value={f.regDate} onChange={set('regDate')} disabled={!edit} max={new Date().toISOString().slice(0, 10)} />
          <TextField label="TIN (TRA)" value={f.tin} onChange={set('tin')} disabled={!edit} placeholder="mf. 123-456-789" inputMode="numeric" />
        </div>
      </Sec>
      <Sec title="Mahali na mawasiliano" sub="Inaonekana juu ya risiti, vocha na taarifa zinazochapishwa.">
        <div className="form-grid">
          <TextField label="Mkoa" value={f.region} onChange={set('region')} disabled={!edit} />
          <TextField label="Wilaya" value={f.district} onChange={set('district')} disabled={!edit} />
          <TextField label="Kata" value={f.ward} onChange={set('ward')} disabled={!edit} />
          <TextField label="Kijiji" value={f.village} onChange={set('village')} disabled={!edit} />
          <TextField label="Anwani ya posta" value={f.postalAddress} onChange={set('postalAddress')} disabled={!edit} placeholder="mf. S.L.P 149 Urambo" />
          <TextField label="Simu ya ofisi ya chama" value={f.phone} onChange={set('phone')} disabled={!edit} inputMode="tel" placeholder="07XXXXXXXX" />
          <TextField label="Barua pepe ya chama" type="email" value={f.email} onChange={set('email')} disabled={!edit} />
        </div>
      </Sec>
      <Sec title="Uongozi wa bodi" sub="Viongozi wa chama waliochaguliwa (si watumiaji wa mfumo). Wanaonekana kwenye taarifa za chama.">
        <div className="st-leaders">
          {LEADERS.map(([r, label]) => (
            <div key={r} className="st-ld">
              <b>{t(label).toUpperCase()}</b>
              {edit ? (
                <>
                  <input className="input" aria-label={t('Jina la {r}', { r: t(label) })} placeholder={t('Jina kamili')} value={f.leaders[r].name} onChange={(e) => setL(r, 'name')(e.target.value)} />
                  <input className="input" aria-label={t('Simu ya {r}', { r: t(label) })} placeholder={t('Simu (hiari)')} inputMode="tel" value={f.leaders[r].phone} onChange={(e) => setL(r, 'phone')(e.target.value)} />
                </>
              ) : (
                <><strong>{f.leaders[r].name || '—'}</strong><span>{f.leaders[r].phone || t('Hakuna simu')}</span></>
              )}
            </div>
          ))}
        </div>
      </Sec>
      {edit && <SaveBar dirty={dirty} busy={act.busy} onSave={save} onReset={() => setF(base)} />}
    </div>
  );
}

// ------------------------------ MSIMU ------------------------------
function SeasonTab({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const t = useT();
  const s = d.season;
  const edit = d.access.edit.season;
  const base = String(Number(s.kgPerAcre));
  const [kg, setKg] = useState(base);
  useEffect(() => setKg(base), [base]);
  const act = useAction();
  const [ok, setOk] = useFlash();
  const n = Number(kg);
  const bad = !(n > 0 && n <= 5000);
  return (
    <div className="stack">
      <Sec title="Msimu unaoendelea" sub="Msimu unafunguliwa na kufungwa na CoopLink kwa vyama vyote.">
        {s.current ? (
          <div className="st-season">
            <div><span className="muted st-small">{t('Msimu')}</span><strong>{s.current.name}</strong></div>
            <div><span className="muted st-small">{t('Kuanzia')}</span><strong>{date(s.current.startDate)}</strong></div>
            <div><span className="muted st-small">{t('Hadi')}</span><strong>{date(s.current.endDate)}</strong></div>
            <div><span className="muted st-small">{t('Hali')}</span><Pill value={s.current.status === 'CLOSED' ? 'CANCELLED' : s.current.status === 'PLANNING' ? 'PENDING' : 'ACTIVE'} label={SEASON_LABEL[s.current.status] ?? s.current.status} /></div>
          </div>
        ) : <Empty>{t('Hakuna msimu unaoendelea kwa sasa.')}</Empty>}
      </Sec>
      <Sec title="Makisio ya mavuno" sub="Kilo za tumbaku kwa ekari moja — zinatumika kukokotoa makisio ya kila mkulima.">
        <Alert>{act.error}</Alert>
        <Alert kind="ok">{ok}</Alert>
        <div className="form-grid">
          <TextField label="Kilo kwa ekari" type="number" min="1" max="5000" value={kg} onChange={setKg} disabled={!edit} help={bad ? 'Weka namba kati ya 1 na 5,000' : undefined} />
          <div className="st-calc" aria-live="polite">
            <span className="muted st-small">{t('Mfano')}</span>
            <strong>{t('Ekari 2 × {k} = kilo {v}', { k: num(n || 0), v: num((n || 0) * 2) })}</strong>
          </div>
        </div>
        {edit && <SaveBar dirty={kg !== base} busy={act.busy} label="Hifadhi" onReset={() => setKg(base)} onSave={async () => {
          if (bad) return;
          if (await act.run(() => api('/estimates/settings', { method: 'PUT', body: { kgPerAcre: kg } }))) { setOk('Kilo kwa ekari zimehifadhiwa.'); onSaved(); }
        }} />}
        <LinkRow to="/estimates" title="Makisio ya msimu" detail={t('Angalia na idhinisha makisio ya wakulima')} />
      </Sec>
    </div>
  );
}

// ------------------------------ WAKULIMA ------------------------------
function FarmersTab({ d }: { d: Data }) {
  const t = useT();
  const f = d.farmers;
  const showPortal = d.access.edit.farmers || f.portal;
  return (
    <div className="stack">
      <Sec title="Portal ya wakulima" sub="Wakulima wanaona deni, mauzo na pembejeo zao kwenye simu kwa PIN.">
        {showPortal ? <PortalSummary /> : (
          <div className="st-row"><div className="grow"><b>{t('Portal imezimwa')}</b><span>{t('Meneja ndiye anayeiwasha.')}</span></div><Pill value="CANCELLED" label="Imezimwa" /></div>
        )}
      </Sec>
      <Sec title="Namba za uanachama" sub="Kila mkulima anapewa namba ya kipekee ndani ya chama.">
        <div className="st-season">
          <div><span className="muted st-small">{t('Code ya chama')}</span><strong>{f.code}</strong></div>
          <div><span className="muted st-small">{t('Wakulima waliosajiliwa')}</span><strong>{num(f.members)}</strong></div>
          <div><span className="muted st-small">{t('Namba ya mwisho')}</span><strong>{f.lastMemberNo ?? '—'}</strong></div>
        </div>
        <p className="muted st-small">{t('Code ya chama haibadiliki kwa sababu ni sehemu ya namba za wanachama na kumbukumbu zao zote.')}</p>
        <LinkRow to="/members" title="Wakulima (wanachama)" detail={t('Sajili, tafuta na simamia wakulima')} />
      </Sec>
    </div>
  );
}

// ------------------------------ FEDHA ------------------------------
function FinanceTab({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const t = useT();
  const { refresh } = useAuth();
  const f = d.finance!;
  const edit = d.access.edit.finance;
  const banks = f.accounts.filter((a) => a.kind === 'BANK');
  const [main, setMain] = useState(f.mainAccountId ?? '');
  useEffect(() => setMain(f.mainAccountId ?? ''), [f.mainAccountId]);
  const act = useAction();
  const [ok, setOk] = useFlash();
  const cur = banks.find((b) => b.id === f.mainAccountId);
  return (
    <div className="stack">
      <Sec title="Akaunti kuu ya benki" sub="Akaunti rasmi ya chama — inaweza kuonekana kwenye risiti na taarifa (Nyaraka).">
        <Alert>{act.error}</Alert>
        <Alert kind="ok">{ok}</Alert>
        {banks.length === 0 ? (
          <Alert kind="warn">{t('Bado hakuna akaunti ya benki.')} <Link to="/finance?tab=accounts">{t('Ongeza akaunti')}</Link></Alert>
        ) : edit ? (
          <>
            <div className="st-radio" role="radiogroup" aria-label={t('Akaunti kuu ya benki')}>
              {banks.map((b) => (
                <label key={b.id} className={main === b.id ? 'on' : ''}>
                  <input type="radio" name="main" checked={main === b.id} onChange={() => setMain(b.id)} />
                  <span><b>{b.name}</b><small>{[b.bankName, b.accountNumber].filter(Boolean).join(' · ') || t('Hakuna namba ya akaunti')}</small></span>
                </label>
              ))}
            </div>
            <SaveBar dirty={main !== (f.mainAccountId ?? '')} busy={act.busy} label="Weka kuwa kuu" onReset={() => setMain(f.mainAccountId ?? '')} onSave={async () => {
              if (await act.run(() => api('/settings/finance', { method: 'PUT', body: { mainAccountId: main || null } }))) { setOk('Akaunti kuu imewekwa.'); onSaved(); refresh().catch(() => undefined); }
            }} />
          </>
        ) : (
          <div className="st-row"><div className="grow"><b>{cur?.name ?? t('Haijachaguliwa')}</b><span>{cur ? [cur.bankName, cur.accountNumber].filter(Boolean).join(' · ') : t('Mhasibu ataichagua')}</span></div></div>
        )}
      </Sec>
      <Sec title="Sarafu na viwango" sub="Hali ya mipangilio ya fedha — inabadilishwa kwenye kurasa zake.">
        <LinkRow to="/finance?tab=fx" title={`${t('Sarafu ya pembejeo')}: ${f.inputCurrency === 'USD' ? 'USD ($)' : 'TSh'}`}
          state={f.inputCurrency === 'USD' && !f.hasFxRate ? 'warn' : 'ok'}
          detail={f.inputCurrency === 'USD' ? (f.hasFxRate ? t('Kiwango cha dola kimewekwa') : t('Kiwango cha dola bado hakijawekwa')) : t('Pembejeo zinakopeshwa kwa shilingi')} />
        <LinkRow to="/sales?tab=grades" title="Bei za madaraja ya tumbaku" state={f.status.gradePrices ? 'ok' : 'warn'}
          detail={f.status.gradePrices ? t('Madaraja {n} yana bei msimu huu', { n: f.status.gradePrices }) : t('Bado hazijawekwa msimu huu')} />
        <LinkRow to="/sales?tab=rules" title="Makato ya mauzo" state={f.status.deductions ? 'ok' : 'warn'}
          detail={f.status.deductions ? t('Makato {n} yanatumika msimu huu', { n: f.status.deductions }) : t('Bado hayajawekwa msimu huu')} />
        <LinkRow to="/kuni" title="Mikopo ya wakulima" state="ok"
          detail={f.status.loanBatches ? t('Orodha {n} za mikopo msimu huu', { n: f.status.loanBatches }) : t('Hakuna orodha ya mikopo msimu huu')} />
      </Sec>
    </div>
  );
}

// ------------------------------ STOO ------------------------------
function StockTab({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const t = useT();
  const s = d.stock!;
  const edit = d.access.edit.stock;
  const base = useMemo(() => Object.fromEntries(s.items.map((i) => [i.id, i.reorderLevel === null ? '' : String(Number(i.reorderLevel))])), [s.items]);
  const [lv, setLv] = useState(base);
  useEffect(() => setLv(base), [base]);
  const changed = s.items.filter((i) => (lv[i.id] ?? '') !== base[i.id]);
  const invalid = changed.some((i) => lv[i.id] !== '' && !(Number(lv[i.id]) >= 0));
  const act = useAction();
  const [ok, setOk] = useFlash();
  const save = async () => {
    const r = await act.run(async () => {
      for (const i of changed) await api(`/inputs/items/${i.id}`, { method: 'PATCH', body: { reorderLevel: lv[i.id] === '' ? null : lv[i.id] } });
      return true;
    });
    if (r) { setOk(t('Viwango vya bidhaa {n} vimehifadhiwa.', { n: changed.length })); }
    onSaved();
  };
  return (
    <div className="stack">
      <div className="st-kpis">
        <div><span>{t('Bidhaa hai')}</span><strong>{num(s.items.length)}</strong></div>
        <div className={s.low ? 'warn' : ''}><span>{t('Chini ya kiwango')}</span><strong>{num(s.low)}</strong></div>
        <div><span>{t('Hazina kiwango')}</span><strong>{num(s.withoutLevel)}</strong></div>
      </div>
      <Sec title="Kiwango cha chini cha stoo" sub="Salio likifika au kushuka chini ya kiwango hiki, bidhaa inaonyeshwa kama 'stock ndogo' kwenye dashibodi.">
        <Alert>{act.error ?? (invalid ? 'Kiwango kiwe namba sahihi (0 au zaidi).' : null)}</Alert>
        <Alert kind="ok">{ok}</Alert>
        {s.items.length === 0 ? <Empty>{t('Bado hakuna bidhaa za stoo.')}</Empty> : (
          <div className="table-wrap"><table className="table st-table">
            <thead><tr><th>{t('Bidhaa')}</th><th>{t('Kipimo')}</th><th className="num">{t('Salio la msimu')}</th><th className="num">{t('Kiwango cha chini')}</th><th>{t('Hali')}</th></tr></thead>
            <tbody>{s.items.map((i) => (
              <tr key={i.id}>
                <td data-label={t('Bidhaa')}><strong>{i.name}</strong><div className="muted st-small">{t(CATEGORY_LABEL[i.category] ?? i.category)}</div></td>
                <td data-label={t('Kipimo')}>{t(UNIT_LABEL[i.unit] ?? i.unit)}</td>
                <td data-label={t('Salio la msimu')} className="num">{num(i.balance)}</td>
                <td data-label={t('Kiwango cha chini')} className="num">{edit
                  ? <input className="input st-num" type="number" min="0" inputMode="decimal" aria-label={t('Kiwango cha chini cha {n}', { n: i.name })} placeholder="—" value={lv[i.id] ?? ''} onChange={(e) => setLv({ ...lv, [i.id]: e.target.value })} />
                  : i.reorderLevel === null ? '—' : num(i.reorderLevel)}</td>
                <td data-label={t('Hali')}>{i.reorderLevel === null ? <Pill value="neutral" label="Hakuna kiwango" /> : i.low ? <Pill value="PAST_DUE" label="Stock ndogo" /> : <Pill value="ACTIVE" label="Sawa" />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {edit && s.items.length > 0 && <SaveBar dirty={changed.length > 0 && !invalid} busy={act.busy} onReset={() => setLv(base)} onSave={save}
          label={changed.length ? t('Hifadhi ({n})', { n: changed.length }) : 'Hifadhi'} />}
        <LinkRow to="/inputs" title="Pembejeo na stoo" detail={t('Sajili bidhaa, pokea mzigo na angalia mienendo ya stoo')} />
      </Sec>
    </div>
  );
}

// ------------------------------ NYARAKA ------------------------------
const LOGO_MAX = 90_000;
async function shrinkLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Chagua picha ya PNG, JPG au WEBP');
  if (file.size > 8 * 1024 * 1024) throw new Error('Picha ni kubwa mno (zaidi ya 8MB)');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Picha haisomeki')); i.src = url; });
    for (const size of [320, 240, 180, 128]) {
      const k = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/webp', 0.86);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/png');
      if (out.length <= LOGO_MAX) return out;
    }
    throw new Error('Nembo ni kubwa mno hata baada ya kubanwa — tumia picha rahisi zaidi');
  } finally { URL.revokeObjectURL(url); }
}

function DocsTab({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const t = useT();
  const { amcos, refresh } = useAuth();
  const edit = d.access.edit.docs;
  const base = useMemo(() => ({ footer: d.docs.footer ?? '', showBank: d.docs.showBank }), [d.docs]);
  const [f, setF] = useState(base);
  useEffect(() => setF(base), [base]);
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined = haijabadilishwa
  const act = useAction();
  const [ok, setOk] = useFlash();
  const [pickErr, setPickErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const curLogo = logo === undefined ? d.profile.logo : logo;
  const dirty = JSON.stringify(f) !== JSON.stringify(base) || logo !== undefined;
  const p = d.profile;
  const org = { ...p, logo: curLogo };
  const save = async () => {
    const body = { footer: f.footer, showBank: f.showBank, ...(logo !== undefined ? { logo } : {}) };
    if (await act.run(() => api('/settings/docs', { method: 'PUT', body }))) { setOk('Mipangilio ya nyaraka imehifadhiwa.'); setLogo(undefined); onSaved(); refresh().catch(() => undefined); }
  };
  return (
    <div className="stack">
      <Alert>{act.error ?? pickErr}</Alert>
      <Alert kind="ok">{ok}</Alert>
      <Sec title="Nembo ya chama" sub="Inaonekana juu ya risiti, vocha, hati za mishahara na taarifa. PNG, JPG au WEBP — itabanwa kiotomatiki.">
        <div className="st-logo-row">
          <div className="st-logo big">{curLogo ? <img src={curLogo} alt={t('Nembo ya chama')} /> : <span>{t('Hakuna nembo')}</span>}</div>
          {edit && (
            <div className="actions">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                if (!file) return;
                setPickErr(null);
                try { setLogo(await shrinkLogo(file)); } catch (x) { setPickErr((x as Error).message); }
              }} />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>{curLogo ? t('Badilisha nembo') : t('Pakia nembo')}</Button>
              {curLogo && <Button variant="ghost" onClick={() => setLogo(null)}>{t('Ondoa')}</Button>}
            </div>
          )}
        </div>
      </Sec>
      <Sec title="Kijachini cha nyaraka" sub="Maneno mafupi chini ya kila risiti na vocha.">
        <div className="form-grid">
          <TextField label="Maneno ya kijachini" value={f.footer} onChange={(v) => setF({ ...f, footer: v })} disabled={!edit} maxLength={200} placeholder="mf. Asante kwa kuwa mwanachama mwaminifu" help={`${f.footer.length}/200`} />
        </div>
        <label className={`st-switch ${!edit || !d.docs.bank ? 'off' : ''}`}>
          <input type="checkbox" checked={f.showBank} disabled={!edit || !d.docs.bank} onChange={(e) => setF({ ...f, showBank: e.target.checked })} />
          <span className="tog" aria-hidden="true" />
          <span className="grow"><b>{t('Onyesha akaunti kuu ya benki kwenye nyaraka')}</b>
            <span>{d.docs.bank ? [d.docs.bank.bankName, d.docs.bank.accountNumber].filter(Boolean).join(' · ') || d.docs.bank.name : t('Mhasibu achague akaunti kuu kwanza (Fedha)')}</span></span>
        </label>
      </Sec>
      <Sec title="Hakikisho" sub="Hivi ndivyo kichwa na kijachini vitakavyoonekana ukichapisha.">
        <div className="st-preview">
          <div className="print-doc">
            <DocHead title={t('RISITI YA MALIPO')} no="Na. RCT-0001" sub={`${t('Tarehe')}: ${date(new Date().toISOString())}`} org={org} />
            <div className="st-preview-body"><span /><span /><span style={{ width: '60%' }} /></div>
            <PreviewFoot footer={f.footer} bank={f.showBank ? d.docs.bank : null} />
          </div>
        </div>
        {amcos && !amcos.logo && !curLogo && <p className="muted st-small">{t('Kidokezo: nembo inaongeza uaminifu wa nyaraka za chama.')}</p>}
      </Sec>
      {edit && <SaveBar dirty={dirty} busy={act.busy} onSave={save} onReset={() => { setF(base); setLogo(undefined); }} />}
    </div>
  );
}
/** Kijachini cha hakikisho (kinafuata fomu kabla ya kuhifadhi) — DocFoot halisi inasoma kilichohifadhiwa */
function PreviewFoot({ footer, bank }: { footer: string; bank: Data['docs']['bank'] }) {
  if (!footer && !bank) return <DocFoot />;
  return (
    <div className="doc-foot doc-foot-org">
      {bank && <div>Malipo: <strong>{[bank.bankName, bank.accountNumber].filter(Boolean).join(' · ') || bank.name}</strong>{bank.bankName ? ` (${bank.name})` : ''}</div>}
      {footer && <div>{footer}</div>}
    </div>
  );
}

// ------------------------------ SMS ------------------------------
function SmsTab({ d }: { d: Data }) {
  const t = useT();
  const { may } = useAuth();
  const s = d.sms!;
  const pct = s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
  return (
    <div className="stack">
      <Sec title="Matangazo kwa SMS mwezi huu" sub="Kikomo cha SMS za matangazo kinawekwa na CoopLink kulingana na kifurushi cha chama."
        aside={s.enabled ? <Pill value="ACTIVE" label="Inafanya kazi" /> : <Pill value="CANCELLED" label="Imezimwa" />}>
        <div className="st-meter">
          <div className="st-meter-top"><strong>{num(s.used)}</strong><span>/ {num(s.limit)} SMS</span><em>{t('Zimebaki {n}', { n: num(s.remaining) })}</em></div>
          <div className={`st-prog ${pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : ''}`}><i style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="st-kpis">
          <div><span>{t('SMS zote za chama mwezi huu')}</span><strong>{num(s.allThisMonth)}</strong></div>
          <div className={s.failedThisMonth ? 'warn' : ''}><span>{t('Hazikufika')}</span><strong>{num(s.failedThisMonth)}</strong></div>
        </div>
        <p className="muted st-small">{t('SMS za lazima (OTP za kuingia, uthibitisho wa kupokea pembejeo) hazihesabiwi kwenye kikomo cha matangazo. Kuongeza kikomo, wasiliana na CoopLink.')}</p>
        {may('members.approve') && <LinkRow to="/sms" title="Tuma tangazo kwa SMS" detail={t('Vikao, matangazo na madeni ya vikundi')} />}
        <LinkRow to="/support/new" title="Omba kuongezewa kikomo" detail="Help & Support" />
      </Sec>
    </div>
  );
}

// ------------------------------ MABADILIKO YA KARIBUNI ------------------------------
function Recent({ rows }: { rows: Data['recent'] }) {
  const t = useT();
  return (
    <Sec title="Mabadiliko ya karibuni" sub="Nani alibadilisha mipangilio na lini.">
      <ul className="st-recent">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="st-dot ok" aria-hidden="true" />
            <span className="grow"><b>{t(ACTION_LABEL[r.action] ?? r.action)}</b><span>{r.by ?? '—'}{r.role ? ` · ${t(ROLE_LABEL[r.role] ?? r.role)}` : ''}</span></span>
            <time dateTime={r.createdAt}>{dateTime(r.createdAt)}</time>
          </li>
        ))}
      </ul>
    </Sec>
  );
}
