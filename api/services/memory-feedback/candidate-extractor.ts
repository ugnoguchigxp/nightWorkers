import type { RunEventBase } from '../run-events/types';
import { stableId } from './hash';
import type { LearningCandidate } from './types';

type ExtractInput = {
  runId: string;
  taskId: string;
  repositoryId?: string | null;
  repoPath?: string | null;
  events: RunEventBase[];
  outcomeStatus?: string | null;
};

function eventId(event: RunEventBase, fallback: string) {
  return event.id || `${event.type}:${event.seq ?? fallback}`;
}

function candidate(input: {
  source: ExtractInput;
  sourceEvents: RunEventBase[];
  kind: LearningCandidate['kind'];
  title: string;
  body: string;
  confidence: LearningCandidate['confidence'];
}): LearningCandidate {
  const sourceEventIds = input.sourceEvents.map((event, index) => eventId(event, String(index)));
  return {
    id: stableId([input.source.runId, input.kind, input.title, sourceEventIds]),
    version: 1,
    sourceRunId: input.source.runId,
    sourceTaskId: input.source.taskId,
    sourceEventIds,
    kind: input.kind,
    title: input.title,
    body: input.body,
    appliesTo: {
      repositoryId: input.source.repositoryId || undefined,
      repoPath: input.source.repoPath || undefined,
    },
    confidence: input.confidence,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };
}

export function extractLearningCandidates(input: ExtractInput): LearningCandidate[] {
  const result: LearningCandidate[] = [];
  const policyEvents = input.events.filter(
    (event) => event.type === 'tool.policy_blocked' || event.type === 'safety.policy_violation'
  );
  if (policyEvents.length > 0) {
    result.push(
      candidate({
        source: input,
        sourceEvents: policyEvents,
        kind: 'warning',
        title: 'Avoid repeating blocked tool or policy actions',
        body: [
          'Use when:',
          '- A similar task may hit the same tool policy boundary.',
          '',
          'Procedure:',
          '1. Inspect the policy-blocked event before retrying the workflow.',
          '2. Choose an allowed command/path or ask for human approval before continuing.',
          '',
          'Verification:',
          '- The follow-up run should not repeat the same policy violation event.',
        ].join('\n'),
        confidence: input.outcomeStatus === 'completed' ? 'medium' : 'low',
      })
    );
  }

  const failedVerificationEvents = input.events.filter((event) => {
    if (event.type !== 'verification.finished') return false;
    const data = (event.data || {}) as Record<string, unknown>;
    return data.passed === false || data.status === 'failed' || data.success === false;
  });
  if (failedVerificationEvents.length > 0) {
    result.push(
      candidate({
        source: input,
        sourceEvents: failedVerificationEvents,
        kind: 'verification',
        title: 'Run the failed verification before closing similar work',
        body: [
          'Use when:',
          '- A similar task touches code covered by the failed verification.',
          '',
          'Workflow:',
          '1. Run the verification command recorded in the source event.',
          '2. Treat a repeated failure as blocking until fixed or explicitly accepted.',
          '',
          'Verification:',
          '- The follow-up run should include a passing verification event.',
        ].join('\n'),
        confidence: 'low',
      })
    );
  }

  const reviewEvents = input.events.filter((event) => {
    if (event.type !== 'human.review_submitted') return false;
    const data = (event.data || {}) as Record<string, unknown>;
    return data.action === 'request_follow_up' || data.verdict === 'changes_requested';
  });
  if (reviewEvents.length > 0) {
    result.push(
      candidate({
        source: input,
        sourceEvents: reviewEvents,
        kind: 'procedure',
        title: 'Address human review findings before the next final answer',
        body: [
          'Use when:',
          '- Human review requested changes on a similar run.',
          '',
          'Workflow:',
          '1. Read the review result and preserve each finding as an explicit checklist item.',
          '2. Verify the changed behavior before marking the run complete.',
        ].join('\n'),
        confidence: input.outcomeStatus === 'completed' ? 'medium' : 'low',
      })
    );
  }

  const successfulVerificationEvents = input.events.filter((event) => {
    if (event.type !== 'verification.finished') return false;
    const data = (event.data || {}) as Record<string, unknown>;
    return data.passed === true || data.status === 'passed' || data.success === true;
  });
  if (input.outcomeStatus === 'completed' && successfulVerificationEvents.length > 0) {
    result.push(
      candidate({
        source: input,
        sourceEvents: successfulVerificationEvents,
        kind: 'procedure',
        title: 'Reuse the verified workflow from the completed run',
        body: [
          'Use when:',
          '- A similar task needs the same verification confidence.',
          '',
          'Workflow:',
          '1. Follow the successful run sequence from context before making changes.',
          '2. Re-run the recorded verification command before completion.',
        ].join('\n'),
        confidence: 'high',
      })
    );
  }

  return result;
}
