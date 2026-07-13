export type NightWorkersLanguage = "ja" | "en";
export type NightWorkersCurrency = "JPY" | "USD" | "EUR";

export type FxRateCache = {
	source: "ecb" | "manual";
	baseCurrency: "EUR";
	validOn: string;
	fetchedAt: string;
	rates: Record<string, number>;
};

export type PlanModeCapability =
	| "feature_plan"
	| "questionnaire"
	| "user_flow"
	| "blueprint"
	| "data_model"
	| "api_io_contract"
	| "activity_flow"
	| "sequence_flow"
	| "zod_schema_design";

export type PlanModeSettings = {
	capabilities: Record<PlanModeCapability, boolean>;
};

export type LlmUsageSettings = {
	promptPartObservabilityEnabled: boolean;
};

export type DataRetentionSettings = {
	apiLogDays: number;
	llmRawLogDays: number;
	usageDataDays: number;
	auditEventDays: number;
	apiLogMaxBytes: number;
	llmRawLogsMaxBytes: number;
	runtimeLogsMaxBytes: number;
	apiSegmentMaxBytes: number;
	llmSegmentMaxBytes: number;
	sweepIntervalMinutes: number;
};

export type GeneralSettings = {
	timezone: string;
	language: NightWorkersLanguage;
	currency: NightWorkersCurrency;
	fx: {
		source: "ecb" | "manual";
		autoRefresh: boolean;
		lastRefreshedAt: string | null;
	};
	planMode: PlanModeSettings;
	llmUsage: LlmUsageSettings;
	dataRetention: DataRetentionSettings;
};
