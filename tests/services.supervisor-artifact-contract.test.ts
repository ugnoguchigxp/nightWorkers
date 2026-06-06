import { describe, expect, it } from 'vitest';
import {
  canProveRepositoryMutation,
  describeArtifactContextRef,
  digestArtifactContextRefs,
  isSpecificationEvidence,
  type SupervisorArtifactContextRef,
} from '../api/services/supervisor/artifact-contract';

describe('supervisor artifact contract', () => {
  it('separates artifact source refs from worker mutation evidence', () => {
    const blueprint: SupervisorArtifactContextRef = {
      kind: 'blueprint',
      refId: 'message-1',
      status: 'draft',
      sourceMessageId: 'message-1',
    };
    const decisionReview: SupervisorArtifactContextRef = {
      kind: 'design_decision_review',
      refId: 'review-1',
      status: 'published',
    };
    const workerEvidence: SupervisorArtifactContextRef = {
      kind: 'worker_evidence',
      refId: 'tool:2:apply_patch',
      status: 'evidence_only',
      sourceRunId: 'run-1',
    };

    expect(canProveRepositoryMutation(blueprint)).toBe(false);
    expect(canProveRepositoryMutation(decisionReview)).toBe(false);
    expect(canProveRepositoryMutation(workerEvidence)).toBe(true);
    expect(isSpecificationEvidence(blueprint)).toBe(false);
    expect(isSpecificationEvidence(decisionReview)).toBe(true);
    expect(describeArtifactContextRef(workerEvidence)).toContain('kind=worker_evidence');
    expect(digestArtifactContextRefs([blueprint, decisionReview])).toMatch(/^sha256:/);
  });
});
