import Decimal from 'decimal.js';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const fmt2 = (v: Decimal.Value) => new Decimal(v).toFixed(2);
