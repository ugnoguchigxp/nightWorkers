import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const stagedRoot = path.join(repoRoot, 'scripts/desktop/staged');
const nodeBinary = path.join(stagedRoot, 'node/bin/node');
const backendEntry = path.join(stagedRoot, 'dist-api-desktop/index.cjs');

if (!fs.existsSync(nodeBinary) || !fs.existsSync(backendEntry)) {
  throw new Error('Desktop sidecar staging is missing. Run pnpm desktop:prepare-sidecar first.');
}

const port = await pickFreePort();
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-sidecar-smoke-'));
const apiOrigin = `http://127.0.0.1:${port}`;

const child = spawn(nodeBinary, [backendEntry], {
  cwd: stagedRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DOTENV_CONFIG_QUIET: 'true',
    NIGHTWORKERS_DESKTOP: '1',
    NIGHTWORKERS_RUNTIME_DIR: runtimeDir,
    NIGHTWORKERS_RESOURCE_DIR: stagedRoot,
    NIGHTWORKERS_FRONTEND_DIST: path.join(stagedRoot, 'dist'),
    NIGHTWORKERS_API_ORIGIN: apiOrigin,
    PORT: String(port),
    APP_URL: apiOrigin,
    CORS_ORIGIN: `${apiOrigin},http://tauri.localhost,tauri://localhost`,
    API_AUTH_REQUIRED: 'false',
    AUTH_MODE: 'local',
  },
  stdio: 'inherit',
});

try {
  await waitForReady(apiOrigin, 30_000);
  console.log(`Desktop sidecar smoke passed at ${apiOrigin}`);
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port found'))));
    });
    server.on('error', reject);
  });
}

async function waitForReady(apiOrigin, timeoutMs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const status = await getStatus(`${apiOrigin}/api/health/ready`);
      if (status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Sidecar did not become ready: ${lastError?.message || 'timeout'}`);
}

function getStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('health request timed out')));
  });
}
