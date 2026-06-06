import fs from 'node:fs/promises';
import path from 'node:path';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

export interface ReplaceContentInput {
  filePath: string;
  repoRoot: string;
  needle: string;
  replacement: string;
  mode: 'literal' | 'regex';
  allowMultipleOccurrences?: boolean;
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
}

export interface ReplaceContentOutput {
  applied: boolean;
  occurrences: number;
  filePath: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function replaceContentTool(
  input: ReplaceContentInput
): Promise<WorkerToolResult<ReplaceContentOutput>> {
  const startedAt = new Date().toISOString();
  const {
    filePath,
    repoRoot,
    needle,
    replacement,
    mode,
    allowMultipleOccurrences = false,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(absoluteRepoRoot, filePath);

  const policy = enforcePathPolicy(targetPath, {
    repoRoot: absoluteRepoRoot,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  });
  if (!policy.allowed) {
    return {
      ok: false,
      toolName: 'replace_content',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { applied: false, occurrences: 0, filePath },
      error: {
        code: 'ACCESS_DENIED',
        message: policy.message || `Content replacement is restricted by policy: ${filePath}`,
      },
    };
  }

  if (!needle.trim()) {
    return {
      ok: false,
      toolName: 'replace_content',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { applied: false, occurrences: 0, filePath },
      error: {
        code: 'EMPTY_NEEDLE',
        message: 'Needle must not be empty.',
      },
    };
  }

  try {
    const original = await fs.readFile(targetPath, 'utf-8');
    const regex =
      mode === 'regex' ? new RegExp(needle, 'gm') : new RegExp(escapeRegExp(needle), 'gm');

    const matches = original.match(regex);
    const occurrences = matches ? matches.length : 0;

    if (occurrences === 0) {
      return {
        ok: false,
        toolName: 'replace_content',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: { applied: false, occurrences: 0, filePath },
        error: {
          code: 'NO_MATCH',
          message: 'Needle did not match any content in target file.',
        },
      };
    }

    if (!allowMultipleOccurrences && occurrences > 1) {
      return {
        ok: false,
        toolName: 'replace_content',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: { applied: false, occurrences, filePath },
        error: {
          code: 'MULTIPLE_MATCHES',
          message: `Needle matched ${occurrences} occurrences. Set allowMultipleOccurrences=true to proceed.`,
        },
      };
    }

    const updated = original.replace(regex, replacement);
    await fs.writeFile(targetPath, updated, 'utf-8');

    return {
      ok: true,
      toolName: 'replace_content',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { applied: true, occurrences, filePath },
    };
  } catch (err: any) {
    return {
      ok: false,
      toolName: 'replace_content',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { applied: false, occurrences: 0, filePath },
      error: {
        code: 'REPLACE_FAILED',
        message: `Failed to replace content: ${err.message}`,
      },
    };
  }
}
