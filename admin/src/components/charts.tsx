// Chati nyepesi za SVG (bila maktaba ya nje). Zinajibu ukubwa wa skrini na zina tooltip.
import { useEffect, useRef, useState } from 'react';

export interface Series { key: string; label: string; color: string }
type Row = Record<string, string | number | null>;

const compact = (n: number) =>
  Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : `${n}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return `${['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'][Number(mo) - 1]} ${y.slice(2)}`;
};

/** Upana halisi wa chombo — maandishi yanabaki 11px kwenye simu na kompyuta. */
function useWidth() {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Hesabu (si pesa): kiwango cha juu kisiwe chini ya 4 ili alama za mhimili ziwe namba kamili. */
function axisMax(values: number[]) {
  const m = Math.max(0, ...values);
  const ints = values.every((v) => Number.isInteger(v));
  return ints && m <= 4 ? 4 : niceMax(m);
}

/** Lebo za mwezi ziwe chache kwenye skrini nyembamba. */
const labelEvery = (n: number, iw: number) => Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 46))));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}

export function BarChart({ data, xKey, series, height = 240, format = compact, title }: {
  data: Row[]; xKey: string; series: Series[]; height?: number; format?: (n: number) => string; title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = height, pl = 48, pr = 12, pt = 14, pb = 34;
  const max = axisMax(data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))));
  const iw = W - pl - pr, ih = H - pt - pb;
  const gw = iw / Math.max(1, data.length);
  const bw = Math.min(26, (gw * 0.72) / series.length);
  const y = (v: number) => pt + ih - (v / max) * ih;
  return (
    <figure ref={ref} className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pl} x2={W - pr} y1={y(max * f)} y2={y(max * f)} stroke="#E8E1CF" strokeDasharray={f ? '3 4' : undefined} />
            <text x={pl - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="#6B7A72">{format(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const gx = pl + i * gw + (gw - bw * series.length) / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pl + i * gw} y={pt} width={gw} height={ih} fill={hover === i ? 'rgba(31,122,82,0.06)' : 'transparent'} />
              {series.map((s, j) => {
                const v = Number(d[s.key] ?? 0);
                return <rect key={s.key} x={gx + j * bw} y={y(v)} width={bw - 2} height={Math.max(0, pt + ih - y(v))} rx="3" fill={s.color} />;
              })}
              {i % labelEvery(data.length, iw) === 0 && <text x={pl + i * gw + gw / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B7A72">
                {String(d[xKey]).match(/^\d{4}-\d{2}$/) ? monthLabel(String(d[xKey])) : String(d[xKey])}
              </text>}
            </g>
          );
        })}
      </svg>
      <ChartFooter series={series} hover={hover === null ? null : data[hover]} xKey={xKey} format={format} />
    </figure>
  );
}

export function LineChart({ data, xKey, series, height = 240, format = compact, title }: {
  data: Row[]; xKey: string; series: Series[]; height?: number; format?: (n: number) => string; title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = height, pl = 48, pr = 16, pt = 14, pb = 34;
  const max = axisMax(data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))));
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = (i: number) => pl + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pt + ih - (v / max) * ih;
  return (
    <figure ref={ref} className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto', display: 'block' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - pl) / iw) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pl} x2={W - pr} y1={y(max * f)} y2={y(max * f)} stroke="#E8E1CF" strokeDasharray={f ? '3 4' : undefined} />
            <text x={pl - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="#6B7A72">{format(max * f)}</text>
          </g>
        ))}
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[s.key] ?? 0))}`).join(' ');
          return (
            <g key={s.key}>
              <polyline points={`${x(0)},${pt + ih} ${pts} ${x(data.length - 1)},${pt + ih}`} fill={s.color} opacity="0.08" />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(Number(d[s.key] ?? 0))} r={hover === i ? 5 : 3} fill="#fff" stroke={s.color} strokeWidth="2" />)}
            </g>
          );
        })}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pt} y2={pt + ih} stroke="#A9B8AF" strokeDasharray="3 3" />}
        {data.map((d, i) => (i % labelEvery(data.length, iw) === 0 ? (
          <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B7A72">
            {String(d[xKey]).match(/^\d{4}-\d{2}$/) ? monthLabel(String(d[xKey])) : String(d[xKey])}
          </text>
        ) : null))}
      </svg>
      <ChartFooter series={series} hover={hover === null ? null : data[hover]} xKey={xKey} format={format} />
    </figure>
  );
}

function ChartFooter({ series, hover, xKey, format }: { series: Series[]; hover: Row | null; xKey: string; format: (n: number) => string }) {
  return (
    <figcaption className="chart-legend">
      {hover && <strong style={{ marginRight: 8 }}>{String(hover[xKey]).match(/^\d{4}-\d{2}$/) ? monthLabel(String(hover[xKey])) : String(hover[xKey])}:</strong>}
      {series.map((s) => (
        <span key={s.key}><i style={{ background: s.color }} />{s.label}{hover ? `: ${format(Number(hover[s.key] ?? 0))}` : ''}</span>
      ))}
    </figcaption>
  );
}
