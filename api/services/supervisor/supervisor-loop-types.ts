import type { LlmPromptPartTokenEstimates } from '../llm-usage';
import type { StructuredLlmModelTarget } from '../structured-llm/settings';
import type { StructuredLlmRoutePolicy } from '../structured-llm/types';
import type { SupervisorArtifactContextRef } from './artifact-contract';

export interface SupervisorLoopInput {
  runId: string;
  taskId?: string;
  repositoryId?: string;
  repoRoot: string;
  prompt: string;
  timeoutSeconds: number;
  latestUserMessage?: string;
  promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
  todoPlan?: SupervisorTodoContext[];
  currentTodo?: SupervisorTodoContext;
  maxIterations?: number;
  maxToolCalls?: number;
  maxRepeatedToolPattern?: number;
  deadlineAt?: string;
  llmRouteOverride?: StructuredLlmModelTarget | null;
  llmRoutePolicy?: StructuredLlmRoutePolicy;
  safetyPolicy?: {
    allowedPaths?: string[];
    externalAllowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
  };
  artifactContextRefs?: SupervisorArtifactContextRef[];
}

export type SupervisorWorkspaceSnapshot = {
  isEmpty: boolean;
  topLevelDirs: string[];
  topLevelFiles: string[];
  truncated: boolean;
};

export type SupervisorTodoContext = {
  id: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: string;
  status: string;
  procedureId?: string | null;
  procedureDigest?: string | null;
  contextDigest?: string | null;
};

export type CompactToolResult = {
  step: number;
  toolName: string;
  ok: boolean;
  arguments: Record<string, unknown>;
  summary: string;
  payload?: unknown;
  error?: unknown;
  observedTodoSeq?: number;
  observedTodoId?: string;
  attributedTodoSeq?: number;
  attributedTodoId?: string;
  attributionReason?: string;
  evidence?: NativeToolEvidence;
};

export type NativeToolFailureKind =
  | 'path_not_found'
  | 'not_a_directory'
  | 'file_not_found'
  | 'empty_read'
  | 'invalid_line_range'
  | 'patch_mismatch'
  | 'needle_not_found'
  | 'access_denied'
  | 'todo_tracking_noop'
  | 'command_failed'
  | 'unknown_tool_failure';

export type RecoveryDirective = {
  kind:
    | 'read_target_once'
    | 'edit_with_corrected_patch'
    | 'choose_existing_path'
    | 'advance_current_todo'
    | 'ask_user';
  targetPath?: string;
  reason: string;
  maxRepeats?: number;
};

export type DoNotRepeatDirective = {
  toolName: string;
  targetPath?: string;
  reason: string;
  maxRepeats?: number;
};

export type CriticalEvidenceKind =
  | 'tool_failure'
  | 'mutation_failure'
  | 'missing_path'
  | 'empty_read'
  | 'todo_tracking_noop'
  | 'command_failure';

export type NativeToolEvidence = {
  step: number;
  toolName: string;
  ok: boolean;
  targetPath?: string;
  failureKind?: NativeToolFailureKind;
  reason: string;
  recoveryDirective?: RecoveryDirective;
  doNotRepeat?: DoNotRepeatDirective;
  criticalEvidence?: {
    kind: CriticalEvidenceKind;
    summary: string;
  };
};
