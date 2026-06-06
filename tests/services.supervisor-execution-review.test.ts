import { describe, expect, it } from 'vitest';
import {
  buildExecutionReviewChecklist,
  checklistItemCanProveWorkerEvidence,
} from '../api/services/supervisor/execution-review';

describe('supervisor execution review checklist', () => {
  it('keeps provider and structured artifact sources separate from worker evidence', () => {
    const checklist = buildExecutionReviewChecklist({
      toolResults: [
        { step: 1, toolName: 'read_file', ok: true },
        { step: 2, toolName: 'run_verification', ok: false },
      ],
      artifactContextRefs: [
        { kind: 'contextstill_context_pack', refId: 'ctx-1', status: 'evidence_only' },
      ],
    });

    expect(checklist[0]).toMatchObject({
      source: 'worker_tool',
      evidenceRef: 'tool:1:read_file',
      status: 'passed',
    });
    expect(checklist[1]).toMatchObject({
      source: 'test_command',
      evidenceRef: 'tool:2:run_verification',
      status: 'failed',
    });
    expect(checklist.at(-1)).toMatchObject({
      source: 'contextstill_context_pack',
      status: 'not_checked',
    });
    expect(checklistItemCanProveWorkerEvidence(checklist[0])).toBe(true);
    expect(checklistItemCanProveWorkerEvidence(checklist[1])).toBe(true);
    expect(
      checklistItemCanProveWorkerEvidence({
        item: 'provider',
        status: 'blocked',
        source: 'provider_activity',
      })
    ).toBe(false);
  });
});
