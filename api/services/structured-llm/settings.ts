import fs from "node:fs";
import path from "node:path";
import {
	isLlmRole,
	LLM_ROLE_ORDER,
	resolveLlmRole,
	type LlmRole as StructuredLlmRole,
} from "../../../shared/llm-role";
import { getRuntimePaths } from "../../runtime/paths";
import { mergeCodexModelOptionsIntoEndpoints } from "../codex-global-config/status";
import { readApplicationSetting } from "../settings/application-settings-store";
import { migrateStructuredLlmEndpointIds } from "./endpoint-id-migration";

export type StructuredLlmProviderSettings = {
	settingsRevision?: string;
	endpointIdSchemaVersion?: number;
	ACTIVE_LLM_PROVIDER?: string;
	OPENAI_ENABLED?: boolean;
	OPENAI_API_KEY?: string;
	OPENAI_BASE_URL?: string;
	OPENAI_MODEL?: string;
	OPENAI_STREAMING_ENABLED?: boolean;
	AZURE_OPENAI_ENABLED?: boolean;
	AZURE_OPENAI_API_KEY?: string;
	AZURE_OPENAI_ENDPOINT?: string;
	AZURE_OPENAI_DEPLOYMENT_NAME?: string;
	AZURE_OPENAI_API_VERSION?: string;
	AWS_BEDROCK_ENABLED?: boolean;
	AWS_ACCESS_KEY_ID?: string;
	AWS_SECRET_ACCESS_KEY?: string;
	AWS_REGION?: string;
	AWS_BEDROCK_MODEL?: string;
	CODEX_ENABLED?: boolean;
	CODEX_ACCESS_TOKEN?: string;
	CODEX_MODEL?: string;
	CODEX_MODEL_REASONING_EFFORT?: string;
	CODEX_STRUCTURED_OUTPUT_ENABLED?: boolean;
	providerEndpoints?: StructuredLlmProviderEndpoint[];
	roleRoutes?: StructuredLlmRoleRoute[];
};

export type StructuredLlmProviderEndpointKind =
	| "azure"
	| "openai"
	| "openai-compatible"
	| "bedrock"
	| "codex"
	| "local";

export type { StructuredLlmRole };

export type StructuredLlmThinkingDepth =
	| ""
	| "low"
	| "medium"
	| "high"
	| "very_high";

export type StructuredLlmCompressionProfile =
	| "none"
	| "light"
	| "balanced"
	| "aggressive"
	| string;

export type StructuredLlmModelCapability = {
	contextWindowTokens?: number;
	safePromptBudgetTokens?: number;
	reservedOutputTokens?: number;
	supportsProviderSideCompression?: boolean;
	compressionProfile?: StructuredLlmCompressionProfile;
};

export type StructuredLlmProviderEndpoint = {
	id: string;
	name: string;
	kind: StructuredLlmProviderEndpointKind;
	enabled: boolean;
	apiKey?: string;
	baseUrl?: string;
	endpoint?: string;
	apiVersion?: string;
	region?: string;
	models: string[];
	modelDisplayNames?: Record<string, string>;
	defaultModelCapability?: StructuredLlmModelCapability;
	modelCapabilities?: Record<string, StructuredLlmModelCapability>;
};

export type StructuredLlmModelTarget = {
	providerEndpointId: string;
	model: string;
	thinkingDepth?: StructuredLlmThinkingDepth;
};

export type StructuredLlmRoleRoute = {
	role: StructuredLlmRole;
	primary: StructuredLlmModelTarget;
	fallbacks: StructuredLlmModelTarget[];
};

const boolKeys = new Set<keyof StructuredLlmProviderSettings>([
	"OPENAI_ENABLED",
	"OPENAI_STREAMING_ENABLED",
	"AZURE_OPENAI_ENABLED",
	"AWS_BEDROCK_ENABLED",
	"CODEX_ENABLED",
	"CODEX_STRUCTURED_OUTPUT_ENABLED",
]);

export function readStructuredLlmProviderSettings(): StructuredLlmProviderSettings {
	const persisted = readPersistedRuntimeSettings();
	const merged: StructuredLlmProviderSettings = {};
	for (const key of Object.keys(defaultSettings()) as Array<
		keyof StructuredLlmProviderSettings
	>) {
		const persistedValue = persisted[key];
		if (
			persistedValue !== undefined &&
			persistedValue !== null &&
			persistedValue !== ""
		) {
			merged[key] = persistedValue as never;
			continue;
		}
		const envValue = process.env[key];
		if (envValue === undefined) continue;
		merged[key] = normalizeSettingValue(key, envValue) as never;
	}
	merged.ACTIVE_LLM_PROVIDER = normalizeStructuredLlmProviderSetting(
		merged.ACTIVE_LLM_PROVIDER,
	);
	const migrated = migrateStructuredLlmEndpointIds(merged).settings;
	const providerEndpoints = mergeCodexModelOptionsIntoEndpoints(
		migrated.providerEndpoints || [],
		{ configuredModel: migrated.CODEX_MODEL },
	);
	return sanitizeStructuredLlmRoleRoutes({
		...migrated,
		providerEndpoints,
	});
}

export function normalizeStructuredLlmProviderSetting(
	value?: string,
): string | undefined {
	return value;
}

export function getStructuredLlmSetting(
	settings: StructuredLlmProviderSettings,
	key: keyof StructuredLlmProviderSettings,
	fallback?: string,
): string {
	const value = settings[key];
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return String(value);
	return fallback ?? "";
}

