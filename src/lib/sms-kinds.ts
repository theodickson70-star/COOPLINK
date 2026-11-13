// Aina za SMS za CoopLink (orodha tu — haina imports, inatumiwa na settings na sms)
export const SMS_KINDS = {
  // ---- OTP na usalama ----
  LOGIN_OTP: { group: 'OTP', label: 'OTP ya kuingia kwenye mfumo', who: 'Watumishi wote', urgent: true, desc: 'Baada ya nenosiri, namba ya uthibitisho inatumwa kwa simu ya mtumishi. Kifaa kinaaminika siku 30 (SMS moja kwa mwezi kwa kifaa).' },
  PASSWORD_RESET_OTP: { group: 'OTP', label: 'Umesahau nenosiri', who: 'Watumishi wote', urgent: true, desc: 'Mtumishi anaweka nenosiri jipya kwa namba ya uthibitisho iliyotumwa kwa simu yake.' },
  MEMBER_PHONE_OTP: { group: 'OTP', label: 'Kubadilisha namba ya simu ya mkulima', who: 'Mkulima (namba mpya)', urgent: true, desc: 'Namba mpya inathibitishwa kwa OTP kabla ya kuhifadhiwa — Storekeeper hawezi kuweka namba yake.' },
  ISSUE_HANDOVER_OTP: { group: 'OTP', label: 'Kukabidhi pembejeo kwa OTP', who: 'Mkulima', urgent: true, desc: 'Mkulima anapokea orodha ya pembejeo na deni lake pamoja na namba ya uthibitisho; anaitaja kwa Storekeeper akipokea mzigo.' },
  STAFF_CREDENTIALS: { group: 'OTP', label: 'Nenosiri la muda la akaunti mpya', who: 'Wafanyakazi wa CoopLink na watumishi wa vyama', urgent: true, desc: 'Mfanyakazi mpya (au aliyeombewa nenosiri jipya) anatumiwa nenosiri la muda; analibadilisha akiingia. Nenosiri halihifadhiwi kwenye kumbukumbu za SMS.' },
  SECURITY_ALERT: { group: 'OTP', label: 'Tahadhari ya kuingia kutoka kifaa kipya', who: 'Wasimamizi wa CoopLink', urgent: true, desc: 'Akaunti ya CoopLink ikiingiwa kutoka mtandao mpya.' },
  // ---- Taarifa kwa mkulima ----
  MEMBER_REGISTERED: { group: 'FARMER', label: 'Mkulima amesajiliwa', who: 'Mkulima', urgent: false, desc: 'Karibu kwenye chama + namba ya uanachama, baada ya Meneja kuidhinisha usajili.' },
  INPUT_HANDED_OVER: { group: 'FARMER', label: 'Pembejeo alizopokea na deni', who: 'Mkulima', urgent: false, desc: 'Baada ya kukabidhiwa (bila OTP): pembejeo, thamani na deni lake la jumla.' },
  LOAN_SENT: { group: 'FARMER', label: 'Mkopo umetumwa', who: 'Mkulima', urgent: false, desc: 'Mkopo wa kuni / grading / miti umetumwa: kiasi, riba na deni.' },
  SALE_SETTLED: { group: 'FARMER', label: 'Hesabu ya mauzo ya tumbaku', who: 'Mkulima', urgent: false, desc: 'Baada ya Meneja kuidhinisha: kilo, mauzo, makato na atakacholipwa.' },
  PAYMENT_SENT: { group: 'FARMER', label: 'Malipo ya mauzo yametumwa', who: 'Mkulima', urgent: false, desc: 'Mhasibu akithibitisha malipo: kiasi na njia (M-Pesa / benki / taslimu).' },
  // ---- Vikundi ----
  GROUP_REGISTERED: { group: 'GROUP', label: 'Kikundi kimesajiliwa', who: 'Wanakikundi wote', urgent: false, desc: 'Kikundi kikiidhinishwa: jina, kiongozi na wanachama — wanadhaminiana madeni.' },
  GROUP_MEMBER_JOINED: { group: 'GROUP', label: 'Mwanachama amejiunga na kikundi', who: 'Aliyejiunga + wanakikundi', urgent: false, desc: 'Mwanachama mpya akiidhinishwa kujiunga.' },
  GROUP_MEMBER_LEFT: { group: 'GROUP', label: 'Mwanachama amehama / ametoka kikundini', who: 'Aliyetoka + wanakikundi', urgent: false, desc: 'Mwanachama akiidhinishwa kutoka kwenye kikundi.' },
  GROUP_INPUT_TAKEN: { group: 'GROUP', label: 'Mwanakikundi amechukua pembejeo', who: 'Wanakikundi wengine', urgent: false, desc: 'Mwanakikundi akikabidhiwa pembejeo: alichochukua na deni la jumla la kikundi.' },
  GROUP_DEBT: { group: 'GROUP', label: 'Taarifa ya deni la kikundi', who: 'Wanakikundi wote', urgent: false, desc: 'Meneja / Mhasibu akibonyeza "Tuma deni kwa SMS": deni la kikundi na la kila mmoja.' },
  // ---- Matangazo ----
  CHAMA_BROADCAST: { group: 'BROADCAST', label: 'Matangazo na taarifa za vikao (chama)', who: 'Wakulima (wote / kijiji / kikundi)', urgent: false, desc: 'Meneja anatuma tangazo au taarifa ya kikao kwa wakulima — kikomo cha SMS kwa mwezi kinawekwa na Owner.' },
  OWNER_ANNOUNCEMENT: { group: 'BROADCAST', label: 'Matangazo ya CoopLink kwa vyama', who: 'Watumishi wa vyama', urgent: false, desc: 'Matangazo unayotuma kutoka Marketing & Communication.' },
  SYSTEM_ALERT: { group: 'BROADCAST', label: 'Tahadhari za mfumo kwa Owner', who: 'Owner / Tech Support', urgent: true, desc: 'System Control Center: tahadhari kubwa (CRITICAL).' },
} as const;
export type SmsKind = keyof typeof SMS_KINDS;
export const SMS_GROUPS: Record<string, string> = { OTP: 'OTP na usalama', FARMER: 'Taarifa kwa mkulima', GROUP: 'Vikundi', BROADCAST: 'Matangazo na tahadhari' };
/** Zilizokuwa zikitumika kabla ya swichi hizi zinaanza zikiwa wazi; mpya zote zimefungwa mpaka Owner aziwashe. */
export const SMS_EVENT_DEFAULTS = Object.fromEntries((Object.keys(SMS_KINDS) as SmsKind[]).map((k) => [k, ['SECURITY_ALERT', 'OWNER_ANNOUNCEMENT', 'SYSTEM_ALERT', 'STAFF_CREDENTIALS'].includes(k)])) as Record<SmsKind, boolean>;

