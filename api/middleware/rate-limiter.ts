/**
 * メモリベースのレートリミッター。
 *
 * 注意: この実装はプロセス単位の Map でカウントを保持するため、
 * 単一プロセスでのみ正しく動作します。
 * 複数プロセス／コンテナでスケールアウトする場合は、
 * 共有ストア（Redis 等）ベースの実装に差し替えてください。
 */
import type { Context } from 'hono';

type RateLimiterOptions = {
  windowMs: number;
  limit: number;
  message?: string;
  keyGenerator?: (c: Context) => string;
  trustProxy?: boolean;
};

export const rateLimiter = (options: RateLimiterOptions) => {
  // Keep store scoped to each limiter instance to avoid cross-route side effects.
  const store = new Map<string, { count: number; resetTime: number }>();

  // Simple cleanup interval (runs every 5 mins to prevent memory leaks)
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, record] of store.entries()) {
        if (now > record.resetTime) {
          store.delete(key);
        }
      }
    },
    5 * 60 * 1000
  ).unref?.();

  const readDirectRemoteIp = (c: Context) => {
    const env = (c as { env?: { incoming?: { socket?: { remoteAddress?: string } } } }).env;
    const incoming = env?.incoming;
    const remoteAddress = incoming?.socket?.remoteAddress;
    if (typeof remoteAddress === 'string' && remoteAddress.length > 0) {
      return remoteAddress;
    }
    return null;
  };

  const readClientIp = (c: Context) => {
    if (!options.trustProxy) return readDirectRemoteIp(c);

    const cfConnectingIp = c.req.header('cf-connecting-ip');
    if (cfConnectingIp) return cfConnectingIp.trim();

    const xForwardedFor = c.req.header('x-forwarded-for');
    if (xForwardedFor) {
      const firstIp = xForwardedFor.split(',')[0]?.trim();
      if (firstIp) return firstIp;
    }

    const xRealIp = c.req.header('x-real-ip');
    if (xRealIp) return xRealIp.trim();

    return null;
  };

  const defaultKeyGenerator = (c: Context) => {
    const ip = readClientIp(c);
    if (ip) return `ip:${ip}`;

    // Avoid using attacker-controlled headers as identity when proxy headers are untrusted.
    // This intentionally uses one coarse bucket.
    return 'global';
  };

  return async (c: Context, next: () => Promise<void>) => {
    const key = options.keyGenerator ? options.keyGenerator(c) : defaultKeyGenerator(c);
    const now = Date.now();
    const record = store.get(key);

    if (record) {
      if (now > record.resetTime) {
        store.set(key, { count: 1, resetTime: now + options.windowMs });
      } else {
        if (record.count >= options.limit) {
          return c.json(
            {
              error: {
                code: 'RATE_LIMIT_EXCEEDED',
                message: options.message || 'Too many requests',
              },
            },
            429
          );
        }
        record.count++;
      }
    } else {
      store.set(key, { count: 1, resetTime: now + options.windowMs });
    }

    await next();
  };
};
