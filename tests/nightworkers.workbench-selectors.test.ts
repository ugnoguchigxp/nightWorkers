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
  buildWorkbenchSessionView,
  getSessionEmailState,
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
    expect(getSessionGroup({ ...baseTask, status: 'draft' })).toBe('processing');
    expect(getSessionGroup({ ...baseTask, status: 'ready' })).toBe('queue');
    expect(getSessionGroup({ ...baseTask, status: 'running' })).toBe('processing');
    expect(getSessionGroup({ ...baseTask, status: 'queued' })).toBe('queue');
    expect(getSessionGroup({ ...baseTask, status: 'failed' })).toBe('archive');
    expect(
      getSessionGroup(
        { ...baseTask, status: 'completed', updatedAt: '2026-06-02T12:00:00Z' },
        undefined,
        { now: '2026-06-03T11:59:59Z' }
      )
    ).toBe('processing');
    expect(
      getSessionGroup(
        { ...baseTask, status: 'completed', updatedAt: '2026-06-02T12:00:00Z' },
        undefined,
        { now: '2026-06-03T12:00:00Z' }
      )
    ).toBe('archive');
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

  it('keeps completed sessions active for 24 hours, then sorts archive by latest activity', () => {
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
      view(
        { ...baseTask, id: 'c', status: 'completed', updatedAt: '2026-06-02T00:00:01Z' },
        '2026-06-03T00:00:01Z'
      ),
      view(
        { ...baseTask, id: 'd', status: 'completed', updatedAt: '2026-06-02T00:00:03Z' },
        '2026-06-03T00:00:04Z'
      ),
      view(
        { ...baseTask, id: 'e', status: 'completed', updatedAt: '2026-06-03T00:00:05Z' },
        '2026-06-03T23:59:59Z'
      ),
    ]);
    expect(grouped.processing.map((session) => session.task.id)).toEqual(['e']);
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

  it('builds App Blueprint artifact refs from Plan mode markdown messages', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444445',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# App Blueprint',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'app_blueprint',
        title: 'Inventory App',
        appBlueprint: { name: 'Inventory App' },
        validation: { valid: true, issues: [] },
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
    });

    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'blueprint_workspace',
          title: 'Specification Workspace',
          source: { type: 'task_message', messageId: message.id },
        }),
        expect.objectContaining({
          kind: 'app_blueprint',
          title: 'Blueprint: Inventory App',
          source: { type: 'task_message', messageId: message.id },
        }),
      ])
    );
  });

  it('builds Specification Workspace refs from accepted Decision Review messages', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444446',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Decision Review',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'design_decision_review',
        title: 'Inventory Decision Review',
        designDecisionReview: { title: 'Inventory Decision Review' },
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
    });

    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'blueprint_workspace',
        title: 'Specification Workspace',
        source: { type: 'task_message', messageId: message.id },
      }),
      expect.objectContaining({
        kind: 'spec',
        title: 'Inventory Decision Review',
        source: { type: 'task_message', messageId: message.id },
      }),
    ]);
  });

  it('derives email workbench state from queue entries and review evidence', () => {
    const queued = buildWorkbenchSessionView(
      { ...baseTask, status: 'ready' },
      {
        queueEntry: {
          id: '88888888-8888-4888-8888-888888888888',
          taskId: baseTask.id,
          repositoryId: baseTask.repositoryId,
          status: 'queued',
          priority: 0,
          queuePosition: 3,
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
        },
      }
    );
    expect(queued.emailState).toBe('queued');
    expect(queued.primaryAction).toBe('remove');

    const reviewNeeded = buildWorkbenchSessionView(
      { ...baseTask, status: 'completed' },
      { latestRun: baseRun }
    );
    expect(reviewNeeded.emailState).toBe('review_needed');
    expect(reviewNeeded.primaryAction).toBe('review');

    const accepted = buildWorkbenchSessionView(
      { ...baseTask, status: 'completed' },
      { latestRun: baseRun, reviews: [approvedReview] }
    );
    expect(accepted.emailState).toBe('done');
  });

  it('treats implementation plan documents as plan-ready without keyword routing', () => {
    const state = getSessionEmailState(
      { ...baseTask, status: 'draft' },
      {
        messages: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            taskId: baseTask.id,
            role: 'assistant',
            content: '# Plan',
            messageType: 'markdown_document',
            metadataJson: { intent: 'implementation_plan' },
            createdAt: '2026-06-02T00:00:01.000Z',
          },
        ],
      }
    );

    expect(state).toBe('plan_ready');
  });

  it('uses queue dashboard plan-ready evidence without requiring inactive message hydration', () => {
    expect(getSessionEmailState({ ...baseTask, status: 'draft' }, { planReady: true })).toBe(
      'plan_ready'
    );
  });

  it('builds component design artifact refs from design tool messages', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444446',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Button Component Design',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'component_design',
        title: 'Button Component Design',
        componentDesign: { componentName: 'Button', variants: [], tokenChanges: [] },
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
    });

    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'component_design',
        title: 'Component: Button Component Design',
        source: { type: 'task_message', messageId: message.id },
      }),
    ]);
  });

  it('does not infer implementation plan artifacts from metadata title keywords', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444447',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Implementation Plan',
      messageType: 'markdown_document',
      metadataJson: {
        title: 'Implementation Plan',
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
    });

    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'spec',
        title: 'Spec',
      }),
    ]);
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

const approvedReview: ReviewResult = {
  version: 1,
  id: '66666666-6666-4666-8666-666666666667',
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

function view(task: Task, now?: unknown) {
  const progress = getSessionProgress(task);
  return {
    task,
    group: getSessionGroup(task, undefined, { now }),
    phase: progress.phase,
    progress,
    artifactCounts: {},
    badges: [],
  };
}
