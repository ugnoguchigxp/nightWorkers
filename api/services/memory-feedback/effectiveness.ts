import type { ReplayResult, RunEventBase } from '../run-events/types';
import type { EvaluateMemoryFeedbackInput, MemoryFeedbackEvaluation, RunLedgerView } from './types';

function eventsFrom(input: ReplayResult | RunLedgerView): RunEventBase[] {
  return 'events' in input ? input.events : [];
}

function runIdFrom(input: ReplayResult | RunLedgerView): string {
  return 'sourceRunId' in input ? input.sourceRunId : input.runId;
}

function terminalStatus(input: ReplayResult | RunLedgerView): string | undefined {
  return 'terminal' in input ? input.terminal?.status : undefined;
}

function hasInjectedCandidate(events: RunEventBase[], candidateIds: string[]) {
  return events.some((event) => {
    if (event.type !== 'memory.context_injected') return false;
    const data = (event.data || {}) as { includedSourceRefs?: Array<Record<string, unknown>> };
    return (data.includedSourceRefs || []).some((ref) => {
      if (ref.confidence === 'low') return false;
      return typeof ref.candidateId === 'string' && candidateIds.includes(ref.candidateId);
    });
  });
}

function hasFailureSignal(events: RunEventBase[]) {
  return events.some(
    (event) =>
      event.type === 'tool.policy_blocked' ||
      event.type === 'safety.policy_violation' ||
      (event.type === 'verification.finished' &&
        (((event.data || {}) as Record<string, unknown>).passed === false ||
          ((event.data || {}) as Record<string, unknown>).status === 'failed')) ||
      (event.type === 'human.review_submitted' &&
        ((event.data || {}) as Record<string, unknown>).verdict === 'changes_requested')
  );
}

function evidenceIds(events: RunEventBase[]) {
  return events
    .filter(
      (event) =>
        event.type === 'memory.context_injected' ||
        event.type === 'verification.finished' ||
        event.type === 'tool.policy_blocked' ||
        event.type === 'safety.policy_violation' ||
        event.type === 'human.review_submitted' ||
        event.type === 'run.outcome_decided'
    )
    .map((event, index) => event.id || `${event.type}:${event.seq ?? index}`);
}

export function evaluateMemoryFeedback(
  input: EvaluateMemoryFeedbackInput
): MemoryFeedbackEvaluation {
  const baselineEvents = eventsFrom(input.baselineRun);
  const followupEvents = eventsFrom(input.followupRun);
  const injected = hasInjectedCandidate(followupEvents, input.candidateIds);
  const reasons: string[] = [];

  if (!injected) {
    return {
      baselineRunId: runIdFrom(input.baselineRun),
      followupRunId: runIdFrom(input.followupRun),
      candidateIds: input.candidateIds,
      verdict: 'not_injected',
      reasons: ['Follow-up context did not include an exact memory candidate source ref.'],
      evidenceEventIds: evidenceIds(followupEvents),
    };
  }

  const baselineFailed =
    hasFailureSignal(baselineEvents) || terminalStatus(input.baselineRun) === 'failed';
  const followupFailed =
    hasFailureSignal(followupEvents) || terminalStatus(input.followupRun) === 'failed';

  if (followupFailed) {
    reasons.push('Follow-up run repeated a failure, policy, review, or verification signal.');
    return {
      baselineRunId: runIdFrom(input.baselineRun),
      followupRunId: runIdFrom(input.followupRun),
      candidateIds: input.candidateIds,
      verdict: 'ineffective',
      reasons,
      evidenceEventIds: evidenceIds(followupEvents),
    };
  }

  const followupCompleted = terminalStatus(input.followupRun) === 'completed';
  const followupVerified = followupEvents.some((event) => {
    const data = (event.data || {}) as Record<string, unknown>;
    return (
      event.type === 'verification.finished' && (data.passed === true || data.status === 'passed')
    );
  });
  if (baselineFailed && (followupCompleted || followupVerified)) {
    return {
      baselineRunId: runIdFrom(input.baselineRun),
      followupRunId: runIdFrom(input.followupRun),
      candidateIds: input.candidateIds,
      verdict: 'effective',
      reasons: [
        'Candidate was injected and follow-up evidence no longer repeats the baseline failure.',
      ],
      evidenceEventIds: evidenceIds(followupEvents),
    };
  }

  return {
    baselineRunId: runIdFrom(input.baselineRun),
    followupRunId: runIdFrom(input.followupRun),
    candidateIds: input.candidateIds,
    verdict: 'inconclusive',
    reasons: [
      'Candidate was injected, but baseline and follow-up outcome evidence are not comparable.',
    ],
    evidenceEventIds: evidenceIds(followupEvents),
  };
}
