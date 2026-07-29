import fs from "node:fs";
import path from "node:path";
import type { PlanModeCapability } from "../../../shared/schemas/plan-mode-artifact.schema";
import { getRuntimePaths } from "../../runtime/paths";
import {
	DEFAULT_RUNTIME_LOG_RETENTION,
	type RuntimeLogRetentionConfig,
} from "../../runtime/runtime-log-writer";
import {
	archiveLegacySettingsFile,
	readApplicationSetting,
	writeApplicationSetting,
} from "./application-settings-store";

export type { PlanModeCapability } from "../../../shared/schemas/plan-mode-artifact.schema";

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const GENERAL_SETTINGS_PATH = path.join(
	RUNTIME_SETTINGS_DIR,
	"general-settings.json",
);
const FX_CACHE_PATH = path.join(RUNTIME_SETTINGS_DIR, "fx-rates.json");

export type NightWorkersLanguage = "ja" | "en";
export type NightWorkersCurrency = "JPY" | "USD" | "EUR";
export type FxSource = "ecb" | "manual";

export type PlanModeSettings = {
	capabilities: Record<PlanModeCapability, boolean>;
};

export type LlmUsageSettings = {
	promptPartObservabilityEnabled: boolean;
};

export type DataRetentionSettings = RuntimeLogRetentionConfig & {
	codingAgentFullRecordDays: number;
	usageDataDays: number;
	auditEventDays: number;
	sweepIntervalMinutes: number;
};

export type GeneralSettings = {
	timezone: string;
	language: NightWorkersLanguage;
	currency: NightWorkersCurrency;
	fx: {
		source: FxSource;
		autoRefresh: boolean;
		lastRefreshedAt: string | null;
	};
	planMode: PlanModeSettings;
	llmUsage: LlmUsageSettings;
	dataRetention: DataRetentionSettings;
};

export type FxRateCache = {
	source: FxSource;
	baseCurrency: "EUR";
	validOn: string;
	fetchedAt: string;
	rates: Record<string, number>;
};

export const FX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FX_REFRESH_TIMEOUT_MS = 15_000;

export const SUPPORTED_LANGUAGES: NightWorkersLanguage[] = ["ja", "en"];
export const SUPPORTED_CURRENCIES: NightWorkersCurrency[] = [
	"JPY",
	"USD",
	"EUR",
];
export const PLAN_MODE_CAPABILITIES: PlanModeCapability[] = [
	"feature_plan",
	"questionnaire",
	"user_flow",
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
];

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
	timezone: "Asia/Tokyo",
	language: "ja",
	currency: "JPY",
	fx: {
		source: "ecb",
		autoRefresh: true,
		lastRefreshedAt: null,
	},
	planMode: {
		capabilities: {
			feature_plan: true,
			questionnaire: true,
			user_flow: true,
			blueprint: true,
			data_model: true,
			api_io_contract: true,
			activity_flow: true,
			sequence_flow: true,
			zod_schema_design: true,
		},
	},
	llmUsage: {
		promptPartObservabilityEnabled: true,
	},
	dataRetention: {
		...DEFAULT_RUNTIME_LOG_RETENTION,
		codingAgentFullRecordDays: 7,
		usageDataDays: 30,
		auditEventDays: 90,
		sweepIntervalMinutes: 60,
	},
};

export function readGeneralSettings(): GeneralSettings {
	const persisted = readApplicationSetting<Partial<GeneralSettings>>("general");
	if (persisted) return normalizeGeneralSettings(persisted);
	const migrated = normalizeGeneralSettings(
		readJsonFile<Partial<GeneralSettings>>(GENERAL_SETTINGS_PATH) ?? {},
	);
	try {
		void writeApplicationSetting("general", migrated)
			.then(() => archiveLegacySettingsFile(GENERAL_SETTINGS_PATH))
			.catch(() => undefined);
	} catch {
		// Schema bootstrap can precede the first settings read in lightweight tools.
	}
	return migrated;
}

export async function writeGeneralSettings(
	input: Partial<GeneralSettings>,
): Promise<GeneralSettings> {
	const settings = normalizeGeneralSettings(input);
	await writeApplicationSetting("general", settings);
	return settings;
}

export function readFxRateCache(): FxRateCache | null {
	const persisted = readApplicationSetting<FxRateCache>("fx-cache");
	if (persisted) return persisted;
	const migrated = readJsonFile<FxRateCache>(FX_CACHE_PATH);
	if (!migrated) return null;
	try {
		void writeApplicationSetting("fx-cache", migrated)
			.then(() => archiveLegacySettingsFile(FX_CACHE_PATH))
			.catch(() => undefined);
	} catch {
		// Schema bootstrap can precede the first settings read in lightweight tools.
	}
	return migrated;
}

