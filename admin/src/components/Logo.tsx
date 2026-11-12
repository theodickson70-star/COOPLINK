import { useEffect, useId, useState, type CSSProperties } from 'react';
// Alama ya CoopLink: majani matatu ya tumbaku yanayounda duara moja
// (mkulima, chama, soko), kiini cha chama katikati, na duara la wanachama.
const LEAF = 'M60 60 C 43 47 42 24 60 6 C 78 24 77 47 60 60 Z';
const VEIN = 'M60 54 L60 14';

/** Animation ya nembo inarudiwa kila baada ya sekunde 14 */
export const LOGO_REPLAY_MS = 14_000;

export function LogoMark({ size = 40, animate = false, spin = false, onDark = true, ring = true, repeat = animate ? LOGO_REPLAY_MS : 0 }: {
  /** animate: majani yanakua kwa mfuatano; spin: majani yanazunguka (skrini ya kusubiri); repeat: rudia animation kila ms hizi (0 = mara moja) */
  size?: number; animate?: boolean; spin?: boolean; onDark?: boolean; ring?: boolean; repeat?: number;
}) {
  const vein = onDark ? '#0B2F23' : '#F6F0E1';
  // Kuirudia animation: svg inachorwa upya (key mpya) kila baada ya muda uliowekwa
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!animate || !repeat) return;
    const id = setInterval(() => { if (!document.hidden) setRound((r) => r + 1); }, repeat);
    return () => clearInterval(id);
  }, [animate, repeat]);
  return (
    <svg key={round} viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Alama ya CoopLink"
      className={`cl-mark${animate ? ' cl-anim' : ''}${spin ? ' cl-spin' : ''}`}>
      {ring && <circle className="mk-ring" cx="60" cy="60" r="56" fill="none" stroke="#E3A83A" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="0.1 7.2" />}
      <g className="mk-leaves">
      <path className="mk-leaf" fill="#2FA36B" d={LEAF} />
      <path className="mk-vein" fill="none" stroke={vein} strokeWidth="1.6" strokeLinecap="round" d={VEIN} />
      <g transform="rotate(120 60 60)">
        <path className="mk-leaf mk-l2" fill="#1F7A52" d={LEAF} />
        <path className="mk-vein mk-v2" fill="none" stroke={vein} strokeWidth="1.6" strokeLinecap="round" d={VEIN} />
      </g>
      <g transform="rotate(240 60 60)">
        <path className="mk-leaf mk-l3" fill="#E3A83A" d={LEAF} />
        <path className="mk-vein mk-v3" fill="none" stroke={vein} strokeWidth="1.6" strokeLinecap="round" d={VEIN} />
      </g>
      </g>
      <g className="mk-core">
        <circle cx="60" cy="60" r="9.5" fill="#F6F0E1" stroke="#0B2F23" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="3.6" fill="#E3A83A" />
      </g>
    </svg>
  );
}

