import { z } from "@hono/zod-openapi";
import { isLlmRole, resolveLlmRole } from "../../../../shared/llm-role";
import { ValidationError } from "../../../lib/errors";
import {
	mergeCodexModelOptionsIntoEndpoints,
	readCodexModelOptions,
} from "../../../services/codex-global-config/status";
import { migrateStructuredLlmEndpointIds } from "../../../services/structured-llm/endpoint-id-migration";
import {
	LLM_ROLE_ORDER,
	type LlmModelTarget,
	type LlmProviderEndpoint,
	type LlmRole,
	type LlmRoleRoute,
	type LlmSettings,
	llmModelTargetSchema,
	llmProviderEndpointSchema,
	llmRoleRouteSchema,
	providerModelOptions,
	type RawLlmSettings,
} from "./llm-settings-contract";

export const getRuntimeLaneSetting = (
	value: unknown,
): "" | "native-api-runner" | "codex-sdk" => {
	if (value === "native-api-runner" || value === "codex-sdk") return value;
	if (value === "native-supervisor") return "native-api-runner";
	if (value === "codex-agent") return "codex-sdk";
	return "";
};

export const getStructuredProviderSetting = (
	value: unknown,
): "azure" | "openai" | "bedrock" | "codex" => {
	if (
		value === "openai" ||
		value === "azure" ||
		value === "bedrock" ||
		value === "codex"
	) {
		return value;
	}
	return "azure";
};

export function normalizeRawLlmSettings(input: RawLlmSettings): LlmSettings {
	const {
		providerEndpoints: rawProviderEndpoints,
		roleRoutes: rawRoleRoutes,
		...rawLegacy
	} = input;
	const legacySettings: Omit<LlmSettings, "providerEndpoints" | "roleRoutes"> =
		{
			...rawLegacy,
			ACTIVE_LLM_PROVIDER: getStructuredProviderSetting(
				rawLegacy.ACTIVE_LLM_PROVIDER,
			),
			IMPLEMENTATION_RUNTIME_LANE: getRuntimeLaneSetting(
				rawLegacy.IMPLEMENTATION_RUNTIME_LANE,
			),
		};
	const providerEndpoints = normalizeProviderEndpoints(
		rawProviderEndpoints,
		legacySettings,
	);
	validateExplicitRoleRoutesOrThrow(rawRoleRoutes, providerEndpoints);
	const normalized = {
		...legacySettings,
		providerEndpoints,
		roleRoutes: normalizeRoleRoutes(
			rawRoleRoutes,
			providerEndpoints,
			legacySettings.ACTIVE_LLM_PROVIDER,
		),
	};
	return migrateStructuredLlmEndpointIds(normalized).settings;
}

export function normalizeProviderEndpoints(
	input: unknown,
	legacySettings: Omit<LlmSettings, "providerEndpoints" | "roleRoutes">,
): LlmProviderEndpoint[] {
	const parsed = z.array(llmProviderEndpointSchema).safeParse(input);
	const endpoints = parsed.success ? dedupeProviderEndpoints(parsed.data) : [];
	const endpointById = new Map(
		endpoints.map((endpoint) => [endpoint.id, endpoint]),
	);
	const defaultEndpointKeys = new Set(
		endpoints.map(defaultProviderEndpointKey).filter(Boolean),
	);
	for (const endpoint of buildLegacyProviderEndpoints(legacySettings)) {
		const defaultKey = defaultProviderEndpointKey(endpoint);
		if (defaultKey && defaultEndpointKeys.has(defaultKey)) continue;
		if (!endpointById.has(endpoint.id)) endpointById.set(endpoint.id, endpoint);
	}
	return mergeCodexModelOptionsIntoEndpoints(
		dedupeProviderEndpoints([...endpointById.values()]),
		{ configuredModel: legacySettings.CODEX_MODEL },
	).map((endpoint) => {
		const models = uniqueNonEmpty(endpoint.models);
		return {
			...endpoint,
			models,
			modelDisplayNames: normalizeModelDisplayNames(
				endpoint.modelDisplayNames,
				models,
			),
		};
	});
}

