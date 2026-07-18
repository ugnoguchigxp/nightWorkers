import { and, eq, gte, sql } from "drizzle-orm";
import { normalizeInputTokenBreakdown } from "../../../shared/llm-usage-tokens";
import { db } from "../../db/client";
import {
	llmUsageRecords,
	llmUsageSummaryBuckets,
	llmUsageSummaryTaskBuckets,
	llmUsageSummaryWarnings,
	tasks,
} from "../../db/schema";
import {
	bucketScopeConditions,
	type LlmUsageSummaryBackfillResult,
	type LlmUsageSummaryIntegrityResult,
	mergeSummaryDelta,
	normalizeInt,
	normalizeKey,
	resolveUsageRepositoryId,
	SUMMARY_COMPARE_FIELDS,
	type SummaryDelta,
	type SummaryWarningDelta,
	summaryDeltaKey,
	summaryRowKey,
	summaryTaskDeltaKey,
	summaryTaskRowKey,
	TASK_SUMMARY_COMPARE_FIELDS,
	taskBucketScopeConditions,
	toDate,
	toUtcHour,
	type UsageRecord,
	type UsageSummaryDbExecutor,
	warningScopeConditions,
} from "../../modules/llm-gateway";
import { calculateUsageCost, findPricingForUsage } from "../pricing";

export type {
	LlmUsageSummaryBackfillResult,
	LlmUsageSummaryIntegrityResult,
} from "../../modules/llm-gateway";

export async function upsertLlmUsageSummaryForRecord(
	record: UsageRecord,
	executor: UsageSummaryDbExecutor = db,
) {
	const delta = await buildLlmUsageSummaryDelta(record, executor);
	await upsertSummaryDelta(delta, executor);
	return delta;
}

export async function rebuildLlmUsageSummary(input: {
	since?: Date | null;
	repositoryId?: string | null;
	dryRun?: boolean;
	reset?: boolean;
}): Promise<LlmUsageSummaryBackfillResult> {
	const records = await listUsageRecordsForSummary(input);
	const existingSummaryBuckets = await countSummaryBuckets(input);
	if (!input.dryRun && existingSummaryBuckets > 0 && !input.reset) {
		throw new Error(
			"LLM usage summary already has rows for this scope. Re-run with --reset to rebuild without double counting.",
		);
	}
	if (input.dryRun) {
		return {
			dryRun: true,
			reset: Boolean(input.reset),
			selectedRecords: records.length,
			existingSummaryBuckets,
			updatedSummaryBuckets: 0,
			updatedWarnings: 0,
		};
	}

	if (input.reset) await deleteSummaryScope(input);
	const touchedBuckets = new Set<string>();
	let updatedWarnings = 0;
	for (const record of records) {
		const delta = await upsertLlmUsageSummaryForRecord(record);
		touchedBuckets.add(summaryDeltaKey(delta));
		updatedWarnings += delta.warnings.length;
	}
	return {
		dryRun: false,
		reset: Boolean(input.reset),
		selectedRecords: records.length,
		existingSummaryBuckets,
		updatedSummaryBuckets: touchedBuckets.size,
		updatedWarnings,
	};
}

