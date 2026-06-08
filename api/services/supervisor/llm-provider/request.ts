import {
  getSupervisorLlmSetting,
  readSupervisorLlmProviderSettings,
  type SupervisorLlmProviderSettings,
} from './settings';
import type {
  NormalizedSupervisorLlmRequest,
  ProviderCapabilityPolicy,
  SupervisorProviderClass,
  SupervisorProviderId,
} from './types';

export function buildNormalizedSupervisorLlmRequest(input: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: { name: string; schema: unknown };
  label: string;
  round?: 1 | 2;
  schemaFirst?: boolean;
  settings?: SupervisorLlmProviderSettings;
}): NormalizedSupervisorLlmRequest {
  const settings = input.settings ?? readSupervisorLlmProviderSettings();
  const rawProvider = getSupervisorLlmSetting(settings, 'ACTIVE_LLM_PROVIDER', 'azure') || 'azure';
  const providerId = normalizeProviderId(rawProvider);
  const providerClass = resolveProviderClass(providerId);
  const callKind = resolveCallKind(input.label, providerClass);
  const capabilityPolicy = buildCapabilityPolicy({
    callKind,
    providerClass,
    schemaFirst: input.schemaFirst,
  });

  return {
    callKind,
    providerId,
    providerClass,
    modelOrDeployment: resolveModelOrDeployment(providerId, settings),
    endpoint: resolveEndpoint(providerId, settings),
    region:
      providerId === 'bedrock'
        ? getSupervisorLlmSetting(settings, 'AWS_REGION', 'us-east-1')
        : null,
    apiVersion:
      providerId === 'azure-openai'
        ? getSupervisorLlmSetting(settings, 'AZURE_OPENAI_API_VERSION', '2024-05-01-preview')
        : null,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    jsonSchema: input.jsonSchema,
    capabilityPolicy,
    diagnostics: {
      label: input.label,
      round: input.round ?? null,
      artifactSchemaName: input.schemaFirst ? null : (input.jsonSchema?.name ?? null),
      sourceArtifactRef: null,
      systemPromptLength: input.systemPrompt.length,
      userPromptLength: input.userPrompt.length,
    },
  };
}

export function normalizeProviderId(value: string): SupervisorProviderId {
  if (value === 'azure') return 'azure-openai';
  if (
    value === 'openai' ||
    value === 'azure-openai' ||
    value === 'bedrock' ||
    value === 'codex' ||
    value === 'fixture' ||
    value === 'test'
  ) {
    return value;
  }
  return value as SupervisorProviderId;
}

export function providerAdapterKey(providerId: SupervisorProviderId | string): string {
  return providerId === 'azure-openai' ? 'azure' : providerId;
}

function resolveProviderClass(providerId: SupervisorProviderId): SupervisorProviderClass {
  if (providerId === 'bedrock') return 'converse_message';
  if (providerId === 'codex') return 'agent_runtime';
  if (providerId === 'fixture' || providerId === 'test') return 'fixture';
  return 'chat_completion';
}

function resolveCallKind(
  label: string,
  providerClass: SupervisorProviderClass
): NormalizedSupervisorLlmRequest['callKind'] {
  if (providerClass === 'fixture') return 'fixture';
  if (label === 'supervisor') return 'supervisor_decision';
  if (
    label === 'design_questionnaire' ||
    label === 'design_questionnaire_follow_up' ||
    label === 'design_questionnaire_follow_up_decision'
  ) {
    return 'design_questionnaire';
  }
  if (label === 'design_decision_review') return 'design_decision_review';
  return 'structured_artifact';
}

function buildCapabilityPolicy(input: {
  callKind: NormalizedSupervisorLlmRequest['callKind'];
  providerClass: SupervisorProviderClass;
  schemaFirst?: boolean;
}): ProviderCapabilityPolicy {
  return {
    allowProviderToolCalls: false,
    allowProviderFileWrites: false,
    allowProviderCommandExecution: false,
    allowProviderNetwork: false,
    requireStructuredOutput: input.schemaFirst || input.callKind !== 'fixture',
    rejectUnobservedProviderActivity: input.providerClass !== 'fixture',
  };
}

function resolveModelOrDeployment(
  providerId: SupervisorProviderId,
  settings: SupervisorLlmProviderSettings
) {
  if (providerId === 'openai')
    return getSupervisorLlmSetting(settings, 'OPENAI_MODEL', 'gpt-4o-mini');
  if (providerId === 'azure-openai') {
    return getSupervisorLlmSetting(settings, 'AZURE_OPENAI_DEPLOYMENT_NAME', 'gpt-5-mini');
  }
  if (providerId === 'bedrock') {
    return getSupervisorLlmSetting(
      settings,
      'AWS_BEDROCK_MODEL',
      'anthropic.claude-3-5-sonnet-20241022-v2:0'
    );
  }
  if (providerId === 'codex') return getSupervisorLlmSetting(settings, 'CODEX_MODEL', '') || null;
  return null;
}

function resolveEndpoint(
  providerId: SupervisorProviderId,
  settings: SupervisorLlmProviderSettings
) {
  if (providerId === 'openai') {
    return getSupervisorLlmSetting(settings, 'OPENAI_BASE_URL', 'https://api.openai.com/v1');
  }
  if (providerId === 'azure-openai') {
    return getSupervisorLlmSetting(settings, 'AZURE_OPENAI_ENDPOINT', '');
  }
  return null;
}
