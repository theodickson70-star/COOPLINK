// =====================================================================
//  MISTARI YA HATI + MGAO (v0.42) — Stakabadhi na Hati ya Malipo zenye mistari mingi
//  Kila mstari: maelezo, kiasi, akaunti ya daftari kuu (MGAO, hiari) na kituo cha gharama (hiari).
//  Jumla ya mistari ndiyo kiasi cha hati — backend inakataa kama hazilingani.
// =====================================================================
import { tsh } from '../lib/format';
import { useT } from '../lib/prefs';
import { Button, Select } from './ui';

export interface DocLineDraft { description: string; amount: string; glAccountId: string; costCenter: string }
export interface GlLite { id: string; code: string; name: string; type: string; subtype: string | null; isActive: boolean }

export const emptyLine = (): DocLineDraft => ({ description: '', amount: '', glAccountId: '', costCenter: '' });
export const linesTotal = (ls: DocLineDraft[]) => ls.reduce((s, l) => s + (Number(l.amount) || 0), 0);
export const linesValid = (ls: DocLineDraft[]) => ls.length > 0 && ls.every((l) => l.description.trim().length >= 2 && Number(l.amount) > 0);
export const linesPayload = (ls: DocLineDraft[]) => ls.map((l) => ({
  description: l.description.trim(), amount: l.amount, glAccountId: l.glAccountId || null, costCenter: l.costCenter.trim() || null,
}));

export function DocLines({ lines, onChange, accounts, direction }: {
  lines: DocLineDraft[]; onChange: (l: DocLineDraft[]) => void; accounts?: GlLite[] | null; direction: 'IN' | 'OUT';
}) {
  const t = useT();
  const okTypes = direction === 'OUT' ? ['EXPENSE', 'ASSET', 'LIABILITY'] : ['INCOME', 'LIABILITY', 'EQUITY'];
  const gl = (accounts ?? []).filter((a) => a.isActive && okTypes.includes(a.type) && !['CASH', 'CASH_GROUP', 'TRANSFER'].includes(a.subtype ?? ''));
  const set = (i: number, patch: Partial<DocLineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="doc-lines">
      <div className="doc-lines-head">
        <span>#</span><span>{t('Maelezo')}</span>{accounts && <span>{t('MGAO: akaunti')}</span>}<span>{t('Kituo')}</span><span className="num">{t('Kiasi (TSh)')}</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`doc-line ${accounts ? '' : 'no-gl'}`}>
          <span className="doc-line-no">{i + 1}</span>
          <input className="input" aria-label={`${t('Maelezo')} ${i + 1}`} placeholder={t('mf. Gharama za benki Agosti')} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
          {accounts && (
            <Select aria-label={`${t('Akaunti')} ${i + 1}`} value={l.glAccountId} onChange={(e) => set(i, { glAccountId: e.target.value })}>
              <option value="">{t('Kwa kundi')}</option>
              {gl.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </Select>
          )}
          <input className="input" aria-label={`${t('Kituo')} ${i + 1}`} placeholder={t('mf. Ofisi Kuu')} value={l.costCenter} maxLength={60} onChange={(e) => set(i, { costCenter: e.target.value })} />
          <input className="input num" aria-label={`${t('Kiasi')} ${i + 1}`} type="number" min="0.01" step="0.01" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          <button type="button" className="doc-line-x" aria-label={t('Ondoa mstari')} disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="doc-lines-foot">
        <Button size="sm" variant="secondary" disabled={lines.length >= 30} onClick={() => onChange([...lines, emptyLine()])}>{t('+ Ongeza mstari')}</Button>
        <span>{t('Jumla')}: <b>{tsh(linesTotal(lines))}</b></span>
      </div>
    </div>
  );
}
