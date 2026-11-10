// =====================================================================
//  MWONGOZO WA MAFUNZO: kila ukurasa, kwa kila cheo, unaonekana mara ya kwanza tu.
//  Unafungwa na "Nimeelewa" (unahifadhiwa kwenye kifaa hiki) na unarudishwa kwa kitufe cha "Mwongozo".
// =====================================================================
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/prefs';

type Role = 'AMCOS_ADMIN' | 'ACCOUNTANT' | 'CLERK' | '*';
interface Guide { title: string; steps: string[] }

/** Ufunguo = sehemu ya kwanza ya njia ('' = dashibodi). Cheo maalum kwanza, kisha '*'. */
const GUIDES: Record<string, Partial<Record<Role, Guide>>> = {
  '': {
    AMCOS_ADMIN: { title: 'Karibu, Meneja', steps: [
      'Dashibodi hii inaonyesha hali ya chama leo: wakulima, pembejeo, mauzo na fedha.',
      'Kila kitendo muhimu (usajili, ugawaji, malipo, mauzo) kinasubiri idhini yako kwenye "Idhini".',
      'Tahadhari za fedha (wanunuzi waliochelewa, bajeti iliyozidi) zinaonekana juu kabisa.',
      'Huwezi kuidhinisha ombi ulilolianzisha mwenyewe — ni kinga ya fedha za chama.',
    ] },
    ACCOUNTANT: { title: 'Karibu, Mhasibu', steps: [
      'Wewe ndiye unarekodi fedha zote: mapato, matumizi, mauzo ya tumbaku na malipo ya wakulima.',
      'Kila muamala unaandaliwa na wewe, unaidhinishwa na Meneja, kisha unaukamilisha fedha zikitoka.',
      'Ada ya CoopLink inalipwa na wewe kwenye ukurasa wa "Ada ya CoopLink".',
      'Tahadhari za fedha zinaonekana juu ya dashibodi yako.',
    ] },
    CLERK: { title: 'Karibu, Stokipa', steps: [
      'Wewe unasajili wakulima, unapokea pembejeo stoo na kuzigawa kwa wakulima.',
      'Ugawaji unaanza kama ombi; Meneja akiidhinisha, stoo inapungua na deni linaingia kwa mkulima.',
      'Tumia kitufe cha "Pata msaada" juu kama kuna jambo hulielewi.',
    ] },
  },
  members: { '*': { title: 'Wanachama', steps: [
    'Tafuta mkulima kwa jina, namba ya uanachama, simu au NIDA.',
    'Mkulima mpya anasajiliwa kwa hatua 4: taarifa binafsi, uanachama, mzamini na malipo.',
    'Usajili mpya unasubiri uthibitisho wa Meneja kabla ya kupewa pembejeo.',
    'Namba ya malipo ya simu inalinganishwa na jina la mwenye namba; jina likitofautiana, eleza sababu.',
  ] } },
  approvals: {
    AMCOS_ADMIN: { title: 'Idhini', steps: [
      'Hapa yapo maombi yote yanayosubiri uamuzi wako.',
      'Fungua ombi, soma maelezo, andika sababu, kisha idhinisha au kataa kwa nenosiri lako.',
      'Kwa pembejeo mpya unaweza kurekebisha idadi au bei kabla ya kuidhinisha.',
      'Kila uamuzi unahifadhiwa kwenye kumbukumbu (audit) na hauwezi kufutwa.',
    ] },
    '*': { title: 'Maombi yangu', steps: [
      'Hapa unaona maombi uliyotuma na hali yake: yanasubiri, yameidhinishwa au yamekataliwa.',
      'Ombi likikataliwa, sababu ya Meneja inaonekana ndani yake.',
      'Unaweza kuondoa ombi lako kabla halijaamuliwa.',
    ] },
  },
  inputs: { '*': { title: 'Bidhaa na Stoo', steps: [
    'Orodha ya pembejeo (mbolea, mbegu, dawa) na kiasi kilichopo stoo.',
    'Mzigo mpya unapokelewa kwa ombi; Meneja akiidhinisha, stoo inaongezeka.',
    'Bei ya kumkopesha mkulima ndiyo inayoingia kwenye deni lake.',
  ] } },
  'input-issues': { '*': { title: 'Ugawaji wa Pembejeo', steps: [
    'Chagua mkulima, weka pembejeo na idadi, kisha tuma ombi.',
    'Stoo haipungui mpaka Meneja aidhinishe; kisha deni linaingia kwenye ledger ya mkulima.',
    'Ugawaji uliokamilika haufutwi — unasahihishwa kwa REVERSAL inayoidhinishwa.',
  ] } },
  estimates: { '*': { title: 'Makisio', steps: [
    'Makisio ni kiasi cha tumbaku mkulima anatarajia kuzalisha msimu huu.',
    'Yanatumika kupanga pembejeo na kukadiria mapato ya chama.',
  ] } },
  finance: { '*': { title: 'Fedha za Chama', steps: [
    'Miamala: mapato, matumizi na malipo — kila moja linaandaliwa, linaidhinishwa, kisha linakamilishwa.',
    'Ukiweka matumizi, mfumo unakuonya kama yatazidi bajeti ya kundi hilo.',
    'Bajeti: weka bajeti ya kila kundi na ulinganishe na matumizi halisi kila mwezi.',
    'Muamala uliokamilika haufutwi — unasahihishwa kwa ombi la kusahihisha.',
  ] } },
  sales: { '*': { title: 'Mauzo ya tumbaku', steps: [
    'Anza na kanuni za makato (ushuru, deni la pembejeo), kisha fungua soko.',
    'Ingiza mabelo (au bandika kutoka Excel), hakiki hesabu, kisha wasilisha kwa Meneja.',
    'Baada ya idhini, andaa orodha ya malipo ya wakulima.',
    'Wanunuzi: ona deni la kila mnunuzi, tarehe ya kulipa, na chapisha barua ya madai.',
  ] } },
  'farmer-debts': { '*': { title: 'Madeni ya wakulima', steps: [
    'Ona deni la kila mkulima: pembejeo, mikopo, mauzo, makato na malipo.',
    'Fungua mkulima kuona "Taarifa ya mkulima" ya msimu wowote.',
    'Chapisha taarifa au hifadhi PDF kwa kumpa mkulima — ina sahihi za Mhasibu, Meneja na Mkulima.',
  ] } },
  kuni: { '*': { title: 'Pesa ya kuni', steps: [
    'Mikopo ya kuni inatolewa kwa kikomo cha ekari za mkulima.',
    'Orodha inaidhinishwa na Meneja kabla ya kutuma pesa.',
    'Mkopo na riba vinakatwa kwenye mauzo ya tumbaku.',
  ] } },
  groups: { '*': { title: 'Vikundi vya wakulima', steps: [
    'Kila mkulima ana deni lake, lakini kikundi kinadhamini wanachama wake.',
    'Mwenzao akishindwa kulipa, salio linakatwa kwa wanakikundi kwa uwiano wa malipo yao.',
  ] } },
  accounting: { '*': { title: 'Dashibodi ya fedha', steps: [
    'Muhtasari wa hali ya fedha: akaunti, madeni, na tahadhari.',
    'Daftari kuu linajazwa lenyewe kutoka kwenye miamala — hakuna kuandika mara mbili.',
  ] } },
  billing: {
    ACCOUNTANT: { title: 'Ada ya CoopLink', steps: [
      'Wewe ndiye unalipa ada ya CoopLink kwa simu (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa).',
      'Ukibonyeza "Lipa", ombi linatumwa kwenye simu — thibitisha kwa PIN yako.',
      'Risiti inapatikana papo hapo malipo yakithibitishwa.',
      'Ada isipolipwa kwa wakati, chama kinafungwa mpaka ilipwe.',
    ] },
    AMCOS_ADMIN: { title: 'Ada ya CoopLink', steps: [
      'Hapa unaona ada za chama, kilicholipwa na risiti.',
      'Kama chama kina Mhasibu, yeye ndiye analipa; vinginevyo unalipa wewe.',
    ] },
  },
  support: { '*': { title: 'Msaada', steps: [
    'Fungua tiketi ukiwa na tatizo, swali au ombi — unaweza kuambatisha picha ya skrini.',
    'Timu ya CoopLink inajibu hapa hapa; utaona jibu kwenye tiketi yako.',
  ] } },
};

