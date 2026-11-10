import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Fonti zinatoka kwenye seva yetu (si Google): hakuna kusubiri seva nyingine, na zinahifadhiwa kwenye kivinjari
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/outfit/800.css';
import './styles.css';
import { applyLang, applyTheme, initialLang, initialTheme } from './lib/prefs';

// Mwonekano na lugha vinawekwa kabla ya kuchora, ili ukurasa usimweke mwanga kwanza
applyTheme(initialTheme());
applyLang(initialLang());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
