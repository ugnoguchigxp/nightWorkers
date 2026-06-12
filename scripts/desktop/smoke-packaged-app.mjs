import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const bundleDir = path.join(repoRoot, 'src-tauri/target/release/bundle');
const explicitAppPath = process.env.NIGHTWORKERS_DESKTOP_APP_PATH;

const appPath =
  explicitAppPath ||
  findFirst(bundleDir, (filePath) => filePath.endsWith('.app') && filePath.includes('NightWorkers'));

if (!appPath || !fs.existsSync(appPath)) {
  throw new Error(
    `Packaged NightWorkers.app was not found. Run bun run desktop:build first or set NIGHTWORKERS_DESKTOP_APP_PATH. Searched: ${bundleDir}`
  );
}

const executablePath = path.join(appPath, 'Contents/MacOS/nightworkers');
if (!fs.existsSync(executablePath)) {
  throw new Error(`Packaged app executable was not found: ${executablePath}`);
}

const runtimeRoot = path.join(repoRoot, 'data');
const logsDir = path.join(runtimeRoot, 'logs');
const desktopLogPath = path.join(logsDir, 'desktop.log');
const sidecarLogPath = path.join(logsDir, 'sidecar.log');
const desktopLogOffset = fileSize(desktopLogPath);
const sidecarLogOffset = fileSize(sidecarLogPath);

console.log(`Packaged app found: ${appPath}`);

const app = spawn(executablePath, [], {
  cwd: path.dirname(executablePath),
  stdio: 'ignore',
});
let sidecarPid = null;
let port = null;

try {
  const readyLine = await waitForLogLine(
    desktopLogPath,
    desktopLogOffset,
    /sidecar ready: http:\/\/127\.0\.0\.1:(\d+)/,
    30_000
  );
  port = Number(readyLine.match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(port)) {
    throw new Error(`Unable to parse sidecar port from desktop log line: ${readyLine}`);
  }
  const spawnedLine = await waitForLogLine(
    desktopLogPath,
    desktopLogOffset,
    /sidecar spawned pid=(\d+)/,
    1_000
  ).catch(() => null);
  sidecarPid = spawnedLine ? Number(spawnedLine.match(/pid=(\d+)/)?.[1]) : null;

  await expectStatus(`http://127.0.0.1:${port}/api/health/ready`, 200);
  await expectStatus(`http://127.0.0.1:${port}/api/overview`, 200);
  await expectStatus(`http://127.0.0.1:${port}/api/implementation-queue`, 200);
  await expectWebSocketOpen(`ws://127.0.0.1:${port}/api/ws/nightworkers`);

  console.log(`Packaged app smoke passed at http://127.0.0.1:${port}`);
} finally {
  await stopApp(app, sidecarPid);
}

if (port) {
  await waitForPortClosed('127.0.0.1', port, 10_000);
}
if (sidecarPid) {
  await waitForProcessExit(sidecarPid, 10_000);
}

const newDesktopLog = readFromOffset(desktopLogPath, desktopLogOffset);
const newSidecarLog = readFromOffset(sidecarLogPath, sidecarLogOffset);
if (!newDesktopLog.includes('sidecar ready:')) {
  throw new Error(`Desktop smoke did not write sidecar readiness to ${desktopLogPath}`);
}
if (!newSidecarLog.includes('server started')) {
  throw new Error(`Desktop smoke did not write sidecar server startup to ${sidecarLogPath}`);
}

function findFirst(root, predicate) {
  if (!fs.existsSync(root)) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (predicate(filePath)) return filePath;
    if (entry.isDirectory()) {
      const nested = findFirst(filePath, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function readFromOffset(filePath, offset) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(offset);
  } catch {
    return '';
  }
}

async function waitForLogLine(filePath, offset, pattern, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const content = readFromOffset(filePath, offset);
    const line = content
      .split('\n')
      .find((candidate) => pattern.test(candidate));
    if (line) return line;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${pattern} in ${filePath}`);
}

function expectStatus(url, expectedStatus) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      if (res.statusCode === expectedStatus) {
        resolve();
        return;
      }
      reject(new Error(`${url} returned ${res.statusCode}, expected ${expectedStatus}`));
    });
    req.on('error', reject);
    req.setTimeout(5_000, () => req.destroy(new Error(`${url} timed out`)));
  });
}

function expectWebSocketOpen(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket did not open: ${url}`));
    }, 5_000);
    ws.once('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve();
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopApp(app, sidecarPid) {
  if (sidecarPid) {
    try {
      process.kill(sidecarPid, 'SIGTERM');
    } catch {}
  }
  if (app.exitCode === null && app.signalCode === null) {
    app.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => app.once('exit', resolve)),
      sleep(10_000).then(() => {
        app.kill('SIGKILL');
      }),
    ]);
  }
}

async function waitForPortClosed(host, port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await canConnect(host, port))) return;
    await sleep(250);
  }
  throw new Error(`Sidecar port remained open after app shutdown: ${host}:${port}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForProcessExit(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(250);
  }
  throw new Error(`Sidecar process remained after app shutdown: pid=${pid}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
