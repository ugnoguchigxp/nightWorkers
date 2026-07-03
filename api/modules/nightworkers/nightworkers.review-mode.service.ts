import { AppError, NotFoundError } from '../../lib/errors';
import type { ReviewEvidenceRef, ReviewFinding } from '../../services/review-results/types';
import { buildReviewEvidencePackFromRun } from '../../services/review-rubrics/evidence-pack';
import type { ReviewEvidencePack } from '../../services/review-rubrics/types';
import * as repo from './nightworkers.repository';
import * as reviewRepo from './nightworkers.review-mode.repository';

type ReviewRecommendationLevel = 'none' | 'optional' | 'recommended' | 'required';
type ReviewSectionKind =
  | 'acceptance_evidence'
  | 'verification_evidence'
  | 'self_review_followups'
  | 'queue_recovery'
  | 'security_review'
  | 'findings'
  | 'proposed_goals'
  | 'knowledge_candidates';
type ReviewSectionRequirement = 'required' | 'recommended' | 'optional' | 'omitted';
type ReviewSectionProgress = 'not_started' | 'running' | 'done' | 'blocked' | 'needs_human';
type ReviewSessionStatus =
  | 'not_started'
  | 'in_progress'
  | 'approved'
  | 'changes_requested'
  | 'needs_human'
  | 'cancelled';
type ReviewFindingDispositionStatus = 'unresolved' | 'accepted' | 'converted' | 'dismissed';
type ReviewKnowledgeCandidateStatus = 'draft' | 'sent' | 'discarded' | 'send_failed';
type ReviewKnowledgeCandidateType = 'rule' | 'procedure' | 'failure_pattern';
type ReviewProposedGoalStatus = 'draft' | 'approved' | 'rejected' | 'deferred' | 'materialized';
type ReviewSecurityHandoffStatus = 'needs_configuration' | 'requested' | 'deferred';
type ReviewFindingDisposition =
  | 'human_callout'
  | 'agent_followup'
  | 'proposed_goal'
  | 'security_plugin_handoff'
  | 'knowledge_candidate'
  | 'accepted_risk'
  | 'ignored';

