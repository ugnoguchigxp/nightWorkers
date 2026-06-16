import { resolveStructuredLlmRoleRoute } from './role-routing';
import {
  readStructuredLlmProviderSettings,
  type StructuredLlmModelCapability,
  type StructuredLlmModelTarget,
  type StructuredLlmProviderEndpoint,
  type StructuredLlmProviderSettings,
  type StructuredLlmRole,
} from './settings';

export const DEFAULT_STRUCTURED_LLM_CONTEXT_WINDOW_TOKENS = 8192;
export const DEFAULT_STRUCTURED_LLM_RESERVED_OUTPUT_TOKENS = 1024;

export type ResolvedStructuredLlmModelCapability = Required<
  Pick<
    StructuredLlmModelCapability,
    | 'contextWindowTokens'
    | 'safePromptBudgetTokens'
    | 'reservedOutputTokens'
    | 'supportsProviderSideCompression'
    | 'compressionProfile'
  >
> & {
  providerEndpointId: string | null;
  model: string | null;
};

export function resolveStructuredLlmModelCapability(input: {
  role?: StructuredLlmRole;
  routeOverride?: StructuredLlmModelTarget | null;
  settings?: StructuredLlmProviderSettings;
}): ResolvedStructuredLlmModelCapability {
  const settings = input.settings ?? readStructuredLlmProviderSettings();
  const route = input.role
    ? resolveStructuredLlmRoleRoute({ role: input.role, settings, override: input.routeOverride })
    : null;
  const endpoint = route?.endpoint ?? null;
  const model = route?.model ?? null;
  const configured = endpoint && model ? capabilityForEndpointModel(endpoint, model) : null;
  return normalizeModelCapability(configured, endpoint?.id ?? null, model);
}

function capabilityForEndpointModel(
  endpoint: StructuredLlmProviderEndpoint,
  model: string
): StructuredLlmModelCapability | null {
  return endpoint.modelCapabilities?.[model] ?? endpoint.defaultModelCapability ?? null;
}

function normalizeModelCapability(
  capability: StructuredLlmModelCapability | null,
  providerEndpointId: string | null,
  model: string | null
): ResolvedStructuredLlmModelCapability {
  const contextWindowTokens = positiveIntegerOrDefault(
    capability?.contextWindowTokens,
    DEFAULT_STRUCTURED_LLM_CONTEXT_WINDOW_TOKENS
  );
  const reservedOutputTokens = positiveIntegerOrDefault(
    capability?.reservedOutputTokens,
    DEFAULT_STRUCTURED_LLM_RESERVED_OUTPUT_TOKENS
  );
  const derivedSafeBudget = Math.max(1, contextWindowTokens - reservedOutputTokens);
  const safePromptBudgetTokens = Math.min(
    contextWindowTokens,
    positiveIntegerOrDefault(capability?.safePromptBudgetTokens, derivedSafeBudget)
  );
  return {
    providerEndpointId,
    model,
    contextWindowTokens,
    safePromptBudgetTokens,
    reservedOutputTokens,
    supportsProviderSideCompression: capability?.supportsProviderSideCompression === true,
    compressionProfile: capability?.compressionProfile || 'balanced',
  };
}

function positiveIntegerOrDefault(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
