import type { WorkerToolResult } from '../worker-tools/types';
import type { ToolCallRequest, ToolPolicyDecision } from './types';

function emptyPayloadByTool(toolName: ToolCallRequest['toolName']): Record<string, unknown> {
  if (toolName === 'list_dir') return { dirs: [], files: [] };
  if (toolName === 'find_file') return { files: [], count: 0 };
  if (toolName === 'read_file') return { content: '', filePath: '', totalLines: 0 };
  if (toolName === 'read_current_specification') {
    return {
      taskId: '',
      found: false,
      messageId: null,
      title: null,
      content: '',
      generatedAt: null,
      digest: null,
      sources: {},
    };
  }
  if (toolName === 'inspect_structure') {
    return { kind: 'json', filePath: '', paths: [], truncated: false };
  }
  if (toolName === 'search_files') return { matches: [], count: 0, engine: 'ripgrep' };
  if (toolName === 'search_web')
    return { query: '', engine: 'duckduckgo-lite', results: [], truncated: false };
  if (toolName === 'fetch_content') {
    return {
      url: '',
      finalUrl: '',
      contentType: '',
      status: 0,
      text: '',
      truncated: false,
    };
  }
  if (toolName === 'import_project') {
    return {
      mode: '',
      template: null,
      git: null,
    };
  }
  if (toolName === 'clone_git_repo') {
    return {
      repoUrl: '',
      ref: null,
      commit: null,
      targetPath: '',
      copiedFiles: 0,
      copiedDirectories: 0,
      strippedGitDir: true,
    };
  }
  if (toolName === 'apply_patch') return { applied: false, changedFiles: [] };
  if (toolName === 'replace_content') return { applied: false, occurrences: 0, filePath: '' };
  if (toolName === 'run_background_command') {
    return {
      backgroundProcessId: '',
      command: '',
      cwd: '',
      status: 'failed',
      pid: null,
    };
  }
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
  if (toolName === 'mcp_call_tool') return { serverId: '', toolName: '', result: null };
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
