// =====================================================================
//  DOLA (USD): kiwango cha dola cha chama na sarafu ya pembejeo (Mhasibu)
// =====================================================================
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, num, tsh } from '../lib/format';
import { usd, useFx } from '../lib/fx';
import { Alert, Button, Empty, Loading, TextField } from './ui';
import { Kpi, Section } from './owner-ui';

export function FxPanel() {
  const { may } = useAuth();
  const fx = useFx();
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const cur = useAction();
  const [ok, setOk] = useState<string | null>(null);
  if (fx.loading && !fx.data) return <Loading />;
  const d = fx.data;
  if (!d) return <Alert>{fx.error}</Alert>;
  const manage = may('finance.accounts');
  const save = async () => {
    if (await act.run(() => api('/finance/fx', { method: 'POST', body: { usdToTzs: rate, note: note || undefined } }))) { setOk(`Kiwango kipya: 1 USD = TSh ${num(rate)}`); setRate(''); setNote(''); fx.reload(); }
  };
  const switchTo = async (c: 'TZS' | 'USD') => {
    if (await cur.run(() => api('/finance/fx/currency', { method: 'PUT', body: { currency: c } }))) { setOk(c === 'USD' ? 'Pembejeo sasa zinakopeshwa kwa dola' : 'Pembejeo sasa zinakopeshwa kwa TSh'); fx.reload(); }
  };
  const bad = rate !== '' && (Number(rate) < 1000 || Number(rate) > 10000);
  return (
    <div className="stack">
      <Alert kind="ok">{ok}</Alert>
      <Alert>{act.error ?? cur.error}</Alert>
      <div className="grid grid-kpi">
        <Kpi tone="dark" label="Sarafu ya pembejeo" value={d.currency === 'USD' ? 'Dola (USD)' : 'Shilingi (TSh)'} hint={d.currency === 'USD' ? 'Bei, mikopo ya pembejeo na manunuzi kwa dola' : 'Bei na madeni kwa TSh'} />
        <Kpi tone="gold" label="Kiwango cha sasa" value={d.rate ? `TSh ${num(d.rate.usdToTzs)}` : '—'} hint={d.rate ? `Kwa USD 1 · tangu ${dateTime(d.rate.createdAt)}` : 'Bado hakijawekwa'} />
        <Kpi label="Deni la pembejeo la dola" value={usd(d.farmersUsdDebt)} hint={`Wakulima ${num(d.farmersWithUsdDebt)}${d.rate && Number(d.farmersUsdDebt) > 0 ? ` · ≈ ${tsh(Number(d.farmersUsdDebt) * Number(d.rate.usdToTzs))} leo` : ''}`} />
      </div>

      <Section title="Inavyofanya kazi">
        <ul className="fx-how">
          <li><strong>Bei ya pembejeo ni ya dola</strong> (mf. $20 kwa mfuko). Siku ya ugawaji, deni la mkulima linaandikwa kwa dola, na thamani yake ya TSh kwa kiwango cha siku hiyo.</li>
          <li><strong>Siku ya soko</strong>, deni la dola linakatwa kwa kiwango cha soko hilo. Mkulima akilipa taslimu, kiwango cha sasa kinatumika.</li>
          <li>Tofauti ya kiwango inaandikwa kwenye taarifa ya mkulima ("Tofauti ya kiwango cha dola") na kwenye daftari kuu kama <strong>faida (4700)</strong> au <strong>hasara (5700)</strong> ya kubadilisha fedha.</li>
          <li>Manunuzi kwa wazabuni ni ya dola pia; malipo yanafanywa kwa TSh kwa kiwango cha siku ya kulipa.</li>
          <li>Vitabu vyote (fedha, daftari kuu, ripoti) vinabaki kwa TSh.</li>
        </ul>
      </Section>

      {manage && (
        <div className="grid grid-2">
          <Section title="Weka kiwango kipya">
            <div className="form-grid">
              <TextField label="TSh kwa USD 1 *" type="number" min="1000" max="10000" step="0.01" value={rate} onChange={setRate} placeholder="mf. 2550" help={bad ? 'Kiwango kinatakiwa kuwa kati ya 1,000 na 10,000' : 'Kinatumika kwa ugawaji, manunuzi na marejesho yanayofuata'} />
              <TextField label="Chanzo / maelezo" value={note} onChange={setNote} placeholder="mf. BoT, benki ya chama" />
            </div>
            <Button busy={act.busy} disabled={!rate || bad} onClick={save}>Hifadhi kiwango</Button>
          </Section>
          <Section title="Sarafu ya pembejeo">
            <p className="muted" style={{ marginTop: 0 }}>Inaathiri bei, ugawaji na manunuzi <strong>mapya</strong> tu. Madeni yaliyopo yanabaki kwa sarafu yake.</p>
            <div className="seg" role="group" aria-label="Sarafu ya pembejeo">
              <button type="button" className={d.currency === 'USD' ? 'on' : ''} disabled={cur.busy} onClick={() => d.currency !== 'USD' && switchTo('USD')}>Dola (USD)</button>
              <button type="button" className={d.currency === 'TZS' ? 'on' : ''} disabled={cur.busy} onClick={() => d.currency !== 'TZS' && switchTo('TZS')}>Shilingi (TSh)</button>
            </div>
            {d.currency === 'USD' && <p className="muted" style={{ fontSize: 13 }}>Kumbuka: Meneja/Stokipa waweke bei za dola kwa kila pembejeo (Bidhaa na Stoo).</p>}
            {!d.rate && <p className="muted" style={{ fontSize: 13 }}>Weka kiwango kwanza ndipo uchague dola.</p>}
          </Section>
        </div>
      )}

      <Section title="Historia ya viwango" pad={false}>
        {!d.history.length ? <Empty>Bado hakuna kiwango kilichowekwa.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tarehe</th><th className="num">TSh kwa USD 1</th><th>Maelezo</th><th>Aliweka</th></tr></thead>
            <tbody>{d.history.map((h, i) => (
              <tr key={h.id}><td>{dateTime(h.createdAt)}{i === 0 && <> <span className="badge badge-ok">Cha sasa</span></>}</td><td className="num"><strong>{num(h.usdToTzs)}</strong></td><td className="muted">{h.note ?? ''}</td><td>{h.setBy ?? '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}
