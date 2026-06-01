import fs from 'node:fs/promises';
import path from 'node:path';
import { getRelativePath, isPathSafe } from './path-policy';
import type { WorkerToolResult } from './types';

export interface ListDirInput {
  relativePath?: string;
  repoRoot: string;
  recursive?: boolean;
  skipIgnored?: boolean;
  maxEntries?: number;
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface ListDirOutput {
  dirs: string[];
  files: string[];
  truncated: boolean;
}

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);

export async function listDirTool(input: ListDirInput): Promise<WorkerToolResult<ListDirOutput>> {
  const startedAt = new Date().toISOString();
  const {
    relativePath = '.',
    repoRoot,
    recursive = false,
    skipIgnored = true,
    maxEntries = 1000,
    allowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetPath = path.resolve(absoluteRepoRoot, relativePath);

  if (!isPathSafe(targetPath, absoluteRepoRoot, allowedPaths, deniedPaths)) {
    return {
      ok: false,
      toolName: 'list_dir',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { dirs: [], files: [], truncated: false },
      error: {
        code: 'ACCESS_DENIED',
        message: `Directory listing is restricted by policy: ${relativePath}`,
      },
    };
  }

  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        toolName: 'list_dir',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: { dirs: [], files: [], truncated: false },
        error: {
          code: 'NOT_A_DIRECTORY',
          message: `Target path is not a directory: ${relativePath}`,
        },
      };
    }

    const dirs: string[] = [];
    const files: string[] = [];
    let truncated = false;

    const scan = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (!isPathSafe(fullPath, absoluteRepoRoot, allowedPaths, deniedPaths)) continue;

        if (entry.isDirectory()) {
          if (skipIgnored && DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
          dirs.push(getRelativePath(fullPath, absoluteRepoRoot));
          if (dirs.length + files.length >= maxEntries) {
            truncated = true;
            return;
          }
          if (recursive) {
            await scan(fullPath);
            if (truncated) return;
          }
        } else if (entry.isFile()) {
          files.push(getRelativePath(fullPath, absoluteRepoRoot));
          if (dirs.length + files.length >= maxEntries) {
            truncated = true;
            return;
          }
        }
      }
    };

    await scan(targetPath);

    return {
      ok: true,
      toolName: 'list_dir',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { dirs, files, truncated },
    };
  } catch (err: any) {
    return {
      ok: false,
      toolName: 'list_dir',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { dirs: [], files: [], truncated: false },
      error: {
        code: 'LIST_DIR_FAILED',
        message: `Failed to list directory: ${err.message}`,
      },
    };
  }
}
