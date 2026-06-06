import type { SupervisorArtifactContextRef } from './artifact-contract';

export type ExecutionReviewChecklistItem = {
  item: string;
  status: 'passed' | 'failed' | 'not_checked' | 'blocked';
  evidenceRef?: string | null;
  source:
    | 'worker_tool'
    | 'file'
    | 'test_command'
    | 'provider_activity'
    | 'model'
    | 'structured_artifact'
    | 'contextstill_context_pack';
};

export function checklistItemCanProveWorkerEvidence(item: ExecutionReviewChecklistItem) {
  return (
    (item.source === 'worker_tool' || item.source === 'test_command') && Boolean(item.evidenceRef)
  );
}

export function buildExecutionReviewChecklist(input: {
  toolResults: Array<{ step: number; toolName: string; ok: boolean; summary?: string }>;
  artifactContextRefs?: SupervisorArtifactContextRef[];
}): ExecutionReviewChecklistItem[] {
  const items: ExecutionReviewChecklistItem[] = input.toolResults.map((result) => ({
    item: `${result.toolName} step ${result.step}`,
    status: result.ok ? 'passed' : 'failed',
    evidenceRef: `tool:${result.step}:${result.toolName}`,
    source: result.toolName === 'run_verification' ? 'test_command' : 'worker_tool',
  }));
  for (const ref of input.artifactContextRefs || []) {
    items.push({
      item: `${ref.kind} ${ref.refId}`,
      status: 'not_checked',
      evidenceRef: ref.digest ?? ref.refId,
      source:
        ref.kind === 'contextstill_context_pack'
          ? 'contextstill_context_pack'
          : 'structured_artifact',
    });
  }
  return items;
}
