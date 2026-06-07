import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../../api/services/supervisor/llm-provider';

vi.mock('../api/services/supervisor/llm-provider', async () => {
  const actual = await vi.importActual<typeof import('../api/services/supervisor/llm-provider')>(
    '../api/services/supervisor/llm-provider'
  );
  return {
    ...actual,
    callSupervisorLLM: vi.fn(),
    callStructuredJsonLLM: vi.fn(),
  };
});

vi.mock('../api/services/agent-runtime/registry', () => ({
  resolveAgentRuntime: vi.fn(() => ({
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
  })),
}));

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

function mockJobSelection(jobType: string, goal: string) {
  return { jobType, goal };
}

function expectStrictObjectSchemas(schema: unknown, path = 'schema') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, any>;
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

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25));
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
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('general_answer', '相談内容を整理して次の一手を提案します。')
    );
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
    expect(body.messages.some((message: any) => message.role === 'user')).toBe(true);
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(body.messages.some((message: any) => message.role === 'assistant')).toBe(true);
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
  });

  it('starts a docs run for normal intake without persisting the round 1 response as chat', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('docs', 'Analyze the goal and propose the next implementation step.')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'ECサイトのトップページを作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(body.run).toMatchObject({ taskId: task.id, status: 'running' });
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(1);
    const assistantMessage = body.messages.find(
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: any) => message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.metadataJson?.intakeJobSelection?.jobType).toBe('docs');
    expect(body.task.objective).toBe('ECサイトのトップページを作ってください');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('completed');
    });
  });

  it('starts Plan mode artifacts and questionnaire for planning intake', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('planning', 'kanbanアプリの実装方針を整理し、主要機能と作業順を決める')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
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
      body: JSON.stringify({ prompt: 'kanbanアプリの実装計画を作ってください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schema).toMatchObject({
      properties: {
        title: { type: 'string' },
        questions: {
          type: 'array',
        },
      },
    });
    expectStrictObjectSchemas(vi.mocked(llm.callStructuredJsonLLM).mock.calls[0]?.[2]?.schema);
    expect(
      body.messages.some(
        (message: any) => message.role === 'assistant' && message.content.includes('jobType:')
      )
    ).toBe(false);
    expect(
      body.messages.some((message: any) => message.metadataJson?.intent === 'app_blueprint')
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

  it('does not leave an empty questionnaire draft when planning questionnaire generation fails', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('planning', 'kanbanアプリの実装方針を整理する')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockRejectedValueOnce(
      new Error('invalid_json_schema: version schema must have a type key')
    );
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: 'kanbanアプリの実装計画を作ってください' }),
    });

    expect(res.status).toBe(502);
    expect(await repo.listDesignQuestionnaireSessionsForTask(task.id)).toHaveLength(0);
  });

  it('starts an implementation run for code-change intake without persisting the round 1 response as chat', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('minor_code_edit', '`fizzbuzz.ts` をプロジェクトルートに追加する。')
    );
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
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage).toBeUndefined();
    const systemMessage = body.messages.find(
      (message: any) => message.role === 'system' && message.metadataJson?.intent === 'run_started'
    );
    expect(systemMessage?.content).toContain('Implementation run started');
    expect(systemMessage?.metadataJson?.intakeJobSelection?.goal).toContain('fizzbuzz.ts');
    expect(body.task.status).toBe('running');
    await vi.waitFor(async () => {
      const runs = await repo.listTaskRunsForTask(task.id);
      expect(runs[0]?.status).toBe('completed');
      const messages = await repo.listTaskMessages(task.id);
      expect(messages.some((message) => message.content === 'Runtime completed.')).toBe(true);
    });
  });

  it('does not fall back to fixed intake prose for non-running code-edit decisions', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('minor_code_edit', '`fizzbuzz.ts` をプロジェクトルートに追加する。')
    );
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
      (message: any) => message.role === 'assistant' && message.metadataJson?.intent === 'intake'
    );
    expect(assistantMessage?.content).toContain('jobType: minor_code_edit');
    expect(assistantMessage?.content).toContain('fizzbuzz.ts');
  });

  it('records a visible intake message even when the LLM job selection has no goal text', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(mockJobSelection('general_answer', ''));
    const { task } = await createWorkbenchTask({ title: 'New Session', objective: '' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({ prompt: '空のdecisionでも表示してください' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('jobType: general_answer'),
          metadataJson: expect.objectContaining({
            intent: 'intake',
            jobSelection: expect.objectContaining({ jobType: 'general_answer', goal: '' }),
          }),
        }),
      ])
    );
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
