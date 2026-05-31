import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../api/lib/types';
import { errorHandler } from '../api/middleware/error-handler';

const authServiceMocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
}));

vi.mock('../api/services/auth.service', () => ({
  login: authServiceMocks.login,
  logout: authServiceMocks.logout,
  refresh: authServiceMocks.refresh,
  register: authServiceMocks.register,
}));

import { authRouter } from '../api/routes/auth';

const readSetCookies = (res: Response): string[] => {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.();
  if (values && values.length > 0) return values;

  const fallback = res.headers.get('set-cookie');
  return fallback ? [fallback] : [];
};

describe('auth routes cookie flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login sets httpOnly auth cookies and returns user payload', async () => {
    authServiceMocks.login.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'user@example.com' },
    });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: { id: 'user-1', email: 'user@example.com' },
    });

    const setCookies = readSetCookies(res);
    expect(setCookies.length).toBeGreaterThanOrEqual(2);
    expect(setCookies.some((v) => v.includes('access_token=access-token'))).toBe(true);
    expect(setCookies.some((v) => v.includes('refresh_token=refresh-token'))).toBe(true);
    expect(setCookies.every((v) => v.toLowerCase().includes('httponly'))).toBe(true);
  });

  it('refresh fails with 401 when refresh cookie is missing', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'UNAUTHORIZED',
      },
    });
  });

  it('refresh uses refresh cookie and rotates auth cookies', async () => {
    authServiceMocks.refresh.mockResolvedValue({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
      user: { id: 'user-1', email: 'user@example.com' },
    });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: {
        Cookie: 'refresh_token=old-refresh-token',
      },
    });

    expect(authServiceMocks.refresh).toHaveBeenCalledWith('old-refresh-token');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: { id: 'user-1', email: 'user@example.com' },
    });

    const setCookies = readSetCookies(res);
    expect(setCookies.some((v) => v.includes('access_token=rotated-access'))).toBe(true);
    expect(setCookies.some((v) => v.includes('refresh_token=rotated-refresh'))).toBe(true);
  });
});