type ReviewRecommendationReason = {
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

type SectionPlan = {
  kind: ReviewSectionKind;
  requirement: ReviewSectionRequirement;
  reason: string;
};

const SECTION_ORDER: ReviewSectionKind[] = [
  'acceptance_evidence',
  'verification_evidence',
  'self_review_followups',
  'queue_recovery',
  'security_review',
  'findings',
  'proposed_goals',
  'knowledge_candidates',
];

const SECURITY_PATH_PATTERN =
  /(^|\/)(auth|oauth|permission|permissions|secret|secrets|security|billing|payment|payments|middleware)(\/|\.|-|$)|\b(policy|token|password|credential|csrf|jwt)\b/i;
const SCHEMA_PATH_PATTERN = /(^|\/)(drizzle|migrations?|schema|db)(\/|\.|-|$)|\.(sql)$/i;
const PUBLIC_CONTRACT_PATTERN =
  /(^|\/)(api\/routes|api\/modules|shared\/schemas|mcp|worker-tools)(\/|$)|\b(openapi|route-definitions|schema)\b/i;
const QUEUE_EVENT_PATTERN = /queue|retry|recovery|lease|requeue/i;
const SELF_REVIEW_EVENT_PATTERN = /self[-_. ]?review|review\.evaluation_finished/i;

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowRecommendation(
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

function rowSession(row: Awaited<ReturnType<typeof reviewRepo.getReviewSession>>) {
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

function rowArtifact(row: Awaited<ReturnType<typeof reviewRepo.listReviewArtifacts>>[number]) {
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

function rowFinding(row: Awaited<ReturnType<typeof reviewRepo.listReviewFindings>>[number]) {
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

function rowKnowledgeCandidate(
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

function rowProposedGoal(
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

function rowSecurityHandoff(
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

function changedFileRefs(pack: ReviewEvidencePack): ReviewEvidenceRef[] {
  return pack.diff.changedFiles.map((path) => ({ kind: 'changed_file' as const, path }));
}

function diffRef(pack: ReviewEvidencePack): ReviewEvidenceRef {
  return {
    kind: 'diff',
    runId: pack.runId,
    bytes: pack.diff.bytes,
    hasChanges: pack.diff.hasChanges,
  };
}

function verificationRefs(pack: ReviewEvidencePack): ReviewEvidenceRef[] {
  return pack.verification.map((verification) => ({
    kind: 'verification' as const,
    eventId: verification.eventId,
    passed: verification.passed,
    command: verification.command,
  }));
}

function isSecuritySensitive(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => SECURITY_PATH_PATTERN.test(file));
}

function isSchemaOrMigration(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => SCHEMA_PATH_PATTERN.test(file));
}

function isPublicContract(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => PUBLIC_CONTRACT_PATTERN.test(file));
}

function hasQueueRecovery(pack: ReviewEvidencePack) {
  return (
    pack.eventTypes.some((type) => QUEUE_EVENT_PATTERN.test(type)) ||
    pack.selectedEvents.some(
      (event) => QUEUE_EVENT_PATTERN.test(event.type) || QUEUE_EVENT_PATTERN.test(event.message)
    )
  );
}

function hasSelfReviewUnresolved(pack: ReviewEvidencePack) {
  return pack.selectedEvents.some(
    (event) =>
      SELF_REVIEW_EVENT_PATTERN.test(event.type) &&
      /warning|follow.?up|unresolved|changes_requested|blocking/i.test(event.message)
  );
}

function includesEvidencePhrase(report: string | undefined, pattern: RegExp) {
  return Boolean(report && pattern.test(report));
}

function buildRecommendationFromEvidence(input: {
  runId: string;
  taskId: string;
  repositoryId: string;
  pack: ReviewEvidencePack;
  openTodoCount: number;
}): {
  level: ReviewRecommendationLevel;
  defaultAction: 'skip' | 'offer_review' | 'require_review';
  reasons: ReviewRecommendationReason[];
} {
  const { pack } = input;
  const reasons: ReviewRecommendationReason[] = [];
  const addReason = (reason: ReviewRecommendationReason) => reasons.push(reason);

  if (pack.diff.bytes > 20_000) {
    addReason({
      code: 'large_diff',
      severity: 'warning',
      label: 'Large diff should be reviewed before acceptance.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.diff.changedFiles.length >= 8) {
    addReason({
      code: 'many_changed_files',
      severity: 'warning',
      label: 'Many changed files increase review risk.',
      evidenceRefs: changedFileRefs(pack),
    });
  }
  if (pack.diff.hasChanges && pack.verification.length === 0) {
    addReason({
      code: 'verification_missing',
      severity: 'blocking',
      label: 'Changed run has no completed verification evidence.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.verification.some((verification) => verification.passed === false)) {
    addReason({
      code: 'verification_failed',
      severity: 'blocking',
      label: 'A verification command failed.',
      evidenceRefs: verificationRefs(pack),
    });
  }
  if (pack.diff.hasChanges && !pack.finalReport?.trim()) {
    addReason({
      code: 'acceptance_evidence_missing',
      severity: 'blocking',
      label: 'Final report is missing, so acceptance evidence cannot be checked.',
      evidenceRefs: [{ kind: 'final_report', runId: input.runId }],
    });
  }
  if (input.openTodoCount > 0) {
    addReason({
      code: 'todo_unresolved',
      severity: 'blocking',
      label: 'Run still has unresolved Todo items.',
      evidenceRefs: [],
    });
  }
  if (hasSelfReviewUnresolved(pack)) {
    addReason({
      code: 'self_review_unresolved',
      severity: 'warning',
      label: 'Self-review follow-up evidence is still unresolved.',
      evidenceRefs: [],
    });
  }
  if (hasQueueRecovery(pack)) {
    addReason({
      code: 'queue_recovery_present',
      severity: 'warning',
      label: 'Queue retry or recovery evidence is present.',
      evidenceRefs: [],
    });
  }
  if (pack.outcome?.status && pack.outcome.status !== pack.status) {
    addReason({
      code: 'queue_run_status_mismatch',
      severity: 'blocking',
      label: 'Run row status and outcome evidence disagree.',
      evidenceRefs: [],
    });
  }
  if (isSecuritySensitive(pack)) {
    addReason({
      code: 'security_sensitive_change',
      severity: 'blocking',
      label: 'Security-sensitive paths changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? SECURITY_PATH_PATTERN.test(ref.path) : false
      ),
    });
    addReason({
      code: 'security_plugin_missing',
      severity: 'blocking',
      label: 'No external security plugin evidence is linked for the sensitive change.',
      evidenceRefs: [],
    });
  }
  if (isSchemaOrMigration(pack)) {
    addReason({
      code: 'schema_or_migration_change',
      severity: 'blocking',
      label: 'Schema or migration paths changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? SCHEMA_PATH_PATTERN.test(ref.path) : false
      ),
    });
  }
  if (isPublicContract(pack)) {
    addReason({
      code: 'public_contract_change',
      severity: 'blocking',
      label: 'Public API, schema, MCP, or worker-tool contract changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? PUBLIC_CONTRACT_PATTERN.test(ref.path) : false
      ),
    });
  }
  if (
    pack.finalReport &&
    /pass|passed|成功|通過/i.test(pack.finalReport) &&
    pack.verification.length === 0 &&
    pack.diff.hasChanges
  ) {
    addReason({
      code: 'final_report_evidence_mismatch',
      severity: 'blocking',
      label: 'Final report claims verification success without verification evidence.',
      evidenceRefs: [{ kind: 'final_report', runId: input.runId }],
    });
  }

  if (reasons.length === 0) {
    if (!pack.diff.hasChanges || pack.diff.bytes === 0) {
      addReason({
        code: 'minor_no_review_needed',
        severity: 'info',
        label: 'No risky run evidence was detected.',
        evidenceRefs: [],
      });
      return { level: 'none', defaultAction: 'skip', reasons };
    }
    addReason({
      code: 'minor_no_review_needed',
      severity: 'info',
      label: 'Focused change has verification and no blocking review signal.',
      evidenceRefs: [diffRef(pack), ...verificationRefs(pack)],
    });
    return { level: 'optional', defaultAction: 'offer_review', reasons };
  }

  const level: ReviewRecommendationLevel = reasons.some((reason) => reason.severity === 'blocking')
    ? 'required'
    : 'recommended';
  return {
    level,
    defaultAction: level === 'required' ? 'require_review' : 'offer_review',
    reasons,
  };
}

async function buildPackForRun(runId: string) {
  const run = await repo.getTaskRun(runId);
  if (!run) throw new NotFoundError('Run not found');
  const events = await repo.listTaskEventsForRun(runId);
  const todos = await repo.listTaskRunTodosForRun(runId);
  const pack = buildReviewEvidencePackFromRun(run, events);
  return { run, events, todos, pack };
}

export async function getOrCreateReviewRecommendation(runId: string) {
  const existing = await reviewRepo.getReviewRecommendationByRun(runId);
  if (existing) return rowRecommendation(existing);
  const { run, todos, pack } = await buildPackForRun(runId);
  const task = await repo.getTask(run.taskId);
  const repositoryId = run.repositoryId || task?.repositoryId;
  if (!repositoryId) throw new NotFoundError('Repository not found for run');
  const openTodoCount = todos.filter((todo) => ['pending', 'running'].includes(todo.status)).length;
  const recommendation = buildRecommendationFromEvidence({
    runId,
    taskId: run.taskId,
    repositoryId,
    pack,
    openTodoCount,
  });
  const row = await reviewRepo.upsertReviewRecommendation({
    runId,
    taskId: run.taskId,
    repositoryId,
    level: recommendation.level,
    defaultAction: recommendation.defaultAction,
    reasonsJson: recommendation.reasons,
  });
  return rowRecommendation(row);
}

function planSections(
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

function countFindings(findings: Array<{ severity: string }>) {
  return {
    blocking: findings.filter((finding) => finding.severity === 'blocking').length,
    warning: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
}

async function buildStatusArtifact(reviewSessionId: string) {
  const sessionRow = await reviewRepo.getReviewSession(reviewSessionId);
  if (!sessionRow) throw new NotFoundError('Review session not found');
  const recommendationRow =
    sessionRow.recommendationId &&
    (await reviewRepo.getReviewRecommendationByRun(sessionRow.runId));
  const recommendation = rowRecommendation(
    recommendationRow || (await reviewRepo.getReviewRecommendationByRun(sessionRow.runId))
  );
  if (!recommendation) throw new NotFoundError('Review recommendation not found');
  const artifacts = await reviewRepo.listReviewArtifacts(reviewSessionId);
  const findings = await reviewRepo.listReviewFindings(reviewSessionId);
  const knowledgeCandidates = await reviewRepo.listReviewKnowledgeCandidates(reviewSessionId);
  const proposedGoals = await reviewRepo.listReviewProposedGoals(reviewSessionId);
  const securityHandoffs = await reviewRepo.listReviewSecurityHandoffs(reviewSessionId);
  const artifactByKind = new Map(artifacts.map((artifact) => [artifact.kind, artifact]));
  const findingsBySection = new Map<string, typeof findings>();
  for (const finding of findings) {
    const source = finding.sourceSection || 'findings';
    findingsBySection.set(source, [...(findingsBySection.get(source) || []), finding]);
  }
  const sectionPlans = planSections(recommendation);
  const sections = sectionPlans.map((plan) => {
    const artifact = artifactByKind.get(plan.kind);
    const sourceFindings = findingsBySection.get(plan.kind) || [];
    return {
      kind: plan.kind,
      requirement: plan.requirement,
      progress:
        plan.requirement === 'omitted'
          ? ('done' as const)
          : ((artifact?.status as ReviewSectionProgress | undefined) ?? 'not_started'),
      reason: plan.reason,
      artifactId: artifact?.id ?? null,
      findingCounts: countFindings(sourceFindings),
    };
  });
  const unresolvedBlocking = findings.filter(
    (finding) =>
      finding.severity === 'blocking' &&
      !['accepted', 'converted', 'dismissed'].includes(finding.dispositionStatus)
  );
  const requiredRemaining = sections
    .filter((section) => section.requirement === 'required' && section.progress !== 'done')
    .map((section) => section.kind);
  const blockingReason =
    requiredRemaining.length > 0
      ? 'Required review sections are not complete.'
      : unresolvedBlocking.length > 0
        ? 'Unresolved blocking findings remain.'
        : null;
  const statusArtifact = {
    version: 1 as const,
    reviewSessionId,
    runId: sessionRow.runId,
    taskId: sessionRow.taskId,
    recommendation,
    sections,
    finalActionGate: {
      canApprove: !blockingReason,
      blockingReason,
      unresolvedBlockingFindingIds: unresolvedBlocking.map((finding) => finding.id),
      requiredSectionKindsRemaining: requiredRemaining,
    },
    proposedGoalCount: proposedGoals.length,
    knowledgeCandidateCount: knowledgeCandidates.length,
    securityHandoffCount: securityHandoffs.length,
  };
  await reviewRepo.upsertReviewArtifact({
    reviewSessionId,
    runId: sessionRow.runId,
    taskId: sessionRow.taskId,
    kind: 'review_status',
    status: 'done',
    artifactJson: statusArtifact,
    sourceEvidenceRefsJson: recommendation.reasons.flatMap((reason) => reason.evidenceRefs),
  });
  return statusArtifact;
}

export async function startReviewSessionForRun(runId: string) {
  const recommendation = await getOrCreateReviewRecommendation(runId);
  if (!recommendation) throw new NotFoundError('Review recommendation not found');
  const session = await reviewRepo.createOrStartReviewSession({
    runId,
    taskId: recommendation.taskId,
    repositoryId: recommendation.repositoryId,
    recommendationId: recommendation.id,
  });
  await buildStatusArtifact(session.id);
  return getReviewSessionDetail(session.id);
}

export async function getLatestReviewSessionDetailForTask(taskId: string) {
  const session = await reviewRepo.getLatestReviewSessionForTask(taskId);
  if (!session) return null;
  return getReviewSessionDetail(session.id);
}

export async function getReviewSessionDetail(reviewSessionId: string) {
  await buildStatusArtifact(reviewSessionId);
  const sessionRow = await reviewRepo.getReviewSession(reviewSessionId);
  if (!sessionRow) throw new NotFoundError('Review session not found');
  const recommendation = rowRecommendation(
    await reviewRepo.getReviewRecommendationByRun(sessionRow.runId)
  );
  if (!recommendation) throw new NotFoundError('Review recommendation not found');
  const artifacts = await reviewRepo.listReviewArtifacts(reviewSessionId);
  const findings = await reviewRepo.listReviewFindings(reviewSessionId);
  const knowledgeCandidates = await reviewRepo.listReviewKnowledgeCandidates(reviewSessionId);
  const proposedGoals = await reviewRepo.listReviewProposedGoals(reviewSessionId);
  const securityHandoffs = await reviewRepo.listReviewSecurityHandoffs(reviewSessionId);
  const statusArtifact = artifacts.find((artifact) => artifact.kind === 'review_status')
    ?.artifactJson as Awaited<ReturnType<typeof buildStatusArtifact>>;
  const session = rowSession(sessionRow);
  if (!session) throw new NotFoundError('Review session not found');
  return {
    session,
    recommendation,
    statusArtifact,
    artifacts: artifacts.map(rowArtifact),
    findings: findings.map(rowFinding),
    knowledgeCandidates: knowledgeCandidates.map(rowKnowledgeCandidate),
    proposedGoals: proposedGoals.map(rowProposedGoal),
    securityHandoffs: securityHandoffs.map(rowSecurityHandoff),
  };
}

function sectionFindings(kind: ReviewSectionKind, pack: ReviewEvidencePack): ReviewFinding[] {
  if (kind === 'acceptance_evidence') {
    const findings: ReviewFinding[] = [];
    if (!pack.finalReport?.trim()) {
      findings.push({
        severity: 'blocking',
        title: 'Final report is missing',
        body: 'Review acceptance cannot be completed without a final report or equivalent closeout evidence.',
        evidenceRefs: [{ kind: 'final_report', runId: pack.runId }],
      });
    }
    if (
      pack.finalReport &&
      /pass|passed|成功|通過/i.test(pack.finalReport) &&
      pack.verification.length === 0 &&
      pack.diff.hasChanges
    ) {
      findings.push({
        severity: 'blocking',
        title: 'Final report claims verification without evidence',
        body: 'The final report claims a passing verification state, but no verification.finished evidence is present.',
        evidenceRefs: [{ kind: 'final_report', runId: pack.runId }],
      });
    }
    return findings;
  }
  if (kind === 'verification_evidence') {
    if (pack.diff.hasChanges && pack.verification.length === 0) {
      return [
        {
          severity: 'blocking',
          title: 'Verification evidence is missing',
          body: 'The run changed files but has no completed verification result.',
          evidenceRefs: [diffRef(pack)],
        },
      ];
    }
    return pack.verification
      .filter((verification) => verification.passed === false)
      .map((verification) => ({
        severity: 'blocking' as const,
        title: 'Verification failed',
        body: verification.summary || verification.command || 'A verification result failed.',
        evidenceRefs: [
          {
            kind: 'verification' as const,
            eventId: verification.eventId,
            command: verification.command,
            passed: verification.passed,
          },
        ],
      }));
  }
  if (kind === 'self_review_followups') {
    return hasSelfReviewUnresolved(pack)
      ? [
          {
            severity: 'warning',
            title: 'Self-review follow-up may be unresolved',
            body: 'Self-review event text indicates an unresolved warning or follow-up.',
            evidenceRefs: [],
          },
        ]
      : [];
  }
  if (kind === 'queue_recovery') {
    const findings: ReviewFinding[] = [];
    if (pack.outcome?.status && pack.outcome.status !== pack.status) {
      findings.push({
        severity: 'blocking',
        title: 'Run outcome and persisted status mismatch',
        body: `Run row status is ${pack.status}, while outcome evidence says ${pack.outcome.status}.`,
        evidenceRefs: [],
      });
    }
    if (
      hasQueueRecovery(pack) &&
      !includesEvidencePhrase(pack.finalReport, /queue|retry|recovery|lease|再試行|復旧/i)
    ) {
      findings.push({
        severity: 'warning',
        title: 'Queue recovery is not explained in final report',
        body: 'Queue retry or recovery evidence appears in events, but the final report does not mention it.',
        evidenceRefs: [],
      });
    }
    return findings;
  }
  if (kind === 'security_review') {
    const findings: ReviewFinding[] = [];
    if (isSecuritySensitive(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Security-sensitive change needs external evidence',
        body: 'Security-sensitive paths changed and no external security plugin evidence is linked.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? SECURITY_PATH_PATTERN.test(ref.path) : false
        ),
      });
    }
    if (isSchemaOrMigration(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Schema or migration change requires review',
        body: 'Schema or migration paths changed. Migration/apply verification evidence should be checked before acceptance.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? SCHEMA_PATH_PATTERN.test(ref.path) : false
        ),
      });
    }
    if (isPublicContract(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Public contract change requires review',
        body: 'Public API, schema, MCP, or worker-tool contract paths changed.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? PUBLIC_CONTRACT_PATTERN.test(ref.path) : false
        ),
      });
    }
    return findings;
  }
  return [];
}

export async function runReviewSection(reviewSessionId: string, sectionKind: ReviewSectionKind) {
  if (!SECTION_ORDER.includes(sectionKind))
    throw new AppError(400, 'INVALID_SECTION', 'Invalid review section');
  const session = await reviewRepo.getReviewSession(reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const { pack } = await buildPackForRun(session.runId);
  const recommendation = await getOrCreateReviewRecommendation(session.runId);
  if (!recommendation) throw new NotFoundError('Review recommendation not found');
  const planned = planSections(recommendation).find((section) => section.kind === sectionKind);
  if (!planned) throw new AppError(400, 'INVALID_SECTION', 'Invalid review section');
  const findings =
    sectionKind === 'findings'
      ? (await reviewRepo.listReviewFindings(reviewSessionId)).map((finding) => ({
          severity: finding.severity as ReviewFinding['severity'],
          title: finding.title,
          body: finding.body ?? undefined,
          evidenceRefs: Array.isArray(finding.evidenceRefsJson)
            ? (finding.evidenceRefsJson as ReviewEvidenceRef[])
            : [],
        }))
      : sectionKind === 'proposed_goals' || sectionKind === 'knowledge_candidates'
        ? []
        : sectionFindings(sectionKind, pack);
  if (!['findings', 'proposed_goals', 'knowledge_candidates'].includes(sectionKind)) {
    await reviewRepo.createReviewFindings(
      findings.map((finding) => ({
        reviewSessionId,
        runId: session.runId,
        taskId: session.taskId,
        severity: finding.severity,
        title: finding.title,
        body: finding.body ?? null,
        evidenceRefsJson: finding.evidenceRefs ?? [],
        sourceSection: sectionKind,
      }))
    );
  }
  const artifact = {
    version: 1,
    kind: sectionKind,
    requirement: planned.requirement,
    summary:
      findings.length === 0
        ? 'No findings were produced by deterministic review.'
        : `${findings.length} deterministic finding${findings.length === 1 ? '' : 's'} produced.`,
    evidence: {
      diff: pack.diff,
      verification: pack.verification,
      selectedEvents: pack.selectedEvents,
      finalReportPresent: Boolean(pack.finalReport?.trim()),
    },
    findings,
    recommendedActions: findings.map((finding) =>
      finding.severity === 'blocking'
        ? 'Resolve, convert to follow-up, or accept risk with note.'
        : 'Review and route disposition if needed.'
    ),
  };
  await reviewRepo.upsertReviewArtifact({
    reviewSessionId,
    runId: session.runId,
    taskId: session.taskId,
    kind: sectionKind,
    status: 'done',
    artifactJson: artifact,
    sourceEvidenceRefsJson: findings.flatMap((finding) => finding.evidenceRefs ?? []),
  });
  return getReviewSessionDetail(reviewSessionId);
}

export async function setReviewFindingDisposition(
  reviewSessionId: string,
  findingId: string,
  input: {
    disposition: ReviewFindingDisposition;
    note?: string;
    evidenceRefs?: ReviewEvidenceRef[];
  }
) {
  const finding = await reviewRepo.getReviewFinding(reviewSessionId, findingId);
  if (!finding) throw new NotFoundError('Review finding not found');
  if (input.disposition === 'accepted_risk') {
    if (!input.note?.trim()) {
      throw new AppError(400, 'ACCEPTED_RISK_NOTE_REQUIRED', 'Accepted risk requires a note');
    }
    const refs = input.evidenceRefs?.length ? input.evidenceRefs : finding.evidenceRefsJson;
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new AppError(
        400,
        'ACCEPTED_RISK_EVIDENCE_REQUIRED',
        'Accepted risk requires evidence refs'
      );
    }
  }
  const status =
    input.disposition === 'accepted_risk'
      ? 'accepted'
      : input.disposition === 'ignored'
        ? 'dismissed'
        : [
              'agent_followup',
              'proposed_goal',
              'security_plugin_handoff',
              'knowledge_candidate',
            ].includes(input.disposition)
          ? 'converted'
          : 'accepted';
  if (input.disposition === 'proposed_goal') {
    const proposedGoal = await ensureReviewProposedGoal(finding, input.evidenceRefs);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: input.disposition,
      dispositionStatus: status,
      dispositionNote: input.note?.trim() || null,
      evidenceRefsJson: input.evidenceRefs?.length ? input.evidenceRefs : undefined,
      createdGoalId: proposedGoal.id,
    });
    return getReviewSessionDetail(reviewSessionId);
  }
  if (input.disposition === 'security_plugin_handoff') {
    await ensureReviewSecurityHandoff(finding, input.evidenceRefs);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: input.disposition,
      dispositionStatus: status,
      dispositionNote: input.note?.trim() || null,
      evidenceRefsJson: input.evidenceRefs?.length ? input.evidenceRefs : undefined,
    });
    return getReviewSessionDetail(reviewSessionId);
  }
  if (input.disposition === 'knowledge_candidate') {
    const candidate = await ensureReviewKnowledgeCandidate(finding);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: input.disposition,
      dispositionStatus: status,
      dispositionNote: input.note?.trim() || null,
      evidenceRefsJson: input.evidenceRefs?.length ? input.evidenceRefs : undefined,
      contextStillCandidateId: candidate.id,
    });
    return getReviewSessionDetail(reviewSessionId);
  }
  await reviewRepo.updateReviewFindingDisposition(findingId, {
    disposition: input.disposition,
    dispositionStatus: status,
    dispositionNote: input.note?.trim() || null,
    evidenceRefsJson: input.evidenceRefs?.length ? input.evidenceRefs : undefined,
  });
  return getReviewSessionDetail(reviewSessionId);
}

