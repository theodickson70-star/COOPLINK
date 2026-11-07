// =====================================================================
//  SMS na Email
//  SMS: Africa's Talking — inafanya kazi TU ikiwa AT_USERNAME na AT_API_KEY zimewekwa.
//       (Imeandikwa kwa API rasmi ya AT lakini HAIJAJARIBIWA na akaunti halisi.)
//  Email: hakuna provider aliyesanidiwa bado -> kila email inarekodiwa kama SKIPPED.
//  Hakuna ujumbe unaorekodiwa kama "umetumwa" bila jibu la mafanikio kutoka kwa provider.
// =====================================================================
export type DeliveryResult = { status: 'SENT' | 'FAILED' | 'SKIPPED'; providerRef?: string; error?: string };

export const smsConfigured = () => !!(process.env.AT_USERNAME && process.env.AT_API_KEY);
export const emailConfigured = () => false;

export async function sendSms(to: string, message: string): Promise<DeliveryResult> {
  if (!smsConfigured()) return { status: 'SKIPPED', error: 'SMS provider haijasanidiwa (AT_USERNAME / AT_API_KEY)' };
  const username = process.env.AT_USERNAME!;
  const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const body = new URLSearchParams({ username, to: `+${to.replace(/^\+/, '')}`, message });
  if (process.env.AT_SENDER_ID) body.set('from', process.env.AT_SENDER_ID);
  try {
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey: process.env.AT_API_KEY!, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { status?: string; messageId?: string }[]; Message?: string } };
    const r = data.SMSMessageData?.Recipients?.[0];
    if (res.ok && r?.status === 'Success') return { status: 'SENT', providerRef: r.messageId };
    return { status: 'FAILED', error: r?.status ?? data.SMSMessageData?.Message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { status: 'FAILED', error: (e as Error).message };
  }
}

export async function sendEmail(_to: string, _subject: string, _text: string): Promise<DeliveryResult> {
  return { status: 'SKIPPED', error: 'Email provider haijasanidiwa' };
}
