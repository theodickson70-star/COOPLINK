// ADA ZA COOPLINK — upande wa Owner: bei, vyama vinavyodaiwa, kusamehe, kuhakiki malipo
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ah, uuidParam } from '../../lib/http';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import { audit } from '../../lib/audit';
import { getSetting, setSetting } from '../../lib/settings';
import { clearFeeLock, ensureEntranceFee, ensureSeasonFee, feesOverview, receiptOf, syncControlNumber } from '../../lib/fees';
import { teepayConfig } from '../../lib/teepay';

export const ownerFeesRouter = Router();
const F = schema.platformFees;

ownerFeesRouter.get('/settings', requirePermission('subscriptions.read'), ah(async (_req, res) => {
  const t = teepayConfig();
  res.json({ settings: await getSetting('fees', { fresh: true }), teepay: { enabled: t.enabled, webhook: !!t.webhookSecret, mode: t.apiKey?.startsWith('tp_live_') ? 'live' : t.apiKey ? 'test' : null } });
}));

ownerFeesRouter.put('/settings', requirePermission('subscriptions.manage'), ah(async (req, res) => {
  const b = z.object({
    enabled: z.boolean(),
    entranceFee: z.coerce.number().int().min(500, 'Kiwango cha chini cha TeePay ni TSh 500'),
    entranceDays: z.coerce.number().int().min(0).max(60),
    seasonFee: z.coerce.number().int().min(500),
    seasonInstallments: z.coerce.number().int().min(1).max(4),
    deadlineMonth: z.coerce.number().int().min(1).max(12),
    deadlineDay: z.coerce.number().int().min(1).max(28),
  }).parse(req.body);
  const before = await getSetting('fees', { fresh: true });
  await db.transaction(async (tx) => {
    await setSetting(tx, 'fees', b, req.auth!.userId);
    await audit(tx, req, { action: 'FEE_SETTINGS_UPDATE', entity: 'PlatformSetting', entityId: 'fees', before, after: b });
  });
  res.json({ settings: b, note: 'Bei mpya zinatumika kwa ada zitakazodaiwa kuanzia sasa; ada zilizokwisha kudaiwa hazibadiliki.' });
}));

// Vyama vyote na hali ya ada zao
ownerFeesRouter.get('/', requirePermission('subscriptions.read'), ah(async (_req, res) => {
  const rows = (await db.execute(sql`
    select a.id, a.name, a.code, a.status, a.created_at,
      e.id as entrance_id, e.status as entrance_status, e.due_date as entrance_due, e.amount as entrance_amount, e.paid as entrance_paid,
      s.id as season_id, s.label as season_label, s.status as season_status, s.due_date as season_due, s.amount as season_amount, s.paid as season_paid,
      (select count(*)::int from platform_fees x where x.amcos_id = a.id and x.status in ('UNPAID','PARTIAL') and x.due_date < (now() at time zone 'Africa/Dar_es_Salaam')::date) as overdue
    from amcos a
    left join platform_fees e on e.amcos_id = a.id and e.kind = 'ENTRANCE'
    left join lateral (select * from platform_fees s where s.amcos_id = a.id and s.kind = 'SEASON' order by s.due_date desc limit 1) s on true
    where a.status in ('ACTIVE', 'SUSPENDED')
    order by overdue desc, a.name`)).rows;
  res.json({ data: rows, teepayEnabled: teepayConfig().enabled });
}));

ownerFeesRouter.get('/amcos/:id', requirePermission('subscriptions.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  if (!(await db.query.amcos.findFirst({ where: eq(schema.amcos.id, id), columns: { id: true } }))) throw notFound('Chama');
  res.json(await feesOverview(id));
}));

// Chama kilichokuwepo kabla ya ada: Owner anaamua kianze kudaiwa kingilio (siku N kuanzia leo) au kisamehewe
ownerFeesRouter.post('/amcos/:id/entrance', requirePermission('subscriptions.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { waive, reason } = z.object({ waive: z.boolean().default(false), reason: z.string().trim().optional() }).parse(req.body ?? {});
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, id) });
  if (!a) throw notFound('Chama');
  if (a.status !== 'ACTIVE' && a.status !== 'SUSPENDED') throw badRequest('Chama hiki hakijafunguliwa');
  if (waive && (!reason || reason.length < 3)) throw badRequest('Eleza sababu ya kusamehe ada ya kingilio');
  const fee = await db.transaction(async (tx) => {
    const [have] = await tx.select().from(F).where(and(eq(F.amcosId, id), eq(F.kind, 'ENTRANCE')));
    if (have) throw conflict('Chama hiki tayari kina ada ya kingilio');
    let f = (await ensureEntranceFee(tx, id, req.auth!.userId, { force: true }))!;
    if (waive) {
      [f] = await tx.update(F).set({ status: 'WAIVED', waivedById: req.auth!.userId, waivedReason: reason!, updatedAt: new Date() }).where(eq(F.id, f.id)).returning();
      await ensureSeasonFee(tx, id);
    }
    await audit(tx, req, { action: waive ? 'FEE_ENTRANCE_WAIVE' : 'FEE_ENTRANCE_DEMAND', entity: 'PlatformFee', entityId: f.id, amcosId: id, after: f });
    return f;
  });
  clearFeeLock(id);
  res.status(201).json({ fee });
}));

ownerFeesRouter.post('/:id/waive', requirePermission('subscriptions.manage'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Eleza sababu') }).parse(req.body);
  const fee = await db.transaction(async (tx) => {
    const [f] = await tx.update(F).set({ status: 'WAIVED', waivedById: req.auth!.userId, waivedReason: reason, updatedAt: new Date() })
      .where(and(eq(F.id, id), inArray(F.status, ['UNPAID', 'PARTIAL']))).returning();
    if (!f) throw conflict('Ada hii haipo au tayari imelipwa/imesamehewa');
    if (f.kind === 'ENTRANCE') await ensureSeasonFee(tx, f.amcosId);
    await audit(tx, req, { action: 'FEE_WAIVE', entity: 'PlatformFee', entityId: f.id, amcosId: f.amcosId, after: { label: f.label, amount: f.amount, paid: f.paid, reason } });
    return f;
  });
  clearFeeLock(fee.amcosId);
  res.json({ fee });
}));

ownerFeesRouter.post('/control-numbers/:id/sync', requirePermission('subscriptions.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  const r = await syncControlNumber(id);
  res.json({ recorded: r.recorded.length, status: r.cn.status });
}));

ownerFeesRouter.get('/receipts/:id', requirePermission('subscriptions.read'), ah(async (req, res) => {
  const { id } = uuidParam.parse(req.params);
  res.json(await receiptOf(id));
}));
