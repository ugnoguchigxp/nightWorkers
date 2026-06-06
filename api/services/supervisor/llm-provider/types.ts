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

export type SupervisorProviderId =
  | 'openai'
  | 'azure-openai'
  | 'azure'
  | 'bedrock'
  | 'codex'
  | 'fixture'
  | 'test';

export type SupervisorProviderClass =
  | 'chat_completion'
  | 'converse_message'
  | 'agent_runtime'
  | 'fixture';

export type ProviderCapabilityPolicy = {
  allowProviderToolCalls: boolean;
  allowProviderFileWrites: boolean;
  allowProviderCommandExecution: boolean;
  allowProviderNetwork: boolean;
  requireStructuredOutput: boolean;
  rejectUnobservedProviderActivity: boolean;
};

export type NormalizedSupervisorLlmRequest = {
  callKind:
    | 'supervisor_decision'
    | 'structured_artifact'
    | 'design_questionnaire'
    | 'design_decision_review'
    | 'fixture';
  providerId: SupervisorProviderId;
  providerClass: SupervisorProviderClass;
  modelOrDeployment: string | null;
  endpoint: string | null;
  region: string | null;
  apiVersion: string | null;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: { name: string; schema: unknown };
  capabilityPolicy: ProviderCapabilityPolicy;
  diagnostics: {
    label: string;
    round: 1 | 2 | null;
    artifactSchemaName?: string | null;
    sourceArtifactRef?: string | null;
    systemPromptLength: number;
    userPromptLength: number;
  };
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
    | 'model.provider_activity_detected'
    | 'model.provider_tool_call_detected'
    | 'model.provider_activity_rejected'
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
