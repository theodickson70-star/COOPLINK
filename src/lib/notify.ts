// =====================================================================
//  SMS na Email
//  SMS: kupitia lib/sms.ts (RodSMS au Africa's Talking, swichi za Owner, kumbukumbu).
//  Email: hakuna provider aliyesanidiwa bado -> kila email inarekodiwa kama SKIPPED.
//  Hakuna ujumbe unaorekodiwa kama "umetumwa" bila jibu la mafanikio kutoka kwa provider.
// =====================================================================
import { sendNow, type DeliveryResult, type SmsKind } from './sms';
export type { DeliveryResult } from './sms';

export const emailConfigured = () => false;
export { smsConfigured } from './sms';

/** SMS moja (inapita kwenye msingi wa SMS: swichi, kumbukumbu, mtoa huduma). */
export async function sendSms(to: string, message: string, kind: SmsKind = 'SYSTEM_ALERT', opts: { force?: boolean; amcosId?: string | null; userId?: string | null } = {}): Promise<DeliveryResult> {
  return sendNow({ kind, phone: to, text: message, amcosId: opts.amcosId, userId: opts.userId }, { force: opts.force });
}

export async function sendEmail(_to: string, _subject: string, _text: string): Promise<DeliveryResult> {
  return { status: 'SKIPPED', error: 'Email provider haijasanidiwa' };
}
