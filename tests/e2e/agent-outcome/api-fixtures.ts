import type { APIRequestContext } from '@playwright/test';
import { getJson, pollUntil } from '../helpers';
import type { AgentOutcomeScenario } from './scenarios';

const sameOriginHeaders = { Origin: 'http://localhost:39174' };

export type RunEvent = {
  id?: string;
  seq?: number;
  eventType?: string | null;
  type?: string;
  actor?: string;
  message?: string;
  payloadJson?: Record<string, unknown> | null;
};

export type RunDetails = {
  id: string;
  taskId: string;
  repositoryId?: string | null;
  status: string;
  summary?: string | null;
  finalReport?: string | null;
  diffPatch?: string | null;
  events: RunEvent[];
  reviews?: Array<Record<string, unknown>>;
};

export type TaskDetails = {
  id: string;
  status: string;
};

export type ScenarioHandles = {
  repositoryId: string;
  taskId: string;
  runId: string;
};

async function expectOkResponse(
  response: { ok: () => boolean; status: () => number; text: () => Promise<string> },
  label: string
) {
  if (response.ok()) return;
  throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
}

export async function createRepositoryForWorkspace(
  request: APIRequestContext,
  scenario: AgentOutcomeScenario,
  workspacePath: string
) {
  const response = await request.post('/api/repositories', {
    headers: sameOriginHeaders,
    data: {
      name: `Agent outcome ${scenario.id} ${Date.now()}`,
      localPath: workspacePath,
      branch: 'main',
      allowed: true,
      safetyPolicy: scenario.safetyPolicy,
    },
  });
  await expectOkResponse(response, `create repository for ${scenario.id}`);
  return (await response.json()) as { id: string };
}

export async function createTaskForScenario(
  request: APIRequestContext,
  scenario: AgentOutcomeScenario,
  repositoryId: string
) {
  const response = await request.post('/api/tasks', {
    headers: sameOriginHeaders,
    data: {
      repositoryId,
      title: `Agent outcome ${scenario.title}`,
      description: scenario.prompt,
      objective: scenario.prompt,
      acceptanceCriteria: 'Outcome evidence, workspace state, run ledger, and review result match.',
      timeoutSeconds: 60,
    },
  });
  await expectOkResponse(response, `create task for ${scenario.id}`);
  return (await response.json()) as { id: string };
}

export async function startRun(request: APIRequestContext, taskId: string) {
  const response = await request.post(`/api/tasks/${taskId}/run`, { headers: sameOriginHeaders });
  await expectOkResponse(response, `start run for task ${taskId}`);
  return (await response.json()) as { id: string };
}

export async function pollRunUntilTerminal(
  request: APIRequestContext,
  runId: string,
  timeoutMs = 45000
): Promise<RunDetails> {
  return pollUntil(
    async () => fetchRunDetails(request, runId),
    (run) =>
      [
        'needs_review',
        'completed',
        'failed',
        'cancelled',
        'needs_human',
        'blocked',
        'timed_out',
      ].includes(run.status),
    timeoutMs,
    1000
  );
}

export async function fetchRunDetails(request: APIRequestContext, runId: string) {
  return getJson<RunDetails>(request, `/api/runs/${runId}`);
}

export async function fetchTaskDetails(request: APIRequestContext, taskId: string) {
  return getJson<TaskDetails>(request, `/api/tasks/${taskId}`);
}

export async function submitReview(
  request: APIRequestContext,
  runId: string,
  action: 'complete' | 'request_follow_up' | 'cancel' | 'accept_risk',
  note = `E2E review action: ${action}`
) {
  const response = await request.post(`/api/runs/${runId}/review`, {
    headers: sameOriginHeaders,
    data: { action, note },
  });
  await expectOkResponse(response, `submit review for run ${runId}`);
  return (await response.json()) as {
    ok: boolean;
    status: string;
    reviewResult: Record<string, unknown>;
  };
}

export async function fetchJsonlExport(request: APIRequestContext, runId: string) {
  const response = await request.get(`/api/runs/${runId}/export.jsonl`);
  await expectOkResponse(response, `fetch JSONL export for run ${runId}`);
  return response.text();
}

export async function cleanupScenarioRecords(
  request: APIRequestContext,
  handles: Partial<ScenarioHandles>
) {
  if (handles.taskId) {
    await request.delete(`/api/tasks/${handles.taskId}`, { headers: sameOriginHeaders });
  }
  if (handles.repositoryId) {
    await request.delete(`/api/repositories/${handles.repositoryId}`, {
      headers: sameOriginHeaders,
    });
  }
}
