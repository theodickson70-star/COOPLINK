// Vipande vya pamoja vya kurasa za uhasibu: akaunti za daftari kuu, nyaraka za kuchapisha, kiasi
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { tsh } from '../lib/format';
import { Button, Field, Select } from '../components/ui';

export interface GlAccount {
  id: string; code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'; typeLabel: string; subtype: string | null;
  financeAccountId: string | null; isActive: boolean; isSystem: boolean; debit: string; credit: string; balance: string;
}
export const GL_TYPE_LABEL: Record<string, string> = { ASSET: 'Mali', LIABILITY: 'Madeni', EQUITY: 'Mtaji', INCOME: 'Mapato', EXPENSE: 'Matumizi' };
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
export const thisMonth = () => today().slice(0, 7);

export function useChart(enabled = true) {
  return useFetch<{ data: GlAccount[] }>(enabled ? '/accounting/chart' : null);
}

/** Kuchagua akaunti ya daftari kuu (bila akaunti za fedha — zinaguswa kwa miamala). */
export function GlSelect({ label, value, onChange, accounts, filter, placeholder = 'Chagua akaunti…', help }: {
  label: string; value: string; onChange: (v: string) => void; accounts: GlAccount[] | undefined; filter?: (a: GlAccount) => boolean; placeholder?: string; help?: string;
}) {
  const list = (accounts ?? []).filter((a) => a.isActive && a.subtype !== 'CASH' && a.subtype !== 'CASH_GROUP' && a.subtype !== 'TRANSFER' && (!filter || filter(a)));
  const groups = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((t) => [t, list.filter((a) => a.type === t)] as const).filter(([, l]) => l.length);
  return (
    <Field label={label} help={help}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{placeholder}</option>
          {groups.map(([t, l]) => (
            <optgroup key={t} label={GL_TYPE_LABEL[t]}>
              {l.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </optgroup>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Kiasi cha fedha kwenye ripoti: hasi kwenye mabano (kama ilivyo kwenye taarifa za fedha). */
export function Amt({ v, strong, zero = '—' }: { v: string | number | null | undefined; strong?: boolean; zero?: string }) {
  const n = Number(v ?? 0);
  const txt = n === 0 ? zero : n < 0 ? `(${tsh(-n).replace('TSh ', '')})` : tsh(n).replace('TSh ', '');
  return strong ? <strong>{txt}</strong> : <>{txt}</>;
}

/** Kichwa cha nyaraka za kuchapisha (vocha, risiti, ripoti, hati ya mshahara). */
export function DocHead({ title, no, sub }: { title: string; no?: ReactNode; sub?: ReactNode }) {
  const { amcos } = useAuth();
  return (
    <div className="doc-head">
      <div>
        <div className="doc-org">{amcos?.name ?? 'Chama cha Ushirika'}</div>
        <div className="doc-org-sub">{amcos?.code}{amcos?.district ? ` · ${amcos.district}` : ''}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="doc-title">{title}</div>
        {no && <div className="doc-no">{no}</div>}
        {sub && <div className="doc-org-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function PrintButton({ label = 'Chapisha / PDF' }: { label?: string }) {
  return <Button variant="secondary" className="no-print" onClick={() => window.print()}>{label}</Button>;
}

export function Signatures({ items }: { items: string[] }) {
  return (
    <div className="doc-sign">
      {items.map((s) => <div key={s}><span />{s}</div>)}
    </div>
  );
}