function dedupeProviderEndpoints(endpoints: LlmProviderEndpoint[]) {
	const endpointById = new Map<string, LlmProviderEndpoint>();
	const defaultEndpointByKey = new Map<string, string>();
	for (const endpoint of endpoints) {
		const normalizedEndpoint = {
			...endpoint,
			models: uniqueNonEmpty(endpoint.models),
		};
		const defaultKey = defaultProviderEndpointKey(normalizedEndpoint);
		if (defaultKey) {
			const existingId = defaultEndpointByKey.get(defaultKey);
			if (existingId) {
				const existing = endpointById.get(existingId);
				if (existing)
					endpointById.set(
						existingId,
						mergeDuplicateEndpoint(existing, normalizedEndpoint),
					);
				continue;
			}
			defaultEndpointByKey.set(defaultKey, normalizedEndpoint.id);
		}
		endpointById.set(normalizedEndpoint.id, normalizedEndpoint);
	}
	return [...endpointById.values()];
}

function mergeDuplicateEndpoint(
	current: LlmProviderEndpoint,
	duplicate: LlmProviderEndpoint,
): LlmProviderEndpoint {
	return {
		...current,
		enabled: current.enabled || duplicate.enabled,
		apiKey: current.apiKey || duplicate.apiKey,
		baseUrl: current.baseUrl || duplicate.baseUrl,
		endpoint: current.endpoint || duplicate.endpoint,
		apiVersion: current.apiVersion || duplicate.apiVersion,
		region: current.region || duplicate.region,
		models: uniqueNonEmpty([...current.models, ...duplicate.models]),
		modelDisplayNames: {
			...duplicate.modelDisplayNames,
			...current.modelDisplayNames,
		},
		defaultModelCapability:
			current.defaultModelCapability || duplicate.defaultModelCapability,
		modelCapabilities: {
			...duplicate.modelCapabilities,
			...current.modelCapabilities,
		},
	};
}

function defaultProviderEndpointKey(
	endpoint: LlmProviderEndpoint,
): string | null {
	const defaultNames: Record<LlmProviderEndpoint["kind"], string | null> = {
		azure: "Azure OpenAI",
		openai: "OpenAI Compatible",
		"openai-compatible": "OpenAI Compatible",
		bedrock: "AWS Bedrock",
		codex: "Codex SDK",
		local: null,
	};
	const defaultName = defaultNames[endpoint.kind];
	if (!defaultName || endpoint.name !== defaultName) return null;
	return [
		endpoint.kind,
		endpoint.baseUrl || "",
		endpoint.endpoint || "",
		endpoint.apiVersion || "",
		endpoint.region || "",
	].join("\u0001");
}

function buildLegacyProviderEndpoints(
	settings: Omit<LlmSettings, "providerEndpoints" | "roleRoutes">,
): LlmProviderEndpoint[] {
	return [
		{
			id: "azure-default",
			name: "Azure OpenAI",
			kind: "azure",
			enabled: settings.AZURE_OPENAI_ENABLED,
			apiKey: settings.AZURE_OPENAI_API_KEY,
			baseUrl: "",
			endpoint: settings.AZURE_OPENAI_ENDPOINT,
			apiVersion: settings.AZURE_OPENAI_API_VERSION,
			region: "",
			models: uniqueNonEmpty([
				settings.AZURE_OPENAI_DEPLOYMENT_NAME,
				...providerModelOptions.azure,
			]),
			modelDisplayNames: {},
		},
		{
			id: "openai-default",
			name: "OpenAI Compatible",
			kind: "openai",
			enabled: settings.OPENAI_ENABLED,
			apiKey: settings.OPENAI_API_KEY,
			baseUrl: settings.OPENAI_BASE_URL,
			endpoint: "",
			apiVersion: "",
			region: "",
			models: uniqueNonEmpty([
				settings.OPENAI_MODEL,
				...providerModelOptions.openai,
			]),
			modelDisplayNames: {},
		},
		{
			id: "bedrock-default",
			name: "AWS Bedrock",
			kind: "bedrock",
			enabled: settings.AWS_BEDROCK_ENABLED,
			apiKey: "",
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region: settings.AWS_REGION,
			models: uniqueNonEmpty([
				settings.AWS_BEDROCK_MODEL,
				...providerModelOptions.bedrock,
			]),
			modelDisplayNames: {},
		},
		{
			id: "codex-default",
			name: "Codex SDK",
			kind: "codex",
			enabled: settings.CODEX_ENABLED,
			apiKey: settings.CODEX_ACCESS_TOKEN,
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region: "",
			models: uniqueNonEmpty(
				readCodexModelOptions({ configuredModel: settings.CODEX_MODEL }).map(
					(option) => option.value,
				),
			),
			modelDisplayNames: {},
		},
	];
}

