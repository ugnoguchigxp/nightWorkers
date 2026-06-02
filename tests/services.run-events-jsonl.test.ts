import { describe, expect, it } from 'vitest';
import { serializeRunToJsonl } from '../api/services/run-events/jsonl-export';
import { parseRunJsonl } from '../api/services/run-events/jsonl-parse';
import { replayRunJsonl } from '../api/services/run-events/replay';

const runId = '4fd6f30f-9271-45f8-8933-e5ca3d17e3df';
const taskId = 'f3449f3d-b89f-4706-a9e1-e5f7e6a5a4d5';

describe('run-events jsonl parser', () => {
  it('parses valid JSONL and warns when seq is out of order', () => {
    const text = [
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:10.000Z',
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 2,
        event: {
          version: 1,
          runId,
          taskId,
          seq: 2,
          timestamp: '2026-06-02T00:00:02.000Z',
          type: 'run.runtime_finished',
          severity: 'checkpoint',
          actor: 'runtime',
          message: 'finished',
        },
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 1,
        event: {
          version: 1,
          runId,
          taskId,
          seq: 1,
          timestamp: '2026-06-02T00:00:01.000Z',
          type: 'run.runtime_started',
          severity: 'info',
          actor: 'runtime',
          message: 'started',
        },
      }),
    ].join('\n');

    const parsed = parseRunJsonl(text);

    expect(parsed.header?.runId).toBe(runId);
    expect(parsed.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ level: 'warning', code: 'seq_out_of_order' }),
    ]);
  });

  it('reports invalid JSON, duplicate summary, missing header, and runId mismatch', () => {
    const otherRunId = '4fd6f30f-9271-45f8-8933-e5ca3d17e3e0';
    const text = [
      '{not-json',
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId: otherRunId,
        seq: 1,
        event: {
          version: 1,
          runId: otherRunId,
          timestamp: '2026-06-02T00:00:01.000Z',
          type: 'run.runtime_started',
          severity: 'info',
          actor: 'runtime',
          message: 'started',
        },
      }),
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:10.000Z',
      }),
      JSON.stringify({
        type: 'run_summary',
        version: 1,
        runId: otherRunId,
        status: 'completed',
        diffBytes: 0,
        eventCount: 1,
      }),
      JSON.stringify({
        type: 'run_summary',
        version: 1,
        runId,
        status: 'completed',
        diffBytes: 0,
        eventCount: 1,
      }),
    ].join('\n');

    const diagnostics = parseRunJsonl(text).diagnostics.map((item) => item.code);

    expect(diagnostics).toContain('invalid_json');
    expect(diagnostics).toContain('event_before_header');
    expect(diagnostics).toContain('missing_header');
    expect(diagnostics).toContain('run_id_mismatch');
    expect(diagnostics).toContain('duplicate_summary');
  });

  it('reports line seq and event seq mismatch as a schema error', () => {
    const text = [
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:10.000Z',
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 2,
        event: {
          version: 1,
          runId,
          taskId,
          seq: 1,
          timestamp: '2026-06-02T00:00:01.000Z',
          type: 'run.runtime_started',
          severity: 'info',
          actor: 'runtime',
          message: 'started',
        },
      }),
    ].join('\n');

    expect(parseRunJsonl(text).diagnostics).toEqual([
      expect.objectContaining({
        level: 'error',
        code: 'invalid_schema',
        message: 'Event seq 1 differs from line seq 2',
      }),
    ]);
  });

  it('reports duplicate headers, duplicate seq, unsupported versions, and unknown line types', () => {
    const text = [
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:10.000Z',
      }),
      JSON.stringify({
        type: 'nightworkers_run',
        version: 1,
        runId,
        taskId,
        createdAt: '2026-06-02T00:00:00.000Z',
        exportedAt: '2026-06-02T00:00:11.000Z',
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 1,
        event: {
          version: 1,
          runId,
          taskId,
          seq: 1,
          timestamp: '2026-06-02T00:00:01.000Z',
          type: 'run.runtime_started',
          severity: 'info',
          actor: 'runtime',
          message: 'started',
        },
      }),
      JSON.stringify({
        type: 'run_event',
        version: 1,
        runId,
        seq: 1,
        event: {
          version: 1,
          runId,
          taskId,
          seq: 1,
          timestamp: '2026-06-02T00:00:02.000Z',
          type: 'run.runtime_finished',
          severity: 'checkpoint',
          actor: 'runtime',
          message: 'finished',
        },
      }),
      JSON.stringify({ type: 'run_summary', version: 2, runId, status: 'completed' }),
      JSON.stringify({ type: 'unknown_line', version: 1, runId }),
    ].join('\n');

    const diagnostics = parseRunJsonl(text).diagnostics.map((item) => item.code);

    expect(diagnostics).toContain('duplicate_header');
    expect(diagnostics).toContain('duplicate_seq');
    expect(diagnostics).toContain('unsupported_version');
    expect(diagnostics).toContain('invalid_schema');
  });
});

describe('run-events jsonl round trip', () => {
  it('exports, parses, and replays canonical and legacy events', () => {
    const run = {
      id: runId,
      taskId,
      repositoryId: null,
      status: 'needs_review',
      workerKind: 'native-local',
      startedAt: new Date('2026-06-02T00:00:00.000Z'),
      diffPatch: 'diff --git a/a b/a',
      summary: 'ready',
      finalReport: 'report',
      finalJudgment: null,
    } as any;
    const todos = [
      {
        id: '3f0f27a7-f986-4593-9bb5-c9bc05749bc6',
        seq: 1,
        title: 'Implement',
        taskType: 'code_change',
        status: 'passed',
        procedureId: 'code-change',
        statusReason: 'Runtime completed this planned todo.',
        completionGateResult: { passed: true },
      },
    ] as any[];
    const events = [
      {
        id: 'd9483774-5f2a-4730-af45-6c17cbd0b801',
        taskRunId: run.id,
        seq: 2,
        actor: 'worker',
        eventType: 'tool_result',
        type: 'info',
        message: 'legacy result',
        payloadJson: null,
        timestamp: new Date('2026-06-02T00:00:02.000Z'),
      },
      {
        id: 'd9483774-5f2a-4730-af45-6c17cbd0b802',
        taskRunId: run.id,
        seq: 1,
        actor: 'runtime',
        eventType: 'state_change',
        type: 'info',
        message: 'started',
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
    ] as any[];

    const parsed = parseRunJsonl(serializeRunToJsonl({ run, events, todos }));
    const replay = replayRunJsonl(parsed);

    expect(parsed.diagnostics).toHaveLength(0);
    expect(replay.eventCount).toBe(2);
    expect(replay.evidence.hasRuntimeStarted).toBe(true);
    expect(replay.evidence.hasTodos).toBe(true);
    expect(replay.todos).toEqual([
      expect.objectContaining({
        id: '3f0f27a7-f986-4593-9bb5-c9bc05749bc6',
        status: 'passed',
      }),
    ]);
    expect(parsed.summary?.eventCount).toBe(replay.eventCount);
    expect(parsed.summary?.todos).toEqual([
      expect.objectContaining({
        id: '3f0f27a7-f986-4593-9bb5-c9bc05749bc6',
        seq: 1,
        status: 'passed',
        completionGateResult: { passed: true },
      }),
    ]);
    expect(parsed.events[1].event.type).toBe('tool.call_finished');
  });
});
