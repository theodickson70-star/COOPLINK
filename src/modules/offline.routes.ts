// =====================================================================
//  KAZI NJE YA MTANDAO (v2.9) — /api/v1/offline
//  Kifurushi cha data kinachohifadhiwa kwenye simu/kompyuta ya mtumishi ili afanye kazi vijijini bila mtandao:
//   - wakulima hai (namba, jina, kijiji) · pembejeo (kipimo, bei ya msimu, salio la stoo) · mapendekezo ya vijiji
//  Kazi za offline (ugawaji wa pembejeo, usajili wa mkulima) zinatumwa baadaye kwa njia za KAWAIDA zenye `clientRef`
//  — kila ukaguzi wa server (stoo, bei, OTP ya namba, idhini ya Meneja) unafanyika wakati huo. Hakuna njia ya mkato.
//  Hakuna namba kamili za simu wala vitambulisho kwenye kifurushi.
// =====================================================================
import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { ah } from '../lib/http';
import { badRequest } from '../lib/errors';
import { requireAmcosPerm } from '../middleware/auth';
import { canAmcos } from '../lib/amcos-permissions';
import { resolveWriteAmcosId } from '../middleware/tenant';
import { currentSeason } from './seasons.routes';
import { currentRate, inputCurrency } from '../lib/fx';
import { villagesOf } from '../lib/locations';

export const offlineRouter = Router();
export const OFFLINE_MAX_MEMBERS = 30_000;

offlineRouter.get('/pack', requireAmcosPerm('members.read'), ah(async (req, res) => {
  const amcosId = await resolveWriteAmcosId(req);
  const season = await currentSeason();
  if (!season) throw badRequest('Hakuna msimu wa sasa');
  const a = (await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { name: true, code: true, region: true, district: true, ward: true, village: true } }))!;
  const M = schema.members;
  const members = await db.select({
    id: M.id, memberNo: M.memberNo, firstName: M.firstName, middleName: M.middleName, lastName: M.lastName, village: M.village,
    phoneEnd: sql<string | null>`right(${M.phone}, 3)`,
  }).from(M).where(and(eq(M.amcosId, amcosId), eq(M.status, 'ACTIVE'))).orderBy(asc(M.lastName), asc(M.firstName)).limit(OFFLINE_MAX_MEMBERS);
  const canIssue = canAmcos(req.auth!, 'issues.request');
  const items = canIssue ? (await db.execute<{ id: string; name: string; unit: string; category: string; pack_kg: string | null; loose_kg: boolean; price: string | null; price_usd: string | null; balance: string }>(sql`
    select i.id, i.name, i.unit, i.category, i.pack_kg, i.loose_kg, p.unit_price as price, p.unit_price_usd as price_usd,
      coalesce((select sum(m.quantity) from stock_movements m where m.input_item_id = i.id and m.season_id = ${season.id}), 0) as balance
    from input_items i left join input_prices p on p.input_item_id = i.id and p.season_id = ${season.id}
    where i.amcos_id = ${amcosId} and i.is_active = true order by i.name`)).rows.map((x) => ({
    id: x.id, name: x.name, unit: x.unit, category: x.category, packKg: x.pack_kg, looseKg: x.loose_kg, price: x.price, priceUsd: x.price_usd, balance: x.balance,
  })) : [];
  const used = (await db.execute<{ v: string }>(sql`select distinct village as v from members where amcos_id = ${amcosId} and village is not null and village <> '' limit 300`)).rows.map((x) => x.v);
  const villages = [...new Map([...used, ...villagesOf(a.region, a.district, a.ward)].map((v) => [v.trim().toLowerCase(), v.trim()])).values()];
  const usd = (await inputCurrency(db, amcosId)) === 'USD';
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    at: new Date().toISOString(), amcos: { id: amcosId, name: a.name, code: a.code }, season: { id: season.id, name: season.name },
    can: { issue: canIssue, register: canAmcos(req.auth!, 'members.write'), approveMembers: canAmcos(req.auth!, 'members.approve') },
    usdMode: usd, rate: usd ? (await currentRate(db, amcosId))?.usdToTzs ?? null : null,
    members: members.map((m) => ({ id: m.id, memberNo: m.memberNo, name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(' '), village: m.village, phoneEnd: m.phoneEnd })),
    truncated: members.length >= OFFLINE_MAX_MEMBERS,
    items, villages,
  });
}));