// Herufi za "CoopLink" (Outfit 800) zikiwa michoro: zinachorwa moja moja kama kalamu inaandika,
// zinajazwa rangi, kisha mwanga unapita juu yake. Michoro haitegemei font kupakuliwa.
const WM_VIEWBOX = '0.8 -75.2 427.7 97.9';
const WM_RATIO = 427.7 / 97.9;
// Kitone cha herufi "i" kinabadilishwa na jani la tumbaku (alama ya zao la wakulima)
const I_LEAF = 'M303 -52 C 289 -60 290 -77 303 -88 C 316 -77 317 -60 303 -52 Z';
const I_LEAF_VEIN = 'M303 -56 L303 -82';
const stemOnly = (d: string) => 'M' + d.split('M').filter(Boolean)[0];
const GLYPHS = [
  { ch: 'C', d: 'M40.7 1.1L40.7 1.1Q32.6 1.1 25.7-1.7Q18.8-4.4 13.7-9.3Q8.5-14.3 5.7-21Q2.8-27.7 2.8-35.5L2.8-35.5Q2.8-43.4 5.7-50.1Q8.5-56.7 13.7-61.6Q18.8-66.5 25.7-69.3Q32.5-72.1 40.5-72.1L40.5-72.1Q48.9-72.1 55.6-69.5Q62.3-66.8 67.4-62.1L67.4-62.1L55.4-50.1Q52.9-52.9 49.2-54.5Q45.5-56.1 40.5-56.1L40.5-56.1Q36.2-56.1 32.6-54.7Q29.1-53.3 26.5-50.6Q23.9-47.8 22.5-44Q21-40.2 21-35.5L21-35.5Q21-30.8 22.5-27Q23.9-23.2 26.5-20.5Q29.1-17.7 32.6-16.3Q36.2-14.8 40.5-14.8L40.5-14.8Q45.5-14.8 49.3-16.4Q53.1-17.9 55.8-20.8L55.8-20.8L67.8-8.8Q62.6-4.1 56.1-1.5Q49.5 1.1 40.7 1.1Z' },
  { ch: 'o', d: 'M95 1.1L95 1.1Q87.1 1.1 81.0-2.3Q74.8-5.6 71.2-11.5Q67.6-17.3 67.6-24.6L67.6-24.6Q67.6-31.9 71.1-37.6Q74.7-43.4 80.9-46.8Q87.1-50.1 94.9-50.1L94.9-50.1Q102.7-50.1 108.8-46.8Q115-43.4 118.6-37.6Q122.2-31.9 122.2-24.6L122.2-24.6Q122.2-17.3 118.7-11.5Q115.1-5.6 109.0-2.3Q102.8 1.1 95 1.1ZM94.9-14.4L94.9-14.4Q97.8-14.4 99.9-15.7Q102.1-16.9 103.3-19.2Q104.5-21.5 104.5-24.5L104.5-24.5Q104.5-27.5 103.3-29.8Q102-32 99.9-33.3Q97.8-34.5 94.9-34.5L94.9-34.5Q92.1-34.5 89.9-33.2Q87.7-31.9 86.5-29.7Q85.3-27.4 85.3-24.4L85.3-24.4Q85.3-21.5 86.5-19.2Q87.7-16.9 89.9-15.7Q92.1-14.4 94.9-14.4Z' },
  { ch: 'o', d: 'M150.7 1.1L150.7 1.1Q142.8 1.1 136.7-2.3Q130.5-5.6 126.9-11.5Q123.3-17.3 123.3-24.6L123.3-24.6Q123.3-31.9 126.8-37.6Q130.4-43.4 136.6-46.8Q142.8-50.1 150.6-50.1L150.6-50.1Q158.4-50.1 164.6-46.8Q170.7-43.4 174.3-37.6Q177.9-31.9 177.9-24.6L177.9-24.6Q177.9-17.3 174.3-11.5Q170.8-5.6 164.7-2.3Q158.5 1.1 150.7 1.1ZM150.6-14.4L150.6-14.4Q153.5-14.4 155.7-15.7Q157.8-16.9 159-19.2Q160.2-21.5 160.2-24.5L160.2-24.5Q160.2-27.5 158.9-29.8Q157.7-32 155.6-33.3Q153.5-34.5 150.6-34.5L150.6-34.5Q147.8-34.5 145.6-33.2Q143.4-31.9 142.2-29.7Q141-27.4 141-24.4L141-24.4Q141-21.5 142.2-19.2Q143.4-16.9 145.6-15.7Q147.8-14.4 150.6-14.4Z' },
  { ch: 'p', d: 'M211.4 1L211.4 1Q206.7 1 202.7-0.7L202.7-0.7Q200.9-1.5 199.3-2.5L199.3-2.5L199.3 20.7L182.3 20.7L182.3-48.9L199.7-48.9L199.7-46.3Q201.1-47.3 202.8-48.1L202.8-48.1Q206.7-49.9 211.4-49.9L211.4-49.9Q218.5-49.9 223.9-46.7Q229.3-43.4 232.3-37.6Q235.4-31.8 235.4-24.4L235.4-24.4Q235.4-17.1 232.3-11.4Q229.3-5.6 223.9-2.3Q218.5 1 211.4 1ZM208.1-14.5L208.1-14.5Q211-14.5 213.2-15.8Q215.4-17.1 216.6-19.4Q217.8-21.6 217.8-24.5Q217.8-27.4 216.6-29.6Q215.4-31.8 213.2-33.1Q211-34.4 208.2-34.4L208.2-34.4Q205.5-34.4 203.3-33.1Q201.1-31.9 199.9-29.7Q198.7-27.4 198.7-24.5Q198.7-21.6 199.9-19.4Q201.1-17.1 203.3-15.8Q205.4-14.5 208.1-14.5Z' },
  { ch: 'L', d: 'M289.7 0L241.3 0L241.3-70.9L259.2-70.9L259.2-15.4L289.7-15.4L289.7 0Z' },
  { ch: 'i', d: 'M311.7 0L294.2 0L294.2-48.9L311.7-48.9L311.7 0ZM302.9-54.6L302.9-54.6Q299-54.6 296.4-57.3Q293.8-59.9 293.8-63.9L293.8-63.9Q293.8-67.8 296.4-70.5Q299-73.2 302.9-73.2L302.9-73.2Q307-73.2 309.6-70.5Q312.1-67.8 312.1-63.9L312.1-63.9Q312.1-59.9 309.6-57.3Q307-54.6 302.9-54.6Z' },
  { ch: 'n', d: 'M368.4 0L351 0L351-27.6Q351-31 349-33.0Q347-34.9 343.9-34.9L343.9-34.9Q341.8-34.9 340.1-34Q338.5-33.1 337.6-31.5Q336.7-29.9 336.7-27.6L336.7-27.6L336.7 0L319.3 0L319.3-48.9L336.7-48.9L336.7-45.7Q338.1-46.7 339.7-47.6L339.7-47.6Q344.2-49.9 350-49.9L350-49.9Q355.3-49.9 359.4-47.5Q363.6-45 366-40.9Q368.4-36.8 368.4-31.6L368.4-31.6L368.4 0Z' },
  { ch: 'k', d: 'M426.5 0L406.5 0L392.5-23.3L392.5 0L375.1 0L375.1-72.9L392.5-72.9L392.5-27.7L406.4-48.9L425.5-48.9L409-26L426.5 0Z' },
];

