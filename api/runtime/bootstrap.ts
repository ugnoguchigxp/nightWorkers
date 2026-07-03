import crypto from 'node:crypto';
import fs from 'node:fs';
import { getRuntimePaths, isDesktopMode } from './paths';

const JWT_SECRET_BYTES = 48;

type DesktopRuntimeBootstrapOptions = {
  preserveConfiguredDatabaseUrl?: boolean;
};

function mergeCorsOrigins(defaultOrigins: string[], configuredOrigins?: string) {
  const origins = [
    ...defaultOrigins,
    ...(configuredOrigins || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  ];
  return [...new Set(origins)].join(',');
}

export function ensureDesktopRuntimeBootstrap(
  env: NodeJS.ProcessEnv = process.env,
  options: DesktopRuntimeBootstrapOptions = {}
) {
  if (!isDesktopMode(env)) return;

  const paths = getRuntimePaths(env);
  for (const dir of [
    paths.runtimeRoot,
    paths.settingsDir,
    paths.logsDir,
    paths.secretsDir,
    paths.artifactsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const preserveConfiguredDatabaseUrl = options.preserveConfiguredDatabaseUrl ?? true;
  if (!preserveConfiguredDatabaseUrl || !env.DATABASE_URL?.trim()) {
    env.DATABASE_URL = `file:${paths.databasePath}`;
  }
  if (
    !env.AUTH_MODE ||
    ((env.AUTH_MODE === 'both' || env.AUTH_MODE === 'oauth') &&
      !env.GOOGLE_CLIENT_ID &&
      !env.GITHUB_CLIENT_ID)
  ) {
    env.AUTH_MODE = 'local';
  }
  env.API_AUTH_REQUIRED ||= 'false';

  const apiOrigin = env.NIGHTWORKERS_API_ORIGIN || `http://127.0.0.1:${env.PORT || 39173}`;
  env.APP_URL = apiOrigin;
  env.CORS_ORIGIN = mergeCorsOrigins(
    [apiOrigin, 'http://tauri.localhost', 'tauri://localhost'],
    env.CORS_ORIGIN
  );

  if (!env.JWT_SECRET) {
    const secretPath = `${paths.secretsDir}/jwt-secret`;
    if (fs.existsSync(secretPath)) {
      env.JWT_SECRET = fs.readFileSync(secretPath, 'utf-8').trim();
    } else {
      const secret = crypto.randomBytes(JWT_SECRET_BYTES).toString('base64url');
      fs.writeFileSync(secretPath, `${secret}\n`, { encoding: 'utf-8', mode: 0o600 });
      env.JWT_SECRET = secret;
    }
  }
}