function findingEvidenceRefs(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>
) {
  return Array.isArray(finding.evidenceRefsJson)
    ? (finding.evidenceRefsJson as ReviewEvidenceRef[])
    : [];
}

async function ensureReviewProposedGoal(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
  evidenceRefsOverride?: ReviewEvidenceRef[]
) {
  const evidenceRefs = evidenceRefsOverride?.length
    ? evidenceRefsOverride
    : findingEvidenceRefs(finding);
  if (evidenceRefs.length === 0) {
    throw new AppError(
      400,
      'REVIEW_PROPOSED_GOAL_EVIDENCE_REQUIRED',
      'Review proposed Goals require evidence refs'
    );
  }
  const session = await reviewRepo.getReviewSession(finding.reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const existing = await reviewRepo.getReviewProposedGoalByFinding(finding.id);
  const created = await reviewRepo.createReviewProposedGoal({
    reviewSessionId: finding.reviewSessionId,
    findingId: finding.id,
    runId: finding.runId,
    taskId: finding.taskId,
    repositoryId: session.repositoryId,
    title: `Follow-up: ${finding.title}`,
    expectedOutcome: finding.body || finding.title,
    acceptanceCriteria: 'The cited review finding is resolved or explicitly re-routed.',
    verificationGate: 'Run the focused verification relevant to the finding.',
    evidenceRefsJson: evidenceRefs,
  });
  return existing ?? created;
}

function changedPathsFromEvidence(evidenceRefs: ReviewEvidenceRef[]) {
  return evidenceRefs
    .filter(
      (ref): ref is Extract<ReviewEvidenceRef, { kind: 'changed_file' }> =>
        ref.kind === 'changed_file'
    )
    .map((ref) => ref.path);
}

async function ensureReviewSecurityHandoff(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
  evidenceRefsOverride?: ReviewEvidenceRef[]
) {
  const session = await reviewRepo.getReviewSession(finding.reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const evidenceRefs = evidenceRefsOverride?.length
    ? evidenceRefsOverride
    : findingEvidenceRefs(finding);
  const changedPaths = changedPathsFromEvidence(evidenceRefs);
  const requestedIntegration = process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION?.trim() || null;
  const handoffArtifact = {
    version: 1,
    kind: 'security_handoff',
    findingId: finding.id,
    title: `Security handoff: ${finding.title}`,
    summary: finding.body || finding.title,
    requestedIntegration,
    status: requestedIntegration ? 'requested' : 'needs_configuration',
    changedPaths,
    evidenceRefs,
  };
  const handoff = await reviewRepo.createReviewSecurityHandoff({
    reviewSessionId: finding.reviewSessionId,
    findingId: finding.id,
    runId: finding.runId,
    taskId: finding.taskId,
    repositoryId: session.repositoryId,
    title: handoffArtifact.title,
    summary: handoffArtifact.summary,
    requestedIntegration,
    status: handoffArtifact.status,
    changedPathsJson: changedPaths,
    evidenceRefsJson: evidenceRefs,
    handoffArtifactJson: handoffArtifact,
  });
  await reviewRepo.upsertReviewArtifact({
    reviewSessionId: finding.reviewSessionId,
    runId: finding.runId,
    taskId: finding.taskId,
    kind: 'security_handoff',
    status: requestedIntegration ? 'done' : 'needs_human',
    artifactJson: handoffArtifact,
    sourceEvidenceRefsJson: evidenceRefs,
  });
  return handoff;
}

export async function createReviewProposedGoals(reviewSessionId: string) {
  const findings = await reviewRepo.listReviewFindings(reviewSessionId);
  const targetFindings = findings.filter(
    (finding) =>
      finding.disposition === 'proposed_goal' &&
      finding.dispositionStatus === 'converted' &&
      !finding.createdGoalId &&
      Array.isArray(finding.evidenceRefsJson) &&
      finding.evidenceRefsJson.length > 0
  );
  for (const finding of targetFindings) {
    const proposedGoal = await ensureReviewProposedGoal(finding);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: 'proposed_goal',
      dispositionStatus: 'converted',
      createdGoalId: proposedGoal.id,
    });
  }
  const proposedGoals = await reviewRepo.listReviewProposedGoals(reviewSessionId);
  const session = await reviewRepo.getReviewSession(reviewSessionId);
  if (session) {
    await reviewRepo.upsertReviewArtifact({
      reviewSessionId,
      runId: session.runId,
      taskId: session.taskId,
      kind: 'proposed_goals',
      status: 'done',
      artifactJson: { version: 1, proposedGoals: proposedGoals.map(rowProposedGoal) },
      sourceEvidenceRefsJson: proposedGoals.flatMap((goal) =>
        Array.isArray(goal.evidenceRefsJson) ? goal.evidenceRefsJson : []
      ),
    });
  }
  return getReviewSessionDetail(reviewSessionId);
}

