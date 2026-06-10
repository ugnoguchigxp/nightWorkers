import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { llmUsageRecords } from '../../db/schema';
import * as nightWorkersRepo from '../../modules/nightworkers/nightworkers.repository';
import type { LlmPromptPartTokenEstimates, LlmUsageMode, NormalizedLlmUsage } from './types';

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
  durationMs: number;
  metadataJson?: Record<string, unknown>;
}) {
  const usageMode = resolveStoredUsageMode(input.usage.mode, input.promptPartTokenEstimates);
  const [record] = await db
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
      systemPromptTokens: normalizeOptionalInt(input.promptPartTokenEstimates?.systemPromptTokens),
      userPromptTokens: normalizeOptionalInt(input.promptPartTokenEstimates?.userPromptTokens),
      stateCardTokens: normalizeOptionalInt(input.promptPartTokenEstimates?.stateCardTokens),
      responseTokensEstimate: null,
      durationMs: Math.max(0, Math.floor(input.durationMs)),
      rawUsageJson: input.usage.rawUsage ?? null,
      metadataJson: input.metadataJson ?? null,
    })
    .returning();

  if (record) {
    await nightWorkersRepo.appendActivityEvent({
      taskId: input.taskId,
      runId: input.runId ?? null,
      kind: 'llm.usage',
      source: 'provider',
      status: 'completed',
      text: `LLM usage recorded. i:${record.inputTokens ?? 0} o:${record.outputTokens ?? 0}`,
      visibility: 'debug',
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
        reasoningOutputTokens: record.reasoningOutputTokens,
        stateCardTokens: record.stateCardTokens,
      },
    });
  }

  return record;
}

export async function listLlmUsageRecordsForTask(taskId: string) {
  return db
    .select()
    .from(llmUsageRecords)
    .where(eq(llmUsageRecords.taskId, taskId))
    .orderBy(desc(llmUsageRecords.createdAt));
}

export async function summarizeLlmUsageForTask(taskId: string) {
  const [row] = await db
    .select({
      inputTokens: sql<number>`coalesce(sum(${llmUsageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsageRecords.outputTokens}), 0)`,
      stateCardTokens: sql<number>`coalesce(sum(${llmUsageRecords.stateCardTokens}), 0)`,
      promptInputTokens: sql<number>`coalesce(sum(coalesce(${llmUsageRecords.systemPromptTokens}, 0) + coalesce(${llmUsageRecords.userPromptTokens}, 0) + coalesce(${llmUsageRecords.stateCardTokens}, 0)), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${llmUsageRecords.cachedInputTokens}), 0)`,
      reasoningOutputTokens: sql<number>`coalesce(sum(${llmUsageRecords.reasoningOutputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(coalesce(${llmUsageRecords.totalTokens}, coalesce(${llmUsageRecords.inputTokens}, 0) + coalesce(${llmUsageRecords.outputTokens}, 0))), 0)`,
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
      ? 'unavailable'
      : mixedCallCount > 0
        ? 'mixed'
        : measuredCallCount === callCount
          ? 'measured'
          : estimatedCallCount === callCount
            ? 'estimated'
            : 'mixed';

  return {
    taskId,
    promptInputTokens: Number(row?.promptInputTokens ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    stateCardTokens: Number(row?.stateCardTokens ?? 0),
    cachedInputTokens: Number(row?.cachedInputTokens ?? 0),
    reasoningOutputTokens: Number(row?.reasoningOutputTokens ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    usageMode,
    callCount,
    measuredCallCount,
    estimatedCallCount,
    lastUpdatedAt: row?.lastUpdatedAt ? new Date(Number(row.lastUpdatedAt)).toISOString() : null,
  };
}

function normalizeOptionalInt(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function resolveStoredUsageMode(
  usageMode: LlmUsageMode,
  estimates: LlmPromptPartTokenEstimates | undefined
): LlmUsageMode {
  if (usageMode !== 'measured') return usageMode;
  if (
    normalizeOptionalInt(estimates?.systemPromptTokens) !== null ||
    normalizeOptionalInt(estimates?.userPromptTokens) !== null ||
    normalizeOptionalInt(estimates?.stateCardTokens) !== null
  ) {
    return 'mixed';
  }
  return usageMode;
}
