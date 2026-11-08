// Njia ya kumlipa mkulima (kutoka mapendeleo yake): benki, simu au taslimu
import type { schema } from '../db';

export function destinationOf(m: typeof schema.members.$inferSelect): { method: 'MOBILE_MONEY' | 'BANK' | 'CASH'; destination: string; provider: string | null } {
  if (m.preferredPayment === 'BANK' && m.bankAccountNumber) return { method: 'BANK', destination: `${m.bankName ?? ''} ${m.bankAccountNumber}`.trim(), provider: m.bankName };
  if (m.preferredPayment !== 'CASH' && m.mobileMoneyNumber) return { method: 'MOBILE_MONEY', destination: m.mobileMoneyNumber, provider: m.mobileMoneyProvider };
  return { method: 'CASH', destination: 'Taslimu', provider: null };
}
