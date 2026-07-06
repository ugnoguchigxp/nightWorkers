import {
	type ResolvedStructuredLlmRoute,
	resolveStructuredLlmRoleRoute,
	resolveStructuredLlmRoleRouteCandidates,
} from "./role-routing";
import {
	getStructuredLlmSetting,
	normalizeStructuredLlmProviderSetting,
	readStructuredLlmProviderSettings,
	type StructuredLlmModelTarget,
	type StructuredLlmProviderSettings,
} from "./settings";
import type {
	NormalizedSupervisorLlmRequest,
	ProviderCapabilityPolicy,
	StructuredLlmRole,
	StructuredLlmRoutePolicy,
	SupervisorProviderClass,
	SupervisorProviderId,
} from "./types";

export function buildNormalizedSupervisorLlmRequest(input: {
	systemPrompt: string;
	userPrompt: string;
	jsonSchema?: { name: string; schema: unknown };
	label: string;
	round?: 1 | 2;
	schemaFirst?: boolean;
	role?: StructuredLlmRole;
	routeOverride?: StructuredLlmModelTarget | null;
	routePolicy?: StructuredLlmRoutePolicy;
	settings?: StructuredLlmProviderSettings;
	resolvedRoute?: ResolvedStructuredLlmRoute | null;
}): NormalizedSupervisorLlmRequest {
	const settings = input.settings ?? readStructuredLlmProviderSettings();
	const resolvedRoute =
		input.resolvedRoute !== undefined
			? input.resolvedRoute
			: input.role
				? resolveStructuredLlmRoleRoute({
						role: input.role,
						settings,
						override: input.routeOverride,
						policy: input.routePolicy,
					})
				: null;
	const rawProvider =
		resolvedRoute?.providerId ||
		normalizeStructuredLlmProviderSetting(
			getStructuredLlmSetting(settings, "ACTIVE_LLM_PROVIDER", "azure"),
		) ||
		"azure";
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
		providerEndpointId: resolvedRoute?.providerEndpointId ?? null,
		role: input.role ?? null,
		routeSource: resolvedRoute?.source ?? null,
		modelOrDeployment:
			resolvedRoute?.model ?? resolveModelOrDeployment(providerId, settings),
		thinkingDepth: resolvedRoute?.thinkingDepth || null,
		endpoint:
			resolvedRoute?.endpoint.endpoint ||
			resolvedRoute?.endpoint.baseUrl ||
			resolveEndpoint(providerId, settings),
		region:
			resolvedRoute?.endpoint.region ||
			(providerId === "bedrock"
				? getStructuredLlmSetting(settings, "AWS_REGION", "us-east-1")
				: null),
		apiVersion:
			resolvedRoute?.endpoint.apiVersion ||
			(providerId === "azure-openai"
				? getStructuredLlmSetting(
						settings,
						"AZURE_OPENAI_API_VERSION",
						"2024-05-01-preview",
					)
				: null),
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		jsonSchema: input.jsonSchema,
		capabilityPolicy,
		diagnostics: {
			label: input.label,
			round: input.round ?? null,
			artifactSchemaName: input.schemaFirst
				? null
				: (input.jsonSchema?.name ?? null),
			sourceArtifactRef: null,
			systemPromptLength: input.systemPrompt.length,
			userPromptLength: input.userPrompt.length,
			role: input.role ?? null,
			providerEndpointId: resolvedRoute?.providerEndpointId ?? null,
			routeSource: resolvedRoute?.source ?? null,
			modelOrDeployment: resolvedRoute?.model ?? null,
			thinkingDepth: resolvedRoute?.thinkingDepth || null,
			routeDiagnostics: resolvedRoute?.diagnostics ?? [],
		},
	};
}

