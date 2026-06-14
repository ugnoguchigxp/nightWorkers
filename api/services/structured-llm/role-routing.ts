import type {
  StructuredLlmModelTarget,
  StructuredLlmProviderEndpoint,
  StructuredLlmProviderSettings,
  StructuredLlmRole,
} from './settings';
import type { SupervisorProviderId } from './types';

export type ResolvedStructuredLlmRoute = {
  role: StructuredLlmRole;
  providerEndpointId: string;
  providerId: SupervisorProviderId;
  endpoint: StructuredLlmProviderEndpoint;
  model: string;
  thinkingDepth: StructuredLlmModelTarget['thinkingDepth'] | null;
  source: 'primary' | 'fallback';
  diagnostics: string[];
};

export function resolveStructuredLlmRoleRoute(input: {
  role: StructuredLlmRole;
  settings: StructuredLlmProviderSettings;
}): ResolvedStructuredLlmRoute | null {
  const endpoints = input.settings.providerEndpoints || [];
  const route = (input.settings.roleRoutes || []).find((item) => item.role === input.role);
  if (!route) return null;

  const primary = resolveRouteTarget(route.role, route.primary, endpoints, 'primary');
  if (primary) return primary;

  for (let index = 0; index < route.fallbacks.length; index += 1) {
    const fallback = resolveRouteTarget(
      route.role,
      route.fallbacks[index],
      endpoints,
      'fallback',
      index
    );
    if (fallback) return fallback;
  }
  return null;
}

function resolveRouteTarget(
  role: StructuredLlmRole,
  target: StructuredLlmModelTarget | undefined,
  endpoints: StructuredLlmProviderEndpoint[],
  source: 'primary' | 'fallback',
  fallbackIndex?: number
): ResolvedStructuredLlmRoute | null {
  if (!target?.providerEndpointId || !target.model) return null;

  const endpoint = endpoints.find((item) => item.id === target.providerEndpointId);
  if (!endpoint?.enabled) return null;

  const model = endpoint.models.includes(target.model)
    ? target.model
    : endpoint.models[0] || target.model;
  return {
    role,
    providerEndpointId: endpoint.id,
    providerId: providerIdForEndpoint(endpoint),
    endpoint,
    model,
    thinkingDepth: target.thinkingDepth || null,
    source,
    diagnostics: [
      `role=${role}`,
      `routeSource=${source}`,
      ...(fallbackIndex === undefined ? [] : [`fallbackIndex=${fallbackIndex}`]),
      `providerEndpointId=${endpoint.id}`,
      `model=${model}`,
      ...(target.thinkingDepth ? [`thinkingDepth=${target.thinkingDepth}`] : []),
    ],
  };
}

export function providerIdForEndpoint(
  endpoint: StructuredLlmProviderEndpoint
): SupervisorProviderId {
  if (endpoint.kind === 'azure') return 'azure-openai';
  if (endpoint.kind === 'openai-compatible' || endpoint.kind === 'local') return 'openai';
  return endpoint.kind;
}
