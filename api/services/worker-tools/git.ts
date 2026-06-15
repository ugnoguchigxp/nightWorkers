import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { toDeepRecord } from '../../../shared/json-record';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);

export interface GitStatusInput {
  repoRoot: string;
}

export interface GitStatusOutput {
  branch: string;
  isDirty: boolean;
  untrackedCount: number;
  modifiedCount: number;
  shortStatus: string;
}

export async function gitStatusTool(
  input: GitStatusInput
): Promise<WorkerToolResult<GitStatusOutput>> {
  const startedAt = new Date().toISOString();
  const { repoRoot } = input;
  const absoluteRepoRoot = path.resolve(repoRoot);

  try {
    const [branchResult, statusResult] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: absoluteRepoRoot }).catch(() => ({
        stdout: 'unknown',
      })),
      execAsync('git status --porcelain', { cwd: absoluteRepoRoot }),
    ]);

    const branch = branchResult.stdout.trim();
    const shortStatus = statusResult.stdout.trim();
    const lines = shortStatus.split('\n').filter((l) => l.length > 0);

    let untrackedCount = 0;
    let modifiedCount = 0;

    for (const line of lines) {
      if (line.startsWith('??')) {
        untrackedCount++;
      } else {
        modifiedCount++;
      }
    }

    const isDirty = modifiedCount > 0 || untrackedCount > 0;

    return {
      ok: true,
      toolName: 'git_status',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        branch,
        isDirty,
        untrackedCount,
        modifiedCount,
        shortStatus,
      },
    };
  } catch (err) {
    const error = toDeepRecord(err);
    const errorMessage = String(error.message || '');
    const isNotRepo =
      errorMessage.includes('not a git repository') ||
      errorMessage.includes('not a git command') ||
      errorMessage.includes('git: command not found') ||
      errorMessage.includes('ENOENT');

    if (isNotRepo) {
      return {
        ok: true,
        toolName: 'git_status',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: {
          branch: 'none (not a git repository)',
          isDirty: false,
          untrackedCount: 0,
          modifiedCount: 0,
          shortStatus: '',
        },
      };
    }

    return {
      ok: false,
      toolName: 'git_status',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        branch: 'unknown',
        isDirty: false,
        untrackedCount: 0,
        modifiedCount: 0,
        shortStatus: '',
      },
      error: {
        code: 'GIT_STATUS_FAILED',
        message: `Failed to check git status: ${errorMessage || String(err)}`,
      },
    };
  }
}

export interface GitDiffInput {
  repoRoot: string;
}

export interface GitDiffOutput {
  diff: string;
  diffStat: string;
  hasChanges: boolean;
}

async function collectUntrackedDiff(repoRoot: string): Promise<{ diff: string; stat: string }> {
  const { stdout } = await execAsync('git ls-files --others --exclude-standard', {
    cwd: repoRoot,
  }).catch(() => ({ stdout: '' }));
  const files = stdout
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  if (files.length === 0) return { diff: '', stat: '' };

  const chunks: string[] = [];
  for (const file of files) {
    const target = path.resolve(repoRoot, file);
    const content = await fs.readFile(target, 'utf-8').catch(() => '');
    const lines =
      content.length === 0
        ? []
        : content.endsWith('\n')
          ? content.slice(0, -1).split('\n')
          : content.split('\n');
    chunks.push(
      [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        'index 0000000..0000000',
        '--- /dev/null',
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines,
      ]
        .map((line, index) => (index >= 6 ? `+${line}` : line))
        .join('\n')
    );
  }

  return {
    diff: `${chunks.join('\n')}\n`,
    stat: files.map((file) => ` ${file} | untracked`).join('\n'),
  };
}

export async function gitDiffTool(input: GitDiffInput): Promise<WorkerToolResult<GitDiffOutput>> {
  const startedAt = new Date().toISOString();
  const { repoRoot } = input;
  const absoluteRepoRoot = path.resolve(repoRoot);

  try {
    const hasHead = await execAsync('git rev-parse --verify HEAD', {
      cwd: absoluteRepoRoot,
    })
      .then(() => true)
      .catch(() => false);
    const diffCommand = hasHead ? 'git diff HEAD' : 'git diff --cached';
    const diffStatCommand = hasHead ? 'git diff --stat HEAD' : 'git diff --cached --stat';
    const [diffResult, diffStatResult, untracked] = await Promise.all([
      execAsync(diffCommand, { cwd: absoluteRepoRoot }),
      execAsync(diffStatCommand, { cwd: absoluteRepoRoot }).catch(() => ({ stdout: '' })),
      collectUntrackedDiff(absoluteRepoRoot),
    ]);

    const diff = [diffResult.stdout, untracked.diff].filter(Boolean).join('\n');
    const diffStat = [diffStatResult.stdout.trim(), untracked.stat].filter(Boolean).join('\n');
    const hasChanges = diff.trim().length > 0;

    // Secret Redaction Hook
    let redactedDiff = diff;
    const SECRET_PATTERNS = [
      /password\s*=\s*['"][^'"]+['"]/gi,
      /api_?key\s*=\s*['"][^'"]+['"]/gi,
      /secret\s*=\s*['"][^'"]+['"]/gi,
      /bearer\s+[^"' ]+/gi,
      /token\s*=\s*['"][^'"]+['"]/gi,
    ];
    for (const pattern of SECRET_PATTERNS) {
      redactedDiff = redactedDiff.replace(pattern, (match) => {
        const parts = match.split('=');
        if (parts.length > 1) {
          return `${parts[0]}=[REDACTED]`;
        }
        return '[REDACTED]';
      });
    }

    return {
      ok: true,
      toolName: 'git_diff',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        diff: redactedDiff,
        diffStat,
        hasChanges,
      },
    };
  } catch (err) {
    const error = toDeepRecord(err);
    const errorMessage = String(error.message || '');
    const isNotRepo =
      errorMessage.includes('not a git repository') ||
      errorMessage.includes('not a git command') ||
      errorMessage.includes('git: command not found') ||
      errorMessage.includes('ENOENT');

    if (isNotRepo) {
      return {
        ok: true,
        toolName: 'git_diff',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: {
          diff: '',
          diffStat: '',
          hasChanges: false,
        },
      };
    }

    return {
      ok: false,
      toolName: 'git_diff',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        diff: '',
        diffStat: '',
        hasChanges: false,
      },
      error: {
        code: 'GIT_DIFF_FAILED',
        message: `Failed to check git diff: ${errorMessage || String(err)}`,
      },
    };
  }
}