export function getStructuredLlmBoolSetting(
	settings: StructuredLlmProviderSettings,
	key: keyof StructuredLlmProviderSettings,
	fallback: boolean,
): boolean {
	const value = settings[key];
	if (typeof value === "boolean") return value;
	if (typeof value === "string") return value.toLowerCase() === "true";
	return fallback;
}

function readPersistedRuntimeSettings(): Partial<StructuredLlmProviderSettings> {
	try {
		const testSettingsPath =
			process.env.NODE_ENV === "test"
				? process.env.NIGHTWORKERS_LLM_SETTINGS_PATH
				: undefined;
		const sqliteSettings = testSettingsPath
			? null
			: readApplicationSetting<StructuredLlmProviderSettings>("llm");
		if (sqliteSettings) return sqliteSettings;
		const runtimeSettingsPath =
			testSettingsPath ||
			path.join(getRuntimePaths().settingsDir, "llm-settings.json");
		if (!fs.existsSync(runtimeSettingsPath)) return {};
		const raw = JSON.parse(fs.readFileSync(runtimeSettingsPath, "utf-8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		return raw as Partial<StructuredLlmProviderSettings>;
	} catch {
		return {};
	}
}

function defaultSettings(): Required<
	Record<keyof StructuredLlmProviderSettings, null>
> {
	return {
		ACTIVE_LLM_PROVIDER: null,
		settingsRevision: null,
		endpointIdSchemaVersion: null,
		OPENAI_ENABLED: null,
		OPENAI_API_KEY: null,
		OPENAI_BASE_URL: null,
		OPENAI_MODEL: null,
		OPENAI_STREAMING_ENABLED: null,
		AZURE_OPENAI_ENABLED: null,
		AZURE_OPENAI_API_KEY: null,
		AZURE_OPENAI_ENDPOINT: null,
		AZURE_OPENAI_DEPLOYMENT_NAME: null,
		AZURE_OPENAI_API_VERSION: null,
		AWS_BEDROCK_ENABLED: null,
		AWS_ACCESS_KEY_ID: null,
		AWS_SECRET_ACCESS_KEY: null,
		AWS_REGION: null,
		AWS_BEDROCK_MODEL: null,
		CODEX_ENABLED: null,
		CODEX_ACCESS_TOKEN: null,
		CODEX_MODEL: null,
		CODEX_MODEL_REASONING_EFFORT: null,
		CODEX_STRUCTURED_OUTPUT_ENABLED: null,
		providerEndpoints: null,
		roleRoutes: null,
	};
}

function normalizeSettingValue(
	key: keyof StructuredLlmProviderSettings,
	value: string,
) {
	if (boolKeys.has(key)) return value.toLowerCase() === "true";
	return value;
}

function sanitizeStructuredLlmRoleRoutes(
	settings: StructuredLlmProviderSettings,
): StructuredLlmProviderSettings {
	const endpoints = settings.providerEndpoints || [];
	if (endpoints.length === 0 || !settings.roleRoutes?.length) return settings;
	const canonicalRoutes = new Map<StructuredLlmRole, StructuredLlmRoleRoute>();
	const legacyRoutes = new Map<StructuredLlmRole, StructuredLlmRoleRoute[]>();
	for (const route of settings.roleRoutes) {
		const sourceRole: unknown = route.role;
		const role = resolveLlmRole(sourceRole);
		if (!role) continue;
		const validFallbacks = (route.fallbacks || []).filter((target) =>
			isValidStructuredLlmModelTarget(target, endpoints),
		);
		let sanitized: StructuredLlmRoleRoute | null = null;
		if (isValidStructuredLlmModelTarget(route.primary, endpoints)) {
			sanitized = { role, primary: route.primary, fallbacks: validFallbacks };
		} else {
			const promotedPrimary = validFallbacks.shift();
			if (promotedPrimary) {
				sanitized = {
					role,
					primary: promotedPrimary,
					fallbacks: validFallbacks,
				};
			}
		}
		if (!sanitized) continue;
		if (isLlmRole(sourceRole)) {
			canonicalRoutes.set(role, sanitized);
		} else {
			legacyRoutes.set(role, [...(legacyRoutes.get(role) ?? []), sanitized]);
		}
	}
	const validRoutes = LLM_ROLE_ORDER.flatMap((role) => {
		const canonical = canonicalRoutes.get(role);
		const legacy = legacyRoutes.get(role) ?? [];
		const selected = canonical ?? legacy[0];
		if (!selected) return [];
		const additional = canonical ? legacy : legacy.slice(1);
		const targets = uniqueStructuredLlmModelTargets([
			selected.primary,
			...selected.fallbacks,
			...additional.flatMap((route) => [route.primary, ...route.fallbacks]),
		]);
		return [{ role, primary: targets[0], fallbacks: targets.slice(1) }];
	});

	return { ...settings, roleRoutes: validRoutes };
}

function uniqueStructuredLlmModelTargets(
	targets: StructuredLlmModelTarget[],
): StructuredLlmModelTarget[] {
	const seen = new Set<string>();
	return targets.filter((target) => {
		const key = `${target.providerEndpointId}\u0000${target.model}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isValidStructuredLlmModelTarget(
	target: StructuredLlmModelTarget | undefined,
	endpoints: StructuredLlmProviderEndpoint[],
) {
	if (!target?.providerEndpointId || !target.model) return false;
	const endpoint = endpoints.find(
		(item) => item.id === target.providerEndpointId,
	);
	return Boolean(endpoint?.enabled && endpoint.models.includes(target.model));
}