export async function checkLlmUsageSummaryIntegrity(
	input: {
		since?: Date | null;
		repositoryId?: string | null;
		tolerance?: number;
	} = {},
): Promise<LlmUsageSummaryIntegrityResult> {
	const tolerance = input.tolerance ?? 0.000001;
	const records = await listUsageRecordsForSummary(input);
	const expected = new Map<string, SummaryDelta>();
	const expectedTasks = new Map<string, SummaryDelta>();
	for (const record of records) {
		const delta = await buildLlmUsageSummaryDelta(record);
		mergeSummaryDelta(expected, delta);
		mergeSummaryDelta(expectedTasks, delta, summaryTaskDeltaKey(delta));
	}

	const actualRows = await listSummaryBuckets(input);
	const actual = new Map(
		actualRows.map((row) => [
			summaryRowKey(row),
			{
				inputTokens: row.inputTokens,
				outputTokens: row.outputTokens,
				cachedInputTokens: row.cachedInputTokens,
				reasoningOutputTokens: row.reasoningOutputTokens,
				systemPromptTokens: row.systemPromptTokens,
				userPromptTokens: row.userPromptTokens,
				stateCardTokens: row.stateCardTokens,
				totalTokens: row.totalTokens,
				totalDurationMs: row.totalDurationMs,
				outputDurationMs: row.outputDurationMs,
				measuredDurationCallCount: row.measuredDurationCallCount,
				callCount: row.callCount,
				measuredCallCount: row.measuredCallCount,
				estimatedCallCount: row.estimatedCallCount,
				mixedCallCount: row.mixedCallCount,
				unavailableCallCount: row.unavailableCallCount,
				pricedCallCount: row.pricedCallCount,
				unpricedCallCount: row.unpricedCallCount,
				manualPricedCallCount: row.manualPricedCallCount,
				estimatedCost: row.estimatedCost,
				inputCost: row.inputCost,
				cachedInputCost: row.cachedInputCost,
				outputCost: row.outputCost,
				reasoningOutputCost: row.reasoningOutputCost,
			},
		]),
	);

	const mismatches: LlmUsageSummaryIntegrityResult["mismatches"] = [];
	compareSummaryMaps({ expected, actual, mismatches, keyPrefix: "bucket" });

	const actualTaskRows = await listSummaryTaskBuckets(input);
	const actualTasks = new Map(
		actualTaskRows.map((row) => [
			summaryTaskRowKey(row),
			{
				inputTokens: row.inputTokens,
				outputTokens: row.outputTokens,
				cachedInputTokens: row.cachedInputTokens,
				reasoningOutputTokens: row.reasoningOutputTokens,
				systemPromptTokens: row.systemPromptTokens,
				userPromptTokens: row.userPromptTokens,
				stateCardTokens: row.stateCardTokens,
				totalTokens: row.totalTokens,
				totalDurationMs: row.totalDurationMs,
				outputDurationMs: row.outputDurationMs,
				measuredDurationCallCount: row.measuredDurationCallCount,
				callCount: row.callCount,
				pricedCallCount: row.pricedCallCount,
				estimatedCost: row.estimatedCost,
			},
		]),
	);
	compareSummaryMaps({
		expected: expectedTasks,
		actual: actualTasks,
		mismatches,
		keyPrefix: "task_bucket",
		fields: TASK_SUMMARY_COMPARE_FIELDS,
		tolerance,
	});

	return {
		ok: mismatches.length === 0,
		checkedRecords: records.length,
		expectedBuckets: expected.size,
		actualBuckets: actual.size,
		expectedTaskBuckets: expectedTasks.size,
		actualTaskBuckets: actualTasks.size,
		mismatches,
	};
}

function compareSummaryMaps(input: {
	expected: Map<
		string,
		Partial<Record<(typeof SUMMARY_COMPARE_FIELDS)[number], number>>
	>;
	actual: Map<
		string,
		Partial<Record<(typeof SUMMARY_COMPARE_FIELDS)[number], number>>
	>;
	mismatches: LlmUsageSummaryIntegrityResult["mismatches"];
	keyPrefix: string;
	fields?: readonly (typeof SUMMARY_COMPARE_FIELDS)[number][];
	tolerance?: number;
}) {
	const fields = input.fields ?? SUMMARY_COMPARE_FIELDS;
	const tolerance = input.tolerance ?? 0.000001;
	const allKeys = new Set([...input.expected.keys(), ...input.actual.keys()]);
	for (const key of allKeys) {
		const expectedRow = input.expected.get(key);
		const actualRow = input.actual.get(key);
		if (!expectedRow || !actualRow) {
			input.mismatches.push({
				key: `${input.keyPrefix}:${key}`,
				field: input.keyPrefix,
				expected: expectedRow ? "present" : null,
				actual: actualRow ? "present" : null,
			});
			continue;
		}
		for (const field of fields) {
			const expectedValue = expectedRow[field] ?? 0;
			const actualValue = actualRow[field] ?? 0;
			if (Math.abs(expectedValue - actualValue) > tolerance) {
				input.mismatches.push({
					key: `${input.keyPrefix}:${key}`,
					field,
					expected: expectedValue,
					actual: actualValue,
				});
			}
		}
	}
}

