import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const fmt2 = (v: Decimal.Value) => new Decimal(v).toFixed(2);

/** Kiasi kwa maandishi ya kusoma (mf. kwenye kichwa cha ombi): TSh 150,000 */
export const tshText = (v: Decimal.Value) => `TSh ${new Decimal(v).toNumber().toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