export function normalizeRoleRoutes(
	input: unknown,
	providerEndpoints: LlmProviderEndpoint[],
	activeProvider: string,
): LlmRoleRoute[] {
	const routesByRole = new Map<LlmRole, z.infer<typeof llmRoleRouteSchema>>();
	const legacyRoutesByRole = new Map<
		LlmRole,
		Array<z.infer<typeof llmRoleRouteSchema>>
	>();
	for (const candidate of Array.isArray(input) ? input : []) {
		if (!candidate || typeof candidate !== "object") continue;
		const sourceRole = (candidate as Record<string, unknown>).role;
		const role = resolveLlmRole(sourceRole);
		if (!role) continue;
		const parsed = llmRoleRouteSchema.safeParse({ ...candidate, role });
		if (!parsed.success) continue;
		if (isLlmRole(sourceRole)) {
			routesByRole.set(role, parsed.data);
			continue;
		}
		legacyRoutesByRole.set(role, [
			...(legacyRoutesByRole.get(role) ?? []),
			parsed.data,
		]);
	}
	const fallbackEndpoint = findDefaultEndpointForProvider(
		providerEndpoints,
		activeProvider,
	);
	const defaultTarget: LlmModelTarget = {
		providerEndpointId: fallbackEndpoint?.id || "",
		model: fallbackEndpoint?.models[0] || "",
		thinkingDepth: "",
	};
	return LLM_ROLE_ORDER.map((role) => {
		const route = routesByRole.get(role);
		const legacyRoutes = legacyRoutesByRole.get(role) ?? [];
		if (route || legacyRoutes.length > 0) {
			return mergeRoleRoutes(
				route ?? legacyRoutes[0],
				route ? legacyRoutes : legacyRoutes.slice(1),
				defaultTarget,
				providerEndpoints,
			);
		}
		return {
			role,
			primary: defaultTarget,
			fallbacks: [],
		};
	});
}

function mergeRoleRoutes(
	primaryRoute: z.infer<typeof llmRoleRouteSchema>,
	additionalRoutes: Array<z.infer<typeof llmRoleRouteSchema>>,
	defaultTarget: LlmModelTarget,
	providerEndpoints: LlmProviderEndpoint[],
): LlmRoleRoute {
	const emptyTarget: LlmModelTarget = {
		providerEndpointId: "",
		model: "",
		thinkingDepth: "",
	};
	const normalized = normalizeRoleRoute(
		primaryRoute,
		emptyTarget,
		providerEndpoints,
	);
	const targets = uniqueModelTargets([
		...[normalized.primary, ...normalized.fallbacks].filter((target) =>
			isValidModelTarget(target, providerEndpoints),
		),
		...additionalRoutes.flatMap((route) => {
			const additional = normalizeRoleRoute(
				route,
				emptyTarget,
				providerEndpoints,
			);
			return [additional.primary, ...additional.fallbacks].filter((target) =>
				isValidModelTarget(target, providerEndpoints),
			);
		}),
	]);
	return {
		role: normalized.role,
		primary: targets[0] ?? defaultTarget,
		fallbacks: targets.slice(1),
	};
}

function normalizeRoleRoute(
	route: z.infer<typeof llmRoleRouteSchema>,
	defaultTarget: LlmModelTarget,
	providerEndpoints?: LlmProviderEndpoint[],
): LlmRoleRoute {
	const normalizedPrimary =
		normalizeModelTarget(route.primary) ||
		normalizeModelTarget({
			providerEndpointId: route.providerEndpointId,
			model: route.model,
		}) ||
		defaultTarget;
	const legacyFallback = normalizeModelTarget({
		providerEndpointId: route.fallbackProviderEndpointId,
		model: route.fallbackModel,
	});
	const fallbacks = uniqueModelTargets([
		...route.fallbacks
			.map(normalizeModelTarget)
			.filter((target) => Boolean(target)),
		...(legacyFallback ? [legacyFallback] : []),
	] as LlmModelTarget[]);
	if (!providerEndpoints) {
		return {
			role: route.role,
			primary: normalizedPrimary,
			fallbacks,
		};
	}
	const validFallbacks = fallbacks.filter((target) =>
		isValidModelTarget(target, providerEndpoints),
	);
	const primary = isValidModelTarget(normalizedPrimary, providerEndpoints)
		? normalizedPrimary
		: validFallbacks.shift() || defaultTarget;
	return {
		role: route.role,
		primary,
		fallbacks: validFallbacks,
	};
}

