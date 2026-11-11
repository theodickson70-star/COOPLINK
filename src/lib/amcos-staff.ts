// Watumishi watatu wa AMCOS: nafasi moja tu kwa kila cheo (Meneja, Mhasibu, Storekeeper)
import { and, eq, ne } from 'drizzle-orm';
import { schema, type DbOrTx } from '../db';
import { conflict } from './errors';
import { isAmcosStaff, STAFF_TITLE } from './amcos-permissions';
import type { Role } from '../middleware/auth';

/** Inazuia mtumishi wa pili hai mwenye cheo kilekile (database pia ina unique index). */
export async function assertSlotFree(tx: DbOrTx, amcosId: string, role: Role, exceptUserId?: string) {
  if (!isAmcosStaff(role)) return;
  const U = schema.users;
  const holder = await tx.query.users.findFirst({
    where: and(eq(U.amcosId, amcosId), eq(U.role, role), eq(U.isActive, true), exceptUserId ? ne(U.id, exceptUserId) : undefined),
    columns: { id: true, fullName: true },
  });
  if (holder) {
    throw conflict(`AMCOS hii tayari ina ${STAFF_TITLE[role]} (${holder.fullName}). Mzime kwanza au tumia "Badilisha mtumishi".`, { holderId: holder.id });
  }
}

/** Kosa la unique index likitokea (maombi mawili kwa wakati mmoja) — ujumbe unaoeleweka. */
export function isSlotViolation(e: unknown) {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const c = err.cause ?? err;
  return c.code === '23505' && c.constraint === 'users_one_staff_per_role';
}
