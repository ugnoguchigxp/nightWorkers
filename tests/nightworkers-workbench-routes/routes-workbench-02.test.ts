import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../../api/services/structured-llm';
import { representativeAppBlueprint } from '../fixtures/app-blueprint';
import { flushPendingWorkbenchTasks } from '../helpers/nightworkers-test-controls';

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
  const buildRuntimeLaneInitialTodos = vi.fn((lane: string) =>
    lane === 'codex-sdk'
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
      buildInitialTodos: (input: { compiledPromptText: string }) =>
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

function mockJobSelection(jobType: string, goal: string) {
  return { jobType, goal };
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

afterEach(async () => {
  await flushPendingWorkbenchTasks();
  vi.clearAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('returns immediately when workbench intake is not explicitly awaited', async () => {
    vi.mocked(llm.callSupervisorLLM).mockImplementationOnce(() => new Promise(() => {}));
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const startedAt = Date.now();
    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '同期で待たずに受付してください',
        waitForIntake: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Date.now() - startedAt).toBeLessThan(100);
    expect(body.run).toBeNull();
    expect(body.messages.some((message: unknown) => message.role === 'user')).toBe(true);
    expect(body.messages.some((message: unknown) => message.role === 'assistant')).toBe(false);
    expect(body.task.objective).toBe('同期で待たずに受付してください');
  });

  it('generates an app blueprint artifact when LLM intake classifies the prompt as blueprint work', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create an EC site top page Blueprint.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        id: 'shop-home',
        name: 'EC Site Top Page',
        description: 'LLM generated storefront blueprint with commerce-specific sections.',
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページをBlueprintで作って見てください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '[Procedure Reference: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '通常の Blueprint 生成では DB/DDL/data model/data binding を設計しない'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '複数件の比較、状態確認、一括操作、ソート、絞り込み、更新対象の見極めが主目的なら table_workspace または DataTableSection を第一候補にする'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '単なる task / todo / record 一覧を自動で card 化しない'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      'databaseSchema は必ず {"tables":[],"relations":[]}'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      'DB table/column/relation/binding/DDL の考案は DB Design workflow の担当'
    );
    expect(body.run).toBeNull();
    expect(body.task.status).toBe('ready');
    const intakeMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(intakeMessage).toBeUndefined();
    const blueprintMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.messageType).toBe('markdown_document');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens).toHaveLength(1);
    expect(blueprintMessage?.metadataJson?.appBlueprint?.name).toBe('EC Site Top Page');
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.source).toBe('llm');
    expect(blueprintMessage?.metadataJson?.generation?.referenceDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'references/work_kinds/blueprint.md' }),
      ])
    );
    expect(blueprintMessage?.metadataJson?.routingHypothesis?.subtype).toBe('app_blueprint');
    expect(blueprintMessage?.metadataJson?.intakeJobSelection?.goal).toBe(
      'Create an EC site top page Blueprint.'
    );
  });

  it('routes active Blueprint workspace instructions to Blueprint generation without round 1 intake', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        id: 'todo-minimal-blueprint',
        name: 'Todo Minimal Blueprint',
        description: 'TODO登録と一覧だけに絞った Blueprint。',
      })
    );
    const { task } = await createWorkbenchTask({ title: 'todo listを作りたいです。' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt:
          '駄目ですね。TODO登録と、一覧があればそれだけで十分だと思いますが。余計なセクション追加しなくていいです',
        artifactContext: {
          artifactId: `blueprint-workspace-${task.id}`,
          kind: 'blueprint_workspace',
          title: 'Specification Workspace',
          summary: 'Design Questionnaire を生成しました。10 件の質問に回答できます。',
          source: { type: 'task_message', messageId: crypto.randomUUID() },
          metadata: {
            initialTab: 'questionnaire',
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(
      body.messages.some(
        (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
      )
    ).toBe(false);
    const blueprintMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.metadataJson?.appBlueprint?.id).toBe('todo-minimal-blueprint');
    expect(blueprintMessage?.metadataJson?.routingHypothesis?.subtype).toBe('app_blueprint');
    expect(blueprintMessage?.metadataJson?.intakeJobSelection?.jobType).toBe('blueprint');
    expect(blueprintMessage?.metadataJson?.intakeJobSelection?.goal).toContain('TODO登録と、一覧');
  });

  it('keeps generic Specification Workspace instructions on round 1 when no Blueprint focus is present', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('general_answer', 'Specification Workspace の内容を確認して返答する。')
    );
    const { task } = await createWorkbenchTask({ title: 'Implementation plan only' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'この仕様を見て次に何をすべきか教えてください',
        artifactContext: {
          artifactId: `blueprint-workspace-${task.id}`,
          kind: 'blueprint_workspace',
          title: 'Specification Workspace',
          summary: '1 Implementation Plan',
          source: { type: 'task_message', messageId: crypto.randomUUID() },
          metadata: {},
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).not.toHaveBeenCalled();
    expect(
      body.messages.some((message: unknown) => message.metadataJson?.intent === 'app_blueprint')
    ).toBe(false);
    expect(
      body.messages.some(
        (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
      )
    ).toBe(false);
    expect(
      body.messages.some(
        (message: unknown) =>
          message.metadataJson?.intent === 'intake' &&
          message.metadataJson?.jobSelection?.jobType === 'general_answer'
      )
    ).toBe(true);
  });

  it('shows an SFA dashboard request as an app blueprint artifact', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create an SFA dashboard AppBlueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        id: 'sfa-dashboard',
        name: 'SFA Dashboard',
        description: 'Sales force automation dashboard for pipeline, activity, and alerts.',
        screens: [
          {
            ...representativeAppBlueprint.screens[0],
            id: 'sales-dashboard',
            name: 'Sales Dashboard',
            componentName: 'DashboardPage',
            sections: [
              {
                kind: 'component_section',
                ...representativeAppBlueprint.screens[0].sections[0],
                id: 'sales-kpis',
                name: 'Sales KPIs',
                componentName: 'AnalyticsDashboardSection',
              },
              {
                kind: 'component_section',
                ...representativeAppBlueprint.screens[0].sections[1],
                id: 'pipeline-table',
                name: 'Pipeline Table',
                componentName: 'DataTableSection',
              },
            ],
          },
        ],
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(body.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadataJson: expect.objectContaining({ intent: 'intake' }) }),
      ])
    );
    const blueprintMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.messageType).toBe('markdown_document');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.id).toBe('sfa-dashboard');
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens[0]?.componentName).toBe(
      'DashboardPage'
    );
    expect(blueprintMessage?.content).toContain('Sales KPIs');
    expect(blueprintMessage?.content).toContain('Pipeline Table');
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.promptDiagnostics).toEqual(
      expect.objectContaining({
        schemaIncluded: true,
        catalogComponentCount: expect.any(Number),
        referenceDocumentCount: expect.any(Number),
      })
    );
  });

  it('records raw LLM output when blueprint generation returns non-json', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce('not json');
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '[Procedure Reference: references/work_kinds/blueprint.md]'
    );
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0]).toContain(
      '[AppBlueprint JSON Schema]'
    );
    const messages = await repo.listTaskMessages(task.id);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: 'not json',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_raw_output',
            promptDiagnostics: expect.objectContaining({
              schemaIncluded: true,
              referenceDocumentCount: expect.any(Number),
            }),
          }),
        }),
        expect.objectContaining({
          role: 'system',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_generation_failed',
            rawOutputRecorded: true,
          }),
        }),
      ])
    );
    expect(messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadataJson: expect.objectContaining({ intent: 'intake' }) }),
      ])
    );
  });

  it('records raw LLM output when generated blueprint json fails catalog validation', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint artifact.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify({
        ...representativeAppBlueprint,
        designPreset: { ...representativeAppBlueprint.designPreset, theme: 'design_governance' },
      })
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'SFAのダッシュボードをblueprintで表示してください。' }),
    });

    expect(res.status).toBe(502);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    const messages = await repo.listTaskMessages(task.id);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_raw_output',
            validationStatus: 'failed',
          }),
        }),
        expect.objectContaining({
          role: 'system',
          metadataJson: expect.objectContaining({
            intent: 'blueprint_generation_failed',
            error: expect.stringContaining('designPreset.theme:design_governance'),
          }),
        }),
      ])
    );
  });

  it('drafts a markdown spec message and queues only after validation passes', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Create a Blueprint from the requested workbench spec.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify(representativeAppBlueprint)
    );
    const { task } = await createWorkbenchTask();

    const draftRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
        body: JSON.stringify({ prompt: 'チャット中心の作業台を仕様にして', intent: 'draft_spec' }),
      }
    );

    expect(draftRes.status).toBe(200);
    const draftBody = await draftRes.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(draftBody.task.status).toBe('ready');
    expect(
      draftBody.messages.some((message: unknown) => message.messageType === 'markdown_document')
    ).toBe(true);
    const blueprintMessage = draftBody.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'app_blueprint'
    );
    expect(blueprintMessage?.metadataJson?.appBlueprint?.screens).toHaveLength(1);
    expect(blueprintMessage?.metadataJson?.validation?.valid).toBe(true);
    expect(blueprintMessage?.metadataJson?.generation?.source).toBe('llm');

    await repo.updateImplementationQueueSettings({ processorCount: 1 });
    const { task: blockerTask } = await createWorkbenchTask({
      title: 'Processor blocker for draft queue',
      status: 'queued',
    });
    const blockerEntry = await repo.createImplementationQueueEntry({
      taskId: blockerTask.id,
      repositoryId: blockerTask.repositoryId,
    });
    await repo.updateImplementationQueueEntry(blockerEntry.id, {
      status: 'claimed',
      processorSlot: 1,
    });

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });
    expect(queueRes.status).toBe(200);
    const queued = await queueRes.json();
    expect(queued.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('does not treat markdown titles as implementation plan evidence for queue admission', async () => {
    const { task } = await createWorkbenchTask();
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '# Implementation Plan',
      messageType: 'markdown_document',
      metadataJson: {
        title: 'Implementation Plan',
      },
    });

    const queueRes = await app.request(`http://localhost/api/workbench/sessions/${task.id}/queue`, {
      method: 'POST',
      headers: sameOriginHeaders,
    });

    expect(queueRes.status).toBe(422);
    const body = await queueRes.json();
    expect(body.code).toBe('IMPLEMENTATION_PLAN_REQUIRED');
    expect((await repo.getTask(task.id))?.status).toBe('draft');
  });

  it('admits ready sessions to the Implementation Queue without duplicating not-queued work', async () => {
    await repo.updateImplementationQueueSettings({ processorCount: 1 });
    const { task: blockerTask } = await createWorkbenchTask({
      title: 'Processor blocker',
      status: 'queued',
    });
    const blockerEntry = await repo.createImplementationQueueEntry({
      taskId: blockerTask.id,
      repositoryId: blockerTask.repositoryId,
    });
    await repo.updateImplementationQueueEntry(blockerEntry.id, {
      status: 'claimed',
      processorSlot: 1,
    });
    const { task } = await createWorkbenchTask({ status: 'ready' });

    const res = await app.request('http://localhost/api/implementation-queue/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ taskId: task.id }),
    });

    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry).toMatchObject({ taskId: task.id, status: 'queued' });
    expect((await repo.getTask(task.id))?.status).toBe('queued');

    const dashboardRes = await app.request('http://localhost/api/implementation-queue', {
      headers: sameOriginHeaders,
    });
    expect(dashboardRes.status).toBe(200);
    const dashboard = await dashboardRes.json();
    expect(dashboard.queued.map((queueEntry: unknown) => queueEntry.task.id)).toContain(task.id);
    expect(dashboard.notQueued.map((item: unknown) => item.task.id)).not.toContain(task.id);

    const duplicateRes = await app.request(
      `http://localhost/api/workbench/sessions/${task.id}/queue`,
      {
        method: 'POST',
        headers: sameOriginHeaders,
      }
    );
    expect(duplicateRes.status).toBe(409);
    expect((await duplicateRes.json()).code).toBe('QUEUE_ENTRY_EXISTS');
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
