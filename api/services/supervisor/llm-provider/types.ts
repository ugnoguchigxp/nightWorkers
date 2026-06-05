import type { LlmPromptPartTokenEstimates, NormalizedLlmUsage } from '../../llm-usage/types';

export type CallSupervisorOptions = {
  tolerateSchemaFailure?: boolean;
  round?: 1 | 2;
  schemaFirst?: boolean;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
  timeoutMs?: number;
  workingDirectory?: string;
  taskId?: string;
  runId?: string | null;
  promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
};

export type ProviderCallResult = {
  content: string;
  usage: NormalizedLlmUsage;
  model?: string | null;
  providerDebug?: Record<string, unknown>;
};

export type StructuredJsonLlmOptions = Omit<CallSupervisorOptions, 'schemaFirst' | 'round'> & {
  schemaName: string;
  schema: unknown;
};

export type SupervisorLlmDebugEvent = {
  type:
    | 'model.request_started'
    | 'model.retry_scheduled'
    | 'model.retry_started'
    | 'model.response_delta'
    | 'model.response_finished'
    | 'model.response_parse_failed'
    | 'model.response_repaired';
  severity: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, unknown>;
};
