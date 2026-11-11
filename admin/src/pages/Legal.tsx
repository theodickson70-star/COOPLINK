// =====================================================================
//  MASHARTI YA HUDUMA na SERA YA FARAGHA (Kiswahili / English)
//  Kurasa za wazi (/terms, /privacy) + dirisha la kukubali (TermsGate) kwa kila mtumiaji akiingia.
//  Toleo linalotumika liko src/lib/legal.ts (seva); likibadilika, kila mtumiaji anakubali upya.
// =====================================================================
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PrefSwitches, usePrefs } from '../lib/prefs';
import { Alert, Button } from '../components/ui';
import { LogoMark, Wordmark } from '../components/Logo';

interface LegalInfo { version: string; effective: string; effectiveEn?: string; companyName: string; phone: string; email: string; address: string; tin: string; website: string; supportPhone?: string; supportEmail?: string }
type Block = string | { list: string[] };
interface Sec { h: string; b: Block[] }
interface Doc { title: string; intro: string; sections: Sec[] }

function useLegalInfo() {
  const [info, setInfo] = useState<LegalInfo | null>(null);
  useEffect(() => { api<{ legal: LegalInfo }>('/public/status').then((r) => setInfo(r.legal)).catch(() => {}); }, []);
  return info;
}

/** Mawasiliano ya kampuni (kutoka wasifu wa biashara) */
function contact(i: LegalInfo | null, en: boolean): string[] {
  const c = i?.companyName || 'DUKALANGU SOLUTION';
  const rows = [
    `${en ? 'Company' : 'Kampuni'}: ${c}${i?.tin ? ` (TIN ${i.tin})` : ''}`,
    i?.address ? `${en ? 'Address' : 'Anwani'}: ${i.address}` : '',
    i?.phone ? `${en ? 'Phone' : 'Simu'}: ${i.phone}` : '',
    i?.email ? `Email: ${i.email}` : '',
    i?.supportPhone || i?.supportEmail ? `${en ? 'Technical support' : 'Msaada wa kiufundi'}: ${[i.supportPhone, i.supportEmail].filter(Boolean).join(' · ')}` : '',
    i?.website ? `${en ? 'Website' : 'Tovuti'}: ${i.website}` : '',
    en ? 'In the system: the "Support" page (support ticket).' : 'Ndani ya mfumo: ukurasa wa "Msaada" (tiketi ya msaada).',
  ];
  return rows.filter(Boolean);
}

