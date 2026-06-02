import type { ReviewEvidenceRef } from './types';

type ReviewEventLike = {
  id: string;
  seq?: number;
  type?: string;
  eventType?: string | null;
  message?: string;
  payloadJson?: any;
  timestamp?: Date;
};

type ReviewRunLike = {
  id: string;
  diffPatch?: string | null;
  finalReport?: string | null;
};

function isCanonicalEventType(event: ReviewEventLike, type: string) {
  return (
    event.payloadJson?.runEvent?.type === type || event.type === type || event.eventType === type
  );
}

function getEventData(event: ReviewEventLike) {
  return event.payloadJson?.runEvent?.data || {};
}

function isVerificationEvent(event: ReviewEventLike) {
  if (event.payloadJson?.runEvent?.type === 'verification.finished') return true;
  if (event.type === 'verification.finished') return true;
  if (event.eventType === 'checkpoint') {
    const data = getEventData(event);
    return (
      typeof data.passed === 'boolean' ||
      typeof data.verificationPassed === 'boolean' ||
      typeof data.command === 'string' ||
      typeof data.checkpoint === 'string' ||
      typeof data.verification === 'object'
    );
  }
  return false;
}

export function collectDefaultReviewEvidence(
  run: ReviewRunLike,
  events: ReviewEventLike[]
): ReviewEvidenceRef[] {
  const refs: ReviewEvidenceRef[] = [];
  const seenEventIds = new Set<string>();
  const pushEventRef = (event: ReviewEventLike, eventType?: string) => {
    if (seenEventIds.has(event.id)) return;
    seenEventIds.add(event.id);
    refs.push({
      kind: 'run_event',
      eventId: event.id,
      seq: event.seq,
      eventType: eventType || event.payloadJson?.runEvent?.type || event.eventType || event.type,
    });
  };

  const latestByType = (types: string[]) =>
    [...events].reverse().find((event) => types.some((type) => isCanonicalEventType(event, type)));

  const finalReportEvent = latestByType(['run.runtime_finished', 'final_report']);
  if (finalReportEvent) pushEventRef(finalReportEvent, 'run.runtime_finished');

  const diffEvent = latestByType(['git.diff_collected', 'tool_result']);
  if (diffEvent) {
    const data = getEventData(diffEvent);
    refs.push({
      kind: 'diff',
      runId: run.id,
      bytes:
        typeof data.diffBytes === 'number'
          ? data.diffBytes
          : typeof data.bytes === 'number'
            ? data.bytes
            : typeof run.diffPatch === 'string'
              ? Buffer.byteLength(run.diffPatch, 'utf8')
              : undefined,
      hasChanges:
        typeof data.hasChanges === 'boolean'
          ? data.hasChanges
          : typeof run.diffPatch === 'string'
            ? run.diffPatch.length > 0
            : undefined,
    });
  } else if (typeof run.diffPatch === 'string' && run.diffPatch.length > 0) {
    refs.push({
      kind: 'diff',
      runId: run.id,
      bytes: Buffer.byteLength(run.diffPatch, 'utf8'),
      hasChanges: true,
    });
  }

  const finalReport = latestByType(['run.runtime_finished', 'final_report']);
  if (finalReport) {
    refs.push({ kind: 'final_report', runId: run.id });
  } else if (typeof run.finalReport === 'string' && run.finalReport.trim()) {
    refs.push({ kind: 'final_report', runId: run.id });
  }

  const verificationEvent = [...events].reverse().find((event) => isVerificationEvent(event));
  if (verificationEvent) {
    const data = getEventData(verificationEvent);
    refs.push({
      kind: 'verification',
      eventId: verificationEvent.id,
      passed:
        typeof data.passed === 'boolean'
          ? data.passed
          : typeof data.verificationPassed === 'boolean'
            ? data.verificationPassed
            : undefined,
      command: typeof data.command === 'string' ? data.command : undefined,
    });
  }

  const policyEvent = latestByType(['tool.policy_blocked', 'safety.policy_violation']);
  if (policyEvent) {
    const data = getEventData(policyEvent);
    refs.push({
      kind: 'policy',
      eventId: policyEvent.id,
      code: typeof data.code === 'string' ? data.code : undefined,
      message: typeof data.message === 'string' ? data.message : policyEvent.message,
    });
  }

  return refs;
}
