import { z } from 'zod';
import { today, addDays } from '../../lib/subscriptions';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarehe iwe YYYY-MM-DD');

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (to ni pamoja). Chaguo-msingi: siku 30 zilizopita. */
export const rangeQuery = z
  .object({ from: dateStr.optional(), to: dateStr.optional() })
  .transform((q) => {
    const to = q.to ?? today();
    const from = q.from ?? addDays(to, -29);
    return { from, to, fromTs: new Date(`${from}T00:00:00+03:00`), toTs: new Date(`${addDays(to, 1)}T00:00:00+03:00`) };
  })
  .refine((r) => r.from <= r.to, { message: 'Tarehe ya mwanzo iwe kabla ya mwisho' });

export { dateStr };

/** CSV inayofunguka vizuri kwenye Excel (UTF-8 BOM). */
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
