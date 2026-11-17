// =====================================================================
//  HALI YA STOO (v2.8) — salio, zilizoingia/kutoka, zilizoisha, zinazokaribia kuisha
//   Hali ya kila bidhaa (msimu huu):
//     OUT  = imeisha (salio ≤ 0) baada ya kuwahi kuingia stoo
//     LOW  = salio ≤ kiwango cha chini kilichowekwa
//     SOON = haina kiwango, lakini kwa kasi ya kutoka (siku 30) itaisha ndani ya siku 14
//     OK   = salio linatosha · NEW = bado haijawahi kuingia stoo
//   Siku zilizobaki = salio / wastani wa kutoka kwa siku (siku 30 zilizopita).
//   Pendekezo la kiwango cha chini = mahitaji ya siku 14 kwa kasi ya sasa.
// =====================================================================
import { sql } from 'drizzle-orm';
import { db } from '../db';

export type StockStatus = 'OUT' | 'LOW' | 'SOON' | 'OK' | 'NEW';
export const SOON_DAYS = 14;

export interface StockRow {
  id: string; name: string; unit: string; category: string; packKg: string | null; looseKg: boolean; reorderLevel: string | null;
  balance: number; received: number; issued: number; returned: number; lost: number; adjusted: number;
  inPeriod: number; outPeriod: number; avgDaily: number; daysLeft: number | null; suggestedLevel: number | null;
  avgCost: number | null; value: number; status: StockStatus; lastIn: string | null; lastOut: string | null; lastMoveId: string | null;
}

export async function stockOverview(amcosId: string, seasonId: string, days = 30) {
  const r = await db.execute<{
    id: string; name: string; unit: string; category: string; pack_kg: string | null; loose_kg: boolean; reorder_level: string | null;
    balance: string; received: string; issued: string; returned: string; lost: string; adjusted: string; in_period: string; out_period: string;
    out30: string; avg_cost: string | null; last_in: string | null; last_out: string | null; last_move_id: string | null;
  }>(sql`
    select i.id, i.name, i.unit, i.category, i.pack_kg, i.loose_kg, i.reorder_level,
      coalesce(sum(m.quantity), 0) as balance,
      coalesce(sum(m.quantity) filter (where m.type = 'RECEIPT'), 0) as received,
      coalesce(-sum(m.quantity) filter (where m.type = 'ISSUE'), 0) as issued,
      coalesce(sum(m.quantity) filter (where m.type = 'RETURN'), 0) as returned,
      coalesce(-sum(m.quantity) filter (where m.type in ('DAMAGE', 'EXPIRY')), 0) as lost,
      coalesce(sum(m.quantity) filter (where m.type = 'ADJUSTMENT'), 0) as adjusted,
      coalesce(sum(m.quantity) filter (where m.quantity > 0 and m.created_at > now() - make_interval(days => ${days})), 0) as in_period,
      coalesce(-sum(m.quantity) filter (where m.quantity < 0 and m.created_at > now() - make_interval(days => ${days})), 0) as out_period,
      coalesce(-sum(m.quantity) filter (where m.type = 'ISSUE' and m.created_at > now() - interval '30 days'), 0) as out30,
      sum(m.quantity * m.unit_cost) filter (where m.type = 'RECEIPT' and m.unit_cost is not null)
        / nullif(sum(m.quantity) filter (where m.type = 'RECEIPT' and m.unit_cost is not null), 0) as avg_cost,
      max(m.created_at) filter (where m.quantity > 0) as last_in,
      max(m.created_at) filter (where m.quantity < 0) as last_out,
      (array_agg(m.id order by m.created_at desc) filter (where m.id is not null))[1] as last_move_id
    from input_items i
    left join stock_movements m on m.input_item_id = i.id and m.season_id = ${seasonId}
    where i.amcos_id = ${amcosId} and i.is_active = true
    group by i.id order by i.name`);

  const rows: StockRow[] = r.rows.map((x) => {
    const balance = Number(x.balance), received = Number(x.received);
    const avgDaily = Number(x.out30) / 30;
    const daysLeft = avgDaily > 0 ? Math.max(0, Math.floor(balance / avgDaily)) : null;
    const level = x.reorder_level === null ? null : Number(x.reorder_level);
    const status: StockStatus = received <= 0 && balance <= 0 ? 'NEW'
      : balance <= 0 ? 'OUT'
      : level !== null && balance <= level ? 'LOW'
      : level === null && daysLeft !== null && daysLeft <= SOON_DAYS ? 'SOON' : 'OK';
    const avgCost = x.avg_cost === null ? null : Number(x.avg_cost);
    return {
      id: x.id, name: x.name, unit: x.unit, category: x.category, packKg: x.pack_kg, looseKg: x.loose_kg, reorderLevel: x.reorder_level,
      balance, received, issued: Number(x.issued), returned: Number(x.returned), lost: Number(x.lost), adjusted: Number(x.adjusted),
      inPeriod: Number(x.in_period), outPeriod: Number(x.out_period), avgDaily: Math.round(avgDaily * 100) / 100, daysLeft,
      suggestedLevel: avgDaily > 0 ? Math.ceil(avgDaily * SOON_DAYS) : null,
      avgCost, value: avgCost !== null && balance > 0 ? Math.round(avgCost * balance) : 0,
      status, lastIn: x.last_in, lastOut: x.last_out, lastMoveId: x.last_move_id,
    };
  });

  // Mwenendo wa kila siku (siku N): idadi ya bidhaa zilizoingia / kutoka
  const daily = (await db.execute<{ day: string; ins: number; outs: number }>(sql`
    select to_char(d, 'YYYY-MM-DD') as day,
      (select count(*) from stock_movements m where m.amcos_id = ${amcosId} and m.quantity > 0 and (m.created_at at time zone 'Africa/Dar_es_Salaam')::date = d)::int as ins,
      (select count(*) from stock_movements m where m.amcos_id = ${amcosId} and m.quantity < 0 and (m.created_at at time zone 'Africa/Dar_es_Salaam')::date = d)::int as outs
    from generate_series((now() at time zone 'Africa/Dar_es_Salaam')::date - (${days}::int - 1), (now() at time zone 'Africa/Dar_es_Salaam')::date, interval '1 day') d`)).rows;

  const kpis = {
    items: rows.length,
    out: rows.filter((x) => x.status === 'OUT').length,
    low: rows.filter((x) => x.status === 'LOW').length,
    soon: rows.filter((x) => x.status === 'SOON').length,
    noLevel: rows.filter((x) => x.reorderLevel === null && x.status !== 'NEW').length,
    value: rows.reduce((t, x) => t + x.value, 0),
    movesIn: daily.reduce((t, d) => t + d.ins, 0),
    movesOut: daily.reduce((t, d) => t + d.outs, 0),
  };
  return { days, kpis, items: rows, daily };
}

/** Bidhaa zinazohitaji hatua (zimeisha / chini ya kiwango / zinakaribia kuisha) — kwa arifa. */
export async function stockAlerts(amcosId: string, seasonId: string) {
  const o = await stockOverview(amcosId, seasonId, 30);
  return o.items.filter((x) => x.status === 'OUT' || x.status === 'LOW' || x.status === 'SOON');
}
