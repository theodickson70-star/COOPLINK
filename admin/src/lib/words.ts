// Kiasi kwa maneno ya Kiswahili (kwa vocha na risiti): 504500 -> "laki tano na elfu nne na mia tano"
const U = ['sifuri', 'moja', 'mbili', 'tatu', 'nne', 'tano', 'sita', 'saba', 'nane', 'tisa'];
const T = ['', 'kumi', 'ishirini', 'thelathini', 'arobaini', 'hamsini', 'sitini', 'sabini', 'themanini', 'tisini'];

function w(n: number): string {
  const and = (r: number, f: (x: number) => string) => (r ? ` na ${f(r)}` : '');
  if (n < 10) return U[n];
  if (n < 100) return T[Math.floor(n / 10)] + and(n % 10, (x) => U[x]);
  if (n < 1000) return `mia ${U[Math.floor(n / 100)]}` + and(n % 100, w);
  if (n < 100_000) return `elfu ${w(Math.floor(n / 1000))}` + and(n % 1000, w);
  if (n < 1_000_000) {
    const r = n % 100_000;
    return `laki ${w(Math.floor(n / 100_000))}` + (r >= 1000 ? ` na elfu ${w(Math.floor(r / 1000))}${and(r % 1000, w)}` : and(r, w));
  }
  if (n < 1_000_000_000) return `milioni ${w(Math.floor(n / 1_000_000))}` + and(n % 1_000_000, w);
  return `bilioni ${w(Math.floor(n / 1_000_000_000))}` + and(n % 1_000_000_000, w);
}

export function amountInWords(v: string | number) {
  const n = Math.abs(Number(v));
  const whole = Math.floor(n);
  const cents = Math.round((n - whole) * 100);
  const s = `Shilingi ${w(whole)}${cents ? ` na senti ${w(cents)}` : ''} tu`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
