// =====================================================================
//  MAJINA KUTOKA NAMBA YA SIMU (Abliner Name Lookup)
//  Popote panapohitajika namba ya simu na jina, jina linatoka kwenye usajili wa mobile money wa namba hiyo
//  — haliandikwi kwa mkono. Seva ndiyo inaweka jina (haiamini jina lililotumwa na kivinjari).
//  Huduma ikiwa haijawashwa au haipatikani kwa muda (mtandao/5xx), jina lililoandikwa linakubaliwa ili kazi zisisimame.
// =====================================================================
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { badRequest, AppError } from './errors';
import { lookupName } from './abliner';
import { normalizePhone } from './http';
import { getSetting } from './settings';

const L = schema.phoneNameLookups;
const FOUND_TTL = 30 * 86_400_000; // jina lililopatikana: siku 30
const MISS_TTL = 6 * 3_600_000;    // halikupatikana: saa 6 (huenda mtu amesajili sasa hivi)

export const lookupEnabled = () => !!process.env.ABLINER_API_KEY?.trim();

/** "JOHN JUMA DOE" -> "John Juma Doe" */
export function formatName(raw: string) {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
    .map((w) => w.split(/([-'])/).map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p)).join('')).join(' ');
}
/** Jina kamili -> la kwanza / la kati / la ukoo */
export function splitName(full: string) {
  const w = full.split(' ').filter(Boolean);
  if (w.length === 1) return { firstName: w[0], middleName: null as string | null, lastName: w[0] };
  return { firstName: w[0], middleName: w.length > 2 ? w.slice(1, -1).join(' ') : null, lastName: w[w.length - 1] };
}

export type Lookup =
  | { status: 'FOUND'; phone: string; name: string; network: string | null; cached: boolean }
  | { status: 'NOT_FOUND'; phone: string }
  | { status: 'UNAVAILABLE'; phone: string; reason: string }
  | { status: 'DISABLED'; phone: string }
  | { status: 'INVALID'; phone: string };

export async function resolvePhoneName(input: string): Promise<Lookup> {
  const phone = normalizePhone(input);
  if (!phone) return { status: 'INVALID', phone: input };
  if (!lookupEnabled() || !(await getSetting('switches')).nameLookup) return { status: 'DISABLED', phone };
  const [c] = await db.select().from(L).where(eq(L.phone, phone));
  if (c) {
    const age = Date.now() - c.checkedAt.getTime();
    if (c.status === 'FOUND' && c.name && age < FOUND_TTL) return { status: 'FOUND', phone, name: formatName(c.name), network: c.network, cached: true };
    if (c.status === 'NOT_FOUND' && age < MISS_TTL) return { status: 'NOT_FOUND', phone };
  }
  try {
    const r = await lookupName(phone);
    const row = { phone, status: r ? 'FOUND' : 'NOT_FOUND', name: r?.name ?? null, network: r?.network ?? null, checkedAt: new Date() };
    await db.insert(L).values(row).onConflictDoUpdate({ target: L.phone, set: row });
    return r ? { status: 'FOUND', phone, name: formatName(r.name), network: r.network ?? null, cached: false } : { status: 'NOT_FOUND', phone };
  } catch (e) {
    // jina la zamani lililoko kwenye akiba ni bora kuliko kusimamisha kazi
    if (c?.status === 'FOUND' && c.name) return { status: 'FOUND', phone, name: formatName(c.name), network: c.network, cached: true };
    return { status: 'UNAVAILABLE', phone, reason: (e as Error).message.slice(0, 200) };
  }
}

const local = (p: string) => (p.startsWith('255') ? '0' + p.slice(3) : p);

/**
 * Jina la kutumia kwa namba hii: jina la mobile money likipatikana (jina lililoandikwa linapuuzwa).
 * Namba isiyosajiliwa -> kosa. Huduma haipo/haipatikani -> jina lililoandikwa (likiwepo).
 */
export async function verifiedName(phone: string | null | undefined, typed: string | null | undefined, label = 'Namba ya simu'): Promise<string | null> {
  if (!phone) return typed?.trim() || null;
  const r = await resolvePhoneName(phone);
  if (r.status === 'FOUND') return r.name;
  if (r.status === 'NOT_FOUND') throw badRequest(`${label} ${local(r.phone)} haijasajiliwa kwenye mobile money, kwa hiyo jina haliwezi kuthibitishwa. Hakikisha namba ni sahihi au tumia namba nyingine.`);
  if (typed?.trim()) return typed.trim();
  if (r.status === 'UNAVAILABLE') throw new AppError(503, 'NAME_LOOKUP_UNAVAILABLE', 'Huduma ya kuthibitisha majina haipatikani kwa sasa. Jaribu tena baada ya muda mfupi.');
  return null;
}

/** Jina la mobile money la namba hii, au null kama huduma haipo/haipatikani. Namba isiyosajiliwa -> kosa. */
export async function lookupNameOrNull(phone: string, label = 'Namba ya simu'): Promise<string | null> {
  const r = await resolvePhoneName(phone);
  if (r.status === 'FOUND') return r.name;
  if (r.status === 'NOT_FOUND') throw badRequest(`${label} ${local(r.phone)} haijasajiliwa kwenye mobile money, kwa hiyo jina haliwezi kuthibitishwa. Hakikisha namba ni sahihi au tumia namba nyingine.`);
  return null;
}
