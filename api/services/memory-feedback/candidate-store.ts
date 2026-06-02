import type { taskEvents } from '../../db/schema';
import type { RunEventBase } from '../run-events/types';
import type { LearningCandidate, MemoryCandidateStatus } from './types';

type EventRow = typeof taskEvents.$inferSelect;

export function createLearningCandidateEvent(input: {
  runId: string;
  taskId: string;
  candidate: LearningCandidate;
  timestamp?: string;
}): RunEventBase<'memory.candidate_generated'> {
  return {
    version: 1,
    runId: input.runId,
    taskId: input.taskId,
    timestamp: input.timestamp || new Date().toISOString(),
    type: 'memory.candidate_generated',
    severity: 'info',
    actor: 'system',
    message: `Memory learning candidate generated: ${input.candidate.title}`,
    data: {
      candidateId: input.candidate.id,
      sourceRunId: input.candidate.sourceRunId,
      sourceEventIds: input.candidate.sourceEventIds,
      kind: input.candidate.kind,
      title: input.candidate.title,
      confidence: input.candidate.confidence,
      requiresHumanApproval: true,
      status: 'draft',
    },
  };
}

function candidateFromEvent(event: EventRow): LearningCandidate | null {
  const payload = (event.payloadJson || {}) as { memoryCandidate?: LearningCandidate };
  return payload.memoryCandidate || null;
}

function statusFromRunEvent(event: EventRow): {
  candidateId?: string;
  status?: MemoryCandidateStatus;
  approvedAt?: string;
  registeredAt?: string;
  externalRef?: LearningCandidate['externalRef'];
} {
  const payload = (event.payloadJson || {}) as {
    runEvent?: RunEventBase;
    memoryCandidate?: LearningCandidate;
  };
  if (payload.memoryCandidate) {
    return {
      candidateId: payload.memoryCandidate.id,
      status: payload.memoryCandidate.status,
      approvedAt: payload.memoryCandidate.approvedAt,
      registeredAt: payload.memoryCandidate.registeredAt,
      externalRef: payload.memoryCandidate.externalRef,
    };
  }
  const runEvent = payload.runEvent;
  const data = (runEvent?.data || {}) as Record<string, unknown>;
  const candidateId = typeof data.candidateId === 'string' ? data.candidateId : undefined;
  if (!candidateId) return {};
  if (runEvent?.type === 'memory.candidate_approved') {
    return {
      candidateId,
      status: 'approved',
      approvedAt: typeof data.approvedAt === 'string' ? data.approvedAt : runEvent.timestamp,
    };
  }
  if (runEvent?.type === 'memory.register_finished') {
    const registerStatus = data.status;
    return {
      candidateId,
      status: registerStatus === 'registered' ? 'registered' : 'failed',
      registeredAt: runEvent.timestamp,
      externalRef: {
        target: 'context-still',
        id: typeof data.externalId === 'string' ? data.externalId : undefined,
      },
    };
  }
  return {};
}

export function listLearningCandidatesForRun(events: EventRow[]): LearningCandidate[] {
  const byId = new Map<string, LearningCandidate>();
  for (const event of events) {
    const created = candidateFromEvent(event);
    if (created) {
      byId.set(created.id, { ...created });
    }
    const status = statusFromRunEvent(event);
    if (status.candidateId && status.status && byId.has(status.candidateId)) {
      const current = byId.get(status.candidateId);
      if (!current) continue;
      byId.set(status.candidateId, {
        ...current,
        status: status.status,
        approvedAt: status.approvedAt ?? current.approvedAt,
        registeredAt: status.registeredAt ?? current.registeredAt,
        externalRef: status.externalRef ?? current.externalRef,
      });
    }
  }
  return [...byId.values()];
}

export function getLearningCandidateFromEvents(
  events: EventRow[],
  candidateId: string
): LearningCandidate | null {
  return (
    listLearningCandidatesForRun(events).find((candidate) => candidate.id === candidateId) || null
  );
}

export function updateLearningCandidateStatusEvent(input: {
  runId: string;
  taskId: string;
  candidate: LearningCandidate;
  status: MemoryCandidateStatus;
  timestamp?: string;
}): { event: RunEventBase; candidate: LearningCandidate } {
  const timestamp = input.timestamp || new Date().toISOString();
  const candidate = {
    ...input.candidate,
    status: input.status,
    approvedAt: input.status === 'approved' ? timestamp : input.candidate.approvedAt,
    registeredAt: input.status === 'registered' ? timestamp : input.candidate.registeredAt,
  };
  return {
    candidate,
    event: {
      version: 1,
      runId: input.runId,
      taskId: input.taskId,
      timestamp,
      type: input.status === 'approved' ? 'memory.candidate_approved' : 'memory.register_finished',
      severity: 'info',
      actor: input.status === 'approved' ? 'human' : 'system',
      message: `Memory candidate ${input.status}: ${candidate.title}`,
      data: {
        candidateId: candidate.id,
        sourceRunId: candidate.sourceRunId,
        status: input.status,
      },
    },
  };
}
