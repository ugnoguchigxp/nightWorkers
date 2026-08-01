import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createDependencyAuditFingerprint,
  createDependencyAuditState,
  evaluateDependencyAuditCadence,
} from './dependency-audit-cadence.mjs';

const workspaceRoot = process.cwd();
const packageManifestPath = path.join(workspaceRoot, 'package.json');
const lockfilePath = path.join(workspaceRoot, 'bun.lock');
const policyPath = path.join(
  workspaceRoot,
  'config',
  'dependency-audit-allowlist.json',
);
const auditRunnerPath = path.join(workspaceRoot, 'scripts', 'audit-dependencies.mjs');
const auditPolicyPath = path.join(
  workspaceRoot,
  'scripts',
  'dependency-audit-policy.mjs',
);

function resolveStatePath() {
  if (process.env.NIGHTWORKERS_DEPENDENCY_AUDIT_STATE_PATH) {
    return path.resolve(process.env.NIGHTWORKERS_DEPENDENCY_AUDIT_STATE_PATH);
  }
  const result = spawnSync(
    'git',
    ['rev-parse', '--git-path', 'nightworkers/dependency-audit-state.json'],
    { cwd: workspaceRoot, encoding: 'utf8' },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error('Unable to resolve the Git-local dependency audit state path.');
  }
  return path.resolve(workspaceRoot, result.stdout.trim());
}

function readState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporaryPath, statePath);
}

const fingerprint = createDependencyAuditFingerprint({
  'package.json': fs.readFileSync(packageManifestPath),
  'bun.lock': fs.readFileSync(lockfilePath),
  'config/dependency-audit-allowlist.json': fs.readFileSync(policyPath),
  'scripts/audit-dependencies.mjs': fs.readFileSync(auditRunnerPath),
  'scripts/dependency-audit-policy.mjs': fs.readFileSync(auditPolicyPath),
});
const statePath = resolveStatePath();
const cadence = evaluateDependencyAuditCadence({
  state: readState(statePath),
  fingerprint,
  force: process.env.NIGHTWORKERS_FORCE_DEPENDENCY_AUDIT === '1',
});

if (!cadence.shouldRun) {
  console.log(
    `[audit-weekly] skipped: last successful result is current; next audit after ${cadence.nextAuditAt}`,
  );
  process.exit(0);
}

console.log(`[audit-weekly] running dependency audit: ${cadence.reason}`);
const audit = spawnSync('bun', ['run', 'audit:dependencies'], {
  cwd: workspaceRoot,
  env: process.env,
  stdio: 'inherit',
});
if (audit.error) throw audit.error;
if (audit.status !== 0) {
  console.error(
    '[audit-weekly] dependency audit failed; repair the findings and rerun verify.',
  );
  process.exit(audit.status ?? 1);
}

writeState(statePath, createDependencyAuditState(fingerprint));
console.log(`[audit-weekly] successful result recorded at ${statePath}`);
