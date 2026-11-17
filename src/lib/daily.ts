// =====================================================================
//  TAARIFA ZA KIOTOMATIKI KWA SMS (v2.9)
//   1. Tahadhari ya stoo (kila saa): bidhaa ikiisha / ikishuka chini ya kiwango / ikikaribia kuisha
//      -> SMS moja kwa Storekeeper na Meneja wa chama. Inatumwa tu hali ya bidhaa ikiwa MBAYA ZAIDI kuliko
//      ilivyotumwa mara ya mwisho (si kila saa). Bidhaa ikirudi sawa, hali yake inafutwa.
//   2. Muhtasari wa kila siku kwa Meneja (asubuhi saa 1): mapato/matumizi ya jana, idhini zinazosubiri,
//      pembejeo zilizotolewa, wakulima wapya na stoo.
//   3. Muhtasari wa mfumo kwa Owner/Tech Support (asubuhi): uptime, makosa, SMS zilizoshindwa, tahadhari wazi.
//   Swichi: Owner → SMS (STOCK_ALERT, DAILY_SUMMARY). Vyama vya mafunzo havitumiwi SMS hizi.
// =====================================================================
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { enqueue, smsEnabled, type SmsMessage } from './sms';
import { sendSms } from './notify';
import { stockAlerts, type StockRow } from './stock-overview';
import { tshText } from './money';