function normalizeModelTarget(input: unknown): LlmModelTarget | null {
	const parsed = llmModelTargetSchema.safeParse(input);
	if (!parsed.success) return null;
	const providerEndpointId = parsed.data.providerEndpointId.trim();
	const model = parsed.data.model.trim();
	if (!providerEndpointId || !model) return null;
	return {
		providerEndpointId,
		model,
		thinkingDepth: parsed.data.thinkingDepth || "",
	};
}

function uniqueModelTargets(targets: LlmModelTarget[]) {
	const seen = new Set<string>();
	return targets.filter((target) => {
		const key = `${target.providerEndpointId}\u0000${target.model}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isValidModelTarget(
	target: LlmModelTarget,
	providerEndpoints: LlmProviderEndpoint[],
) {
	if (!target.providerEndpointId || !target.model) return false;
	const endpoint = providerEndpoints.find(
		(item) => item.id === target.providerEndpointId,
	);
	return Boolean(endpoint?.enabled && endpoint.models.includes(target.model));
}

function findDefaultEndpointForProvider(
	endpoints: LlmProviderEndpoint[],
	provider: string,
): LlmProviderEndpoint | undefined {
	const defaultId =
		provider === "azure" ? "azure-default" : `${provider}-default`;
	return (
		endpoints.find((endpoint) => endpoint.id === defaultId) ||
		endpoints.find((endpoint) => endpoint.kind === provider) ||
		endpoints[0]
	);
}

function uniqueNonEmpty(values: Array<string | undefined>) {
	return [
		...new Set(
			values.map((value) => value?.trim()).filter(Boolean) as string[],
		),
	];
}

function normalizeModelDisplayNames(
	input: Record<string, string> | undefined,
	models: string[],
): Record<string, string> {
	const modelSet = new Set(models);
	return Object.fromEntries(
		Object.entries(input || {})
			.map(([model, label]) => [model.trim(), label.trim()])
			.filter(([model, label]) => modelSet.has(model) && Boolean(label)),
	);
}

function validateExplicitRoleRoutesOrThrow(
	input: unknown,
	providerEndpoints: LlmProviderEndpoint[],
) {
	const parsed = z.array(llmRoleRouteSchema).safeParse(input);
	if (!parsed.success) return;
	const endpointsById = new Map(
		providerEndpoints.map((endpoint) => [endpoint.id, endpoint]),
	);
	const issues: Array<Record<string, unknown>> = [];
	for (const route of parsed.data) {
		const normalized = normalizeRoleRoute(route, {
			providerEndpointId: "",
			model: "",
			thinkingDepth: "",
		});
		validateRouteTarget({
			issues,
			endpointsById,
			role: normalized.role,
			source: "primary",
			target: normalized.primary,
		});
		normalized.fallbacks.forEach((target, fallbackIndex) => {
			validateRouteTarget({
				issues,
				endpointsById,
				role: normalized.role,
				source: "fallback",
				target,
				fallbackIndex,
			});
		});
	}
	if (issues.length > 0) {
		throw new ValidationError("Invalid Role Routing target", { issues });
	}
}

function validateRouteTarget(input: {
	issues: Array<Record<string, unknown>>;
	endpointsById: Map<string, LlmProviderEndpoint>;
	role: LlmRole;
	source: "primary" | "fallback";
	target: LlmModelTarget;
	fallbackIndex?: number;
}) {
	if (!input.target.providerEndpointId || !input.target.model) return;
	const endpoint = input.endpointsById.get(input.target.providerEndpointId);
	const baseIssue = {
		role: input.role,
		source: input.source,
		providerEndpointId: input.target.providerEndpointId,
		model: input.target.model,
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
	if (!endpoint.models.includes(input.target.model)) {
		input.issues.push({ ...baseIssue, reason: "missing_model" });
	}
}