// ---------------------------------------------------------------------
//  MASHARTI YA HUDUMA
// ---------------------------------------------------------------------
function terms(i: LegalInfo | null, en: boolean): Doc {
  const C = i?.companyName || 'DUKALANGU SOLUTION';
  if (en) return {
    title: 'Terms of Service',
    intro: `These Terms govern the use of CoopLink, a system for managing primary cooperative societies (AMCOS), owned and operated by ${C} ("the Company"). By signing in or using CoopLink you agree to these Terms. If you use CoopLink on behalf of a society, you confirm that the society has authorised you to do so.`,
    sections: [
      { h: '1. Definitions', b: [{ list: [
        '"CoopLink" or "the System": the web application and related services provided by the Company.',
        '"Society": a primary cooperative society (AMCOS) that has an account on CoopLink.',
        '"User": anyone given an account on CoopLink, including the Manager, Accountant, Storekeeper and Company staff.',
        '"Society Data": all information entered into CoopLink by or for a society, including farmers, estimates, inputs, sales, debts, payments and accounts.',
      ] }] },
      { h: '2. Accounts and security', b: [{ list: [
        'Each user has a personal account and must not share their password or two-step verification (2FA) code with anyone.',
        'You are responsible for all actions taken with your account. If you suspect someone else knows your password, change it immediately and inform the Company through "Support".',
        'Some actions (for example approving requests) require you to re-enter your password. This confirms that the decision was made by you.',
        'The Company never asks for your password by phone, SMS or email.',
      ] }] },
      { h: '3. Acceptable use', b: ['You must not:', { list: [
        'enter false information or create records for transactions that did not happen;',
        'try to access another society\'s data, bypass permissions, or test or attack the security of the System without written permission;',
        'use CoopLink for fraud, money laundering or any activity that breaks the laws of Tanzania;',
        'copy, resell, reverse-engineer or build a competing product from CoopLink;',
        'overload the System on purpose (for example with automated requests).',
      ] }, 'The Company may suspend an account that breaks these rules, and will inform the society.'] },
      { h: '4. Responsibilities of the society', b: [{ list: [
        'Make sure the data entered is accurate and complete, and correct errors through the procedures in the System (reversal with audit trail; completed records are not deleted silently).',
        'Obtain the consent of farmers where the law requires it before entering their personal information, and tell them that their information is kept in CoopLink.',
        'Follow the Cooperative Societies Act and the society\'s by-laws. CoopLink helps with record-keeping but does not replace the responsibilities of the Board, the Manager or auditors.',
        'Keep original documents (receipts, contracts, vouchers) as required by law.',
        'Remove the accounts of staff who leave the society without delay.',
      ] }] },
      { h: '5. Fees and payment', b: [{ list: [
        'Fees (the one-time entrance fee and the season fee) are set in the service contract between the society and the Company and are shown on the "CoopLink fees" page.',
        'Fees are paid through mobile money providers. A payment is recorded only after the provider confirms it; a receipt is then issued.',
        'If a fee is not paid by its due date, the society\'s account may be locked until it is paid. Locking does not delete any data, and the account is unlocked as soon as payment is confirmed.',
        'CoopLink records the society\'s and farmers\' transactions, but the Company does not hold or move society funds or farmers\' money. Company revenue is kept completely separate from society funds.',
      ] }] },
      { h: '6. Third-party services', b: ['CoopLink uses other providers to deliver the service, including mobile money payment providers, the service that confirms the registered name of a phone number, server hosting and (in future) SMS. These services have their own terms. The Company is not responsible for interruptions caused by these providers, but will help the society follow up.'] },
      { h: '7. Availability and maintenance', b: ['The Company aims to keep CoopLink available at least 98% of the time each month, excluding scheduled maintenance. Planned maintenance is announced in the System in advance and, where possible, avoided during markets and payment days.'] },
      { h: '8. Ownership', b: [{ list: [
        'Society Data belongs to the society. The Company uses it only to provide the service, as explained in the Privacy Policy.',
        'The CoopLink system, its code, design, name and logo belong to the Company. These Terms give the society the right to use the System, not ownership of it.',
      ] }] },
      { h: '9. Ending the service', b: [{ list: [
        'A society may stop using CoopLink according to the notice period in its service contract.',
        'For 60 days after the service ends, the society may request a full copy of its data (Excel/CSV and PDF reports). After that, the data is deleted except for records the law requires to be kept.',
      ] }] },
      { h: '10. Limitation of liability', b: ['The Company provides CoopLink with reasonable care and skill. The Company is not liable for losses caused by incorrect data entered by users, misuse of a user\'s account, failures of third-party services, or events beyond its control. To the extent permitted by law, the Company\'s total liability to a society for one season does not exceed the fees that society paid for that season.'] },
      { h: '11. Changes to these Terms', b: ['The Company may update these Terms. Significant changes are announced in the System at least 30 days before they take effect, and every user is asked to accept the new version the next time they sign in.'] },
      { h: '12. Governing law and disputes', b: ['These Terms are governed by the laws of the United Republic of Tanzania. Disputes are first resolved by discussion; if that fails, by mediation; and finally by the competent courts of Tanzania. If the Swahili and English versions differ, the Swahili version prevails.'] },
      { h: '13. Contact', b: [{ list: contact(i, true) }] },
    ],
  };
  return {
    title: 'Masharti ya Huduma',
    intro: `Masharti haya yanaongoza matumizi ya CoopLink, mfumo wa kusimamia Vyama vya Msingi vya Ushirika (AMCOS), unaomilikiwa na kuendeshwa na ${C} ("Kampuni"). Kwa kuingia au kutumia CoopLink, unakubali Masharti haya. Ukitumia CoopLink kwa niaba ya chama, unathibitisha kwamba chama kimekuruhusu kufanya hivyo.`,
    sections: [
      { h: '1. Tafsiri', b: [{ list: [
        '"CoopLink" au "Mfumo": programu ya mtandaoni na huduma zinazohusiana nayo zinazotolewa na Kampuni.',
        '"Chama": chama cha msingi cha ushirika (AMCOS) chenye akaunti kwenye CoopLink.',
        '"Mtumiaji": yeyote aliyepewa akaunti ya CoopLink, wakiwemo Meneja, Mhasibu, Storekeeper na wafanyakazi wa Kampuni.',
        '"Data ya Chama": taarifa zote zinazoingizwa kwenye CoopLink na chama au kwa niaba yake, zikiwemo wakulima, makisio, pembejeo, mauzo, madeni, malipo na hesabu.',
      ] }] },
      { h: '2. Akaunti na usalama', b: [{ list: [
        'Kila mtumiaji ana akaunti yake binafsi, na hatakiwi kumpa mtu yeyote nenosiri lake wala msimbo wa uthibitisho wa hatua mbili (2FA).',
        'Unawajibika kwa kila kitendo kinachofanyika kwa akaunti yako. Ukihisi mtu mwingine anajua nenosiri lako, libadilishe mara moja na uijulishe Kampuni kupitia "Msaada".',
        'Baadhi ya vitendo (mfano kuidhinisha maombi) vinahitaji uweke nenosiri lako tena. Hii inathibitisha kwamba uamuzi umefanywa na wewe mwenyewe.',
        'Kampuni haitakuomba kamwe nenosiri lako kwa simu, SMS au barua pepe.',
      ] }] },
      { h: '3. Matumizi yanayokubalika', b: ['Hairuhusiwi:', { list: [
        'kuingiza taarifa za uongo au kurekodi miamala ambayo haikufanyika;',
        'kujaribu kufikia data ya chama kingine, kukwepa ruhusa, au kujaribu au kushambulia usalama wa Mfumo bila ruhusa ya maandishi;',
        'kutumia CoopLink kwa udanganyifu, utakatishaji fedha au shughuli yoyote inayovunja sheria za Tanzania;',
        'kunakili, kuuza upya, kuchambua code ya CoopLink au kutengeneza bidhaa shindani kutoka kwake;',
        'kuulemea Mfumo kwa makusudi (mfano kwa maombi ya kiotomatiki).',
      ] }, 'Kampuni inaweza kusimamisha akaunti inayovunja masharti haya, na itakijulisha chama.'] },
      { h: '4. Wajibu wa chama', b: [{ list: [
        'Kuhakikisha taarifa zinazoingizwa ni sahihi na kamili, na kusahihisha makosa kwa taratibu zilizo ndani ya Mfumo (kusahihisha kwa rekodi ya ukaguzi; kumbukumbu zilizokamilika hazifutwi kimya kimya).',
        'Kupata ridhaa ya wakulima pale sheria inapohitaji kabla ya kuingiza taarifa zao binafsi, na kuwaeleza kwamba taarifa zao zinahifadhiwa kwenye CoopLink.',
        'Kufuata Sheria ya Vyama vya Ushirika na masharti ya chama. CoopLink inasaidia utunzaji wa kumbukumbu, lakini haichukui nafasi ya majukumu ya Bodi, Meneja wala wakaguzi.',
        'Kuhifadhi nyaraka halisi (risiti, mikataba, vocha) kama sheria inavyotaka.',
        'Kuondoa mapema akaunti za watumishi wanaoacha kazi chamani.',
      ] }] },
      { h: '5. Ada na malipo', b: [{ list: [
        'Ada (ada ya kingilio inayolipwa mara moja na ada ya msimu) zimewekwa kwenye mkataba wa huduma kati ya chama na Kampuni, na zinaonekana kwenye ukurasa wa "Ada ya CoopLink".',
        'Ada inalipwa kupitia watoa huduma wa mobile money. Malipo yanahesabiwa tu baada ya mtoa huduma kuyathibitisha, kisha risiti inatolewa.',
        'Ada isipolipwa kufikia tarehe yake, akaunti ya chama inaweza kufungwa mpaka ilipwe. Kufungwa hakufuti data yoyote, na akaunti inafunguliwa papo hapo malipo yakithibitishwa.',
        'CoopLink inarekodi miamala ya chama na ya wakulima, lakini Kampuni haishiki wala kuhamisha fedha za chama au za wakulima. Mapato ya Kampuni yanatenganishwa kabisa na fedha za chama.',
      ] }] },
      { h: '6. Huduma za watoa huduma wengine', b: ['CoopLink inatumia watoa huduma wengine kutoa huduma hii, wakiwemo watoa huduma za malipo ya simu, huduma ya kuthibitisha jina lililosajiliwa la namba ya simu, seva (hosting), na SMS (baadaye). Huduma hizo zina masharti yao. Kampuni haiwajibiki kwa usumbufu unaosababishwa na watoa huduma hao, lakini itakisaidia chama kufuatilia.'] },
      { h: '7. Upatikanaji na matengenezo', b: ['Kampuni inalenga CoopLink ipatikane angalau asilimia 98 ya muda kila mwezi, bila kuhesabu matengenezo yaliyopangwa. Matengenezo yaliyopangwa yanatangazwa ndani ya Mfumo mapema na, inapowezekana, hayafanyiki siku za masoko na malipo.'] },
      { h: '8. Umiliki', b: [{ list: [
        'Data ya Chama ni mali ya chama. Kampuni inaitumia kwa ajili ya kutoa huduma tu, kama ilivyoelezwa kwenye Sera ya Faragha.',
        'Mfumo wa CoopLink, code yake, muundo, jina na nembo yake ni mali ya Kampuni. Masharti haya yanakipa chama haki ya kutumia Mfumo, si umiliki wake.',
      ] }] },
      { h: '9. Kusitisha huduma', b: [{ list: [
        'Chama kinaweza kuacha kutumia CoopLink kwa kufuata muda wa taarifa uliowekwa kwenye mkataba wake wa huduma.',
        'Kwa siku 60 baada ya huduma kusitishwa, chama kinaweza kuomba nakala kamili ya data yake (Excel/CSV na ripoti za PDF). Baada ya hapo data inafutwa, isipokuwa kumbukumbu ambazo sheria inataka zihifadhiwe.',
      ] }] },
      { h: '10. Ukomo wa dhima', b: ['Kampuni inatoa CoopLink kwa uangalifu na ujuzi unaostahili. Kampuni haiwajibiki kwa hasara inayotokana na taarifa zisizo sahihi zilizoingizwa na watumiaji, matumizi mabaya ya akaunti ya mtumiaji, hitilafu za huduma za watoa huduma wengine, au matukio yaliyo nje ya uwezo wake. Kwa kadiri sheria inavyoruhusu, jumla ya dhima ya Kampuni kwa chama kwa msimu mmoja haitazidi ada ambayo chama hicho kimelipa kwa msimu huo.'] },
      { h: '11. Mabadiliko ya Masharti haya', b: ['Kampuni inaweza kusasisha Masharti haya. Mabadiliko makubwa yatatangazwa ndani ya Mfumo angalau siku 30 kabla ya kuanza kutumika, na kila mtumiaji ataombwa kukubali toleo jipya atakapoingia tena.'] },
      { h: '12. Sheria na migogoro', b: ['Masharti haya yanaongozwa na sheria za Jamhuri ya Muungano wa Tanzania. Migogoro itatatuliwa kwanza kwa mazungumzo; yasipofanikiwa, kwa usuluhishi; na mwisho na mahakama zenye mamlaka nchini Tanzania. Toleo la Kiswahili na la Kiingereza yakitofautiana, la Kiswahili ndilo litakalotumika.'] },
      { h: '13. Mawasiliano', b: [{ list: contact(i, false) }] },
    ],
  };
}

