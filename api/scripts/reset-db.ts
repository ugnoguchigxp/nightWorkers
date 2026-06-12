import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ quiet: true });

function resolveDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  if (
    databaseUrl.startsWith('libsql:') ||
    databaseUrl.startsWith('http:') ||
    databaseUrl.startsWith('https:')
  ) {
    throw new Error(
      `db:reset only supports local SQLite files. Received DATABASE_URL=${databaseUrl}`
    );
  }
  const rawPath = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  return path.resolve(process.cwd(), rawPath);
}

function removeIfExists(targetPath: string) {
  if (!existsSync(targetPath)) return;
  rmSync(targetPath, { force: true });
}

function deleteDatabaseFiles(databasePath: string) {
  removeIfExists(databasePath);
  removeIfExists(`${databasePath}-wal`);
  removeIfExists(`${databasePath}-shm`);
}

function runMigrations(databasePath: string) {
  execFileSync('bun', ['run', 'db:migrate'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databasePath,
    },
  });
}

function clearBootstrapRows(databasePath: string) {
  execFileSync('sqlite3', [databasePath], {
    stdio: 'inherit',
    input: [
      'DELETE FROM implementation_queue_settings;',
      'DELETE FROM todo_workflow_settings;',
    ].join('\n'),
  });
}

function main() {
  const databasePath = resolveDatabasePath();
  deleteDatabaseFiles(databasePath);
  runMigrations(databasePath);
  clearBootstrapRows(databasePath);
  console.log(`Reset local SQLite DB: ${databasePath}`);
}

main();
