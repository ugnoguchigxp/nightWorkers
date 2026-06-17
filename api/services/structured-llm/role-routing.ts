import type {
  StructuredLlmModelTarget,
  StructuredLlmProviderEndpoint,
  StructuredLlmProviderSettings,
  StructuredLlmRole,
} from './settings';
import type {
  StructuredLlmRoutePolicy,
  StructuredLlmRouteSource,
  SupervisorProviderId,
} from './types';

export type ResolvedStructuredLlmRoute = {
  role: StructuredLlmRole;
  providerEndpointId: string;
  providerId: SupervisorProviderId;
  endpoint: StructuredLlmProviderEndpoint;
  model: string;
  thinkingDepth: StructuredLlmModelTarget['thinkingDepth'] | null;
  source: StructuredLlmRouteSource;
  diagnostics: string[];
};

export function resolveStructuredLlmRoleRoute(input: {
  role: StructuredLlmRole;
  settings: StructuredLlmProviderSettings;
  override?: StructuredLlmModelTarget | null;
  policy?: StructuredLlmRoutePolicy;
}): ResolvedStructuredLlmRoute | null {
  return resolveStructuredLlmRoleRouteCandidates(input)[0] ?? null;
}

export function resolveStructuredLlmRoleRouteCandidates(input: {
  role: StructuredLlmRole;
  settings: StructuredLlmProviderSettings;
  override?: StructuredLlmModelTarget | null;
  policy?: StructuredLlmRoutePolicy;
}): ResolvedStructuredLlmRoute[] {
  const endpoints = input.settings.providerEndpoints || [];
  const override = resolveRouteTarget(
    input.role,
    input.override ?? undefined,
    endpoints,
    'override'
  );
  const policy = input.policy ?? {};
  if (override) {
    const filteredOverride = applyRoutePolicy([override], endpoints, input.role, policy);
    if (filteredOverride.length > 0) return filteredOverride;
  }

  const route = (input.settings.roleRoutes || []).find((item) => item.role === input.role);
  if (!route) return [];

  const primary = resolveRouteTarget(route.role, route.primary, endpoints, 'primary');
  const candidates = primary ? [primary] : [];

  for (let index = 0; index < route.fallbacks.length; index += 1) {
    const fallback = resolveRouteTarget(
      route.role,
      route.fallbacks[index],
      endpoints,
      'fallback',
      index
    );
    if (fallback) candidates.push(fallback);
  }
  return applyRoutePolicy(candidates, endpoints, input.role, policy);
}

function resolveRouteTarget(
  role: StructuredLlmRole,
  target: StructuredLlmModelTarget | undefined,
  endpoints: StructuredLlmProviderEndpoint[],
  source: StructuredLlmRouteSource,
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

function applyRoutePolicy(
  candidates: ResolvedStructuredLlmRoute[],
  endpoints: StructuredLlmProviderEndpoint[],
  role: StructuredLlmRole,
  policy: StructuredLlmRoutePolicy
): ResolvedStructuredLlmRoute[] {
  const disallowed = new Set(policy.disallowedProviderIds ?? []);
  const allowed = candidates
    .filter((candidate) => !disallowed.has(candidate.providerId))
    .map((candidate) => ({
      ...candidate,
      diagnostics:
        disallowed.size > 0
          ? [...candidate.diagnostics, `routePolicy.disallowed=${[...disallowed].join(',')}`]
          : candidate.diagnostics,
    }));

  if (!policy.synthesizeFallbacksFromEnabledEndpoints) return allowed;

  const seen = new Set(allowed.map((candidate) => candidate.providerEndpointId));
  let fallbackIndex = candidates.filter((candidate) => candidate.source === 'fallback').length;
  for (const endpoint of endpoints) {
    if (
      !endpoint.enabled ||
      disallowed.has(providerIdForEndpoint(endpoint)) ||
      seen.has(endpoint.id)
    ) {
      continue;
    }
    const model = endpoint.models[0];
    if (!model) continue;
    const fallback = resolveRouteTarget(
      role,
      { providerEndpointId: endpoint.id, model },
      endpoints,
      'fallback',
      fallbackIndex
    );
    fallbackIndex += 1;
    if (!fallback || disallowed.has(fallback.providerId)) continue;
    seen.add(fallback.providerEndpointId);
    allowed.push({
      ...fallback,
      diagnostics: [
        ...fallback.diagnostics,
        'routePolicy.synthesizedFallback=true',
        ...(disallowed.size > 0 ? [`routePolicy.disallowed=${[...disallowed].join(',')}`] : []),
      ],
    });
  }

  return allowed;
}
