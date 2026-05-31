import { serveStatic } from '@hono/node-server/serve-static';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import { config } from './config';
import { createOpenApiRouter } from './lib/openapi';
import { errorHandler } from './middleware/error-handler';
import { loggerMiddleware } from './middleware/logger';
import { rateLimiter } from './middleware/rate-limiter';
import { bbsRouter } from './modules/bbs/bbs.routes';
import { nightworkersRouter } from './modules/nightworkers/nightworkers.routes';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { oauthRouter } from './routes/oauth';

const apiRoutes = createOpenApiRouter()
  .route('/health', healthRouter)
  .route('/auth/oauth', oauthRouter)
  .route('/auth', authRouter)
  .route('/bbs', bbsRouter)
  .route('/', nightworkersRouter);

const app = createOpenApiRouter();
const isProduction = config.NODE_ENV === 'production';

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
      connectSrc: ["'self'", ...config.CORS_ORIGINS, ...(isProduction ? [] : ['ws:', 'wss:'])],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  })
);

app.use('*', loggerMiddleware());
app.onError(errorHandler);

app.use('/api/*', rateLimiter({ windowMs: 60 * 1000, limit: 100, trustProxy: config.TRUST_PROXY }));
app.use(
  '/api/auth/login',
  rateLimiter({ windowMs: 60 * 1000, limit: 5, trustProxy: config.TRUST_PROXY })
);
app.use(
  '/api/auth/register',
  rateLimiter({ windowMs: 60 * 1000, limit: 5, trustProxy: config.TRUST_PROXY })
);

app.use('/api/*', csrf());

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

if (config.NODE_ENV === 'production') {
  const serveIndex = serveStatic({ path: './dist/index.html' });
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.use('/favicon.ico', serveStatic({ root: './dist' }));
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) return next();
    return serveIndex(c, next);
  });
}

export type AppType = typeof apiRoutes;
export default app;
