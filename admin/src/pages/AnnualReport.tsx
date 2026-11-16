// =====================================================================
//  TAARIFA YA MWAKA KWA MKUTANO MKUU (v2.4) — hati moja rasmi ya kuchapisha
//  Hesabu za fedha zinatoka kwenye ripoti zilizopo za daftari kuu (mapato/matumizi, mizania, mtiririko);
//  takwimu nyingine (wanachama, mauzo, pembejeo, madeni, ukaguzi) zinatoka /accounting/reports/annual.
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { date, num, tsh } from '../lib/format';
import { Alert, Button, Loading, PageHead, TextField } from '../components/ui';
import { Icon } from '../components/icons';
import { Amt, DocHead, Signatures, today } from './acc-common';

interface Line { id: string; code: string; name: string; amount: string }
interface IS { income: Line[]; expense: Line[]; totalIncome: string; totalExpense: string; surplus: string }
interface BS { assets: Line[]; liabilities: Line[]; equity: Line[]; totalAssets: string; totalLiabilities: string; totalEquity: string; totalLiabilitiesEquity: string; retainedPrior: string; currentSurplus: string; balanced: boolean }
interface CF { opening: string; net: string; closing: string; balanced: boolean; sections: Record<string, { label: string; total: string }> }
interface Annual {
  from: string; to: string;
  amcos: { name: string; code: string; regNumber: string | null; region: string | null; district: string | null; ward: string | null; village: string | null; leaders: { role: string; name: string }[] };
  members: { total: number; active: number; female: number; male: number; joined: number }; staff: number;
  sales: { farmers: number; kg: string; gross: string; ded: string; net: string; paid: string; markets: number };
  inputs: { issues: number; farmers: number; value: string };
  debts: { owing: number; amount: string };
  oversight: { inspections: number; findings: number; resolved: number; open: number; directives: number; complied: number };
  lockedThrough: string | null;
}
const ROLE: Record<string, string> = { CHAIR: 'Mwenyekiti', VICE_CHAIR: 'Makamu Mwenyekiti', SECRETARY: 'Katibu', TREASURER: 'Mweka Hazina' };

export function AnnualReport() {
  const t0 = today();
  const y = Number(t0.slice(0, 4));
  const [range, setRange] = useState({ from: `${y}-01-01`, to: t0 });
  const [draft, setDraft] = useState(range);
  const q = { from: range.from, to: range.to };
  const a = useFetch<Annual>('/accounting/reports/annual', q);
  const is = useFetch<IS>('/accounting/reports/income-statement', q);
  const bs = useFetch<BS>('/accounting/reports/balance-sheet', { asOf: range.to });
  const cf = useFetch<CF>('/accounting/reports/cash-flow', q);
  const err = a.error ?? is.error ?? bs.error ?? cf.error;
  const ready = a.data && is.data && bs.data && cf.data;
  const preset = (from: string, to: string) => { setDraft({ from, to }); setRange({ from, to }); };

  return (
    <>
      <PageHead title="Taarifa ya Mkutano Mkuu" sub="Hati moja rasmi ya mwaka: wanachama, mauzo, pembejeo, hesabu za fedha, mizania na ukaguzi — tayari kuchapisha au kuhifadhi kama PDF.">
        <Link className="btn btn-ghost btn-sm" to="/accounting/reports">← Ripoti kuu</Link>
        <Button onClick={() => window.print()} disabled={!ready}><Icon name="chart" />Chapisha / PDF</Button>
      </PageHead>
      <section className="card card-pad no-print agm-ctl">
        <div className="seg-row">
          <button type="button" className="chip-btn" onClick={() => preset(`${y}-01-01`, t0)}>Mwaka huu (hadi leo)</button>
          <button type="button" className="chip-btn" onClick={() => preset(`${y - 1}-01-01`, `${y - 1}-12-31`)}>Mwaka {y - 1}</button>
          <button type="button" className="chip-btn" onClick={() => preset(`${y - 2}-01-01`, `${y - 2}-12-31`)}>Mwaka {y - 2}</button>
        </div>
        <div className="agm-dates">
          <TextField label="Kuanzia" type="date" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
          <TextField label="Hadi" type="date" max={t0} value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
          <Button variant="secondary" onClick={() => setRange(draft)} disabled={!draft.from || !draft.to}>Onyesha</Button>
        </div>
      </section>
      <Alert>{err}</Alert>
      {!ready ? (!err && <Loading />) : <Doc a={a.data!} is={is.data!} bs={bs.data!} cf={cf.data!} />}
    </>
  );
}

