// =====================================================================
//  KUPAKIA WAKULIMA WENGI KWA MARA MOJA (uhamisho kutoka daftari/Excel la chama)
//  Kila mstari unakaguliwa kwanza (hakiki), kisha Meneja anathibitisha kwa nenosiri.
//  Majina yanachukuliwa kutoka daftari rasmi la chama; mkulima akihaririwa baadaye,
//  sheria za kawaida za majina kutoka namba ya simu zinatumika.
// =====================================================================
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db';
import { normalizePhone } from './http';

const M = schema.members;
export const MAX_IMPORT_ROWS = 2000;

export type RawRow = Record<string, unknown>;
export interface CleanRow {
  memberNo: string | null; firstName: string; middleName: string | null; lastName: string; gender: 'MALE' | 'FEMALE'; maritalStatus: 'MARRIED' | 'SINGLE' | null;
  phone: string | null; village: string | null; hamlet: string | null; nidaNumber: string | null; voterIdNumber: string | null;
  dateOfBirth: string | null; joinedAt: string | undefined; sharesCount: number;
  mobileMoneyNumber: string | null; mobileMoneyProvider: (typeof schema.mobileMoneyProviderEnum.enumValues)[number] | null;
  bankName: string | null; bankAccountNumber: string | null; bankAccountName: string | null;
  preferredPayment: 'MOBILE_MONEY' | 'BANK' | 'CASH';
}
export interface CheckedRow { row: number /* mstari wa Excel: kichwa ni 1, mkulima wa kwanza ni 2 */; ok: boolean; errors: string[]; warnings: string[]; data: CleanRow | null; name: string }

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();
const opt = (v: unknown) => str(v) || null;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

