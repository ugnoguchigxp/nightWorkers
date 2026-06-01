import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathSafe } from './path-policy';
import type { WorkerToolResult } from './types';

export interface ReadFileInput {
  filePath: string;
  repoRoot: string;
  startLine?: number; // 1-indexed, inclusive
  endLine?: number; // 1-indexed, inclusive
  allowedPaths?: string[];
  deniedPaths?: string[];
}

export interface ReadFileOutput {
  content: string;
  totalLines: number;
  linesReturned: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export async function readFileTool(
  input: ReadFileInput
): Promise<WorkerToolResult<ReadFileOutput>> {
  const startedAt = new Date().toISOString();
  const { filePath, repoRoot, startLine = 1, endLine, allowedPaths, deniedPaths } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(absoluteRepoRoot, filePath);

  if (!isPathSafe(targetPath, repoRoot, allowedPaths, deniedPaths)) {
    return {
      ok: false,
      toolName: 'read_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        content: '',
        totalLines: 0,
        linesReturned: 0,
        startLine: 0,
        endLine: 0,
        truncated: false,
      },
      error: {
        code: 'ACCESS_DENIED',
        message: `Access to path is denied by security policies: ${filePath}`,
      },
    };
  }

  try {
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);
    const totalLines = lines.length;

    const actualStart = Math.max(1, Math.min(startLine, totalLines));
    const actualEnd = endLine ? Math.max(actualStart, Math.min(endLine, totalLines)) : totalLines;

    // Apply strict limit to line read count (e.g. max 1000 lines per tool call to avoid context overflow)
    const MAX_LINES = 1000;
    let linesReturned = actualEnd - actualStart + 1;
    let finalEnd = actualEnd;
    let truncated = false;

    if (linesReturned > MAX_LINES) {
      finalEnd = actualStart + MAX_LINES - 1;
      linesReturned = MAX_LINES;
      truncated = true;
    }

    const selectedLines = lines.slice(actualStart - 1, finalEnd);
    const lineNumbered = selectedLines
      .map((line, idx) => `${actualStart + idx}: ${line}`)
      .join('\n');

    return {
      ok: true,
      toolName: 'read_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        content: lineNumbered,
        totalLines,
        linesReturned,
        startLine: actualStart,
        endLine: finalEnd,
        truncated,
      },
    };
  } catch (err: any) {
    return {
      ok: false,
      toolName: 'read_file',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        content: '',
        totalLines: 0,
        linesReturned: 0,
        startLine: 0,
        endLine: 0,
        truncated: false,
      },
      error: {
        code: 'READ_FAILED',
        message: `Failed to read file: ${err.message}`,
      },
    };
  }
}
