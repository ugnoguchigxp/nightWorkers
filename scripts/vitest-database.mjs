import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const inheritedIsolationKeys = [
  'NIGHTWORKERS_E2E',
  'NIGHTWORKERS_E2E_ISOLATED',
  'NIGHTWORKERS_E2E_RUN_ROOT',
  'NIGHTWORKERS_E2E_DATABASE_PATH',
  'NIGHTWORKERS_E2E_WORKSPACE_ROOT',
  'NIGHTWORKERS_E2E_RUNTIME_FIXTURE',
  'NIGHTWORKERS_E2E_WEB_PORT',
  'NIGHTWORKERS_E2E_API_PORT',
  'NIGHTWORKERS_ISOLATED_RUN_ROOT',
  'NIGHTWORKERS_ISOLATED_RUN_ID',
  'NIGHTWORKERS_ISOLATED_MANIFEST_PATH',
  'NIGHTWORKERS_RUNTIME_DIR',
  'NIGHTWORKERS_WORKSPACE_BOOTSTRAP_DIR',
  'NIGHTWORKERS_LLM_SETTINGS_PATH',
  'NIGHTWORKERS_GENERAL_SETTINGS_PATH',
  'NIGHTWORKERS_MCP_SETTINGS_PATH',
  'NIGHTWORKERS_HOOKS_SETTINGS_PATH',
  'NIGHTWORKERS_CODEX_HOME',
];

export function buildVitestChildEnvironment(options) {
  for (const key of ['databasePath', 'workspaceRoot', 'runRoot']) {
    if (typeof options?.[key] !== 'string' || !options[key].trim()) {
      throw new Error(`Vitest child environment requires ${key}.`);
    }
  }
  const childEnvironment = { ...(options.env ?? process.env) };
  for (const key of inheritedIsolationKeys) delete childEnvironment[key];
  return {
    ...childEnvironment,
    NODE_ENV: 'test',
    NIGHTWORKERS_DATABASE_ACCESS_SCOPE: 'isolated_test',
    NIGHTWORKERS_VITEST_DB_PATH: options.databasePath,
    NIGHTWORKERS_VITEST_RUN_ROOT: options.runRoot,
    NIGHTWORKERS_VITEST_WORKSPACE_ROOT: options.workspaceRoot,
  };
}

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
