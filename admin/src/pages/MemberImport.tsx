// =====================================================================
//  KUPAKIA DAFTARI LA WAKULIMA (CSV kutoka Excel) — Meneja
//  1. Pakua kiolezo  2. Jaza na uhifadhi kama CSV  3. Pakia -> hakiki kila mstari  4. Hifadhi kwa nenosiri
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { downloadCsv, parseCsv, rowsToObjects } from '../lib/csv';
import { Alert, Badge, Button, PageHead } from '../components/ui';
import { ConfirmDialog, Kpi, Section } from '../components/owner-ui';

const COLS: [key: string, header: string, aliases: string[], example: string][] = [
  ['memberNo', 'Namba ya uanachama', ['namba', 'namba ya mwanachama', 'member no', 'memberno', 'namba ya uanachama'], 'URM/0001'],
  ['fullName', 'Majina kamili (badala ya safu 3 za majina)', ['majina kamili', 'jina kamili', 'majina', 'full name', 'fullname', 'name', 'jina la mkulima', 'majina ya mkulima', 'jina', 'majina kamili (badala ya safu 3 za majina)'], ''],
  ['firstName', 'Jina la kwanza', ['jina la kwanza', 'first name', 'firstname'], 'Asha'],
  ['middleName', 'Jina la kati', ['jina la kati', 'middle name', 'middlename'], 'Hamisi'],
  ['lastName', 'Jina la ukoo', ['jina la ukoo', 'jina la mwisho', 'last name', 'lastname', 'surname', 'ukoo'], 'Juma'],
  ['gender', 'Jinsia (ME/KE)', ['jinsia', 'gender', 'sex', 'jinsia (me/ke)'], 'KE'],
  ['phone', 'Simu', ['simu', 'namba ya simu', 'phone', 'mobile', 'simu ya mkulima'], '0754123456'],
  ['village', 'Kijiji', ['kijiji', 'village'], 'Usoke'],
  ['hamlet', 'Kitongoji', ['kitongoji', 'hamlet'], 'Mlimani'],
  ['nidaNumber', 'NIDA', ['nida', 'namba ya nida', 'nida number'], ''],
  ['voterIdNumber', 'Kadi ya mpiga kura', ['kadi ya mpiga kura', 'voter id', 'mpiga kura'], ''],
  ['dateOfBirth', 'Tarehe ya kuzaliwa (DD/MM/YYYY)', ['tarehe ya kuzaliwa', 'tarehe ya kuzaliwa (dd/mm/yyyy)', 'date of birth', 'dob'], ''],
  ['joinedAt', 'Tarehe ya kujiunga (DD/MM/YYYY)', ['tarehe ya kujiunga', 'tarehe ya kujiunga (dd/mm/yyyy)', 'alijiunga', 'joined', 'joined at'], '15/03/2019'],
  ['sharesCount', 'Hisa', ['hisa', 'idadi ya hisa', 'shares'], '5'],
  ['mobileMoneyNumber', 'Namba ya malipo ya simu', ['namba ya malipo ya simu', 'namba ya malipo', 'mobile money', 'mpesa'], '0754123456'],
  ['mobileMoneyProvider', 'Mtandao (M-Pesa/Airtel/Mixx/HaloPesa)', ['mtandao', 'mtandao (m-pesa/airtel/mixx/halopesa)', 'provider', 'network'], 'M-Pesa'],
  ['bankName', 'Benki', ['benki', 'bank', 'jina la benki'], ''],
  ['bankAccountNumber', 'Namba ya akaunti ya benki', ['namba ya akaunti ya benki', 'namba ya akaunti', 'account number', 'akaunti'], ''],
  ['bankAccountName', 'Jina la akaunti ya benki', ['jina la akaunti ya benki', 'jina la akaunti', 'account name'], ''],
];
const TEMPLATE = COLS.filter((c) => c[0] !== 'fullName'); // kiolezo kina safu 3 za majina
const ALIASES = Object.fromEntries(COLS.map(([k, h, a]) => [k, [h, k, ...a]]));

