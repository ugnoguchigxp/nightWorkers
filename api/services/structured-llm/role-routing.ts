import type {
	StructuredLlmModelTarget,
	StructuredLlmProviderEndpoint,
	StructuredLlmProviderSettings,
	StructuredLlmRole,
} from "./settings";
import type {
	StructuredLlmRoutePolicy,
	StructuredLlmRouteSource,
	SupervisorProviderId,
} from "./types";

export type ResolvedStructuredLlmRoute = {
	role: StructuredLlmRole;
	providerEndpointId: string;
	providerId: SupervisorProviderId;
	endpoint: StructuredLlmProviderEndpoint;
	model: string;
	thinkingDepth: StructuredLlmModelTarget["thinkingDepth"] | null;
	requestTimeoutSeconds: number | null;
	source: StructuredLlmRouteSource;
	diagnostics: string[];
};

export function structuredLlmRouteKey(
	route: Pick<
		ResolvedStructuredLlmRoute,
		"providerEndpointId" | "model" | "providerId"
	>,
): string {
	return `${route.providerEndpointId}::${route.model}::${route.providerId}`;
}

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
		"override",
	);
	const policy = input.policy ?? {};
	if (override) {
		const filteredOverride = applyRoutePolicy([override], policy);
		if (filteredOverride.length > 0) return filteredOverride;
	}

	const route = (input.settings.roleRoutes || []).find(
		(item) => item.role === input.role,
	);
	if (!route) return [];

	const primary = resolveRouteTarget(
		route.role,
		route.primary,
		endpoints,
		"primary",
	);
	const candidates = primary ? [primary] : [];

	for (let index = 0; index < route.fallbacks.length; index += 1) {
		const fallback = resolveRouteTarget(
			route.role,
			route.fallbacks[index],
			endpoints,
			"fallback",
			index,
		);
		if (fallback) candidates.push(fallback);
	}
	const routedCandidates = applyRoutePolicy(candidates, policy);
	if (routedCandidates.length > 0) return routedCandidates;
	if (input.policy) return [];
	return resolveEnabledEndpointFallbacks({
		role: input.role,
		settings: input.settings,
		policy,
	});
}

export type StructuredLlmRouteValidationIssue = {
	role: StructuredLlmRole;
	source: StructuredLlmRouteSource;
	providerEndpointId: string;
	model: string;
	reason: "missing_endpoint" | "disabled_endpoint" | "missing_model";
	fallbackIndex?: number;
};

export function validateStructuredLlmRoleRoutes(input: {
	settings: StructuredLlmProviderSettings;
}): StructuredLlmRouteValidationIssue[] {
	const endpoints = input.settings.providerEndpoints || [];
	const issues: StructuredLlmRouteValidationIssue[] = [];
	for (const route of input.settings.roleRoutes || []) {
		collectTargetValidationIssue({
			issues,
			role: route.role,
			source: "primary",
			target: route.primary,
			endpoints,
		});
		route.fallbacks.forEach((target, index) => {
			collectTargetValidationIssue({
				issues,
				role: route.role,
				source: "fallback",
				target,
				endpoints,
				fallbackIndex: index,
			});
		});
	}
	return issues;
}

function resolveRouteTarget(
	role: StructuredLlmRole,
	target: StructuredLlmModelTarget | undefined,
	endpoints: StructuredLlmProviderEndpoint[],
	source: StructuredLlmRouteSource,
	fallbackIndex?: number,
): ResolvedStructuredLlmRoute | null {
	if (!target?.providerEndpointId || !target.model) return null;

	const endpoint = endpoints.find(
		(item) => item.id === target.providerEndpointId,
	);
	if (!endpoint?.enabled) return null;
	if (!endpoint.models.includes(target.model)) return null;

	return {
		role,
		providerEndpointId: endpoint.id,
		providerId: providerIdForEndpoint(endpoint),
		endpoint,
		model: target.model,
		thinkingDepth: target.thinkingDepth || null,
		requestTimeoutSeconds: target.requestTimeoutSeconds ?? null,
		source,
		diagnostics: [
			`role=${role}`,
			`routeSource=${source}`,
			...(fallbackIndex === undefined
				? []
				: [`fallbackIndex=${fallbackIndex}`]),
			`providerEndpointId=${endpoint.id}`,
			`model=${target.model}`,
			...(target.thinkingDepth
				? [`thinkingDepth=${target.thinkingDepth}`]
				: []),
			...(target.requestTimeoutSeconds
				? [`requestTimeoutSeconds=${target.requestTimeoutSeconds}`]
				: []),
		],
	};
}

