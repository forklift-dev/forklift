import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { stateReady } from './state';
import { installCodicons } from './icons';
import './styles.css';

installCodicons();
await stateReady;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