interface Checked { row: number; ok: boolean; errors: string[]; warnings: string[]; name: string }
interface Result { summary: { total: number; ok: number; errors: number; warnings: number; created?: number }; rows?: Checked[] }

export function MemberImport() {
  const [file, setFile] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [check, setCheck] = useState<Result | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [onlyBad, setOnlyBad] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (f: File) => {
    setError(null); setCheck(null); setDone(null); setNotes([]);
    if (!/\.csv$/i.test(f.name)) { setError('Chagua faili la CSV. Kwenye Excel: File → Save As → "CSV UTF-8 (Comma delimited)".'); return; }
    const parsed = rowsToObjects(parseCsv(await f.text()), ALIASES);
    const n: string[] = [];
    // "Jina" + "Ukoo" bila "Jina la kwanza": safu ya "Jina" ni jina la kwanza
    if (!parsed.missing.includes('fullName') && !parsed.missing.includes('lastName') && parsed.missing.includes('firstName')) {
      parsed.data = parsed.data.map(({ fullName, ...r }) => ({ ...r, firstName: fullName ?? '' }));
      parsed.missing = parsed.missing.filter((k) => k !== 'firstName').concat('fullName');
    }
    const splitNames = !parsed.missing.includes('firstName') && !parsed.missing.includes('lastName');
    if ((!splitNames && parsed.missing.includes('fullName')) || parsed.missing.includes('gender')) {
      setError('Faili halina safu za lazima: majina (Jina la kwanza + Jina la ukoo, AU safu moja ya "Majina kamili") na Jinsia. Tumia kiolezo.'); return;
    }
    if (!splitNames) n.push('Majina yanachukuliwa kutoka safu ya "Majina kamili": neno la kwanza = jina la kwanza, la mwisho = jina la ukoo, yaliyobaki = jina la kati.');
    if (parsed.unknown.length) n.push(`Safu hizi hazitumiki na zimerukwa: ${parsed.unknown.join(', ')}`);
    if (!parsed.data.length) { setError('Faili halina wakulima'); return; }
    if (parsed.data.length > 2000) { setError(`Faili lina wakulima ${parsed.data.length}. Pakia 2,000 au chini kwa mara moja (gawanya faili).`); return; }
    setFile(f.name); setRows(parsed.data); setNotes(n);
    setBusy(true);
    try { setCheck(await api<Result>('/members/import', { method: 'POST', body: { rows: parsed.data, dryRun: true } })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const s = check?.summary;
  const shown = (check?.rows ?? []).filter((r) => !onlyBad || !r.ok || r.warnings.length);
  return (
    <>
      <PageHead title="Pakia daftari la wakulima" sub="Hamisha wakulima wote kutoka daftari au Excel ya chama kwa mara moja">
        <Link className="btn btn-secondary" to="/members">← Wakulima</Link>
      </PageHead>
      {done ? (
        <Section title="Imekamilika">
          <Alert kind="ok">Wakulima {done.summary.created} wamesajiliwa na wako hai.{done.summary.errors ? ` Mistari ${done.summary.errors} yenye makosa imerukwa — irekebishe kwenye faili na uipakie tena.` : ''}</Alert>
          <div className="actions"><Link className="btn btn-primary" to="/members">Ona wakulima</Link><Button variant="secondary" onClick={() => { setDone(null); setCheck(null); setFile(null); }}>Pakia faili jingine</Button></div>
        </Section>
      ) : (
        <>
          <Section title="1 · Andaa faili">
            <ol className="rules">
              <li>Pakua <b>kiolezo</b>, kifungue kwenye Excel na ujaze mkulima mmoja kila mstari. Safu za lazima: <b>majina</b> na <b>Jinsia</b> (ME au KE). Majina yanaweza kuwa safu tatu (la kwanza, la kati, la ukoo) <b>au</b> safu moja ya "Majina kamili", mf. "Asha Hamisi Juma".</li>
              <li>Namba ya uanachama ikiachwa wazi, mfumo utatoa mpya. Tarehe ziandikwe <b>DD/MM/YYYY</b>.</li>
              <li>Hifadhi kwenye Excel kama <b>CSV UTF-8</b> (File → Save As), kisha pakia hapa chini.</li>
            </ol>
            <div className="actions">
              <Button variant="secondary" onClick={() => downloadCsv('kiolezo-wakulima.csv', [TEMPLATE.map((c) => c[1]), TEMPLATE.map((c) => c[3])])}>Pakua kiolezo (CSV)</Button>
              <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                {busy ? 'Inakagua…' : file ? 'Chagua faili jingine' : 'Chagua faili la CSV'}
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
              </label>
              {file && <span className="muted">{file} · mistari {rows.length}</span>}
            </div>
            <Alert>{error}</Alert>
            {notes.map((n) => <Alert key={n} kind="warn">{n}</Alert>)}
          </Section>

          {s && (
            <>
              <div className="grid grid-kpi" style={{ margin: '16px 0' }}>
                <Kpi tone="dark" label="Mistari" value={String(s.total)} />
                <Kpi label="Sahihi" value={String(s.ok)} />
                <Kpi tone={s.errors ? 'warn' : undefined} label="Yenye makosa" value={String(s.errors)} hint={s.errors ? 'Hayatahifadhiwa' : undefined} />
                <Kpi label="Tahadhari" value={String(s.warnings)} hint="Yatahifadhiwa" />
              </div>
              <Section pad={false} title="2 · Matokeo ya ukaguzi" actions={<label className="check"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> Onyesha yenye makosa/tahadhari tu</label>}>
                {shown.length === 0 ? <p className="card-pad muted">Mistari yote ni sahihi.</p> : (
                  <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="table">
                    <thead><tr><th>Mstari</th><th>Mkulima</th><th>Hali</th><th>Maelezo</th></tr></thead>
                    <tbody>{shown.map((r) => (
                      <tr key={r.row}>
                        <td className="muted">{r.row}</td>
                        <td>{r.name || '—'}</td>
                        <td>{r.ok ? <Badge status={r.warnings.length ? 'PENDING' : 'APPROVED'} label={r.warnings.length ? 'Tahadhari' : 'Sahihi'} /> : <Badge status="FAILED" label="Kosa" />}</td>
                        <td style={{ fontSize: 13 }}>{r.errors.map((x) => <div key={x} className="text-bad">{x}</div>)}{r.warnings.map((x) => <div key={x} className="muted">{x}</div>)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                )}
              </Section>
              <Section title="3 · Hifadhi">
                {s.errors > 0 && <label className="check"><input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /> Hifadhi wakulima {s.ok} sahihi sasa, na niruke {s.errors} wenye makosa</label>}
                <p className="muted" style={{ margin: '8px 0' }}>Wakulima watasajiliwa wakiwa hai moja kwa moja kwa idhini yako kama Meneja. Majina yanachukuliwa kutoka daftari la chama; mkulima akihaririwa baadaye, jina litafuata usajili wa mobile money wa simu yake.</p>
                <Button disabled={!s.ok || (s.errors > 0 && !skipInvalid)} onClick={() => setConfirm(true)}>Hifadhi wakulima {s.errors && skipInvalid ? s.ok : s.total}</Button>
              </Section>
            </>
          )}
        </>
      )}
      <ConfirmDialog open={confirm} title="Thibitisha kusajili wakulima" confirmLabel="Hifadhi"
        message={<>Unasajili wakulima <b>{s?.errors && skipInvalid ? s.ok : s?.total}</b> kutoka faili <b>{file}</b>. Weka nenosiri lako kuthibitisha.</>}
        onClose={() => setConfirm(false)}
        onConfirm={async (c) => { const r = await api<Result>('/members/import', { method: 'POST', body: { rows, dryRun: false, skipInvalid, ...c } }); setConfirm(false); setDone(r); }} />
    </>
  );
}
