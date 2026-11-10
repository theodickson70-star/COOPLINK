// Mteja wa API ya CoopLink. Inaongeza token, chama kilichochaguliwa (x-amcos-id)
// na kugeuza makosa ya backend kuwa ujumbe wa Kiswahili unaosomeka.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function store(key: string, value?: string | null) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage haipatikani */
  }
  return null;
}

let token: string | null = store('cl_token');
let amcosId: string | null = store('cl_amcos');

/**
 * Akiba ya majibu ya GET (stale-while-revalidate): ukirudi kwenye ukurasa, data ya mwisho inaonekana papo hapo
 * huku mpya ikipakuliwa nyuma. Inafutwa ukiingia/ukitoka, ukibadili chama, na baada ya kila kuhifadhi (POST/PATCH/DELETE).
 */
export const fetchCache = new Map<string, unknown>();
export const cacheKey = (path: string, query?: Query) => JSON.stringify([token ? token.slice(-12) : '', amcosId, path, query ?? null]);
export function cacheSet(key: string, v: unknown) {
  if (fetchCache.size >= 150) fetchCache.delete(fetchCache.keys().next().value as string);
  fetchCache.delete(key);
  fetchCache.set(key, v);
}

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  store('cl_token', t);
  fetchCache.clear();
}
export const getSelectedAmcos = () => amcosId;
export function setSelectedAmcos(id: string | null) {
  amcosId = id;
  store('cl_amcos', id);
  fetchCache.clear();
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${BASE}/api/v1${path}${qs.toString() ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (amcosId) headers['x-amcos-id'] = amcosId;

  // Kuhifadhi kitu kunaweza kubadilisha kurasa nyingine — akiba yote inafutwa
  if ((opts.method ?? 'GET') !== 'GET') fetchCache.clear();

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Imeshindwa kufikia seva. Angalia mtandao au VITE_API_URL.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    if (res.status === 401 && path !== '/auth/login') {
      setToken(null);
      window.dispatchEvent(new Event('cl:logout'));
    }
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('cl:password-change'));
    // Chama kimefungwa kwa ada ya CoopLink (isipokuwa wakati wa kuingia — ukurasa wa kuingia unaonyesha ujumbe wenyewe)
    if (e.code === 'FEES_LOCKED' && path !== '/auth/login') window.dispatchEvent(new CustomEvent('cl:fees-locked', { detail: e.message }));
    if (e.code === 'MAINTENANCE') window.dispatchEvent(new CustomEvent('cl:maintenance', { detail: e.message }));
    let message: string = e.message ?? `Hitilafu (${res.status})`;
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details) && e.details.length) {
      message = e.details.map((d: { field: string; message: string }) => (d.field ? `${d.field}: ${d.message}` : d.message)).join(' · ');
    }
    throw new ApiError(res.status, e.code ?? 'ERROR', message, e.details);
  }
  return data as T;
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; pages: number };
}

/** Kupakua faili (CSV, JSON export) kwa token; inarudisha faili kwa mtumiaji. */
export async function apiDownload(path: string, opts: { method?: string; body?: unknown; query?: Query; filename: string }) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/v1${path}${qs.toString() ? `?${qs}` : ''}`, {
    method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? `Hitilafu (${res.status})`);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? opts.filename;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Picha inayohitaji token (mf. picha ya mkulima) -> object URL ya kuonyesha kwenye <img>. */
export async function apiBlobUrl(path: string): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (amcosId) headers['x-amcos-id'] = amcosId;
  const res = await fetch(`${BASE}/api/v1${path}`, { headers });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
