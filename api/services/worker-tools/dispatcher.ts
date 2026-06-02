import type { AgentSafetyPolicy } from '../agent-runtime/types';
import type { WorkerToolName } from '../tool-policy/types';
import {
  applyPatchTool,
  fetchContentTool,
  findFileTool,
  gitDiffTool,
  gitStatusTool,
  listDirTool,
  readFileTool,
  replaceContentTool,
  runCommandTool,
  runVerificationTool,
  searchFilesTool,
  searchWebTool,
} from '.';
import type { WorkerToolResult } from './types';

export type WorkerToolDispatchInput = {
  toolName: WorkerToolName;
  args: Record<string, unknown>;
  repoRoot: string;
  safetyPolicy?: AgentSafetyPolicy;
  readFiles: string[];
};

export type WorkerToolDispatchResult = {
  result: WorkerToolResult<unknown>;
  readFilesChanged?: string[];
};

export async function executeWorkerTool(
  input: WorkerToolDispatchInput
): Promise<WorkerToolDispatchResult> {
  const { toolName, args, repoRoot, safetyPolicy, readFiles } = input;

  if (toolName === 'list_dir') {
    return {
      result: await listDirTool({
        relativePath: args.relativePath as string | undefined,
        recursive: args.recursive as boolean | undefined,
        skipIgnored: args.skipIgnored as boolean | undefined,
        maxEntries: args.maxEntries as number | undefined,
        repoRoot,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
      }),
    };
  }

  if (toolName === 'find_file') {
    return {
      result: await findFileTool({
        fileMask: args.fileMask as string,
        relativePath: args.relativePath as string | undefined,
        recursive: args.recursive as boolean | undefined,
        maxResults: args.maxResults as number | undefined,
        repoRoot,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
      }),
    };
  }

  if (toolName === 'read_file') {
    const result = await readFileTool({
      filePath: args.filePath as string,
      repoRoot,
      startLine: args.startLine as number | undefined,
      endLine: args.endLine as number | undefined,
      allowedPaths: safetyPolicy?.allowedPaths,
      deniedPaths: safetyPolicy?.deniedPaths,
    });
    const filePath = args.filePath as string;
    if (result.ok && typeof filePath === 'string' && !readFiles.includes(filePath)) {
      return { result, readFilesChanged: [...readFiles, filePath] };
    }
    return { result };
  }

  if (toolName === 'search_files') {
    return {
      result: await searchFilesTool({
        query: args.query as string,
        repoRoot,
        glob: args.glob as string | undefined,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
      }),
    };
  }

  if (toolName === 'search_web') {
    return {
      result: await searchWebTool({
        query: args.query as string,
        maxResults: args.maxResults as number | undefined,
      }),
    };
  }

  if (toolName === 'fetch_content') {
    return {
      result: await fetchContentTool({
        url: args.url as string,
        maxChars: args.maxChars as number | undefined,
      }),
    };
  }

  if (toolName === 'apply_patch') {
    return {
      result: await applyPatchTool({
        patchContent: args.patchContent as string,
        repoRoot,
        readFiles,
        requireReadBeforeEdit: safetyPolicy?.requireReadBeforeEdit ?? true,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
      }),
    };
  }

  if (toolName === 'replace_content') {
    return {
      result: await replaceContentTool({
        filePath: args.filePath as string,
        needle: args.needle as string,
        replacement: args.replacement as string,
        mode: (args.mode as 'literal' | 'regex') || 'literal',
        allowMultipleOccurrences: args.allowMultipleOccurrences as boolean | undefined,
        readFiles,
        requireReadBeforeEdit: safetyPolicy?.requireReadBeforeEdit ?? true,
        repoRoot,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
      }),
    };
  }

  if (toolName === 'run_command') {
    return {
      result: await runCommandTool({
        command: args.command as string,
        repoRoot,
        cwd: args.cwd as string | undefined,
        blockedCommands: safetyPolicy?.blockedCommands,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
        timeoutSeconds: args.timeoutSeconds as number | undefined,
        maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
      }),
    };
  }

  if (toolName === 'run_verification') {
    return {
      result: await runVerificationTool({
        command: args.command as string,
        repoRoot,
        reason: (args.reason as string) || 'verification',
        cwd: args.cwd as string | undefined,
        blockedCommands: safetyPolicy?.blockedCommands,
        allowedPaths: safetyPolicy?.allowedPaths,
        deniedPaths: safetyPolicy?.deniedPaths,
        timeoutSeconds: args.timeoutSeconds as number | undefined,
        maxCommandSeconds: safetyPolicy?.maxCommandSeconds,
      }),
    };
  }

  if (toolName === 'git_status') return { result: await gitStatusTool({ repoRoot }) };
  if (toolName === 'git_diff') return { result: await gitDiffTool({ repoRoot }) };

  throw new Error(`Unsupported tool name: ${toolName}`);
}
