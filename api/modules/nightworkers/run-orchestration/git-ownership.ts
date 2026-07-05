import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as repo from '../nightworkers.repository';
import { toErrorMessage } from './utils';

const execFileAsync = promisify(execFile);

function parseGitPorcelainZ(output: string) {
  const entries: Array<{ status: string; path: string }> = [];
  const tokens = output.split('\0').filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const status = token.slice(0, 2);
    const filePath = token.slice(3);
    if (!filePath) continue;
    entries.push({ status, path: filePath });
    if (status.includes('R') || status.includes('C')) {
      const nextPath = tokens[index + 1];
      if (nextPath) entries.push({ status, path: nextPath });
      index += 1;
    }
  }
  return entries;
}

export function parseChangedPathsFromDiff(diffPatch?: string | null) {
  if (!diffPatch) return [];
  const paths = new Set<string>();
  for (const line of diffPatch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) continue;
    if (match[1] !== '/dev/null') paths.add(match[1]);
    if (match[2] !== '/dev/null') paths.add(match[2]);
  }
  return [...paths].sort();
}

function normalizeVerificationStatus(
  testResults: unknown
): 'not_run' | 'passed' | 'failed' | 'partial' {
  if (!testResults || typeof testResults !== 'object') return 'not_run';
  const record = testResults as Record<string, unknown>;
  const status = String(record.status || record.outcome || '').toLowerCase();
  if (status === 'passed' || status === 'pass' || status === 'success') return 'passed';
  if (status === 'failed' || status === 'fail' || status === 'error') return 'failed';
  return 'partial';
}

export async function readGitBaseline(repoRoot: string): Promise<{
  status: 'pending' | 'not_requested';
  baselineHead: string | null;
  baselineStatusJson: Array<{ status: string; path: string }> | null;
  preExistingDirtyPaths: string[];
  statusReason: string | null;
}> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot });
  } catch (error) {
    return {
      status: 'not_requested',
      baselineHead: null,
      baselineStatusJson: null,
      preExistingDirtyPaths: [],
      statusReason: `Repository is not a git work tree: ${toErrorMessage(error)}`,
    };
  }

  let baselineHead: string | null = null;
  try {
    const head = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot });
    baselineHead = head.stdout.trim() || null;
  } catch {
    baselineHead = null;
  }

  const status = await execFileAsync('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot });
  const baselineStatusJson = parseGitPorcelainZ(status.stdout);
  return {
    status: 'pending',
    baselineHead,
    baselineStatusJson,
    preExistingDirtyPaths: baselineStatusJson.map((entry) => entry.path).sort(),
    statusReason: null,
  };
}

export async function updateCommitOwnershipEvidence(input: {
  runId: string;
  diffPatch?: string | null;
  testResults?: unknown;
}) {
  const record = await repo.getTaskRunCommitRecord(input.runId);
  if (!record || record.status === 'not_requested') return;
  const ownedCandidatePaths = parseChangedPathsFromDiff(input.diffPatch);
  const preExistingDirtyPaths = new Set(record.preExistingDirtyPathsJson ?? []);
  const stageableOwnedPaths = ownedCandidatePaths.filter(
    (path) => !preExistingDirtyPaths.has(path)
  );
  const excludedPaths = ownedCandidatePaths
    .filter((path) => preExistingDirtyPaths.has(path))
    .map((path) => ({ path, reason: 'pre_existing_dirty_path' }));
  const verificationStatus = normalizeVerificationStatus(input.testResults);
  const verificationAllowsCommit =
    verificationStatus === 'passed' || verificationStatus === 'partial';
  const status =
    ownedCandidatePaths.length === 0
      ? 'not_requested'
      : stageableOwnedPaths.length === 0
        ? 'needs_human'
        : verificationAllowsCommit
          ? 'ready'
          : 'needs_human';
  const statusReason =
    ownedCandidatePaths.length === 0
      ? 'No runtime-owned diff paths were detected.'
      : stageableOwnedPaths.length === 0
        ? 'Runtime-edited paths overlapped with pre-existing dirty paths.'
        : !verificationAllowsCommit
          ? 'Runtime-owned paths were detected, but verification did not pass.'
          : 'Runtime-owned clean-baseline paths are ready for explicit commit closeout.';
  await repo.updateTaskRunCommitRecord(input.runId, {
    status,
    ownedCandidatePaths,
    stageableOwnedPaths,
    excludedPaths,
    verificationStatus,
    verificationEvidenceJson: input.testResults ?? null,
    statusReason,
  });
}
