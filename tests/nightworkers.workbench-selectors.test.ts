import { describe, expect, it } from 'vitest';
import type {
  ReviewResult,
  TaskEvent,
  TaskMessage,
  TaskRunTodo,
} from '../src/modules/nightworkers/types';
import {
  activityArtifactToTaskMessage,
  buildArtifactContext,
  buildBlueprintArtifactRef,
  buildPlanModeWorkspaceArtifactRef,
  buildWorkbenchArtifactRefs,
  buildWorkbenchSessionView,
  getCodexContractWarningSummary,
  getCodexMcpDiagnosticsSummary,
  getSessionEmailState,
  getSessionGroup,
  getSessionProgress,
  groupWorkbenchSessions,
} from '../src/modules/nightworkers/workbenchSelectors';
import { buildTask, buildTaskEvent, buildTaskRun } from './helpers/nightworkers-fixtures';

const baseTask = buildTask({
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
});

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

  it('summarizes Codex contract warnings from run snapshot and warning events', () => {
    const run = buildTaskRun({
      contextSnapshot: {
        codexContract: {
          warnings: [
            {
              code: 'codex_file_change_before_todo_replace',
              severity: 'warning',
              count: 2,
              changedFiles: ['src/app.ts'],
              occurredAt: '2026-06-02T00:00:01.000Z',
            },
          ],
        },
      },
    });
    const event = buildTaskEvent({
      eventType: 'system.warning',
      payloadJson: {
        runEvent: {
          type: 'system.warning',
          data: {
            contractWarning: {
              code: 'codex_open_todos_before_completion',
              severity: 'error',
              count: 1,
            },
          },
        },
      },
    });

    const summary = getCodexContractWarningSummary(run, [event]);
    const sessionView = buildWorkbenchSessionView(baseTask, {
      latestRun: run,
      events: [event],
    });

    expect(summary).toMatchObject({
      totalCount: 3,
      warningCount: 2,
      errorCount: 1,
    });
    expect(summary?.items.map((item) => item.code)).toEqual([
      'codex_open_todos_before_completion',
      'codex_file_change_before_todo_replace',
    ]);
    expect(sessionView.badges).toContain('contract:1 error');
    expect(sessionView.codexContractWarnings?.items[1]).toMatchObject({
      code: 'codex_file_change_before_todo_replace',
      changedFiles: ['src/app.ts'],
    });
  });

  it('does not double-count Codex contract warnings present in both snapshot and events', () => {
    const warning = {
      code: 'codex_file_change_without_prior_read',
      severity: 'warning',
      providerItemId: 'file-1',
      count: 2,
      changedFiles: ['src/app.ts'],
      occurredAt: '2026-06-02T00:00:01.000Z',
    };
    const run = buildTaskRun({
      contextSnapshot: {
        runtimeContract: {
          warnings: [warning],
        },
      },
    });
    const event = buildTaskEvent({
      eventType: 'system.warning',
      payloadJson: {
        runEvent: {
          type: 'system.warning',
          data: { contractWarning: warning },
        },
      },
    });

    const summary = getCodexContractWarningSummary(run, [event]);

    expect(summary).toMatchObject({
      totalCount: 2,
      warningCount: 2,
      errorCount: 0,
    });
    expect(summary?.items).toEqual([
      expect.objectContaining({
        code: 'codex_file_change_without_prior_read',
        count: 2,
        changedFiles: ['src/app.ts'],
      }),
    ]);
  });

  it('summarizes Codex MCP diagnostics without treating global inheritance as warning', () => {
    const inheritedRun = buildTaskRun({
      contextSnapshot: {
        codexContract: {
          mcp: {
            configSource: 'global_inherited',
            expectedTools: ['nightworkers.import_project'],
            observedNightWorkersTools: [],
            degraded: false,
          },
        },
      },
    });
    const degradedRun = buildTaskRun({
      contextSnapshot: {
        codexContract: {
          mcp: {
            configSource: 'inline_configured',
            expectedTools: ['nightworkers.import_project'],
            observedNightWorkersTools: ['nightworkers.todo_list'],
            degraded: true,
          },
        },
      },
    });

    expect(getCodexMcpDiagnosticsSummary(inheritedRun)).toMatchObject({
      configSource: 'global_inherited',
      tone: 'info',
      degraded: false,
    });
    expect(buildWorkbenchSessionView(baseTask, { latestRun: inheritedRun }).badges).not.toContain(
      'mcp:degraded'
    );
    expect(getCodexMcpDiagnosticsSummary(degradedRun)).toMatchObject({
      configSource: 'inline_configured',
      tone: 'warning',
      degraded: true,
      observedNightWorkersTools: ['nightworkers.todo_list'],
    });
    expect(buildWorkbenchSessionView(baseTask, { latestRun: degradedRun }).badges).toContain(
      'mcp:degraded'
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
          kind: 'plan_mode_workspace',
          title: 'Plan Mode Workspace',
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

  it('prefers activity artifact rows over embedded Blueprint message payloads', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444445',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# App Blueprint',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'app_blueprint',
        title: 'Legacy Inventory App',
        artifactRef: { artifactId: 'artifact-blueprint-1', kind: 'app_blueprint', version: 1 },
        appBlueprint: { name: 'Legacy Inventory App' },
        validation: { valid: true, issues: [] },
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
      activityArtifacts: [
        {
          id: 'artifact-blueprint-1',
          taskId: baseTask.id,
          runId: null,
          kind: 'app_blueprint',
          path: 'artifact-blueprint-1.app-blueprint.json',
          contentText: JSON.stringify({ name: 'Canonical Inventory App', screens: [] }),
          metadataJson: {
            schemaName: 'app_blueprint',
            title: 'Canonical Inventory App',
            appBlueprint: { name: 'Canonical Inventory App', screens: [] },
            validation: { valid: true, issues: [] },
          },
          createdAt: '2026-06-02T00:00:02.000Z',
        },
      ],
    });

    const blueprintRefs = refs.filter((ref) => ref.kind === 'app_blueprint');
    expect(blueprintRefs).toHaveLength(1);
    expect(blueprintRefs[0]).toMatchObject({
      title: 'Blueprint: Canonical Inventory App',
      source: { type: 'artifact_row', artifactId: 'artifact-blueprint-1' },
    });
  });

  it('preserves mock Blueprint intent when synthesizing messages from artifact rows', () => {
    const message = activityArtifactToTaskMessage({
      id: 'artifact-mock-blueprint-1',
      taskId: baseTask.id,
      runId: null,
      kind: 'app_blueprint',
      path: 'artifact-mock-blueprint-1.mock-blueprint.json',
      contentText: JSON.stringify({
        artifactKind: 'mock_blueprint',
        id: 'mock-blueprint',
        name: 'Mock Blueprint',
        version: 1,
        summary: 'Preview only.',
        tone: 'focused',
        screens: [],
      }),
      metadataJson: {
        schemaName: 'mock_blueprint',
        title: 'Mock Blueprint',
      },
      createdAt: '2026-06-02T00:00:02.000Z',
    });

    expect(message.metadataJson).toMatchObject({
      intent: 'mock_blueprint',
      mockBlueprint: expect.objectContaining({ artifactKind: 'mock_blueprint' }),
    });
    expect(message.metadataJson).not.toHaveProperty('appBlueprint');
  });

  it('routes Data Model messages to the Plan Mode Workspace Data Model tab', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444447777',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Data Model',
      messageType: 'markdown_document',
      metadataJson: {
        artifactKind: 'plan_mode_dedicated_view',
        view: 'data_model',
        artifactType: 'data_model',
        source: 'data-model',
        title: 'Kanban Data Model',
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
          kind: 'plan_mode_workspace',
          title: 'Data Model: Kanban Data Model',
          source: { type: 'task_message', messageId: message.id },
          metadata: expect.objectContaining({ initialTab: 'data-model' }),
        }),
      ])
    );
    expect(refs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'app_blueprint' })])
    );
  });

  it('routes additional dedicated view messages to their Plan Mode Workspace tab', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444447778',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# API / I/O',
      messageType: 'markdown_document',
      metadataJson: {
        artifactKind: 'plan_mode_dedicated_view',
        view: 'api_io_contract',
        source: 'dedicated-view-generator',
        title: 'API Contract',
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
          kind: 'plan_mode_workspace',
          title: 'Plan Mode Workspace: API Contract',
          source: { type: 'task_message', messageId: message.id },
          metadata: expect.objectContaining({ initialTab: 'api-io-contract' }),
        }),
      ])
    );
    expect(refs.find((ref) => ref.id === `plan-mode-workspace-${baseTask.id}`)?.metadata).toEqual(
      expect.objectContaining({ dedicatedViewCount: 1, dataModelCount: 0 })
    );
  });

  it('does not promote Data Model activity artifacts into App Blueprint refs', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444447777',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Data Model',
      messageType: 'markdown_document',
      metadataJson: {
        artifactKind: 'plan_mode_dedicated_view',
        view: 'data_model',
        artifactType: 'data_model',
        source: 'data-model',
        title: 'Kanban Data Model',
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
      activityArtifacts: [
        {
          id: 'artifact-data-model-1',
          taskId: baseTask.id,
          runId: null,
          kind: 'plan_mode_dedicated_view',
          path: 'artifact-data-model-1.md',
          contentText: '# Data Model',
          metadataJson: {
            messageId: message.id,
            artifactKind: 'plan_mode_dedicated_view',
            view: 'data_model',
            artifactType: 'data_model',
            source: 'data-model',
            title: 'Kanban Data Model',
          },
          createdAt: '2026-06-02T00:00:02.000Z',
        },
      ],
    });

    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'plan_mode_workspace',
          title: 'Data Model: Kanban Data Model',
          metadata: expect.objectContaining({ initialTab: 'data-model' }),
        }),
      ])
    );
    expect(refs).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'app_blueprint' })])
    );
  });

  it('builds Plan Mode Workspace refs from accepted Decision Review messages', () => {
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
        kind: 'plan_mode_workspace',
        title: 'Plan Mode Workspace',
        source: { type: 'task_message', messageId: message.id },
      }),
      expect.objectContaining({
        kind: 'spec',
        title: 'Inventory Decision Review',
        source: { type: 'task_message', messageId: message.id },
      }),
    ]);
  });

  it('keeps implementation plan documents as standalone artifacts', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444444447',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Implementation Plan',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'implementation_plan',
        title: 'Kanban Implementation Plan',
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    const refs = buildWorkbenchArtifactRefs({
      task: baseTask,
      messages: [message],
    });

    expect(refs).toEqual([
      expect.objectContaining({
        kind: 'implementation_plan',
        title: 'Kanban Implementation Plan',
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

  it('builds a focused Blueprint artifact ref for shell auto-open behavior', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444441234',
      taskId: baseTask.id,
      runId: baseRun.id,
      role: 'assistant',
      content: '# App Blueprint',
      messageType: 'markdown_document',
      metadataJson: {
        title: 'Legacy title',
        display: { title: 'Display Inventory', summary: 'Generated app blueprint' },
        artifactRef: { artifactId: 'artifact-blueprint-2', kind: 'app_blueprint', version: 1 },
        appBlueprint: { name: 'Canonical Inventory' },
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    expect(buildBlueprintArtifactRef(message)).toMatchObject({
      id: 'artifact-artifact-blueprint-2',
      taskId: baseTask.id,
      runId: baseRun.id,
      kind: 'app_blueprint',
      title: 'Blueprint: Canonical Inventory',
      summary: 'Generated app blueprint',
      source: { type: 'artifact_row', artifactId: 'artifact-blueprint-2' },
    });
  });

  it('builds questionnaire workspace refs with questionnaire tab metadata by default', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444441235',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Questionnaire ready',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'design_questionnaire_ready',
        questionnaireSessionId: 'questionnaire-1',
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    expect(buildPlanModeWorkspaceArtifactRef(message)).toMatchObject({
      id: `plan-mode-workspace-${baseTask.id}`,
      taskId: baseTask.id,
      kind: 'plan_mode_workspace',
      title: 'Plan Mode Workspace',
      source: { type: 'task_message', messageId: message.id },
      metadata: {
        planModeWorkspaceSource: 'design_questionnaire_ready',
        questionnaireSessionId: 'questionnaire-1',
        initialTab: 'questionnaire',
      },
    });
  });

  it('can build questionnaire workspace refs that open on the status tab', () => {
    const message: TaskMessage = {
      id: '44444444-4444-4444-8444-444444441236',
      taskId: baseTask.id,
      role: 'assistant',
      content: '# Questionnaire ready',
      messageType: 'markdown_document',
      metadataJson: {
        intent: 'design_questionnaire_ready',
        questionnaireSessionId: 'questionnaire-1',
      },
      createdAt: '2026-06-02T00:00:01.000Z',
    };

    expect(buildPlanModeWorkspaceArtifactRef(message, 'status')).toMatchObject({
      metadata: {
        planModeWorkspaceSource: 'design_questionnaire_ready',
        questionnaireSessionId: 'questionnaire-1',
        initialTab: 'status',
      },
    });
  });

  it('derives artifact context from typed Blueprint metadata and active session', () => {
    const artifact = {
      id: 'artifact-blueprint-3',
      taskId: baseTask.id,
      kind: 'app_blueprint' as const,
      title: 'Blueprint: Inventory',
      summary: 'Inventory app',
      source: { type: 'task_message' as const, messageId: 'message-1' },
      createdAt: '2026-06-02T00:00:01.000Z',
      metadata: {
        intent: 'app_blueprint',
        artifactType: 'app_blueprint',
        initialTab: 'preview',
        blueprintCount: 2,
        appBlueprint: {
          name: 'Inventory Ops',
          screens: [
            {
              name: 'Dashboard',
              sections: [{ title: 'Open Orders' }, { componentName: 'InventoryTable' }],
            },
            { id: 'settings', sections: [{ id: 'rules' }] },
          ],
          databaseSchema: {
            tables: [{ label: 'Products' }, { name: 'Orders' }],
          },
        },
      },
    };

    expect(buildArtifactContext(artifact, 'other-task')).toBeNull();
    expect(buildArtifactContext(artifact, baseTask.id)).toMatchObject({
      artifactId: 'artifact-blueprint-3',
      kind: 'app_blueprint',
      title: 'Blueprint: Inventory',
      metadata: {
        intent: 'app_blueprint',
        artifactType: 'app_blueprint',
        appBlueprintName: 'Inventory Ops',
        screenNames: ['Dashboard', 'settings'],
        sectionNames: ['Open Orders', 'InventoryTable', 'rules'],
        tableNames: ['Products', 'Orders'],
        initialTab: 'preview',
        blueprintCount: 2,
      },
    });
  });
});

const baseRun = buildTaskRun({
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
});

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
