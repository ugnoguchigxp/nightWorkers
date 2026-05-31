import { describe, expect, it } from 'vitest';
import app from '../api/app';
import { generateAccessToken } from '../api/services/token.service';

describe('Auth Middleware & Protected Routes', () => {
  it('should expose enabled auth methods', async () => {
    const res = await app.request('/api/auth/methods');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toMatchObject({
      authMode: expect.stringMatching(/^(local|oauth|both)$/),
      local: expect.any(Boolean),
      oauth: {
        enabled: expect.any(Boolean),
        providers: {
          google: expect.any(Boolean),
          github: expect.any(Boolean),
        },
      },
    });
  });

  it('should return 401 Unauthorized when Authorization header is missing', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 401 Unauthorized when token is invalid', async () => {
    const res = await app.request('/api/auth/me', {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });
    expect(res.status).toBe(401);
  });

  it('should return 200 OK when valid token is provided', async () => {
    // Generate a valid token for testing
    // Note: This doesn't require a real DB for basic token validation in authMiddleware
    const testPayload = {
      userId: 'test-uuid',
      email: 'test@example.com',
    };
    const token = await generateAccessToken(testPayload);

    const res = await app.request('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.userId).toBe(testPayload.userId);
    expect(data.email).toBe(testPayload.email);
    expect(data.type).toBeUndefined();
  });

  it('should return unified validation error payload for invalid login body', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'invalid-email' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});
