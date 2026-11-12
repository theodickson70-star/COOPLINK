// =====================================================================
//  TOVUTI YA UMMA YA COOPLINK — inaonekana kwenye anwani kuu kwa mtu ambaye hajaingia.
//   Aliyeingia anaona dashibodi yake kama kawaida. Maelezo yote yanaendana na huduma zilizojengwa.
//   Mawasiliano yanatoka kwenye wasifu wa kampuni (Owner → Business Center) — hakuna namba kwenye code.
// =====================================================================
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { useContact } from '../components/CompanyContact';
import { LogoMark } from '../components/Logo';
import '../website.css';

type L = 'sw' | 'en';
const ic = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I = {
  mem: ic(<><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.4" /><path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M15.5 14.2A4 4 0 0 1 21 18v1" /></>),
  grp: ic(<><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-1.5A5.5 5.5 0 0 1 10.5 14h3a5.5 5.5 0 0 1 5.5 5.5V21" /></>),
  phone: ic(<><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></>),
  box: ic(<><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>),
  card: ic(<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>),
  cart: ic(<><path d="M3 4h2l2.4 11h10.2L20 8H6.3" /><circle cx="9" cy="19.5" r="1.4" /><circle cx="17" cy="19.5" r="1.4" /></>),
  coin: ic(<><ellipse cx="9" cy="7" rx="6" ry="2.6" /><path d="M3 7v4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V7" /><path d="M9 16.6c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-4c0-1.4-2.7-2.6-6-2.6" /></>),
  chart: ic(<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />),
  doc: ic(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>),
  sms: ic(<><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12h5" /></>),
  lock: ic(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>),
  leaf: ic(<><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" /><path d="M5 19 13 11" /></>),
  shield: ic(<><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>),
  globe: ic(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></>),
  check: ic(<path d="m5 12.5 4.2 4.2L19 7" />),
  down: ic(<path d="m6 9 6 6 6-6" />),
  menu: ic(<path d="M4 6h16M4 12h16M4 18h16" />),
  x: ic(<path d="M6 6l12 12M18 6 6 18" />),
  arrow: ic(<path d="M5 12h14M13 6l6 6-6 6" />),
  call: ic(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />),
};

// ---------------- Maudhui (Kiswahili / English) ----------------
const S = (sw: string, en: string) => ({ sw, en });
type T = { sw: string; en: string };
interface Item { icon: keyof typeof I; t: T; d: T; to?: string }

const SERVICES: Item[] = [
  { icon: 'mem', t: S('Wanachama na Vikundi', 'Members and Groups'), d: S('Daftari la wakulima, idhini ya uanachama, vikundi vya dhamana na portal ya mkulima.', 'Farmer register, membership approval, guarantee groups and the farmer portal.') },
  { icon: 'box', t: S('Pembejeo na Stoo', 'Inputs and Store'), d: S('Kupokea mzigo, kugawa pembejeo kwa mkopo kulingana na makisio, na kumkabidhi mkulima kwa OTP.', 'Receive stock, issue inputs on credit against estimates, and hand over with the farmer’s OTP.') },
  { icon: 'card', t: S('Mikopo ya Wakulima', 'Farmer Loans'), d: S('Mikopo ya kuni, grading na miti kwa dola, yenye vikomo kwa ekari na riba yake.', 'Firewood, grading and tree loans in US dollars, with per-acre limits and interest.') },
  { icon: 'cart', t: S('Mauzo ya Tumbaku', 'Tobacco Sales'), d: S('Mabelo kwa daraja na bei ya msimu, makato ya kisheria na hesabu ya kila mkulima.', 'Bales by grade and season price, statutory deductions and each farmer’s settlement.') },
  { icon: 'coin', t: S('Fedha na Uhasibu', 'Finance and Accounting'), d: S('Daftari kuu, benki, mishahara, mali za chama na taarifa zote za fedha.', 'General ledger, banking, payroll, fixed assets and all financial statements.') },
  { icon: 'sms', t: S('SMS na OTP', 'SMS and OTP'), d: S('Taarifa kwa wakulima, matangazo ya vikao na uthibitisho wa kuingia kwa SMS.', 'Farmer notifications, meeting announcements and sign-in verification by SMS.') },
];
const ABOUT: Item[] = [
  { icon: 'leaf', t: S('COOPLINK ni nini', 'What is COOPLINK'), d: S('Mfumo wa kidijitali wa kusimamia Vyama vya Msingi vya Ushirika wa Masoko ya Mazao (AMCOS).', 'A digital management system for Agricultural Marketing Cooperative Societies (AMCOS).'), to: 'kuhusu' },
  { icon: 'shield', t: S('Kwa nini COOPLINK', 'Why COOPLINK'), d: S('Kila muamala unaidhinishwa na kurekodiwa kudumu — kila shilingi ikiwa wazi.', 'Every transaction is approved and permanently recorded — every shilling accounted for.'), to: 'uwajibikaji' },
  { icon: 'chart', t: S('Jinsi inavyofanya kazi', 'How it works'), d: S('Mzunguko mzima wa msimu kuanzia usajili hadi malipo ya mkulima.', 'The whole season cycle, from registration to farmer payment.'), to: 'jinsi' },
  { icon: 'call', t: S('Wasiliana nasi', 'Contact us'), d: S('Omba maonyesho ya mfumo kwa chama chako au tupigie simu.', 'Request a demonstration for your society or give us a call.'), to: 'wasiliana' },
];
const ROLES: { k: T; h: T; items: T[] }[] = [
  { k: S('MENEJA', 'MANAGER'), h: S('Anaidhinisha', 'Approves'), items: [S('Kituo kimoja cha idhini zote', 'One centre for all approvals'), S('Anaona athari kabla ya kuamua', 'Sees the impact before deciding'), S('Matangazo ya vikao kwa SMS', 'Meeting notices by SMS')] },
  { k: S('MHASIBU', 'ACCOUNTANT'), h: S('Anahesabu', 'Accounts'), items: [S('Hesabu za malipo za wakulima', 'Farmer settlements'), S('Daftari kuu na benki', 'Ledger and banking'), S('Mishahara na taarifa za fedha', 'Payroll and financial statements')] },
  { k: S('STOREKEEPER', 'STOREKEEPER'), h: S('Anagawa', 'Distributes'), items: [S('Kupokea mzigo stoo', 'Receives stock'), S('Kugawa pembejeo kwa makisio', 'Issues inputs against estimates'), S('Kukabidhi kwa OTP ya mkulima', 'Hands over with the farmer’s OTP')] },
  { k: S('MKULIMA', 'FARMER'), h: S('Anaona', 'Sees'), items: [S('Pembejeo na deni lake', 'His inputs and debt'), S('Mauzo na malipo yake', 'His sales and payments'), S('SMS za taarifa muhimu', 'SMS for key updates')] },
];
const FLOW: { icon: keyof typeof I; t: T; d: T }[] = [
  { icon: 'mem', t: S('Sajili', 'Register'), d: S('Wakulima, idhini ya uanachama na vikundi', 'Farmers, membership approval and groups') },
  { icon: 'leaf', t: S('Makisio', 'Estimate'), d: S('Ekari, mabani na pembejeo za kila mkulima', 'Acres, barns and inputs per farmer') },
  { icon: 'box', t: S('Pembejeo', 'Inputs'), d: S('Kwa mkopo, kulingana na makisio', 'On credit, against the estimate') },
  { icon: 'card', t: S('Mikopo', 'Loans'), d: S('Kuni, grading na miti, kwa dola', 'Firewood, grading and trees, in USD') },
  { icon: 'cart', t: S('Mauzo', 'Sales'), d: S('Mabelo kwa daraja na bei ya msimu', 'Bales by grade and season price') },
  { icon: 'coin', t: S('Malipo', 'Payment'), d: S('Makato, kukata deni, malipo halisi', 'Deductions, debt recovery, net pay') },
  { icon: 'chart', t: S('Ripoti', 'Reports'), d: S('Daftari kuu na taarifa za fedha', 'Ledger and financial statements') },
];
const GROUPS: { t: T; d: T; items: Item[] }[] = [
  { t: S('Wakulima', 'Farmers'), d: S('Daftari moja la kuaminika la kila mwanachama.', 'One trusted record for every member.'), items: [
    { icon: 'mem', t: S('Usajili wa wakulima', 'Farmer registration'), d: S('Namba ya uanachama, kijiji, simu na namba ya pesa; kupakia daftari zima kutoka Excel.', 'Membership number, village, phone and mobile-money number; import a whole register from Excel.') },
    { icon: 'grp', t: S('Vikundi vya dhamana', 'Guarantee groups'), d: S('Viongozi, kujiunga na kuhama kwa idhini, na deni la jumla la kikundi.', 'Leaders, approved joining and leaving, and the group’s total debt.') },
    { icon: 'phone', t: S('Portal ya mkulima', 'Farmer portal'), d: S('Mkulima anaingia kwa namba yake na PIN kuona pembejeo, deni, mauzo na malipo yake.', 'Farmers sign in with their number and PIN to see inputs, debt, sales and payments.') },
  ] },
  { t: S('Msimu', 'Season'), d: S('Kutoka makisio hadi sokoni.', 'From estimates to market.'), items: [
    { icon: 'box', t: S('Pembejeo na stoo', 'Inputs and store'), d: S('Kupokea mzigo, hesabu ya stoo, ugawaji kwa mkopo na kukabidhi kwa OTP ya mkulima.', 'Stock receipts, stock counts, credit issues and handover with the farmer’s OTP.') },
    { icon: 'card', t: S('Mikopo ya wakulima', 'Farmer loans'), d: S('Kuni, grading na miti kwa USD, yenye kikomo kwa ekari, trip au makisio na riba yake.', 'Firewood, grading and trees in USD, limited per acre, trip or estimate, with interest.') },
    { icon: 'cart', t: S('Mauzo na makato', 'Sales and deductions'), d: S('Bei ya kila daraja kwa msimu, makato ya ushuru na hesabu ya malipo ya kila mkulima.', 'Season price per grade, levies and each farmer’s settlement.') },
  ] },
  { t: S('Fedha za chama', 'Society finance'), d: S('Uhasibu kamili, si daftari la mkono.', 'Full accounting, not a hand-written book.'), items: [
    { icon: 'coin', t: S('Miamala na benki', 'Transactions and bank'), d: S('Mapato, matumizi, vocha, uhamisho na usuluhishi wa benki.', 'Income, expenses, vouchers, transfers and bank reconciliation.') },
    { icon: 'chart', t: S('Taarifa za fedha', 'Financial statements'), d: S('Trial balance, mapato na matumizi, mizania na mtiririko wa fedha.', 'Trial balance, income and expenditure, balance sheet and cash flow.') },
    { icon: 'doc', t: S('Mishahara na mali', 'Payroll and assets'), d: S('PAYE, NSSF, WCF na SDL; rejista ya mali za chama na uchakavu.', 'PAYE, NSSF, WCF and SDL; fixed-asset register and depreciation.') },
  ] },
  { t: S('Mawasiliano', 'Communication'), d: S('Taarifa sahihi kwa wakati.', 'The right information on time.'), items: [
    { icon: 'sms', t: S('SMS kwa wakulima', 'SMS to farmers'), d: S('Usajili, pembejeo, mauzo na malipo; matangazo ya vikao kwa kijiji au kikundi.', 'Registration, inputs, sales and payments; meeting notices by village or group.') },
    { icon: 'lock', t: S('OTP ya usalama', 'Security OTP'), d: S('Kuingia, kurejesha nenosiri na kubadilisha namba ya mkulima kwa SMS.', 'Sign-in, password reset and farmer phone changes verified by SMS.') },
    { icon: 'leaf', t: S('Hali ya mafunzo', 'Training mode'), d: S('Watumishi wanajifunza kwa data ya mazoezi, kisha inafutwa kabla ya kuanza rasmi.', 'Staff practise with training data, which is cleared before going live.') },
  ] },
];
const TX = {
  nav: { home: S('Mwanzo', 'Home'), about: S('Kuhusu Sisi', 'About'), services: S('Huduma za Mfumo', 'Services'), who: S('Wanaonufaika', 'Who benefits'), how: S('Jinsi Inavyofanya Kazi', 'How it works'), contact: S('Wasiliana Nasi', 'Contact') },
  login: S('Ingia kwenye mfumo', 'Sign in'), cont: S('Endelea kwenye mfumo', 'Continue to the system'), demo: S('Omba maonyesho', 'Request a demo'), demoFor: S('Omba maonyesho kwa chama chako', 'Request a demo for your society'),
  pill: S('Toleo la kwanza linafanya kazi sasa', 'Version 1 is live'),
  lead: S('COOPLINK ni mfumo wa kidijitali wa kusimamia Vyama vya Msingi vya Ushirika wa Masoko ya Mazao (AMCOS) — wakulima, pembejeo kwa mkopo, mauzo kwa madaraja, makato, malipo na hesabu za chama, kila hatua ikiidhinishwa na kurekodiwa.',
    'COOPLINK is a digital system for Agricultural Marketing Cooperative Societies (AMCOS) — farmers, inputs on credit, sales by grade, deductions, payments and society accounts, with every step approved and recorded.'),
  shotNote: S('Picha za mfumo halisi · taarifa za majaribio', 'Real system screens · demo data'),
  band: S('Kwa Kiswahili, ', 'In Swahili, '), band2: S('kwenye kompyuta na simu', 'on computer and phone'),
  b1: S('Kiswahili na Kiingereza', 'Swahili and English'), b2: S('Kivinjari cha simu au kompyuta', 'Phone or computer browser'), b3: S('Kuingia kwa OTP ya SMS', 'Sign-in with SMS OTP'), b4: S('Idhini kwa kila muamala', 'Approval for every transaction'),
  howK: S('Jinsi inavyofanya kazi', 'How it works'), howH: S('Mzunguko mzima wa msimu, hatua kwa hatua', 'The whole season, step by step'),
  howP: S('Kila hatua inasasisha kumbukumbu ileile ya mkulima — hivyo deni, mauzo na malipo yake yanaonekana sehemu moja.', 'Every step updates the same farmer record — so debt, sales and payments are seen in one place.'),
  svcK: S('Huduma za mfumo', 'System services'), svcH: S('Kila kitu chama kinachohitaji', 'Everything a society needs'), svcP: S('Huduma hizi zote zimejengwa na zinafanya kazi kwenye toleo la sasa la COOPLINK.', 'All of these services are built and working in the current version of COOPLINK.'),
  whoK: S('Wanaonufaika', 'Who benefits'), whoH: S('Kila cheo kina sehemu yake', 'Every role has its place'), whoP: S('Kila mtumishi anaona huduma zinazomhusu tu — ruhusa zinakaguliwa kwenye server, si kwa kuficha menyu.', 'Each staff member sees only their own work — permissions are enforced on the server, not by hiding menus.'),
  accK: S('Uwajibikaji', 'Accountability'), accH: S('Kila shilingi ikiwa wazi', 'Every shilling accounted for'),
  a1: S('Maker–checker', 'Maker–checker'), a1d: S('Mmoja anaandaa, mwingine anaidhinisha. Hakuna anayeidhinisha ombi lake mwenyewe.', 'One prepares, another approves. Nobody approves their own request.'),
  a2: S('Kumbukumbu zisizofutika', 'Permanent records'), a2d: S('Muamala uliokamilika haubadilishwi wala kufutwa — unasahihishwa kwa reversal yenye idhini.', 'Completed transactions are never edited or deleted — they are corrected by an approved reversal.'),
  a3: S('Usalama wa kuingia', 'Secure sign-in'), a3d: S('Nenosiri lililosimbwa, OTP ya SMS na 2FA kwa hiari.', 'Hashed passwords, SMS OTP and optional 2FA.'),
  ctaH: S('Lete chama chako kwenye COOPLINK', 'Bring your society to COOPLINK'),
  ctaP: S('Tutasajili chama, kuunda akaunti za watumishi na kupakia daftari la wakulima. Watumishi wanaanza kwa hali ya mafunzo kabla ya kuanza rasmi.', 'We register the society, create staff accounts and import the farmer register. Staff start in training mode before going live.'),
  call: S('Piga', 'Call'), aboutSide: S('COOPLINK inaunganisha chama, watumishi wake na wakulima kwenye kumbukumbu moja ya kuaminika.', 'COOPLINK connects the society, its staff and its farmers through one trusted record.'),
  svcSide: S('Kila kitu ambacho chama cha ushirika kinahitaji kuendesha msimu mzima — kwenye jukwaa moja.', 'Everything a cooperative needs to run a whole season — on one platform.'),
  whoSide: S('Kila mtu anayehusika na chama anaona sehemu yake.', 'Everyone involved in the society sees their own part.'), all: S('Ona zote', 'See all'),
  fDesc: S('Mfumo wa kidijitali wa kusimamia Vyama vya Msingi vya Ushirika nchini Tanzania.', 'A digital management system for primary cooperative societies in Tanzania.'),
  fSys: S('Mfumo', 'System'), fCo: S('Kampuni', 'Company'), fCt: S('Wasiliana', 'Contact'), terms: S('Masharti ya huduma', 'Terms of service'), privacy: S('Sera ya faragha', 'Privacy policy'), farmer: S('Portal ya mkulima', 'Farmer portal'),
};

// ---------------- Vipengele ----------------
function useOutside(ref: React.RefObject<HTMLElement | null>, on: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) on(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') on(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, on]);
}
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function MegaCards({ items, lang, onPick }: { items: Item[]; lang: L; onPick: (to?: string) => void }) {
  return (
    <div className="ws-cards">
      {items.map((c) => (
        <button type="button" key={c.t.sw} className="ws-card" onClick={() => onPick(c.to)}>
          <span className="ws-ic">{I[c.icon]}</span>
          <span><b>{c.t[lang]}</b><small>{c.d[lang]}</small></span>
        </button>
      ))}
    </div>
  );
}

function DemoModal({ lang, onClose }: { lang: L; onClose: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', amcosName: '', region: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('/public/demo-request', { method: 'POST', body: f }); setDone(true); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const sw = lang === 'sw';
  return (
    <div className="ws-modal" role="dialog" aria-modal="true">
      <button type="button" className="ws-modal-bg" aria-label="Funga" onClick={onClose} />
      <div className="ws-modal-card">
        <button type="button" className="ws-x" aria-label="Funga" onClick={onClose}>{I.x}</button>
        {done ? (
          <div className="ws-done">
            <span className="ws-ic big">{I.check}</span>
            <h3>{sw ? 'Asante! Ombi lako limepokelewa' : 'Thank you! Your request was received'}</h3>
            <p>{sw ? 'Timu yetu itakupigia simu kupanga maonyesho ya COOPLINK kwa chama chako.' : 'Our team will call you to arrange a COOPLINK demonstration for your society.'}</p>
            <button type="button" className="ws-btn green" onClick={onClose}>{sw ? 'Sawa' : 'OK'}</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h3>{TX.demoFor[lang]}</h3>
            <p className="ws-muted">{sw ? 'Jaza taarifa fupi, nasi tutakupigia kupanga siku ya kukuonyesha mfumo.' : 'Fill in a few details and we will call you to arrange a demonstration.'}</p>
            <label>{sw ? 'Jina lako' : 'Your name'}<input required value={f.name} onChange={set('name')} autoComplete="name" /></label>
            <label>{sw ? 'Namba ya simu' : 'Phone number'}<input required type="tel" inputMode="tel" placeholder="0712 345 678" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
            <label>{sw ? 'Jina la chama (AMCOS)' : 'Society (AMCOS) name'}<input required value={f.amcosName} onChange={set('amcosName')} /></label>
            <label>{sw ? 'Mkoa / Wilaya' : 'Region / District'}<input value={f.region} onChange={set('region')} /></label>
            <label>{sw ? 'Ujumbe (si lazima)' : 'Message (optional)'}<textarea rows={3} value={f.message} onChange={set('message')} /></label>
            <input className="ws-hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden="true" />
            {err && <div className="ws-err">{err}</div>}
            <button type="submit" className="ws-btn gold wide" disabled={busy}>{busy ? '…' : TX.demo[lang]}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function Website({ signedIn = false, onEnter }: { signedIn?: boolean; onEnter?: () => void } = {}) {
  const { lang: l0, setLang } = usePrefs();
  const lang: L = l0 === 'en' ? 'en' : 'sw';
  const c = useContact();
  const [mega, setMega] = useState<'about' | 'services' | 'who' | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [acc, setAcc] = useState<string | null>('services');
  const [demo, setDemo] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headRef = useRef<HTMLElement>(null);
  useOutside(headRef, () => setMega(null));
  useEffect(() => { document.title = 'COOPLINK — Cooperative Management System'; }, []);
  useEffect(() => { const s = () => setScrolled(window.scrollY > 20); s(); window.addEventListener('scroll', s, { passive: true }); return () => window.removeEventListener('scroll', s); }, []);
  useEffect(() => { document.body.style.overflow = drawer || demo ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [drawer, demo]);
  // Sehemu zinaonekana taratibu zikifika kwenye skrini
  useEffect(() => {
    const els = document.querySelectorAll('.ws-reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  const phones = [c?.phone, c?.supportPhone].filter(Boolean).join(' / ').split(/[/,]/).map((x) => x.trim()).filter((x, i, a) => x && a.indexOf(x) === i);
  const firstPhone = phones[0];
  const pick = (to?: string) => { setMega(null); setDrawer(false); if (to) setTimeout(() => go(to), 50); else setTimeout(() => go('huduma'), 50); };
  const megaData = {
    about: { title: TX.nav.about[lang], side: TX.aboutSide[lang], items: ABOUT, to: 'kuhusu' },
    services: { title: TX.nav.services[lang], side: TX.svcSide[lang], items: SERVICES, to: 'huduma' },
    who: { title: TX.nav.who[lang], side: TX.whoSide[lang], items: ROLES.map((r, i) => ({ icon: (['shield', 'chart', 'box', 'mem'] as const)[i], t: S(r.k.sw.charAt(0) + r.k.sw.slice(1).toLowerCase(), r.k.en.charAt(0) + r.k.en.slice(1).toLowerCase()), d: S(r.items.map((x) => x.sw).join(' · '), r.items.map((x) => x.en).join(' · ')), to: 'wanaonufaika' })), to: 'wanaonufaika' },
  } as const;
  const M = mega ? megaData[mega] : null;
  const NavDrop = ({ k, label }: { k: 'about' | 'services' | 'who'; label: string }) => (
    <button type="button" className={`ws-it ${mega === k ? 'on' : ''}`} aria-expanded={mega === k}
      onMouseEnter={() => setMega(k)} onClick={() => setMega(mega === k ? null : k)}>{label}{I.down}</button>
  );
  // Aliyeingia tayari: "Endelea kwenye mfumo" (anarudi kazini); mgeni: "Ingia kwenye mfumo"
  const Enter = ({ wide = false }: { wide?: boolean }) => signedIn
    ? <button type="button" className={`ws-btn gold${wide ? ' wide' : ''}`} onClick={() => { setDrawer(false); onEnter?.(); }}>{TX.cont[lang]} {I.arrow}</button>
    : <Link className={`ws-btn gold${wide ? ' wide' : ''}`} to="/login">{TX.login[lang]} {I.arrow}</Link>;
  const Lang = () => (
    <div className="ws-lang" role="group" aria-label="Lugha">
      <button type="button" className={lang === 'sw' ? 'on' : ''} onClick={() => setLang('sw')}>SW</button>
      <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
    </div>
  );

  return (
    <div className="ws">
      <header ref={headRef} className={`ws-top ${scrolled ? 'scrolled' : ''}`} onMouseLeave={() => setMega(null)}>
        <div className="ws-bar">
          <a className="ws-brand" href="#mwanzo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <LogoMark size={44} animate />
            <span><b>Coop<i>Link</i></b><small>COOPERATIVE MANAGEMENT SYSTEM</small></span>
          </a>
          <div className="ws-slogan">Connecting Cooperatives. <em>Empowering Farmers</em></div>
          <button type="button" className="ws-burger" aria-label="Menyu" onClick={() => setDrawer(true)}>{I.menu}</button>
        </div>
        <nav className="ws-nav" aria-label="Menyu kuu">
          <button type="button" className="ws-it" onMouseEnter={() => setMega(null)} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>{TX.nav.home[lang]}</button>
          <NavDrop k="about" label={TX.nav.about[lang]} />
          <NavDrop k="services" label={TX.nav.services[lang]} />
          <NavDrop k="who" label={TX.nav.who[lang]} />
          <button type="button" className="ws-it" onMouseEnter={() => setMega(null)} onClick={() => go('jinsi')}>{TX.nav.how[lang]}</button>
          <button type="button" className="ws-it" onMouseEnter={() => setMega(null)} onClick={() => go('wasiliana')}>{TX.nav.contact[lang]}</button>
          <span className="ws-sp" />
          <Lang />
          <Enter />
        </nav>
        {M && (
          <div className="ws-mega" key={mega}>
            <div className="ws-mega-side"><h3>{M.title}</h3><p>{M.side}</p><button type="button" onClick={() => pick(M.to)}>{TX.all[lang]} {I.arrow}</button></div>
            <MegaCards items={M.items as unknown as Item[]} lang={lang} onPick={pick} />
          </div>
        )}
      </header>

      {/* Menyu ya simu */}
      {drawer && (
        <div className="ws-drawer" role="dialog" aria-modal="true">
          <div className="ws-drawer-hd">
            <span className="ws-brand"><LogoMark size={38} /><span><b>Coop<i>Link</i></b></span></span>
            <button type="button" className="ws-burger" aria-label="Funga" onClick={() => setDrawer(false)}>{I.x}</button>
          </div>
          <button type="button" className="ws-acc-t" onClick={() => { setDrawer(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{TX.nav.home[lang]}</button>
          {(['about', 'services', 'who'] as const).map((k) => (
            <div key={k} className="ws-acc">
              <button type="button" className={`ws-acc-t ${acc === k ? 'on' : ''}`} onClick={() => setAcc(acc === k ? null : k)}>{megaData[k].title}<span>{acc === k ? '−' : '+'}</span></button>
              {acc === k && <MegaCards items={megaData[k].items as unknown as Item[]} lang={lang} onPick={pick} />}
            </div>
          ))}
          <button type="button" className="ws-acc-t" onClick={() => pick('jinsi')}>{TX.nav.how[lang]}</button>
          <button type="button" className="ws-acc-t" onClick={() => pick('wasiliana')}>{TX.nav.contact[lang]}</button>
          <div className="ws-drawer-ft">
            <Lang />
            <Enter wide />
            <button type="button" className="ws-btn ghost wide" onClick={() => { setDrawer(false); setDemo(true); }}>{TX.demo[lang]}</button>
          </div>
        </div>
      )}

      <section className="ws-hero" id="mwanzo">
        <div className="ws-hero-bg" /><div className="ws-hero-sh" />
        <div className="ws-hero-in">
          <span className="ws-pill"><i />{TX.pill[lang]}</span>
          <h1>Connecting Cooperatives.<em>Empowering Farmers</em></h1>
          <p>{TX.lead[lang]}</p>
          <div className="ws-cta">
            <Enter />
            <button type="button" className="ws-btn ghost" onClick={() => setDemo(true)}>{TX.demoFor[lang]}</button>
          </div>
        </div>
        <div className="ws-shots" aria-hidden="true">
          <div className="ws-shot"><div className="ws-shot-bar"><i /><i /><i /></div><img src="/site/dash.webp" alt="" /></div>
          <div className="ws-phone"><img src="/site/phone.webp" alt="" /></div>
          <div className="ws-note">{TX.shotNote[lang]}</div>
        </div>
      </section>

      <div className="ws-band">
        <div className="ws-band-t">{TX.band[lang]}<em>{TX.band2[lang]}</em></div>
        <span>{I.globe}{TX.b1[lang]}</span><span>{I.phone}{TX.b2[lang]}</span><span>{I.lock}{TX.b3[lang]}</span><span>{I.shield}{TX.b4[lang]}</span>
      </div>

      <section className="ws-sec ws-reveal" id="jinsi">
        <div className="ws-k">{TX.howK[lang]}</div><h2>{TX.howH[lang]}</h2><p className="ws-sub">{TX.howP[lang]}</p>
        <div className="ws-flow" id="kuhusu">
          {FLOW.map((s, i) => (
            <div className="ws-st" key={s.t.sw} style={{ transitionDelay: `${i * 70}ms` }}>
              <div className="ws-n">{I[s.icon]}<em>{i + 1}</em></div>
              <div><b>{s.t[lang]}</b><small>{s.d[lang]}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="ws-sec alt" id="huduma">
        <div className="ws-reveal"><div className="ws-k">{TX.svcK[lang]}</div><h2>{TX.svcH[lang]}</h2><p className="ws-sub">{TX.svcP[lang]}</p></div>
        {GROUPS.map((g) => (
          <div className="ws-grp ws-reveal" key={g.t.sw}>
            <div><h3>{g.t[lang]}</h3><p>{g.d[lang]}</p></div>
            <div className="ws-gc">
              {g.items.map((f) => <div className="ws-f" key={f.t.sw}><span className="ws-ic">{I[f.icon]}</span><div><h4>{f.t[lang]}</h4><p>{f.d[lang]}</p></div></div>)}
            </div>
          </div>
        ))}
      </section>

      <section className="ws-sec" id="wanaonufaika">
        <div className="ws-reveal"><div className="ws-k">{TX.whoK[lang]}</div><h2>{TX.whoH[lang]}</h2><p className="ws-sub">{TX.whoP[lang]}</p></div>
        <div className="ws-roles ws-reveal">
          {ROLES.map((r) => (
            <div className="ws-role" key={r.k.sw}><div className="ws-rk">{r.k[lang]}</div><h4>{r.h[lang]}</h4>
              <ul>{r.items.map((x) => <li key={x.sw}>{I.check}{x[lang]}</li>)}</ul></div>
          ))}
        </div>
      </section>

      <section className="ws-sec alt" id="uwajibikaji">
        <div className="ws-two">
          <div className="ws-reveal"><div className="ws-k">{TX.accK[lang]}</div><h2>{TX.accH[lang]}</h2>
            <div className="ws-chk">
              <div><span className="ws-ic">{I.shield}</span><p><b>{TX.a1[lang]}</b>{TX.a1d[lang]}</p></div>
              <div><span className="ws-ic">{I.doc}</span><p><b>{TX.a2[lang]}</b>{TX.a2d[lang]}</p></div>
              <div><span className="ws-ic">{I.lock}</span><p><b>{TX.a3[lang]}</b>{TX.a3d[lang]}</p></div>
            </div>
          </div>
          <img className="ws-reveal" src="/site/issues.webp" alt="" loading="lazy" />
        </div>
      </section>

      <section className="ws-cta2 ws-reveal" id="wasiliana">
        <h2>{TX.ctaH[lang]}</h2><p>{TX.ctaP[lang]}</p>
        <div className="ws-row">
          <button type="button" className="ws-btn gold" onClick={() => setDemo(true)}>{TX.demo[lang]} {I.arrow}</button>
          {firstPhone && <a className="ws-btn ghost" href={`tel:${firstPhone.replace(/[\s-]/g, '')}`}>{I.call}{TX.call[lang]}: {firstPhone}</a>}
        </div>
      </section>

      <footer className="ws-foot">
        <div>
          <span className="ws-brand"><LogoMark size={40} /><span><b>Coop<i>Link</i></b><small>COOPERATIVE MANAGEMENT SYSTEM</small></span></span>
          <p>{TX.fDesc[lang]}</p>
        </div>
        <div><h5>{TX.fSys[lang]}</h5><button type="button" onClick={() => go('huduma')}>{TX.nav.services[lang]}</button><button type="button" onClick={() => go('jinsi')}>{TX.nav.how[lang]}</button><Link to="/login">{TX.login[lang]}</Link><Link to="/mkulima">{TX.farmer[lang]}</Link></div>
        <div><h5>{TX.fCo[lang]}</h5><button type="button" onClick={() => go('kuhusu')}>{TX.nav.about[lang]}</button><Link to="/terms">{TX.terms[lang]}</Link><Link to="/privacy">{TX.privacy[lang]}</Link></div>
        {(phones.length > 0 || c?.email || c?.address) && <div><h5>{TX.fCt[lang]}</h5>{phones.map((p) => <a key={p} href={`tel:${p.replace(/[\s-]/g, '')}`}>{p}</a>)}{c?.email && <a href={`mailto:${c.email}`}>{c.email}</a>}{c?.address && <span>{c.address}</span>}</div>}
        <div className="ws-cp"><span>© {new Date().getFullYear()} COOPLINK · Powered by <b>{c?.companyName || 'DUKALANGU SOLUTION'}</b></span><span>Connecting Cooperatives. Empowering Farmers</span></div>
      </footer>

      {demo && <DemoModal lang={lang} onClose={() => setDemo(false)} />}
    </div>
  );
}
