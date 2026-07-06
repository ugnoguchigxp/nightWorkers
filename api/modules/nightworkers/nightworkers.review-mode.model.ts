import type { ReviewEvidenceRef } from '../../services/review-results/types';
import type * as reviewRepo from './nightworkers.review-mode.repository';

export type ReviewRecommendationLevel = 'none' | 'optional' | 'recommended' | 'required';
export type ReviewSectionKind =
  | 'test_coverage'
  | 'security_review'
  | 'findings'
  | 'prompt_suggestions';
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
export type ReviewPromptSuggestionStatus = 'draft' | 'used' | 'dismissed';
export type ReviewSecurityHandoffStatus = 'needs_configuration' | 'requested' | 'deferred';
export type ReviewFindingDisposition =
  | 'human_callout'
  | 'agent_followup'
  | 'prompt_suggestion'
  | 'security_plugin_handoff'
  | 'accepted_risk'
  | 'ignored';

export type ReviewRecommendationReason = {
  code:
    | 'minor_no_review_needed'
    | 'large_diff'
    | 'many_changed_files'
    | 'todo_unresolved'
    | 'security_sensitive_change'
    | 'security_plugin_missing'
    | 'schema_or_migration_change'
    | 'public_contract_change';
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
  'test_coverage',
  'security_review',
  'findings',
  'prompt_suggestions',
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

export function rowPromptSuggestion(
  row: Awaited<ReturnType<typeof reviewRepo.listReviewPromptSuggestions>>[number]
) {
  return {
    id: row.id,
    reviewSessionId: row.reviewSessionId,
    findingId: row.findingId,
    runId: row.runId,
    taskId: row.taskId,
    repositoryId: row.repositoryId,
    title: row.title,
    prompt: row.prompt,
    expectedOutcome: row.expectedOutcome,
    acceptanceCriteria: row.acceptanceCriteria,
    verificationHint: row.verificationHint,
    evidenceRefs: Array.isArray(row.evidenceRefsJson)
      ? (row.evidenceRefsJson as ReviewEvidenceRef[])
      : [],
    status: row.status as ReviewPromptSuggestionStatus,
    useCount: row.useCount,
    lastUsedAt: iso(row.lastUsedAt),
    dismissedAt: iso(row.dismissedAt),
    createdMessageId: row.createdMessageId,
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
      'test_coverage',
      recommendation.level === 'none' ? 'omitted' : 'required',
      recommendation.level === 'none'
        ? 'No acceptance criteria test-name check is needed.'
        : 'Compare implementation-plan acceptance criteria with describe/it/test names.'
    ),
    section(
      'security_review',
      blockingCodes.has('security_sensitive_change') ||
        blockingCodes.has('security_plugin_missing') ||
        blockingCodes.has('schema_or_migration_change') ||
        blockingCodes.has('public_contract_change')
        ? 'required'
        : 'omitted',
      recommendation.reasons.some(
        (reason) =>
          reason.code === 'security_sensitive_change' ||
          reason.code === 'schema_or_migration_change' ||
          reason.code === 'public_contract_change'
      )
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
      'prompt_suggestions',
      recommendation.level === 'none' ? 'omitted' : 'optional',
      'Create additional prompts when findings should be handled by continuing this session.'
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
