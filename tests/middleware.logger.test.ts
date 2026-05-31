import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => {
  const childLogger = {
    info: vi.fn(),
  };

  return {
    childLogger,
    logger: {
      child: vi.fn(() => childLogger),
    },
  };
});

vi.mock('../api/lib/logger', () => ({
  logger: loggerMocks.logger,
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

  it('logs method and path without query parameters', async () => {
    const middleware = loggerMiddleware();
    const c = {
      req: {
        method: 'GET',
        url: 'http://localhost/api/auth/oauth/google/callback?code=secret-code&state=secret-state',
        path: '/api/auth/oauth/google/callback',
      },
      res: {
        status: 200,
      },
      set: vi.fn(),
      header: vi.fn(),
    };

    await middleware(c as never, async () => {});

    expect(loggerMocks.logger.child).toHaveBeenCalledWith({ requestId: 'request-id-1' });

    const startCall = loggerMocks.childLogger.info.mock.calls[0];
    expect(startCall?.[0]).toEqual({
      method: 'GET',
      path: '/api/auth/oauth/google/callback',
    });
    expect(JSON.stringify(startCall?.[0])).not.toContain('secret-code');
    expect(JSON.stringify(startCall?.[0])).not.toContain('secret-state');
  });
});
