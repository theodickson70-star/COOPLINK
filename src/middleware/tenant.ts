// =====================================================================
//  MULTI-TENANCY — kila mtumiaji anaona data ya chama/vyama vyake tu.
//   SUPER_ADMIN         -> vyama vyote (anaweza kuchuja kwa ?amcosId=)
//   UNION_ADMIN/VIEWER  -> vyama vya Chama Kikuu chake tu
//   AMCOS_*             -> chama chake tu
//  KILA query ya data ya chama LAZIMA ipite hapa.
// =====================================================================
import type { Request } from 'express';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db, schema } from '../db';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedAmcosId(req: Request, explicit?: string | null): string | undefined {
  const v = explicit ?? (req.query.amcosId as string | undefined) ?? (req.headers['x-amcos-id'] as string | undefined);
  if (v && !UUID.test(v)) throw badRequest('amcosId si sahihi');
  return v || undefined;
}

const unionAmcosIds = (unionId: string) =>
  db.select({ id: schema.amcos.id }).from(schema.amcos).where(eq(schema.amcos.unionId, unionId));

/** v0.43: vyama vya wilaya ya Afisa Ushirika (jina la wilaya/mkoa linalinganishwa bila kujali herufi kubwa/nafasi) */
export const districtAmcosIds = (j: { region: string | null; district: string | null } | undefined) =>
  db.select({ id: schema.amcos.id }).from(schema.amcos).where(j?.district
    ? and(sql`lower(trim(${schema.amcos.district})) = lower(trim(${j.district}))`, j.region ? sql`lower(trim(${schema.amcos.region})) = lower(trim(${j.region}))` : undefined)
    : sql`false`);

/** Sharti la WHERE kwa ajili ya kusoma data ya chama. */
export function amcosScope(req: Request, column: PgColumn): SQL | undefined {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  const requested = requestedAmcosId(req);

  switch (auth.role) {
    case 'SUPER_ADMIN':
      return requested ? eq(column, requested) : undefined;
    case 'UNION_ADMIN':
    case 'UNION_VIEWER': {
      const inUnion = inArray(column, unionAmcosIds(auth.unionId!));
      return requested ? and(inUnion, eq(column, requested)) : inUnion;
    }
    case 'COOP_OFFICER': {
      const inDistrict = inArray(column, districtAmcosIds(auth.jurisdiction));
      return requested ? and(inDistrict, eq(column, requested)) : inDistrict;
    }
    default:
      return eq(column, auth.amcosId!);
  }
}

/** Je, mtumiaji anaruhusiwa kugusa chama hiki? */
export async function canAccessAmcos(req: Request, amcosId: string): Promise<boolean> {
  const auth = req.auth!;
  if (auth.role === 'SUPER_ADMIN') return true;
  if (auth.role === 'UNION_ADMIN' || auth.role === 'UNION_VIEWER') {
    const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, amcosId), columns: { unionId: true } });
    return !!a && a.unionId === auth.unionId;
  }
  if (auth.role === 'COOP_OFFICER') {
    const [a] = await db.select({ id: schema.amcos.id }).from(schema.amcos).where(and(eq(schema.amcos.id, amcosId), inArray(schema.amcos.id, districtAmcosIds(auth.jurisdiction))));
    return !!a;
  }
  return auth.amcosId === amcosId;
}

/**
 * Chama ambacho rekodi mpya itaandikwa.
 *  - Watumiaji wa chama: chama chao (wakijaribu kingine -> 403)
 *  - Super/Union admin: lazima watoe amcosId (body, ?amcosId au header x-amcos-id)
 */
export async function resolveWriteAmcosId(req: Request, explicit?: string | null): Promise<string> {
  const auth = req.auth!;
  const requested = requestedAmcosId(req, explicit);

  if (auth.amcosId) {
    if (requested && requested !== auth.amcosId) throw forbidden('Huwezi kuandika data ya chama kingine');
    return auth.amcosId;
  }
  if (!requested) throw badRequest('Chagua chama (amcosId)');
  const a = await db.query.amcos.findFirst({ where: eq(schema.amcos.id, requested) });
  if (!a) throw notFound('Chama');
  if (!a.isActive) throw forbidden('Chama hiki kimesitishwa');
  if (!(await canAccessAmcos(req, requested))) throw forbidden('Huna ruhusa kwenye chama hiki');
  return requested;
}

/** Chama kimoja cha KUSOMA (kwa ripoti za chama mmoja mmoja, mf. daftari kuu). */
export async function readAmcosId(req: Request): Promise<string> {
  const auth = req.auth!;
  if (auth.amcosId) return auth.amcosId;
  const requested = requestedAmcosId(req);
  if (!requested) throw badRequest('Chagua chama (amcosId)');
  if (!(await canAccessAmcos(req, requested))) throw forbidden('Huna ruhusa kwenye chama hiki');
  return requested;
}
