import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  DATABASE_ACCESS_SCOPE_ENV,
  DATABASE_ACCESS_SCOPES,
  ISOLATED_MANIFEST_PATH_ENV,
  ISOLATED_RUN_ID_ENV,
  ISOLATED_RUN_ROOT_ENV,
  assertIsolatedRuntimeEnvironment,
  createIsolatedRuntimeManifest,
  writeIsolatedRuntimeManifest,
} from '../shared/runtime-database-access.mjs';

export function createIsolatedRuntimeEnvironment(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const scope = options.scope ?? DATABASE_ACCESS_SCOPES.isolatedEvaluation;
  if (![DATABASE_ACCESS_SCOPES.isolatedTest, DATABASE_ACCESS_SCOPES.isolatedEvaluation].includes(scope)) {
    throw new Error(`Unsupported isolated database scope: ${scope}`);
  }
  const parentRoot = path.join(
    repositoryRoot,
    options.rootName ?? '.nightworkers-isolated',
  );
  const runId = options.runId ?? `${Date.now()}-${process.pid}-${randomUUID()}`;
  if (!runId || path.basename(runId) !== runId || runId === '.' || runId === '..') {
    throw new Error('Isolated runtime runId must be one path segment.');
  }
  const runRoot = path.join(parentRoot, runId);
  const databasePath = path.join(runRoot, 'database', options.databaseName ?? 'isolated.sqlite');
  const runtimeRoot = path.join(runRoot, 'runtime');
  const settingsRoot = path.join(runRoot, 'settings');
  const workspaceRoot = path.join(runRoot, 'workspaces');
  const codexHome = path.join(runRoot, 'codex-home');
  const manifestPath = path.join(runRoot, 'isolated-runtime-manifest.json');
  for (const directory of [
    path.dirname(databasePath),
    runtimeRoot,
    settingsRoot,
    workspaceRoot,
    codexHome,
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(databasePath, '', { mode: 0o600 });

  const manifest = createIsolatedRuntimeManifest({
    scope,
    purpose: options.purpose ?? 'isolated_runtime',
    runId,
    runRoot,
    databasePath,
    runtimeRoot,
    workspaceRoot,
  });
  writeIsolatedRuntimeManifest(manifestPath, manifest);

  const env = {
    ...(options.env ?? process.env),
    [DATABASE_ACCESS_SCOPE_ENV]: scope,
    [ISOLATED_RUN_ROOT_ENV]: runRoot,
    [ISOLATED_RUN_ID_ENV]: runId,
    [ISOLATED_MANIFEST_PATH_ENV]: manifestPath,
    NIGHTWORKERS_RUNTIME_DIR: runtimeRoot,
    NIGHTWORKERS_WORKSPACE_BOOTSTRAP_DIR: workspaceRoot,
    NIGHTWORKERS_LLM_SETTINGS_PATH: path.join(settingsRoot, 'llm.json'),
    NIGHTWORKERS_GENERAL_SETTINGS_PATH: path.join(settingsRoot, 'general.json'),
    NIGHTWORKERS_MCP_SETTINGS_PATH: path.join(settingsRoot, 'mcp.json'),
    NIGHTWORKERS_HOOKS_SETTINGS_PATH: path.join(settingsRoot, 'hooks.json'),
    NIGHTWORKERS_CODEX_HOME: codexHome,
    NIGHTWORKERS_DESKTOP: '0',
    DATABASE_URL: pathToFileURL(databasePath).href,
  };
  assertIsolatedRuntimeEnvironment(env, [scope]);
  return {
    scope,
    runId,
    runRoot,
    parentRoot,
    databasePath,
    runtimeRoot,
    settingsRoot,
    workspaceRoot,
    codexHome,
    manifestPath,
    manifest,
    env,
  };
}

export function cleanupIsolatedRuntimeEnvironment(environment) {
  if (!environment?.runRoot || !environment?.manifestPath || !environment?.env) return;
  const isolated = assertIsolatedRuntimeEnvironment(environment.env, [environment.scope]);
  if (path.resolve(isolated.manifest.runRoot) !== path.resolve(environment.runRoot)) {
    throw new Error('Refusing to clean an isolated runtime with a mismatched run root.');
  }
  if (
    path.resolve(path.dirname(environment.runRoot)) !== path.resolve(environment.parentRoot)
  ) {
    throw new Error(
      'Refusing to clean an isolated runtime outside its recorded parent root.',
    );
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${isolated.manifest.databasePath}${suffix}`, { force: true });
  }
  fs.rmSync(environment.runRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(environment.parentRoot);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
  }
}
