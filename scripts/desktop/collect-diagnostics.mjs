import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDir, '../..');
const MAX_LISTED_FILES = 300;
const MAX_LOG_CHARACTERS = 40_000;

function commandOutput(command, args, root) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return String(result.stdout || result.stderr || '').trim() || null;
}

function readPackageVersion(root, packageName) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName] ?? null;
  } catch {
    return null;
  }
}

function pathState(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    const stats = fs.statSync(absolutePath);
    return {
      path: relativePath,
      exists: true,
      type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
      size: stats.size,
      executable: Boolean(stats.mode & 0o111),
    };
  } catch {
    return { path: relativePath, exists: false };
  }
}

function listFiles(root, relativeRoot, limit = MAX_LISTED_FILES) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (absoluteDirectory) => {
    if (files.length >= limit) return;
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) return;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const stats = fs.statSync(absolutePath);
      files.push({
        path: path.relative(root, absolutePath).split(path.sep).join('/'),
        size: stats.size,
        executable: Boolean(stats.mode & 0o111),
      });
    }
  };
  visit(absoluteRoot);
  return files;
}

function readLogTail(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  const content = fs.readFileSync(absolutePath, 'utf8');
  return content.slice(-MAX_LOG_CHARACTERS);
}

export function collectDesktopDiagnostics(options = {}) {
  const root = options.root ?? defaultRoot;
  const mode = options.mode ?? 'postmortem';
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const expectedTarget = options.expectedTarget ?? null;
  const actualTarget = `${platform}:${arch}`;
  const env = options.env ?? process.env;
  const versionResolver =
    options.versionResolver ?? ((command, args) => commandOutput(command, args, root));
  const sourceSha =
    env.GITHUB_SHA || versionResolver('git', ['rev-parse', 'HEAD']) || '<unavailable>';
  const dirtyOutput = versionResolver('git', ['status', '--porcelain=v1']);
  const packageVersion = (packageName) => readPackageVersion(root, packageName);

  const diagnostics = {
    schemaVersion: 'nightworkers.desktop-diagnostics/v1',
    mode,
    capturedAt: (options.now ?? new Date()).toISOString(),
    source: {
      commitSha: sourceSha,
      dirty: Boolean(dirtyOutput),
    },
    workflow: {
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : null,
      job: env.GITHUB_JOB ?? null,
    },
    runner: {
      platform,
      arch,
      actualTarget,
      expectedTarget,
      targetMatches: expectedTarget ? expectedTarget === actualTarget : null,
    },
    versions: {
      node: process.version,
      bun: versionResolver('bun', ['--version']),
      rustc: versionResolver('rustc', ['--version']),
      cargo: versionResolver('cargo', ['--version']),
      tauriCli: packageVersion('@tauri-apps/cli'),
      tauriApi: packageVersion('@tauri-apps/api'),
    },
    paths: [
      pathState(root, 'dist'),
      pathState(root, 'dist-api-desktop'),
      pathState(root, 'scripts/desktop/staged'),
      pathState(root, 'scripts/desktop/staged/manifest.json'),
      pathState(root, 'src-tauri/target/release/bundle'),
    ],
    stagedFiles: listFiles(root, 'scripts/desktop/staged'),
    bundleFiles: listFiles(root, 'src-tauri/target/release/bundle'),
    logs: {
      verifyDesktop: readLogTail(root, 'artifacts/verify-desktop.log'),
      verifyRelease: readLogTail(root, 'artifacts/verify-release.log'),
    },
  };

  const artifactsDirectory = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsDirectory, { recursive: true });
  const outputPath = path.join(artifactsDirectory, `desktop-${mode}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(diagnostics, null, 2)}\n`, 'utf8');

  if (mode === 'preflight' && expectedTarget && expectedTarget !== actualTarget) {
    throw new Error(
      `Desktop runner target mismatch: expected=${expectedTarget} actual=${actualTarget}; diagnostics=${outputPath}`,
    );
  }
  return { diagnostics, outputPath };
}

function parseArgs(argv) {
  const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'postmortem';
  const targetIndex = argv.indexOf('--expected-target');
  return {
    mode,
    expectedTarget: targetIndex >= 0 ? argv[targetIndex + 1] : null,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = collectDesktopDiagnostics(parseArgs(process.argv.slice(2)));
    console.log(`Desktop ${result.diagnostics.mode} diagnostics: ${result.outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
