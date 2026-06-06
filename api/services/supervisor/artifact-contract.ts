import { createHash } from 'node:crypto';

export type SupervisorArtifactContextRef = {
  kind:
    | 'blueprint'
    | 'blueprint_db_design'
    | 'design_questionnaire'
    | 'design_decision_review'
    | 'contextstill_context_pack'
    | 'worker_evidence'
    | 'model_text';
  refId: string;
  status: 'draft' | 'adopted' | 'published' | 'answering' | 'needs_edit' | 'evidence_only';
  digest?: string | null;
  sourceMessageId?: string | null;
  sourceRunId?: string | null;
};

export function describeArtifactContextRef(ref: SupervisorArtifactContextRef) {
  return [
    `kind=${ref.kind}`,
    `status=${ref.status}`,
    `refId=${ref.refId}`,
    ref.digest ? `digest=${ref.digest}` : null,
    ref.sourceMessageId ? `sourceMessageId=${ref.sourceMessageId}` : null,
    ref.sourceRunId ? `sourceRunId=${ref.sourceRunId}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function canProveRepositoryMutation(ref: SupervisorArtifactContextRef) {
  return ref.kind === 'worker_evidence' && ref.status === 'evidence_only';
}

export function isSpecificationEvidence(ref: SupervisorArtifactContextRef) {
  if (ref.kind === 'design_decision_review') return ref.status === 'published';
  return ref.status === 'adopted' || ref.status === 'published';
}

export function digestArtifactContextRefs(refs: SupervisorArtifactContextRef[]) {
  if (!refs.length) return null;
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(refs.map(normalizeRefForDigest)))
    .digest('hex')}`;
}

function normalizeRefForDigest(ref: SupervisorArtifactContextRef) {
  return {
    kind: ref.kind,
    refId: ref.refId,
    status: ref.status,
    digest: ref.digest ?? null,
    sourceMessageId: ref.sourceMessageId ?? null,
    sourceRunId: ref.sourceRunId ?? null,
  };
}