// ---------------------------------------------------------------------
//  SERA YA FARAGHA
// ---------------------------------------------------------------------
function privacy(i: LegalInfo | null, en: boolean): Doc {
  const C = i?.companyName || 'DUKALANGU SOLUTION';
  if (en) return {
    title: 'Privacy Policy',
    intro: `This Policy explains what personal information CoopLink collects, why, who it is shared with, and the rights of the people it concerns. It follows the Personal Data Protection Act, 2022 of Tanzania. CoopLink is operated by ${C} ("the Company", "we").`,
    sections: [
      { h: '1. Who is responsible', b: [{ list: [
        'For farmers\' (members\') information, the society is the data controller: it decides what is collected and why. The Company is the data processor: it stores and processes the information on the society\'s instructions in order to provide CoopLink.',
        'For information about users\' accounts and the payment of CoopLink fees, the Company is the data controller.',
      ] }] },
      { h: '2. Information we hold', b: [
        'a) Users (society and Company staff):', { list: ['full name, phone number, email, job title and society;', 'password (stored only in hashed form; nobody can read it), and the two-step verification setting;', 'activity records: sign-ins, IP address, device/browser, and an audit log of actions taken in the system.'] },
        'b) Farmers (members), as entered by the society:', { list: ['name, gender, date of birth, national ID (NIDA) or voter ID number, phone number, village and photo;', 'mobile money or bank payment details, next of kin and guarantor;', 'shares, estimates, inputs received, tobacco sales and deductions, debts, firewood loans and payments.'] },
        'c) CoopLink fee payments: payer\'s phone number, name, email and the payment provider\'s reference.',
        'd) Support tickets: messages, screenshots, the page the user was on and the device.',
        'e) Browser storage: the sign-in token and preferences (light/dark theme, language and sign-in tone). CoopLink does not use advertising or tracking cookies.',
      ] },
      { h: '3. How we use it', b: [{ list: [
        'To provide CoopLink to the society: registers, inputs, sales, payments, reports and approvals.',
        'To protect accounts and data: sign-in verification, detecting suspicious activity and keeping audit records.',
        'To confirm the registered owner\'s name of a phone number, so that names and payments go to the right person.',
        'To process CoopLink fee payments and issue receipts.',
        'To provide support, and to send service notices (for example maintenance or fees due).',
        'To improve CoopLink using aggregated statistics that do not identify individuals.',
      ] }, 'We do not sell personal information and we do not use it for advertising.'] },
      { h: '4. Legal basis', b: ['We process information because it is needed to perform the service contract with the society, to meet legal obligations (for example accounting records), to protect the security of the system, and where required, with the consent of the person concerned (obtained by the society for its members).'] },
      { h: '5. Who we share it with', b: [{ list: [
        'Mobile money payment providers (currently TeePay and Abliner), to send payment requests and confirm payments.',
        'The name-confirmation service (Abliner Name Lookup): the phone number is sent and the registered name is returned. Results are kept temporarily (up to 30 days when a name is found, 6 hours when not) to reduce repeated lookups.',
        'Server hosting providers, which store the system and its data. Servers may be located outside Tanzania; see section 6.',
        'An SMS provider, once SMS is enabled.',
        'Authorities, when required by law or a court order, and the society\'s auditors at the society\'s request.',
      ] }, 'Company staff can see only what their role requires, and Company staff cannot open society data unless needed to resolve a support request.'] },
      { h: '6. Transfers outside Tanzania', b: ['Some of our providers (including hosting) may store or process data outside Tanzania. In such cases we use providers that protect data to a standard at least equal to Tanzanian law, with encrypted connections (HTTPS) and access controls, as required by the Personal Data Protection Act.'] },
      { h: '7. How long we keep it', b: [{ list: [
        'Society Data is kept for as long as the society uses CoopLink.',
        'After the service ends, the society may request a copy within 60 days; the data is then deleted, except records the law requires to be kept (for example accounting and audit records).',
        'Backups are kept for a limited period for recovery purposes (as set out in the service contract, normally up to 30 days).',
        'Sign-in and audit records are kept as long as needed for security and accountability.',
      ] }] },
      { h: '8. Security', b: [{ list: [
        'Passwords are stored hashed; two-step verification (2FA) is available.',
        'All connections use HTTPS encryption.',
        'Each user sees only the data of their own society and their role; the Manager approves important actions after re-entering their password.',
        'Every important action is recorded in an audit log; completed records are corrected by reversal, not deleted.',
        'If a breach affecting society data occurs, the Company will notify the society within 72 hours of becoming aware of it, and will inform the Personal Data Protection Commission where the law requires.',
      ] }] },
      { h: '9. Your rights', b: ['Under the law, a person whose information is held has the right to:', { list: [
        'know what information is held about them and receive a copy;',
        'have incorrect information corrected;',
        'request deletion of information that is no longer needed, where the law allows;',
        'object to processing or withdraw consent, where processing is based on consent;',
        'complain to the Personal Data Protection Commission (PDPC).',
      ] }, 'Farmers should make requests through their society, which is responsible for their information. Users can make requests to the Company using the contacts below.'] },
      { h: '10. Children', b: ['CoopLink accounts are for adults (18 years or older). Societies should not register users under 18.'] },
      { h: '11. Changes to this Policy', b: ['We may update this Policy. Significant changes are announced in the System, and every user is asked to accept the new version the next time they sign in.'] },
      { h: '12. Contact (data protection)', b: [{ list: contact(i, true) }] },
    ],
  };
  return {
    title: 'Sera ya Faragha',
    intro: `Sera hii inaeleza taarifa binafsi zinazokusanywa na CoopLink, sababu zake, tunaowashirikisha, na haki za wahusika. Inafuata Sheria ya Ulinzi wa Taarifa Binafsi ya mwaka 2022 ya Tanzania. CoopLink inaendeshwa na ${C} ("Kampuni", "sisi").`,
    sections: [
      { h: '1. Nani anawajibika', b: [{ list: [
        'Kwa taarifa za wakulima (wanachama), chama ndicho mdhibiti wa taarifa: kinaamua kinachokusanywa na kwa nini. Kampuni ni mchakataji wa taarifa: inazihifadhi na kuzichakata kwa maelekezo ya chama ili kutoa huduma ya CoopLink.',
        'Kwa taarifa za akaunti za watumiaji na malipo ya ada ya CoopLink, Kampuni ndiyo mdhibiti wa taarifa.',
      ] }] },
      { h: '2. Taarifa tunazohifadhi', b: [
        'a) Watumiaji (watumishi wa chama na wa Kampuni):', { list: ['jina kamili, namba ya simu, barua pepe, cheo na chama;', 'nenosiri (linahifadhiwa likiwa limesimbwa tu — hakuna anayeweza kulisoma), na mpangilio wa uthibitisho wa hatua mbili;', 'kumbukumbu za matumizi: kuingia, anwani ya IP, kifaa/kivinjari, na kumbukumbu (audit) za vitendo vilivyofanyika kwenye mfumo.'] },
        'b) Wakulima (wanachama), kama zilivyoingizwa na chama:', { list: ['jina, jinsia, tarehe ya kuzaliwa, namba ya NIDA au ya kitambulisho cha mpiga kura, namba ya simu, kijiji na picha;', 'taarifa za malipo kwa mobile money au benki, ndugu wa karibu na mdhamini;', 'hisa, makisio, pembejeo alizopokea, mauzo ya tumbaku na makato, madeni, pesa ya kuni na malipo.'] },
        'c) Malipo ya ada ya CoopLink: namba ya simu ya mlipaji, jina, barua pepe na kumbukumbu ya mtoa huduma wa malipo.',
        'd) Tiketi za msaada: jumbe, picha za skrini, ukurasa aliokuwepo mtumiaji na kifaa chake.',
        'e) Hifadhi ya kivinjari: tokeni ya kuingia na mapendeleo (mwonekano wa mwanga/giza, lugha na tone ya kuingia). CoopLink haitumii cookies za matangazo wala za kufuatilia watu.',
      ] },
      { h: '3. Tunavyozitumia', b: [{ list: [
        'Kutoa huduma ya CoopLink kwa chama: madaftari, pembejeo, mauzo, malipo, ripoti na idhini.',
        'Kulinda akaunti na data: kuthibitisha anayeingia, kugundua vitendo vya kutiliwa shaka na kutunza kumbukumbu za ukaguzi.',
        'Kuthibitisha jina la mmiliki aliyesajiliwa wa namba ya simu, ili majina na malipo yamfikie mtu sahihi.',
        'Kushughulikia malipo ya ada ya CoopLink na kutoa risiti.',
        'Kutoa msaada, na kutuma taarifa za huduma (mfano matengenezo au ada inayodaiwa).',
        'Kuboresha CoopLink kwa kutumia takwimu za jumla zisizomtambulisha mtu yeyote.',
      ] }, 'Hatuuzi taarifa binafsi, na hatuzitumii kwa matangazo.'] },
      { h: '4. Msingi wa kisheria', b: ['Tunachakata taarifa kwa sababu zinahitajika kutekeleza mkataba wa huduma na chama, kutimiza wajibu wa kisheria (mfano kumbukumbu za hesabu), kulinda usalama wa mfumo, na pale inapohitajika, kwa ridhaa ya mhusika (inayopatikana na chama kwa wanachama wake).'] },
      { h: '5. Tunaowashirikisha', b: [{ list: [
        'Watoa huduma za malipo ya simu (kwa sasa TeePay na Abliner), kutuma maombi ya malipo na kuthibitisha malipo.',
        'Huduma ya kuthibitisha majina (Abliner Name Lookup): namba ya simu inatumwa na jina lililosajiliwa linarudishwa. Majibu yanahifadhiwa kwa muda (hadi siku 30 jina likipatikana, saa 6 lisipopatikana) ili kupunguza maombi yanayojirudia.',
        'Watoa huduma za seva (hosting) wanaohifadhi mfumo na data yake. Seva zinaweza kuwa nje ya Tanzania; angalia kifungu cha 6.',
        'Mtoa huduma wa SMS, huduma ya SMS ikishawashwa.',
        'Mamlaka, pale sheria au amri ya mahakama inapotaka, na wakaguzi wa chama kwa ombi la chama.',
      ] }, 'Wafanyakazi wa Kampuni wanaona kile tu ambacho kazi yao inahitaji, na hawafungui data ya chama isipokuwa kama inahitajika kutatua ombi la msaada.'] },
      { h: '6. Uhamisho nje ya Tanzania', b: ['Baadhi ya watoa huduma wetu (ikiwemo hosting) wanaweza kuhifadhi au kuchakata data nje ya Tanzania. Katika hali hiyo tunatumia watoa huduma wanaolinda data kwa kiwango kisichopungua kile cha sheria ya Tanzania, kwa muunganisho uliosimbwa (HTTPS) na udhibiti wa ufikiaji, kama Sheria ya Ulinzi wa Taarifa Binafsi inavyotaka.'] },
      { h: '7. Muda wa kuhifadhi', b: [{ list: [
        'Data ya Chama inahifadhiwa kwa muda wote chama kinapotumia CoopLink.',
        'Huduma ikisitishwa, chama kinaweza kuomba nakala ndani ya siku 60; baada ya hapo data inafutwa, isipokuwa kumbukumbu ambazo sheria inataka zihifadhiwe (mfano kumbukumbu za hesabu na ukaguzi).',
        'Nakala za akiba (backups) zinahifadhiwa kwa muda mfupi kwa ajili ya kurejesha huduma (kama ilivyo kwenye mkataba wa huduma, kwa kawaida hadi siku 30).',
        'Kumbukumbu za kuingia na za ukaguzi zinahifadhiwa kwa muda unaohitajika kwa usalama na uwajibikaji.',
      ] }] },
      { h: '8. Usalama', b: [{ list: [
        'Manenosiri yanahifadhiwa yakiwa yamesimbwa; uthibitisho wa hatua mbili (2FA) upo.',
        'Miunganisho yote inatumia usimbaji wa HTTPS.',
        'Kila mtumiaji anaona data ya chama chake na ya cheo chake tu; Meneja anaidhinisha vitendo muhimu baada ya kuweka nenosiri lake tena.',
        'Kila kitendo muhimu kinarekodiwa kwenye kumbukumbu za ukaguzi; kumbukumbu zilizokamilika zinasahihishwa kwa kurudisha (reversal), hazifutwi.',
        'Uvunjaji wa usalama ukitokea na kuathiri data ya chama, Kampuni itakijulisha chama ndani ya saa 72 tangu kuugundua, na itaijulisha Tume ya Ulinzi wa Taarifa Binafsi pale sheria inapotaka.',
      ] }] },
      { h: '9. Haki zako', b: ['Kwa mujibu wa sheria, mtu ambaye taarifa zake zinahifadhiwa ana haki ya:', { list: [
        'kujua taarifa zake zinazohifadhiwa na kupata nakala yake;',
        'kusahihishiwa taarifa zisizo sahihi;',
        'kuomba kufutwa kwa taarifa zisizohitajika tena, pale sheria inaporuhusu;',
        'kupinga uchakataji au kuondoa ridhaa yake, pale uchakataji unapotegemea ridhaa;',
        'kuwasilisha malalamiko kwa Tume ya Ulinzi wa Taarifa Binafsi (PDPC).',
      ] }, 'Wakulima wawasilishe maombi yao kupitia chama chao, ambacho ndicho kinachowajibika kwa taarifa zao. Watumiaji wanaweza kuwasilisha maombi kwa Kampuni kupitia mawasiliano yaliyo hapa chini.'] },
      { h: '10. Watoto', b: ['Akaunti za CoopLink ni za watu wazima (miaka 18 na kuendelea). Vyama visisajili watumiaji walio chini ya miaka 18.'] },
      { h: '11. Mabadiliko ya Sera hii', b: ['Tunaweza kusasisha Sera hii. Mabadiliko makubwa yatatangazwa ndani ya Mfumo, na kila mtumiaji ataombwa kukubali toleo jipya atakapoingia tena.'] },
      { h: '12. Mawasiliano (ulinzi wa taarifa)', b: [{ list: contact(i, false) }] },
    ],
  };
}

