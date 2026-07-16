import { and, desc, eq, sql } from "drizzle-orm";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import type { DbTransaction } from "../../db/client";
import { db } from "../../db/client";
import { llmUsageCounterCheckpoints, llmUsageRecords } from "../../db/schema";
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
	UsageCounterScope,
	UsageNormalizationStatus,
} from "./types";

type UsageNormalization = {
	usage: NormalizedLlmUsage;
	status: UsageNormalizationStatus | null;
	metadata?: Record<string, unknown>;
	checkpoint?: {
		agentModeSessionId: string;
		providerSessionKey: string;
		provider: string;
		model: string | null;
		counterScope: UsageCounterScope;
		rawInputTokens: number | null;
		rawCachedInputTokens: number | null;
		rawOutputTokens: number | null;
		rawReasoningOutputTokens: number | null;
		sourceRunId: string | null;
		sourceSequence: number | null;
	};
};

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
	agentModeSessionId?: string | null;
	providerSessionKey?: string | null;
	counterScope?: UsageCounterScope;
	sourceSequence?: number | null;
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
	const trace = resolveLlmUsageTrace({
		runId: input.runId,
		callId: input.callId,
		metadata: input.metadataJson,
		trace: input.trace,
	});
	const record = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(llmUsageRecords)
			.where(eq(llmUsageRecords.callId, input.callId))
			.limit(1);
		if (existing) return existing;
		const normalization = await normalizeUsageForStorage(tx, input);
		const storedUsage = normalization.usage;
		const nonCachedInputTokens =
			storedUsage.inputTokens !== null && storedUsage.cachedInputTokens !== null
				? Math.max(0, storedUsage.inputTokens - storedUsage.cachedInputTokens)
				: null;
		const metadataJson = withTraceProvenance(
			{
				...(input.metadataJson ?? {}),
				nonCachedInputTokens,
				promptPartObservabilityEnabled,
				...(normalization.metadata
					? { usageNormalization: normalization.metadata }
					: {}),
			},
			trace,
		);
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
				inputTokens: storedUsage.inputTokens,
				outputTokens: storedUsage.outputTokens,
				cachedInputTokens: storedUsage.cachedInputTokens,
				reasoningOutputTokens: storedUsage.reasoningOutputTokens,
				totalTokens: storedUsage.totalTokens,
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
				rawUsageJson: storedUsage.rawUsage ?? null,
				metadataJson,
				traceOwner: trace.owner,
				traceChannel: trace.channel,
				agentModeSessionId: input.agentModeSessionId ?? null,
				usageCounterScope: input.counterScope ?? "per_turn",
				usageNormalizationStatus: normalization.status,
				sourceSequence: input.sourceSequence ?? null,
			})
			.returning();
		if (created) await upsertLlmUsageSummaryForRecord(created, tx);
		if (created && normalization.checkpoint) {
			await tx
				.insert(llmUsageCounterCheckpoints)
				.values(normalization.checkpoint)
				.onConflictDoUpdate({
					target: [
						llmUsageCounterCheckpoints.agentModeSessionId,
						llmUsageCounterCheckpoints.providerSessionKey,
					],
					set: {
						rawInputTokens: normalization.checkpoint.rawInputTokens,
						rawCachedInputTokens: normalization.checkpoint.rawCachedInputTokens,
						rawOutputTokens: normalization.checkpoint.rawOutputTokens,
						rawReasoningOutputTokens:
							normalization.checkpoint.rawReasoningOutputTokens,
						sourceRunId: normalization.checkpoint.sourceRunId,
						sourceSequence: normalization.checkpoint.sourceSequence,
						stateVersion: sql`${llmUsageCounterCheckpoints.stateVersion} + 1`,
						updatedAt: new Date(),
					},
				});
		}
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
				nonCachedInputTokens:
					record.inputTokens !== null && record.cachedInputTokens !== null
						? Math.max(0, record.inputTokens - record.cachedInputTokens)
						: null,
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

