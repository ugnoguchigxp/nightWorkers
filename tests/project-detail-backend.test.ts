import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const structuredLlmFixture = vi.hoisted(() => ({
  nextOutput: null as string | null,
}));

vi.mock('../api/services/structured-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/services/structured-llm')>();
  return {
    ...actual,
    callStructuredJsonLLM: vi.fn(async (_systemPrompt, _userPrompt, options) => {
      await options.emitEvent?.({
        type: 'model.request_started',
        severity: 'info',
        message: 'fixture request started',
        data: {
          provider: 'fixture',
          providerEndpointId: 'fixture-mission',
          routeSource: 'primary',
          model: 'fixture-mission-model',
        },
      });
      if (structuredLlmFixture.nextOutput) return structuredLlmFixture.nextOutput;
      return JSON.stringify({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: 'package.json に coverage と E2E scripts を追加する',
            summary: 'Quality capability 欠落を解消するため test:coverage と test:e2e を整備する。',
            rationale: 'Quality 実行 API は存在しない script を推測実行しないため。',
            evidence: [
              {
                source: 'quality',
                label: 'missing capability',
                value: 'coverage / e2e scripts are missing in package.json',
              },
            ],
            evaluationContribution: 12,
            importancePercent: 96,
            confidencePercent: 86,
            tokenSize: 'small',
            complexity: 'simple',
            taskPrompt: 'package.json に test:coverage と test:e2e scripts を追加してください。',
            acceptanceCriteria: 'Quality capability が runnable として検出される。',
            verificationPlan: 'GET /quality で missingCapabilities が解消されることを確認する。',
          },
        ],
      });
    }),
  };
});

import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as nightworkersRepo from '../api/modules/nightworkers/nightworkers.repository';
import { recordLlmUsage } from '../api/services/llm-usage';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

afterEach(() => {
  structuredLlmFixture.nextOutput = null;
});

