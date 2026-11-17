// =====================================================================
//  MAENEO YA TANZANIA (v2.5) — Mkoa → Wilaya → Kata, yanachaguliwa kwenye orodha (si kuandikwa)
//  Chanzo: HackEAC/tanzania-locations-db (postikodi za Posta Tanzania): mikoa 26 ya Tanzania Bara,
//  wilaya 158, kata ~3,960. Faili: src/data/tz-locations.json (majina yamesawazishwa: "X CBD" -> "X Mjini").
//  Backend inathibitisha kila thamani mpya; thamani za zamani (zilizoandikwa kabla) zinaachwa kama zilivyo
//  mpaka mtumiaji azibadilishe.
// =====================================================================
import data from '../data/tz-locations.json';
import { badRequest } from './errors';

interface Loc { regions: { name: string; districts: { name: string; wards: string[] }[] }[] }
export const TZ_LOCATIONS = data as Loc & { source: string };

const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const REGIONS = new Map(TZ_LOCATIONS.regions.map((r) => [key(r.name), r]));

type Prev = { region?: string | null; district?: string | null; ward?: string | null } | null | undefined;
type In = { region?: string | null; district?: string | null; ward?: string | null };

/**
 * Inarudisha majina rasmi (herufi sahihi) au inakataa thamani isiyo kwenye orodha.
 * - undefined = haibadilishwi; null/'' = inafutwa.
 * - Thamani isiyobadilika kutoka rekodi ya zamani (`prev`) inakubaliwa hata kama si ya orodha (data ya zamani).
 * - Wilaya lazima iwe ya mkoa uliochaguliwa, kata lazima iwe ya wilaya iliyochaguliwa.
 */
export function checkLocation<T extends In>(b: T, prev?: Prev, opts: { requireDistrict?: boolean } = {}): T {
  const pick = (k: keyof In) => (b[k] === undefined ? (prev?.[k] ?? null) : (b[k] || null));
  const same = (k: keyof In) => b[k] === undefined || (b[k] ?? '') === (prev?.[k] ?? '');
  const region = pick('region'), district = pick('district'), ward = pick('ward');
  const out = { ...b };

  const r = region ? REGIONS.get(key(region)) : undefined;
  if (region && !r && !same('region')) throw badRequest(`Mkoa "${region}" haupo kwenye orodha — chagua kwenye orodha`);
  if (r && b.region !== undefined) out.region = r.name;

  const d = r && district ? r.districts.find((x) => key(x.name) === key(district)) : undefined;
  if (district && !d && !(same('district') && same('region'))) {
    throw badRequest(r ? `Wilaya "${district}" si ya mkoa wa ${r.name} — chagua kwenye orodha` : 'Chagua mkoa kwanza, kisha wilaya kwenye orodha');
  }
  if (d && b.district !== undefined) out.district = d.name;
  if (opts.requireDistrict && !district) throw badRequest('Chagua wilaya');

  const w = d && ward ? d.wards.find((x) => key(x) === key(ward)) : undefined;
  if (ward && !w && !(same('ward') && same('district') && same('region'))) {
    throw badRequest(d ? `Kata "${ward}" si ya wilaya ya ${d.name} — chagua kwenye orodha` : 'Chagua wilaya kwanza, kisha kata kwenye orodha');
  }
  if (w && b.ward !== undefined) out.ward = w;
  return out;
}