function Blocks({ b }: { b: Block[] }) {
  return <>{b.map((x, k) => (typeof x === 'string' ? <p key={k}>{x}</p> : <ul key={k}>{x.list.map((li, j) => <li key={j}>{li}</li>)}</ul>))}</>;
}

function DocBody({ doc, info, en }: { doc: Doc; info: LegalInfo | null; en: boolean }) {
  return (
    <article className="legal-doc">
      <h1>{doc.title}</h1>
      <p className="legal-meta">{en ? 'Effective' : 'Inaanza kutumika'}: {(en ? info?.effectiveEn : info?.effective) ?? (en ? '10 November 2026' : '10 Novemba 2026')} · {en ? 'Version' : 'Toleo'} {info?.version ?? ''}</p>
      <p className="legal-intro">{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          <Blocks b={s.b} />
        </section>
      ))}
    </article>
  );
}

function LegalShell({ which, children }: { which: 'terms' | 'privacy'; children: ReactNode }) {
  const { lang } = usePrefs();
  const en = lang === 'en';
  return (
    <div className="legal-page">
      <header className="legal-top">
        <Link to="/login" className="legal-brand" aria-label="CoopLink"><LogoMark size={34} /><Wordmark size={22} /></Link>
        <nav className="legal-tabs" aria-label={en ? 'Legal documents' : 'Nyaraka za kisheria'}>
          <Link to="/terms" className={which === 'terms' ? 'on' : ''}>{en ? 'Terms of Service' : 'Masharti ya Huduma'}</Link>
          <Link to="/privacy" className={which === 'privacy' ? 'on' : ''}>{en ? 'Privacy Policy' : 'Sera ya Faragha'}</Link>
        </nav>
        <div className="legal-prefs"><PrefSwitches compact /></div>
      </header>
      <main className="legal-main card">{children}</main>
      <footer className="legal-foot">CoopLink · Powered by <strong>DUKALANGU SOLUTION</strong></footer>
    </div>
  );
}