export function Wordmark({ size = 26, onDark = true, animate = false, delay = 0 }: { size?: number; onDark?: boolean; animate?: boolean; delay?: number }) {
  const uid = useId().replace(/:/g, '');
  const base = onDark ? '#F6F0E1' : '#0B2F23';
  const accent = onDark ? '#E3A83A' : '#A86F12';
  const h = size * 1.02;
  return (
    <svg className={`cl-wm${animate ? ' cl-wm-anim' : ''}`} viewBox={WM_VIEWBOX} width={h * WM_RATIO} height={h} role="img" aria-label="CoopLink"
      style={{ display: 'block', overflow: 'visible', ...(delay ? { '--d': `${delay}s` } : {}) } as CSSProperties}>
      <defs>
        <clipPath id={`wmc${uid}`}>{GLYPHS.map((g, i) => <path key={i} d={g.ch === 'i' ? stemOnly(g.d) : g.d} />)}<path d={I_LEAF} /></clipPath>
        <linearGradient id={`wmg${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity={onDark ? 0.85 : 0.6} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {GLYPHS.map((g, i) => {
        const c = i >= 4 ? accent : base;
        return (
          <path key={i} className="wm-ch" d={g.ch === 'i' ? stemOnly(g.d) : g.d} fill={c} stroke={c} strokeWidth={animate ? 1.6 : 0} strokeLinejoin="round"
            pathLength={1} style={animate ? ({ '--i': i } as CSSProperties) : undefined} />
        );
      })}
      <g className="wm-ileaf">
        <path d={I_LEAF} fill="#2FA36B" />
        <path d={I_LEAF_VEIN} fill="none" stroke={onDark ? '#0B2F23' : '#F6F0E1'} strokeWidth="1.8" strokeLinecap="round" />
      </g>
      {animate && (
        <g clipPath={`url(#wmc${uid})`}>
          <rect className="wm-gleam" x="-60" y="-80" width="60" height="110" fill={`url(#wmg${uid})`} transform="skewX(-18)" />
        </g>
      )}
    </svg>
  );
}

export function Logo({ size = 36, onDark = true }: { size?: number; onDark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3 }}>
      <LogoMark size={size} onDark={onDark} />
      <Wordmark size={size * 0.62} onDark={onDark} />
    </span>
  );
}
