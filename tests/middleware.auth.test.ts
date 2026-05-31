import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../api/lib/errors';

const verifyAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../api/services/token.service', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

import { authMiddleware } from '../api/middleware/auth';

describe('authMiddleware', () => {
  beforeEach(() => {
    verifyAccessTokenMock.mockReset();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = new Hono();
    app.use('/protected/*', authMiddleware());
    app.onError((err, c) => {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.statusCode as 401);
      }
      return c.json({ error: 'unexpected' }, 500);
    });
    app.get('/protected/me', (c) => c.json({ ok: true }));

    const res = await app.request('/protected/me');
    expect(res.status).toBe(401);
  });

  it('sets user payload on context when token is valid', async () => {
    verifyAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'access',
    });

    const app = new Hono();
    app.use('/protected/*', authMiddleware());
    app.get('/protected/me', (c) => c.json(c.get('user')));

    const res = await app.request('/protected/me', {
      headers: {
        Authorization: 'Bearer valid-token',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      userId: 'user-1',
      email: 'user@example.com',
      type: 'access',
    });
  });

  it('accepts access token from cookie when Authorization header is absent', async () => {
    verifyAccessTokenMock.mockResolvedValue({
      userId: 'cookie-user',
      email: 'cookie@example.com',
      type: 'access',
    });

    const app = new Hono();
    app.use('/protected/*', authMiddleware());
    app.get('/protected/me', (c) => c.json(c.get('user')));

    const res = await app.request('/protected/me', {
      headers: {
        Cookie: 'access_token=cookie-token',
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      userId: 'cookie-user',
      email: 'cookie@example.com',
      type: 'access',
    });
  });

  it('returns 401 when token verification fails', async () => {
    verifyAccessTokenMock.mockRejectedValue(new Error('invalid'));

    const app = new Hono();
    app.use('/protected/*', authMiddleware());
    app.onError((err, c) => {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.statusCode as 401);
      }
      return c.json({ error: 'unexpected' }, 500);
    });
    app.get('/protected/me', (c) => c.json({ ok: true }));

    const res = await app.request('/protected/me', {
      headers: {
        Authorization: 'Bearer bad-token',
      },
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid or expired token',
    });
  });
});
