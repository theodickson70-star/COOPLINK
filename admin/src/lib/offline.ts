// =====================================================================
//  KAZI NJE YA MTANDAO (v2.9) — upande wa kivinjari
//   - Kifurushi cha data (wakulima, pembejeo, bei, salio, vijiji) kinahifadhiwa kwenye IndexedDB ya kifaa
//   - Foleni: ugawaji wa pembejeo na usajili wa wakulima vilivyofanyika bila mtandao
//   - Mtandao ukirudi: vinatumwa kwa njia za kawaida (server inakagua kila kitu) kwa `clientRef` -> havirudiwi
//  Data inafungwa kwa mtumiaji na chama (mtumiaji mwingine kwenye kifaa hicho haoni foleni ya mwenzake).
// =====================================================================
import { useSyncExternalStore } from 'react';
import { api, ApiError, getSelectedAmcos, getToken } from './api';

export interface PackMember { id: string; memberNo: string; name: string; village: string | null; phoneEnd: string | null }
export interface PackItem { id: string; name: string; unit: string; category: string; packKg: string | null; looseKg: boolean; price: string | null; priceUsd: string | null; balance: string }
export interface Pack {
  at: string; amcos: { id: string; name: string; code: string }; season: { id: string; name: string };
  can: { issue: boolean; register: boolean; approveMembers: boolean }; usdMode: boolean; rate: string | null;
  members: PackMember[]; truncated: boolean; items: PackItem[]; villages: string[];
}
export type QKind = 'ISSUE' | 'MEMBER';
export type QStatus = 'PENDING' | 'SYNCING' | 'DONE' | 'ERROR' | 'NEEDS_OTP';
export interface QItem {
  ref: string; kind: QKind; label: string; sub?: string; payload: Record<string, unknown>; createdAt: string;
  status: QStatus; error?: string | null; result?: { id: string; no?: string } | null; tries: number; syncedAt?: string | null;
}

// ------------------------------ IndexedDB (ndogo) ------------------------------
const DB = 'cooplink-offline', STORE = 'kv';
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
}
async function kvGet<T>(k: string): Promise<T | undefined> {
  const d = await idb();
  return new Promise((ok, bad) => { const r = d.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => ok(r.result as T); r.onerror = () => bad(r.error); });
}
async function kvSet(k: string, v: unknown) {
  const d = await idb();
  return new Promise<void>((ok, bad) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = () => ok(); t.onerror = () => bad(t.error); });
}

/** Ufunguo wa mtumiaji + chama (kutoka token: sehemu ya mwisho tu, si token nzima) */
let owner = '';
export function setOfflineOwner(userId: string | null, amcosId: string | null) {
  owner = userId ? `${userId}:${getSelectedAmcos() ?? amcosId ?? ''}` : '';
  void loadQueue();
}
const K = (x: string) => `${owner}:${x}`;

// ------------------------------ hali (store ndogo) ------------------------------
type State = { online: boolean; queue: QItem[]; pack: Pack | null; syncing: boolean; lastSync: string | null };
let state: State = { online: typeof navigator === 'undefined' ? true : navigator.onLine, queue: [], pack: null, syncing: false, lastSync: null };
const subs = new Set<() => void>();
const emit = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useOffline = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state);

async function saveQueue(q: QItem[]) { emit({ queue: q }); if (owner) await kvSet(K('queue'), q).catch(() => {}); }
async function loadQueue() {
  if (!owner) { emit({ queue: [], pack: null }); return; }
  const [q, p] = await Promise.all([kvGet<QItem[]>(K('queue')).catch(() => undefined), kvGet<Pack>(K('pack')).catch(() => undefined)]);
  // Kilichokuwa kikitumwa kifaa kikizimwa -> kirudi foleni (clientRef inazuia nakala mbili)
  emit({ queue: (q ?? []).map((x) => (x.status === 'SYNCING' ? { ...x, status: 'PENDING' } : x)), pack: p ?? null });
}