const RANK: Record<string, number> = { OUT: 0, LOW: 1, SOON: 2 };
const UNIT: Record<string, string> = { BAG: 'mifuko', KG: 'kilo', LITRE: 'lita', PIECE: 'vipande', PACKET: 'pakiti', ROLL: 'roli', BOTTLE: 'chupa', SPOOL: 'spuli', METRE: 'mita' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
const hourEAT = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam', hour: 'numeric', hourCycle: 'h23' }));

async function liveAmcos() {
  return db.select({ id: schema.amcos.id, name: schema.amcos.name }).from(schema.amcos)
    .where(and(eq(schema.amcos.status, 'ACTIVE'), eq(schema.amcos.training, false)));
}
async function staffPhones(amcosId: string, roles: string[]) {
  const rows = await db.select({ phone: schema.users.phone }).from(schema.users)
    .where(and(eq(schema.users.amcosId, amcosId), eq(schema.users.isActive, true), inArray(schema.users.role, roles as never[])));
  return [...new Set(rows.map((r) => r.phone).filter(Boolean))];
}

export function stockLine(a: StockRow) {
  const u = UNIT[a.unit] ?? a.unit.toLowerCase();
  if (a.status === 'OUT') return `${a.name} IMEISHA`;
  if (a.status === 'LOW') return `${a.name} chini ya kiwango (salio ${a.balance.toLocaleString('en-US')} ${u})`;
  return `${a.name} inakaribia kuisha (${a.daysLeft !== null ? `siku ${a.daysLeft}` : `salio ${a.balance.toLocaleString('en-US')} ${u}`})`;
}

/** Kila saa: tahadhari mpya za stoo kwa SMS (kwa kila chama). Inarudisha idadi ya SMS zilizowekwa foleni. */
export async function runStockAlertSms() {
  if (!(await smsEnabled('STOCK_ALERT'))) return { skipped: 'STOCK_ALERT imezimwa' };
  const season = await db.query.seasons.findFirst({ where: eq(schema.seasons.isCurrent, true) });
  if (!season) return { skipped: 'hakuna msimu' };
  let sent = 0, chama = 0;
  for (const a of await liveAmcos()) {
    const alerts = await stockAlerts(a.id, season.id);
    const prev = new Map((await db.select().from(schema.stockAlertStates).where(eq(schema.stockAlertStates.amcosId, a.id))).map((s) => [s.inputItemId, s.status]));
    const worse = alerts.filter((x) => !prev.has(x.id) || RANK[x.status] < RANK[prev.get(x.id)!]);
    const nowIds = new Set(alerts.map((x) => x.id));
    const cleared = [...prev.keys()].filter((id) => !nowIds.has(id));
    await db.transaction(async (tx) => {
      if (cleared.length) await tx.delete(schema.stockAlertStates).where(and(eq(schema.stockAlertStates.amcosId, a.id), inArray(schema.stockAlertStates.inputItemId, cleared)));
      // Hali iliyoboreka (mf. OUT -> LOW) inasasishwa kimya kimya; mbaya zaidi -> SMS
      for (const x of alerts) {
        if (prev.get(x.id) === x.status) continue;
        await tx.insert(schema.stockAlertStates).values({ amcosId: a.id, inputItemId: x.id, status: x.status })
          .onConflictDoUpdate({ target: schema.stockAlertStates.inputItemId, set: { status: x.status, notifiedAt: new Date() } });
      }
      if (!worse.length) return;
      const phones = await staffPhones(a.id, ['CLERK', 'AMCOS_ADMIN']);
      if (!phones.length) return;
      const sorted = [...worse].sort((p, q) => RANK[p.status] - RANK[q.status]);
      const shown = sorted.slice(0, 4).map(stockLine).join('; ');
      const more = sorted.length > 4 ? ` na nyingine ${sorted.length - 4}` : '';
      const text = `${a.name}: Tahadhari ya stoo - ${shown}${more}. Ingiza mzigo mapema; angalia Pembejeo na stoo.`;
      await enqueue(tx, phones.map((phone): SmsMessage => ({ kind: 'STOCK_ALERT', phone, amcosId: a.id, referenceType: 'Stock', text })));
      sent += phones.length; chama++;
    });
  }
  return { sent, chama };
}

/** Takwimu za jana kwa muhtasari wa Meneja */
export async function dailyFigures(amcosId: string, seasonId: string | null) {
  const r = (await db.execute<{ inc: string; exp: string; pend: number; issues: number; issued: string; members: number }>(sql`
    with y as (select ((now() at time zone 'Africa/Dar_es_Salaam')::date - 1) as d)
    select
      (select coalesce(sum(amount), 0) from finance_transactions, y where amcos_id = ${amcosId} and status = 'POSTED' and direction = 'IN' and kind <> 'TRANSFER' and txn_date = y.d) as inc,
      (select coalesce(sum(amount), 0) from finance_transactions, y where amcos_id = ${amcosId} and status = 'POSTED' and direction = 'OUT' and kind <> 'TRANSFER' and txn_date = y.d) as exp,
      (select count(*)::int from approval_requests where amcos_id = ${amcosId} and status = 'PENDING') as pend,
      (select count(*)::int from input_issues, y where amcos_id = ${amcosId} and status = 'ISSUED' and (issued_at at time zone 'Africa/Dar_es_Salaam')::date = y.d) as issues,
      (select coalesce(sum(total_amount), 0) from input_issues, y where amcos_id = ${amcosId} and status = 'ISSUED' and (issued_at at time zone 'Africa/Dar_es_Salaam')::date = y.d) as issued,
      (select count(*)::int from members, y where amcos_id = ${amcosId} and joined_at = y.d) as members`)).rows[0];
  const stock = seasonId ? await stockAlerts(amcosId, seasonId) : [];
  return { ...r, out: stock.filter((x) => x.status === 'OUT').length, low: stock.filter((x) => x.status !== 'OUT').length };
}

export function summaryText(name: string, f: Awaited<ReturnType<typeof dailyFigures>>, dateLabel: string) {
  const parts = [
    `Mapato ${tshText(f.inc)}, matumizi ${tshText(f.exp)}`,
    f.issues ? `pembejeo kwa wakulima ${f.issues} (${tshText(f.issued)})` : null,
    f.members ? `wakulima wapya ${f.members}` : null,
    f.pend ? `IDHINI ZINASUBIRI: ${f.pend}` : null,
    f.out || f.low ? `stoo: ${f.out ? `${f.out} zimeisha` : ''}${f.out && f.low ? ', ' : ''}${f.low ? `${f.low} zinakaribia kuisha` : ''}` : null,
  ].filter(Boolean);
  return `${name}: Muhtasari wa ${dateLabel} - ${parts.join('; ')}.`;
}

/**
 * Asubuhi (baada ya saa 1): muhtasari kwa Meneja wa kila chama + muhtasari wa mfumo kwa Owner. Mara moja kwa siku
 * (inaendeshwa kila saa lakini inakumbuka siku iliyotuma kwenye job_runs).
 */
export async function runDailyDigests(opts: { force?: boolean } = {}) {
  const d = today();
  if (!opts.force) {
    if (hourEAT() < 7) return { skipped: 'kabla ya saa 1 asubuhi' };
    const [done] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from job_runs where name = 'daily.digest' and status = 'SUCCESS' and details->>'sentDate' = ${d}`)).rows;
    if (done.n) return { skipped: 'imeshatumwa leo' };
  }
  const y = new Date(Date.now() - 86_400_000).toLocaleDateString('en-GB', { timeZone: 'Africa/Dar_es_Salaam', day: '2-digit', month: '2-digit' });
  let managers = 0;
  if (await smsEnabled('DAILY_SUMMARY')) {
    const season = await db.query.seasons.findFirst({ where: eq(schema.seasons.isCurrent, true) });
    for (const a of await liveAmcos()) {
      const f = await dailyFigures(a.id, season?.id ?? null);
      // Siku isiyo na lolote (hakuna fedha, idhini, pembejeo, wakulima wala tatizo la stoo) -> hakuna SMS
      if (!Number(f.inc) && !Number(f.exp) && !f.pend && !f.issues && !f.members && !f.out && !f.low) continue;
      const phones = await staffPhones(a.id, ['AMCOS_ADMIN']);
      if (!phones.length) continue;
      const text = summaryText(a.name, f, `jana ${y}`);
      await enqueue(db, phones.map((phone): SmsMessage => ({ kind: 'DAILY_SUMMARY', phone, amcosId: a.id, referenceType: 'DailySummary', text })));
      managers += phones.length;
    }
  }
  const owner = await ownerDigest();
  return { sentDate: d, managers, owner };
}

/** Muhtasari wa afya ya mfumo kwa Owner/Tech Support (saa 24 zilizopita) */
export async function ownerDigest() {
  const r = (await db.execute<{ up: number; buckets: number; errs: number; smsf: number; smst: number; alerts: number; locked: number; paid: string; pays: number }>(sql`
    select
      (select count(*)::int from system_uptime where bucket > now() - interval '24 hours') as up,
      288 as buckets,
      (select count(*)::int from system_errors where created_at > now() - interval '24 hours') as errs,
      (select count(*) filter (where status = 'FAILED')::int from sms_logs where created_at > now() - interval '24 hours') as smsf,
      (select count(*)::int from sms_logs where created_at > now() - interval '24 hours') as smst,
      (select count(*)::int from system_alerts where resolved_at is null) as alerts,
      (select count(*)::int from system_alerts where resolved_at is null and kind = 'FEE_LOCKED') as locked,
      (select coalesce(sum(amount), 0) from platform_payments where status = 'VERIFIED' and paid_at > now() - interval '24 hours') as paid,
      (select count(*)::int from platform_payments where status = 'VERIFIED' and paid_at > now() - interval '24 hours') as pays`)).rows[0];
  const pct = Math.min(100, Math.round((r.up / r.buckets) * 1000) / 10);
  const text = `CoopLink - muhtasari wa saa 24: hewani ${pct}%, makosa ${r.errs}, SMS zilizoshindwa ${r.smsf}/${r.smst}, tahadhari wazi ${r.alerts}${r.locked ? ` (vyama ${r.locked} vimefungwa kwa ada)` : ''}, malipo ${r.pays} (${tshText(r.paid)}).`;
  const people = await db.select({ phone: schema.users.phone }).from(schema.users)
    .where(and(eq(schema.users.isActive, true), sql`${schema.users.role} in ('SUPER_ADMIN', 'TECH_SUPPORT')`));
  let sent = 0;
  for (const p of people) if ((await sendSms(p.phone, text)).status === 'SENT') sent++;
  return { sent, text };
}
