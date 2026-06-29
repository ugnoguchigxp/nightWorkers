import crypto from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as service from '../../api/modules/nightworkers/nightworkers.service';
import * as llm from '../../api/services/structured-llm';
import { buildBlueprintDbDesignPrompt } from '../../src/modules/blueprint-preview/dbDesignModel';
import { representativeAppBlueprint } from '../fixtures/app-blueprint';
import {
  disableAutoQueueDrainForTest,
  flushPendingWorkbenchTasks,
  restoreAutoQueueDrainForTest,
} from '../helpers/nightworkers-test-controls';

vi.mock('../../api/services/structured-llm', async () => {
  const actual = await vi.importActual<typeof import('../../api/services/structured-llm')>(
    '../../api/services/structured-llm'
  );
  return {
    ...actual,
    callSupervisorLLM: vi.fn(),
    callStructuredJsonLLM: vi.fn(),
  };
});

vi.mock('../../api/services/agent-runtime/registry', () => {
  const runtime = {
    kind: 'native-local',
    start: vi.fn(async () => ({
      terminalState: 'completed',
      summary: 'Runtime completed.',
      finalReport: 'Runtime completed.',
      stoppedBy: 'decision',
      riskLevel: 'low',
      diffPatch: '',
      logContent: '',
    })),
    stop: vi.fn(),
  };
  const resolveAgentRuntime = vi.fn(() => runtime);
  const buildRuntimeLaneInitialTodos = vi.fn((lane: string, input?: { executionMode?: string }) =>
    input?.executionMode === 'general_answer'
      ? []
      : lane === 'codex-sdk'
        ? [
            { title: '対象変更を確認して実装する', taskType: 'implementation' },
            { title: '必要最小限の動作確認を行う', taskType: 'focused_verification' },
          ]
        : [
            { title: '仕様と既存構成を確認する', taskType: 'inspection' },
            { title: '対象画面の実装準備を行う', taskType: 'scaffold', dependsOn: [1] },
            { title: '対象画面を仕様に沿って実装する', taskType: 'implementation', dependsOn: [2] },
            { title: '受け入れ条件を検証する', taskType: 'verification', dependsOn: [3] },
          ]
  );
  return {
    buildRuntimeLaneInitialTodos,
    resolveAgentRuntime,
    resolveRuntimeLaneDefinition: vi.fn((lane: 'native-api-runner' | 'codex-sdk') => ({
      kind: lane,
      aliases: [],
      buildInitialTodos: (input: { compiledPromptText: string; executionMode?: string }) =>
        buildRuntimeLaneInitialTodos(lane, input),
      buildRuntimeOptions: (input: { runtimeLaneResolution?: unknown }) => ({
        runtimeLane: lane,
        runtimeLaneResolution: input.runtimeLaneResolution ?? null,
      }),
      createAdapter: () =>
        resolveAgentRuntime(lane === 'codex-sdk' ? 'codex-agent' : 'native-local'),
    })),
  };
});

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

function mockPlanModeGate(
  shouldStartPlanMode: boolean,
  reason = 'test gate',
  action:
    | 'plan_mode'
    | 'general_answer'
    | 'implementation'
    | 'review'
    | 'runtime_debug' = shouldStartPlanMode ? 'plan_mode' : 'implementation'
) {
  return JSON.stringify({ shouldStartPlanMode, action, reason });
}

function _expectStrictObjectSchemas(schema: unknown, path = 'schema') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        _expectStrictObjectSchemas(propertySchema, `${path}.properties.${propertyName}`);
      }
      continue;
    }
    if (key === 'items') {
      _expectStrictObjectSchemas(value, `${path}.items`);
      continue;
    }
    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      value.forEach((item, index) => {
        _expectStrictObjectSchemas(item, `${path}.${key}.${index}`);
      });
    }
  }
}

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

beforeEach(() => {
  delete process.env.IMPLEMENTATION_RUNTIME_LANE;
  disableAutoQueueDrainForTest();
  vi.mocked(llm.callStructuredJsonLLM).mockResolvedValue(mockPlanModeGate(false));
});

