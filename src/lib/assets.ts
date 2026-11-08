// =====================================================================
//  MALI ZA CHAMA — rejista, uchakavu wa mstari ulionyooka (straight-line) kila mwezi, na kuondoa mali
// =====================================================================
import type { Request } from 'express';
import { eq, sql } from 'drizzle-orm';
import { schema, type DbOrTx, type Tx } from '../db';
import { D, Decimal, fmt2 } from './money';
import { conflict } from './errors';
import { audit } from './audit';
import { postJournal } from './gl';

type Asset = typeof schema.fixedAssets.$inferSelect;

export const ASSET_CATEGORIES: Record<string, string> = {
  LAND: 'Ardhi', BUILDING: 'Majengo / maghala', VEHICLE: 'Magari na pikipiki', EQUIPMENT: 'Mitambo na vifaa (mizani n.k.)',
  FURNITURE: 'Samani', COMPUTER: 'Kompyuta na vifaa vya TEHAMA', OTHER: 'Nyinginezo',
};

/** Uchakavu uliolimbikizwa wa kila mali (kutoka kwenye mizunguko iliyokwisha endeshwa). */
export async function accumulated(tx: DbOrTx, amcosId: string) {
  const r = await tx.execute<{ asset_id: string; total: string }>(sql`
    select l.asset_id, sum(l.amount) as total from depreciation_lines l
    join depreciation_runs r on r.id = l.run_id where r.amcos_id = ${amcosId} group by l.asset_id`);
  return new Map(r.rows.map((x) => [x.asset_id, D(x.total)]));
}

export const monthlyCharge = (a: Pick<Asset, 'cost' | 'residualValue' | 'usefulLifeMonths'>) =>
  a.usefulLifeMonths > 0 ? D(a.cost).minus(a.residualValue).div(a.usefulLifeMonths).toDecimalPlaces(2) : D(0);

/** Uchakavu wa mwezi `period` (YYYY-MM) kwa mali moja. */
export function chargeFor(a: Asset, period: string, acc: Decimal) {
  if (a.usefulLifeMonths <= 0) return D(0);
  if (a.acquisitionDate.slice(0, 7) > period) return D(0);
  if (a.status === 'DISPOSED' && a.disposedAt && a.disposedAt.slice(0, 7) < period) return D(0);
  const left = D(a.cost).minus(a.residualValue).minus(acc);
  if (left.lte(0)) return D(0);
  return Decimal.min(monthlyCharge(a), left);
}

type Outcome = 'APPROVED' | 'REJECTED' | 'CANCELLED';
type Approval = typeof schema.approvalRequests.$inferSelect;

/** Idhini ya kuondoa mali: gharama na uchakavu vinaondolewa; thamani iliyobaki ni hasara (5950). */
export async function onAssetDisposal(tx: Tx, req: Request, a: Approval, o: Outcome, note: string) {
  const F = schema.fixedAssets;
  const [asset] = await tx.select().from(F).where(eq(F.id, a.entityId!)).for('update');
  if (!asset || asset.status !== 'DISPOSAL_PENDING') throw conflict('Mali hii haisubiri idhini ya kuondolewa');
  if (o !== 'APPROVED') {
    await tx.update(F).set({ status: 'ACTIVE', disposalApprovalId: null }).where(eq(F.id, asset.id));
    await audit(tx, req, { action: `ASSET_DISPOSAL_${o}`, entity: 'FixedAsset', entityId: asset.id, amcosId: a.amcosId, after: { note } });
    return;
  }
  const p = (a.payload ?? {}) as { date?: string };
  const date = p.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  const acc = (await accumulated(tx, a.amcosId)).get(asset.id) ?? D(0);
  const nbv = D(asset.cost).minus(acc);
  await postJournal(tx, {
    amcosId: a.amcosId, date, description: `Kuondoa mali ${asset.assetNo} ${asset.name}: ${a.reason ?? ''}`.trim(), source: 'ASSET_DISPOSAL', sourceId: asset.id,
    reference: asset.assetNo, approvalId: a.id, createdById: req.auth!.userId,
    lines: [{ code: '1590', debit: acc }, { code: '5950', debit: nbv, memo: 'Thamani iliyobaki' }, { code: '1500', credit: asset.cost }],
  });
  await tx.update(F).set({ status: 'DISPOSED', disposedAt: date, disposalNote: a.reason }).where(eq(F.id, asset.id));
  await audit(tx, req, { action: 'ASSET_DISPOSED', entity: 'FixedAsset', entityId: asset.id, amcosId: a.amcosId, after: { date, nbv: fmt2(nbv), note } });
}