async function createRepository(repoRoot: string) {
  const res = await app.request('http://localhost/api/repositories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `TEST: Project Detail ${crypto.randomUUID()}`,
      localPath: repoRoot,
      branch: 'main',
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('Project Detail backend', () => {
  it('supports mission goal CRUD and metrics empty state', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const metricsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/project-detail/metrics`
      );
      expect(metricsRes.status).toBe(200);
      await expect(metricsRes.json()).resolves.toMatchObject({
        runs: { total: 0, completed: 0, failed: 0 },
        health: { latestEvaluationScore: null, coverageAverage: null },
      });

      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Coverage',
            goalText: 'Coverage を維持する。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      const goal = (await createGoalRes.json()) as { id: string };

      const patchRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals/${goal.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: false }),
        }
      );
      expect(patchRes.status).toBe(200);
      expect((await patchRes.json()).active).toBe(false);

      const deleteRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals/${goal.id}`,
        { method: 'DELETE', headers: { Origin: 'http://localhost:39174' } }
      );
      expect(deleteRes.status).toBe(200);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns project detail LLM usage input and output breakdowns', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-usage-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const task = await nightworkersRepo.createTask({
        repositoryId: project.id,
        title: 'TEST: Token-heavy BBS implementation',
        status: 'completed',
      });

      await recordLlmUsage({
        taskId: task.id,
        runId: null,
        callId: crypto.randomUUID(),
        provider: 'fixture-provider',
        model: 'gpt-test',
        label: 'codex-runtime',
        usage: {
          inputTokens: 1200,
          outputTokens: 45,
          cachedInputTokens: 300,
          reasoningOutputTokens: 6,
          totalTokens: 1245,
          mode: 'measured',
          rawUsage: { input_tokens: 1200, output_tokens: 45 },
        },
        promptPartTokenEstimates: {
          systemPromptTokens: 100,
          userPromptTokens: 200,
          stateCardTokens: 30,
        },
        durationMs: 25,
      });

      const metricsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/project-detail/metrics`
      );

      expect(metricsRes.status).toBe(200);
      await expect(metricsRes.json()).resolves.toMatchObject({
        llmUsage: {
          totalTokens: 1245,
          promptInputTokens: 330,
          inputTokens: 1200,
          outputTokens: 45,
          cachedInputTokens: 300,
          reasoningOutputTokens: 6,
          stateCardTokens: 30,
          callCount: 1,
          modelMix: [
            expect.objectContaining({
              provider: 'fixture-provider',
              model: 'gpt-test',
              calls: 1,
              tokens: 1245,
              inputTokens: 1200,
              outputTokens: 45,
              cachedInputTokens: 300,
              reasoningOutputTokens: 6,
            }),
          ],
          topTokenTasks: [
            expect.objectContaining({
              taskId: task.id,
              title: 'TEST: Token-heavy BBS implementation',
              tokens: 1245,
              inputTokens: 1200,
              outputTokens: 45,
              cachedInputTokens: 300,
              reasoningOutputTokens: 6,
            }),
          ],
        },
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('generates mission candidates and creates draft tasks', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-generate-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Quality',
            goalText: 'Quality capability を整備する。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);

      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(generateRes.status).toBe(201);
      const generated = (await generateRes.json()) as { candidates: Array<{ id: string }> };
      expect(generated.candidates).toHaveLength(1);

      const createTasksRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/create-tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateIds: [generated.candidates[0].id], mode: 'draft' }),
        }
      );
      expect(createTasksRes.status).toBe(201);
      const created = await createTasksRes.json();
      expect(created.tasks[0]).toMatchObject({
        status: 'draft',
        createdBy: 'mission-task-candidate',
      });
      expect(created.candidates[0]).toMatchObject({
        status: 'task_created',
        taskId: created.tasks[0].id,
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects mission generation when LLM returns a goal from outside the selected set', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-bad-goal-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Quality',
            goalText: 'Quality capability を整備する。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      structuredLlmFixture.nextOutput = JSON.stringify({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: '不正な goalId を持つ候補',
            summary: '別 repository の goalId を参照している。',
            rationale: '保存前に reject されるべき候補。',
            goalId: crypto.randomUUID(),
            evidence: [{ source: 'quality', label: 'missing capability', value: 'coverage' }],
            evaluationContribution: 1,
            importancePercent: 96,
            confidencePercent: 80,
            tokenSize: 'small',
            complexity: 'simple',
            taskPrompt: '不正な候補。',
            acceptanceCriteria: '保存されない。',
            verificationPlan: '400 を返す。',
          },
        ],
      });

      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(generateRes.status).toBe(400);

      const candidatesRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates`
      );
      expect(await candidatesRes.json()).toHaveLength(0);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not allow PATCH to directly mark a candidate as task_created', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-status-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Quality',
            goalText: 'Quality capability を整備する。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(generateRes.status).toBe(201);
      const generated = (await generateRes.json()) as { candidates: Array<{ id: string }> };

      const patchRes = await app.request(
        `http://localhost/api/mission-task-candidates/${generated.candidates[0].id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'task_created' }),
        }
      );
      expect(patchRes.status).toBe(400);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('rejects quality runs when required capability is missing', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-quality-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      expect(qualityRes.status).toBe(200);
      const quality = await qualityRes.json();
      expect(quality.capabilities.e2e.runnable).toBe(false);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(400);

      const runsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`
      );
      expect(await runsRes.json()).toHaveLength(0);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('persists quality run completion when coverage parsing fails', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-coverage-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'coverage'));
      fs.writeFileSync(path.join(repoRoot, 'coverage', 'coverage-summary.json'), '{broken');
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:coverage': 'echo coverage' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'unit' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.status).toBe('completed');
      expect(run.errorMessage).toContain('Failed to read coverage-summary.json');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      const quality = await qualityRes.json();
      expect(quality.runningRuns).toHaveLength(0);
      expect(quality.latestUnitRun.id).toBe(run.id);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('does not expose quality run detail through another repository route', async () => {
    const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-run-a-'));
    const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-run-b-'));
    try {
      for (const repoRoot of [firstRoot, secondRoot]) {
        fs.writeFileSync(
          path.join(repoRoot, 'package.json'),
          JSON.stringify({ scripts: { test: 'echo unit' } }),
          'utf8'
        );
      }
      const firstProject = await createRepository(firstRoot);
      const secondProject = await createRepository(secondRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${firstProject.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'unit' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();

      const mismatchRes = await app.request(
        `http://localhost/api/repositories/${secondProject.id}/quality/runs/${run.id}`
      );
      expect(mismatchRes.status).toBe(404);
    } finally {
      fs.rmSync(firstRoot, { recursive: true, force: true });
      fs.rmSync(secondRoot, { recursive: true, force: true });
    }
  });
});
