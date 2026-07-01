import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

async function loadDesktopConfig() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    window.__NIGHTWORKERS_DESKTOP_CONFIG__ = await invoke('get_desktop_config');
  } catch (err) {
    console.warn('Tauri desktop config unavailable, continuing with browser API defaults.', err);
  }
}

const rootElement = document.getElementById('root');
if (rootElement && !rootElement.innerHTML) {
  loadDesktopConfig()
    .catch((err) => {
      console.warn('App bootstrap warning, continuing with defaults.', err);
    })
    .finally(() => {
      const root = createRoot(rootElement);
      root.render(
        <StrictMode>
          <App />
        </StrictMode>
      );
    });
}
