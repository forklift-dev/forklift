import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { stateReady } from './state';
import { installCodicons } from './icons';
import { startThemes } from './theme';
import { startLanguage } from './i18n';
import './styles.css';

installCodicons();
await stateReady;
startThemes();
// Before the first render, and subscribed before any component: a change of language is applied before they re-render.
startLanguage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
