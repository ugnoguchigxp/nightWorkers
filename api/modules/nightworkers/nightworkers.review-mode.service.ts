import { AppError, NotFoundError } from '../../lib/errors';
import type { ReviewEvidenceRef, ReviewFinding } from '../../services/review-results/types';
import { buildReviewEvidencePackFromRun } from '../../services/review-rubrics/evidence-pack';
import * as repo from './nightworkers.repository';
import {
  buildRecommendationFromEvidence,
  sectionFindings,
} from './nightworkers.review-mode.evidence';
import {
  assertProcedureCandidateBody,
  contextStillCandidatePayload,
  defaultCandidateBody,
  extractContextStillCandidateId,
  extractContextStillError,
} from './nightworkers.review-mode.knowledge-helpers';
import {
  countFindings,
  planSections,
  type ReviewFindingDisposition,
  type ReviewKnowledgeCandidateType,
  type ReviewSectionKind,
  type ReviewSectionProgress,
  rowArtifact,
  rowFinding,
  rowKnowledgeCandidate,
  rowProposedGoal,
  rowRecommendation,
  rowSecurityHandoff,
  rowSession,
  SECTION_ORDER,
} from './nightworkers.review-mode.model';
import * as reviewRepo from './nightworkers.review-mode.repository';

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