async function normalizeUsageForStorage(
	tx: DbTransaction,
	input: {
		taskId: string;
		runId?: string | null;
		provider: string;
		model?: string | null;
		usage: NormalizedLlmUsage;
		agentModeSessionId?: string | null;
		providerSessionKey?: string | null;
		counterScope?: UsageCounterScope;
		sourceSequence?: number | null;
	},
): Promise<UsageNormalization> {
	const scope = input.counterScope ?? "per_turn";
	if (scope !== "provider_session_cumulative") {
		return { usage: input.usage, status: null };
	}
	if (!input.agentModeSessionId || !input.providerSessionKey) {
		return {
			usage: input.usage,
			status: "unavailable",
			metadata: {
				counterScope: scope,
				status: "unavailable",
				warning: "agentModeSessionId and providerSessionKey are required",
			},
		};
	}
	const [previous] = await tx
		.select()
		.from(llmUsageCounterCheckpoints)
		.where(
			and(
				eq(
					llmUsageCounterCheckpoints.agentModeSessionId,
					input.agentModeSessionId,
				),
				eq(
					llmUsageCounterCheckpoints.providerSessionKey,
					input.providerSessionKey,
				),
			),
		)
		.limit(1);
	const current = toRawCounters(input.usage);
	const previousRaw = previous
		? {
				inputTokens: previous.rawInputTokens,
				cachedInputTokens: previous.rawCachedInputTokens,
				outputTokens: previous.rawOutputTokens,
				reasoningOutputTokens: previous.rawReasoningOutputTokens,
			}
		: null;
	const reset = previousRaw ? hasCounterDecrease(previousRaw, current) : false;
	const delta = reset ? current : subtractCounters(current, previousRaw);
	const invalidCachedDelta =
		delta.cachedInputTokens !== null &&
		delta.inputTokens !== null &&
		delta.cachedInputTokens > delta.inputTokens;
	const stored = {
		...input.usage,
		inputTokens: delta.inputTokens,
		cachedInputTokens: invalidCachedDelta ? null : delta.cachedInputTokens,
		outputTokens: delta.outputTokens,
		reasoningOutputTokens: delta.reasoningOutputTokens,
		totalTokens:
			delta.inputTokens !== null || delta.outputTokens !== null
				? (delta.inputTokens ?? 0) + (delta.outputTokens ?? 0)
				: null,
	};
	const status: UsageNormalizationStatus = invalidCachedDelta
		? "invalid_cached_delta"
		: reset
			? "counter_reset"
			: previous
				? "delta"
				: "first_snapshot";
	return {
		usage: stored,
		status,
		metadata: {
			counterScope: scope,
			status,
			providerSessionKey: input.providerSessionKey,
			previousRaw,
			currentRaw: current,
			delta: {
				...delta,
				cachedInputTokens: invalidCachedDelta ? null : delta.cachedInputTokens,
			},
		},
		checkpoint: {
			agentModeSessionId: input.agentModeSessionId,
			providerSessionKey: input.providerSessionKey,
			provider: input.provider,
			model: input.model ?? null,
			counterScope: scope,
			rawInputTokens: current.inputTokens,
			rawCachedInputTokens: current.cachedInputTokens,
			rawOutputTokens: current.outputTokens,
			rawReasoningOutputTokens: current.reasoningOutputTokens,
			sourceRunId: input.runId ?? null,
			sourceSequence: input.sourceSequence ?? null,
		},
	};
}

type RawCounters = {
	inputTokens: number | null;
	cachedInputTokens: number | null;
	outputTokens: number | null;
	reasoningOutputTokens: number | null;
};

function toRawCounters(usage: NormalizedLlmUsage): RawCounters {
	return {
		inputTokens: usage.inputTokens,
		cachedInputTokens: usage.cachedInputTokens,
		outputTokens: usage.outputTokens,
		reasoningOutputTokens: usage.reasoningOutputTokens,
	};
}

function hasCounterDecrease(previous: RawCounters, current: RawCounters) {
	return (Object.keys(previous) as Array<keyof RawCounters>).some(
		(key) =>
			previous[key] !== null &&
			current[key] !== null &&
			(current[key] as number) < (previous[key] as number),
	);
}

function subtractCounters(
	current: RawCounters,
	previous: RawCounters | null,
): RawCounters {
	return {
		inputTokens: subtractCounter(current.inputTokens, previous?.inputTokens),
		cachedInputTokens: subtractCounter(
			current.cachedInputTokens,
			previous?.cachedInputTokens,
		),
		outputTokens: subtractCounter(current.outputTokens, previous?.outputTokens),
		reasoningOutputTokens: subtractCounter(
			current.reasoningOutputTokens,
			previous?.reasoningOutputTokens,
		),
	};
}

function subtractCounter(
	current: number | null,
	previous: number | null | undefined,
) {
	if (current === null) return null;
	return previous === null || previous === undefined
		? current
		: Math.max(0, current - previous);
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
	const [total, codingAgent, missionPilot] = await Promise.all([
		summarizeLlmUsageRows(taskId),
		summarizeLlmUsageRows(taskId, "coding_agent"),
		summarizeLlmUsageRows(taskId, "mission_pilot"),
	]);
	return {
		taskId,
		...total,
		byOwner: {
			codingAgent,
			missionPilot,
		},
	};
}

async function summarizeLlmUsageRows(
	taskId: string,
	traceOwner?: "coding_agent" | "mission_pilot",
) {
	const [row] = await db
		.select({
			inputTokens: sql<number>`coalesce(sum(${llmUsageRecords.inputTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${llmUsageRecords.outputTokens}), 0)`,
			stateCardTokens: sql<number>`coalesce(sum(${llmUsageRecords.stateCardTokens}), 0)`,
			promptInputTokens: sql<number>`coalesce(sum(coalesce(${llmUsageRecords.systemPromptTokens}, 0) + coalesce(${llmUsageRecords.userPromptTokens}, 0) + coalesce(${llmUsageRecords.stateCardTokens}, 0)), 0)`,
			cachedInputTokens: sql<number>`coalesce(sum(${llmUsageRecords.cachedInputTokens}), 0)`,
			nonCachedInputTokens: sql<number>`coalesce(sum(case when ${llmUsageRecords.inputTokens} is not null then max(${llmUsageRecords.inputTokens} - coalesce(${llmUsageRecords.cachedInputTokens}, 0), 0) else 0 end), 0)`,
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
		.where(
			traceOwner
				? and(
						eq(llmUsageRecords.taskId, taskId),
						eq(llmUsageRecords.traceOwner, traceOwner),
					)
				: eq(llmUsageRecords.taskId, taskId),
		);

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