async function buildLlmUsageSummaryDelta(
	record: UsageRecord,
	executor: UsageSummaryDbExecutor = db,
): Promise<SummaryDelta> {
	const repositoryId = await resolveUsageRepositoryId(record.taskId, executor);
	const createdAt = toDate(record.createdAt);
	const pricing = await findPricingForUsage({
		provider: record.provider,
		model: record.model,
		createdAt,
	});
	const warnings: SummaryWarningDelta[] = [];
	const pricingStatus = pricing
		? pricing.manualOverride
			? "manual"
			: "priced"
		: "missing";
	const pricingCurrencyCode = pricing?.currencyCode ?? null;
	let estimatedCost = 0;
	let inputCost = 0;
	let cachedInputCost = 0;
	let outputCost = 0;
	let reasoningOutputCost = 0;

	if (!pricing) {
		warnings.push({
			code: "pricing_missing",
			detailKey: `${record.provider}:${record.model ?? "unknown"}`,
			detailJson: {
				provider: record.provider,
				model: record.model,
			},
			callCount: 1,
		});
	} else {
		const cost = calculateUsageCost({
			inputTokens: record.inputTokens,
			outputTokens: record.outputTokens,
			cachedInputTokens: record.cachedInputTokens,
			reasoningOutputTokens: record.reasoningOutputTokens,
			pricing,
		});
		estimatedCost = cost.totalCost;
		inputCost = cost.inputCost ?? 0;
		cachedInputCost = cost.cachedInputCost ?? 0;
		outputCost = cost.outputCost ?? 0;
		reasoningOutputCost = cost.reasoningCost ?? 0;
		for (const reason of cost.incompleteReasons) {
			warnings.push({
				code: "usage_token_anomaly",
				detailKey: reason,
				detailJson: { field: reason },
				callCount: 1,
			});
		}
	}

	if (record.usageMode === "estimated") {
		warnings.push({
			code: "usage_estimated",
			detailKey: "estimated",
			detailJson: {},
			callCount: 1,
		});
	}

	const outputTokens = normalizeInt(record.outputTokens);
	const inputTokenBreakdown = normalizeInputTokenBreakdown(record);
	const durationMs = normalizeInt(record.durationMs);
	const modelKey = normalizeKey(record.model);
	const pricingCurrencyKey = normalizeKey(pricingCurrencyCode);
	return {
		bucketHourUtc: toUtcHour(createdAt),
		repositoryId,
		repositoryKey: normalizeKey(repositoryId),
		taskId: record.taskId,
		provider: record.provider,
		model: record.model,
		modelKey,
		pricingCurrencyCode,
		pricingCurrencyKey,
		pricingStatus,
		inputTokens: normalizeInt(record.inputTokens),
		outputTokens,
		cachedInputTokens: inputTokenBreakdown.cachedInputTokens,
		reasoningOutputTokens: normalizeInt(record.reasoningOutputTokens),
		systemPromptTokens: normalizeInt(record.systemPromptTokens),
		userPromptTokens: normalizeInt(record.userPromptTokens),
		stateCardTokens: normalizeInt(record.stateCardTokens),
		totalTokens:
			record.totalTokens ?? normalizeInt(record.inputTokens) + outputTokens,
		totalDurationMs: durationMs,
		outputDurationMs: outputTokens > 0 ? durationMs : 0,
		measuredDurationCallCount: durationMs > 0 ? 1 : 0,
		callCount: 1,
		measuredCallCount: record.usageMode === "measured" ? 1 : 0,
		estimatedCallCount: record.usageMode === "estimated" ? 1 : 0,
		mixedCallCount: record.usageMode === "mixed" ? 1 : 0,
		unavailableCallCount:
			record.usageMode !== "measured" &&
			record.usageMode !== "estimated" &&
			record.usageMode !== "mixed"
				? 1
				: 0,
		pricedCallCount: pricing ? 1 : 0,
		unpricedCallCount: pricing ? 0 : 1,
		manualPricedCallCount: pricing?.manualOverride ? 1 : 0,
		estimatedCost,
		inputCost,
		cachedInputCost,
		outputCost,
		reasoningOutputCost,
		pricingUpdatedAt: pricing?.fetchedAt ?? null,
		warnings,
	};
}