export async function updateReviewProposedGoalDecision(
  reviewSessionId: string,
  goalId: string,
  input: { status: 'approved' | 'rejected' | 'deferred'; note?: string }
) {
  const goal = await reviewRepo.getReviewProposedGoal(reviewSessionId, goalId);
  if (!goal) throw new NotFoundError('Review proposed Goal not found');
  if (goal.status === 'materialized') {
    throw new AppError(
      400,
      'REVIEW_PROPOSED_GOAL_ALREADY_MATERIALIZED',
      'Materialized review proposed Goals cannot be re-decided'
    );
  }
  await reviewRepo.updateReviewProposedGoal(goal.id, {
    status: input.status,
    decisionNote: input.note?.trim() || null,
    materializationError: null,
  });
  await refreshProposedGoalsArtifact(reviewSessionId);
  return getReviewSessionDetail(reviewSessionId);
}

async function refreshProposedGoalsArtifact(reviewSessionId: string) {
  const session = await reviewRepo.getReviewSession(reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const proposedGoals = await reviewRepo.listReviewProposedGoals(reviewSessionId);
  await reviewRepo.upsertReviewArtifact({
    reviewSessionId,
    runId: session.runId,
    taskId: session.taskId,
    kind: 'proposed_goals',
    status: 'done',
    artifactJson: { version: 1, proposedGoals: proposedGoals.map(rowProposedGoal) },
    sourceEvidenceRefsJson: proposedGoals.flatMap((goal) =>
      Array.isArray(goal.evidenceRefsJson) ? goal.evidenceRefsJson : []
    ),
  });
}

export async function materializeReviewProposedGoal(
  reviewSessionId: string,
  goalId: string,
  input: { target?: 'task' } = { target: 'task' }
) {
  const goal = await reviewRepo.getReviewProposedGoal(reviewSessionId, goalId);
  if (!goal) throw new NotFoundError('Review proposed Goal not found');
  if (input.target && input.target !== 'task') {
    throw new AppError(
      400,
      'REVIEW_PROPOSED_GOAL_TARGET_UNSUPPORTED',
      'Review proposed Goals can currently materialize only to draft Tasks'
    );
  }
  if (goal.status !== 'approved') {
    throw new AppError(
      400,
      'REVIEW_PROPOSED_GOAL_APPROVAL_REQUIRED',
      'Review proposed Goals must be approved before materialization'
    );
  }
  if (goal.materializedTaskId) return getReviewSessionDetail(reviewSessionId);
  const task = await repo.createTask({
    repositoryId: goal.repositoryId,
    title: goal.title,
    description: goal.expectedOutcome,
    objective: goal.expectedOutcome,
    acceptanceCriteria: goal.acceptanceCriteria,
    status: 'draft',
    createdBy: 'review-mode',
  });
  await repo.createTaskMessage({
    taskId: task.id,
    role: 'user',
    content: [
      goal.expectedOutcome,
      '',
      `Verification: ${goal.verificationGate}`,
      '',
      `Source Review Session: ${goal.reviewSessionId}`,
      `Source Finding: ${goal.findingId}`,
    ].join('\n'),
    messageType: 'review_proposed_goal',
    payloadJson: {
      source: 'review_proposed_goal',
      reviewSessionId: goal.reviewSessionId,
      findingId: goal.findingId,
      proposedGoalId: goal.id,
      evidenceRefs: goal.evidenceRefsJson,
    },
  });
  await reviewRepo.updateReviewProposedGoal(goal.id, {
    status: 'materialized',
    materializedTaskId: task.id,
    materializationTarget: 'task',
    materializationError: null,
  });
  await refreshProposedGoalsArtifact(reviewSessionId);
  return getReviewSessionDetail(reviewSessionId);
}

function defaultCandidateBody(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
  type: string
) {
  if (type === 'procedure') {
    return [
      'Use when:',
      `- ${finding.title}`,
      '',
      'Workflow:',
      '- Confirm the finding still applies using current runtime evidence.',
      '- Route the work to a follow-up task instead of mutating completed execution status.',
      '',
      'Verification:',
      '- Re-run the focused verification that proves the finding is resolved.',
      '',
      'Avoid:',
      '- Do not mark the original run incomplete only to represent review follow-up work.',
    ].join('\n');
  }
  return [
    finding.body || finding.title,
    '',
    'Generalized from Review Mode evidence. Keep the rule reusable and avoid file-specific wording before sending.',
  ].join('\n');
}

async function ensureReviewKnowledgeCandidate(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>
) {
  const existing = await reviewRepo.getReviewKnowledgeCandidateByFinding(finding.id);
  if (existing && existing.status !== 'discarded') return existing;
  const candidateType: ReviewKnowledgeCandidateType = 'rule';
  return reviewRepo.createReviewKnowledgeCandidate({
    reviewSessionId: finding.reviewSessionId,
    findingId: finding.id,
    candidateType,
    title: `Review rule: ${finding.title}`,
    body: defaultCandidateBody(finding, candidateType),
    avoid: null,
    prefer: null,
  });
}

function assertProcedureCandidateBody(candidateType: string, body: string) {
  if (
    candidateType === 'procedure' &&
    !['Use when:', 'Workflow:', 'Verification:', 'Avoid:'].every((heading) =>
      body.includes(heading)
    )
  ) {
    throw new AppError(
      400,
      'PROCEDURE_CANDIDATE_STRUCTURE_REQUIRED',
      'Procedure candidates require Use when / Workflow / Verification / Avoid sections'
    );
  }
}

function contextStillCandidatePayload(
  candidate: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewKnowledgeCandidate>>>
) {
  return {
    items: [
      {
        title: candidate.title,
        body: candidate.body,
        type: candidate.candidateType,
        avoid: candidate.avoid,
        prefer: candidate.prefer,
        source: 'nightworkers_review_mode',
        metadata: {
          reviewSessionId: candidate.reviewSessionId,
          findingId: candidate.findingId,
          reviewKnowledgeCandidateId: candidate.id,
        },
      },
    ],
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractContextStillCandidateId(value: unknown): string | null {
  const body = objectRecord(value);
  if (!body) return null;
  for (const key of ['candidateId', 'id', 'contextStillCandidateId']) {
    const candidateId = body[key];
    if (typeof candidateId === 'string' && candidateId.trim()) return candidateId;
  }
  const candidates = body.candidates ?? body.items ?? body.registeredCandidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const candidateRecord = objectRecord(candidate);
    if (!candidateRecord) continue;
    for (const key of ['candidateId', 'id', 'contextStillCandidateId']) {
      const candidateId = candidateRecord[key];
      if (typeof candidateId === 'string' && candidateId.trim()) return candidateId;
    }
  }
  return null;
}

function extractContextStillError(value: unknown) {
  const body = objectRecord(value);
  if (!body) return null;
  const error = body.error ?? body.message ?? body.detail;
  return typeof error === 'string' && error.trim() ? error : null;
}

export async function createReviewKnowledgeCandidate(
  reviewSessionId: string,
  input: {
    findingId: string;
    candidateType?: 'rule' | 'procedure' | 'failure_pattern';
    title?: string;
    body?: string;
    avoid?: string | null;
    prefer?: string | null;
  }
) {
  const finding = await reviewRepo.getReviewFinding(reviewSessionId, input.findingId);
  if (!finding) throw new NotFoundError('Review finding not found');
  const existing = await reviewRepo.getReviewKnowledgeCandidateByFinding(finding.id);
  if (existing && existing.status !== 'discarded') {
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: 'knowledge_candidate',
      dispositionStatus: 'converted',
      contextStillCandidateId: existing.id,
    });
    return getReviewSessionDetail(reviewSessionId);
  }
  const candidateType = input.candidateType || 'rule';
  const body = input.body?.trim() || defaultCandidateBody(finding, candidateType);
  assertProcedureCandidateBody(candidateType, body);
  const candidate = await reviewRepo.createReviewKnowledgeCandidate({
    reviewSessionId,
    findingId: finding.id,
    candidateType,
    title: input.title?.trim() || `Review rule: ${finding.title}`,
    body,
    avoid: input.avoid ?? null,
    prefer: input.prefer ?? null,
  });
  await reviewRepo.updateReviewFindingDisposition(finding.id, {
    disposition: 'knowledge_candidate',
    dispositionStatus: 'converted',
    contextStillCandidateId: candidate.id,
  });
  return getReviewSessionDetail(reviewSessionId);
}

