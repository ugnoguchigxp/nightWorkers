import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../api/lib/types';
import { errorHandler } from '../api/middleware/error-handler';

const authServiceMocks = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
  authMiddlewareMock: vi.fn(),
}));

vi.mock('../api/services/auth.service', () => ({
  login: authServiceMocks.login,
  logout: authServiceMocks.logout,
  refresh: authServiceMocks.refresh,
  register: authServiceMocks.register,
}));

vi.mock('../api/middleware/auth', () => ({
  authMiddleware: () => {
    return async (c, next) => {
      const mockHandler = authServiceMocks.authMiddlewareMock;
      if (mockHandler.getMockName) {
        // it is a mock
        return mockHandler(c, next);
      }
      await next();
    };
  },
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
    authServiceMocks.authMiddlewareMock.mockImplementation(async (c, next) => {
      await next();
    });
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

  it('register sets httpOnly auth cookies and returns 201 with user payload', async () => {
    authServiceMocks.register.mockResolvedValue({
      accessToken: 'register-access-token',
      refreshToken: 'register-refresh-token',
      user: { id: 'user-2', email: 'registered@example.com' },
    });

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'registered@example.com',
        name: 'Registered User',
        password: 'password123',
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      user: { id: 'user-2', email: 'registered@example.com' },
    });

    const setCookies = readSetCookies(res);
    expect(setCookies.length).toBeGreaterThanOrEqual(2);
    expect(setCookies.some((v) => v.includes('access_token=register-access-token'))).toBe(true);
    expect(setCookies.some((v) => v.includes('refresh_token=register-refresh-token'))).toBe(true);
  });

  it('logout calls logout service and clears cookies', async () => {
    authServiceMocks.logout.mockResolvedValue(undefined);

    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: 'refresh_token=some-refresh-token',
      },
    });

    expect(authServiceMocks.logout).toHaveBeenCalledWith('some-refresh-token');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });

    const setCookies = readSetCookies(res);
    expect(setCookies.some((v) => v.includes('access_token=;'))).toBe(true);
    expect(setCookies.some((v) => v.includes('refresh_token=;'))).toBe(true);
  });

  it('methods returns enabled authentication methods', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/methods', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('authMode');
    expect(body).toHaveProperty('apiAuthRequired');
    expect(body).toHaveProperty('local');
    expect(body).toHaveProperty('oauth');
  });

  it('me returns 200 with current user when authorized', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.use('/api/auth/me', async (c, next) => {
      c.set('user', { userId: 'user-3', email: 'me@example.com' });
      await next();
    });
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/me', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      userId: 'user-3',
      email: 'me@example.com',
    });
  });

  it('me throws 401 when user context is missing', async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.onError(errorHandler);
    app.route('/api/auth', authRouter);

    const res = await app.request('/api/auth/me', {
      method: 'GET',
    });

    expect(res.status).toBe(401);
  });
});
