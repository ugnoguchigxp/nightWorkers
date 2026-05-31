import { createRoute, z } from '@hono/zod-openapi';
import { getCookie, setCookie } from 'hono/cookie';
import { config } from '../config';
import { setAuthCookies } from '../lib/auth-cookies';
import { AuthError, ValidationError } from '../lib/errors';
import { createOpenApiRouter } from '../lib/openapi';
import { generateTokens, handleExternalUser } from '../services/auth.service';
import type { OAuthProvider } from '../services/oauth/base';
import { GitHubOAuthClient } from '../services/oauth/github';
import { GoogleOAuthClient } from '../services/oauth/google';

const providers = new Map<string, OAuthProvider>();
const isSecureCookie =
  config.NODE_ENV === 'production' || Boolean(config.APP_URL?.startsWith('https://'));
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
  const fallback = `http://localhost:${config.PORT}`;
  const redirectUrl = `${config.APP_URL || fallback}/api/auth/oauth/google/callback`;
  providers.set(
    'google',
    new GoogleOAuthClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, redirectUrl)
  );
}
if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
  const fallback = `http://localhost:${config.PORT}`;
  const redirectUrl = `${config.APP_URL || fallback}/api/auth/oauth/github/callback`;
  providers.set(
    'github',
    new GitHubOAuthClient(config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET, redirectUrl)
  );
}

const loginRoute = createRoute({
  method: 'get',
  path: '/:provider',
  request: {
    params: z.object({
      provider: z.string().openapi({ example: 'google' }),
    }),
  },
  responses: {
    302: {
      description: 'Redirect to OAuth provider',
    },
  },
});

const callbackRoute = createRoute({
  method: 'get',
  path: '/:provider/callback',
  request: {
    params: z.object({
      provider: z.string().openapi({ example: 'google' }),
    }),
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
    }),
  },
  responses: {
    302: {
      description: 'Redirect to frontend with tokens',
    },
  },
});

export const oauthRouter = createOpenApiRouter()
  .openapi(loginRoute, (c) => {
    if (config.AUTH_MODE === 'local') throw new AuthError('OAuth authentication is disabled');
    const providerId = c.req.param('provider');
    const provider = providers.get(providerId);
    if (!provider) throw new ValidationError('Invalid or disabled OAuth provider');

    const state = crypto.randomUUID();
    setCookie(c, 'oauth_state', state, {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: 'Lax',
      maxAge: 60 * 10,
      path: '/',
    });

    const url = provider.getAuthorizationUrl(state);
    return c.redirect(url);
  })
  .openapi(callbackRoute, async (c) => {
    const providerId = c.req.param('provider');
    const provider = providers.get(providerId);
    if (!provider) throw new ValidationError('Invalid or disabled OAuth provider');

    const code = c.req.query('code');
    const state = c.req.query('state');
    const savedState = getCookie(c, 'oauth_state');

    if (!code || !state || state !== savedState) {
      setCookie(c, 'oauth_state', '', {
        httpOnly: true,
        secure: isSecureCookie,
        sameSite: 'Lax',
        maxAge: 0,
        path: '/',
      });
      throw new AuthError('Invalid state or code');
    }

    setCookie(c, 'oauth_state', '', {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: 'Lax',
      maxAge: 0,
      path: '/',
    });

    const { user: oauthUser } = await provider.exchangeCode(code);

    const user = await handleExternalUser(providerId, {
      id: oauthUser.id,
      email: oauthUser.email,
      name: oauthUser.name,
    });

    if (!user?.isActive) {
      throw new AuthError('Account blocked or inactive');
    }

    const tokens = await generateTokens(user);
    setAuthCookies(c, tokens);
    const frontendUrl = new URL(
      '/oauth/callback',
      config.APP_URL || `http://localhost:${config.PORT}`
    );

    return c.redirect(frontendUrl.toString());
  });
