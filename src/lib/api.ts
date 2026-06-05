import type { AppType } from '@api/app';
import { hc } from 'hono/client';
import { apiPath } from './api-base';

let isRefreshing = false;
let apiAuthRequiredCache: boolean | null = null;
let refreshSubscribers: {
  resolve: () => void;
  reject: (error: Error) => void;
}[] = [];

const onRefreshed = () => {
  refreshSubscribers.forEach(({ resolve }) => {
    resolve();
  });
  refreshSubscribers = [];
};

const onRefreshFailed = (error: Error) => {
  refreshSubscribers.forEach(({ reject }) => {
    reject(error);
  });
  refreshSubscribers = [];
};

const addRefreshSubscriber = (subscriber: {
  resolve: () => void;
  reject: (error: Error) => void;
}) => {
  refreshSubscribers.push(subscriber);
};

const redirectToLoginIfNeeded = () => {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

async function isApiAuthRequired() {
  if (apiAuthRequiredCache !== null) return apiAuthRequiredCache;
  try {
    const res = await fetch(apiPath('/api/auth/methods'), { credentials: 'include' });
    if (!res.ok) {
      apiAuthRequiredCache = false;
      return apiAuthRequiredCache;
    }
    const data = (await res.json()) as { apiAuthRequired?: boolean };
    apiAuthRequiredCache = Boolean(data.apiAuthRequired);
  } catch {
    apiAuthRequiredCache = false;
  }
  return apiAuthRequiredCache;
}

const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const newInit: RequestInit = {
    ...init,
    credentials: 'include',
    headers: {
      ...init?.headers,
    },
  };

  let response = await fetch(input, newInit);

  const urlString = input.toString();
  const isRefreshEndpoint = urlString.includes('/auth/refresh');
  const isLoginEndpoint = urlString.includes('/auth/login');
  const isRegisterEndpoint = urlString.includes('/auth/register');
  const isLogoutEndpoint = urlString.includes('/auth/logout');
  const isMeEndpoint = urlString.includes('/auth/me');
  const isMethodsEndpoint = urlString.includes('/auth/methods');

  if (
    response.status === 401 &&
    !isRefreshEndpoint &&
    !isLoginEndpoint &&
    !isRegisterEndpoint &&
    !isLogoutEndpoint &&
    !isMeEndpoint &&
    !isMethodsEndpoint
  ) {
    if (!(await isApiAuthRequired())) {
      return response;
    }

    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshRes = await fetch(apiPath('/api/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
        });

        if (refreshRes.ok) {
          onRefreshed();
          response = await fetch(input, newInit);
        } else {
          const error = new Error('Failed to refresh session');
          onRefreshFailed(error);
          redirectToLoginIfNeeded();
        }
      } catch (error) {
        onRefreshFailed(error instanceof Error ? error : new Error('Failed to refresh session'));
        redirectToLoginIfNeeded();
      } finally {
        isRefreshing = false;
      }
    } else {
      return new Promise((resolve, reject) => {
        addRefreshSubscriber({
          resolve: () => {
            resolve(fetch(input, newInit));
          },
          reject,
        });
      });
    }
  }

  return response;
};

export const client = hc<AppType>(apiPath('/api'), {
  fetch: customFetch,
});