afterEach(async () => {
  await flushPendingWorkbenchTasks();
  delete process.env.IMPLEMENTATION_RUNTIME_LANE;
  restoreAutoQueueDrainForTest();
  vi.clearAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('removes a queued Implementation Queue Entry without leaving the Session queued', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    const createRes = await app.request('http://localhost/api/implementation-queue/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ taskId: task.id }),
    });
    expect(createRes.status).toBe(201);
    const entry = await createRes.json();

    const cancelRes = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ action: 'cancel' }),
      }
    );
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).status).toBe('cancelled');
    expect((await repo.getTask(task.id))?.status).toBe('ready');

    const archiveRes = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}/archive`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(archiveRes.status).toBe(200);
    expect((await archiveRes.json()).status).toBe('execution_archived');

    const dashboardRes = await app.request('http://localhost/api/implementation-queue', {
      headers: sameOriginHeaders,
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = await dashboardRes.json();
    expect(dashboard.queued.map((queueEntry: unknown) => queueEntry.task.id)).not.toContain(
      task.id
    );
    expect(dashboard.notQueued.map((item: unknown) => item.task.id)).toContain(task.id);
  });

  it('accepts a reviewed queue execution and archives the Queue Entry', async () => {
    const { task } = await createWorkbenchTask({ status: 'needs_review' });
    const run = await repo.createTaskRun({
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'needs_review',
      workerKind: 'native-local',
      summary: 'Runtime result captured.',
      finalReport: 'Final report ready.',
      startedAt: new Date(),
      endedAt: new Date(),
      finishedAt: new Date(),
    });
    await repo.updateTaskRun(run.id, {
      diffPatch: 'diff --git a/file.ts b/file.ts',
      testResults: { passed: true },
    });
    const entry = await repo.createImplementationQueueEntry({
      taskId: task.id,
      repositoryId: task.repositoryId,
    });
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'execution_completed',
      activeRunId: run.id,
    });

    const reviewRes = await app.request(`http://localhost/api/runs/${run.id}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ action: 'complete', note: 'Accepted from test.' }),
    });

    expect(reviewRes.status).toBe(200);
    const reviewBody = await reviewRes.json();
    expect(reviewBody.reviewResult.verdict).toBe('approved');
    expect((await repo.getTask(task.id))?.status).toBe('completed');
    expect((await repo.getImplementationQueueEntry(entry.id))?.status).toBe('execution_archived');
  });

  it('requeues a stopped Queue Entry with its original priority', async () => {
    const { task } = await createWorkbenchTask({ status: 'needs_human' });
    await repo.updateTask(task.id, { priority: 9 });
    const entry = await repo.createImplementationQueueEntry({
      taskId: task.id,
      repositoryId: task.repositoryId,
      priority: 9,
      queuePosition: 2,
    });
    await repo.updateImplementationQueueEntry(entry.id, {
      status: 'needs_human',
      statusReason: 'Need human answer.',
    });

    const res = await app.request(
      `http://localhost/api/implementation-queue/entries/${entry.id}/requeue`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ note: 'Answered by human.' }),
      }
    );

    expect(res.status).toBe(201);
    const nextEntry = await res.json();
    expect(nextEntry.id).not.toBe(entry.id);
    expect(nextEntry).toMatchObject({
      taskId: task.id,
      status: 'queued',
      priority: 9,
      queuePosition: 2,
    });
    expect((await repo.getImplementationQueueEntry(entry.id))?.status).toBe('execution_archived');
    expect((await repo.getTask(task.id))?.status).toBe('queued');
  });

  it('routes design tool intent through LLM intake instead of fixed component artifacts', async () => {
    const { task } = await createWorkbenchTask({ title: 'Button design session' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'ボタンのデザインだけを見直したい',
        intent: 'design_component',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.messages.some((message: unknown) => message.metadataJson?.intent === 'component_design')
    ).toBe(false);
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    const intakeMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(intakeMessage).toBeUndefined();
  });

  it('creates a revised Blueprint artifact from DB Design intent without round-1 intake', async () => {
    const revisedBlueprint = {
      ...representativeAppBlueprint,
      databaseSchema: {
        ...representativeAppBlueprint.databaseSchema,
        tables: [
          {
            ...representativeAppBlueprint.databaseSchema.tables[0],
            columns: [
              ...representativeAppBlueprint.databaseSchema.tables[0].columns,
              {
                name: 'priority',
                type: 'string',
                nullable: false,
                primaryKey: false,
                unique: false,
                label: 'Priority',
                uiHint: 'status',
              },
            ],
            indexes: [['status'], ['priority']],
          },
        ],
      },
      dataBindings: [
        {
          ...representativeAppBlueprint.dataBindings[0],
          fields: ['id', 'status', 'priority'],
        },
        representativeAppBlueprint.dataBindings[1],
      ],
    };
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(JSON.stringify(revisedBlueprint));
    const { task } = await createWorkbenchTask({ title: 'DB Design task', objective: '' });
    const prompt = buildBlueprintDbDesignPrompt({
      blueprintId: representativeAppBlueprint.id,
      currentBlueprint: representativeAppBlueprint as unknown as Record<string, unknown>,
      prompt: 'priority column を追加してください',
      target: { kind: 'table', tableName: 'decision-items' },
      validationIssues: [],
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt, intent: 'design_blueprint_data' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      'AppBlueprint の DB Design'
    );
    const userMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'user' && message.metadataJson?.intent === 'design_blueprint_data'
    );
    expect(userMessage?.content).toContain('Target: Table decision-items');
    expect(userMessage?.content).toContain('Instruction: priority column を追加してください');
    expect(userMessage?.content).not.toContain('currentBlueprint');
    expect(userMessage?.metadataJson?.validation?.valid).toBe(true);
    const blueprintMessage = body.messages.find(
      (message: unknown) =>
        message.messageType === 'markdown_document' &&
        message.metadataJson?.source === 'blueprint-db-design'
    );
    expect(blueprintMessage?.metadataJson?.intent).toBe('app_blueprint');
    expect(blueprintMessage?.metadataJson?.dbDesignTarget).toEqual({
      kind: 'table',
      tableName: 'decision-items',
    });
    expect(
      blueprintMessage?.metadataJson?.appBlueprint?.databaseSchema?.tables?.[0]?.columns
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'priority' })]));
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(body.task.status).toBe('ready');
  });

  it('returns a validation error instead of changing task status for incomplete drafts', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('TASK_DRAFT_INCOMPLETE');
    expect((await repo.getTask(task.id))?.status).toBe('draft');
  });

  it('rejects workbench run requests until the task is ready or queued', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session' });

    const directRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/run`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(directRunRes.status).toBe(409);
    expect((await directRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');

    const intentRunRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: '実行して', intent: 'run_task' }),
      }
    );
    expect(intentRunRes.status).toBe(409);
    expect((await intentRunRes.json()).code).toBe('TASK_NOT_READY_TO_RUN');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('starts a run from a ready specification artifact even when draft fields are empty', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    await repo.updateTask(task.id, { objective: '', acceptanceCriteria: '' });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Specification\n\nImplement this specification.',
      messageType: 'markdown_document',
      payloadJson: { intent: 'draft_spec', source: 'status' },
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '現在のSpecification artifactを読み込み、この設計書の実装を開始してください。',
        intent: 'run_task',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run?.taskId).toBe(task.id);
    const messages = await repo.listTaskMessages(task.id);
    expect(messages.some((message) => message.role === 'user')).toBe(true);
  });

  it('queues a ready specification artifact even when draft fields are empty', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    await repo.updateTask(task.id, { objective: '', acceptanceCriteria: '' });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Specification\n\nImplement this specification.',
      messageType: 'markdown_document',
      payloadJson: { intent: 'draft_spec', source: 'status' },
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(200);
    expect((await repo.getTask(task.id))?.status).toBe('queued');
  });

  it('allows workbench run requests for queued tasks through the runtime path', async () => {
    const { task } = await createWorkbenchTask({ status: 'queued' });
    const startSpy = vi.spyOn(service, 'startWorkbenchTaskRun').mockResolvedValue({
      id: crypto.randomUUID(),
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'running',
      workerKind: 'native-local',
      timeoutSeconds: 3600,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/run`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(res.status).toBe(201);
    expect(startSpy).toHaveBeenCalledWith(task.id);
  });
});

async function createWorkbenchTask(
  input: { title?: string; status?: string; objective?: string } = {}
) {
  const project = await repo.createRepository({
    name: `TEST: Workbench Project ${crypto.randomUUID()}`,
    localPath: '/Users/y.noguchi/Code/nightWorkers',
    branch: 'main',
  });
  const task = await repo.createTask({
    repositoryId: project.id,
    title: input.title || 'Workbench task',
    objective: input.objective ?? 'Implement chat-first workbench',
    acceptanceCriteria: 'Draft conversation, queue, and run are separate task-queue steps',
    status: input.status || 'draft',
  });
  return { project, task };
}