export function buildNormalizedSupervisorLlmRequestCandidates(input: {
	systemPrompt: string;
	userPrompt: string;
	jsonSchema?: { name: string; schema: unknown };
	label: string;
	round?: 1 | 2;
	schemaFirst?: boolean;
	role?: StructuredLlmRole;
	routeOverride?: StructuredLlmModelTarget | null;
	routePolicy?: StructuredLlmRoutePolicy;
	settings?: StructuredLlmProviderSettings;
}): NormalizedSupervisorLlmRequest[] {
	const settings = input.settings ?? readStructuredLlmProviderSettings();
	if (!input.role) {
		return [
			buildNormalizedSupervisorLlmRequest({
				...input,
				settings,
				resolvedRoute: null,
			}),
		];
	}
	const routeCandidates = resolveStructuredLlmRoleRouteCandidates({
		role: input.role,
		settings,
		override: input.routeOverride,
		policy: input.routePolicy,
	});
	if (routeCandidates.length === 0) {
		if (input.routePolicy || isRoleRouteConfigured(settings, input.role))
			return [];
		return [
			buildNormalizedSupervisorLlmRequest({
				...input,
				settings,
				resolvedRoute: null,
			}),
		];
	}
	return routeCandidates.map((resolvedRoute) =>
		buildNormalizedSupervisorLlmRequest({ ...input, settings, resolvedRoute }),
	);
}

function isRoleRouteConfigured(
	settings: StructuredLlmProviderSettings,
	role: StructuredLlmRole,
) {
	return (settings.roleRoutes || []).some((route) => route.role === role);
}

export function normalizeProviderId(value: string): SupervisorProviderId {
	if (value === "azure") return "azure-openai";
	if (
		value === "openai" ||
		value === "azure-openai" ||
		value === "bedrock" ||
		value === "codex" ||
		value === "fixture" ||
		value === "test"
	) {
		return value;
	}
	return value as SupervisorProviderId;
}

export function providerAdapterKey(
	providerId: SupervisorProviderId | string,
): string {
	return providerId === "azure-openai" ? "azure" : providerId;
}

function resolveProviderClass(
	providerId: SupervisorProviderId,
): SupervisorProviderClass {
	if (providerId === "bedrock") return "converse_message";
	if (providerId === "fixture" || providerId === "test") return "fixture";
	return "chat_completion";
}

function resolveCallKind(
	label: string,
	providerClass: SupervisorProviderClass,
): NormalizedSupervisorLlmRequest["callKind"] {
	if (providerClass === "fixture") return "fixture";
	if (label === "supervisor") return "supervisor_decision";
	if (
		label === "design_questionnaire" ||
		label === "design_questionnaire_follow_up" ||
		label === "design_questionnaire_follow_up_decision"
	) {
		return "design_questionnaire";
	}
	if (label === "design_decision_review") return "design_decision_review";
	return "structured_artifact";
}

function buildCapabilityPolicy(input: {
	callKind: NormalizedSupervisorLlmRequest["callKind"];
	providerClass: SupervisorProviderClass;
	schemaFirst?: boolean;
}): ProviderCapabilityPolicy {
	return {
		allowProviderToolCalls: false,
		allowProviderFileWrites: false,
		allowProviderCommandExecution: false,
		allowProviderNetwork: false,
		requireStructuredOutput: input.schemaFirst || input.callKind !== "fixture",
		rejectUnobservedProviderActivity: input.providerClass !== "fixture",
	};
}

function resolveModelOrDeployment(
	providerId: SupervisorProviderId,
	settings: StructuredLlmProviderSettings,
) {
	if (providerId === "openai")
		return getStructuredLlmSetting(settings, "OPENAI_MODEL", "gpt-4o-mini");
	if (providerId === "azure-openai") {
		return getStructuredLlmSetting(
			settings,
			"AZURE_OPENAI_DEPLOYMENT_NAME",
			"gpt-5-mini",
		);
	}
	if (providerId === "bedrock") {
		return getStructuredLlmSetting(
			settings,
			"AWS_BEDROCK_MODEL",
			"anthropic.claude-3-5-sonnet-20241022-v2:0",
		);
	}
	if (providerId === "codex") {
		return getStructuredLlmSetting(settings, "CODEX_MODEL", "gpt-5.4-mini");
	}
	return null;
}

function resolveEndpoint(
	providerId: SupervisorProviderId,
	settings: StructuredLlmProviderSettings,
) {
	if (providerId === "openai") {
		return getStructuredLlmSetting(
			settings,
			"OPENAI_BASE_URL",
			"https://api.openai.com/v1",
		);
	}
	if (providerId === "azure-openai") {
		return getStructuredLlmSetting(settings, "AZURE_OPENAI_ENDPOINT", "");
	}
	return null;
}
