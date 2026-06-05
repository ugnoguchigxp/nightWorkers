type DesktopConfig = {
  apiOrigin?: string;
};

declare global {
  interface Window {
    __NIGHTWORKERS_DESKTOP_CONFIG__?: DesktopConfig;
  }
}

function normalizeApiPath(path: string): string {
  if (path.startsWith('/')) return path;
  return `/${path}`;
}

export function getApiOrigin(): string | null {
  if (typeof window !== 'undefined') {
    const desktopOrigin = window.__NIGHTWORKERS_DESKTOP_CONFIG__?.apiOrigin?.trim();
    if (desktopOrigin) return desktopOrigin.replace(/\/+$/, '');
  }

  const envOrigin = import.meta.env.VITE_NIGHTWORKERS_API_ORIGIN as string | undefined;
  if (envOrigin?.trim()) return envOrigin.trim().replace(/\/+$/, '');

  return null;
}

export function apiPath(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  const origin = getApiOrigin();
  if (!origin) return normalizedPath;
  return `${origin}${normalizedPath}`;
}

export function wsPath(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  const configuredUrl = import.meta.env.VITE_NIGHTWORKERS_WS_URL as string | undefined;
  if (configuredUrl?.trim()) return configuredUrl.trim();

  const origin = getApiOrigin();
  if (origin) {
    const url = new URL(origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = normalizedPath;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalizedPath}`;
}

export function devWsFallbackPath(path: string): string | null {
  if (!import.meta.env.DEV || getApiOrigin()) return null;
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return null;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//localhost:39173${normalizeApiPath(path)}`;
}

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(input), init);
}
