// =====================================================================
//  NENOSIRI LA MUDA KWA SMS (v0.37+)
//   Wafanyakazi wa CoopLink na watumishi wa vyama (Meneja, Mhasibu, Storekeeper) wanatumiwa nenosiri la muda
//   kwa SMS kwenye simu yao wenyewe; wanalibadilisha wakiingia mara ya kwanza.
//   - Aliyeunda akaunti HALIONI nenosiri (isipokuwa SMS ikishindwa — basi linarudishwa mara moja ili ampe kwa mkono).
//   - Kumbukumbu ya SMS inahifadhiwa BILA nenosiri.
//   - Linaisha baada ya saa 72 (chama kisichoidhinishwa bado: halina muda — kinaisha kuanzia kiidhinishwe).
// =====================================================================
import { sendNow } from './sms';
import { getSetting } from './settings';

export const TEMP_PASSWORD_HOURS = 72;
export const ROLE_TITLE_SW: Record<string, string> = {
  FINANCE_MANAGER: 'Finance Manager', CUSTOMER_SUPPORT: 'Huduma kwa Wateja na Masoko', MARKETING_MANAGER: 'Huduma kwa Wateja na Masoko', TECH_SUPPORT: 'Msaada wa Kiufundi',
  AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Storekeeper', AMCOS_VIEWER: 'Mtazamaji',
  UNION_ADMIN: 'Msimamizi wa Chama Kikuu', UNION_VIEWER: 'Mtazamaji wa Chama Kikuu',
};
export const tempExpiry = () => new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600_000);

export type Delivery = { status: string; phone: string; error: string | null };
export const maskPhone = (p: string) => p.replace(/^255/, '0').replace(/^(\d{4})\d{3}(\d{3})$/, '$1•••$2');

export async function sendTempCredentials(
  u: { id: string; fullName: string; phone: string; role: string; amcosId?: string | null },
  password: string,
  opts: { kind: 'NEW' | 'RESET'; amcosName?: string | null; pending?: boolean },
): Promise<Delivery> {
  const site = (await getSetting('business.profile')).website || 'cooplink';
  const local = u.phone.replace(/^255/, '0');
  const first = u.fullName.split(' ')[0];
  const title = ROLE_TITLE_SW[u.role] ?? 'mtumiaji';
  const head = opts.kind === 'NEW'
    ? `CoopLink: Karibu ${first}! Umesajiliwa kama ${title}${opts.amcosName ? ` wa ${opts.amcosName}` : ''}.`
    : `CoopLink: ${first}, nenosiri jipya la muda limetolewa kwa akaunti yako${opts.amcosName ? ` ya ${opts.amcosName}` : ''}.`;
  const expiry = opts.pending ? 'Utaweza kuingia chama kikiidhinishwa.' : `(linaisha baada ya saa ${TEMP_PASSWORD_HOURS}).`;
  const tail = `Ingia: ${site}/login Simu: ${local} Nenosiri la muda: ${password} ${expiry} Utaweka nenosiri lako. Usimpe mtu yeyote.`;
  const r = await sendNow({
    kind: 'STAFF_CREDENTIALS', phone: u.phone, userId: u.id, amcosId: u.amcosId ?? null,
    text: `${head} ${tail}`, logText: `${head} ${tail.replace(password, '••••••••')}`,
  });
  return { status: r.status, phone: maskPhone(u.phone), error: r.status === 'SENT' ? null : r.error ?? null };
}
