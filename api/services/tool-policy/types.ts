import type { AgentSafetyPolicy } from '../agent-runtime/types';
import type { WorkerToolResult } from '../worker-tools/types';

export type WorkerToolName =
  | 'list_dir'
  | 'find_file'
  | 'read_file'
  | 'search_files'
  | 'search_web'
  | 'fetch_content'
  | 'apply_patch'
  | 'replace_content'
  | 'run_command'
  | 'run_verification'
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
  | 'READ_BEFORE_EDIT_REQUIRED'
  | 'TOOL_NOT_ALLOWED'
  | 'INVALID_TOOL_ARGS'
  | 'POLICY_VIOLATION';

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
