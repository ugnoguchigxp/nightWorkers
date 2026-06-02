import type { WorkerToolResult } from '../worker-tools/types';
import type { ToolCallRequest, ToolPolicyDecision } from './types';

function emptyPayloadByTool(toolName: ToolCallRequest['toolName']): Record<string, unknown> {
  if (toolName === 'list_dir') return { dirs: [], files: [] };
  if (toolName === 'find_file') return { files: [], count: 0 };
  if (toolName === 'read_file') return { content: '', filePath: '', totalLines: 0 };
  if (toolName === 'search_files') return { matches: [], count: 0, engine: 'ripgrep' };
  if (toolName === 'apply_patch') return { applied: false, changedFiles: [] };
  if (toolName === 'replace_content') return { applied: false, occurrences: 0, filePath: '' };
  if (toolName === 'run_command' || toolName === 'run_verification') {
    return {
      command: '',
      exitCode: -1,
      stdout: '',
      stderr: '',
      classification: 'unknown',
      truncated: false,
    };
  }
  if (toolName === 'git_status') {
    return {
      branch: 'unknown',
      isDirty: false,
      untrackedCount: 0,
      modifiedCount: 0,
      shortStatus: '',
    };
  }
  return { diff: '', diffStat: '', hasChanges: false };
}

export function buildBlockedToolResult(
  request: ToolCallRequest,
  decision: Extract<ToolPolicyDecision, { allowed: false }>
): WorkerToolResult<Record<string, unknown>> {
  const now = new Date().toISOString();
  return {
    ok: false,
    toolName: request.toolName,
    startedAt: now,
    finishedAt: now,
    payload: emptyPayloadByTool(request.toolName),
    error: { code: decision.code, message: decision.message },
  };
}
