import { attachNativeToolEvidence } from '../../supervisor/supervisor-loop-helpers';
import type { CompactToolResult } from '../../supervisor/supervisor-loop-types';
import type { WorkerToolResult } from '../../worker-tools/types';

const DEFAULT_MAX_PROVIDER_OUTPUT_CHARS = 12_000;

export function projectWorkerToolResultForProvider(input: {
  step: number;
  toolName: string;
  arguments: Record<string, unknown>;
  result: WorkerToolResult<unknown>;
  maxChars?: number;
}): string {
  const compact = attachNativeToolEvidence({
    step: input.step,
    toolName: input.toolName,
    ok: input.result.ok,
    arguments: input.arguments,
    summary: `tool=${input.toolName} status=${input.result.ok ? 'ok' : 'failed'}`,
    payload: input.result.payload,
    error: input.result.error,
  });
  return projectCompactToolResultForProvider({
    result: compact,
    maxChars: input.maxChars,
  });
}

export function projectCompactToolResultForProvider(input: {
  result: CompactToolResult;
  maxChars?: number;
}): string {
  const evidence = input.result.evidence;
  const output = JSON.stringify({
    ok: input.result.ok,
    toolName: input.result.toolName,
    payload: input.result.payload,
    error: input.result.error,
    artifactIds: readArtifactIds(input.result.payload),
    evidence: evidence
      ? {
          failureKind: evidence.failureKind,
          reason: evidence.reason,
          targetPath: evidence.targetPath,
          recoveryDirective: evidence.recoveryDirective,
          doNotRepeat: evidence.doNotRepeat,
          criticalEvidence: evidence.criticalEvidence,
        }
      : undefined,
    attribution:
      input.result.attributedTodoSeq || input.result.observedTodoSeq
        ? {
            observedTodoSeq: input.result.observedTodoSeq,
            attributedTodoSeq: input.result.attributedTodoSeq,
            reason: input.result.attributionReason,
          }
        : undefined,
  });
  const maxChars = input.maxChars ?? DEFAULT_MAX_PROVIDER_OUTPUT_CHARS;
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars)}\n[truncated]`;
}

function readArtifactIds(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== 'object' || !('artifactIds' in payload)) return undefined;
  const artifactIds = (payload as { artifactIds?: unknown }).artifactIds;
  return Array.isArray(artifactIds)
    ? artifactIds.filter((item): item is string => typeof item === 'string')
    : undefined;
}