export async function writeFxRateCache(cache: FxRateCache) {
	await writeApplicationSetting("fx-cache", cache);
	const current = readGeneralSettings();
	await writeGeneralSettings({
		...current,
		fx: {
			...current.fx,
			source: cache.source,
			lastRefreshedAt: cache.fetchedAt,
		},
	});
	return cache;
}

export async function refreshEcbFxRates(): Promise<FxRateCache> {
	const res = await fetch(
		"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
		{ signal: AbortSignal.timeout(FX_REFRESH_TIMEOUT_MS) },
	);
	if (!res.ok) {
		throw new Error(`ECB FX refresh failed: ${res.status}`);
	}
	const xml = await res.text();
	const validOn =
		xml.match(/<Cube time=['"]([^'"]+)['"]>/)?.[1] || new Date().toISOString();
	const rates: Record<string, number> = { EUR: 1 };
	for (const match of xml.matchAll(
		/<Cube currency=['"]([^'"]+)['"] rate=['"]([^'"]+)['"]\/>/g,
	)) {
		const rate = Number(match[2]);
		if (match[1] && Number.isFinite(rate) && rate > 0) rates[match[1]] = rate;
	}
	const cache: FxRateCache = {
		source: "ecb",
		baseCurrency: "EUR",
		validOn,
		fetchedAt: new Date().toISOString(),
		rates,
	};
	return writeFxRateCache(cache);
}

export function shouldRefreshFxRateCache(
	cache: FxRateCache | null,
	now = new Date(),
) {
	if (!cache) return true;
	if (
		SUPPORTED_CURRENCIES.some((currency) => {
			const rate = cache.rates[currency];
			return !Number.isFinite(rate) || (rate ?? 0) <= 0;
		})
	) {
		return true;
	}
	const fetchedAt = Date.parse(cache.fetchedAt);
	if (!Number.isFinite(fetchedAt)) return true;
	return now.getTime() - fetchedAt >= FX_CACHE_MAX_AGE_MS;
}

export async function refreshFxRatesIfNeeded(
	input: {
		settings?: GeneralSettings;
		cache?: FxRateCache | null;
		now?: Date;
	} = {},
) {
	const settings = input.settings ?? readGeneralSettings();
	const cache = input.cache === undefined ? readFxRateCache() : input.cache;
	if (!settings.fx.autoRefresh || settings.fx.source !== "ecb") {
		return { status: "disabled" as const, cache };
	}
	if (!shouldRefreshFxRateCache(cache, input.now)) {
		return { status: "current" as const, cache };
	}
	return {
		status: "refreshed" as const,
		cache: await refreshEcbFxRates(),
	};
}

export function convertCurrency(input: {
	amount: number;
	from: NightWorkersCurrency;
	to: NightWorkersCurrency;
	cache: FxRateCache | null;
}) {
	if (input.from === input.to) return { amount: input.amount, rate: 1 };
	if (!input.cache) return { amount: null, rate: null };
	const fromRate = input.cache.rates[input.from];
	const toRate = input.cache.rates[input.to];
	if (!fromRate || !toRate) return { amount: null, rate: null };
	const rate = toRate / fromRate;
	return { amount: input.amount * rate, rate };
}

export function validateTimezone(timezone: string) {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
		return true;
	} catch {
		return false;
	}
}

export function normalizeGeneralSettings(
	input: Partial<GeneralSettings>,
): GeneralSettings {
	const timezone =
		typeof input.timezone === "string" && validateTimezone(input.timezone)
			? input.timezone
			: DEFAULT_GENERAL_SETTINGS.timezone;
	const language = SUPPORTED_LANGUAGES.includes(
		input.language as NightWorkersLanguage,
	)
		? (input.language as NightWorkersLanguage)
		: DEFAULT_GENERAL_SETTINGS.language;
	const currency = SUPPORTED_CURRENCIES.includes(
		input.currency as NightWorkersCurrency,
	)
		? (input.currency as NightWorkersCurrency)
		: DEFAULT_GENERAL_SETTINGS.currency;
	const source: FxSource = input.fx?.source === "manual" ? "manual" : "ecb";
	return {
		timezone,
		language,
		currency,
		fx: {
			source,
			autoRefresh:
				typeof input.fx?.autoRefresh === "boolean"
					? input.fx.autoRefresh
					: DEFAULT_GENERAL_SETTINGS.fx.autoRefresh,
			lastRefreshedAt:
				typeof input.fx?.lastRefreshedAt === "string"
					? input.fx.lastRefreshedAt
					: null,
		},
		planMode: normalizePlanModeSettings(input.planMode),
		llmUsage: normalizeLlmUsageSettings(input.llmUsage),
		dataRetention: normalizeDataRetentionSettings(input.dataRetention),
	};
}