async function upsertSummaryDelta(
	delta: SummaryDelta,
	executor: UsageSummaryDbExecutor,
) {
	const now = new Date();
	await executor
		.insert(llmUsageSummaryBuckets)
		.values({
			...summaryDeltaValues(delta),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				llmUsageSummaryBuckets.bucketHourUtc,
				llmUsageSummaryBuckets.repositoryKey,
				llmUsageSummaryBuckets.provider,
				llmUsageSummaryBuckets.modelKey,
				llmUsageSummaryBuckets.pricingCurrencyKey,
				llmUsageSummaryBuckets.pricingStatus,
			],
			set: summaryIncrementSet(delta, now),
		});

	await executor
		.insert(llmUsageSummaryTaskBuckets)
		.values({
			...summaryTaskDeltaValues(delta),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				llmUsageSummaryTaskBuckets.bucketHourUtc,
				llmUsageSummaryTaskBuckets.repositoryKey,
				llmUsageSummaryTaskBuckets.taskId,
				llmUsageSummaryTaskBuckets.pricingCurrencyKey,
				llmUsageSummaryTaskBuckets.pricingStatus,
			],
			set: summaryTaskIncrementSet(delta, now),
		});

	for (const warning of delta.warnings) {
		await executor
			.insert(llmUsageSummaryWarnings)
			.values({
				bucketHourUtc: delta.bucketHourUtc,
				repositoryId: delta.repositoryId,
				repositoryKey: delta.repositoryKey,
				provider: delta.provider,
				model: delta.model,
				modelKey: delta.modelKey,
				code: warning.code,
				detailKey: warning.detailKey,
				detailJson: warning.detailJson,
				callCount: warning.callCount,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					llmUsageSummaryWarnings.bucketHourUtc,
					llmUsageSummaryWarnings.repositoryKey,
					llmUsageSummaryWarnings.provider,
					llmUsageSummaryWarnings.modelKey,
					llmUsageSummaryWarnings.code,
					llmUsageSummaryWarnings.detailKey,
				],
				set: {
					callCount: sql`${llmUsageSummaryWarnings.callCount} + ${warning.callCount}`,
					detailJson: warning.detailJson,
					updatedAt: now,
				},
			});
	}
}

function summaryDeltaValues(delta: SummaryDelta) {
	const { taskId: _taskId, warnings: _warnings, ...values } = delta;
	return values;
}

function summaryTaskDeltaValues(delta: SummaryDelta) {
	return {
		bucketHourUtc: delta.bucketHourUtc,
		repositoryId: delta.repositoryId,
		repositoryKey: delta.repositoryKey,
		taskId: delta.taskId,
		pricingCurrencyCode: delta.pricingCurrencyCode,
		pricingCurrencyKey: delta.pricingCurrencyKey,
		pricingStatus: delta.pricingStatus,
		inputTokens: delta.inputTokens,
		outputTokens: delta.outputTokens,
		cachedInputTokens: delta.cachedInputTokens,
		reasoningOutputTokens: delta.reasoningOutputTokens,
		systemPromptTokens: delta.systemPromptTokens,
		userPromptTokens: delta.userPromptTokens,
		stateCardTokens: delta.stateCardTokens,
		totalTokens: delta.totalTokens,
		totalDurationMs: delta.totalDurationMs,
		outputDurationMs: delta.outputDurationMs,
		measuredDurationCallCount: delta.measuredDurationCallCount,
		callCount: delta.callCount,
		pricedCallCount: delta.pricedCallCount,
		estimatedCost: delta.estimatedCost,
	};
}

