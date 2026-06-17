import fs from 'node:fs/promises';
import path from 'node:path';
import { formatFileSystemToolError } from './fs-error';
import { getRelativePath, isPathSafe } from './path-policy';
import type { WorkerToolResult } from './types';

export interface FindFileInput {
  fileMask: string;
  repoRoot: string;
  relativePath?: string;
  recursive?: boolean;
  maxResults?: number;
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface FindFileOutput {
  files: string[];
  count: number;
}

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
  return new RegExp(regex);
}

export async function findFileTool(
  input: FindFileInput
): Promise<WorkerToolResult<FindFileOutput>> {
  const startedAt = new Date().toISOString();
  const {
    fileMask,
    repoRoot,
    relativePath = '.',
    recursive = true,
    maxResults = 200,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const startDir = path.resolve(absoluteRepoRoot, relativePath);

  if (!isPathSafe(startDir, absoluteRepoRoot, allowedPaths, deniedPaths, externalAllowedPaths)) {
    return {
      ok: false,
      toolName: 'find_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { files: [], count: 0 },
      error: {
        code: 'ACCESS_DENIED',
        message: `File search is restricted by policy: ${relativePath}`,
      },
    };
  }

  const fileNamePattern = wildcardToRegExp(fileMask);
  const files: string[] = [];

  try {
    const scan = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (
          !isPathSafe(fullPath, absoluteRepoRoot, allowedPaths, deniedPaths, externalAllowedPaths)
        )
          continue;

        if (entry.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
          if (recursive) {
            await scan(fullPath);
            if (files.length >= maxResults) return;
          }
        } else if (entry.isFile()) {
          if (fileNamePattern.test(entry.name)) {
            files.push(getRelativePath(fullPath, absoluteRepoRoot));
            if (files.length >= maxResults) return;
          }
        }
      }
    };

    await scan(startDir);
    return {
      ok: true,
      toolName: 'find_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { files, count: files.length },
    };
  } catch (err) {
    return {
      ok: false,
      toolName: 'find_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { files: [], count: 0 },
      error: formatFileSystemToolError({
        error: err,
        notFoundCode: 'DIRECTORY_NOT_FOUND',
        notFoundMessage: `Directory not found: ${relativePath}`,
        fallbackCode: 'FIND_FILE_FAILED',
        fallbackMessagePrefix: 'Failed to find files',
      }),
    };
  }
}
