import { describe, expect, it } from 'vitest';
import { serializeRunToJsonl } from '../api/services/run-events/jsonl-export';
import { normalizeRunEventToLegacy } from '../api/services/run-events/normalizer';

describe('run-events normalizer', () => {
  it('maps canonical type to legacy and keeps severity=error as legacy error', () => {
    const normalized = normalizeRunEventToLegacy({
      event: {
        version: 1,
        runId: 'run-1',
        timestamp: new Date('2026-06-02T00:00:00.000Z').toISOString(),
        type: 'tool.call_finished',
        severity: 'error',
        actor: 'worker',
        message: 'tool failed',
      },
    });

    expect(normalized.eventType).toBe('tool_result');
    expect(normalized.type).toBe('error');
    expect(normalized.payloadJson.runEvent.type).toBe('tool.call_finished');
  });

  it('maps provider activity to warning/error without tool-result semantics', () => {
    const detected = normalizeRunEventToLegacy({
      event: {
        version: 1,
        runId: 'run-1',
        timestamp: new Date('2026-06-02T00:00:00.000Z').toISOString(),
        type: 'model.provider_tool_call_detected',
        severity: 'warning',
        actor: 'supervisor',
        message: 'provider tool call detected',
      },
    });
    const rejected = normalizeRunEventToLegacy({
      event: {
        version: 1,
        runId: 'run-1',
        timestamp: new Date('2026-06-02T00:00:01.000Z').toISOString(),
        type: 'model.provider_activity_rejected',
        severity: 'error',
        actor: 'supervisor',
        message: 'provider activity rejected',
      },
    });

    expect(detected.eventType).toBe('warning');
    expect(detected.type).toBe('warning');
    expect(rejected.eventType).toBe('error');
    expect(rejected.type).toBe('error');
    expect(detected.eventType).not.toBe('tool_result');
    expect(rejected.eventType).not.toBe('tool_result');
  });
});

describe('run-events jsonl serializer', () => {
  it('renders header -> seq ordered events -> summary', () => {
    const run = {
      id: '4fd6f30f-9271-45f8-8933-e5ca3d17e3df',
      taskId: 'f3449f3d-b89f-4706-a9e1-e5f7e6a5a4d5',
      repositoryId: '6a2f13f3-bb50-4f95-9dce-275f0388f6a2',
      status: 'needs_review',
      workerKind: 'native-local',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
      diffPatch: 'abc',
      summary: 'sum',
      finalReport: 'report',
      finalJudgment: { version: 1, conclusion: 'judgment' },
    } as never;
    const events = [
      {
        id: 'evt-2',
        taskRunId: run.id,
        seq: 2,
        actor: 'worker',
        eventType: 'tool_result',
        type: 'info',
        message: 'second',
        payloadJson: null,
        timestamp: new Date('2026-06-02T00:00:02.000Z'),
      },
      {
        id: 'evt-1',
        taskRunId: run.id,
        seq: 1,
        actor: 'runtime',
        eventType: 'state_change',
        type: 'info',
        message: 'first',
        payloadJson: {
          runEvent: {
            version: 1,
            runId: run.id,
            taskId: run.taskId,
            seq: 1,
            timestamp: '2026-06-02T00:00:01.000Z',
            type: 'run.runtime_started',
            severity: 'info',
            actor: 'runtime',
            message: 'started',
          },
        },
        timestamp: new Date('2026-06-02T00:00:01.000Z'),
      },
      {
        id: 'evt-3',
        taskRunId: run.id,
        seq: 3,
        actor: 'human',
        eventType: 'state_change',
        type: 'info',
        message: 'reviewed',
        payloadJson: {
          reviewResult: {
            version: 1,
            id: 'review-1',
            runId: run.id,
            taskId: run.taskId,
            reviewer: { type: 'human', label: 'human reviewer' },
            action: 'complete',
            verdict: 'approved',
            statusBefore: 'needs_review',
            statusAfter: 'completed',
            outcome: {
              status: 'completed',
              reason: 'human_review',
              summary: 'done',
            },
            evidenceRefs: [],
            findings: [],
            humanCallouts: [],
            agentFollowUps: [],
            suggestedNextTasks: [],
            createdAt: '2026-06-02T00:00:03.000Z',
          },
        },
        timestamp: new Date('2026-06-02T00:00:03.000Z'),
      },
    ] as unknown[];

    const jsonl = serializeRunToJsonl({
      run,
      events,
      repository: { localPath: '/tmp/repo' } as never,
    });

    const lines = jsonl
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[0].type).toBe('nightworkers_run');
    expect(lines[1].seq).toBe(1);
    expect(lines[2].seq).toBe(2);
    expect(lines[3].reviewResult.id).toBe('review-1');
    expect(lines[4].type).toBe('run_summary');
    expect(lines[4].finalJudgment.conclusion).toBe('judgment');
    expect(lines[4].eventCount).toBe(3);
  });
});
