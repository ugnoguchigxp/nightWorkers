import { describe, expect, it } from 'vitest';
import { extractLearningCandidates } from '../api/services/memory-feedback/candidate-extractor';
import {
  createLearningCandidateEvent,
  listLearningCandidatesForRun,
} from '../api/services/memory-feedback/candidate-store';
import { weakMatchCandidateRefs } from '../api/services/memory-feedback/injection-matcher';
import {
  learningCandidateSchema,
  memoryRunEventDataSchema,
} from '../shared/schemas/nightworkers.schema';

const runId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';

describe('memory feedback schemas and candidate extraction', () => {
  it('validates supported candidates and rejects unsupported kinds', () => {
    const candidate = extractLearningCandidates({
      runId,
      taskId,
      events: [
        {
          version: 1,
          id: 'event-1',
          runId,
          taskId,
          timestamp: '2026-06-02T00:00:00.000Z',
          type: 'verification.finished',
          severity: 'checkpoint',
          actor: 'verifier',
          message: 'failed',
          data: { passed: false, command: 'pnpm test' },
        },
      ],
      outcomeStatus: 'failed',
    })[0];

    expect(learningCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(learningCandidateSchema.safeParse({ ...candidate, kind: 'tip' }).success).toBe(false);
    expect(candidate.confidence).not.toBe('high');
  });

  it('creates deterministic candidate events and restores status from event history', () => {
    const [candidate] = extractLearningCandidates({
      runId,
      taskId,
      events: [
        {
          version: 1,
          id: 'event-policy',
          runId,
          taskId,
          timestamp: '2026-06-02T00:00:00.000Z',
          type: 'tool.policy_blocked',
          severity: 'error',
          actor: 'tool',
          message: 'blocked',
        },
      ],
      outcomeStatus: 'needs_review',
    });
    const event = createLearningCandidateEvent({ runId, taskId, candidate });
    const parsedData = memoryRunEventDataSchema.safeParse({
      type: event.type,
      ...(event.data || {}),
    });

    expect(parsedData.success).toBe(true);
    expect(candidate.id).toBe(
      extractLearningCandidates({
        runId,
        taskId,
        events: [
          {
            version: 1,
            id: 'event-policy',
            runId,
            taskId,
            timestamp: '2026-06-02T00:00:00.000Z',
            type: 'tool.policy_blocked',
            severity: 'error',
            actor: 'tool',
            message: 'blocked',
          },
        ],
        outcomeStatus: 'needs_review',
      })[0].id
    );

    const restored = listLearningCandidatesForRun([
      {
        id: 'db-event-1',
        taskRunId: runId,
        seq: 1,
        actor: 'system',
        eventType: 'memory.candidate_generated',
        type: 'info',
        message: event.message,
        payloadJson: { runEvent: event, memoryCandidate: candidate },
        timestamp: new Date('2026-06-02T00:00:00.000Z'),
      },
      {
        id: 'db-event-2',
        taskRunId: runId,
        seq: 2,
        actor: 'human',
        eventType: 'memory.candidate_approved',
        type: 'info',
        message: 'approved',
        payloadJson: {
          runEvent: {
            version: 1,
            runId,
            taskId,
            timestamp: '2026-06-02T00:00:01.000Z',
            type: 'memory.candidate_approved',
            severity: 'info',
            actor: 'human',
            message: 'approved',
            data: {
              candidateId: candidate.id,
              sourceRunId: runId,
              approvedAt: '2026-06-02T00:00:01.000Z',
            },
          },
        },
        timestamp: new Date('2026-06-02T00:00:01.000Z'),
      },
    ] as any);

    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe('approved');
  });

  it('keeps source-less prompt title matches as low-confidence diagnostics', () => {
    const [candidate] = extractLearningCandidates({
      runId,
      taskId,
      events: [
        {
          version: 1,
          id: 'event-policy',
          runId,
          taskId,
          timestamp: '2026-06-02T00:00:00.000Z',
          type: 'tool.policy_blocked',
          severity: 'error',
          actor: 'tool',
          message: 'blocked',
        },
      ],
      outcomeStatus: 'needs_review',
    });

    expect(
      weakMatchCandidateRefs({
        compiledText: `Context includes: ${candidate.title}`,
        candidates: [candidate],
      })
    ).toEqual([
      expect.objectContaining({
        candidateId: candidate.id,
        confidence: 'low',
        kind: 'unknown',
      }),
    ]);
  });
});
