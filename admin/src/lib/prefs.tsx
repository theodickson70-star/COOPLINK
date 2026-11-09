// =====================================================================
//  MAPENDELEO YA MTUMIAJI: Mwanga/Giza na Lugha (Kiswahili / English)
//  - Maandishi yameandikwa kwa Kiswahili kwenye code; t('…') inayatafsiri kwa Kiingereza
//    kama lugha ni EN na tafsiri ipo kwenye kamusi (lib/i18n-en.ts). Isipokuwepo, Kiswahili kinabaki.
//  - Mapendeleo yanahifadhiwa kwenye kivinjari (localStorage) — ni ya mtumiaji huyu tu.
// =====================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EN, EN_PATTERNS } from './i18n-en';

export type Lang = 'sw' | 'en';
export type Theme = 'light' | 'dark';

function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* hakuna storage */ } }

export const initialTheme = (): Theme => (read('cl_theme') === 'dark' ? 'dark' : 'light');
export const initialLang = (): Lang => (read('cl_lang') === 'en' ? 'en' : 'sw');
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0A1511' : '#0B2F23');
}
export function applyLang(l: Lang) { document.documentElement.lang = l; }

let currentLang: Lang = initialLang();
/** Tafsiri nje ya React (mf. kwenye api.ts) */
export function tr(sw: string, vars?: Record<string, string | number>) {
  let s = sw;
  if (currentLang === 'en' && sw) {
    const hit = EN[sw];
    if (hit !== undefined) s = hit;
    else for (const [re, en] of EN_PATTERNS) if (re.test(sw)) { s = sw.replace(re, en); break; }
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
export const getLang = () => currentLang;

interface Prefs { lang: Lang; theme: Theme; setLang: (l: Lang) => void; setTheme: (t: Theme) => void; t: typeof tr }
const Ctx = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { currentLang = lang; applyLang(lang); }, [lang]);
  const setLang = useCallback((l: Lang) => { currentLang = l; write('cl_lang', l); setLangState(l); }, []);
  const setTheme = useCallback((t: Theme) => { write('cl_theme', t); setThemeState(t); }, []);
  // t inategemea lang ili kurasa zichore upya lugha ikibadilika
  const t = useCallback((sw: string, vars?: Record<string, string | number>) => { void lang; return tr(sw, vars); }, [lang]);
  const v = useMemo(() => ({ lang, theme, setLang, setTheme, t }), [lang, theme, setLang, setTheme, t]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const c = useContext(Ctx);
  if (!c) return { lang: 'sw' as Lang, theme: 'light' as Theme, setLang: () => {}, setTheme: () => {}, t: tr };
  return c;
}
export const useT = () => usePrefs().t;

const SUN = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>;
const MOON = <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />;
const ic = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

/** Vitufe viwili: Mwanga/Giza na SW/EN */
export function PrefSwitches({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, theme, setTheme, t } = usePrefs();
  return (
    <>
      <div className="pref-switch" role="group" aria-label={t('Mwonekano')}>
        <button type="button" className={theme === 'light' ? 'on' : ''} aria-pressed={theme === 'light'} title={t('Mwanga')} onClick={() => setTheme('light')}>{ic(SUN)}{!compact && <span className="hide-sm">{t('Mwanga')}</span>}</button>
        <button type="button" className={theme === 'dark' ? 'on' : ''} aria-pressed={theme === 'dark'} title={t('Giza')} onClick={() => setTheme('dark')}>{ic(MOON)}{!compact && <span className="hide-sm">{t('Giza')}</span>}</button>
      </div>
      <div className="pref-switch" role="group" aria-label={t('Lugha')}>
        <button type="button" className={lang === 'sw' ? 'on' : ''} aria-pressed={lang === 'sw'} title="Kiswahili" onClick={() => setLang('sw')}>SW</button>
        <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} title="English" onClick={() => setLang('en')}>EN</button>
      </div>
    </>
  );
}
