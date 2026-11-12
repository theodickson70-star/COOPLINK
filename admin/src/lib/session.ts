// Hali ndogo za kikao kwenye kivinjari hiki (tovuti imeonekana, shughuli ya mwisho, skrini imefungwa)
const get = (s: Storage | undefined, k: string) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const put = (s: Storage | undefined, k: string, v: string) => { try { s?.setItem(k, v); } catch { /* hakuna storage */ } };
const ls = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const ss = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

export const K_ACT = 'cl_last_active';
export const K_LOCK = 'cl_locked';
export const lsGet = (k: string) => get(ls(), k);
export const lsPut = (k: string, v: string) => put(ls(), k, v);

/** Mtumiaji ameingia / amefungua skrini: anaanza akiwa hai */
export function markActive() { lsPut(K_ACT, String(Date.now())); lsPut(K_LOCK, '0'); }

/** Tovuti ya COOPLINK inaonekana mara moja kila mtu anapofungua mfumo (kila kikao cha kivinjari) */
export const siteSeen = () => get(ss(), 'cl_site_seen') === '1';
export const markSiteSeen = () => put(ss(), 'cl_site_seen', '1');
