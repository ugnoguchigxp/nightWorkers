import fs from 'node:fs/promises';
import path from 'node:path';
import { formatFileSystemToolError } from './fs-error';
import {
  buildReadCacheMarker,
  compressReadFileContent,
  getReadCacheKey,
  type ReadFileCacheEntry,
  type ToolOutputCompressionMetadata,
  updateReadCache,
} from './output-compression';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

export interface ReadFileInput {
  filePath: string;
  repoRoot: string;
  startLine?: number; // 1-indexed, inclusive
  endLine?: number; // 1-indexed, inclusive
  fresh?: boolean;
  compressionMode?: 'auto' | 'off';
  readCache?: Map<string, ReadFileCacheEntry>;
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface ReadFileOutput {
  content: string;
  totalLines: number;
  linesReturned: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  cached?: boolean;
  contentHash?: string;
  compression?: ToolOutputCompressionMetadata;
}

export async function readFileTool(
  input: ReadFileInput
): Promise<WorkerToolResult<ReadFileOutput>> {
  const startedAt = new Date().toISOString();
  const {
    filePath,
    repoRoot,
    startLine = 1,
    endLine,
    fresh = false,
    compressionMode = 'auto',
    readCache,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(absoluteRepoRoot, filePath);

  const pathDecision = enforcePathPolicy(targetPath, {
    repoRoot,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  });
  if (!pathDecision.allowed) {
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
        message:
          pathDecision.message || `Access to path is denied by security policies: ${filePath}`,
      },
    };
  }

  try {
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);
    const totalLines = lines.length;
    const now = new Date().toISOString();
    const explicitRange = Boolean(input.startLine || input.endLine);
    const previousCacheEntry = readCache?.get(getReadCacheKey(targetPath));
    const cacheUpdate = readCache
      ? updateReadCache({
          cache: readCache,
          absolutePath: targetPath,
          content: rawContent,
          totalLines,
          now,
        })
      : undefined;
    const contentHash = cacheUpdate?.contentHash;

    if (compressionMode !== 'off' && !fresh && !explicitRange && readCache) {
      const cacheEntry = previousCacheEntry;
      if (cacheEntry && contentHash) {
        if (cacheEntry.contentHash === contentHash) {
          const marker = buildReadCacheMarker({ filePath, entry: cacheEntry });
          return {
            ok: true,
            toolName: 'read_file',
            startedAt,
            finishedAt: new Date().toISOString(),
            payload: {
              content: marker.content,
              totalLines,
              linesReturned: 0,
              startLine: 0,
              endLine: 0,
              truncated: true,
              cached: true,
              contentHash,
              compression: marker.compression,
            },
          };
        }
      }
    }

    if (compressionMode !== 'off' && !explicitRange) {
      const compressed = compressReadFileContent({
        filePath,
        rawContent,
        lines,
        contentHash,
      });
      if (compressed.compression) {
        return {
          ok: true,
          toolName: 'read_file',
          startedAt,
          finishedAt: new Date().toISOString(),
          payload: {
            content: compressed.content,
            totalLines,
            linesReturned: compressed.linesReturned,
            startLine: 1,
            endLine: totalLines,
            truncated: true,
            cached: false,
            contentHash,
            compression: compressed.compression,
          },
        };
      }
    }

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
        cached: false,
        contentHash,
      },
    };
  } catch (err) {
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
      error: formatFileSystemToolError({
        error: err,
        notFoundCode: 'FILE_NOT_FOUND',
        notFoundMessage: `File not found: ${filePath}`,
        fallbackCode: 'READ_FAILED',
        fallbackMessagePrefix: 'Failed to read file',
      }),
    };
  }
}
