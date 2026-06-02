import { registerCandidate } from '../context-still/adapter';
import type { RunEventBase } from '../run-events/types';
import type { LearningCandidate } from './types';

export async function registerApprovedCandidate(input: {
  runId: string;
  taskId: string;
  candidate: LearningCandidate;
  appendEvent: (event: RunEventBase, payloadJson?: Record<string, unknown>) => Promise<unknown>;
}) {
  if (input.candidate.status !== 'approved') {
    throw new Error('Only approved memory candidates can be registered');
  }

  await input.appendEvent({
    version: 1,
    runId: input.runId,
    taskId: input.taskId,
    timestamp: new Date().toISOString(),
    type: 'memory.register_started',
    severity: 'info',
    actor: 'system',
    message: `Registering approved memory candidate: ${input.candidate.title}`,
    data: {
      candidateId: input.candidate.id,
      sourceRunId: input.candidate.sourceRunId,
      target: 'context-still',
      tool: 'register_candidate',
    },
  });

  const result = await registerCandidate(input.candidate);
  const finishedAt = new Date().toISOString();
  const updatedCandidate: LearningCandidate = {
    ...input.candidate,
    status: result.status === 'registered' ? 'registered' : 'failed',
    registeredAt: finishedAt,
    externalRef: {
      target: 'context-still',
      id: result.externalId,
    },
  };

  await input.appendEvent(
    {
      version: 1,
      runId: input.runId,
      taskId: input.taskId,
      timestamp: finishedAt,
      type: 'memory.register_finished',
      severity: result.status === 'failed' ? 'warning' : 'info',
      actor: 'system',
      message: `Memory candidate registration ${result.status}: ${input.candidate.title}`,
      data: {
        candidateId: input.candidate.id,
        sourceRunId: input.candidate.sourceRunId,
        target: 'context-still',
        status: result.status,
        externalId: result.externalId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      },
    },
    { memoryCandidate: updatedCandidate }
  );

  return { candidate: updatedCandidate, registration: result };
}
