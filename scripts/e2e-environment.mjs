import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isolatedRootName = '.nightworkers-e2e';
const providerCredentialKeys = [
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_BASE_URL',
  'CODEX_ACCESS_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
];

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function requireEnvironmentValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`E2E isolation requires ${name}. Run a package test:e2e script.`);
  return value;
}

export function assertIsolatedE2eEnvironment(env = process.env) {
  if (env.NIGHTWORKERS_E2E_ISOLATED !== '1') {
    throw new Error(
      'Playwright E2E must run through scripts/run-playwright.mjs. Direct execution could mutate the working database.',
    );
  }
  const runRoot = path.resolve(requireEnvironmentValue(env, 'NIGHTWORKERS_E2E_RUN_ROOT'));
  const databasePath = path.resolve(
    requireEnvironmentValue(env, 'NIGHTWORKERS_E2E_DATABASE_PATH'),
  );
  const workspaceRoot = path.resolve(
    requireEnvironmentValue(env, 'NIGHTWORKERS_E2E_WORKSPACE_ROOT'),
  );
  const runtimeRoot = path.resolve(requireEnvironmentValue(env, 'NIGHTWORKERS_RUNTIME_DIR'));
  const databaseUrl = requireEnvironmentValue(env, 'DATABASE_URL');
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('E2E DATABASE_URL must be a local file URL.');
  }
  if (path.resolve(fileURLToPath(databaseUrl)) !== databasePath) {
    throw new Error('E2E DATABASE_URL and NIGHTWORKERS_E2E_DATABASE_PATH do not match.');
  }
  for (const [label, candidate] of [
    ['database', databasePath],
    ['workspace', workspaceRoot],
    ['runtime', runtimeRoot],
  ]) {
    if (!isPathInside(runRoot, candidate)) {
      throw new Error(`E2E ${label} path must stay inside NIGHTWORKERS_E2E_RUN_ROOT.`);
    }
  }
  return { runRoot, databasePath, workspaceRoot, runtimeRoot };
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('Unable to reserve an E2E port.'));
      });
    });
  });
}

export async function createIsolatedE2eEnvironment(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const parentRoot = path.join(repositoryRoot, isolatedRootName);
  const runId = options.runId ?? `${Date.now()}-${process.pid}-${randomUUID()}`;
  const runRoot = path.join(parentRoot, runId);
  const databasePath = path.join(runRoot, 'database', 'e2e.sqlite');
  const runtimeRoot = path.join(runRoot, 'runtime');
  const settingsRoot = path.join(runRoot, 'settings');
  const workspaceRoot = path.join(runRoot, 'workspaces');
  const codexHome = path.join(runRoot, 'codex-home');
  for (const directory of [
    path.dirname(databasePath),
    runtimeRoot,
    settingsRoot,
    workspaceRoot,
    codexHome,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(databasePath, '');

  const webPort = options.webPort ?? (await reservePort());
  let apiPort = options.apiPort ?? (await reservePort());
  while (apiPort === webPort) apiPort = await reservePort();
  const liveLlmEnabled = options.env?.NIGHTWORKERS_LIVE_LLM_E2E === '1';
  const env = {
    ...(options.env ?? process.env),
    NIGHTWORKERS_E2E: '1',
    NIGHTWORKERS_E2E_ISOLATED: '1',
    NIGHTWORKERS_E2E_RUN_ROOT: runRoot,
    NIGHTWORKERS_E2E_DATABASE_PATH: databasePath,
    NIGHTWORKERS_E2E_WORKSPACE_ROOT: workspaceRoot,
    NIGHTWORKERS_E2E_RUNTIME_FIXTURE: liveLlmEnabled ? '0' : '1',
    NIGHTWORKERS_E2E_WEB_PORT: String(webPort),
    NIGHTWORKERS_E2E_API_PORT: String(apiPort),
    NIGHTWORKERS_WEB_PORT: String(webPort),
    NIGHTWORKERS_API_PORT: String(apiPort),
    NIGHTWORKERS_RUNTIME_DIR: runtimeRoot,
    NIGHTWORKERS_LLM_SETTINGS_PATH: path.join(settingsRoot, 'llm.json'),
    NIGHTWORKERS_GENERAL_SETTINGS_PATH: path.join(settingsRoot, 'general.json'),
    NIGHTWORKERS_MCP_SETTINGS_PATH: path.join(settingsRoot, 'mcp.json'),
    NIGHTWORKERS_HOOKS_SETTINGS_PATH: path.join(settingsRoot, 'hooks.json'),
    NIGHTWORKERS_CODEX_HOME: codexHome,
    NIGHTWORKERS_DESKTOP: '0',
    NIGHTWORKERS_EXECUTOR_MODE: 'in_process',
    DATABASE_URL: pathToFileURL(databasePath).href,
    JWT_SECRET: 'nightworkers-e2e-isolated-jwt-secret-32-chars',
    AUTH_MODE: 'local',
    API_AUTH_REQUIRED: 'false',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    APP_URL: `http://localhost:${webPort}`,
    CORS_ORIGIN: `http://localhost:${webPort}`,
    AWS_EC2_METADATA_DISABLED: 'true',
  };
  if (!liveLlmEnabled) {
    env.ACTIVE_LLM_PROVIDER = 'fixture';
    for (const key of providerCredentialKeys) env[key] = '';
  }
  assertIsolatedE2eEnvironment(env);
  return { runId, runRoot, parentRoot, databasePath, workspaceRoot, env };
}

export function cleanupIsolatedE2eEnvironment(environment) {
  if (!environment?.runRoot || !environment?.databasePath) return;
  const runRoot = path.resolve(environment.runRoot);
  const databasePath = path.resolve(environment.databasePath);
  if (!isPathInside(runRoot, databasePath)) {
    throw new Error('Refusing to clean an E2E database outside its run root.');
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(environment.parentRoot);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error?.code)) throw error;
  }
}
