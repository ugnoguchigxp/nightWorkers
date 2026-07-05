import type { ReviewEvidenceRef } from '../../services/review-results/types';
import type * as reviewRepo from './nightworkers.review-mode.repository';

export type ReviewRecommendationLevel = 'none' | 'optional' | 'recommended' | 'required';
export type ReviewSectionKind =
  | 'acceptance_evidence'
  | 'verification_evidence'
  | 'self_review_followups'
  | 'queue_recovery'
  | 'security_review'
  | 'findings'
  | 'proposed_goals'
  | 'knowledge_candidates';
export type ReviewSectionRequirement = 'required' | 'recommended' | 'optional' | 'omitted';
export type ReviewSectionProgress = 'not_started' | 'running' | 'done' | 'blocked' | 'needs_human';
export type ReviewSessionStatus =
  | 'not_started'
  | 'in_progress'
  | 'approved'
  | 'changes_requested'
  | 'needs_human'
  | 'cancelled';
export type ReviewFindingDispositionStatus = 'unresolved' | 'accepted' | 'converted' | 'dismissed';
export type ReviewKnowledgeCandidateStatus = 'draft' | 'sent' | 'discarded' | 'send_failed';
export type ReviewKnowledgeCandidateType = 'rule' | 'procedure' | 'failure_pattern';
export type ReviewProposedGoalStatus =
  | 'draft'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'materialized';
export type ReviewSecurityHandoffStatus = 'needs_configuration' | 'requested' | 'deferred';
export type ReviewFindingDisposition =
  | 'human_callout'
  | 'agent_followup'
  | 'proposed_goal'
  | 'security_plugin_handoff'
  | 'knowledge_candidate'
  | 'accepted_risk'
  | 'ignored';

export type ReviewRecommendationReason = {
  code:
    | 'minor_no_review_needed'
    | 'large_diff'
    | 'many_changed_files'
    | 'verification_missing'
    | 'verification_failed'
    | 'acceptance_evidence_missing'
    | 'todo_unresolved'
    | 'self_review_unresolved'
    | 'queue_recovery_present'
    | 'queue_run_status_mismatch'
    | 'security_sensitive_change'
    | 'security_plugin_missing'
    | 'schema_or_migration_change'
    | 'public_contract_change'
    | 'final_report_evidence_mismatch';
  severity: 'info' | 'warning' | 'blocking';
  label: string;
  evidenceRefs: ReviewEvidenceRef[];
};

export type SectionPlan = {
  kind: ReviewSectionKind;
  requirement: ReviewSectionRequirement;
  reason: string;
};

