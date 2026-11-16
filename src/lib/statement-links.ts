// =====================================================================
//  KIUNGO SALAMA CHA TAARIFA YA MKULIMA (v2.4)
//   - Mkulima anapokea kiungo kwa SMS (baada ya hesabu ya mauzo, au mtumishi akikituma) na kuona
//     mauzo, pembejeo, deni na miamala yake — bila kuingia, bila PIN.
//   - Token ni ya nasibu (bytes 18 -> herufi 24). Database inahifadhi sha256 yake tu: aliye na database
//     hawezi kuunda kiungo halali.
//   - Kinaisha baada ya siku 90, kinaweza kusitishwa, na kinaonyesha rekodi zilizoidhinishwa tu.
// =====================================================================
import crypto from 'crypto';
import { env } from '../config/env';
import { schema, type DbOrTx } from '../db';

export const STATEMENT_LINK_DAYS = 90;
export const STATEMENT_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

export const hashStatementToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Anwani ya mfumo kwa viungo vya SMS. Bila anwani inayojulikana -> null (SMS inatumwa bila kiungo). */
export function publicBaseUrl(): string | null {
  if (env.PUBLIC_APP_URL) return env.PUBLIC_APP_URL.replace(/\/+$/, '');
  const d = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (d && /^[a-z0-9.-]+$/i.test(d)) return `https://${d}`;
  return null;
}

export async function createStatementLink(tx: DbOrTx, o: { amcosId: string; memberId: string; seasonId?: string | null; source: 'SALE_SETTLED' | 'STAFF'; createdById?: string | null }) {
  const base = publicBaseUrl();
  if (!base) return null;
  const token = crypto.randomBytes(18).toString('base64url');
  const expiresAt = new Date(Date.now() + STATEMENT_LINK_DAYS * 86400_000);
  await tx.insert(schema.farmerStatementLinks).values({
    amcosId: o.amcosId, memberId: o.memberId, seasonId: o.seasonId ?? null, tokenHash: hashStatementToken(token),
    source: o.source, createdById: o.createdById ?? null, expiresAt,
  });
  return { url: `${base}/s/${token}`, expiresAt };
}
