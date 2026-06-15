import fs from 'node:fs/promises';
import path from 'node:path';
import { unknownErrorMessage } from '../../../shared/json-record';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const DEFAULT_EXCLUDES = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-api',
  'build',
  '.next',
  'coverage',
]);

export interface CopyDirectoryInput {
  sourcePath: string;
  targetPath?: string;
  repoRoot: string;
  overwrite?: boolean;
  exclude?: string[];
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface CopyDirectoryOutput {
  sourcePath: string;
  targetPath: string;
  copiedFiles: number;
  skippedFiles: number;
  copiedDirectories: number;
}

export async function copyDirectoryTool(
  input: CopyDirectoryInput
): Promise<WorkerToolResult<CopyDirectoryOutput>> {
  const startedAt = new Date().toISOString();
  const absoluteRepoRoot = path.resolve(input.repoRoot);
  const sourcePath = path.isAbsolute(input.sourcePath)
    ? path.resolve(input.sourcePath)
    : path.resolve(absoluteRepoRoot, input.sourcePath);
  const targetPath = path.resolve(absoluteRepoRoot, input.targetPath || '.');
  const emptyPayload = {
    sourcePath,
    targetPath,
    copiedFiles: 0,
    skippedFiles: 0,
    copiedDirectories: 0,
  };

  const sourcePolicy = enforcePathPolicy(sourcePath, {
    repoRoot: absoluteRepoRoot,
    allowedPaths: input.allowedPaths,
    externalAllowedPaths: input.externalAllowedPaths,
    deniedPaths: input.deniedPaths,
  });
  if (!sourcePolicy.allowed) {
    return {
      ok: false,
      toolName: 'copy_directory',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: emptyPayload,
      error: {
        code: 'ACCESS_DENIED',
        message: sourcePolicy.message || `Copy source is restricted by policy: ${input.sourcePath}`,
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
      toolName: 'copy_directory',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: emptyPayload,
      error: {
        code: 'ACCESS_DENIED',
        message: targetPolicy.message || `Copy target is restricted by policy: ${input.targetPath}`,
      },
    };
  }

  const relativeTarget = path.relative(absoluteRepoRoot, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return {
      ok: false,
      toolName: 'copy_directory',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: emptyPayload,
      error: {
        code: 'ACCESS_DENIED',
        message: 'Copy target must stay inside the project root.',
      },
    };
  }

  try {
    const sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isDirectory()) {
      return {
        ok: false,
        toolName: 'copy_directory',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: emptyPayload,
        error: {
          code: 'NOT_A_DIRECTORY',
          message: `Copy source must be a directory: ${input.sourcePath}`,
        },
      };
    }

    const excludes = new Set([...DEFAULT_EXCLUDES, ...(input.exclude || [])]);
    let copiedFiles = 0;
    let skippedFiles = 0;
    let copiedDirectories = 0;

    const copyRecursive = async (sourceDir: string, destinationDir: string) => {
      await fs.mkdir(destinationDir, { recursive: true });
      copiedDirectories += 1;
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (excludes.has(entry.name)) continue;
        const source = path.join(sourceDir, entry.name);
        const destination = path.join(destinationDir, entry.name);
        const policy = enforcePathPolicy(source, {
          repoRoot: absoluteRepoRoot,
          allowedPaths: input.allowedPaths,
          externalAllowedPaths: input.externalAllowedPaths,
          deniedPaths: input.deniedPaths,
        });
        if (!policy.allowed) continue;
        if (entry.isDirectory()) {
          await copyRecursive(source, destination);
          continue;
        }
        if (!entry.isFile()) continue;
        const exists = await fs
          .stat(destination)
          .then(() => true)
          .catch(() => false);
        if (exists && !input.overwrite) {
          skippedFiles += 1;
          continue;
        }
        await fs.copyFile(source, destination);
        copiedFiles += 1;
      }
    };

    await copyRecursive(sourcePath, targetPath);
    return {
      ok: true,
      toolName: 'copy_directory',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { sourcePath, targetPath, copiedFiles, skippedFiles, copiedDirectories },
    };
  } catch (error) {
    return {
      ok: false,
      toolName: 'copy_directory',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: emptyPayload,
      error: {
        code: 'COPY_DIRECTORY_FAILED',
        message: `Directory copy failed: ${unknownErrorMessage(error)}`,
      },
    };
  }
}