export const SECTION_ORDER: ReviewSectionKind[] = [
  'acceptance_evidence',
  'verification_evidence',
  'self_review_followups',
  'queue_recovery',
  'security_review',
  'findings',
  'proposed_goals',
  'knowledge_candidates',
];

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function rowRecommendation(
  row: Awaited<ReturnType<typeof reviewRepo.getReviewRecommendationByRun>>
) {
  if (!row) return null;
  return {
    version: 1 as const,
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    level: row.level as ReviewRecommendationLevel,
    defaultAction: row.defaultAction as 'skip' | 'offer_review' | 'require_review',
    reasons: Array.isArray(row.reasonsJson)
      ? (row.reasonsJson as ReviewRecommendationReason[])
      : [],
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowSession(row: Awaited<ReturnType<typeof reviewRepo.getReviewSession>>) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    status: row.status as ReviewSessionStatus,
    recommendationId: row.recommendationId,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    finalAction: row.finalAction,
    finalNote: row.finalNote,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowArtifact(
  row: Awaited<ReturnType<typeof reviewRepo.listReviewArtifacts>>[number]
) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    runId: row.runId,
    taskId: row.taskId,
    kind: row.kind as 'review_status' | ReviewSectionKind,
    status: row.status as ReviewSectionProgress,
    artifact: row.artifactJson,
    sourceEvidenceRefs: Array.isArray(row.sourceEvidenceRefsJson)
      ? (row.sourceEvidenceRefsJson as ReviewEvidenceRef[])
      : [],
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowFinding(row: Awaited<ReturnType<typeof reviewRepo.listReviewFindings>>[number]) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    runId: row.runId,
    taskId: row.taskId,
    severity: row.severity as 'info' | 'warning' | 'blocking',
    title: row.title,
    body: row.body,
    disposition: row.disposition as ReviewFindingDisposition | null,
    dispositionStatus: row.dispositionStatus as ReviewFindingDispositionStatus,
    dispositionNote: row.dispositionNote,
    evidenceRefs: Array.isArray(row.evidenceRefsJson)
      ? (row.evidenceRefsJson as ReviewEvidenceRef[])
      : [],
    createdGoalId: row.createdGoalId,
    createdTaskProposalId: row.createdTaskProposalId,
    contextStillCandidateId: row.contextStillCandidateId,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowKnowledgeCandidate(
  row: Awaited<ReturnType<typeof reviewRepo.listReviewKnowledgeCandidates>>[number]
) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    findingId: row.findingId,
    candidateType: row.candidateType as ReviewKnowledgeCandidateType,
    title: row.title,
    body: row.body,
    avoid: row.avoid,
    prefer: row.prefer,
    status: row.status as ReviewKnowledgeCandidateStatus,
    contextStillCandidateId: row.contextStillCandidateId,
    sendError: row.sendError,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowProposedGoal(
  row: Awaited<ReturnType<typeof reviewRepo.listReviewProposedGoals>>[number]
) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    findingId: row.findingId,
    runId: row.runId,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    title: row.title,
    expectedOutcome: row.expectedOutcome,
    acceptanceCriteria: row.acceptanceCriteria,
    verificationGate: row.verificationGate,
    evidenceRefs: Array.isArray(row.evidenceRefsJson)
      ? (row.evidenceRefsJson as ReviewEvidenceRef[])
      : [],
    status: row.status as ReviewProposedGoalStatus,
    decisionNote: row.decisionNote,
    materializedTaskId: row.materializedTaskId,
    materializationTarget: row.materializationTarget,
    materializationError: row.materializationError,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function rowSecurityHandoff(
  row: Awaited<ReturnType<typeof reviewRepo.listReviewSecurityHandoffs>>[number]
) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    findingId: row.findingId,
    runId: row.runId,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    title: row.title,
    summary: row.summary,
    requestedIntegration: row.requestedIntegration,
    status: row.status as ReviewSecurityHandoffStatus,
    changedPaths: Array.isArray(row.changedPathsJson) ? row.changedPathsJson : [],
    evidenceRefs: Array.isArray(row.evidenceRefsJson)
      ? (row.evidenceRefsJson as ReviewEvidenceRef[])
      : [],
    handoffArtifact: row.handoffArtifactJson ?? null,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

export function planSections(
  recommendation: NonNullable<ReturnType<typeof rowRecommendation>>
): SectionPlan[] {
  const codes = new Set(recommendation.reasons.map((reason) => reason.code));
  const blockingCodes = new Set(
    recommendation.reasons
      .filter((reason) => reason.severity === 'blocking')
      .map((reason) => reason.code)
  );
  const section = (
    kind: ReviewSectionKind,
    requirement: ReviewSectionRequirement,
    reason: string
  ): SectionPlan => ({ kind, requirement, reason });
  return [
    section(
      'acceptance_evidence',
      blockingCodes.has('acceptance_evidence_missing') ||
        blockingCodes.has('final_report_evidence_mismatch')
        ? 'required'
        : recommendation.level === 'none'
          ? 'omitted'
          : 'recommended',
      recommendation.level === 'none'
        ? 'No acceptance review signal was detected.'
        : 'Check final report claims against run evidence.'
    ),
    section(
      'verification_evidence',
      blockingCodes.has('verification_missing') || blockingCodes.has('verification_failed')
        ? 'required'
        : recommendation.level === 'none'
          ? 'omitted'
          : 'recommended',
      codes.has('verification_missing') || codes.has('verification_failed')
        ? 'Verification evidence is missing or failed.'
        : 'Verification evidence can be inspected before acceptance.'
    ),
    section(
      'self_review_followups',
      codes.has('self_review_unresolved') ? 'recommended' : 'omitted',
      codes.has('self_review_unresolved')
        ? 'Self-review follow-up evidence is present.'
        : 'No unresolved self-review follow-up signal was detected.'
    ),
    section(
      'queue_recovery',
      blockingCodes.has('queue_run_status_mismatch')
        ? 'required'
        : codes.has('queue_recovery_present')
          ? 'recommended'
          : 'omitted',
      codes.has('queue_recovery_present') || codes.has('queue_run_status_mismatch')
        ? 'Queue recovery or status mismatch evidence should be checked.'
        : 'No queue recovery signal was detected.'
    ),
    section(
      'security_review',
      blockingCodes.has('security_sensitive_change') ||
        blockingCodes.has('security_plugin_missing') ||
        blockingCodes.has('schema_or_migration_change') ||
        blockingCodes.has('public_contract_change')
        ? 'required'
        : 'omitted',
      codes.has('security_sensitive_change') ||
        codes.has('schema_or_migration_change') ||
        codes.has('public_contract_change')
        ? 'Sensitive, schema, or public contract paths changed.'
        : 'No security-sensitive change was detected.'
    ),
    section(
      'findings',
      recommendation.level === 'required'
        ? 'required'
        : recommendation.level === 'none'
          ? 'omitted'
          : 'recommended',
      recommendation.level === 'none'
        ? 'No findings consolidation is needed.'
        : 'Consolidate section findings and route dispositions.'
    ),
    section(
      'proposed_goals',
      recommendation.level === 'none' ? 'omitted' : 'optional',
      'Create follow-up Goal candidates only when findings need follow-up work.'
    ),
    section(
      'knowledge_candidates',
      recommendation.level === 'none' ? 'omitted' : 'optional',
      'Create reusable contextStill knowledge candidates only after preview.'
    ),
  ];
}

export function countFindings(findings: Array<{ severity: string }>) {
  return {
    blocking: findings.filter((finding) => finding.severity === 'blocking').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
}
