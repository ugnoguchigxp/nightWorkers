import { describe, expect, it } from 'vitest';
import type {
  ReviewResult,
  Task,
  TaskEvent,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
} from '../src/modules/nightworkers/types';
import {
  buildWorkbenchArtifactRefs,
  getSessionGroup,
  getSessionProgress,
  groupWorkbenchSessions,
} from '../src/modules/nightworkers/workbenchSelectors';

const baseTask: Task = {
  id: '11111111-1111-4111-8111-111111111111',
  repositoryId: '22222222-2222-4222-8222-222222222222',
  title: 'Implement workbench',
  description: 'Draft workbench conversation',
  objective: 'Ship chat first workbench',
  acceptanceCriteria: 'Selectors are deterministic',
  status: 'draft',
  compiledPrompt: null,
  timeoutSeconds: 3600,
  priority: 0,
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
};

describe('workbench selectors', () => {
  it('groups task status into processing queue and archive deterministically', () => {
    expect(getSessionGroup({ ...baseTask, status: 'running' })).toBe('processing');
    expect(getSessionGroup({ ...baseTask, status: 'queued' })).toBe('queue');
    expect(getSessionGroup({ ...baseTask, status: 'failed' })).toBe('archive');
    expect(
      getSessionGroup({ ...baseTask, status: 'draft' }, { ...baseRun, status: 'running' })
    ).toBe('processing');
  });

  it('returns progress basis and blockers from evidence instead of model self report', () => {
    const event: TaskEvent = {
      id: '33333333-3333-4333-8333-333333333333',
      taskRunId: baseRun.id,
      seq: 1,
      message: 'Verification failed',
      payloadJson: {
        runEvent: {
          version: 1,
          runId: baseRun.id,
          taskId: baseTask.id,
          timestamp: '2026-06-02T00:00:02.000Z',
          type: 'verification.finished',
          severity: 'error',
          actor: 'verifier',
          message: 'Verification failed',
          data: { passed: false },
        },
      },
    };
    const progress = getSessionProgress(
      { ...baseTask, status: 'failed', compiledPrompt: 'compiled' },
      {
        latestRun: { ...baseRun, status: 'failed', testResults: { passed: false } },
        events: [event],
      }
    );
    expect(progress.percent).toBeGreaterThanOrEqual(75);
    expect(progress.basis.length).toBeGreaterThan(0);
    expect(progress.blockers.map((blocker) => blocker.kind)).toContain('verification');
    expect(progress.blockers.map((blocker) => blocker.kind)).toContain('runtime');
  });

  it('sorts queue by priority and archive by latest activity', () => {
    const grouped = groupWorkbenchSessions([
      view({
        ...baseTask,
        id: 'a',
        status: 'queued',
        priority: 1,
        updatedAt: '2026-06-02T00:00:00Z',
      }),
      view({
        ...baseTask,
        id: 'b',
        status: 'queued',
        priority: 5,
        updatedAt: '2026-06-02T00:00:00Z',
      }),
      view({ ...baseTask, id: 'c', status: 'completed', updatedAt: '2026-06-02T00:00:01Z' }),
      view({ ...baseTask, id: 'd', status: 'completed', updatedAt: '2026-06-02T00:00:03Z' }),
    ]);
    expect(grouped.queue.map((session) => session.task.id)).toEqual(['b', 'a']);
    expect(grouped.archive.map((session) => session.task.id)).toEqual(['d', 'c']);
  });

  it('builds artifacts from markdown messages and run evidence', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444444',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Spec',
      messageType: 'markdown_document',
      metadataJson: { intent: 'draft_spec' },
      createdAt: '2026-06-02T00:00:01.000Z',
    };
    const todo: TaskRunTodo = {
      id: '55555555-5555-4555-8555-555555555555',
      runId: baseRun.id,
      seq: 1,
      title: 'Implement',
      taskType: 'code_change',
      status: 'passed',
      createdAt: '2026-06-02T00:00:01.000Z',
      updatedAt: '2026-06-02T00:00:01.000Z',
    };
    const review: ReviewResult = {
      version: 1,
      id: '66666666-6666-4666-8666-666666666666',
      runId: baseRun.id,
      taskId: baseTask.id,
      reviewer: { type: 'human' },
      action: 'complete',
      verdict: 'approved',
      statusBefore: 'needs_review',
      statusAfter: 'completed',
      outcome: { status: 'completed', reason: 'human_review', summary: 'Approved' },
      evidenceRefs: [],
      findings: [],
      humanCallouts: [],
      agentFollowUps: [],
      suggestedNextTasks: [],
      createdAt: '2026-06-02T00:00:03.000Z',
    };
    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      latestRun: baseRun,
      todos: [todo],
      events: [],
      reviews: [review],
      messages: [message],
    });
    expect(refs.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(['spec', 'diff', 'test_result', 'review_result'])
    );
    expect(refs.map((ref) => ref.kind)).not.toEqual(
      expect.arrayContaining(['context_pack', 'todo_plan', 'run_ledger', 'final_report'])
    );
  });
});

const baseRun: TaskRun = {
  id: '77777777-7777-4777-8777-777777777777',
  taskId: baseTask.id,
  repositoryId: baseTask.repositoryId,
  status: 'completed',
  workerKind: 'native-local',
  timeoutSeconds: 3600,
  contextSnapshot: { compiledPrompt: 'compiled' },
  diffPatch: 'diff --git a/a b/a',
  testResults: { passed: true },
  finalReport: 'Done',
  startedAt: '2026-06-02T00:00:01.000Z',
  createdAt: '2026-06-02T00:00:01.000Z',
  updatedAt: '2026-06-02T00:00:02.000Z',
};

function view(task: Task) {
  const progress = getSessionProgress(task);
  return {
    task,
    group: getSessionGroup(task),
    phase: progress.phase,
    progress,
    artifactCounts: {},
    badges: [],
  };
}