function pick(path: string, role: string): Guide | null {
  const key = path.split('/').filter(Boolean)[0] ?? '';
  // Kurasa za ndani (mf. /members/123) hazina mwongozo tofauti — ni ukurasa wa orodha tu
  if (path.split('/').filter(Boolean).length > 1) return null;
  const g = GUIDES[key];
  if (!g) return null;
  return g[role as Role] ?? g['*'] ?? null;
}

const KEY = (uid: string) => `cl_guide_v1:${uid}`;
function load(uid: string): { seen: string[]; off: boolean } {
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) ?? 'null'); if (v && Array.isArray(v.seen)) return v; } catch { /* */ }
  return { seen: [], off: false };
}
function save(uid: string, v: { seen: string[]; off: boolean }) { try { localStorage.setItem(KEY(uid), JSON.stringify(v)); } catch { /* */ } }

export const OPEN_GUIDE = 'cl-guide-open';
/** Kipo mwongozo kwa ukurasa huu? (kwa kitufe cha "Mwongozo" juu) */
export function hasGuide(path: string, role: string) { return !!pick(path, role); }

export function PageGuide() {
  const { user } = useAuth();
  const loc = useLocation();
  const t = useT();
  const guide = user ? pick(loc.pathname, user.role) : null;
  const pageKey = `${user?.role}:${loc.pathname.split('/').filter(Boolean)[0] ?? ''}`;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user || !guide) { setShow(false); return; }
    const s = load(user.id);
    setShow(!s.off && !s.seen.includes(pageKey));
  }, [user, guide, pageKey]);

  useEffect(() => {
    const open = () => setShow(true);
    window.addEventListener(OPEN_GUIDE, open);
    return () => window.removeEventListener(OPEN_GUIDE, open);
  }, []);

  if (!user || !guide || !show) return null;
  const done = (off = false) => {
    const s = load(user.id);
    save(user.id, { seen: s.seen.includes(pageKey) ? s.seen : [...s.seen, pageKey], off: off || s.off });
    setShow(false);
  };
  return (
    <section className="card guide" role="note" aria-label={t('Mwongozo')}>
      <div className="guide-head">
        <span className="guide-icon" aria-hidden="true">💡</span>
        <div>
          <small>{t('Mwongozo wa ukurasa huu')}</small>
          <h3>{t(guide.title)}</h3>
        </div>
      </div>
      <ol className="guide-steps">{guide.steps.map((s) => <li key={s}>{t(s)}</li>)}</ol>
      <div className="guide-foot">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => done()}>{t('Nimeelewa')}</button>
        <button type="button" className="link-btn" onClick={() => done(true)}>{t('Usionyeshe miongozo tena')}</button>
      </div>
    </section>
  );
}
