import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => {
  const childLogger = {};
  const logHttpEvent = vi.fn();

  return {
    childLogger,
    logHttpEvent,
    logger: {
      child: vi.fn(() => childLogger),
    },
  };
});

vi.mock('../api/lib/logger', () => ({
  logger: loggerMocks.logger,
  logHttpEvent: loggerMocks.logHttpEvent,
}));

import { loggerMiddleware } from '../api/middleware/logger';

describe('loggerMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('request-id-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs method and path without query parameters on error response', async () => {
    const middleware = loggerMiddleware();
    const c = {
      req: {
        method: 'GET',
        url: 'http://localhost/api/auth/oauth/google/callback?code=secret-code&state=secret-state',
        path: '/api/auth/oauth/google/callback',
      },
      res: {
        status: 500,
      },
      set: vi.fn(),
      header: vi.fn(),
    };

    await middleware(c as never, async () => {});

    expect(loggerMocks.logger.child).toHaveBeenCalledWith({ requestId: 'request-id-1' });

    const httpLogCall = loggerMocks.logHttpEvent.mock.calls[0];
    expect(httpLogCall?.[0]).toMatchObject({
      channel: 'api',
      method: 'GET',
      path: '/api/auth/oauth/google/callback',
      message: 'request completed',
    });
    expect(JSON.stringify(httpLogCall?.[0])).not.toContain('secret-code');
    expect(JSON.stringify(httpLogCall?.[0])).not.toContain('secret-state');
  });
});
