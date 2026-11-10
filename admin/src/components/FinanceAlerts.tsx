// =====================================================================
//  TAHADHARI ZA FEDHA kwenye dashibodi (Meneja na Mhasibu):
//  wanunuzi waliochelewa kulipa, na bajeti zinazokaribia kuisha au zilizozidi.
//  Inatumia ripoti zilizopo (/sales/buyers, /finance/budgets) — hakuna hesabu mpya.
// =====================================================================
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { num, tsh } from '../lib/format';
import { useT } from '../lib/prefs';

interface Buyers { overdue: { count: number; amount: string }; byBuyer: { name: string; overdue: string }[] }
interface Budgets { data: { category: string; label: string; percent: number | null; state: string; actual: string; budget: string | null }[] }

export function FinanceAlerts() {
  const { may } = useAuth();
  const t = useT();
  const buyers = useFetch<Buyers>(may('sales.read') ? '/sales/buyers' : null);
  const budgets = useFetch<Budgets>(may('finance.read') ? '/finance/budgets' : null);
  const items: { tone: 'bad' | 'warn'; text: string; to: string; cta: string }[] = [];
  const b = buyers.data;
  if (b && b.overdue.count > 0) {
    const who = b.byBuyer.filter((x) => Number(x.overdue) > 0).map((x) => x.name).slice(0, 3).join(', ');
    items.push({ tone: 'bad', text: t('Wanunuzi wamechelewa kulipa {amount} (masoko {n}){who}', { amount: tsh(b.overdue.amount), n: b.overdue.count, who: who ? ` — ${who}` : '' }), to: '/sales?tab=buyers', cta: t('Madeni ya wanunuzi →') });
  }
  for (const x of budgets.data?.data ?? []) {
    if (x.state === 'OVER') items.push({ tone: 'bad', text: t('Bajeti ya {label} imezidi: {pct}% ({actual} kati ya {budget})', { label: x.label, pct: num(x.percent ?? 0), actual: tsh(x.actual), budget: tsh(x.budget ?? 0) }), to: '/finance?tab=budget', cta: t('Bajeti →') });
    else if (x.state === 'NEAR') items.push({ tone: 'warn', text: t('Bajeti ya {label} inakaribia kuisha: {pct}%', { label: x.label, pct: num(x.percent ?? 0) }), to: '/finance?tab=budget', cta: t('Bajeti →') });
    else if (x.state === 'FAST') items.push({ tone: 'warn', text: t('Matumizi ya {label} yanaenda kasi kuliko muda wa msimu ({pct}% ya bajeti)', { label: x.label, pct: num(x.percent ?? 0) }), to: '/finance?tab=budget', cta: t('Bajeti →') });
  }
  if (!items.length) return null;
  return (
    <section className="fin-alerts" aria-label={t('Tahadhari za fedha')}>
      {items.slice(0, 5).map((i, k) => (
        <div key={k} className={`fin-alert ${i.tone}`}><span className="fa-dot" aria-hidden="true" /><span className="fa-text">{i.text}</span><Link to={i.to}>{i.cta}</Link></div>
      ))}
    </section>
  );
}
