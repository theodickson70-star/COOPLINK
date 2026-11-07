// Alama ya CoopLink: majani matatu ya tumbaku yanayounda duara moja
// (mkulima, chama, soko), kiini cha chama katikati, na duara la wanachama.
const LEAF = 'M60 60 C 43 47 42 24 60 6 C 78 24 77 47 60 60 Z';
const VEIN = 'M60 54 L60 14';

export function LogoMark({ size = 40, animate = false, onDark = true, ring = true }: {
  size?: number; animate?: boolean; onDark?: boolean; ring?: boolean;
}) {
  const vein = onDark ? '#0B2F23' : '#F6F0E1';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Alama ya CoopLink"
      className={`cl-mark ${animate ? 'cl-anim' : ''}`}>
      {ring && <circle className="mk-ring" cx="60" cy="60" r="56" fill="none" stroke="#E3A83A" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="0.1 7.2" />}
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
      <g className="mk-core">
        <circle cx="60" cy="60" r="9.5" fill="#F6F0E1" stroke="#0B2F23" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="3.6" fill="#E3A83A" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 26, onDark = true, animate = false }: { size?: number; onDark?: boolean; animate?: boolean }) {
  const base = onDark ? '#F6F0E1' : '#0B2F23';
  const accent = onDark ? '#E3A83A' : '#A86F12';
  const letters = 'CoopLink'.split('');
  return (
    <span className={animate ? 'cl-anim' : ''} aria-label="CoopLink"
      style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, color: base, whiteSpace: 'nowrap' }}>
      {animate ? (
        <span className="wm" aria-hidden="true">
          {letters.map((ch, i) => (
            <span key={i} style={{ color: i >= 4 ? accent : base, animationDelay: `${0.7 + i * 0.06}s` }}>{ch}</span>
          ))}
        </span>
      ) : (
        <span aria-hidden="true">Coop<span style={{ color: accent }}>Link</span></span>
      )}
    </span>
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
