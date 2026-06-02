import { randomUUID } from 'node:crypto';
import type { OutcomeGateResult } from '../run-control/types';
import type { ReviewAction, ReviewEvidenceRef, ReviewResult, ReviewRunRequest } from './types';

type BuildReviewResultInput = {
  run: {
    id: string;
    taskId: string;
    status: string;
    summary?: string | null;
  };
  request: ReviewRunRequest;
  outcome: OutcomeGateResult;
  evidenceRefs: ReviewEvidenceRef[];
  createdAt?: string;
};

function buildRiskAcceptance(
  request: ReviewRunRequest,
  note: string | undefined
): ReviewResult['riskAcceptance'] {
  if (request.riskAcceptance?.acceptedRisk?.trim()) {
    return {
      acceptedRisk: request.riskAcceptance.acceptedRisk.trim(),
      reason: request.riskAcceptance.reason?.trim() || undefined,
      evidenceRefs: request.riskAcceptance.evidenceRefs,
    };
  }

  const fallbackRisk = note?.trim() || 'Risk accepted.';
  if (request.action !== 'accept_risk') return undefined;
  return {
    acceptedRisk: fallbackRisk,
    reason: request.riskAcceptance?.reason?.trim() || undefined,
    evidenceRefs: request.riskAcceptance?.evidenceRefs,
  };
}

function mapActionToVerdict(action: ReviewAction): ReviewResult['verdict'] {
  switch (action) {
    case 'complete':
      return 'approved';
    case 'request_follow_up':
      return 'changes_requested';
    case 'cancel':
      return 'cancelled';
    case 'accept_risk':
      return 'risk_accepted';
  }
}

export function buildReviewResult({
  run,
  request,
  outcome,
  evidenceRefs,
  createdAt = new Date().toISOString(),
}: BuildReviewResultInput): ReviewResult {
  const note = request.note?.trim() || undefined;
  const findings = request.findings || [];
  const humanCallouts = request.humanCallouts || [];
  const agentFollowUps = request.agentFollowUps || [];
  const suggestedNextTasks = request.suggestedNextTasks || [];
  const statusAfter = outcome.status;
  const riskAcceptance = buildRiskAcceptance(request, note);

  return {
    version: 1,
    id: randomUUID(),
    runId: run.id,
    taskId: run.taskId,
    reviewer: {
      type: 'human',
      label: 'human reviewer',
    },
    action: request.action,
    verdict: mapActionToVerdict(request.action),
    ...(note ? { note } : {}),
    statusBefore: run.status,
    statusAfter,
    outcome,
    evidenceRefs,
    findings,
    humanCallouts,
    agentFollowUps,
    suggestedNextTasks,
    ...(riskAcceptance ? { riskAcceptance } : {}),
    createdAt,
  };
}
