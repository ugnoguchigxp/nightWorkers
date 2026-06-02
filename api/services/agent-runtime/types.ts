export type AgentRuntimeKind = 'native-local' | 'external-process' | 'future-adapter';

export interface AgentSafetyPolicy {
  allowedPaths?: string[];
  deniedPaths?: string[];
  blockedCommands?: string[];
  maxCommandSeconds?: number;
  requireReadBeforeEdit?: boolean;
}

export interface AgentRunContext {
  runId: string;
  taskId: string;
  repositoryId: string;
  repoRoot: string;
  compiledPrompt: string;
  latestUserMessage: string;
  timeoutSeconds: number;
  safetyPolicy?: AgentSafetyPolicy;
  contextSnapshot: {
    compiledPrompt: string;
    source: 'context-still' | 'fallback';
  };
  runtimeOptions?: Record<string, unknown>;
}

type AgentEventPayload = unknown;

export type AgentRuntimeEvent =
  | { type: 'runtime_started'; message: string; payload?: AgentEventPayload }
  | { type: 'turn_started'; message: string; payload?: AgentEventPayload }
  | { type: 'model_response_started'; message: string; payload?: AgentEventPayload }
  | { type: 'model_response_delta'; message: string; payload?: AgentEventPayload }
  | { type: 'supervisor_decision'; message: string; payload?: AgentEventPayload }
  | { type: 'tool_call_started'; message: string; payload?: AgentEventPayload }
  | { type: 'tool_call_progress'; message: string; payload?: AgentEventPayload }
  | { type: 'tool_call_finished'; message: string; payload?: AgentEventPayload }
  | { type: 'verification_started'; message: string; payload?: AgentEventPayload }
  | { type: 'verification_finished'; message: string; payload?: AgentEventPayload }
  | { type: 'diff_collected'; message: string; payload?: AgentEventPayload }
  | { type: 'runtime_finished'; message: string; payload?: AgentEventPayload }
  | { type: 'runtime_error'; message: string; payload?: AgentEventPayload };

export interface AgentRuntimeSink {
  emit(event: AgentRuntimeEvent): Promise<void>;
}

export interface AgentRuntimeResult {
  terminalState:
    | 'completed'
    | 'needs_review'
    | 'needs_human'
    | 'failed'
    | 'timed_out'
    | 'blocked'
    | 'cancelled';
  summary: string;
  finalReport: string;
  stoppedBy:
    | 'decision'
    | 'budget'
    | 'tool_failure'
    | 'llm_error'
    | 'missing_tool_call'
    | 'policy'
    | 'cancelled';
  riskLevel: 'low' | 'medium' | 'high';
  logContent?: string;
  diffPatch?: string;
  testResults?: unknown;
  usage?: unknown;
}

export interface AgentRuntime {
  readonly kind: AgentRuntimeKind;
  start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult>;
  stop(runId: string): Promise<void>;
}
