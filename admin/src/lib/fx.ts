// Pembejeo kwa dola: sarafu ya chama na kiwango cha sasa (Mhasibu anaweka kwenye Fedha → Dola)
import { useFetch } from './hooks';
import { useAuth } from './auth';

export interface FxInfo { currency: 'TZS' | 'USD'; rate: { usdToTzs: string; createdAt: string } | null; history: { id: string; usdToTzs: string; note: string | null; createdAt: string; setBy: string | null }[]; farmersUsdDebt: string; farmersWithUsdDebt: number }

export function useFx() {
  const { may } = useAuth();
  const ok = may('finance.read', 'stock.read', 'issues.request', 'purchases.request', 'sales.read');
  const r = useFetch<FxInfo>(ok ? '/finance/fx' : null);
  const usdMode = r.data?.currency === 'USD';
  const rate = r.data?.rate ? Number(r.data.rate.usdToTzs) : null;
  return { ...r, usdMode, rate };
}

/** $1,234.50 */
export const usd = (v: string | number | null | undefined, digits = 2) =>
  v == null || v === '' ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
