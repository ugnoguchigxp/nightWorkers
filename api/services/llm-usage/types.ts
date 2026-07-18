export type LlmUsageMode = "measured" | "estimated" | "mixed" | "unavailable";

export type UsageCounterScope = "per_turn" | "provider_session_cumulative";
export type UsageNormalizationStatus =
	| "first_snapshot"
	| "delta"
	| "counter_reset"
	| "invalid_cached_delta"
	| "unavailable";

export type NormalizedLlmUsage = {
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
	reasoningOutputTokens: number | null;
	totalTokens: number | null;
	mode: LlmUsageMode;
	rawUsage?: unknown;
};

export type LlmPromptPartTokenEstimates = {
	systemPromptTokens?: number | null;
	userPromptTokens?: number | null;
	latestUserMessageTokens?: number | null;
	stateCardTokens?: number | null;
};

export type TaskLlmUsageBreakdown = {
	promptInputTokens: number;
	inputTokens: number;
	outputTokens: number;
	stateCardTokens: number;
	cachedInputTokens: number;
	nonCachedInputTokens: number;
	reasoningOutputTokens: number;
	totalTokens: number;
	totalDurationMs: number;
	averageDurationMs: number | null;
	usageMode: LlmUsageMode;
	callCount: number;
	measuredCallCount: number;
	estimatedCallCount: number;
	lastUpdatedAt: string | null;
};

export type TaskLlmUsageSummary = TaskLlmUsageBreakdown & {
	taskId: string;
	byOwner: {
		codingAgent: TaskLlmUsageBreakdown;
		missionPilot: TaskLlmUsageBreakdown;
	};
};
