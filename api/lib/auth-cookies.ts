import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { config } from '../config';

export const ACCESS_TOKEN_COOKIE_NAME = 'access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';

const isSecureCookie =
  config.NODE_ENV === 'production' || Boolean(config.APP_URL?.startsWith('https://'));

const parseDurationToSeconds = (duration: string): number | undefined => {
  const match = duration.match(/^(\d+)([smhd])$/i);
  if (!match) return undefined;

  const value = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(value) || value <= 0) return undefined;

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    default:
      return undefined;
  }
};

const accessCookieMaxAge = parseDurationToSeconds(config.JWT_ACCESS_EXPIRES_IN);
const refreshCookieMaxAge = parseDurationToSeconds(config.JWT_REFRESH_EXPIRES_IN);

export const setAuthCookies = (
  c: Context,
  tokens: { accessToken: string; refreshToken: string }
) => {
  setCookie(c, ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
    ...(accessCookieMaxAge ? { maxAge: accessCookieMaxAge } : {}),
  });

  setCookie(c, REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure: isSecureCookie,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/api/auth',
    ...(refreshCookieMaxAge ? { maxAge: refreshCookieMaxAge } : {}),
  });
};

export const clearAuthCookies = (c: Context) => {
  deleteCookie(c, ACCESS_TOKEN_COOKIE_NAME, { path: '/' });
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, { path: '/api/auth' });
};
