// =====================================================================
//  TAARIFA YA MKULIMA KWA KIUNGO CHA SMS (v2.4) — /s/:token
//  Bila kuingia: mauzo, pembejeo, deni na miamala ya karibuni (rekodi zilizoidhinishwa tu).
//  Hakuna namba ya simu wala kitambulisho kinachoonyeshwa. Kiungo kinaisha baada ya siku 90.
// =====================================================================
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loading } from '../components/ui';
import { LogoMark } from '../components/Logo';
import { date, num, tsh } from '../lib/format';
import { usd } from '../lib/fx';

interface PS {
  valid: true; expiresAt: string; amcos: string;
  member: { memberNo: string; name: string; village: string | null; group: string | null };
  season: { name: string; startDate: string; endDate: string } | null;
  opening: string; balance: string; amountOwed: string;
  usd: { debtUsd: string; atCurrentTzs?: string | null } | null;
  sales: { settlementNo: string; marketNo: string; marketDate: string; buyer: string | null; kg: string; grossTzs: string; deductions: string; netTzs: string; status: string }[];
  inputs: { name: string; unit: string; quantity: string; kg: string | null; amount: string; amountUsd: string | null }[];
  entries: { date: string; description: string; debit: string; credit: string; balance: string }[];
  entriesTotal: number;
}

export function PublicStatement() {
  const { token } = useParams();
  const [d, setD] = useState<PS | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid' | 'expired'>('loading');
  useEffect(() => {
    document.title = 'Taarifa ya mkulima · CoopLink';
    fetch(`/api/v1/public/statement/${encodeURIComponent(token ?? '')}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (r.ok && j?.valid) { setD(j); setState('ok'); } else setState(r.status === 410 ? 'expired' : 'invalid');
    }).catch(() => setState('invalid'));
  }, [token]);

  if (state !== 'ok' || !d) {
    return (
      <main className="verify-page">
        <div className="verify-card">
          <div className="verify-brand">CoopLink · Taarifa ya mkulima</div>
          {state === 'loading' ? <Loading /> : <>
            <div className="verify-icon bad">{state === 'expired' ? '!' : '✕'}</div>
            <h1>{state === 'expired' ? 'Kiungo kimeisha muda' : 'Kiungo hakijatambuliwa'}</h1>
            <p>{state === 'expired' ? 'Omba chama chako kikutumie kiungo kipya cha taarifa yako.' : 'Kiungo hiki si sahihi au kimesitishwa. Wasiliana na chama chako.'}</p>
          </>}
        </div>
      </main>
    );
  }
  const owes = Number(d.balance) < 0;
  const kg = d.sales.reduce((t, x) => t + Number(x.kg), 0);
  const net = d.sales.reduce((t, x) => t + Number(x.netTzs), 0);
  const inputs = d.inputs.reduce((t, x) => t + Number(x.amount), 0);
  return (
    <main className="ps-page">
      <article className="ps-card">
        <header className="ps-head">
          <LogoMark size={40} ring={false} />
          <div><b>{d.amcos}</b><small>Taarifa ya mkulima · {d.season ? `Msimu ${d.season.name}` : 'Misimu yote'}</small></div>
        </header>
        <section className="ps-who">
          <h1>{d.member.name}</h1>
          <p>Namba {d.member.memberNo}{d.member.village ? ` · ${d.member.village}` : ''}{d.member.group ? ` · Kikundi ${d.member.group}` : ''}</p>
        </section>
        <section className={`ps-bal ${owes ? 'owe' : 'ok'}`}>
          <small>{owes ? 'Deni lako kwa chama' : Number(d.balance) > 0 ? 'Chama kinakudai (utalipwa)' : 'Salio'}</small>
          <b>{tsh(owes ? d.amountOwed : d.balance)}</b>
          {d.usd && Number(d.usd.debtUsd) > 0 && <span>Deni la dola: {usd(d.usd.debtUsd)}</span>}
        </section>
        <div className="ps-kpis">
          <div><small>Tumbaku uliyouza</small><b>Kilo {num(kg)}</b></div>
          <div><small>Mauzo baada ya makato</small><b>{tsh(net)}</b></div>
          <div><small>Pembejeo ulizochukua</small><b>{tsh(inputs)}</b></div>
        </div>

        {!!d.sales.length && <section className="ps-sec">
          <h2>Mauzo ya tumbaku</h2>
          <ul className="ps-list">{d.sales.map((s) => (
            <li key={s.settlementNo}>
              <span><b>Soko {date(s.marketDate)}</b><small>{s.settlementNo}{s.buyer ? ` · ${s.buyer}` : ''} · kilo {num(s.kg)}</small></span>
              <span className="ps-amt"><b>{tsh(s.netTzs)}</b><small>Mauzo {tsh(s.grossTzs)} − makato {tsh(s.deductions)}</small></span>
            </li>
          ))}</ul>
        </section>}

        {!!d.inputs.length && <section className="ps-sec">
          <h2>Pembejeo</h2>
          <ul className="ps-list">{d.inputs.map((x) => (
            <li key={x.name}>
              <span><b>{x.name}</b><small>{x.kg ? `kilo ${num(x.kg)}` : `${num(x.quantity)} ${x.unit}`}</small></span>
              <span className="ps-amt"><b>{x.amountUsd ? usd(x.amountUsd) : tsh(x.amount)}</b>{x.amountUsd && <small>{tsh(x.amount)}</small>}</span>
            </li>
          ))}</ul>
        </section>}

        {!!d.entries.length && <section className="ps-sec">
          <h2>Miamala {d.entriesTotal > d.entries.length ? `(${d.entries.length} ya mwisho)` : ''}</h2>
          <ul className="ps-list ps-tx">{[...d.entries].reverse().map((e, i) => (
            <li key={i}>
              <span><b>{e.description}</b><small>{date(e.date)}</small></span>
              <span className="ps-amt">
                <b className={Number(e.credit) > 0 ? 'in' : 'out'}>{Number(e.credit) > 0 ? `+${tsh(e.credit)}` : `−${tsh(e.debit)}`}</b>
                <small>Salio {tsh(e.balance)}</small>
              </span>
            </li>
          ))}</ul>
        </section>}

        <footer className="ps-foot">
          Taarifa hii ni yako peke yako — usimpe mtu kiungo hiki. Kinaisha {date(d.expiresAt)}.
          Ukiona kosa, wasiliana na ofisi ya {d.amcos}.
          <span>CoopLink · Connecting Cooperatives. Empowering Farmers.</span>
        </footer>
      </article>
    </main>
  );
}
