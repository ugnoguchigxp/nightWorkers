import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { ACCESS_TOKEN_COOKIE_NAME } from '../lib/auth-cookies';
import { AuthError } from '../lib/errors';
import type { AppEnv } from '../lib/types';
import { verifyAccessToken } from '../services/token.service';

export const authMiddleware = () => {
  return createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookieToken = getCookie(c, ACCESS_TOKEN_COOKIE_NAME);
    const token = bearerToken || cookieToken;

    if (!token) {
      throw new AuthError('Missing authentication token');
    }

    try {
      const payload = await verifyAccessToken(token);
      c.set('user', payload);
    } catch {
      throw new AuthError('Invalid or expired token');
    }

    await next();
  });
};
