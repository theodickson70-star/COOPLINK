// =====================================================================
//  KAULI MBIU YA COOPLINK — inabadilika kila sekunde 35 (Kiingereza ⇄ Kiswahili)
//  Herufi zinaingia moja moja, kisha mwanga mdogo unapita juu ya herufi (unafuata umbo lake).
// =====================================================================
import { Fragment, useEffect, useState } from 'react';

export const SLOGANS = [
  { a: 'Connecting Cooperatives.', b: 'Empowering Farmers', lang: 'en' },
  { a: 'Tunaunganisha Vyama.', b: 'Tunawawezesha Wakulima', lang: 'sw' },
] as const;
export const SLOGAN_MS = 35_000;

function Line({ text, cls }: { text: string; cls: string }) {
  let i = 0;
  return (
    <span className={`slg-line ${cls}`} aria-hidden="true">
      {text.split(' ').map((w, wi) => (
        <Fragment key={wi}>
          {wi > 0 && ' '}
          <span className="slg-w">
            {[...w].map((ch) => <span className="slg-ch" key={i} style={{ animationDelay: `${(i++) * 28}ms` }}>{ch}</span>)}
          </span>
        </Fragment>
      ))}
      {/* Mwanga: nakala ya maandishi juu yake — gradient imekatwa kwa umbo la herufi */}
      <span className="slg-sheen">{text}</span>
    </span>
  );
}

/** Kauli mbiu inayozunguka: tumia ndani ya <h1>/<h2> */
export function RotatingSlogan({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setN((x) => x + 1); }, SLOGAN_MS);
    return () => clearInterval(id);
  }, []);
  const s = SLOGANS[n % SLOGANS.length];
  return (
    <span className="slg" key={n} lang={s.lang}>
      <span className="sr-only">{s.a} {s.b}</span>
      <Line text={s.a} cls="slg-a" />
      <Line text={s.b} cls="slg-b" />
    </span>
  );
}