export async function updateReviewKnowledgeCandidate(
  reviewSessionId: string,
  candidateId: string,
  input: {
    candidateType?: ReviewKnowledgeCandidateType;
    title?: string;
    body?: string;
    avoid?: string | null;
    prefer?: string | null;
    status?: 'discarded';
  }
) {
  const candidate = await reviewRepo.getReviewKnowledgeCandidate(reviewSessionId, candidateId);
  if (!candidate) throw new NotFoundError('Review knowledge candidate not found');
  if (candidate.status === 'sent') {
    throw new AppError(
      400,
      'REVIEW_KNOWLEDGE_CANDIDATE_ALREADY_SENT',
      'Sent review knowledge candidates cannot be edited'
    );
  }
  const nextCandidateType =
    input.candidateType ?? (candidate.candidateType as ReviewKnowledgeCandidateType);
  const nextBody = input.body?.trim() ?? candidate.body;
  assertProcedureCandidateBody(nextCandidateType, nextBody);
  const update: {
    candidateType?: string;
    title?: string;
    body?: string;
    avoid?: string | null;
    prefer?: string | null;
    status?: string;
    sendError?: string | null;
  } = {};
  if (input.candidateType) update.candidateType = input.candidateType;
  if (input.title !== undefined) update.title = input.title.trim();
  if (input.body !== undefined) update.body = nextBody;
  if ('avoid' in input) update.avoid = input.avoid;
  if ('prefer' in input) update.prefer = input.prefer;
  if (input.status === 'discarded') update.status = 'discarded';
  if (Object.keys(update).some((key) => key !== 'status')) {
    update.status = input.status ?? 'draft';
    update.sendError = null;
  }
  await reviewRepo.updateReviewKnowledgeCandidate(candidate.id, update);
  return getReviewSessionDetail(reviewSessionId);
}