function summaryIncrementSet(delta: SummaryDelta, now: Date) {
	return {
		inputTokens: sql`${llmUsageSummaryBuckets.inputTokens} + ${delta.inputTokens}`,
		outputTokens: sql`${llmUsageSummaryBuckets.outputTokens} + ${delta.outputTokens}`,
		cachedInputTokens: sql`${llmUsageSummaryBuckets.cachedInputTokens} + ${delta.cachedInputTokens}`,
		reasoningOutputTokens: sql`${llmUsageSummaryBuckets.reasoningOutputTokens} + ${delta.reasoningOutputTokens}`,
		systemPromptTokens: sql`${llmUsageSummaryBuckets.systemPromptTokens} + ${delta.systemPromptTokens}`,
		userPromptTokens: sql`${llmUsageSummaryBuckets.userPromptTokens} + ${delta.userPromptTokens}`,
		stateCardTokens: sql`${llmUsageSummaryBuckets.stateCardTokens} + ${delta.stateCardTokens}`,
		totalTokens: sql`${llmUsageSummaryBuckets.totalTokens} + ${delta.totalTokens}`,
		totalDurationMs: sql`${llmUsageSummaryBuckets.totalDurationMs} + ${delta.totalDurationMs}`,
		outputDurationMs: sql`${llmUsageSummaryBuckets.outputDurationMs} + ${delta.outputDurationMs}`,
		measuredDurationCallCount: sql`${llmUsageSummaryBuckets.measuredDurationCallCount} + ${delta.measuredDurationCallCount}`,
		callCount: sql`${llmUsageSummaryBuckets.callCount} + ${delta.callCount}`,
		measuredCallCount: sql`${llmUsageSummaryBuckets.measuredCallCount} + ${delta.measuredCallCount}`,
		estimatedCallCount: sql`${llmUsageSummaryBuckets.estimatedCallCount} + ${delta.estimatedCallCount}`,
		mixedCallCount: sql`${llmUsageSummaryBuckets.mixedCallCount} + ${delta.mixedCallCount}`,
		unavailableCallCount: sql`${llmUsageSummaryBuckets.unavailableCallCount} + ${delta.unavailableCallCount}`,
		pricedCallCount: sql`${llmUsageSummaryBuckets.pricedCallCount} + ${delta.pricedCallCount}`,
		unpricedCallCount: sql`${llmUsageSummaryBuckets.unpricedCallCount} + ${delta.unpricedCallCount}`,
		manualPricedCallCount: sql`${llmUsageSummaryBuckets.manualPricedCallCount} + ${delta.manualPricedCallCount}`,
		estimatedCost: sql`${llmUsageSummaryBuckets.estimatedCost} + ${delta.estimatedCost}`,
		inputCost: sql`${llmUsageSummaryBuckets.inputCost} + ${delta.inputCost}`,
		cachedInputCost: sql`${llmUsageSummaryBuckets.cachedInputCost} + ${delta.cachedInputCost}`,
		outputCost: sql`${llmUsageSummaryBuckets.outputCost} + ${delta.outputCost}`,
		reasoningOutputCost: sql`${llmUsageSummaryBuckets.reasoningOutputCost} + ${delta.reasoningOutputCost}`,
		pricingUpdatedAt: delta.pricingUpdatedAt
			? sql`case when ${llmUsageSummaryBuckets.pricingUpdatedAt} is null or ${llmUsageSummaryBuckets.pricingUpdatedAt} < ${delta.pricingUpdatedAt} then ${delta.pricingUpdatedAt} else ${llmUsageSummaryBuckets.pricingUpdatedAt} end`
			: llmUsageSummaryBuckets.pricingUpdatedAt,
		updatedAt: now,
	};
}

