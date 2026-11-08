// Code ya chama inatolewa na mfumo (haiandikwi kwa mkono): neno kuu la jina + namba ikihitajika.
//   "Usoke AMCOS"            -> USOKE     (wanachama: USOKE-000001)
//   "Chama cha Msingi Usoke" -> USOKE2    (kama USOKE tayari ipo)
// Code haibadilishwi baadaye kwa sababu iko kwenye namba za wanachama na miamala.
import { eq, sql } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';

const SKIP = new Set(['AMCOS', 'CHAMA', 'CHA', 'MSINGI', 'MSINGI.', 'LTD', 'LIMITED', 'THE', 'OF', 'WA', 'YA', 'NA', 'KIKUU', 'USHIRIKA', 'COOPERATIVE', 'SOCIETY', 'PRIMARY', 'MARKETING', 'TUMBAKU', 'TOBACCO']);

export function codeBase(name: string) {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const main = words.find((w) => !SKIP.has(w) && /[A-Z]/.test(w)) ?? words.find((w) => /[A-Z]/.test(w)) ?? 'AMC';
  const base = main.slice(0, 8);
  return base.length >= 2 ? base : `${base}AMC`.slice(0, 3);
}

/** Code ya kipekee. Lazima iitwe ndani ya transaction (lock inazuia maombi mawili kupata code moja). */
export async function generateAmcosCode(tx: DbOrTx, name: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('amcos-code'))`);
  const base = codeBase(name);
  for (let n = 1; n < 1000; n++) {
    const code = n === 1 ? base : `${base.slice(0, 12 - String(n).length)}${n}`;
    const taken = await tx.query.amcos.findFirst({ where: eq(schema.amcos.code, code), columns: { id: true } });
    if (!taken) return code;
  }
  throw new Error('Imeshindikana kutoa code ya chama');
}
