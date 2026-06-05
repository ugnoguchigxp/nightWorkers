import crypto from 'node:crypto';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import { z } from 'zod';
import { config } from './config';
import { isPublicApiPath } from './lib/api-auth-boundary';
import { logEvent, logHttpEvent } from './lib/logger';
import { createOpenApiRouter } from './lib/openapi';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';
import { loggerMiddleware } from './middleware/logger';
import { rateLimiter } from './middleware/rate-limiter';
import { bbsRouter } from './modules/bbs/bbs.routes';
import { nightworkersRouter } from './modules/nightworkers/nightworkers.routes';
import * as nightworkersService from './modules/nightworkers/nightworkers.service';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { oauthRouter } from './routes/oauth';
import { settingsRouter } from './routes/settings';
import { getResourceRoot } from './runtime/paths';
import { nightWorkersRealtimeBroker } from './services/realtime/nightworkers-ws';

const apiRoutes = createOpenApiRouter()
  .route('/health', healthRouter)
  .route('/auth/oauth', oauthRouter)
  .route('/auth', authRouter)
  .route('/bbs', bbsRouter)
  .route('/settings', settingsRouter)
  .route('/', nightworkersRouter);

const app = createOpenApiRouter();
const isProduction = config.NODE_ENV === 'production';
const isE2e = process.env.NIGHTWORKERS_E2E === '1';
const apiRateLimit = isE2e ? 10_000 : isProduction ? 100 : 1_000;
const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: apiRateLimit,
  trustProxy: config.TRUST_PROXY,
});
const wsLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: isE2e ? 10_000 : 120,
  trustProxy: config.TRUST_PROXY,
});
const connectSrcOrigins = [
  ...config.CORS_ORIGINS,
  ...config.CORS_ORIGINS.flatMap((origin) => {
    if (origin.startsWith('https://')) return [`wss://${origin.slice('https://'.length)}`];
    if (origin.startsWith('http://')) return [`ws://${origin.slice('http://'.length)}`];
    return [];
  }),
  ...(isProduction && config.NIGHTWORKERS_DESKTOP
    ? ['asset:', 'tauri:', 'http://tauri.localhost']
    : []),
  ...(isProduction ? [] : ['ws:', 'wss:']),
];
export const nodeWebSocket = createNodeWebSocket({ app });
const { upgradeWebSocket } = nodeWebSocket;
const requireApiAuth = authMiddleware();

const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe_task'),
    taskId: z.string().uuid(),
    runId: z.string().uuid().optional(),
    afterSeq: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('unsubscribe_task'), taskId: z.string().uuid() }),
  z.object({
    type: z.literal('chat_submit'),
    taskId: z.string().uuid(),
    prompt: z.string().min(1),
  }),
]);

// Middleware
app.use('*', timing());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (origin && config.CORS_ORIGINS.includes(origin)) return origin;
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...connectSrcOrigins],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  })
);

app.use('*', loggerMiddleware());
app.onError(errorHandler);

app.use('/api/ws/nightworkers', async (c, next) => {
  if (!isProduction && c.req.header('x-nightworkers-e2e') === '1') {
    return next();
  }
  return wsLimiter(c, next);
});
app.use('/api/*', async (c, next) => {
  if (!isProduction && c.req.header('x-nightworkers-e2e') === '1') {
    return next();
  }
  if (c.req.path === '/api/ws/nightworkers') {
    return next();
  }
  return apiLimiter(c, next);
});
app.use(
  '/api/auth/login',
  rateLimiter({ windowMs: 60 * 1000, limit: 5, trustProxy: config.TRUST_PROXY })
);
app.use(
  '/api/auth/register',
  rateLimiter({ windowMs: 60 * 1000, limit: 5, trustProxy: config.TRUST_PROXY })
);

app.use(
  '/api/*',
  csrf({
    origin: config.CORS_ORIGINS,
  })
);

app.use('/api/*', async (c, next) => {
  if (!config.API_AUTH_REQUIRED || isPublicApiPath(c.req.path)) {
    return next();
  }
  if (!isProduction && c.req.header('x-nightworkers-e2e') === '1') {
    return next();
  }
  return requireApiAuth(c, next);
});

// Documentation
app.doc('/api/doc', {
  openapi: '3.0.0',
  info: {
    title: 'NightWorkers API',
    version: '1.0.0',
  },
});

app.get(
  '/api/ui',
  async (c, next) => {
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
    await next();
  },
  swaggerUI({ url: '/api/doc' })
);

// Routes
app.route('/api', apiRoutes);

