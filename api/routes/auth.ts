import { createRoute, z } from '@hono/zod-openapi';
import { getCookie } from 'hono/cookie';
import { authResponseSchema, loginSchema, registerSchema } from '../../shared/schemas/auth.schema';
import { config } from '../config';
import { clearAuthCookies, REFRESH_TOKEN_COOKIE_NAME, setAuthCookies } from '../lib/auth-cookies';
import { AuthError } from '../lib/errors';
import { createOpenApiRouter } from '../lib/openapi';
import { authMiddleware } from '../middleware/auth';
import { login, logout, refresh, register } from '../services/auth.service';

const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: authResponseSchema,
        },
      },
      description: 'Registration successful',
    },
  },
});

const loginRoute = createRoute({
  method: 'post',
  path: '/login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: loginSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: authResponseSchema,
        },
      },
      description: 'Login successful',
    },
  },
});

const refreshRoute = createRoute({
  method: 'post',
  path: '/refresh',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: authResponseSchema,
        },
      },
      description: 'Token refresh successful',
    },
  },
});

const logoutRoute = createRoute({
  method: 'post',
  path: '/logout',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
      description: 'Logout successful',
    },
  },
});

const meRoute = createRoute({
  method: 'get',
  path: '/me',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            userId: z.string(),
            email: z.string().email(),
          }),
        },
      },
      description: 'Get current user profile',
    },
  },
});

const methodsRoute = createRoute({
  method: 'get',
  path: '/methods',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            authMode: z.enum(['local', 'oauth', 'both']),
            local: z.boolean(),
            oauth: z.object({
              enabled: z.boolean(),
              providers: z.object({
                google: z.boolean(),
                github: z.boolean(),
              }),
            }),
          }),
        },
      },
      description: 'Get enabled authentication methods',
    },
  },
});

const hasGoogleOAuth = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
const hasGithubOAuth = Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
const oauthEnabled = config.AUTH_MODE !== 'local' && (hasGoogleOAuth || hasGithubOAuth);

const publicAuthRouter = createOpenApiRouter()
  .openapi(methodsRoute, (c) => {
    return c.json(
      {
        authMode: config.AUTH_MODE,
        local: config.AUTH_MODE !== 'oauth',
        oauth: {
          enabled: oauthEnabled,
          providers: {
            google: config.AUTH_MODE !== 'local' && hasGoogleOAuth,
            github: config.AUTH_MODE !== 'local' && hasGithubOAuth,
          },
        },
      },
      200
    );
  })
  .openapi(registerRoute, async (c) => {
    const data = c.req.valid('json');
    const result = await register(data);
    setAuthCookies(c, result);
    return c.json({ user: result.user }, 201);
  })
  .openapi(loginRoute, async (c) => {
    const data = c.req.valid('json');
    const result = await login(data);
    setAuthCookies(c, result);
    return c.json({ user: result.user }, 200);
  })
  .openapi(refreshRoute, async (c) => {
    const refreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME);
    if (!refreshToken) throw new AuthError('Missing refresh token');
    const result = await refresh(refreshToken);
    setAuthCookies(c, result);
    return c.json({ user: result.user }, 200);
  })
  .openapi(logoutRoute, async (c) => {
    const refreshToken = getCookie(c, REFRESH_TOKEN_COOKIE_NAME);
    await logout(refreshToken);
    clearAuthCookies(c);
    return c.json({ success: true }, 200);
  });

const protectedAuthRouterBase = createOpenApiRouter();
protectedAuthRouterBase.use('/me', authMiddleware());

const protectedAuthRouter = protectedAuthRouterBase.openapi(meRoute, (c) => {
  const user = c.get('user');
  if (!user) {
    throw new AuthError('Unauthorized');
  }
  return c.json({ userId: user.userId, email: user.email }, 200);
});

export const authRouter = createOpenApiRouter()
  .route('/', publicAuthRouter)
  .route('/', protectedAuthRouter);
