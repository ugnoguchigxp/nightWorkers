import { AppError, NotFoundError } from '../../lib/errors';
import type { ReviewEvidenceRef, ReviewFinding } from '../../services/review-results/types';
import { buildReviewEvidencePackFromRun } from '../../services/review-rubrics/evidence-pack';
import * as repo from './nightworkers.repository';
import {
  buildRecommendationFromEvidence,
  sectionFindings,
} from './nightworkers.review-mode.evidence';
import {
  countFindings,
  planSections,
  type ReviewFindingDisposition,
  type ReviewSectionKind,
  type ReviewSectionProgress,
  rowArtifact,
  rowFinding,
  rowPromptSuggestion,
  rowRecommendation,
  rowSecurityHandoff,
  rowSession,
  SECTION_ORDER,
} from './nightworkers.review-mode.model';
import * as reviewRepo from './nightworkers.review-mode.repository';
import { buildAcceptanceTestCoverage } from './nightworkers.review-mode.test-coverage';

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
  const promptSuggestions = await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
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
    promptSuggestionCount: promptSuggestions.filter((item) => item.status === 'draft').length,
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
  const promptSuggestions = await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
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
    promptSuggestions: promptSuggestions.map(rowPromptSuggestion),
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
  if (sectionKind === 'prompt_suggestions') {
    return createReviewPromptSuggestions(reviewSessionId);
  }
  const testCoverage =
    sectionKind === 'test_coverage'
      ? await buildAcceptanceTestCoverage({
          taskId: session.taskId,
          repositoryId: session.repositoryId,
        })
      : null;
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
      : testCoverage
        ? testCoverage.findings
        : sectionFindings(sectionKind, pack);
  if (sectionKind !== 'findings') {
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
    summary: testCoverage
      ? `${testCoverage.matches.filter((match) => match.matched).length}/${testCoverage.criteria.length} acceptance criteria have matching test names.`
      : findings.length === 0
        ? 'No findings were produced by deterministic review.'
        : `${findings.length} deterministic finding${findings.length === 1 ? '' : 's'} produced.`,
    result: testCoverage ?? undefined,
    evidence: testCoverage
      ? undefined
      : {
          diff: pack.diff,
          selectedEvents: pack.selectedEvents,
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
        : ['agent_followup', 'prompt_suggestion', 'security_plugin_handoff'].includes(
              input.disposition
            )
          ? 'converted'
          : 'accepted';
  if (input.disposition === 'prompt_suggestion') {
    const promptSuggestion = await ensureReviewPromptSuggestion(finding, input.evidenceRefs);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: input.disposition,
      dispositionStatus: status,
      dispositionNote: input.note?.trim() || null,
      evidenceRefsJson: input.evidenceRefs?.length ? input.evidenceRefs : undefined,
      createdGoalId: promptSuggestion.id,
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

async function ensureReviewPromptSuggestion(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
  evidenceRefsOverride?: ReviewEvidenceRef[]
) {
  const evidenceRefs = evidenceRefsOverride?.length
    ? evidenceRefsOverride
    : findingEvidenceRefs(finding);
  if (evidenceRefs.length === 0) {
    throw new AppError(
      400,
      'REVIEW_PROMPT_SUGGESTION_EVIDENCE_REQUIRED',
      'Review prompt suggestions require evidence refs'
    );
  }
  const session = await reviewRepo.getReviewSession(finding.reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const existing = await reviewRepo.getReviewPromptSuggestionByFinding(finding.id);
  const expectedOutcome = finding.body || finding.title;
  const acceptanceCriteria = 'The cited review finding is resolved or explicitly re-routed.';
  const verificationHint = 'Run the focused verification relevant to the finding.';
  const created = await reviewRepo.createReviewPromptSuggestion({
    reviewSessionId: finding.reviewSessionId,
    findingId: finding.id,
    runId: finding.runId,
    taskId: finding.taskId,
    repositoryId: session.repositoryId,
    title: `追加対応: ${finding.title}`,
    prompt: buildPromptSuggestionText({
      title: finding.title,
      body: finding.body,
      acceptanceCriteria,
      verificationHint,
    }),
    expectedOutcome,
    acceptanceCriteria,
    verificationHint,
    evidenceRefsJson: evidenceRefs,
  });
  return existing ?? created;
}

function buildPromptSuggestionText(input: {
  title: string;
  body: string | null;
  acceptanceCriteria: string;
  verificationHint: string;
}) {
  return [
    '次のレビュー指摘を解消するため、この session の作業を続けてください。',
    '',
    `指摘: ${input.title}`,
    '',
    `背景: ${input.body?.trim() || input.title}`,
    '',
    'やること:',
    '- 関連する証跡と差分を確認する',
    '- 必要な追加実装または追加修正を行う',
    '- focused verification を実行する',
    '- 結果をこの session に報告する',
    '',
    `完了条件: ${input.acceptanceCriteria}`,
    '',
    `検証: ${input.verificationHint}`,
  ].join('\n');
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

export async function createReviewPromptSuggestions(reviewSessionId: string) {
  const findings = await reviewRepo.listReviewFindings(reviewSessionId);
  const existing = await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
  const existingFindingIds = new Set(existing.map((suggestion) => suggestion.findingId));
  const activeDraftCount = existing.filter((suggestion) => suggestion.status === 'draft').length;
  const remainingSlots = Math.max(0, 5 - activeDraftCount);
  const targetFindings = findings
    .filter(
      (finding) =>
        remainingSlots > 0 &&
        !existingFindingIds.has(finding.id) &&
        Array.isArray(finding.evidenceRefsJson) &&
        finding.evidenceRefsJson.length > 0 &&
        (finding.disposition === 'prompt_suggestion' ||
          (!finding.disposition &&
            finding.dispositionStatus === 'unresolved' &&
            ['blocking', 'warning'].includes(finding.severity)))
    )
    .slice(0, remainingSlots);
  for (const finding of targetFindings) {
    const promptSuggestion = await ensureReviewPromptSuggestion(finding);
    await reviewRepo.updateReviewFindingDisposition(finding.id, {
      disposition: 'prompt_suggestion',
      dispositionStatus: 'converted',
      createdGoalId: promptSuggestion.id,
    });
  }
  await refreshPromptSuggestionsArtifact(reviewSessionId);
  return getReviewSessionDetail(reviewSessionId);
}

export async function updateReviewPromptSuggestion(
  reviewSessionId: string,
  suggestionId: string,
  input: { status: 'dismissed' }
) {
  const suggestion = await reviewRepo.getReviewPromptSuggestion(reviewSessionId, suggestionId);
  if (!suggestion) throw new NotFoundError('Review prompt suggestion not found');
  await reviewRepo.updateReviewPromptSuggestion(suggestion.id, {
    status: input.status,
    dismissedAt: input.status === 'dismissed' ? new Date() : null,
  });
  await refreshPromptSuggestionsArtifact(reviewSessionId);
  return getReviewSessionDetail(reviewSessionId);
}

export async function useReviewPromptSuggestion(
  reviewSessionId: string,
  suggestionId: string,
  input: { createdMessageId?: string } = {}
) {
  const suggestion = await reviewRepo.getReviewPromptSuggestion(reviewSessionId, suggestionId);
  if (!suggestion) throw new NotFoundError('Review prompt suggestion not found');
  await reviewRepo.updateReviewPromptSuggestion(suggestion.id, {
    status: 'used',
    useCount: suggestion.useCount + 1,
    lastUsedAt: new Date(),
    createdMessageId: input.createdMessageId ?? suggestion.createdMessageId ?? null,
  });
  await refreshPromptSuggestionsArtifact(reviewSessionId);
  return getReviewSessionDetail(reviewSessionId);
}

async function refreshPromptSuggestionsArtifact(reviewSessionId: string) {
  const session = await reviewRepo.getReviewSession(reviewSessionId);
  if (!session) throw new NotFoundError('Review session not found');
  const promptSuggestions = await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
  await reviewRepo.upsertReviewArtifact({
    reviewSessionId,
    runId: session.runId,
    taskId: session.taskId,
    kind: 'prompt_suggestions',
    status: 'done',
    artifactJson: { version: 1, promptSuggestions: promptSuggestions.map(rowPromptSuggestion) },
    sourceEvidenceRefsJson: promptSuggestions.flatMap((suggestion) =>
      Array.isArray(suggestion.evidenceRefsJson) ? suggestion.evidenceRefsJson : []
    ),
  });
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