export function normalizeDataRetentionSettings(
	input: unknown,
): DataRetentionSettings {
	const record = isRecord(input) ? input : {};
	const defaults = DEFAULT_GENERAL_SETTINGS.dataRetention;
	const positiveInt = (key: keyof DataRetentionSettings, max: number) => {
		const value = record[key];
		return typeof value === "number" &&
			Number.isSafeInteger(value) &&
			value > 0 &&
			value <= max
			? value
			: defaults[key];
	};
	const result: DataRetentionSettings = {
		apiLogDays: positiveInt("apiLogDays", 7),
		llmRawLogDays: positiveInt("llmRawLogDays", 3),
		codingAgentFullRecordDays: positiveInt("codingAgentFullRecordDays", 365),
		usageDataDays: positiveInt("usageDataDays", 30),
		auditEventDays: positiveInt("auditEventDays", 90),
		apiLogMaxBytes: positiveInt("apiLogMaxBytes", 128 * 1024 * 1024),
		llmRawLogsMaxBytes: positiveInt("llmRawLogsMaxBytes", 256 * 1024 * 1024),
		runtimeLogsMaxBytes: positiveInt("runtimeLogsMaxBytes", 512 * 1024 * 1024),
		apiSegmentMaxBytes: positiveInt("apiSegmentMaxBytes", 32 * 1024 * 1024),
		llmSegmentMaxBytes: positiveInt("llmSegmentMaxBytes", 64 * 1024 * 1024),
		sweepIntervalMinutes: positiveInt("sweepIntervalMinutes", 24 * 60),
	};
	if (result.apiLogMaxBytes > result.runtimeLogsMaxBytes)
		result.apiLogMaxBytes = defaults.apiLogMaxBytes;
	if (result.llmRawLogsMaxBytes > result.runtimeLogsMaxBytes)
		result.llmRawLogsMaxBytes = defaults.llmRawLogsMaxBytes;
	if (result.apiSegmentMaxBytes > result.apiLogMaxBytes)
		result.apiSegmentMaxBytes = defaults.apiSegmentMaxBytes;
	if (result.llmSegmentMaxBytes > result.llmRawLogsMaxBytes)
		result.llmSegmentMaxBytes = defaults.llmSegmentMaxBytes;
	return result;
}

export function normalizeLlmUsageSettings(input: unknown): LlmUsageSettings {
	const record = isRecord(input) ? input : {};
	return {
		promptPartObservabilityEnabled:
			typeof record.promptPartObservabilityEnabled === "boolean"
				? record.promptPartObservabilityEnabled
				: DEFAULT_GENERAL_SETTINGS.llmUsage.promptPartObservabilityEnabled,
	};
}

export function normalizePlanModeSettings(input: unknown): PlanModeSettings {
	const record = isRecord(input) ? input : {};
	const capabilities = isRecord(record.capabilities) ? record.capabilities : {};
	return {
		capabilities: Object.fromEntries(
			PLAN_MODE_CAPABILITIES.map((capability) => [
				capability,
				resolveCapabilityValue(capability, capabilities),
			]),
		) as Record<PlanModeCapability, boolean>,
	};
}

function resolveCapabilityValue(
	capability: PlanModeCapability,
	capabilities: Record<string, unknown>,
) {
	if (capability === "questionnaire" || capability === "feature_plan") {
		return true;
	}
	if (typeof capabilities[capability] === "boolean")
		return capabilities[capability];
	return (
		legacyCapabilityValue(capability, capabilities) ??
		DEFAULT_GENERAL_SETTINGS.planMode.capabilities[capability]
	);
}

function legacyCapabilityValue(
	capability: PlanModeCapability,
	capabilities: Record<string, unknown>,
): boolean | undefined {
	if (
		capability === "feature_plan" &&
		typeof capabilities.specification === "boolean"
	) {
		return capabilities.specification;
	}
	return undefined;
}

export function buildPlanModeSettingsSnapshot(
	settings = readGeneralSettings(),
) {
	const disabledCapabilities = PLAN_MODE_CAPABILITIES.filter(
		(capability) => !settings.planMode.capabilities[capability],
	);
	return {
		capabilities: settings.planMode.capabilities,
		disabledCapabilities,
		source: "general-settings" as const,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}
