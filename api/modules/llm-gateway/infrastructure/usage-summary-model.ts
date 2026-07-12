import { eq, gte } from "drizzle-orm";
import {
	llmUsageSummaryBuckets,
	llmUsageSummaryTaskBuckets,
	llmUsageSummaryWarnings,
} from "../../../db/schema";

export type SummaryWarningDelta = {
	code: string;
	detailKey: string;
	detailJson: Record<string, unknown>;
	callCount: number;
};

export type SummaryDelta = {
	bucketHourUtc: Date;
	repositoryId: string | null;
	repositoryKey: string;
	taskId: string;
	provider: string;
	model: string | null;
	modelKey: string;
	pricingCurrencyCode: string | null;
	pricingCurrencyKey: string;
	pricingStatus: "priced" | "manual" | "missing";
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	reasoningOutputTokens: number;
	systemPromptTokens: number;
	userPromptTokens: number;
	stateCardTokens: number;
	totalTokens: number;
	totalDurationMs: number;
	outputDurationMs: number;
	measuredDurationCallCount: number;
	callCount: number;
	measuredCallCount: number;
	estimatedCallCount: number;
	mixedCallCount: number;
	unavailableCallCount: number;
	pricedCallCount: number;
	unpricedCallCount: number;
	manualPricedCallCount: number;
	estimatedCost: number;
	inputCost: number;
	cachedInputCost: number;
	outputCost: number;
	reasoningOutputCost: number;
	pricingUpdatedAt: Date | null;
	warnings: SummaryWarningDelta[];
};

export type LlmUsageSummaryBackfillResult = {
	dryRun: boolean;
	reset: boolean;
	selectedRecords: number;
	existingSummaryBuckets: number;
	updatedSummaryBuckets: number;
	updatedWarnings: number;
};

export type LlmUsageSummaryIntegrityResult = {
	ok: boolean;
	checkedRecords: number;
	expectedBuckets: number;
	actualBuckets: number;
	expectedTaskBuckets: number;
	actualTaskBuckets: number;
	mismatches: Array<{
		key: string;
		field: string;
		expected: number | string | null;
		actual: number | string | null;
	}>;
};

export function taskBucketScopeConditions(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.since)
		conditions.push(
			gte(llmUsageSummaryTaskBuckets.bucketHourUtc, toUtcHour(input.since)),
		);
	if (input.repositoryId)
		conditions.push(
			eq(
				llmUsageSummaryTaskBuckets.repositoryKey,
				normalizeKey(input.repositoryId),
			),
		);
	return conditions;
}

export function bucketScopeConditions(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.since)
		conditions.push(
			gte(llmUsageSummaryBuckets.bucketHourUtc, toUtcHour(input.since)),
		);
	if (input.repositoryId)
		conditions.push(
			eq(
				llmUsageSummaryBuckets.repositoryKey,
				normalizeKey(input.repositoryId),
			),
		);
	return conditions;
}

export function warningScopeConditions(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.since)
		conditions.push(
			gte(llmUsageSummaryWarnings.bucketHourUtc, toUtcHour(input.since)),
		);
	if (input.repositoryId)
		conditions.push(
			eq(
				llmUsageSummaryWarnings.repositoryKey,
				normalizeKey(input.repositoryId),
			),
		);
	return conditions;
}

export function mergeSummaryDelta(
	target: Map<string, SummaryDelta>,
	delta: SummaryDelta,
	key = summaryDeltaKey(delta),
) {
	const current = target.get(key);
	if (!current) {
		target.set(key, { ...delta, warnings: [] });
		return;
	}
	for (const field of SUMMARY_COMPARE_FIELDS) {
		current[field] += delta[field];
	}
}

export const SUMMARY_COMPARE_FIELDS = [
	"inputTokens",
	"outputTokens",
	"cachedInputTokens",
	"reasoningOutputTokens",
	"systemPromptTokens",
	"userPromptTokens",
	"stateCardTokens",
	"totalTokens",
	"totalDurationMs",
	"outputDurationMs",
	"measuredDurationCallCount",
	"callCount",
	"measuredCallCount",
	"estimatedCallCount",
	"mixedCallCount",
	"unavailableCallCount",
	"pricedCallCount",
	"unpricedCallCount",
	"manualPricedCallCount",
	"estimatedCost",
	"inputCost",
	"cachedInputCost",
	"outputCost",
	"reasoningOutputCost",
] as const;

export const TASK_SUMMARY_COMPARE_FIELDS = [
	"inputTokens",
	"outputTokens",
	"cachedInputTokens",
	"reasoningOutputTokens",
	"systemPromptTokens",
	"userPromptTokens",
	"stateCardTokens",
	"totalTokens",
	"totalDurationMs",
	"outputDurationMs",
	"measuredDurationCallCount",
	"callCount",
	"pricedCallCount",
	"estimatedCost",
] as const satisfies readonly (typeof SUMMARY_COMPARE_FIELDS)[number][];

export function summaryDeltaKey(delta: SummaryDelta) {
	return [
		delta.bucketHourUtc.getTime(),
		delta.repositoryKey,
		delta.provider,
		delta.modelKey,
		delta.pricingCurrencyKey,
		delta.pricingStatus,
	].join("\u0000");
}

export function summaryTaskDeltaKey(delta: SummaryDelta) {
	return [
		delta.bucketHourUtc.getTime(),
		delta.repositoryKey,
		delta.taskId,
		delta.pricingCurrencyKey,
		delta.pricingStatus,
	].join("\u0000");
}

export function summaryRowKey(row: typeof llmUsageSummaryBuckets.$inferSelect) {
	return [
		row.bucketHourUtc.getTime(),
		row.repositoryKey,
		row.provider,
		row.modelKey,
		row.pricingCurrencyKey,
		row.pricingStatus,
	].join("\u0000");
}

export function summaryTaskRowKey(
	row: typeof llmUsageSummaryTaskBuckets.$inferSelect,
) {
	return [
		row.bucketHourUtc.getTime(),
		row.repositoryKey,
		row.taskId,
		row.pricingCurrencyKey,
		row.pricingStatus,
	].join("\u0000");
}

export function normalizeInt(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: 0;
}

export function normalizeKey(value: string | null | undefined) {
	return value?.trim() || "";
}

export function toUtcHour(date: Date) {
	return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000);
}

export function toDate(value: Date | number) {
	return value instanceof Date ? value : new Date(value);
}
