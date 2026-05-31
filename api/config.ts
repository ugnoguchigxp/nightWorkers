import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig(); // ensure env is loaded in Node.js, Bun might auto-load

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string(),
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    AUTH_MODE: z.enum(['local', 'oauth', 'both']).default('both'),
    GOOGLE_CLIENT_ID: z.string().trim().optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
    GITHUB_CLIENT_ID: z.string().trim().optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().optional(),
    APP_URL: z.string().url().optional(),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((env, ctx) => {
    const hasGoogleId = Boolean(env.GOOGLE_CLIENT_ID);
    const hasGoogleSecret = Boolean(env.GOOGLE_CLIENT_SECRET);
    const hasGithubId = Boolean(env.GITHUB_CLIENT_ID);
    const hasGithubSecret = Boolean(env.GITHUB_CLIENT_SECRET);

    if (hasGoogleId !== hasGoogleSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasGoogleId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID'],
        message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together.',
      });
    }

    if (hasGithubId !== hasGithubSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasGithubId ? 'GITHUB_CLIENT_SECRET' : 'GITHUB_CLIENT_ID'],
        message: 'Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET together.',
      });
    }

    const oauthProviderCount =
      Number(hasGoogleId && hasGoogleSecret) + Number(hasGithubId && hasGithubSecret);
    const oauthEnabled = env.AUTH_MODE === 'oauth' || env.AUTH_MODE === 'both';

    if (oauthEnabled && !env.APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'APP_URL is required when AUTH_MODE is oauth or both.',
      });
    }

    if (env.AUTH_MODE === 'oauth' && oauthProviderCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_MODE'],
        message:
          'AUTH_MODE is oauth, but no OAuth provider is configured. Set Google or GitHub client ID/secret.',
      });
    }

    const secureCookie =
      env.NODE_ENV === 'production' || Boolean(env.APP_URL?.toLowerCase().startsWith('https://'));
    if (env.COOKIE_SAME_SITE === 'none' && !secureCookie) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SAME_SITE'],
        message:
          'COOKIE_SAME_SITE=none requires secure cookies. Use HTTPS APP_URL or set NODE_ENV=production.',
      });
    }
  });

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.format());
  process.exit(1);
}

const corsOrigins = result.data.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
  console.error('❌ Invalid CORS_ORIGIN: wildcard (*) is not allowed. Use explicit origin list.');
  process.exit(1);
}

export const config = {
  ...result.data,
  CORS_ORIGINS: corsOrigins,
};
