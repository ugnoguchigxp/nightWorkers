import fs from "node:fs";
import path from "node:path";
import {
	getRuntimeLaneSetting,
	getStructuredProviderSetting,
	type LlmSettings,
	normalizeProviderEndpoints,
	normalizeRawLlmSettings,
	normalizeRoleRoutes,
	providerModelOptions,
	type RawLlmSettings,
	SECRET_SETTING_KEYS,
} from "../modules/settings";
import { getRuntimePaths } from "../runtime/paths";
import { migrateStructuredLlmEndpointIds } from "../services/structured-llm/endpoint-id-migration";

export type {
	LlmModelTarget,
	LlmProviderEndpoint,
	LlmRole,
	LlmRoleRoute,
	LlmSettings,
} from "../modules/settings";
export {
	LLM_ROLE_ORDER,
	llmProviderEndpointSchema,
	llmRoleSchema,
	llmSettingsSchema,
} from "../modules/settings";

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const RUNTIME_SETTINGS_PATH =
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH ||
	path.join(RUNTIME_SETTINGS_DIR, "llm-settings.json");
export const MASKED_SECRET = "********";

const getBoolEnv = (key: string, fallback: boolean) => {
	const value = process.env[key];
	if (!value) return fallback;
	return value.toLowerCase() === "true";
};

const readRuntimeSettings = (): {
	settings: Partial<RawLlmSettings>;
	exists: boolean;
	loaded: boolean;
} => {
	const exists = fs.existsSync(RUNTIME_SETTINGS_PATH);
	try {
		if (!exists) return { settings: {}, exists: false, loaded: false };
		const text = fs.readFileSync(RUNTIME_SETTINGS_PATH, "utf-8");
		return {
			settings: JSON.parse(text) as Partial<RawLlmSettings>,
			exists: true,
			loaded: true,
		};
	} catch {
		return { settings: {}, exists, loaded: false };
	}
};

const writeRuntimeSettings = (settings: LlmSettings) => {
	fs.mkdirSync(path.dirname(RUNTIME_SETTINGS_PATH), {
		recursive: true,
		mode: 0o700,
	});
	const tmpPath = `${RUNTIME_SETTINGS_PATH}.tmp`;
	fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, {
		encoding: "utf-8",
		mode: 0o600,
	});
	fs.renameSync(tmpPath, RUNTIME_SETTINGS_PATH);
	try {
		fs.chmodSync(path.dirname(RUNTIME_SETTINGS_PATH), 0o700);
		fs.chmodSync(RUNTIME_SETTINGS_PATH, 0o600);
	} catch {
		// Best-effort hardening; unsupported filesystems should not block local settings updates.
	}
};

