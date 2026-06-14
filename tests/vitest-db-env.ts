import os from 'node:os';
import path from 'node:path';

export const testDatabasePath = path.join(os.tmpdir(), 'nightworkers-vitest.sqlite');

export function applyVitestDatabaseEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = `file:${testDatabasePath}`;
  process.env.JWT_SECRET = 'nightworkers-vitest-jwt-secret-with-enough-length';
  process.env.AUTH_MODE = 'local';
  process.env.API_AUTH_REQUIRED = 'false';
  process.env.APP_URL = 'http://localhost:39174';
  process.env.CORS_ORIGIN = 'http://localhost:39174';
  process.env.NIGHTWORKERS_DESKTOP = '0';
}
