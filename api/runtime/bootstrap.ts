import crypto from 'node:crypto';
import fs from 'node:fs';
import { getRuntimePaths, isDesktopMode } from './paths';

const JWT_SECRET_BYTES = 48;

export function ensureDesktopRuntimeBootstrap(env: NodeJS.ProcessEnv = process.env) {
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

  env.DATABASE_URL = `file:${paths.databasePath}`;
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
  env.CORS_ORIGIN = [apiOrigin, 'http://tauri.localhost', 'tauri://localhost'].join(',');

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
