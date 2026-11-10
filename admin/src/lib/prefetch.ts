// Kurasa zinazopakuliwa kimya kimya baada ya kuingia (zimesajiliwa na App.tsx)
export const PAGE_LOADERS: (() => Promise<unknown>)[] = [];
let prefetched = false;
export function prefetchPages() {
  if (prefetched) return;
  prefetched = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return; // usile bando la mtumiaji
  const idle = (cb: () => void) => ((window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300)))(cb);
  let i = 0;
  const next = () => { if (i < PAGE_LOADERS.length) PAGE_LOADERS[i++]().catch(() => {}).finally(() => idle(next)); };
  setTimeout(() => idle(next), 1500);
}
