import { createMiddleware } from 'hono/factory';
import { logger as globalLogger, logHttpEvent } from '../lib/logger';
import type { AppEnv } from '../lib/types';

export const loggerMiddleware = () => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('logger', globalLogger.child({ requestId }));
    c.header('X-Request-Id', requestId);

    const start = Date.now();

    await next();

    const ms = Date.now() - start;
    const method = c.req.method.toUpperCase();
    const isGet = method === 'GET';
    const isError = c.res.status >= 400;
    const shouldLog = isError || !isGet;

    if (!shouldLog) return;

    logHttpEvent({
      channel: 'api',
      method,
      path: c.req.path,
      level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
      message: 'request completed',
      meta: { requestId, status: c.res.status, durationMs: ms },
    });
  });
};
