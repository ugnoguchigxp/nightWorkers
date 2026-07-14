import { desc, eq, sql } from "drizzle-orm";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { db } from "../../db/client";
import { llmUsageRecords } from "../../db/schema";
import * as nightWorkersRepo from "../../modules/nightworkers/nightworkers.repository";
import {
	resolveLlmUsageTrace,
	withTraceProvenance,
} from "../../modules/nightworkers/nightworkers.trace-provenance";
import { readGeneralSettings } from "../settings/general-settings";
import { upsertLlmUsageSummaryForRecord } from "./summary";
import type {
	LlmPromptPartTokenEstimates,
	LlmUsageMode,
	NormalizedLlmUsage,
} from "./types";

export async function recordLlmUsage(input: {
	taskId: string;
	runId?: string | null;
	callId: string;
	provider: string;
	model?: string | null;
	label: string;
	round?: 1 | 2 | null;
	usage: NormalizedLlmUsage;
	promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
	promptPartObservabilityEnabled?: boolean;
	durationMs: number;
	metadataJson?: Record<string, unknown>;
	trace?: TraceProvenance;
}) {
	const promptPartObservabilityEnabled = resolvePromptPartObservabilityEnabled(
		input.promptPartObservabilityEnabled,
	);
	const promptPartTokenEstimates = resolveStoredPromptPartTokenEstimates({
		promptPartObservabilityEnabled,
		promptPartTokenEstimates: input.promptPartTokenEstimates,
	});
	const usageMode = resolveStoredUsageMode(
		input.usage.mode,
		promptPartTokenEstimates,
	);
	const nonCachedInputTokens =
		input.usage.inputTokens !== null && input.usage.cachedInputTokens !== null
			? Math.max(0, input.usage.inputTokens - input.usage.cachedInputTokens)
			: null;
	const trace = resolveLlmUsageTrace({
		runId: input.runId,
		callId: input.callId,
		metadata: input.metadataJson,
		trace: input.trace,
	});
	const metadataJson = withTraceProvenance(
		{
			...(input.metadataJson ?? {}),
			nonCachedInputTokens,
			promptPartObservabilityEnabled,
		},
		trace,
	);
	const record = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(llmUsageRecords)
			.values({
				taskId: input.taskId,
				runId: input.runId ?? null,
				callId: input.callId,
				provider: input.provider,
				model: input.model ?? null,
				label: input.label,
				round: input.round ?? null,
				usageMode,
				inputTokens: input.usage.inputTokens,
				outputTokens: input.usage.outputTokens,
				cachedInputTokens: input.usage.cachedInputTokens,
				reasoningOutputTokens: input.usage.reasoningOutputTokens,
				totalTokens: input.usage.totalTokens,
				systemPromptTokens: normalizeOptionalInt(
					promptPartTokenEstimates?.systemPromptTokens,
				),
				userPromptTokens: normalizeOptionalInt(
					promptPartTokenEstimates?.userPromptTokens,
				),
				stateCardTokens: normalizeOptionalInt(
					promptPartTokenEstimates?.stateCardTokens,
				),
				responseTokensEstimate: null,
				durationMs: Math.max(0, Math.floor(input.durationMs)),
				rawUsageJson: input.usage.rawUsage ?? null,
				metadataJson,
				traceOwner: trace.owner,
				traceChannel: trace.channel,
			})
			.returning();
		if (created) await upsertLlmUsageSummaryForRecord(created, tx);
		return created;
	});

	if (record) {
		await nightWorkersRepo.appendActivityEvent({
			taskId: input.taskId,
			runId: input.runId ?? null,
			kind: "llm.usage",
			source: "provider",
			status: "completed",
			text: `LLM usage recorded. input:${formatUsageToken(record.inputTokens)} cached_input:${formatUsageToken(record.cachedInputTokens)} output:${formatUsageToken(record.outputTokens)}`,
			visibility: "debug",
			trace,
			externalId: record.id,
			dedupeKey: `llm_usage:${record.id}`,
			payloadJson: {
				usageRecordId: record.id,
				provider: record.provider,
				model: record.model,
				label: record.label,
				round: record.round,
				usageMode: record.usageMode,
				inputTokens: record.inputTokens,
				outputTokens: record.outputTokens,
				cachedInputTokens: record.cachedInputTokens,
				nonCachedInputTokens,
				reasoningOutputTokens: record.reasoningOutputTokens,
				systemPromptTokens: record.systemPromptTokens,
				userPromptTokens: record.userPromptTokens,
				stateCardTokens: record.stateCardTokens,
				promptPartObservabilityEnabled,
				role: input.metadataJson?.role ?? null,
			},
		});
	}

	return record;
}

function formatUsageToken(value: number | null | undefined) {
	return value === null || value === undefined ? "n/a" : String(value);
}

export async function listLlmUsageRecordsForTask(taskId: string) {
	return db
		.select()
		.from(llmUsageRecords)
		.where(eq(llmUsageRecords.taskId, taskId))
		.orderBy(desc(llmUsageRecords.createdAt));
}

export async function listLlmUsageRecordsForRun(runId: string) {
	return db
		.select()
		.from(llmUsageRecords)
		.where(eq(llmUsageRecords.runId, runId))
		.orderBy(llmUsageRecords.createdAt);
}