app.get(
  '/api/ws/nightworkers',
  upgradeWebSocket((c) => {
    const requestId = crypto.randomUUID();
    logHttpEvent({
      channel: 'ws',
      method: 'GET',
      path: '/api/ws/nightworkers',
      level: 'info',
      message: 'upgrade requested',
      meta: { requestId, ip: c.req.header('x-forwarded-for') || 'unknown' },
    });
    return {
      onOpen(_event, ws) {
        logEvent({
          channel: 'ws',
          level: 'info',
          message: 'connection opened',
          meta: { requestId },
        });
        ws.send(
          JSON.stringify({
            type: 'connected',
            timestamp: new Date().toISOString(),
          })
        );
      },
      onMessage(event, ws) {
        void (async () => {
          try {
            const raw = String(event.data);
            logEvent({
              channel: 'ws',
              level: 'debug',
              message: 'message received',
              meta: { requestId, rawLength: raw.length, rawPreview: raw.slice(0, 240) },
            });
            const parsed = wsClientMessageSchema.parse(JSON.parse(raw));
            logEvent({
              channel: 'ws',
              level: 'info',
              message: 'message parsed',
              meta: { requestId, type: parsed.type, taskId: parsed.taskId },
            });
            if (parsed.type === 'subscribe_task') {
              if (!ws.raw) return;
              const replayEvents = parsed.runId
                ? await nightworkersService.listTaskRunEventsForReplay({
                    taskId: parsed.taskId,
                    runId: parsed.runId,
                    afterSeq: parsed.afterSeq,
                  })
                : [];
              nightWorkersRealtimeBroker.subscribe(parsed.taskId, ws.raw);
              ws.send(
                JSON.stringify({
                  type: 'subscribed',
                  taskId: parsed.taskId,
                  runId: parsed.runId,
                  afterSeq: parsed.afterSeq,
                  timestamp: new Date().toISOString(),
                })
              );
              if (parsed.runId) {
                for (const replayEvent of replayEvents) {
                  ws.send(
                    JSON.stringify({
                      type: 'task_event_created',
                      taskId: parsed.taskId,
                      runId: parsed.runId,
                      seq: replayEvent.seq,
                      event: replayEvent,
                      timestamp: new Date().toISOString(),
                      replayed: true,
                    })
                  );
                }
                logEvent({
                  channel: 'ws',
                  level: 'debug',
                  message: 'replayed persisted run events',
                  meta: {
                    requestId,
                    taskId: parsed.taskId,
                    runId: parsed.runId,
                    afterSeq: parsed.afterSeq,
                    replayed: replayEvents.length,
                  },
                });
              }
              nightWorkersRealtimeBroker.replayRecent(parsed.taskId, ws.raw);
            } else if (parsed.type === 'unsubscribe_task') {
              if (!ws.raw) return;
              nightWorkersRealtimeBroker.unsubscribe(parsed.taskId, ws.raw);
            } else if (parsed.type === 'chat_submit') {
              logEvent({
                channel: 'ws',
                level: 'info',
                message: 'chat_submit accepted',
                meta: { requestId, taskId: parsed.taskId, promptLength: parsed.prompt.length },
              });
              const recovered = await nightworkersService.recoverStaleActiveRuns(parsed.taskId);
              if (recovered.recoveredRunIds.length > 0) {
                logEvent({
                  channel: 'ws',
                  level: 'info',
                  message: 'stale active runs recovered',
                  meta: {
                    requestId,
                    taskId: parsed.taskId,
                    recoveredRunIds: recovered.recoveredRunIds,
                  },
                });
              }
              if (recovered.hasRunning) {
                const activeRun = await nightworkersService.getActiveTaskRun(parsed.taskId);
                const activeRunId = activeRun?.id || null;
                logEvent({
                  channel: 'ws',
                  level: 'info',
                  message: 'chat_submit rejected: active run exists',
                  meta: { requestId, taskId: parsed.taskId, runId: activeRunId },
                });
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    code: 'RUN_ALREADY_ACTIVE',
                    message: '現在このタスクは実行中です。完了後に再送してください。',
                    timestamp: new Date().toISOString(),
                  })
                );
                return;
              }

              await nightworkersService.appendTaskMessage(parsed.taskId, parsed.prompt);
              const run = await nightworkersService.startTaskRun(parsed.taskId);
              logEvent({
                channel: 'ws',
                level: 'info',
                message: 'chat_submit enqueued',
                meta: { requestId, taskId: parsed.taskId, runId: run.id },
              });
              ws.send(
                JSON.stringify({
                  type: 'chat_submit_enqueued',
                  taskId: parsed.taskId,
                  runId: run.id,
                  timestamp: new Date().toISOString(),
                })
              );
            }
          } catch (err: any) {
            logEvent({
              channel: 'ws',
              level: 'error',
              message: 'message handling failed',
              meta: {
                requestId,
                errorMessage: err?.message,
                errorCode: err?.code,
                stack: err?.stack,
              },
            });
            ws.send(
              JSON.stringify({
                type: 'error',
                message: err?.message || 'Invalid websocket payload',
                code: err?.code,
                timestamp: new Date().toISOString(),
              })
            );
          }
        })();
      },
      onClose: (_event, ws) => {
        logEvent({
          channel: 'ws',
          level: 'info',
          message: 'connection closed',
          meta: { requestId },
        });
        if (!ws.raw) return;
        nightWorkersRealtimeBroker.unsubscribeAll(ws.raw);
      },
      onError: (_event, ws) => {
        logEvent({
          channel: 'ws',
          level: 'error',
          message: 'connection error',
          meta: { requestId },
        });
        if (!ws.raw) return;
        nightWorkersRealtimeBroker.unsubscribeAll(ws.raw);
      },
    };
  })
);

if (config.NODE_ENV === 'production') {
  const frontendDist = process.env.NIGHTWORKERS_FRONTEND_DIST
    ? path.resolve(process.env.NIGHTWORKERS_FRONTEND_DIST)
    : path.join(getResourceRoot(), 'dist');
  const serveIndex = serveStatic({ path: path.join(frontendDist, 'index.html') });
  app.use('/assets/*', serveStatic({ root: frontendDist }));
  app.use('/favicon.ico', serveStatic({ root: frontendDist }));
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next();
    return serveIndex(c, next);
  });
}

export type AppType = typeof apiRoutes;
export default app;
