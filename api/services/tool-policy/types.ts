import type { AgentSafetyPolicy } from '../agent-runtime/types';
import type { WorkerToolResult } from '../worker-tools/types';

export type WorkerToolName =
  | 'list_dir'
  | 'find_file'
  | 'read_file'
  | 'read_current_specification'
  | 'inspect_structure'
  | 'search_files'
  | 'search_web'
  | 'fetch_content'
  | 'copy_directory'
  | 'apply_patch'
  | 'replace_content'
  | 'run_command'
  | 'run_background_command'
  | 'run_verification'
  | 'mcp_call_tool'
  | 'git_status'
  | 'git_diff';

export interface ToolCallRequest {
  runId: string;
  iteration: number;
  toolName: WorkerToolName;
  args: Record<string, unknown>;
  repoRoot: string;
  safetyPolicy?: AgentSafetyPolicy;
  readFiles: string[];
}

export type ToolPolicyViolationCode =
  | 'ACCESS_DENIED'
  | 'COMMAND_BLOCKED'
  | 'UNKNOWN_COMMAND'
  | 'CHAINED_COMMAND_BLOCKED'
  | 'TOOL_NOT_ALLOWED'
  | 'INVALID_TOOL_ARGS'
  | 'POLICY_VIOLATION'
  | 'HOOK_BLOCKED';

export type ToolPolicyDecision =
  | {
      allowed: true;
      normalizedArgs: Record<string, unknown>;
      warnings?: string[];
      effectiveLimits?: {
        timeoutSeconds?: number;
      };
      preflight?: Record<string, unknown>;
    }
  | {
      allowed: false;
      code: ToolPolicyViolationCode;
      message: string;
      evidence?: Record<string, unknown>;
    };

export interface ToolPolicyGate {
  beforeToolCall(request: ToolCallRequest): Promise<ToolPolicyDecision>;
  afterToolCall(
    request: ToolCallRequest,
    result: WorkerToolResult<unknown>,
    preflight?: Record<string, unknown>
  ): Promise<{
    result: WorkerToolResult<unknown>;
    policyViolation?: ToolPolicyDecision;
    warnings?: string[];
  }>;
}
