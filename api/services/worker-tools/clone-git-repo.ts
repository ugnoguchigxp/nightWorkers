import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getDeepRecordString, unknownErrorMessage } from '../../../shared/json-record';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const execFileAsync = promisify(execFile);

const EMPTY_TARGET_IGNORES = new Set(['.git', '.DS_Store']);

export interface CloneGitRepoInput {
  repoUrl: string;
  targetPath?: string;
  ref?: string;
  depth?: number;
  overwrite?: boolean;
  stripGitDir?: boolean;
  repoRoot: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface CloneGitRepoOutput {
  repoUrl: string;
  ref: string | null;
  commit: string | null;
  targetPath: string;
  copiedFiles: number;
  copiedDirectories: number;
  strippedGitDir: boolean;
  gitOperations: CloneGitOperationOutput[];
}

export type CloneGitOperationOutput = {
  command: string;
  cwd: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
};

function emptyPayload(input: CloneGitRepoInput, targetPath: string): CloneGitRepoOutput {
  return {
    repoUrl: input.repoUrl,
    ref: input.ref?.trim() || null,
    commit: null,
    targetPath,
    copiedFiles: 0,
    copiedDirectories: 0,
    strippedGitDir: input.stripGitDir !== false,
    gitOperations: [],
  };
}

async function runGit(args: string[], cwd?: string) {
  const result = await execFileAsync('git', args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    command: ['git', ...args].join(' '),
    cwd: cwd ?? null,
    exitCode: 0,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function targetHasMaterialContent(targetPath: string) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch((error: unknown) => {
    if (getDeepRecordString(error, 'code') === 'ENOENT') return [];
    throw error;
  });
  return entries.some((entry) => !EMPTY_TARGET_IGNORES.has(entry.name));
}

async function clearDirectoryContents(targetPath: string) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch((error: unknown) => {
    if (getDeepRecordString(error, 'code') === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    await fs.rm(path.join(targetPath, entry.name), { recursive: true, force: true });
  }
}

function deriveTargetPath(repoUrl: string): string {
  const normalized = repoUrl.trim().replace(/\/+$/, '');
  const lastSegment = normalized.split(/[/:]/).filter(Boolean).pop() || 'imported-repo';
  const stripped = lastSegment.endsWith('.git') ? lastSegment.slice(0, -4) : lastSegment;
  return stripped || 'imported-repo';
}

export async function cloneGitRepoTool(
  input: CloneGitRepoInput
): Promise<WorkerToolResult<CloneGitRepoOutput>> {
  const startedAt = new Date().toISOString();
  const absoluteRepoRoot = path.resolve(input.repoRoot);
  const relativeTargetInput = (input.targetPath || deriveTargetPath(input.repoUrl)).trim();
  const targetPath = path.resolve(absoluteRepoRoot, relativeTargetInput || '.');
  const failedPayload = emptyPayload(input, targetPath);
  const repoUrl = input.repoUrl.trim();
  const stripGitDir = input.stripGitDir !== false;
  const targetIsRepoRoot = targetPath === absoluteRepoRoot;

  if (!repoUrl) {
    return {
      ok: false,
      toolName: 'clone_git_repo',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: failedPayload,
      error: {
        code: 'INVALID_REPO_URL',
        message: 'clone_git_repo requires repoUrl.',
      },
    };
  }

  const targetPolicy = enforcePathPolicy(targetPath, {
    repoRoot: absoluteRepoRoot,
    allowedPaths: input.allowedPaths,
    deniedPaths: input.deniedPaths,
  });
  if (!targetPolicy.allowed) {
    return {
      ok: false,
      toolName: 'clone_git_repo',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: failedPayload,
      error: {
        code: 'ACCESS_DENIED',
        message:
          targetPolicy.message || `Clone target is restricted by policy: ${relativeTargetInput}`,
      },
    };
  }

  const relativeTarget = path.relative(absoluteRepoRoot, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return {
      ok: false,
      toolName: 'clone_git_repo',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: failedPayload,
      error: {
        code: 'ACCESS_DENIED',
        message: 'Clone target must stay inside the project root.',
      },
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-clone-'));
  try {
    if (input.overwrite) {
      if (targetIsRepoRoot) {
        await fs.mkdir(targetPath, { recursive: true });
        await clearDirectoryContents(targetPath);
      } else {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
    } else {
      await fs.mkdir(targetPath, { recursive: true });
      if (await targetHasMaterialContent(targetPath)) {
        return {
          ok: false,
          toolName: 'clone_git_repo',
          startedAt,
          finishedAt: new Date().toISOString(),
          payload: failedPayload,
          error: {
            code: 'TARGET_NOT_EMPTY',
            message:
              'Clone target already contains files. Pass overwrite=true only when replacing existing files is intended.',
          },
        };
      }
      if (!targetIsRepoRoot) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
    }

    const cloneDir = path.join(tempDir, 'repo');
    const depth =
      typeof input.depth === 'number' && Number.isFinite(input.depth) && input.depth > 0
        ? Math.max(1, Math.floor(input.depth))
        : 1;
    const cloneArgs = input.ref
      ? ['clone', repoUrl, cloneDir]
      : ['clone', '--depth', String(depth), repoUrl, cloneDir];
    const gitOperations: CloneGitOperationOutput[] = [];
    gitOperations.push(await runGit(cloneArgs, tempDir));

    const normalizedRef = input.ref?.trim();
    if (normalizedRef) gitOperations.push(await runGit(['checkout', normalizedRef], cloneDir));
    const revParseResult = await runGit(['rev-parse', 'HEAD'], cloneDir);
    gitOperations.push(revParseResult);
    const commit = revParseResult.stdout || null;
    if (stripGitDir) {
      await fs.rm(path.join(cloneDir, '.git'), { recursive: true, force: true });
    }

    let copiedFiles = 0;
    let copiedDirectories = 0;
    const copyRecursive = async (sourceDir: string, destinationDir: string) => {
      await fs.mkdir(destinationDir, { recursive: true });
      copiedDirectories += 1;
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        const source = path.join(sourceDir, entry.name);
        const destination = path.join(destinationDir, entry.name);
        if (entry.isDirectory()) {
          await copyRecursive(source, destination);
          continue;
        }
        if (!entry.isFile()) continue;
        await fs.copyFile(source, destination);
        copiedFiles += 1;
      }
    };

    await copyRecursive(cloneDir, targetPath);
    return {
      ok: true,
      toolName: 'clone_git_repo',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        repoUrl,
        ref: normalizedRef || null,
        commit,
        targetPath,
        copiedFiles,
        copiedDirectories,
        strippedGitDir: stripGitDir,
        gitOperations,
      },
    };
  } catch (error) {
    return {
      ok: false,
      toolName: 'clone_git_repo',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: failedPayload,
      error: {
        code: 'CLONE_GIT_REPO_FAILED',
        message: `Git clone failed: ${unknownErrorMessage(error)}`,
      },
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
