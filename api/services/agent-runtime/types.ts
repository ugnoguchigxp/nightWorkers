import type {
  RuntimeContractWarning,
  RuntimeContractWarningSeverity,
  RuntimeLaneEvent,
  RuntimeLaneKind,
  RuntimeLaneResult,
  RuntimeLaneSink,
} from './shared';

export type AgentRuntimeKind = RuntimeLaneKind;

export interface AgentSafetyPolicy {
  allowedPaths?: string[];
  externalAllowedPaths?: string[];
  deniedPaths?: string[];
  blockedCommands?: string[];
  maxCommandSeconds?: number;
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
    source: 'task_prompt' | 'fallback';
    conversationContext?: {
      snapshotId?: string;
      version?: number;
      tokenEstimate?: number;
      stateCardIncluded: boolean;
      stateCardText?: string;
      snapshotJson?: unknown;
      usage?: {
        latestUserMessageTokens: number;
        stateCardTokens: number;
        runtimeUserPromptTokens: number;
      };
    };
    [key: string]: unknown;
  };
  todoPlan?: Array<{
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: string;
    status: string;
    procedureId?: string | null;
    procedureDigest?: string | null;
    contextDigest?: string | null;
  }>;
  currentTodo?: {
    id: string;
    seq: number;
    title: string;
    taskType: string;
    status: string;
    procedureId?: string | null;
  };
  runtimeOptions?: Record<string, unknown>;
}

export type CodexContractWarningSeverity = RuntimeContractWarningSeverity;
export type CodexContractWarning = RuntimeContractWarning;
export type AgentRuntimeEvent = RuntimeLaneEvent;
export type AgentRuntimeSink = RuntimeLaneSink;
export type AgentRuntimeResult = RuntimeLaneResult;

export interface AgentRuntime {
  readonly kind: AgentRuntimeKind;
  start(
    context: AgentRunContext,
    sink: AgentRuntimeSink,
    signal?: AbortSignal
  ): Promise<AgentRuntimeResult>;
  stop(runId: string): Promise<void>;
}
