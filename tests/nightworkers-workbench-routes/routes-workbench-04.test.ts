import crypto from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as service from '../../api/modules/nightworkers/nightworkers.service';
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
  action: 'plan_mode' | 'general_answer' | 'implementation' = shouldStartPlanMode
    ? 'plan_mode'
    : 'implementation'
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
  vi.mocked(llm.callStructuredJsonLLM).mockResolvedValue(mockPlanModeGate(false));
});

afterEach(async () => {
  await flushPendingWorkbenchTasks();
  vi.clearAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('keeps plan-mode AI responses available for queued sessions without starting a run', async () => {
    vi.mocked(llm.callStructuredJsonLLM)
      .mockResolvedValueOnce(mockPlanModeGate(true, 'explicit planning request'))
      .mockResolvedValueOnce(
        JSON.stringify({
          version: 1,
          source: {
            taskId: 'queued-task',
            repositoryId: 'queued-repo',
            blueprintMessageId: null,
            sourceKind: 'plan_mode_intake',
          },
          title: 'Queued Plan Questionnaire',
          summary: 'Clarify the queued plan before implementation.',
          questionSets: [
            {
              id: 'scope',
              title: 'Scope',
              category: 'workflow',
              purpose: 'Clarify queued plan scope.',
              questions: [
                {
                  id: 'target',
                  topic: 'Target',
                  question: 'What should be refined first?',
                  why: 'The next implementation depends on scope.',
                  answerType: 'single_choice',
                  options: [
                    {
                      id: 'ui',
                      label: 'UI',
                      description: 'Refine UI first.',
                      tradeoff: 'Keeps implementation focused.',
                    },
                  ],
                  blocks: ['Implementation'],
                  outputSection: 'Scope',
                },
              ],
            },
          ],
          openQuestions: [],
          dbDesignHandoffNotes: [],
        })
      );
    const { task } = await createWorkbenchTask({ status: 'queued' });

    const res = await app.request(`http://localhost/api/workbench/sessions/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sameOriginHeaders },
      body: JSON.stringify({
        prompt: '実装前に計画をもう少し具体化して',
        intent: 'draft_spec',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run).toBeNull();
    expect(llm.callSupervisorLLM).not.toHaveBeenCalled();
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(2);
    expect(body.task.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(
      body.messages.some((message: unknown) => message.metadataJson?.intent === 'app_blueprint')
    ).toBe(false);
    expect(
      body.messages.some(
        (message: unknown) => message.metadataJson?.intent === 'design_questionnaire_ready'
      )
    ).toBe(true);
  });

  it('prefers adopted Blueprint artifacts over newer generated Blueprint messages for planning', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    const adoptedMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Adopted Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'adopted-blueprint' },
      },
    });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Newer generated Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'newer-generated-blueprint' },
      },
    });
    await repo.upsertBlueprintArtifactAdoption(task.id, adoptedMessage.id, true);

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'adopted',
      diagnostic: 'adopted_blueprint',
      messageId: adoptedMessage.id,
      blueprint: { id: 'adopted-blueprint' },
    });
  });

  it('uses the latest generated Blueprint only when no artifact is adopted', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });
    await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Older Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'older-blueprint' },
      },
    });
    const latestMessage = await repo.createTaskMessage({
      taskId: task.id,
      role: 'assistant',
      content: 'Latest Blueprint',
      messageType: 'markdown_document',
      payloadJson: {
        intent: 'app_blueprint',
        appBlueprint: { ...representativeAppBlueprint, id: 'latest-blueprint' },
      },
    });

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'latest_generated',
      diagnostic: 'using_latest_generated_blueprint',
      messageId: latestMessage.id,
      blueprint: { id: 'latest-blueprint' },
    });
  });

  it('emits a stable diagnostic when no Blueprint artifact is available for planning', async () => {
    const { task } = await createWorkbenchTask({ status: 'ready' });

    const readiness = await service.resolveBlueprintPlanningReadiness(task.id);

    expect(readiness).toMatchObject({
      source: 'none',
      diagnostic: 'no_adopted_blueprint',
      messageId: null,
      blueprint: null,
    });
    expect(readiness.summary).toContain('No adopted Blueprint artifact');
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
