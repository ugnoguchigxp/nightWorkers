import { createMiddleware } from 'hono/factory';
import { logger as globalLogger } from '../lib/logger';
import type { AppEnv } from '../lib/types';

export const loggerMiddleware = () => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    const logger = globalLogger.child({ requestId });
    c.set('logger', logger);
    c.header('X-Request-Id', requestId);

    const start = Date.now();
    logger.info({ method: c.req.method, path: c.req.path }, 'Request started');

    await next();

    const ms = Date.now() - start;
    logger.info(
      {
        status: c.res.status,
        durationMs: ms,
      },
      'Request completed'
    );
  });
};
