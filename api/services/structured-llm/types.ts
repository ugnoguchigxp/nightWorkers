import type { LlmPromptPartTokenEstimates, NormalizedLlmUsage } from '../llm-usage/types';
import type { StructuredLlmModelTarget } from './settings';

export type StructuredLlmRouteSource = 'override' | 'primary' | 'fallback';

export type CallSupervisorOptions = {
  tolerateSchemaFailure?: boolean;
  round?: 1 | 2;
  schemaFirst?: boolean;
  role?: StructuredLlmRole;
  routeOverride?: StructuredLlmModelTarget | null;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
  timeoutMs?: number;
  workingDirectory?: string;
  taskId?: string;
  runId?: string | null;
  promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
  promptBudgetMetadata?: StructuredLlmPromptBudgetMetadata;
};

export type StructuredLlmPromptBudgetMetadata = {
  modelContextWindowTokens: number;
  safePromptBudgetTokens: number;
  reservedOutputTokens: number;
  estimatedPromptTokensBefore: number;
  estimatedPromptTokensAfter: number;
  systemPromptLengthBefore: number;
  systemPromptLengthAfter: number;
  userPromptLengthBefore: number;
  userPromptLengthAfter: number;
  compressedSections: string[];
  droppedFields: string[];
  compressionProfile: string;
  budgetExceeded: boolean;
};

export type StructuredLlmRole =
  | 'plan'
  | 'implementation'
  | 'test'
  | 'review'
  | 'quality_gate'
  | 'completion';

export type SupervisorProviderId =
  | 'openai'
  | 'azure-openai'
  | 'azure'
  | 'bedrock'
  | 'codex'
  | 'fixture'
  | 'test';

export type SupervisorProviderClass = 'chat_completion' | 'converse_message' | 'fixture';

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
  providerEndpointId?: string | null;
  role?: StructuredLlmRole | null;
  routeSource?: StructuredLlmRouteSource | null;
  modelOrDeployment: string | null;
  thinkingDepth?: 'low' | 'medium' | 'high' | 'very_high' | null;
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
    role?: StructuredLlmRole | null;
    providerEndpointId?: string | null;
    routeSource?: StructuredLlmRouteSource | null;
    modelOrDeployment?: string | null;
    thinkingDepth?: 'low' | 'medium' | 'high' | 'very_high' | null;
    routeDiagnostics?: string[];
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
