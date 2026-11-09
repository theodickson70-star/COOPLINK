import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
