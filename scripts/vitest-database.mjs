import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveVitestDatabase(options = {}) {
  const env = options.env ?? process.env;
  const configuredPath = env.NIGHTWORKERS_VITEST_DB_PATH;
  if (configuredPath) {
    return { databasePath: configuredPath, owned: false };
  }
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random();
  const tempDirectory = options.tempDirectory ?? os.tmpdir();
  return {
    databasePath: path.join(
      tempDirectory,
      `nightworkers-vitest-${pid}-${now}-${random.toString(16).slice(2)}.sqlite`,
    ),
    owned: true,
  };
}

export function cleanupVitestDatabase(database) {
  if (!database.owned) return;
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${database.databasePath}${suffix}`, { force: true });
  }
}
