import {
  buildNormalizedSupervisorLlmRequest,
  providerAdapterKey,
} from '../../structured-llm/request';
import type { StructuredLlmModelTarget } from '../../structured-llm/settings';
import type {
  ProviderToolDefinition,
  ProviderToolMessage,
  RawToolTurnCallOptions,
} from '../../structured-llm/tool-calls';
import type { StructuredLlmRoutePolicy } from '../../structured-llm/types';
import type { AgentRunContext } from '../types';
import {
  extractLatestNativeApiUserPrompt,
  extractNativeApiSystemPrompt,
  type NativeApiHistoryItem,
  projectNativeApiHistoryToProviderMessages,
} from './native-api-tool-history';

export type NativeApiProviderRequest = {
  provider: string;
  messages: ProviderToolMessage[];
  tools: ProviderToolDefinition[];
  systemPrompt: string;
  userPrompt: string;
  options: RawToolTurnCallOptions;
};

export function buildNativeApiProviderRequest(input: {
  context: AgentRunContext;
  history: readonly NativeApiHistoryItem[];
  tools?: readonly ProviderToolDefinition[];
  routeOverride?: StructuredLlmModelTarget | null;
  routePolicy?: StructuredLlmRoutePolicy;
}): NativeApiProviderRequest {
  const systemPrompt = extractNativeApiSystemPrompt(input.history);
  const userPrompt = extractLatestNativeApiUserPrompt(input.history);
  const normalizedRequest = buildNormalizedSupervisorLlmRequest({
    systemPrompt,
    userPrompt,
    label: 'native_api_runner',
    role: 'implementation',
    routeOverride: input.routeOverride,
    routePolicy: input.routePolicy,
  });

  return {
    provider: providerAdapterKey(normalizedRequest.providerId),
    messages: projectNativeApiHistoryToProviderMessages(input.history),
    tools: [...(input.tools ?? [])],
    systemPrompt,
    userPrompt,
    options: {
      label: 'native_api_runner',
      role: 'implementation',
      routeOverride: input.routeOverride,
      routePolicy: input.routePolicy,
      timeoutMs: input.context.timeoutSeconds * 1000,
      taskId: input.context.taskId,
      runId: input.context.runId,
      workingDirectory: input.context.repoRoot,
      normalizedRequest,
    },
  };
}
