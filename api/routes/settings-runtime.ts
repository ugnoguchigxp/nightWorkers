import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	getRuntimeLaneSetting,
	getStructuredProviderSetting,
	type LlmSettings,
	llmSettingsSchema,
	normalizeProviderEndpoints,
	normalizeRawLlmSettings,
	normalizeRoleRoutes,
	providerModelOptions,
	type RawLlmSettings,
	SECRET_SETTING_KEYS,
	synchronizeLegacyProviderEnablement,
} from "../modules/settings";
import { getRuntimePaths } from "../runtime/paths";
import {
	archiveLegacySettingsFile,
	readApplicationSetting,
	readApplicationSettingSecrets,
	writeApplicationSettingBundle,
} from "../services/settings/application-settings-store";
import { migrateStructuredLlmEndpointIds } from "../services/structured-llm/endpoint-id-migration";
import { migrateLegacyProviderEnablement } from "../services/structured-llm/provider-enablement-migration";

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
const TEST_RUNTIME_SETTINGS_PATH =
	process.env.NODE_ENV === "test"
		? process.env.NIGHTWORKERS_LLM_SETTINGS_PATH
		: undefined;
const RUNTIME_SETTINGS_PATH =
	TEST_RUNTIME_SETTINGS_PATH ||
	path.join(RUNTIME_SETTINGS_DIR, "llm-settings.json");
export const MASKED_SECRET = "********";

const readRuntimeSettings = (): {
	settings: Partial<RawLlmSettings>;
	exists: boolean;
	loaded: boolean;
} => {
	const sqliteSettings = TEST_RUNTIME_SETTINGS_PATH
		? null
		: readApplicationSetting<Partial<RawLlmSettings>>("llm");
	if (sqliteSettings) {
		const secrets =
			readApplicationSettingSecrets<
				Partial<RawLlmSettings> & {
					providerEndpointApiKeys?: Record<string, string>;
				}
			>("llm") ?? {};
		return {
			settings: {
				...sqliteSettings,
				...secrets,
				providerEndpoints: (sqliteSettings.providerEndpoints || []).map(
					(endpoint) => ({
						...endpoint,
						apiKey: secrets.providerEndpointApiKeys?.[endpoint.id] || "",
					}),
				),
			},
			exists: true,
			loaded: true,
		};
	}
	const exists = fs.existsSync(RUNTIME_SETTINGS_PATH);
	try {
		if (!exists) {
			const imported = Object.fromEntries(
				[
					"ACTIVE_LLM_PROVIDER",
					"OPENAI_ENABLED",
					"AZURE_OPENAI_ENABLED",
					"AWS_BEDROCK_ENABLED",
					"CODEX_ENABLED",
					"OPENAI_API_KEY",
					"OPENAI_BASE_URL",
					"OPENAI_MODEL",
					"AZURE_OPENAI_API_KEY",
					"AZURE_OPENAI_ENDPOINT",
					"AZURE_OPENAI_DEPLOYMENT_NAME",
					"AZURE_OPENAI_API_VERSION",
					"AWS_ACCESS_KEY_ID",
					"AWS_SECRET_ACCESS_KEY",
					"AWS_REGION",
					"AWS_BEDROCK_MODEL",
					"CODEX_ACCESS_TOKEN",
					"CODEX_MODEL",
					"IMPLEMENTATION_RUNTIME_LANE",
					"SESSION_QUEUE_MAX_CONCURRENCY",
				].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
			) as Partial<RawLlmSettings>;
			if (Object.keys(imported).length > 0) {
				void writeRuntimeSettings(
					normalizeRawLlmSettings(llmSettingsSchema.parse(imported)),
				).catch(() => undefined);
				return { settings: imported, exists: true, loaded: true };
			}
			return { settings: {}, exists: false, loaded: false };
		}
		const text = fs.readFileSync(RUNTIME_SETTINGS_PATH, "utf-8");
		const settings = JSON.parse(text) as Partial<RawLlmSettings>;
		void writeRuntimeSettings(
			normalizeRawLlmSettings(llmSettingsSchema.parse(settings), {
				validateExplicitRoleRoutes: false,
			}),
		)
			.then(() => archiveLegacySettingsFile(RUNTIME_SETTINGS_PATH))
			.catch(() => undefined);
		return {
			settings,
			exists: true,
			loaded: true,
		};
	} catch {
		return { settings: {}, exists, loaded: false };
	}
};

const writeRuntimeSettings = async (settings: LlmSettings) => {
	if (TEST_RUNTIME_SETTINGS_PATH) {
		fs.mkdirSync(path.dirname(TEST_RUNTIME_SETTINGS_PATH), { recursive: true });
		fs.writeFileSync(
			TEST_RUNTIME_SETTINGS_PATH,
			`${JSON.stringify(settings, null, 2)}\n`,
			"utf-8",
		);
		return;
	}
	const secretKeys = new Set<string>(SECRET_SETTING_KEYS);
	const secrets = Object.fromEntries(
		Object.entries(settings).filter(([key]) => secretKeys.has(key)),
	);
	const endpointApiKeys = Object.fromEntries(
		(settings.providerEndpoints || [])
			.filter((endpoint) => endpoint.apiKey)
			.map((endpoint) => [endpoint.id, endpoint.apiKey]),
	);
	const publicSettings = Object.fromEntries(
		Object.entries(settings).filter(([key]) => !secretKeys.has(key)),
	) as LlmSettings;
	publicSettings.providerEndpoints = (settings.providerEndpoints || []).map(
		({ apiKey: _apiKey, ...endpoint }) => ({ ...endpoint, apiKey: "" }),
	);
	await writeApplicationSettingBundle("llm", publicSettings, {
		...secrets,
		providerEndpointApiKeys: endpointApiKeys,
	});
};

