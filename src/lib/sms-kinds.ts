// Aina za SMS za CoopLink (orodha tu — haina imports, inatumiwa na settings na sms)
export const SMS_KINDS = {
  // ---- OTP na usalama ----
  LOGIN_OTP: { group: 'OTP', label: 'OTP ya kuingia kwenye mfumo', who: 'Watumishi wote', urgent: true, desc: 'Baada ya nenosiri, namba ya uthibitisho inatumwa kwa simu ya mtumishi. Kifaa kinaaminika siku 30 (SMS moja kwa mwezi kwa kifaa).' },
  PASSWORD_RESET_OTP: { group: 'OTP', label: 'Umesahau nenosiri', who: 'Watumishi wote', urgent: true, desc: 'Mtumishi anaweka nenosiri jipya kwa namba ya uthibitisho iliyotumwa kwa simu yake.' },
  MEMBER_PHONE_OTP: { group: 'OTP', label: 'Kuthibitisha namba ya simu ya mkulima', who: 'Mkulima', urgent: true, desc: 'Wakati wa usajili na wakati wa kubadilisha namba: namba inathibitishwa kwa OTP kabla ya kuhifadhiwa — mtumishi hawezi kuweka namba yake (malipo yanaenda kwenye namba hii).' },
  CASH_PAYOUT_OTP: { group: 'OTP', label: 'Kupokea fedha taslimu kwa OTP', who: 'Mkulima', urgent: true, desc: 'Malipo ya mauzo, mkopo au malipo mengine ya taslimu: mkulima anapokea namba na kuitaja akishashika fedha. Bila namba, Meneja pekee anaruhusu kwa sababu.' },
  GROUP_CONSENT_OTP: { group: 'OTP', label: 'Ridhaa ya kujiunga na kikundi (dhamana)', who: 'Mkulima', urgent: true, desc: 'Kabla ya kuingizwa kwenye kikundi, mkulima anakubali kwa OTP kwamba atadhamini madeni ya wanakikundi wenzake.' },
  FARMER_PORTAL_PIN: { group: 'OTP', label: 'PIN ya portal ya mkulima', who: 'Mkulima', urgent: true, desc: 'PIN ya kuingia kwenye portal ya mkulima inatumwa moja kwa moja kwa simu yake — mtumishi haioni. Haihifadhiwi kwenye kumbukumbu za SMS.' },
  ISSUE_HANDOVER_OTP: { group: 'OTP', label: 'Kukabidhi pembejeo kwa OTP', who: 'Mkulima', urgent: true, desc: 'Mkulima anapokea orodha ya pembejeo na deni lake pamoja na namba ya uthibitisho; anaitaja kwa Storekeeper akipokea mzigo.' },
  STAFF_CREDENTIALS: { group: 'OTP', label: 'Nenosiri la muda la akaunti mpya', who: 'Wafanyakazi wa CoopLink na watumishi wa vyama', urgent: true, desc: 'Mfanyakazi mpya (au aliyeombewa nenosiri jipya) anatumiwa nenosiri la muda; analibadilisha akiingia. Nenosiri halihifadhiwi kwenye kumbukumbu za SMS.' },
  SECURITY_ALERT: { group: 'OTP', label: 'Tahadhari ya kuingia kutoka kifaa kipya', who: 'Wasimamizi wa CoopLink', urgent: true, desc: 'Akaunti ya CoopLink ikiingiwa kutoka mtandao mpya.' },
  // ---- Taarifa kwa mkulima ----
  MEMBER_APPLICATION: { group: 'FARMER', label: 'Ombi la usajili limepokelewa / limekataliwa', who: 'Mkulima', urgent: false, desc: 'Mtumishi akimsajili mkulima: "ombi limepokelewa, linasubiri Meneja". Meneja akikataa: sababu.' },
  MEMBER_REGISTERED: { group: 'FARMER', label: 'Mkulima amesajiliwa', who: 'Mkulima', urgent: false, desc: 'Karibu kwenye chama + namba ya uanachama, baada ya Meneja kuidhinisha usajili.' },
  MEMBER_STATUS: { group: 'FARMER', label: 'Hali ya uanachama imebadilika', who: 'Mkulima', urgent: false, desc: 'Uanachama ukisitishwa, ukirudishwa au mkulima akitoka chama (si kwa marehemu).' },
  MEMBER_PHONE_CHANGED: { group: 'FARMER', label: 'Tahadhari: namba ya simu imebadilishwa', who: 'Mkulima (namba ya zamani)', urgent: true, desc: 'Namba ya simu au ya malipo ikibadilishwa, namba ya ZAMANI inapata taarifa — kama si yeye, aripoti chama mara moja.' },
  MEMBER_RECEIPT: { group: 'FARMER', label: 'Risiti ya fedha alizolipa mkulima', who: 'Mkulima', urgent: false, desc: 'Kiingilio, ada au marejesho ya deni yakipokelewa: kiasi, namba ya risiti na deni lililobaki.' },
  ESTIMATE_APPROVED: { group: 'FARMER', label: 'Makisio ya mavuno yameidhinishwa', who: 'Mkulima', urgent: false, desc: 'Ekari na kilo zinazotarajiwa zikiidhinishwa na Meneja (ndizo msingi wa pembejeo zake).' },
  INPUT_HANDED_OVER: { group: 'FARMER', label: 'Pembejeo alizopokea na deni', who: 'Mkulima', urgent: false, desc: 'Baada ya kukabidhiwa (bila OTP): pembejeo, thamani na deni lake la jumla.' },
  LOAN_SENT: { group: 'FARMER', label: 'Mkopo umetumwa', who: 'Mkulima', urgent: false, desc: 'Mkopo wa kuni / grading / miti umetumwa: kiasi, riba na deni.' },
  SALE_SETTLED: { group: 'FARMER', label: 'Hesabu ya mauzo ya tumbaku', who: 'Mkulima', urgent: false, desc: 'Baada ya Meneja kuidhinisha: kilo, mauzo, makato na atakacholipwa.' },
  PAYMENT_SENT: { group: 'FARMER', label: 'Malipo yametumwa', who: 'Mkulima', urgent: false, desc: 'Mhasibu akithibitisha malipo (ya mauzo au mengine): kiasi na njia (M-Pesa / benki / taslimu).' },
  PAYMENT_FAILED: { group: 'FARMER', label: 'Malipo / mkopo umekwama', who: 'Mkulima', urgent: false, desc: 'Malipo au mkopo ukishindwa kufika (mf. namba si sahihi): mkulima anajua na kuambiwa awasiliane na chama.' },
  GROUP_GUARANTEE_USED: { group: 'FARMER', label: 'Dhamana ya kikundi imetumika', who: 'Mdhamini na mdaiwa', urgent: false, desc: 'Mauzo ya mwanakikundi yakilipa deni la mwenzake: mdhamini anaambiwa kiasi kilichokatwa, mdaiwa anaambiwa deni lake limepungua.' },
  ACCOUNT_CORRECTION: { group: 'FARMER', label: 'Marekebisho kwenye akaunti ya mkulima', who: 'Mkulima', urgent: false, desc: 'Pembejeo zikifutwa au muamala wa mkulima (malipo, mkopo, marejesho) ukisahihishwa: kilichobadilika na deni jipya.' },
  // ---- Vikundi ----
  GROUP_REGISTERED: { group: 'GROUP', label: 'Kikundi kimesajiliwa', who: 'Wanakikundi wote', urgent: false, desc: 'Kikundi kikiidhinishwa: jina, kiongozi na wanachama — wanadhaminiana madeni.' },
  GROUP_MEMBER_JOINED: { group: 'GROUP', label: 'Mwanachama amejiunga na kikundi', who: 'Aliyejiunga + wanakikundi', urgent: false, desc: 'Mwanachama mpya akiidhinishwa kujiunga.' },
  GROUP_MEMBER_LEFT: { group: 'GROUP', label: 'Mwanachama amehama / ametoka kikundini', who: 'Aliyetoka + wanakikundi', urgent: false, desc: 'Mwanachama akiidhinishwa kutoka kwenye kikundi.' },
  GROUP_INPUT_TAKEN: { group: 'GROUP', label: 'Mwanakikundi amechukua pembejeo', who: 'Wanakikundi wengine', urgent: false, desc: 'Mwanakikundi akikabidhiwa pembejeo: alichochukua na deni la jumla la kikundi.' },
  GROUP_DEBT: { group: 'GROUP', label: 'Taarifa ya deni la kikundi', who: 'Wanakikundi wote', urgent: false, desc: 'Meneja / Mhasibu akibonyeza "Tuma deni kwa SMS": deni la kikundi na la kila mmoja.' },
  // ---- Matangazo ----
  CHAMA_BROADCAST: { group: 'BROADCAST', label: 'Matangazo na taarifa za vikao (chama)', who: 'Wakulima (wote / kijiji / kikundi)', urgent: false, desc: 'Meneja anatuma tangazo au taarifa ya kikao kwa wakulima — kikomo cha SMS kwa mwezi kinawekwa na Owner.' },
  OWNER_ANNOUNCEMENT: { group: 'BROADCAST', label: 'Matangazo ya CoopLink kwa vyama', who: 'Watumishi wa vyama', urgent: false, desc: 'Matangazo unayotuma kutoka Marketing & Communication.' },
  STAFF_ALERT: { group: 'BROADCAST', label: 'Arifa za kazi kwa wafanyakazi wa CoopLink', who: 'Wafanyakazi wa CoopLink na Owner', urgent: false, desc: 'Ombi jipya kwa Owner, malipo yaliyosubiri uthibitisho zaidi ya saa 24, tiketi zilizochelewa, leads mpya bila mhusika. Moja kwa kila jambo.' },
  SYSTEM_ALERT: { group: 'BROADCAST', label: 'Tahadhari za mfumo kwa Owner', who: 'Owner / Tech Support', urgent: true, desc: 'System Control Center: tahadhari kubwa (CRITICAL).' },
} as const;
export type SmsKind = keyof typeof SMS_KINDS;
export const SMS_GROUPS: Record<string, string> = { OTP: 'OTP na usalama', FARMER: 'Taarifa kwa mkulima', GROUP: 'Vikundi', BROADCAST: 'Matangazo na tahadhari' };
/** Zilizokuwa zikitumika kabla ya swichi hizi zinaanza zikiwa wazi; mpya zote zimefungwa mpaka Owner aziwashe. */
export const SMS_EVENT_DEFAULTS = Object.fromEntries((Object.keys(SMS_KINDS) as SmsKind[]).map((k) => [k, ['SECURITY_ALERT', 'OWNER_ANNOUNCEMENT', 'SYSTEM_ALERT', 'STAFF_CREDENTIALS', 'STAFF_ALERT'].includes(k)])) as Record<SmsKind, boolean>;