export async function summarizeLlmUsageForTask(taskId: string) {
	const [row] = await db
		.select({
			inputTokens: sql<number>`coalesce(sum(${llmUsageRecords.inputTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${llmUsageRecords.outputTokens}), 0)`,
			stateCardTokens: sql<number>`coalesce(sum(${llmUsageRecords.stateCardTokens}), 0)`,
			promptInputTokens: sql<number>`coalesce(sum(coalesce(${llmUsageRecords.systemPromptTokens}, 0) + coalesce(${llmUsageRecords.userPromptTokens}, 0) + coalesce(${llmUsageRecords.stateCardTokens}, 0)), 0)`,
			cachedInputTokens: sql<number>`coalesce(sum(${llmUsageRecords.cachedInputTokens}), 0)`,
			nonCachedInputTokens: sql<number>`coalesce(sum(case when ${llmUsageRecords.inputTokens} is not null and ${llmUsageRecords.cachedInputTokens} is not null and ${llmUsageRecords.inputTokens} > ${llmUsageRecords.cachedInputTokens} then ${llmUsageRecords.inputTokens} - ${llmUsageRecords.cachedInputTokens} else 0 end), 0)`,
			reasoningOutputTokens: sql<number>`coalesce(sum(${llmUsageRecords.reasoningOutputTokens}), 0)`,
			totalTokens: sql<number>`coalesce(sum(coalesce(${llmUsageRecords.totalTokens}, coalesce(${llmUsageRecords.inputTokens}, 0) + coalesce(${llmUsageRecords.outputTokens}, 0))), 0)`,
			totalDurationMs: sql<number>`coalesce(sum(${llmUsageRecords.durationMs}), 0)`,
			callCount: sql<number>`count(*)`,
			measuredCallCount: sql<number>`sum(case when ${llmUsageRecords.usageMode} in ('measured', 'mixed') then 1 else 0 end)`,
			estimatedCallCount: sql<number>`sum(case when ${llmUsageRecords.usageMode} = 'estimated' then 1 else 0 end)`,
			mixedCallCount: sql<number>`sum(case when ${llmUsageRecords.usageMode} = 'mixed' then 1 else 0 end)`,
			lastUpdatedAt: sql<number | null>`max(${llmUsageRecords.createdAt})`,
		})
		.from(llmUsageRecords)
		.where(eq(llmUsageRecords.taskId, taskId));

	const callCount = Number(row?.callCount ?? 0);
	const measuredCallCount = Number(row?.measuredCallCount ?? 0);
	const estimatedCallCount = Number(row?.estimatedCallCount ?? 0);
	const mixedCallCount = Number(row?.mixedCallCount ?? 0);
	const usageMode =
		callCount === 0
			? "unavailable"
			: mixedCallCount > 0
				? "mixed"
				: measuredCallCount === callCount
					? "measured"
					: estimatedCallCount === callCount
						? "estimated"
						: "mixed";

	return {
		taskId,
		promptInputTokens: Number(row?.promptInputTokens ?? 0),
		inputTokens: Number(row?.inputTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
		stateCardTokens: Number(row?.stateCardTokens ?? 0),
		cachedInputTokens: Number(row?.cachedInputTokens ?? 0),
		nonCachedInputTokens: Number(row?.nonCachedInputTokens ?? 0),
		reasoningOutputTokens: Number(row?.reasoningOutputTokens ?? 0),
		totalTokens: Number(row?.totalTokens ?? 0),
		totalDurationMs: Number(row?.totalDurationMs ?? 0),
		averageDurationMs:
			callCount > 0
				? Math.round(Number(row?.totalDurationMs ?? 0) / callCount)
				: null,
		usageMode,
		callCount,
		measuredCallCount,
		estimatedCallCount,
		lastUpdatedAt: row?.lastUpdatedAt
			? new Date(Number(row.lastUpdatedAt)).toISOString()
			: null,
	};
}

function normalizeOptionalInt(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(0, Math.floor(value))
		: null;
}

function resolveStoredUsageMode(
	usageMode: LlmUsageMode,
	estimates: LlmPromptPartTokenEstimates | undefined,
): LlmUsageMode {
	if (usageMode !== "measured") return usageMode;
	if (
		normalizeOptionalInt(estimates?.systemPromptTokens) !== null ||
		normalizeOptionalInt(estimates?.userPromptTokens) !== null ||
		normalizeOptionalInt(estimates?.stateCardTokens) !== null
	) {
		return "mixed";
	}
	return usageMode;
}

function resolvePromptPartObservabilityEnabled(explicit: boolean | undefined) {
	if (typeof explicit === "boolean") return explicit;
	try {
		return readGeneralSettings().llmUsage.promptPartObservabilityEnabled;
	} catch {
		return true;
	}
}

function resolveStoredPromptPartTokenEstimates(input: {
	promptPartTokenEstimates?: LlmPromptPartTokenEstimates;
	promptPartObservabilityEnabled: boolean;
}) {
	if (!input.promptPartObservabilityEnabled) return undefined;
	return input.promptPartTokenEstimates;
}
