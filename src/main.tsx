import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_MSW !== 'true') {
    return;
  }

  const { worker } = await import('./mocks/browser');

  // `worker.start()` returns a Promise that resolves
  // once the Service Worker is up and ready to intercept requests.
  return worker.start({
    onUnhandledRequest: 'bypass',
  });
}

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
  Promise.all([loadDesktopConfig(), enableMocking()])
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
