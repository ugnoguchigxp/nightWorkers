import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../../api/app';
import { ensureNightWorkersSchema } from '../../api/db/bootstrap';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as service from '../../api/modules/nightworkers/nightworkers.service';
import * as llm from '../../api/services/supervisor/llm-provider';
import { representativeAppBlueprint } from '../fixtures/app-blueprint';

vi.mock('../../api/services/supervisor/llm-provider', async () => {
  const actual = await vi.importActual<typeof import('../../api/services/supervisor/llm-provider')>(
    '../../api/services/supervisor/llm-provider'
  );
  return {
    ...actual,
    callSupervisorLLM: vi.fn(),
    callStructuredJsonLLM: vi.fn(),
  };
});

vi.mock('../../api/services/agent-runtime/registry', () => ({
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

function _expectStrictObjectSchemas(schema: unknown, path = 'schema') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, any>;
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
  await new Promise((resolve) => setTimeout(resolve, 25));
  vi.clearAllMocks();
});

describe('NightWorkers workbench routes', () => {
  it('keeps plan-mode AI responses available for queued sessions without starting a run', async () => {
    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce(
      mockJobSelection('blueprint', 'Update the queued plan as a Blueprint.')
    );
    vi.mocked(llm.callStructuredJsonLLM).mockResolvedValueOnce(
      JSON.stringify(representativeAppBlueprint)
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
    expect(llm.callSupervisorLLM).toHaveBeenCalledTimes(1);
    expect(llm.callStructuredJsonLLM).toHaveBeenCalledTimes(1);
    expect(body.task.status).toBe('queued');
    expect(await repo.listTaskRunsForTask(task.id)).toHaveLength(0);
    expect(
      body.messages.some((message: any) => message.metadataJson?.intent === 'app_blueprint')
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
