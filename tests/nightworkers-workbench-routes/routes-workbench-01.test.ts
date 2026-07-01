import crypto from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as generalSettings from '../../api/services/settings/general-settings';
import * as llm from '../../api/services/structured-llm';
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

function expectStrictObjectSchemas(schema: unknown, path = 'schema') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        expectStrictObjectSchemas(propertySchema, `${path}.properties.${propertyName}`);
      }
      continue;
    }
    if (key === 'items') {
      expectStrictObjectSchemas(value, `${path}.items`);
      continue;
    }
    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      value.forEach((item, index) => {
        expectStrictObjectSchemas(item, `${path}.${key}.${index}`);
      });
    }
  }
}

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

beforeEach(() => {
  delete process.env.IMPLEMENTATION_RUNTIME_LANE;
  process.env.NIGHTWORKERS_RUNTIME_LANE = 'native-api-runner';
  vi.mocked(llm.callStructuredJsonLLM).mockResolvedValue(mockPlanModeGate(false));
});

afterEach(async () => {
  await flushPendingWorkbenchTasks();
  delete process.env.IMPLEMENTATION_RUNTIME_LANE;
  process.env.NIGHTWORKERS_RUNTIME_LANE = 'native-api-runner';
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('creates a draft workbench session without starting a run', async () => {
    const project = await repo.createRepository({
      name: 'TEST: Workbench Project',
      localPath: '/Users/y.noguchi/Code/nightWorkers',
      branch: 'main',
    });

    const res = await app.request('http://localhost/api/workbench/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        repositoryId: project.id,
        title: 'Workbench draft',
      }),
    });

    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.status).toBe('draft');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('stores draft conversation messages without creating a run', async () => {
    const { task } = await createWorkbenchTask();

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'まず方針を相談したい', intent: 'draft' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(body.task.status).toBe('draft');
    expect(body.messages.some((message: unknown) => message.role === 'user')).toBe(true);
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(body.messages.some((message: unknown) => message.role === 'assistant')).toBe(false);
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('routes active Blueprint artifact instructions without round 1 intake or rewriting the user message', async () => {
    const { task } = await createWorkbenchTask();

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '検索とフィルターはボードの上に置いてください',
        intent: 'draft',
        artifactContext: {
          artifactId: 'message-blueprint-1',
          kind: 'app_blueprint',
          title: 'Blueprint: Kanban System Blueprint',
          summary: 'KanbanSection を含む Blueprint Preview',
          source: { type: 'task_message', messageId: crypto.randomUUID() },
          metadata: {
            intent: 'app_blueprint',
            appBlueprintName: 'Kanban System Blueprint',
            screenNames: ['Kanban Workspace'],
            sectionNames: ['Kanban Workspace', 'Boards and Filters'],
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const userMessage = body.messages.find((message: unknown) => message.role === 'user');
    expect(userMessage.content).toBe('検索とフィルターはボードの上に置いてください');
    expect(userMessage.metadataJson.artifactContext.title).toBe(
      'Blueprint: Kanban System Blueprint'
    );
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    const llmPrompt = vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[1] as string;
    expect(llmPrompt).toContain('[Current Artifact Context]');
    expect(llmPrompt).toContain('Blueprint: Kanban System Blueprint');
    expect(llmPrompt).toContain('Sections: Kanban Workspace, Boards and Filters');
    expect(llmPrompt).toContain('[User Instruction]');
    expect(llmPrompt).toContain('検索とフィルターはボードの上に置いてください');
    expect(
      body.messages.some(
        (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
      )
    ).toBe(false);
  });

  it('passes DB Design artifact context with table names to workbench intake', async () => {
    const { task } = await createWorkbenchTask();

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'カード履歴テーブルは不要です',
        intent: 'draft',
        artifactContext: {
          artifactId: 'message-db-design-1',
          kind: 'blueprint_workspace',
          title: 'DB Design: Kanban DB Design',
          summary: 'Kanban DB schema',
          source: { type: 'task_message', messageId: crypto.randomUUID() },
          metadata: {
            intent: 'app_blueprint',
            artifactType: 'blueprint_db_design',
            appBlueprintName: 'Kanban DB Design',
            tableNames: ['boards', 'columns', 'cards'],
            initialTab: 'db-design',
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const userMessage = body.messages.find((message: unknown) => message.role === 'user');
    expect(userMessage.content).toBe('カード履歴テーブルは不要です');
    expect(userMessage.metadataJson.artifactContext.metadata.artifactType).toBe(
      'blueprint_db_design'
    );
    const llmPrompt = vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[1] as string;
    expect(llmPrompt).toContain('Artifact type: blueprint_db_design');
    expect(llmPrompt).toContain('Workspace tab: db-design');
    expect(llmPrompt).toContain('Tables: boards, columns, cards');
    expect(llmPrompt).toContain('カード履歴テーブルは不要です');
  });

  it('starts a docs run for normal intake without persisting the round 1 response as chat', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページを作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(body.task.objective).toBe('ECサイトのトップページを作ってください');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('needs_human');
    });
  });

  it('starts Plan mode artifacts and questionnaire for planning intake', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });
    vi.mocked(llm.callStructuredJsonLLM)
      .mockResolvedValueOnce(mockPlanModeGate(true, 'explicit planning request'))
      .mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          source: {
            taskId: task.id,
            repositoryId: task.repositoryId,
            blueprintMessageId: null,
            sourceKind: 'plan_mode_intake',
          },
          title: 'Kanban Design Questionnaire',
          summary: 'Clarify Kanban workflow decisions before implementation.',
          questionSets: [
            {
              id: 'workflow',
              title: 'Workflow',
              category: 'workflow',
              purpose: 'Kanban workflow decisions.',
              questions: [
                {
                  id: 'lane-model',
                  topic: 'Lane model',
                  question: 'Which lane model should the first version support?',
                  why: 'The lane model affects UI and DB design.',
                  answerType: 'single_choice',
                  options: [
                    {
                      id: 'fixed-lanes',
                      label: 'Fixed lanes',
                      description: 'Start with todo, doing, done.',
                      tradeoff: 'Simple first release.',
                    },
                  ],
                  blocks: ['Board UI', 'Task schema'],
                  outputSection: 'Kanban workflow',
                },
              ],
            },
          ],
          openQuestions: [],
          dbDesignHandoffNotes: [
            {
              id: 'card-lane-history',
              summary: 'Card lane transitions may need history.',
              sourceQuestionIds: ['lane-model'],
              constraint: 'DB Design should decide whether lane transition history is stored.',
            },
          ],
        })
      );

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'kanbanアプリの実装計画を作ってください',
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        thinkingDepth: 'medium',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(2);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]).toMatchObject({
      routeOverride: {
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        thinkingDepth: 'medium',
      },
    });
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schema).toMatchObject({
      properties: {
        shouldStartPlanMode: { type: 'boolean' },
        action: { type: 'string' },
        reason: { type: 'string' },
      },
    });
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[1]?.[2]).toMatchObject({
      role: 'plan',
      routeOverride: {
        providerEndpointId: 'local-qwen',
        model: 'qwen3-coder',
        thinkingDepth: 'medium',
      },
    });
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[1]?.[2]?.schema).toMatchObject({
      properties: {
        title: { type: 'string' },
        questions: {
          type: 'array',
        },
      },
    });
    expectStrictObjectSchemas(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schema);
    expectStrictObjectSchemas(vi.mocked(llm.callStructuredJsonLLM).mock.calls[1]?.[2]?.schema);
    expect(
      body.messages.some(
        (message: unknown) => message.role === 'assistant' && message.content.includes('jobType:')
      )
    ).toBe(false);
    const questionnaireReadyMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
    );
    expect(questionnaireReadyMessage).toMatchObject({
      role: 'system',
      metadataJson: expect.objectContaining({
        questionnaireStatus: 'answering',
        totalQuestionCount: 1,
        planModeGate: expect.objectContaining({ shouldStartPlanMode: true }),
      }),
    });
    expect(questionnaireReadyMessage.content).toContain('Design Questionnaire を生成しました');
    expect(
      body.messages.some((message: unknown) => message.metadataJson?.intent === 'app_blueprint')
    ).toBe(false);
    const workspaceRes = await app.request(
      `http://localhost/api/tasks/${task.id}/specification-workspace`,
      { headers: sameOriginHeaders }
    );
    expect(workspaceRes.status).toBe(200);
    const workspace = await workspaceRes.json();
    expect(workspace.blueprintArtifacts).toHaveLength(0);
    expect(workspace.questionnaireSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceBlueprintMessageId: null,
          status: 'answering',
          totalQuestionCount: 1,
        }),
      ])
    );
  });

  it('starts a planning run instead of questionnaire when Questionnaire Plan Mode is disabled', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });
    vi.spyOn(generalSettings, 'readGeneralSettings').mockReturnValue({
      ...generalSettings.DEFAULT_GENERAL_SETTINGS,
      planMode: {
        capabilities: {
          ...generalSettings.DEFAULT_GENERAL_SETTINGS.planMode.capabilities,
          questionnaire: false,
        },
      },
    });
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(true, 'explicit planning request')
    );

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '実装計画書を作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      executionMode: 'planning',
      planModeSettingsSnapshot: {
        disabledCapabilities: ['questionnaire'],
      },
    });
    const sessionsRes = await app.request(
      `http://localhost/api/tasks/${task.id}/design-questionnaire`,
      { headers: sameOriginHeaders }
    );
    expect(await sessionsRes.json()).toEqual([]);
    const systemMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson).toMatchObject({
      executionMode: 'planning',
      planModeGate: { action: 'plan_mode', shouldStartPlanMode: true },
      planModeSettingsSnapshot: { disabledCapabilities: ['questionnaire'] },
    });
    await vi.waitFor(async () => {
      const latestRuns = await repo.listTaskRunsForTask(task.id);
      expect(latestRuns[0]?.status).toBe('completed');
    });
  });

  it('prefers Plan mode for project evaluation tasks until plan evidence exists', async () => {
    const { task } = await createWorkbenchTask({
      title: 'Evaluation improvement',
      createdBy: 'project-evaluation',
    });
    vi.mocked(llm.callStructuredJsonLLM)
      .mockResolvedValueOnce(mockPlanModeGate(false, 'looks like implementation', 'implementation'))
      .mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          source: {
            taskId: task.id,
            repositoryId: task.repositoryId,
            blueprintMessageId: null,
            sourceKind: 'plan_mode_intake',
          },
          title: 'Improvement Plan Questionnaire',
          summary: 'Clarify project evaluation improvement scope before implementation.',
          questionSets: [
            {
              id: 'scope',
              title: 'Scope',
              category: 'workflow',
              purpose: 'Confirm improvement scope.',
              questions: [
                {
                  id: 'scope-boundary',
                  topic: 'Scope boundary',
                  question: 'Which part of the improvement should be implemented first?',
                  why: 'Project evaluation improvements should start with a bounded plan.',
                  answerType: 'free_text',
                  options: [],
                  blocks: ['Implementation Plan'],
                  outputSection: 'Scope',
                },
              ],
            },
          ],
          openQuestions: [],
          dbDesignHandoffNotes: [],
        })
      );

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'この改善案を実装してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(2);
    const questionnaireReadyMessage = body.messages.find(
      (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
    );
    expect(questionnaireReadyMessage?.metadataJson?.planModeGate).toMatchObject({
      shouldStartPlanMode: true,
      action: 'plan_mode',
      originalGate: expect.objectContaining({
        shouldStartPlanMode: false,
        action: 'implementation',
      }),
    });
  });

  it('keeps first-message planning intake on the design questionnaire path even when codex-agent is the runtime lane', async () => {
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'codex-agent';
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });
    vi.mocked(llm.callStructuredJsonLLM)
      .mockResolvedValueOnce(mockPlanModeGate(true, 'explicit planning request'))
      .mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          source: {
            taskId: task.id,
            repositoryId: task.repositoryId,
            blueprintMessageId: null,
            sourceKind: 'plan_mode_intake',
          },
          title: 'Todo Design Questionnaire',
          summary: 'Clarify todo app decisions before implementation.',
          questionSets: [
            {
              id: 'scope',
              title: 'Scope',
              category: 'product',
              purpose: 'Todo scope decisions.',
              questions: [
                {
                  id: 'first-version',
                  topic: 'First version',
                  question: 'What should the first version include?',
                  why: 'This shapes the implementation plan.',
                  answerType: 'single_choice',
                  options: [
                    {
                      id: 'basic-crud',
                      label: 'Basic CRUD',
                      description: 'Add, edit, complete, delete todos.',
                      tradeoff: 'Small first release.',
                    },
                  ],
                  blocks: ['Todo UI', 'Todo API'],
                  outputSection: 'Scope',
                },
              ],
            },
          ],
          openQuestions: [],
          dbDesignHandoffNotes: [],
        })
      );

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'todo list 管理Webアプリを作りたいです。 react hono sqliteで計画してください',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(2);
    expect(
      body.messages.some(
        (message: unknown) =>
          message.role === 'system' && message.metadataJson?.intent === 'design_questionnaire_ready'
      )
    ).toBe(true);
    expect(
      body.messages.some(
        (message: unknown) =>
          message.role === 'system' && message.metadataJson?.intakeBypass?.skippedRound1
      )
    ).toBe(false);
  });

  it('does not leave an empty questionnaire draft when planning questionnaire generation fails', async () => {
    vi.mocked(llm.callStructuredJsonLLM)
      .mockResolvedValueOnce(mockPlanModeGate(true, 'explicit planning request'))
      .mockRejectedValueOnce(new Error('invalid_json_schema: version schema must have a type key'));
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'kanbanアプリの実装計画を作ってください' }),
    });

    expect(res.status).toBe(502);
    expect(await repo.listDesignQuestionnaireSessionsForTask(task.id)).toHaveLength(0);
  });

  it('starts a general-answer run for questions without reopening Plan Mode or implementation Todos', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'question only', 'general_answer')
    );
    const { task } = await createWorkbenchTask({
      title: 'Todo List',
      status: 'completed',
      objective: 'Todo List を実装する',
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '## 仕様\nTodo List の実装仕様',
      messageType: 'markdown_document',
      payloadJson: { intent: 'draft_spec', source: 'status_document_review' },
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'バックエンド使わない構成でしょうか？' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('General answer run started');
    expect(systemMessage?.metadataJson).toMatchObject({
      executionMode: 'general_answer',
      planModeGate: { shouldStartPlanMode: false, action: 'general_answer' },
    });
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      executionMode: 'general_answer',
      executionModeSource: 'workbench_intake',
    });
    expect(runs[0]?.contextSnapshot).not.toHaveProperty('blueprintPlanning');
    expect(String(runs[0]?.contextSnapshot?.compiledPrompt || '')).not.toContain(
      '<IMPLEMENTATION_HANDOFF>'
    );
    expect(await repo.listTaskRunTodosForRun(runs[0]?.id || '')).toEqual([]);
    const events = await repo.listTaskEventsForRun(runs[0]?.id || '');
    expect(
      events.some((event) => event.message.includes('general_answer LLM route resolved'))
    ).toBe(true);
  });

  it('passes recent answer and prior implementation run context to intake for continue requests', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'continue previous implementation', 'implementation')
    );
    const { task } = await createWorkbenchTask({
      title: 'Todo List',
      status: 'completed',
      objective: 'Todo List を実装する',
    });
    await repo.createTaskRun({
      taskId: task.id,
      repositoryId: task.repositoryId,
      status: 'completed',
      contextSnapshot: { executionMode: 'implementation' },
      summary: 'バックエンド経由で SQLite に保存する形へ切り替えました。',
      finalReport: 'バックエンド経由で SQLite に保存する形へ切り替えました。',
      startedAt: new Date(Date.now() - 20_000),
      endedAt: new Date(Date.now() - 15_000),
      finishedAt: new Date(Date.now() - 15_000),
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: '継続出来ますか？',
      messageType: 'text',
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: '継続できます。',
      messageType: 'text',
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '継続してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const systemPrompt = vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[0] as string;
    const gatePrompt = vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[1] as string;
    expect(systemPrompt).toContain('直前の可否回答や状態確認に続いて');
    expect(gatePrompt).toContain('[Recent Conversation]');
    expect(gatePrompt).toContain('assistant: 継続できます。');
    expect(gatePrompt).toContain('[Current User Message]');
    expect(gatePrompt).toContain('継続してください');
    expect(gatePrompt).toContain('Latest non-general run executionMode=implementation');
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Implementation run started');
    expect(systemMessage?.metadataJson?.executionMode).toBe('implementation');
  });

  it('rejects reopening Plan Mode artifacts after the task is completed', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(true, 'explicit planning request')
    );
    const { task } = await createWorkbenchTask({
      title: 'Todo List',
      status: 'completed',
      objective: 'Todo List を実装する',
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '実装計画をもう一度作ってください' }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('PLAN_MODE_READ_ONLY');
    expect(await repo.listDesignQuestionnaireSessionsForTask(task.id)).toHaveLength(0);
  });

  it('starts an implementation run for code-change intake without persisting the round 1 response as chat', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Implementation run started');
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(body.task.status).toBe('running');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('needs_human');
    });
  });

  it('starts a runtime debug run from intake instead of leaving only a classifier message', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'runtime debug', 'runtime_debug')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'あなたの完了報告と異るポートが使われています。5173　本当にあってますか？',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Runtime debug run started');
    expect(systemMessage?.metadataJson?.executionMode).toBe('runtime_debug');
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      executionPhase: 'runtime_debug',
      executionModeSource: 'workbench_intake',
      planModeClosed: true,
    });
    await vi.waitFor(async () => {
      const latestRuns = await repo.listTaskRunsForTask(task.id);
      expect(latestRuns[0]?.status).toBe('needs_human');
    });
  });

  it('starts a review run from intake instead of leaving only a classifier message', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'review request', 'review')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'コードレビューから再開できますか？' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    expect(
      body.messages.find(
        (message: unknown) =>
          message.role === 'assistant' && message.metadataJson?.intent === 'intake'
      )
    ).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Review run started');
    expect(systemMessage?.metadataJson?.executionMode).toBe('review');
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      executionPhase: 'review',
      executionModeSource: 'workbench_intake',
      planModeClosed: true,
    });
  });

  it('starts an investigation run from intake without routing through planning', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'runtime debug', 'runtime_debug')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '最新ログから原因を調査してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Runtime debug run started');
    expect(systemMessage?.metadataJson?.executionMode).toBe('runtime_debug');
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
  });

  it('starts a verification run from intake without routing through planning', async () => {
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      mockPlanModeGate(false, 'runtime debug', 'runtime_debug')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'テストを実行して確認してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Runtime debug run started');
    expect(systemMessage?.metadataJson?.executionMode).toBe('runtime_debug');
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
  });

  it('starts a config implementation run from intake without routing through planning', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '設定ファイルの軽微な修正をしてください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs[0]?.contextSnapshot).toMatchObject({
      executionPhase: 'implementation',
      executionModeSource: 'workbench_intake',
    });
  });

  it('keeps prior-message intake on round 1 instead of using the Codex intake bypass', async () => {
    process.env.NIGHTWORKERS_RUNTIME_LANE = 'codex-agent';
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'user',
      content: '既存の計画があります。',
      messageType: 'text',
      payloadJson: null,
    });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '実際に使われているポート番号を確認してください',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    const runs = await repo.listTaskRunsForTask(task.id);
    expect(runs).toHaveLength(1);
    const systemMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.intakeBypass).toBeUndefined();
    expect(systemMessage?.metadataJson?.planModeGate?.shouldStartPlanMode).toBe(false);
    expect(systemMessage?.metadataJson?.intakeJobSelection).toBeUndefined();
    expect(systemMessage?.metadataJson?.routingHypothesis).toBeUndefined();
    await vi.waitFor(async () => {
      const updatedRuns = await repo.listTaskRunsForTask(task.id);
      expect(updatedRuns[0]?.status).toBe('needs_human');
    });
  });

  it('does not fall back to fixed intake prose for non-running code-edit decisions', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
        intent: 'draft_spec',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    const assistantMessage = body.messages.find(
      (message: unknown) =>
        message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
  });

  it('starts a normal implementation run without recording a classifier message', async () => {
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '空のdecisionでも表示してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(
      body.messages.find((message: unknown) => message.metadataJson?.intent === 'intake')
    ).toBe(undefined);
  });
});

async function createWorkbenchTask(
  input: { title?: string; status?: string; objective?: string; createdBy?: string } = {}
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
    createdBy: input.createdBy,
  });
  return { project, task };
}
