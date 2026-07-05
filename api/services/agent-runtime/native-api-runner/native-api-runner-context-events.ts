import * as repo from '../../../modules/nightworkers/nightworkers.repository';
import type { AgentRunContext, AgentRuntimeResult, AgentRuntimeSink } from '../types';
import type { NativeApiContextBudget } from './native-api-context-budget';
import type { NativeApiBaselineCompactionResult } from './native-api-context-compaction';

export const MAX_RUNTIME_BASELINE_COMPACTIONS = 3;

export async function emitNativeApiContextBudgetEvent(input: {
  sink: AgentRuntimeSink;
  context: AgentRunContext;
  action:
    | 'context_budget_warning'
    | 'context_compaction_started'
    | 'context_compaction_finished'
    | 'context_compaction_failed';
  turnIndex: number;
  budget: NativeApiContextBudget;
  message: string;
  compaction?: NativeApiBaselineCompactionResult | null;
}) {
  const payload = {
    runtime: 'native_api_runner',
    action: input.action,
    runId: input.context.runId,
    taskId: input.context.taskId,
    turnIndex: input.turnIndex,
    contextBudget: summarizeNativeApiContextBudget(input.budget),
    ...(input.compaction
      ? { contextCompaction: summarizeNativeApiContextCompaction(input.compaction) }
      : {}),
  };
  await input.sink.emit({
    type: 'tool_call_progress',
    message: input.message,
    payload,
  });
  try {
    await repo.createTaskEvent({
      taskRunId: input.context.runId,
      type: input.action,
      actor: 'runtime',
      eventType: input.action,
      message: input.message,
      payloadJson: payload,
    });
  } catch {
    // Context budget events are observability-only; do not fail the runtime if event persistence fails.
  }
}

export function summarizeNativeApiContextBudget(budget: NativeApiContextBudget) {
  return {
    estimatedPromptTokens: budget.estimatedPromptTokens,
    modelContextWindowTokens: budget.modelContextWindowTokens,
    safePromptBudgetTokens: budget.safePromptBudgetTokens,
    reservedOutputTokens: budget.reservedOutputTokens,
    autoCompactTokenLimit: budget.autoCompactTokenLimit,
    remainingContextHintThreshold: budget.remainingContextHintThreshold,
    remainingTokens: budget.remainingTokens,
    contextUsageRatio: budget.contextUsageRatio,
    warningThresholdExceeded: budget.warningThresholdExceeded,
    compactLimitExceeded: budget.compactLimitExceeded,
    hardLimitExceeded: budget.hardLimitExceeded,
    messageTokens: budget.messageTokens,
    toolTokens: budget.toolTokens,
    largestModelVisibleMessageChars: budget.largestModelVisibleMessageChars,
    largestModelVisibleMessageRole: budget.largestModelVisibleMessageRole,
    compactedToolResultCount: budget.compactedToolResultCount,
  };
}

export function summarizeNativeApiContextCompaction(compaction: NativeApiBaselineCompactionResult) {
  return {
    reason: compaction.reason,
    retainedHistoryItems: compaction.retainedHistoryItems,
    previousHistoryItems: compaction.previousHistoryItems,
  };
}

export function contextBudgetFailureResult(
  budget: NativeApiContextBudget,
  reason: 'context_compaction_loop_guard' | 'context_compaction_insufficient'
): AgentRuntimeResult {
  return {
    terminalState: 'needs_human',
    summary: 'Native API context budget exceeded.',
    finalReport: [
      'Native API context budget exceeded before the provider call.',
      `reason=${reason}`,
      `estimatedPromptTokens=${budget.estimatedPromptTokens}`,
      `autoCompactTokenLimit=${budget.autoCompactTokenLimit}`,
      `modelContextWindowTokens=${budget.modelContextWindowTokens}`,
      'NativeApiRunner did not fall back to Codex, SchemaFirst, or an unconfigured provider endpoint.',
    ].join('\n'),
    stoppedBy: 'llm_error',
    riskLevel: 'high',
  };
}
