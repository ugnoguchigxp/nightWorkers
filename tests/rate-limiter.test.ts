import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimiter } from '../api/middleware/rate-limiter';

describe('rateLimiter', () => {
  it('uses a single global bucket when trustProxy is disabled', async () => {
    const app = new Hono();
    app.use('/limited/*', rateLimiter({ windowMs: 60_000, limit: 1, trustProxy: false }));
    app.get('/limited/ping', (c) => c.json({ ok: true }));

    const first = await app.request('/limited/ping', {
      headers: {
        'user-agent': 'ua-a',
      },
    });
    expect(first.status).toBe(200);

    const second = await app.request('/limited/ping', {
      headers: {
        'user-agent': 'ua-b',
      },
    });
    expect(second.status).toBe(429);
  });

  it('separates buckets by forwarded client IP when trustProxy is enabled', async () => {
    const app = new Hono();
    app.use('/limited/*', rateLimiter({ windowMs: 60_000, limit: 1, trustProxy: true }));
    app.get('/limited/ping', (c) => c.json({ ok: true }));

    const first = await app.request('/limited/ping', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });
    expect(first.status).toBe(200);

    const second = await app.request('/limited/ping', {
      headers: {
        'x-forwarded-for': '198.51.100.25',
      },
    });
    expect(second.status).toBe(200);
  });
});
