import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  cleanupVitestDatabase,
  resolveVitestDatabase,
} from './vitest-database.mjs';

const database = resolveVitestDatabase();
const vitestEntry = path.resolve('node_modules/vitest/vitest.mjs');
const child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NIGHTWORKERS_VITEST_DB_PATH: database.databasePath,
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve) => {
  child.once('error', (error) => {
    console.error(error);
    resolve(1);
  });
  child.once('close', (code) => resolve(code ?? 1));
});

cleanupVitestDatabase(database);

process.exitCode = exitCode;
