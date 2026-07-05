import { isKnownWorkbenchPath } from './workbench-route-state';

export const LAST_WORKBENCH_ROUTE_STORAGE_KEY = 'nightworkers:last-workbench-route:v1';

export function sanitizeStoredWorkbenchRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, 'http://nightworkers.local');
  } catch {
    return null;
  }
  if (parsed.origin !== 'http://nightworkers.local') return null;
  if (!isKnownWorkbenchPath(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export function readLastWorkbenchRoute(storage: Storage | null = browserStorage()) {
  if (!storage) return null;
  try {
    return sanitizeStoredWorkbenchRoute(storage.getItem(LAST_WORKBENCH_ROUTE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeLastWorkbenchRoute(route: string, storage: Storage | null = browserStorage()) {
  if (!storage) return;
  const sanitized = sanitizeStoredWorkbenchRoute(route);
  if (!sanitized) return;
  try {
    storage.setItem(LAST_WORKBENCH_ROUTE_STORAGE_KEY, sanitized);
  } catch {
    // localStorage is best-effort; explicit URLs remain the source of truth.
  }
}

function browserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}
