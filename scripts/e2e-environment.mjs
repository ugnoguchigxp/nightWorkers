import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATABASE_ACCESS_SCOPES,
  assertIsolatedRuntimeEnvironment,
} from '../shared/runtime-database-access.mjs';
import {
  cleanupIsolatedRuntimeEnvironment,
  createIsolatedRuntimeEnvironment,
} from './isolated-runtime-environment.mjs';

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
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
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
  const isolated = assertIsolatedRuntimeEnvironment(env, [
    DATABASE_ACCESS_SCOPES.isolatedTest,
  ]);
  if (path.resolve(isolated.manifest.databasePath) !== databasePath) {
    throw new Error('E2E manifest database path does not match NIGHTWORKERS_E2E_DATABASE_PATH.');
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

function assertValidPort(port, label) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`E2E ${label} port must be an integer between 1 and 65535.`);
  }
}

export async function createIsolatedE2eEnvironment(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const sourceEnvironment = options.env ?? process.env;
  const isolated = createIsolatedRuntimeEnvironment({
    repositoryRoot,
    scope: DATABASE_ACCESS_SCOPES.isolatedTest,
    rootName: isolatedRootName,
    runId: options.runId,
    databaseName: 'e2e.sqlite',
    purpose: 'playwright_e2e',
    env: sourceEnvironment,
  });
  const {
    runId,
    runRoot,
    databasePath,
    runtimeRoot,
    workspaceRoot,
  } = isolated;

  try {
    const reserve = options.reservePort ?? reservePort;
    const webPort = options.webPort ?? (await reserve());
    let apiPort = options.apiPort ?? (await reserve());
    for (let attempt = 0; apiPort === webPort && attempt < 20; attempt += 1) {
      apiPort = await reserve();
    }
    assertValidPort(webPort, 'web');
    assertValidPort(apiPort, 'API');
    if (apiPort === webPort) {
      throw new Error('E2E web and API ports must be different.');
    }
    const liveLlmEnabled = sourceEnvironment.NIGHTWORKERS_LIVE_LLM_E2E === '1';
    const env = {
      ...isolated.env,
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
      NIGHTWORKERS_DESKTOP: '0',
      NIGHTWORKERS_EXECUTOR_MODE: 'in_process',
      NIGHTWORKERS_SQLITE_BUSY_RETRY_PROFILE: 'coverage',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      CORS_ORIGIN: `http://localhost:${webPort}`,
      AWS_EC2_METADATA_DISABLED: 'true',
    };
    if (!liveLlmEnabled) {
      env.ACTIVE_LLM_PROVIDER = 'fixture';
      for (const key of providerCredentialKeys) env[key] = '';
    }
    assertIsolatedE2eEnvironment(env);
    return { ...isolated, runId, runRoot, databasePath, workspaceRoot, env };
  } catch (error) {
    try {
      cleanupIsolatedRuntimeEnvironment(isolated);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'E2E environment creation and rollback both failed.',
      );
    }
    throw error;
  }
}

export function cleanupIsolatedE2eEnvironment(environment) {
  cleanupIsolatedRuntimeEnvironment(environment);
}
