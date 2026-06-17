export type RuntimeLaneSnapshot = {
  workerKind: 'native-local' | 'codex-agent';
  source: 'task' | 'queue' | 'settings' | 'env' | 'role_route' | 'provider_default';
  diagnostics?: Array<{ level: 'info' | 'warning'; message: string }>;
};

export type TodoProcedureSnapshot = {
  id?: string | null;
  source?: string | null;
  title?: string | null;
  digest?: string | null;
  [key: string]: unknown;
};

export type RuntimePromptSnapshot = {
  compiledPrompt: string;
  source: 'task_prompt' | 'fallback';
  degraded: boolean;
  degradedReason?: string;
  executionPhase?: 'planning' | 'implementation' | 'review' | 'runtime_debug' | 'general_answer';
  executionModeSource?:
    | 'message_history'
    | 'workbench_intake'
    | 'workbench_run'
    | 'workbench_run_task'
    | 'implementation_queue'
    | 'session_queue'
    | 'explicit';
  planModeClosed?: boolean;
  implementationPhasePreamble?: string;
  blueprintPlanning?: unknown;
  runtimeLane?: 'native-api-runner' | 'codex-sdk';
  runtimeLaneResolution?: RuntimeLaneSnapshot;
  effectiveLlmRouting?: unknown;
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
    projection?: {
      role: 'plan' | 'implementation' | 'review' | 'runtime_debug' | 'general_answer';
      workKind?: string | null;
      source: 'role_projection' | 'raw_snapshot' | 'omitted';
      omittedSections: string[];
    };
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
    taskType: string;
    procedureId?: string | null;
    procedureSnapshot?: TodoProcedureSnapshot | null;
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