export const getCurrentSettings = (): LlmSettings => {
	const persistedRead = readRuntimeSettings();
	const persisted = persistedRead.settings;
	const rawActiveProvider =
		persisted.ACTIVE_LLM_PROVIDER || process.env.ACTIVE_LLM_PROVIDER || "azure";
	const codexEnabled =
		typeof persisted.CODEX_ENABLED === "boolean"
			? persisted.CODEX_ENABLED
			: getBoolEnv("CODEX_ENABLED", false);
	const explicitRuntimeLane = getRuntimeLaneSetting(
		persisted.IMPLEMENTATION_RUNTIME_LANE ??
			process.env.IMPLEMENTATION_RUNTIME_LANE,
	);
	const legacyCodexRuntimeLane =
		rawActiveProvider === "codex" && codexEnabled ? "codex-sdk" : "";
	const legacySettings: Omit<LlmSettings, "providerEndpoints" | "roleRoutes"> =
		{
			settingsRevision:
				typeof persisted.settingsRevision === "string"
					? persisted.settingsRevision
					: undefined,
			endpointIdSchemaVersion:
				typeof persisted.endpointIdSchemaVersion === "number"
					? persisted.endpointIdSchemaVersion
					: undefined,
			ACTIVE_LLM_PROVIDER: getStructuredProviderSetting(rawActiveProvider),
			OPENAI_ENABLED:
				typeof persisted.OPENAI_ENABLED === "boolean"
					? persisted.OPENAI_ENABLED
					: getBoolEnv("OPENAI_ENABLED", true),
			AZURE_OPENAI_ENABLED:
				typeof persisted.AZURE_OPENAI_ENABLED === "boolean"
					? persisted.AZURE_OPENAI_ENABLED
					: getBoolEnv("AZURE_OPENAI_ENABLED", false),
			AZURE_OPENAI_API_KEY:
				persisted.AZURE_OPENAI_API_KEY ??
				process.env.AZURE_OPENAI_API_KEY ??
				"",
			AZURE_OPENAI_ENDPOINT:
				persisted.AZURE_OPENAI_ENDPOINT ??
				process.env.AZURE_OPENAI_ENDPOINT ??
				"",
			AZURE_OPENAI_DEPLOYMENT_NAME:
				persisted.AZURE_OPENAI_DEPLOYMENT_NAME ??
				process.env.AZURE_OPENAI_DEPLOYMENT_NAME ??
				"",
			AZURE_OPENAI_API_VERSION:
				persisted.AZURE_OPENAI_API_VERSION ??
				process.env.AZURE_OPENAI_API_VERSION ??
				"",
			AWS_BEDROCK_ENABLED:
				typeof persisted.AWS_BEDROCK_ENABLED === "boolean"
					? persisted.AWS_BEDROCK_ENABLED
					: getBoolEnv("AWS_BEDROCK_ENABLED", false),
			AWS_ACCESS_KEY_ID:
				persisted.AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "",
			AWS_SECRET_ACCESS_KEY:
				persisted.AWS_SECRET_ACCESS_KEY ??
				process.env.AWS_SECRET_ACCESS_KEY ??
				"",
			AWS_REGION: persisted.AWS_REGION ?? process.env.AWS_REGION ?? "",
			AWS_BEDROCK_MODEL:
				persisted.AWS_BEDROCK_MODEL ?? process.env.AWS_BEDROCK_MODEL ?? "",
			OPENAI_API_KEY:
				persisted.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
			OPENAI_BASE_URL:
				persisted.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "",
			OPENAI_MODEL: persisted.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "",
			CODEX_ENABLED: codexEnabled,
			CODEX_ACCESS_TOKEN:
				persisted.CODEX_ACCESS_TOKEN ?? process.env.CODEX_ACCESS_TOKEN ?? "",
			CODEX_MODEL: persisted.CODEX_MODEL ?? process.env.CODEX_MODEL ?? "",
			IMPLEMENTATION_RUNTIME_LANE:
				explicitRuntimeLane || legacyCodexRuntimeLane,
			SESSION_QUEUE_MAX_CONCURRENCY:
				typeof persisted.SESSION_QUEUE_MAX_CONCURRENCY === "number"
					? persisted.SESSION_QUEUE_MAX_CONCURRENCY
					: Number(process.env.SESSION_QUEUE_MAX_CONCURRENCY || 2),
		};
	const providerEndpoints = normalizeProviderEndpoints(
		persisted.providerEndpoints,
		legacySettings,
	);
	const roleRoutes = normalizeRoleRoutes(
		persisted.roleRoutes,
		providerEndpoints,
		legacySettings.ACTIVE_LLM_PROVIDER,
	);
	const providerEndpointsChanged =
		Array.isArray(persisted.providerEndpoints) &&
		JSON.stringify(persisted.providerEndpoints) !==
			JSON.stringify(providerEndpoints);
	const roleRoutesChanged =
		Array.isArray(persisted.roleRoutes) &&
		JSON.stringify(persisted.roleRoutes) !== JSON.stringify(roleRoutes);
	const normalized = {
		...legacySettings,
		providerEndpoints,
		roleRoutes,
	};
	const migration = migrateStructuredLlmEndpointIds(normalized);
	if (
		(migration.changed || providerEndpointsChanged || roleRoutesChanged) &&
		persistedRead.exists &&
		persistedRead.loaded
	) {
		writeRuntimeSettings(migration.settings);
	}
	return migration.settings;
};

const applySettingsToProcessEnv = (settings: LlmSettings) => {
	for (const [key, val] of Object.entries(settings)) {
		if (Array.isArray(val)) continue;
		process.env[key] = String(val);
	}
};

export function maskLlmSettings(settings: LlmSettings) {
	const masked = { ...settings };
	for (const key of SECRET_SETTING_KEYS) {
		masked[key] = settings[key] ? MASKED_SECRET : "";
	}
	masked.providerEndpoints = (settings.providerEndpoints || []).map(
		(endpoint) => ({
			...endpoint,
			apiKey: endpoint.apiKey ? MASKED_SECRET : "",
		}),
	);
	return masked;
}

export function mergeMaskedSecrets(
	incoming: RawLlmSettings,
	current: LlmSettings,
) {
	const merged = { ...incoming };
	for (const key of SECRET_SETTING_KEYS) {
		if (incoming[key] === MASKED_SECRET) {
			merged[key] = current[key] || "";
		}
	}
	const currentEndpoints = new Map(
		(current.providerEndpoints || []).map((endpoint) => [
			endpoint.id,
			endpoint,
		]),
	);
	merged.providerEndpoints = (incoming.providerEndpoints || []).map(
		(endpoint) => {
			if (endpoint.apiKey !== MASKED_SECRET) return endpoint;
			return {
				...endpoint,
				apiKey: currentEndpoints.get(endpoint.id)?.apiKey || "",
			};
		},
	);
	return normalizeRawLlmSettings(merged);
}

applySettingsToProcessEnv(getCurrentSettings());

export {
	applySettingsToProcessEnv,
	providerModelOptions,
	writeRuntimeSettings,
};