export const getCurrentSettings = (): LlmSettings => {
	const persistedRead = readRuntimeSettings();
	const enablementMigration = migrateLegacyProviderEnablement(
		persistedRead.settings,
	);
	const persisted = enablementMigration.settings;
	const rawActiveProvider = persisted.ACTIVE_LLM_PROVIDER || "azure";
	const codexEnabled =
		typeof persisted.CODEX_ENABLED === "boolean"
			? persisted.CODEX_ENABLED
			: false;
	const explicitRuntimeLane = getRuntimeLaneSetting(
		persisted.IMPLEMENTATION_RUNTIME_LANE,
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
			providerEnablementMigrationVersion:
				typeof persisted.providerEnablementMigrationVersion === "number"
					? persisted.providerEnablementMigrationVersion
					: undefined,
			ACTIVE_LLM_PROVIDER: getStructuredProviderSetting(rawActiveProvider),
			OPENAI_ENABLED:
				typeof persisted.OPENAI_ENABLED === "boolean"
					? persisted.OPENAI_ENABLED
					: true,
			AZURE_OPENAI_ENABLED:
				typeof persisted.AZURE_OPENAI_ENABLED === "boolean"
					? persisted.AZURE_OPENAI_ENABLED
					: false,
			AZURE_OPENAI_API_KEY: persisted.AZURE_OPENAI_API_KEY ?? "",
			AZURE_OPENAI_ENDPOINT: persisted.AZURE_OPENAI_ENDPOINT ?? "",
			AZURE_OPENAI_DEPLOYMENT_NAME:
				persisted.AZURE_OPENAI_DEPLOYMENT_NAME ?? "",
			AZURE_OPENAI_API_VERSION: persisted.AZURE_OPENAI_API_VERSION ?? "",
			AWS_BEDROCK_ENABLED:
				typeof persisted.AWS_BEDROCK_ENABLED === "boolean"
					? persisted.AWS_BEDROCK_ENABLED
					: false,
			AWS_ACCESS_KEY_ID: persisted.AWS_ACCESS_KEY_ID ?? "",
			AWS_SECRET_ACCESS_KEY: persisted.AWS_SECRET_ACCESS_KEY ?? "",
			AWS_REGION: persisted.AWS_REGION ?? "",
			AWS_BEDROCK_MODEL: persisted.AWS_BEDROCK_MODEL ?? "",
			OPENAI_API_KEY: persisted.OPENAI_API_KEY ?? "",
			OPENAI_BASE_URL: persisted.OPENAI_BASE_URL ?? "",
			OPENAI_MODEL: persisted.OPENAI_MODEL ?? "",
			CODEX_ENABLED: codexEnabled,
			CODEX_ACCESS_TOKEN: persisted.CODEX_ACCESS_TOKEN ?? "",
			CODEX_MODEL: persisted.CODEX_MODEL ?? "",
			IMPLEMENTATION_RUNTIME_LANE:
				explicitRuntimeLane || legacyCodexRuntimeLane,
			SESSION_QUEUE_MAX_CONCURRENCY:
				typeof persisted.SESSION_QUEUE_MAX_CONCURRENCY === "number"
					? persisted.SESSION_QUEUE_MAX_CONCURRENCY
					: 2,
		};
	const providerEndpoints = normalizeProviderEndpoints(
		persisted.providerEndpoints,
		legacySettings,
	);
	const synchronizedLegacySettings = synchronizeLegacyProviderEnablement(
		legacySettings,
		providerEndpoints,
	);
	const roleRoutes = normalizeRoleRoutes(
		persisted.roleRoutes,
		providerEndpoints,
		synchronizedLegacySettings.ACTIVE_LLM_PROVIDER,
	);
	const legacyProviderEnablementChanged =
		legacySettings.AZURE_OPENAI_ENABLED !==
			synchronizedLegacySettings.AZURE_OPENAI_ENABLED ||
		legacySettings.OPENAI_ENABLED !==
			synchronizedLegacySettings.OPENAI_ENABLED ||
		legacySettings.AWS_BEDROCK_ENABLED !==
			synchronizedLegacySettings.AWS_BEDROCK_ENABLED ||
		legacySettings.CODEX_ENABLED !== synchronizedLegacySettings.CODEX_ENABLED;
	const providerEndpointsChanged =
		Array.isArray(persisted.providerEndpoints) &&
		!isDeepStrictEqual(persisted.providerEndpoints, providerEndpoints);
	const roleRoutesChanged =
		Array.isArray(persisted.roleRoutes) &&
		!isDeepStrictEqual(persisted.roleRoutes, roleRoutes);
	const normalized = {
		...synchronizedLegacySettings,
		providerEndpoints,
		roleRoutes,
	};
	const migration = migrateStructuredLlmEndpointIds(normalized);
	if (
		(enablementMigration.changed ||
			migration.changed ||
			providerEndpointsChanged ||
			roleRoutesChanged ||
			legacyProviderEnablementChanged) &&
		persistedRead.exists &&
		persistedRead.loaded &&
		process.env.NIGHTWORKERS_EXECUTION_ROLE !== "worker"
	) {
		void writeRuntimeSettings(migration.settings).catch(() => undefined);
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
