// Mipangilio ya jukwaa (platform_settings) — inabadilishwa na Owner bila kubadilisha code.
import { eq } from 'drizzle-orm';
import { db, schema, type DbOrTx } from '../db';

export interface PlatformConfig {
  defaultTrialDays: number;
  defaultGraceDays: number;
  expiringWindowDays: number;   // "inakaribia kuisha" ndani ya siku hizi
  enforceSubscriptions: boolean; // kusitisha chama baada ya kuisha + grace
  currency: 'TZS' | 'USD';
}
export interface Maintenance { enabled: boolean; message: string }
export interface Banner { enabled: boolean; message: string; tone: 'info' | 'warn' }
export interface BusinessProfile {
  companyName: string; productName: string; slogan: string; ownerName: string;
  phone: string; email: string; address: string; tin: string; website: string;
}

export const DEFAULTS = {
  config: { defaultTrialDays: 14, defaultGraceDays: 7, expiringWindowDays: 14, enforceSubscriptions: true, currency: 'TZS' } as PlatformConfig,
  maintenance: { enabled: false, message: 'Mfumo uko kwenye matengenezo. Tafadhali jaribu tena baadaye.' } as Maintenance,
  banner: { enabled: false, message: '', tone: 'info' } as Banner,
  'business.profile': {
    companyName: 'NAYA GROUP', productName: 'CoopLink', slogan: 'Connecting Cooperatives. Empowering Farmers.',
    ownerName: '', phone: '', email: '', address: '', tin: '', website: '',
  } as BusinessProfile,
};
type Key = keyof typeof DEFAULTS;
type Val<K extends Key> = (typeof DEFAULTS)[K];

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 15_000;

export async function getSetting<K extends Key>(key: K, opts: { fresh?: boolean } = {}): Promise<Val<K>> {
  const c = cache.get(key);
  if (!opts.fresh && c && Date.now() - c.at < TTL) return c.value as Val<K>;
  const row = await db.query.platformSettings.findFirst({ where: eq(schema.platformSettings.key, key) });
  const value = { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as Val<K>;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting<K extends Key>(tx: DbOrTx, key: K, value: Val<K>, userId?: string) {
  await tx.insert(schema.platformSettings)
    .values({ key, value, updatedById: userId })
    .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value, updatedById: userId, updatedAt: new Date() } });
  cache.delete(key);
}

export const clearSettingsCache = () => cache.clear();