function gender(v: unknown): 'MALE' | 'FEMALE' | null {
  const g = str(v).toUpperCase();
  if (['M', 'ME', 'MALE', 'MWANAUME', 'MUME'].includes(g)) return 'MALE';
  if (['F', 'KE', 'FEMALE', 'MWANAMKE', 'MKE'].includes(g)) return 'FEMALE';
  return null;
}
/** Hali ya ndoa: ameoa / ameolewa -> MARRIED; hajaoa / hajaolewa / sijaoa -> SINGLE */
function marital(v: unknown): 'MARRIED' | 'SINGLE' | null | undefined {
  const m = str(v).toUpperCase().replace(/\s+/g, '');
  if (!m) return null;
  if (['MARRIED', 'AMEOA', 'AMEOLEWA', 'NIMEOA', 'NIMEOLEWA', 'NDOA', 'ND'].includes(m)) return 'MARRIED';
  if (['SINGLE', 'HAJAOA', 'HAJAOLEWA', 'SIJAOA', 'SIJAOLEWA', 'HAPANA'].includes(m)) return 'SINGLE';
  return undefined;
}
function provider(v: unknown): CleanRow['mobileMoneyProvider'] {
  const p = str(v).toUpperCase().replace(/[\s-]/g, '');
  if (!p) return null;
  if (['MPESA', 'VODACOM', 'VODA'].includes(p)) return 'MPESA';
  if (['AIRTEL', 'AIRTELMONEY'].includes(p)) return 'AIRTEL_MONEY';
  if (['TIGO', 'TIGOPESA', 'MIXX', 'MIXXBYYAS', 'YAS'].includes(p)) return 'MIXX_BY_YAS';
  if (['HALOPESA', 'HALOTEL'].includes(p)) return 'HALOPESA';
  if (['TPESA', 'TTCL'].includes(p)) return 'TPESA';
  return null;
}
/** Mtandao kwa namba (makadirio ya kawaida ya Tanzania) — inatumika mtandao usipoandikwa */
function providerFromPhone(p: string): CleanRow['mobileMoneyProvider'] {
  const pre = p.slice(3, 5);
  if (['74', '75', '76'].includes(pre)) return 'MPESA';
  if (['68', '69', '78'].includes(pre)) return 'AIRTEL_MONEY';
  if (['65', '67', '71', '77'].includes(pre)) return 'MIXX_BY_YAS';
  if (['61', '62'].includes(pre)) return 'HALOPESA';
  if (['73'].includes(pre)) return 'TPESA';
  return null;
}
function dateOf(v: unknown): string | null | 'BAD' {
  const s = str(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY (mtindo wa Tanzania)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return 'BAD';
}
const validDate = (d: string) => {
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d && d >= '1900-01-01' && d <= new Date().toISOString().slice(0, 10);
}; // mf. 31/02 au tarehe ya baadaye -> si sahihi

/** Kagua mistari yote: makosa (yanazuia) na tahadhari (haziziuii). */
export async function checkRows(amcosId: string, raw: RawRow[]): Promise<CheckedRow[]> {
  const out: CheckedRow[] = raw.map((r, i) => {
    const errors: string[] = [], warnings: string[] = [];
    // Daftari lenye safu moja ya "Majina kamili": la kwanza = neno la kwanza, la ukoo = la mwisho, la kati = yaliyobaki
    let fn = str(r.firstName), mn = str(r.middleName), ln = str(r.lastName);
    const full = str(r.fullName);
    if (full && !fn && !ln) {
      const w = full.split(' ').filter(Boolean);
      if (w.length < 2) errors.push(`Majina kamili "${full}" yawe angalau mawili (la kwanza na la ukoo)`);
      else { fn = w[0]; ln = w[w.length - 1]; mn = w.slice(1, -1).join(' '); }
    }
    const firstName = titleCase(fn), lastName = titleCase(ln), middleName = mn ? titleCase(mn) : null;
    if (!full || fn || ln) {
      if (firstName.length < 2) errors.push('Jina la kwanza linakosekana');
      if (lastName.length < 2) errors.push('Jina la ukoo linakosekana');
    } else if (errors.length === 0 && (firstName.length < 2 || lastName.length < 2)) errors.push(`Majina kamili "${full}" si sahihi`);
    const g = gender(r.gender);
    if (!g) errors.push(`Jinsia "${str(r.gender) || '—'}" haieleweki (tumia M/F au ME/KE)`);
    const ms = marital(r.maritalStatus);
    if (ms === undefined) warnings.push(`Hali ya ndoa "${str(r.maritalStatus)}" haieleweki (Ameoa/Ameolewa/Hajaoa) — imeachwa wazi`);
    const memberNo = opt(r.memberNo)?.toUpperCase() ?? null;
    if (memberNo && !/^[A-Z0-9][A-Z0-9/.\- ]{0,29}$/.test(memberNo)) errors.push(`Namba ya uanachama "${memberNo}" si sahihi`);
    let phone: string | null = null;
    if (str(r.phone)) { phone = normalizePhone(str(r.phone)); if (!phone) errors.push(`Simu "${str(r.phone)}" si sahihi`); }
    const nida = opt(r.nidaNumber)?.replace(/\D/g, '') || null;
    if (nida && nida.length !== 20) errors.push('Namba ya NIDA iwe tarakimu 20');
    const voter = opt(r.voterIdNumber)?.toUpperCase() ?? null;
    if (voter && !/^[A-Z0-9][A-Z0-9\- ]{5,24}$/.test(voter)) errors.push('Namba ya kadi ya mpiga kura si sahihi');
    const joined = dateOf(r.joinedAt), dob = dateOf(r.dateOfBirth);
    if (joined === 'BAD' || (joined && !validDate(joined))) errors.push(`Tarehe ya kujiunga "${str(r.joinedAt)}" si sahihi (tumia DD/MM/YYYY)`);
    if (dob === 'BAD' || (dob && !validDate(dob))) errors.push(`Tarehe ya kuzaliwa "${str(r.dateOfBirth)}" si sahihi (tumia DD/MM/YYYY)`);
    const sharesRaw = str(r.sharesCount).replace(/,/g, '');
    const shares = sharesRaw ? Number(sharesRaw) : 0;
    if (!Number.isInteger(shares) || shares < 0) errors.push(`Hisa "${str(r.sharesCount)}" si namba kamili`);
    let mm: string | null = null;
    if (str(r.mobileMoneyNumber)) { mm = normalizePhone(str(r.mobileMoneyNumber)); if (!mm) errors.push(`Namba ya malipo ya simu "${str(r.mobileMoneyNumber)}" si sahihi`); }
    let prov = provider(r.mobileMoneyProvider);
    if (str(r.mobileMoneyProvider) && !prov) warnings.push(`Mtandao "${str(r.mobileMoneyProvider)}" haujulikani — umekadiriwa kwa namba`);
    if (mm && !prov) prov = providerFromPhone(mm);
    const bankAcc = opt(r.bankAccountNumber);
    const preferred: CleanRow['preferredPayment'] = mm ? 'MOBILE_MONEY' : bankAcc ? 'BANK' : 'CASH';
    if (!str(r.phone)) warnings.push('Hana simu');
    const data: CleanRow | null = errors.length ? null : {
      memberNo, firstName, middleName, lastName, gender: g!, maritalStatus: ms ?? null, phone, village: opt(r.village) ? titleCase(str(r.village)) : null, hamlet: opt(r.hamlet) ? titleCase(str(r.hamlet)) : null,
      nidaNumber: nida, voterIdNumber: voter, dateOfBirth: dob && dob !== 'BAD' ? dob : null, joinedAt: joined && joined !== 'BAD' ? joined : undefined, sharesCount: shares,
      mobileMoneyNumber: mm, mobileMoneyProvider: mm ? prov : null, bankName: opt(r.bankName), bankAccountNumber: bankAcc, bankAccountName: opt(r.bankAccountName) ? titleCase(str(r.bankAccountName)) : null,
      preferredPayment: preferred,
    };
    return { row: i + 2, ok: !errors.length, errors, warnings, data, name: [firstName, middleName, lastName].filter(Boolean).join(' ') };
  });

  // Marudio ndani ya faili
  const dupIn = (key: (c: CleanRow) => string | null, label: string) => {
    const seen = new Map<string, number>();
    for (const c of out) {
      const k = c.data ? key(c.data) : null;
      if (!k) continue;
      if (seen.has(k)) { c.errors.push(`${label} ${k} inajirudia (mstari ${seen.get(k)})`); c.ok = false; }
      else seen.set(k, c.row);
    }
  };
  dupIn((d) => d.memberNo, 'Namba ya uanachama');
  dupIn((d) => d.nidaNumber, 'NIDA');
  dupIn((d) => d.voterIdNumber, 'Kadi ya mpiga kura');
  const phones = new Map<string, number>();
  for (const c of out) if (c.data?.phone) { if (phones.has(c.data.phone)) c.warnings.push(`Simu inatumika pia na mstari ${phones.get(c.data.phone)}`); else phones.set(c.data.phone, c.row); }

  // Marudio dhidi ya wakulima waliopo
  const exist = async (col: typeof M.memberNo | typeof M.nidaNumber | typeof M.voterIdNumber, vals: string[], label: string, pick: (d: CleanRow) => string | null) => {
    if (!vals.length) return;
    const rows = await db.select({ v: col, memberNo: M.memberNo, firstName: M.firstName, lastName: M.lastName }).from(M).where(and(eq(M.amcosId, amcosId), inArray(col, vals)));
    const byV = new Map(rows.map((r) => [String(r.v), r]));
    for (const c of out) {
      const v = c.data ? pick(c.data) : null;
      const hit = v ? byV.get(v) : undefined;
      if (hit) { c.errors.push(`${label} ${v} tayari ni ya ${hit.firstName} ${hit.lastName} (${hit.memberNo})`); c.ok = false; }
    }
  };
  const vals = (pick: (d: CleanRow) => string | null) => [...new Set(out.map((c) => (c.data ? pick(c.data) : null)).filter((x): x is string => !!x))];
  await exist(M.memberNo, vals((d) => d.memberNo), 'Namba ya uanachama', (d) => d.memberNo);
  await exist(M.nidaNumber, vals((d) => d.nidaNumber), 'NIDA', (d) => d.nidaNumber);
  await exist(M.voterIdNumber, vals((d) => d.voterIdNumber), 'Kadi ya mpiga kura', (d) => d.voterIdNumber);
  // Simu iliyopo tayari kwa mkulima mwingine — tahadhari tu (familia hushirikiana namba)
  const ph = vals((d) => d.phone);
  if (ph.length) {
    const rows = await db.select({ phone: M.phone, memberNo: M.memberNo }).from(M).where(and(eq(M.amcosId, amcosId), inArray(M.phone, ph)));
    const byP = new Map(rows.map((r) => [r.phone!, r.memberNo]));
    for (const c of out) if (c.data?.phone && byP.has(c.data.phone)) c.warnings.push(`Simu hii inatumika pia na ${byP.get(c.data.phone)}`);
  }
  for (const c of out) c.ok = !c.errors.length;
  return out;
}
