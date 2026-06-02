import { randomUUID } from 'node:crypto';
import type { ReviewFinding, ReviewResult, ReviewVerdict } from '../review-results/types';
import type { OutcomeGateResult } from '../run-control/types';
import type {
  DeterministicReviewEvaluation,
  FirewallResult,
  ReviewEvidencePack,
  ReviewerDraft,
} from './types';

type BuildAgentReviewInput = {
  run: {
    id: string;
    taskId: string;
    status: string;
    summary?: string | null;
  };
  evidencePack: ReviewEvidencePack;
  deterministic: DeterministicReviewEvaluation;
  firewall?: FirewallResult;
  createdAt?: string;
};

function verdictToAction(verdict: ReviewVerdict): ReviewResult['action'] {
  switch (verdict) {
    case 'approved':
      return 'complete';
    case 'changes_requested':
      return 'cancel';
    case 'cancelled':
      return 'cancel';
  }
}

function mergeVerdict(
  deterministic: DeterministicReviewEvaluation,
  draft?: ReviewerDraft
): ReviewVerdict {
  const hasDeterministicBlocking = deterministic.findings.some(
    (finding) => finding.severity === 'blocking'
  );
  if (hasDeterministicBlocking) return 'changes_requested';
  return draft?.verdict ?? deterministic.verdict;
}

function buildOutcome(status: string, verdict: ReviewVerdict, summary: string): OutcomeGateResult {
  return {
    status: status as OutcomeGateResult['status'],
    reason: 'human_review',
    summary:
      verdict === 'approved'
        ? `Agent reviewer approved without changing run status. ${summary}`
        : `Agent reviewer requested attention without changing run status. ${summary}`,
  };
}

export function buildAgentReviewResult(input: BuildAgentReviewInput): ReviewResult {
  const draft = input.firewall?.draft;
  const firewallFindings = input.firewall?.findings ?? [];
  const findings = [
    ...input.deterministic.findings,
    ...firewallFindings,
    ...(draft?.findings ?? []),
  ];
  const humanCallouts = draft?.humanCallouts ?? [];
  const finalVerdict = mergeVerdict(input.deterministic, draft);
  const summary = draft?.summary || input.run.summary || 'Rubric replay evaluation completed.';
  const outcome = buildOutcome(input.run.status, finalVerdict, summary);

  return {
    version: 1,
    id: randomUUID(),
    runId: input.run.id,
    taskId: input.run.taskId,
    reviewer: {
      type: 'agent',
      id: 'nightworkers-rubric-reviewer',
      label: 'agent reviewer',
    },
    action: verdictToAction(finalVerdict),
    verdict: finalVerdict,
    note: summary,
    statusBefore: input.run.status,
    statusAfter: input.run.status,
    outcome,
    evidenceRefs: input.deterministic.evidenceRefs,
    findings: dedupeFindings(findings),
    humanCallouts,
    agentFollowUps: draft?.agentFollowUps ?? [],
    suggestedNextTasks: draft?.suggestedNextTasks ?? [],
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function countBlockingFindings(reviewResult: ReviewResult): number {
  return reviewResult.findings.filter((finding) => finding.severity === 'blocking').length;
}

function dedupeFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.title}:${finding.body ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