export const newRef = () => `off-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;

export async function enqueueOffline(item: Omit<QItem, 'status' | 'tries' | 'createdAt' | 'ref'> & { ref?: string }) {
  const q: QItem = { ...item, ref: item.ref ?? newRef(), status: 'PENDING', tries: 0, createdAt: new Date().toISOString() };
  await saveQueue([q, ...state.queue]);
  if (state.online) void syncNow();
  return q;
}
export async function removeQueued(ref: string) { await saveQueue(state.queue.filter((x) => x.ref !== ref)); }
export async function updateQueued(ref: string, p: Partial<QItem>) { await saveQueue(state.queue.map((x) => (x.ref === ref ? { ...x, ...p } : x))); }

// ------------------------------ kifurushi ------------------------------
export async function refreshPack() {
  const p = await api<Pack>('/offline/pack');
  emit({ pack: p });
  if (owner) await kvSet(K('pack'), p).catch(() => {});
  return p;
}

// ------------------------------ kutuma ------------------------------
const isNetwork = (e: unknown) => e instanceof ApiError && (e.code === 'NETWORK' || e.status === 0 || e.status >= 502);
export async function syncOne(x: QItem): Promise<QItem> {
  try {
    if (x.kind === 'ISSUE') {
      const r = await api<{ issue: { id: string; issueNo?: string } }>('/input-issues', { method: 'POST', body: { ...x.payload, clientRef: x.ref } });
      return { ...x, status: 'DONE', error: null, result: { id: r.issue.id, no: r.issue.issueNo }, syncedAt: new Date().toISOString() };
    }
    const r = await api<{ member: { id: string; memberNo: string } }>('/members', { method: 'POST', body: { ...x.payload, clientRef: x.ref } });
    return { ...x, status: 'DONE', error: null, result: { id: r.member.id, no: r.member.memberNo }, syncedAt: new Date().toISOString() };
  } catch (e) {
    if (isNetwork(e)) return { ...x, status: 'PENDING', tries: x.tries + 1 };
    const err = e as ApiError;
    if (err.code === 'PHONE_OTP_REQUIRED') return { ...x, status: 'NEEDS_OTP', error: err.message, tries: x.tries + 1 };
    return { ...x, status: 'ERROR', error: err.message, tries: x.tries + 1 };
  }
}
let running: Promise<void> | null = null;
export function syncNow(opts: { includeErrors?: boolean } = {}) {
  if (running) return running;
  running = (async () => {
    if (!getToken() || !owner) return;
    emit({ syncing: true });
    try {
      for (const x of [...state.queue].reverse()) { // za zamani kwanza
        if (!(x.status === 'PENDING' || (opts.includeErrors && x.status === 'ERROR'))) continue;
        await updateQueued(x.ref, { status: 'SYNCING' });
        const done = await syncOne(x);
        await updateQueued(x.ref, done);
        if (done.status === 'PENDING') break; // mtandao umekatika tena
      }
      // zilizokamilika zaidi ya siku 7 zinaondolewa kwenye orodha
      const week = Date.now() - 7 * 86_400_000;
      await saveQueue(state.queue.filter((x) => !(x.status === 'DONE' && x.syncedAt && new Date(x.syncedAt).getTime() < week)));
      emit({ lastSync: new Date().toISOString() });
      if (state.online) await refreshPack().catch(() => {});
    } finally {
      emit({ syncing: false });
      running = null;
    }
  })();
  return running;
}

/** Inaanzishwa mara moja (App): kufuatilia mtandao, kutuma foleni, na kusasisha kifurushi */
let started = false;
export function startOffline() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => { emit({ online: true }); void syncNow(); });
  window.addEventListener('offline', () => emit({ online: false }));
  setInterval(() => {
    if (!navigator.onLine) return;
    if (state.queue.some((x) => x.status === 'PENDING')) void syncNow();
    else if (owner && (!state.pack || Date.now() - new Date(state.pack.at).getTime() > 30 * 60_000)) void refreshPack().catch(() => {});
  }, 60_000);
}

/** Huduma ya kivinjari (service worker): app inafunguka hata bila mtandao */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