function Doc({ a, is, bs, cf }: { a: Annual; is: IS; bs: BS; cf: CF }) {
  const place = [a.amcos.village, a.amcos.ward, a.amcos.district, a.amcos.region].filter(Boolean).join(', ');
  const pct = (x: number, of: number) => (of ? `${Math.round((x / of) * 100)}%` : '—');
  const avg = Number(a.sales.kg) ? Number(a.sales.gross) / Number(a.sales.kg) : 0;
  const leaders = a.amcos.leaders.filter((l) => l.name);
  return (
    <article className="card card-pad print-doc agm">
      <DocHead title="TAARIFA YA MWAKA KWA MKUTANO MKUU" sub={<>Kipindi: <strong>{date(a.from)} – {date(a.to)}</strong>{place ? ` · ${place}` : ''}</>} />

      <div className="agm-kpis">
        <div><span>Wanachama hai</span><b>{num(a.members.active)}</b><small>wapya {num(a.members.joined)} kipindi hiki</small></div>
        <div><span>Mauzo ya tumbaku</span><b>{tsh(a.sales.gross)}</b><small>kg {num(a.sales.kg)} · wakulima {num(a.sales.farmers)}</small></div>
        <div><span>Mapato ya chama</span><b>{tsh(is.totalIncome)}</b><small>matumizi {tsh(is.totalExpense)}</small></div>
        <div className={Number(is.surplus) < 0 ? 'neg' : ''}><span>Ziada / (upungufu)</span><b><Amt v={is.surplus} zero="0" /></b><small>kwa kipindi hiki</small></div>
        <div><span>Fedha zilizopo</span><b>{tsh(cf.closing)}</b><small>tarehe {date(a.to)}</small></div>
        <div><span>Madeni ya wakulima</span><b>{tsh(a.debts.amount)}</b><small>wakulima {num(a.debts.owing)}</small></div>
      </div>

      <h3 className="agm-h"><em>1</em>Wanachama na watumishi</h3>
      <table className="table agm-t"><tbody>
        <tr><td>Wanachama wote waliosajiliwa</td><td className="num">{num(a.members.total)}</td></tr>
        <tr><td>Wanachama hai</td><td className="num">{num(a.members.active)}</td></tr>
        <tr><td>— Wanaume / Wanawake</td><td className="num">{num(a.members.male)} / {num(a.members.female)} ({pct(a.members.female, a.members.active)} wanawake)</td></tr>
        <tr><td>Wanachama wapya kipindi hiki</td><td className="num">{num(a.members.joined)}</td></tr>
        <tr><td>Watumishi wa chama kwenye mfumo</td><td className="num">{num(a.staff)}</td></tr>
      </tbody></table>

      <h3 className="agm-h"><em>2</em>Mauzo ya tumbaku</h3>
      <table className="table agm-t"><tbody>
        <tr><td>Masoko yaliyofanyika</td><td className="num">{num(a.sales.markets)}</td></tr>
        <tr><td>Wakulima waliouza</td><td className="num">{num(a.sales.farmers)}</td></tr>
        <tr><td>Kilo zilizouzwa</td><td className="num">{num(a.sales.kg)}</td></tr>
        <tr><td>Thamani ya mauzo (ghafi)</td><td className="num">{tsh(a.sales.gross)}</td></tr>
        <tr><td>Wastani wa bei kwa kilo</td><td className="num">{avg ? tsh(avg) : '—'}</td></tr>
        <tr><td>Makato (madeni, ushuru, ada n.k.)</td><td className="num">{tsh(a.sales.ded)}</td></tr>
        <tr><td><strong>Malipo halisi kwa wakulima</strong></td><td className="num"><strong>{tsh(a.sales.net)}</strong></td></tr>
        <tr><td>Kilicholipwa tayari kipindi hiki</td><td className="num">{tsh(a.sales.paid)}</td></tr>
      </tbody></table>

      <h3 className="agm-h"><em>3</em>Pembejeo na madeni ya wakulima</h3>
      <table className="table agm-t"><tbody>
        <tr><td>Pembejeo zilizotolewa kwa mkopo</td><td className="num">{tsh(a.inputs.value)}</td></tr>
        <tr><td>Wakulima waliopewa pembejeo</td><td className="num">{num(a.inputs.farmers)} (utoaji {num(a.inputs.issues)})</td></tr>
        <tr><td>Wakulima wenye madeni hadi {date(a.to)}</td><td className="num">{num(a.debts.owing)}</td></tr>
        <tr><td><strong>Jumla ya madeni ya wakulima</strong></td><td className="num"><strong>{tsh(a.debts.amount)}</strong></td></tr>
      </tbody></table>

      <h3 className="agm-h"><em>4</em>Taarifa ya mapato na matumizi</h3>
      <table className="table agm-t">
        <thead><tr><th>Mapato</th><th className="num">TSh</th></tr></thead>
        <tbody>
          {is.income.map((l) => <tr key={l.id}><td>{l.code} · {l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
          <tr className="agm-sum"><td>Jumla ya mapato</td><td className="num">{tsh(is.totalIncome)}</td></tr>
        </tbody>
        <thead><tr><th>Matumizi</th><th className="num">TSh</th></tr></thead>
        <tbody>
          {is.expense.map((l) => <tr key={l.id}><td>{l.code} · {l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
          <tr className="agm-sum"><td>Jumla ya matumizi</td><td className="num">{tsh(is.totalExpense)}</td></tr>
          <tr className="agm-total"><td>ZIADA / (UPUNGUFU) WA KIPINDI</td><td className="num"><Amt v={is.surplus} zero="0" /></td></tr>
        </tbody>
      </table>

      <h3 className="agm-h"><em>5</em>Mizania (hali ya kifedha) tarehe {date(a.to)}</h3>
      <div className="agm-two">
        <table className="table agm-t">
          <thead><tr><th>Mali</th><th className="num">TSh</th></tr></thead>
          <tbody>
            {bs.assets.map((l) => <tr key={l.id}><td>{l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
            <tr className="agm-total"><td>JUMLA YA MALI</td><td className="num">{tsh(bs.totalAssets)}</td></tr>
          </tbody>
        </table>
        <table className="table agm-t">
          <thead><tr><th>Madeni na mtaji</th><th className="num">TSh</th></tr></thead>
          <tbody>
            {bs.liabilities.map((l) => <tr key={l.id}><td>{l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
            <tr className="agm-sum"><td>Jumla ya madeni</td><td className="num">{tsh(bs.totalLiabilities)}</td></tr>
            {bs.equity.map((l) => <tr key={l.id}><td>{l.name}</td><td className="num">{tsh(l.amount)}</td></tr>)}
            <tr><td>Ziada ya miaka iliyopita</td><td className="num"><Amt v={bs.retainedPrior} zero="0" /></td></tr>
            <tr><td>Ziada ya mwaka huu</td><td className="num"><Amt v={bs.currentSurplus} zero="0" /></td></tr>
            <tr className="agm-total"><td>JUMLA YA MADENI NA MTAJI</td><td className="num">{tsh(bs.totalLiabilitiesEquity)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className={`agm-check ${bs.balanced ? 'ok' : 'bad'}`}>{bs.balanced ? '✓ Mizania inalingana (mali = madeni + mtaji)' : '⚠ Mizania hailingani — kagua daftari kuu kabla ya kuwasilisha'}</p>

      <h3 className="agm-h"><em>6</em>Mtiririko wa fedha</h3>
      <table className="table agm-t"><tbody>
        <tr><td>Fedha mwanzoni mwa kipindi</td><td className="num">{tsh(cf.opening)}</td></tr>
        {Object.entries(cf.sections).filter(([, s]) => Number(s.total) !== 0).map(([k, s]) => <tr key={k}><td>{s.label}</td><td className="num"><Amt v={s.total} zero="0" /></td></tr>)}
        <tr className="agm-sum"><td>Mabadiliko ya fedha</td><td className="num"><Amt v={cf.net} zero="0" /></td></tr>
        <tr className="agm-total"><td>FEDHA MWISHONI MWA KIPINDI</td><td className="num">{tsh(cf.closing)}</td></tr>
      </tbody></table>

      <h3 className="agm-h"><em>7</em>Ukaguzi na maagizo ya Afisa Ushirika</h3>
      <table className="table agm-t"><tbody>
        <tr><td>Ukaguzi uliofanyika kipindi hiki</td><td className="num">{num(a.oversight.inspections)}</td></tr>
        <tr><td>Hoja za ukaguzi (zilizotatuliwa)</td><td className="num">{num(a.oversight.findings)} ({num(a.oversight.resolved)} zimetatuliwa)</td></tr>
        <tr><td>Hoja zilizo wazi hadi sasa</td><td className="num">{num(a.oversight.open)}</td></tr>
        <tr><td>Maagizo rasmi (yaliyotekelezwa)</td><td className="num">{num(a.oversight.directives)} ({num(a.oversight.complied)} yametekelezwa)</td></tr>
      </tbody></table>
      {a.lockedThrough && <p className="muted agm-note">Vitabu vya hesabu vimefungwa hadi {date(a.lockedThrough)}.</p>}

      {!!leaders.length && (
        <>
          <h3 className="agm-h"><em>8</em>Viongozi wa bodi</h3>
          <table className="table agm-t"><tbody>{leaders.map((l) => <tr key={l.role}><td>{ROLE[l.role] ?? l.role}</td><td className="num">{l.name}</td></tr>)}</tbody></table>
        </>
      )}

      <p className="agm-note">Taarifa hii imetolewa na mfumo wa CoopLink kutoka kumbukumbu za chama. Hesabu za fedha zinatoka moja kwa moja kwenye daftari kuu (double-entry).</p>
      <Signatures items={['Mwenyekiti wa Bodi', 'Meneja / Katibu', 'Mhasibu']} />
    </article>
  );
}