function summaryTaskIncrementSet(delta: SummaryDelta, now: Date) {
	return {
		inputTokens: sql`${llmUsageSummaryTaskBuckets.inputTokens} + ${delta.inputTokens}`,
		outputTokens: sql`${llmUsageSummaryTaskBuckets.outputTokens} + ${delta.outputTokens}`,
		cachedInputTokens: sql`${llmUsageSummaryTaskBuckets.cachedInputTokens} + ${delta.cachedInputTokens}`,
		reasoningOutputTokens: sql`${llmUsageSummaryTaskBuckets.reasoningOutputTokens} + ${delta.reasoningOutputTokens}`,
		systemPromptTokens: sql`${llmUsageSummaryTaskBuckets.systemPromptTokens} + ${delta.systemPromptTokens}`,
		userPromptTokens: sql`${llmUsageSummaryTaskBuckets.userPromptTokens} + ${delta.userPromptTokens}`,
		stateCardTokens: sql`${llmUsageSummaryTaskBuckets.stateCardTokens} + ${delta.stateCardTokens}`,
		totalTokens: sql`${llmUsageSummaryTaskBuckets.totalTokens} + ${delta.totalTokens}`,
		totalDurationMs: sql`${llmUsageSummaryTaskBuckets.totalDurationMs} + ${delta.totalDurationMs}`,
		outputDurationMs: sql`${llmUsageSummaryTaskBuckets.outputDurationMs} + ${delta.outputDurationMs}`,
		measuredDurationCallCount: sql`${llmUsageSummaryTaskBuckets.measuredDurationCallCount} + ${delta.measuredDurationCallCount}`,
		callCount: sql`${llmUsageSummaryTaskBuckets.callCount} + ${delta.callCount}`,
		pricedCallCount: sql`${llmUsageSummaryTaskBuckets.pricedCallCount} + ${delta.pricedCallCount}`,
		estimatedCost: sql`${llmUsageSummaryTaskBuckets.estimatedCost} + ${delta.estimatedCost}`,
		updatedAt: now,
	};
}

async function listUsageRecordsForSummary(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = [];
	if (input.since)
		conditions.push(gte(llmUsageRecords.createdAt, toUtcHour(input.since)));
	if (input.repositoryId)
		conditions.push(eq(tasks.repositoryId, input.repositoryId));
	return db
		.select({
			id: llmUsageRecords.id,
			createdAt: llmUsageRecords.createdAt,
			updatedAt: llmUsageRecords.updatedAt,
			taskId: llmUsageRecords.taskId,
			runId: llmUsageRecords.runId,
			callId: llmUsageRecords.callId,
			provider: llmUsageRecords.provider,
			model: llmUsageRecords.model,
			label: llmUsageRecords.label,
			round: llmUsageRecords.round,
			usageMode: llmUsageRecords.usageMode,
			inputTokens: llmUsageRecords.inputTokens,
			outputTokens: llmUsageRecords.outputTokens,
			cachedInputTokens: llmUsageRecords.cachedInputTokens,
			reasoningOutputTokens: llmUsageRecords.reasoningOutputTokens,
			totalTokens: llmUsageRecords.totalTokens,
			systemPromptTokens: llmUsageRecords.systemPromptTokens,
			userPromptTokens: llmUsageRecords.userPromptTokens,
			stateCardTokens: llmUsageRecords.stateCardTokens,
			responseTokensEstimate: llmUsageRecords.responseTokensEstimate,
			durationMs: llmUsageRecords.durationMs,
			rawUsageJson: llmUsageRecords.rawUsageJson,
			metadataJson: llmUsageRecords.metadataJson,
		})
		.from(llmUsageRecords)
		.leftJoin(tasks, eq(llmUsageRecords.taskId, tasks.id))
		.where(conditions.length ? and(...conditions) : undefined);
}

async function listSummaryBuckets(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = bucketScopeConditions(input);
	return db
		.select()
		.from(llmUsageSummaryBuckets)
		.where(conditions.length ? and(...conditions) : undefined);
}

async function listSummaryTaskBuckets(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = taskBucketScopeConditions(input);
	return db
		.select()
		.from(llmUsageSummaryTaskBuckets)
		.where(conditions.length ? and(...conditions) : undefined);
}

async function countSummaryBuckets(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const conditions = bucketScopeConditions(input);
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(llmUsageSummaryBuckets)
		.where(conditions.length ? and(...conditions) : undefined);
	return Number(row?.count ?? 0);
}

async function deleteSummaryScope(input: {
	since?: Date | null;
	repositoryId?: string | null;
}) {
	const warningConditions = warningScopeConditions(input);
	await db
		.delete(llmUsageSummaryWarnings)
		.where(warningConditions.length ? and(...warningConditions) : undefined);
	const bucketConditions = bucketScopeConditions(input);
	await db
		.delete(llmUsageSummaryBuckets)
		.where(bucketConditions.length ? and(...bucketConditions) : undefined);
	const taskBucketConditions = taskBucketScopeConditions(input);
	await db
		.delete(llmUsageSummaryTaskBuckets)
		.where(
			taskBucketConditions.length ? and(...taskBucketConditions) : undefined,
		);
}
