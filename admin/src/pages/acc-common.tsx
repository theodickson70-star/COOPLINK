// Vipande vya pamoja vya kurasa za uhasibu: akaunti za daftari kuu, nyaraka za kuchapisha, kiasi
import type { ReactNode } from 'react';
import { useAuth, type Amcos } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { phone, tsh } from '../lib/format';
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

type DocOrg = { name: string; code: string; district?: string | null } & Partial<Pick<Amcos, 'regNumber' | 'region' | 'ward' | 'village' | 'phone' | 'email' | 'postalAddress' | 'tin' | 'logo'>>;

/** Mistari ya anwani ya chama kwa nyaraka (kutoka Mipangilio → Profaili). */
export function docOrgLines(a: DocOrg | null | undefined) {
  if (!a) return [] as string[];
  return [
    [a.regNumber && `Usajili: ${a.regNumber}`, a.tin && `TIN: ${a.tin}`].filter(Boolean).join(' · '),
    [a.postalAddress, a.village, a.ward, a.district, a.region].filter(Boolean).join(', '),
    [a.phone && `Simu: ${phone(a.phone)}`, a.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
}

/** Kichwa cha nyaraka za kuchapisha (vocha, risiti, ripoti, hati ya mshahara) — nembo na anwani kutoka Mipangilio. */
export function DocHead({ title, no, sub, org }: { title: string; no?: ReactNode; sub?: ReactNode; org?: DocOrg }) {
  const auth = useAuth();
  // org kutoka ripoti ina sehemu chache — chapa (nembo, anwani) inachukuliwa kutoka chama cha mtumiaji kama ni kile kile
  const amcos: DocOrg | null = org ? { ...(auth.amcos && auth.amcos.code === org.code ? auth.amcos : {}), ...org } : auth.amcos;
  const lines = docOrgLines(amcos);
  return (
    <div className="doc-head">
      <div className="doc-brand">
        {amcos?.logo && <img className="doc-logo" src={amcos.logo} alt="" />}
        <div>
          <div className="doc-org">{amcos?.name ?? 'Chama cha Ushirika'}</div>
          {lines.length ? lines.map((l) => <div key={l} className="doc-org-sub">{l}</div>)
            : <div className="doc-org-sub">{amcos?.code}{amcos?.district ? ` · ${amcos.district}` : ''}</div>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="doc-title">{title}</div>
        {no && <div className="doc-no">{no}</div>}
        {sub && <div className="doc-org-sub">{sub}</div>}
      </div>
    </div>
  );
}

/** Kijachini cha nyaraka: maneno ya chama + akaunti kuu ya benki (kama imeruhusiwa kwenye Mipangilio → Nyaraka). */
export function DocFoot() {
  const { amcos } = useAuth();
  const bank = amcos?.docShowBank ? amcos.mainBank : null;
  if (!amcos?.docFooter && !bank) return null;
  return (
    <div className="doc-foot doc-foot-org">
      {bank && <div>Malipo: <strong>{[bank.bankName, bank.accountNumber].filter(Boolean).join(' · ') || bank.name}</strong>{bank.bankName ? ` (${bank.name})` : ''}</div>}
      {amcos?.docFooter && <div>{amcos.docFooter}</div>}
    </div>
  );
}

export function PrintButton({ label = 'Chapisha / PDF' }: { label?: string }) {
  return <Button variant="secondary" className="no-print" onClick={() => window.print()}>{label}</Button>;
}

export function Signatures({ items }: { items: string[] }) {
  return (
    <>
      <div className="doc-sign">
        {items.map((s) => <div key={s}><span />{s}</div>)}
      </div>
      <DocFoot />
    </>
  );
}
