import { OpenAPIHono } from '@hono/zod-openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../api/lib/types';

const dbMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  run: vi.fn(),
}));

vi.mock('../api/db/client', () => ({
  db: {
    execute: dbMocks.execute,
    run: dbMocks.run,
  },
}));

import { healthRouter } from '../api/routes/health';

const createApp = () => {
  const app = new OpenAPIHono<AppEnv>();
  app.route('/api/health', healthRouter);
  return app;
};

describe('Health Check Endpoints', () => {
  beforeEach(() => {
    dbMocks.execute.mockReset();
    dbMocks.run.mockReset();
  });

  it('GET /api/health/live returns 200 and does not require DB', async () => {
    const app = createApp();
    const res = await app.request('/api/health/live');

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('alive');
    expect(data.version).toBeDefined();
    expect(data.timestamp).toBeDefined();
    expect(dbMocks.run).not.toHaveBeenCalled();
  });

  it('GET /api/health/ready returns 200 when DB is reachable', async () => {
    dbMocks.run.mockResolvedValueOnce({ rowsAffected: 0 } as any);
    const app = createApp();
    const res = await app.request('/api/health/ready');

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.database).toBe('connected');
  });

  it('GET /api/health/ready returns 503 when DB is unreachable', async () => {
    dbMocks.run.mockRejectedValueOnce(new Error('db down'));
    const app = createApp();
    const res = await app.request('/api/health/ready');

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('degraded');
    expect(data.database).toBe('disconnected');
  });

  it('GET /api/health (legacy) behaves as readiness endpoint', async () => {
    dbMocks.run.mockResolvedValueOnce({ rowsAffected: 0 } as any);
    const app = createApp();
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.database).toBe('connected');
  });
});