export function providerIdForEndpoint(
	endpoint: StructuredLlmProviderEndpoint,
): SupervisorProviderId {
	if (endpoint.kind === "azure") return "azure-openai";
	if (endpoint.kind === "openai-compatible" || endpoint.kind === "local")
		return "openai";
	return endpoint.kind;
}

function applyRoutePolicy(
	candidates: ResolvedStructuredLlmRoute[],
	policy: StructuredLlmRoutePolicy,
): ResolvedStructuredLlmRoute[] {
	const disallowed = new Set(policy.disallowedProviderIds ?? []);
	const allowed = dedupeResolvedRoutes(
		candidates
			.filter((candidate) => !disallowed.has(candidate.providerId))
			.filter((candidate) => isRouteReady(candidate, policy))
			.map((candidate) => ({
				...candidate,
				diagnostics:
					disallowed.size > 0
						? [
								...candidate.diagnostics,
								`routePolicy.disallowed=${[...disallowed].join(",")}`,
							]
						: candidate.diagnostics,
			})),
	);

	return allowed;
}

function collectTargetValidationIssue(input: {
	issues: StructuredLlmRouteValidationIssue[];
	role: StructuredLlmRole;
	source: StructuredLlmRouteSource;
	target: StructuredLlmModelTarget;
	endpoints: StructuredLlmProviderEndpoint[];
	fallbackIndex?: number;
}) {
	const providerEndpointId = input.target.providerEndpointId;
	const model = input.target.model;
	if (!providerEndpointId || !model) return;
	const endpoint = input.endpoints.find(
		(item) => item.id === providerEndpointId,
	);
	const baseIssue = {
		role: input.role,
		source: input.source,
		providerEndpointId,
		model,
		...(input.fallbackIndex === undefined
			? {}
			: { fallbackIndex: input.fallbackIndex }),
	};
	if (!endpoint) {
		input.issues.push({ ...baseIssue, reason: "missing_endpoint" });
		return;
	}
	if (!endpoint.enabled) {
		input.issues.push({ ...baseIssue, reason: "disabled_endpoint" });
		return;
	}
	if (!endpoint.models.includes(model)) {
		input.issues.push({ ...baseIssue, reason: "missing_model" });
	}
}

function dedupeResolvedRoutes(candidates: ResolvedStructuredLlmRoute[]) {
	const seen = new Set<string>();
	const deduped: ResolvedStructuredLlmRoute[] = [];
	for (const candidate of candidates) {
		const key = structuredLlmRouteKey(candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(candidate);
	}
	return deduped;
}

function isRouteReady(
	route: ResolvedStructuredLlmRoute,
	policy: StructuredLlmRoutePolicy,
) {
	return (
		route.source === "override" ||
		isEndpointReady(route.providerEndpointId, policy)
	);
}

function resolveEnabledEndpointFallbacks(input: {
	role: StructuredLlmRole;
	settings: StructuredLlmProviderSettings;
	policy: StructuredLlmRoutePolicy;
}) {
	const activeProviderId = normalizeActiveProviderId(
		input.settings.ACTIVE_LLM_PROVIDER,
	);
	const candidates = (input.settings.providerEndpoints || [])
		.filter((endpoint) => endpoint.enabled && endpoint.models.length > 0)
		.sort((left, right) => {
			const leftActive =
				providerIdForEndpoint(left) === activeProviderId ? 0 : 1;
			const rightActive =
				providerIdForEndpoint(right) === activeProviderId ? 0 : 1;
			return leftActive - rightActive;
		})
		.map((endpoint) => ({
			role: input.role,
			providerEndpointId: endpoint.id,
			providerId: providerIdForEndpoint(endpoint),
			endpoint,
			model: endpoint.models[0],
			thinkingDepth: null,
			requestTimeoutSeconds: null,
			source: "fallback" as const,
			diagnostics: [
				`role=${input.role}`,
				"routeSource=fallback",
				"fallbackReason=configured_route_unavailable",
				`providerEndpointId=${endpoint.id}`,
				`model=${endpoint.models[0]}`,
			],
		}));
	return applyRoutePolicy(candidates, input.policy);
}

function normalizeActiveProviderId(value: string | undefined) {
	if (value === "azure") return "azure-openai";
	return value;
}

function isEndpointReady(endpointId: string, policy: StructuredLlmRoutePolicy) {
	if (!policy.skipUnreachableEndpoints) return true;
	const readiness = policy.endpointReadiness?.[endpointId];
	if (!readiness) return true;
	return readiness.reachable !== false;
}
