import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const implementationExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sql',
  '.sh',
  '.py',
  '.rs',
  '.go',
]);

const excludedPrefixes = [
  'tests/',
  'drizzle/seeds/',
  'docs/assets/',
  'github-pages/site/assets/',
];

function isImplementationFile(file) {
  if (excludedPrefixes.some((prefix) => file.startsWith(prefix))) return false;
  if (file.includes('/__tests__/')) return false;
  if (/\.(test|spec)\.[^.]+$/.test(file)) return false;
  return implementationExtensions.has(path.extname(file));
}

function physicalLineCount(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return source.match(/\n/g)?.length ?? 0;
}

function trackedImplementationFiles(repoRoot) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.split('\0').filter(Boolean).filter(isImplementationFile);
}

export function evaluateLargeSourceFiles(repoRoot = process.cwd()) {
  const baselinePath = path.join(repoRoot, '.agent-ontology/large-source-files.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const entries = Array.isArray(baseline.entries) ? baseline.entries : [];
  const lineLimit = Number(baseline.lineLimit);
  const errors = [];
  const ids = new Set();
  const paths = new Set();

  if (baseline.version !== 1) errors.push('baseline version must be 1');
  if (!Number.isInteger(lineLimit) || lineLimit < 1) {
    errors.push('lineLimit must be a positive integer');
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('every baseline entry must be an object');
      continue;
    }
    if (typeof entry.id !== 'string' || !/^NW-LF-\d{2}$/.test(entry.id)) {
      errors.push(`invalid baseline id: ${String(entry.id)}`);
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate baseline id: ${entry.id}`);
    }
    if (typeof entry.path !== 'string' || !entry.path) {
      errors.push(`baseline entry ${String(entry.id)} has no path`);
    } else if (paths.has(entry.path)) {
      errors.push(`duplicate baseline path: ${entry.path}`);
    }
    if (!Number.isInteger(entry.maxLines) || entry.maxLines <= lineLimit) {
      errors.push(`baseline entry ${String(entry.id)} has invalid maxLines`);
    }
    if (typeof entry.targetModule !== 'string' || !entry.targetModule) {
      errors.push(`baseline entry ${String(entry.id)} has no targetModule`);
    }
    if (!Number.isInteger(entry.phase) || entry.phase < 1 || entry.phase > 8) {
      errors.push(`baseline entry ${String(entry.id)} has invalid phase`);
    }
    ids.add(entry.id);
    paths.add(entry.path);
  }

  const current = new Map();
  for (const file of trackedImplementationFiles(repoRoot)) {
    const absolutePath = path.join(repoRoot, file);
    if (!fs.existsSync(absolutePath)) continue;
    const lines = physicalLineCount(absolutePath);
    if (lines > lineLimit) current.set(file, lines);
  }

  for (const [file, lines] of current) {
    if (!paths.has(file)) {
      errors.push(`new oversized implementation file: ${file} (${lines} lines)`);
    }
  }

  for (const entry of entries) {
    const lines = current.get(entry.path);
    if (lines === undefined) {
      errors.push(
        `stale baseline entry ${entry.id}: ${entry.path} is missing or no longer over ${lineLimit} lines`,
      );
      continue;
    }
    if (lines > entry.maxLines) {
      errors.push(
        `oversized file grew ${entry.id}: ${entry.path} is ${lines} lines (baseline ${entry.maxLines})`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    lineLimit,
    baselineCount: entries.length,
    oversizedCount: current.size,
    errors,
  };
}

function main() {
  const result = evaluateLargeSourceFiles(process.cwd());
  if (!result.ok) {
    console.error('[architecture] large source file check failed');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `[architecture] ${result.oversizedCount} oversized implementation files are bounded by the shrinking baseline`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