export function TermsPage() {
  const info = useLegalInfo();
  const en = usePrefs().lang === 'en';
  return <LegalShell which="terms"><DocBody doc={terms(info, en)} info={info} en={en} /></LegalShell>;
}
export function PrivacyPage() {
  const info = useLegalInfo();
  const en = usePrefs().lang === 'en';
  return <LegalShell which="privacy"><DocBody doc={privacy(info, en)} info={info} en={en} /></LegalShell>;
}

/** Dirisha la kukubali: linaonekana mtumiaji asipokubali toleo la sasa. */
export function TermsGate() {
  const { user, refresh, logout } = useAuth();
  const info = useLegalInfo();
  const en = usePrefs().lang === 'en';
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isUpdate = !!user?.termsVersion;
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      await api('/auth/accept-terms', { method: 'POST', body: { version: user?.legalVersion, accept: true } });
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="legal-gate-card card">
        <div className="legal-gate-head">
          <div className="legal-gate-top"><LogoMark size={36} onDark={false} /><div className="legal-prefs"><PrefSwitches compact /></div></div>
          <h1 id="gate-title">{isUpdate ? (en ? 'Our terms have been updated' : 'Masharti yetu yamesasishwa') : (en ? 'Before you continue' : 'Kabla ya kuendelea')}</h1>
          <p className="muted">{en
            ? 'Please read the Terms of Service and the Privacy Policy. They explain how CoopLink works, your responsibilities, and how farmers\' and users\' information is protected.'
            : 'Tafadhali soma Masharti ya Huduma na Sera ya Faragha. Yanaeleza jinsi CoopLink inavyofanya kazi, wajibu wako, na jinsi taarifa za wakulima na za watumiaji zinavyolindwa.'}</p>
          <div className="tabs legal-gate-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'terms'} className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}>{en ? 'Terms of Service' : 'Masharti ya Huduma'}</button>
            <button role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>{en ? 'Privacy Policy' : 'Sera ya Faragha'}</button>
          </div>
        </div>
        <div className="legal-gate-body" tabIndex={0}>
          <DocBody doc={tab === 'terms' ? terms(info, en) : privacy(info, en)} info={info} en={en} />
        </div>
        <div className="legal-gate-foot">
          <label className="legal-check">
            <input id="accept-terms" type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>{en ? 'I have read and I accept the Terms of Service and the Privacy Policy.' : 'Nimesoma na ninakubali Masharti ya Huduma na Sera ya Faragha.'}</span>
          </label>
          <Alert>{err}</Alert>
          <div className="actions">
            <Button variant="ghost" onClick={logout}>{en ? 'Log out' : 'Toka'}</Button>
            <Button disabled={!ok} busy={busy} onClick={accept}>{en ? 'Accept and continue' : 'Kubali na uendelee'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
