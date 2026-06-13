import type { ProcedureSnapshot } from '../procedures';
import type { TaskType } from '../task-intake';

export type RuntimeLaneSnapshot = {
  workerKind: 'native-local' | 'codex-agent';
  source: 'task' | 'queue' | 'settings' | 'env' | 'provider_default';
  diagnostics?: Array<{ level: 'info' | 'warning'; message: string }>;
};

export type RuntimePromptSnapshot = {
  compiledPrompt: string;
  source: 'task_prompt' | 'fallback';
  degraded: boolean;
  degradedReason?: string;
  executionPhase?: 'implementation';
  planModeClosed?: boolean;
  implementationPhasePreamble?: string;
  blueprintPlanning?: unknown;
  runtimeLane?: 'native-supervisor' | 'codex-agent';
  runtimeLaneResolution?: RuntimeLaneSnapshot;
  request: {
    repositoryPath: string;
    taskTitle: string;
    taskDescriptionDigest: string;
  };
  result: {
    digest: string;
    charCount: number;
  };
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
};

export type TodoContextInput = {
  todo: {
    id: string;
    seq: number;
    title: string;
    description?: string | null;
    taskType: TaskType | string;
    procedureId?: string | null;
    procedureSnapshot?: ProcedureSnapshot | null;
  };
  runContext: RuntimePromptSnapshot;
  previousTodoSummaries?: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary?: string | null;
  }>;
};

export type TodoContextSnapshot = {
  version: 1;
  todo: {
    id: string;
    seq: number;
    title: string;
    description: string | null;
    taskType: string;
  };
  selectedProcedure: {
    id: string | null;
    source: string | null;
    title: string | null;
    digest: string | null;
  };
  runContext: {
    source: RuntimePromptSnapshot['source'];
    degraded: boolean;
    degradedReason?: string;
    digest: string;
    charCount: number;
  };
  previousTodoSummaries: Array<{
    id: string;
    seq: number;
    title: string;
    status: string;
    summary: string | null;
  }>;
};