export async function sendReviewKnowledgeCandidate(reviewSessionId: string, candidateId: string) {
  const candidate = await reviewRepo.getReviewKnowledgeCandidate(reviewSessionId, candidateId);
  if (!candidate) throw new NotFoundError('Review knowledge candidate not found');
  if (candidate.status === 'discarded') {
    throw new AppError(
      400,
      'REVIEW_KNOWLEDGE_CANDIDATE_DISCARDED',
      'Discarded review knowledge candidates cannot be sent'
    );
  }
  if (candidate.status === 'sent') {
    return getReviewSessionDetail(reviewSessionId);
  }
  const integrationUrl = process.env.CONTEXT_STILL_REGISTER_CANDIDATES_URL?.trim();
  if (!integrationUrl) {
    await reviewRepo.updateReviewKnowledgeCandidate(candidate.id, {
      status: 'draft',
      sendError: 'contextStill integration is not configured.',
    });
    return getReviewSessionDetail(reviewSessionId);
  }
  try {
    const response = await fetch(integrationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contextStillCandidatePayload(candidate)),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      await reviewRepo.updateReviewKnowledgeCandidate(candidate.id, {
        status: 'send_failed',
        sendError:
          extractContextStillError(responseBody) ||
          `contextStill integration returned HTTP ${response.status}.`,
      });
      return getReviewSessionDetail(reviewSessionId);
    }
    await reviewRepo.updateReviewKnowledgeCandidate(candidate.id, {
      status: 'sent',
      contextStillCandidateId: extractContextStillCandidateId(responseBody),
      sendError: null,
    });
  } catch (error) {
    await reviewRepo.updateReviewKnowledgeCandidate(candidate.id, {
      status: 'send_failed',
      sendError:
        error instanceof Error ? error.message : 'contextStill integration request failed.',
    });
  }
  return getReviewSessionDetail(reviewSessionId);
}

export async function applyReviewFinalAction(
  reviewSessionId: string,
  input: { action: 'approve' | 'request_changes' | 'needs_human' | 'exit_review'; note?: string }
) {
  const detail = await getReviewSessionDetail(reviewSessionId);
  const recommendation = detail.recommendation;
  if (input.action === 'approve' && !detail.statusArtifact.finalActionGate.canApprove) {
    throw new AppError(
      400,
      'REVIEW_APPROVE_BLOCKED',
      detail.statusArtifact.finalActionGate.blockingReason || 'Review cannot be approved'
    );
  }
  if (input.action === 'exit_review' && recommendation.level === 'required') {
    throw new AppError(400, 'REQUIRED_REVIEW_CANNOT_EXIT', 'Required review cannot be skipped');
  }
  const status =
    input.action === 'approve'
      ? 'approved'
      : input.action === 'request_changes'
        ? 'changes_requested'
        : input.action === 'needs_human'
          ? 'needs_human'
          : 'cancelled';
  await reviewRepo.updateReviewSession(reviewSessionId, {
    status,
    completedAt: new Date(),
    finalAction: input.action,
    finalNote: input.note?.trim() || null,
  });
  return getReviewSessionDetail(reviewSessionId);
}
