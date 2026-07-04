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
            goalId: null,
            candidateKind: 'constraint_enablement',
            moduleRouting: {
              primaryModule: 'quality',
              secondaryModules: [],
              confidencePercent: 80,
              reason: 'Quality capability scripts が不足している。',
            },
            constraintGoalIds: [],
            planModeOpenQuestions: [],
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
import * as missionPlannerRepo from '../api/modules/mission-planner/mission-planner.repository';
import * as nightworkersRepo from '../api/modules/nightworkers/nightworkers.repository';
import { buildTaskGenerationEvidence } from '../api/modules/project-detail/task-generation-evidence.service';
import { compileOntologyModuleContext } from '../api/services/agent-ontology/agent-ontology.service';
import { recordLlmUsage } from '../api/services/llm-usage';
import { upsertPricingRow } from '../api/services/pricing';

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

function writeCoverageSummary(repoRoot: string) {
  fs.mkdirSync(path.join(repoRoot, 'coverage'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        statements: { pct: 88.2 },
        branches: { pct: 81.4 },
        functions: { pct: 90 },
        lines: { pct: 87.5 },
      },
      'src/checkout.ts': {
        statements: { pct: 75 },
        branches: { pct: 64 },
        functions: { pct: 80 },
        lines: { pct: 72 },
        uncoveredLines: [12, 18],
      },
    }),
    'utf8'
  );
}

function writePlaywrightSummary(repoRoot: string) {
  fs.mkdirSync(path.join(repoRoot, 'playwright-report'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'playwright-report', 'results.json'),
    JSON.stringify({
      suites: [
        {
          title: 'checkout.spec.ts',
          specs: [
            {
              title: 'loads checkout',
              tests: [{ results: [{ status: 'passed', duration: 120 }] }],
            },
          ],
        },
      ],
    }),
    'utf8'
  );
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

      const presetsRes = await app.request('http://localhost/api/mission-goal-presets');
      expect(presetsRes.status).toBe(200);
      await expect(presetsRes.json()).resolves.toMatchObject([
        { id: 'coverage-budget', title: 'カバレッジ維持' },
        { id: 'performance-budget', title: 'パフォーマンス維持' },
        { id: 'design-token-coverage', title: 'Design Token準拠' },
        { id: 'i18n-dictionary-parity', title: 'i18n辞書同期' },
      ]);

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
      await upsertPricingRow({
        provider: 'fixture-provider',
        model: 'gpt-test',
        inputPer1m: 10,
        cachedInputPer1m: 1,
        outputPer1m: 20,
        effectiveFrom: '1970-01-01T00:00:00.000Z',
        fetchedAt: new Date().toISOString(),
        manualOverride: false,
        enabled: true,
      });

      const metricsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/project-detail/metrics`
      );

      expect(metricsRes.status).toBe(200);
      const metrics = await metricsRes.json();
      expect(metrics).toMatchObject({
        llmUsage: {
          totalTokens: 1245,
          promptInputTokens: 330,
          inputTokens: 1200,
          outputTokens: 45,
          cachedInputTokens: 300,
          reasoningOutputTokens: 6,
          stateCardTokens: 30,
          callCount: 1,
          totalCost: expect.any(Number),
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
              cost: expect.any(Number),
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
              cost: expect.any(Number),
            }),
          ],
        },
      });
      expect(metrics.llmUsage.totalCost).toBeCloseTo(0.0102);
      expect(metrics.llmUsage.modelMix[0].cost).toBeCloseTo(0.0102);
      expect(metrics.llmUsage.topTokenTasks[0].cost).toBeCloseTo(0.0102);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns detected project tech stack profile', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-stack-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          packageManager: 'bun@1.3.14',
          scripts: { test: 'vitest', build: 'vite build' },
          dependencies: {
            hono: '4.12.21',
            react: '19.2.4',
            'react-i18next': '17.0.8',
          },
          devDependencies: {
            tailwindcss: '4.0.0',
            typescript: '6.0.2',
            vite: '6.4.2',
          },
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(repoRoot, 'components.json'), '{"style":"radix-nova"}', 'utf8');
      const project = await createRepository(repoRoot);

      const metricsRes = await app.request(
        `http://localhost/api/repositories/${project.id}/project-detail/metrics`
      );

      expect(metricsRes.status).toBe(200);
      await expect(metricsRes.json()).resolves.toMatchObject({
        stackProfile: {
          summary: 'TypeScript + React + Vite + Hono',
          manifestStatus: 'found',
          packageManager: 'bun@1.3.14',
          technologies: expect.arrayContaining([
            expect.objectContaining({ name: 'TypeScript', packageName: 'typescript' }),
            expect.objectContaining({ name: 'React', packageName: 'react' }),
            expect.objectContaining({ name: 'Vite', packageName: 'vite' }),
            expect.objectContaining({ name: 'Hono', packageName: 'hono' }),
            expect.objectContaining({ name: 'i18next', packageName: 'react-i18next' }),
            expect.objectContaining({ name: 'Tailwind CSS', packageName: 'tailwindcss' }),
            expect.objectContaining({ name: 'shadcn/ui', source: 'file' }),
          ]),
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
      expect(created.tasks[0].objective).toContain(
        'この Mission Task Candidate は、まず実装計画を作成してください。'
      );
      expect(created.tasks[0].objective).toContain('[前提]');
      expect(created.tasks[0].objective).toContain('[候補の元指示]');
      expect(created.tasks[0].objective).toContain(
        'package.json に test:coverage と test:e2e scripts を追加してください。'
      );
      expect(created.tasks[0].objective).toContain('[事前に分かっている仕様]');
      expect(created.tasks[0].objective).toContain(
        '- 期待成果: Quality capability が runnable として検出される。'
      );
      expect(created.tasks[0].objective).toContain('[ユーザー定義候補 / 未確定事項]');
      expect(created.tasks[0].objective).toContain(
        'Questionnaire や Plan Mode でユーザーが定義できる仕様要素'
      );
      expect(created.tasks[0].objective).toContain('Goal: 未指定');
      expect(created.tasks[0].objective).toContain('Expected evaluation contribution: +12');
      expect(created.tasks[0].objective).toContain('[Verification]');
      expect(created.candidates[0]).toMatchObject({
        status: 'task_created',
        taskId: created.tasks[0].id,
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('skips mission candidates that duplicate existing uncreated candidates', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-dedupe-'));
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

      const firstGenerateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(firstGenerateRes.status).toBe(201);
      const firstGenerated = (await firstGenerateRes.json()) as {
        candidates: Array<{ id: string; title: string }>;
      };
      expect(firstGenerated.candidates).toHaveLength(1);

      const secondGenerateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(secondGenerateRes.status).toBe(201);
      const secondGenerated = (await secondGenerateRes.json()) as {
        candidates: Array<{ id: string; title: string }>;
      };
      expect(secondGenerated.candidates).toHaveLength(0);

      const candidatesRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates`
      );
      expect(await candidatesRes.json()).toHaveLength(1);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('removes dismissed mission task candidates from the default draft list', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-dismiss-'));
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
      const candidateId = generated.candidates[0].id;

      const dismissRes = await app.request(
        `http://localhost/api/mission-task-candidates/${candidateId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'dismissed' }),
        }
      );
      expect(dismissRes.status).toBe(200);
      expect((await dismissRes.json()).status).toBe('dismissed');

      const defaultListRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates?status=candidate`
      );
      expect(await defaultListRes.json()).toEqual([]);

      const dismissedListRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates?status=dismissed`
      );
      expect(await dismissedListRes.json()).toMatchObject([
        { id: candidateId, status: 'dismissed' },
      ]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('skips mission candidates that duplicate existing task titles', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-task-dedupe-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      await nightworkersRepo.createTask({
        repositoryId: project.id,
        title: 'package.json に coverage と E2E scripts を追加する',
        status: 'draft',
      });
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
      const generated = (await generateRes.json()) as {
        candidates: Array<{ id: string; title: string }>;
      };
      expect(generated.candidates).toHaveLength(0);

      const candidatesRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates`
      );
      expect(await candidatesRes.json()).toHaveLength(0);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('builds task generation evidence from saved mission task candidate metadata', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-evidence-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'echo coverage',
            'test:e2e': 'echo e2e',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Todo',
            goalText: 'todolist を作る。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      const featureGoal = (await createGoalRes.json()) as { id: string };

      const presetGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals/from-preset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetId: 'coverage-budget', active: true }),
        }
      );
      expect(presetGoalRes.status).toBe(201);
      const coverageGoal = (await presetGoalRes.json()) as { id: string };

      structuredLlmFixture.nextOutput = JSON.stringify({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: 'todolist 機能の初期実装計画を作成する',
            summary: 'todolist 機能を Plan Mode で定義する。',
            rationale: '本体機能が未実装。',
            goalId: featureGoal.id,
            candidateKind: 'feature_entrypoint',
            moduleRouting: {
              primaryModule: 'todolist',
              secondaryModules: [],
              confidencePercent: 42,
              reason: '新規機能のため emerging module として扱う。',
            },
            constraintGoalIds: [coverageGoal.id],
            planModeOpenQuestions: ['保存方式を決める。'],
            evidence: [{ source: 'mission_goal', label: 'goal', value: 'todolist を作る' }],
            evaluationContribution: 40,
            importancePercent: 90,
            confidencePercent: 80,
            tokenSize: 'medium',
            complexity: 'moderate',
            taskPrompt: 'Plan Mode で todolist 機能の初期実装計画を作成してください。',
            acceptanceCriteria: '初期実装計画ができる。',
            verificationPlan: '計画をレビューする。',
          },
        ],
      });

      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalIds: [featureGoal.id, coverageGoal.id] }),
        }
      );
      expect(generateRes.status).toBe(201);
      const generated = (await generateRes.json()) as {
        candidates: Array<{ id: string }>;
      };

      const evidence = await buildTaskGenerationEvidence({
        taskCandidateId: generated.candidates[0].id,
      });

      expect(evidence).toMatchObject({
        source: 'nightworkers_project_detail',
        repositoryId: project.id,
        taskCandidateId: generated.candidates[0].id,
        taskCandidate: {
          kind: 'feature_entrypoint',
          primaryModule: 'todolist',
          routingConfidencePercent: 42,
          planModeOpenQuestions: ['保存方式を決める。'],
        },
        projectWideConstraints: [
          expect.objectContaining({
            goalId: coverageGoal.id,
            title: 'カバレッジ維持',
            intent: 'maintain_threshold',
          }),
        ],
        acceptanceCriteria: ['初期実装計画ができる。'],
        verificationHints: ['計画をレビューする。'],
      });
      expect(evidence.selectedGoalIds).toEqual(
        expect.arrayContaining([featureGoal.id, coverageGoal.id])
      );

      const mission = await missionPlannerRepo.createMission({
        repositoryId: project.id,
        title: 'todolist mission',
        goalText: 'todolist を作る。',
        nonGoals: [],
        sourceGoalIds: [featureGoal.id, coverageGoal.id],
      });
      const missionEvidence = await buildTaskGenerationEvidence({
        repositoryId: project.id,
        missionId: mission.id,
      });
      expect(missionEvidence).toMatchObject({
        repositoryId: project.id,
        missionId: mission.id,
        taskCandidateId: null,
        taskCandidate: null,
        projectWideConstraints: [
          expect.objectContaining({
            goalId: coverageGoal.id,
            title: 'カバレッジ維持',
          }),
        ],
      });
      expect(missionEvidence.selectedGoalIds).toEqual(
        expect.arrayContaining([featureGoal.id, coverageGoal.id])
      );

      const repositoryEvidence = await buildTaskGenerationEvidence({
        repoPath: repoRoot,
      });
      expect(repositoryEvidence).toMatchObject({
        repositoryId: project.id,
        missionId: null,
        taskCandidateId: null,
        taskCandidate: null,
        projectWideConstraints: [
          expect.objectContaining({
            goalId: coverageGoal.id,
            title: 'カバレッジ維持',
          }),
        ],
      });

      const staleCandidateEvidence = await buildTaskGenerationEvidence({
        repositoryId: project.id,
        taskCandidateId: crypto.randomUUID(),
      });
      expect(staleCandidateEvidence).toMatchObject({
        repositoryId: project.id,
        taskCandidate: null,
        warnings: [expect.stringContaining('mission task candidate not found')],
      });

      const context = (await compileOntologyModuleContext({
        repoPath: process.cwd(),
        repositoryId: project.id,
        taskCandidateId: generated.candidates[0].id,
        goal: 'Project Detail Mission task candidate UI',
        primaryModule: 'project-detail',
      })) as {
        taskGenerationEvidence: { available: boolean; taskCandidate: { id: string } | null };
        summary: { taskScopedSummary: string };
        warnings: string[];
      };
      expect(context.taskGenerationEvidence).toMatchObject({
        available: true,
        taskCandidate: { id: generated.candidates[0].id },
      });
      expect(context.summary.taskScopedSummary).toContain('Plan mode open questions');
      expect(context.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('differs from manifest-selected module')])
      );

      const createTasksRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/create-tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateIds: [generated.candidates[0].id], mode: 'draft' }),
        }
      );
      expect(createTasksRes.status).toBe(201);
      const created = (await createTasksRes.json()) as {
        tasks: Array<{ id: string }>;
      };

      const taskLinkedEvidence = await buildTaskGenerationEvidence({
        taskId: created.tasks[0].id,
      });
      expect(taskLinkedEvidence).toMatchObject({
        repositoryId: project.id,
        taskCandidateId: generated.candidates[0].id,
        taskCandidate: {
          id: generated.candidates[0].id,
          kind: 'feature_entrypoint',
        },
      });

      const taskLinkedContext = (await compileOntologyModuleContext({
        repoPath: process.cwd(),
        taskId: created.tasks[0].id,
        goal: 'Project Detail Mission task candidate UI',
        primaryModule: 'project-detail',
      })) as {
        taskGenerationEvidence: { available: boolean; taskCandidate: { id: string } | null };
      };
      expect(taskLinkedContext.taskGenerationEvidence).toMatchObject({
        available: true,
        taskCandidate: { id: generated.candidates[0].id },
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('reactivates a mission candidate when its unimplemented task is deleted', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-reactivate-'));
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
      const candidateId = generated.candidates[0].id;

      const createTasksRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/create-tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateIds: [candidateId], mode: 'draft' }),
        }
      );
      expect(createTasksRes.status).toBe(201);
      const created = (await createTasksRes.json()) as {
        tasks: Array<{ id: string }>;
        candidates: Array<{ status: string; taskId: string | null }>;
      };
      expect(created.candidates[0]).toMatchObject({
        status: 'task_created',
        taskId: created.tasks[0].id,
      });

      const deleteTaskRes = await app.request(`http://localhost/api/tasks/${created.tasks[0].id}`, {
        method: 'DELETE',
        headers: { Origin: 'http://localhost:39174' },
      });
      expect(deleteTaskRes.status).toBe(200);

      const candidatesRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates`
      );
      expect(candidatesRes.status).toBe(200);
      const candidates = (await candidatesRes.json()) as Array<{
        id: string;
        status: string;
        taskId: string | null;
      }>;
      expect(candidates.find((candidate) => candidate.id === candidateId)).toMatchObject({
        status: 'candidate',
        taskId: null,
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
            candidateKind: 'constraint_enablement',
            moduleRouting: {
              primaryModule: 'quality',
              secondaryModules: [],
              confidencePercent: 80,
              reason: '不正 goalId の検証 fixture。',
            },
            constraintGoalIds: [],
            planModeOpenQuestions: [],
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

  it('rejects mission generation when LLM returns a constraint goal from outside the selected set', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-bad-constraint-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'echo coverage',
            'test:e2e': 'echo e2e',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const createGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Todo',
            goalText: 'todolist を作る。',
            active: true,
          }),
        }
      );
      expect(createGoalRes.status).toBe(201);
      structuredLlmFixture.nextOutput = JSON.stringify({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: 'todolist 機能の初期実装計画を作成する',
            summary: 'todolist 機能を Plan Mode で定義する。',
            rationale: '本体機能が未実装。',
            goalId: null,
            candidateKind: 'feature_entrypoint',
            moduleRouting: {
              primaryModule: null,
              secondaryModules: [],
              confidencePercent: 30,
              reason: 'ontology 未判定。',
            },
            constraintGoalIds: [crypto.randomUUID()],
            planModeOpenQuestions: ['保存方式を決める。'],
            evidence: [{ source: 'mission_goal', label: 'goal', value: 'todolist を作る' }],
            evaluationContribution: 40,
            importancePercent: 90,
            confidencePercent: 80,
            tokenSize: 'medium',
            complexity: 'moderate',
            taskPrompt: 'Plan Mode で todolist 機能の初期実装計画を作成してください。',
            acceptanceCriteria: '初期実装計画ができる。',
            verificationPlan: '計画をレビューする。',
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

  it('does not count project-wide detail candidates folded out by semantics as quality setup candidates', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-folded-quality-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);
      const featureGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Todo',
            goalText: 'todolist を作る。',
            active: true,
          }),
        }
      );
      expect(featureGoalRes.status).toBe(201);
      const featureGoal = (await featureGoalRes.json()) as { id: string };

      const coverageGoalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-goals/from-preset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetId: 'coverage-budget', active: true }),
        }
      );
      expect(coverageGoalRes.status).toBe(201);
      const coverageGoal = (await coverageGoalRes.json()) as { id: string };

      structuredLlmFixture.nextOutput = JSON.stringify({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: 'todolist 機能の初期実装計画を作成する',
            summary: 'todolist 機能を Plan Mode で定義する。',
            rationale: '本体機能が未実装。',
            goalId: featureGoal.id,
            candidateKind: 'feature_entrypoint',
            moduleRouting: {
              primaryModule: null,
              secondaryModules: [],
              confidencePercent: 30,
              reason: 'ontology 未判定。',
            },
            constraintGoalIds: [coverageGoal.id],
            planModeOpenQuestions: ['保存方式を決める。'],
            evidence: [{ source: 'mission_goal', label: 'goal', value: 'todolist を作る' }],
            evaluationContribution: 40,
            importancePercent: 90,
            confidencePercent: 80,
            tokenSize: 'medium',
            complexity: 'moderate',
            taskPrompt: 'Plan Mode で todolist 機能の初期実装計画を作成してください。',
            acceptanceCriteria: '初期実装計画ができる。',
            verificationPlan: '計画をレビューする。',
          },
          {
            title: 'coverage script を確認する',
            summary: 'project-wide Goal の検証詳細。',
            rationale: '本流候補の検証条件として扱う。',
            goalId: coverageGoal.id,
            candidateKind: 'constraint_verification',
            moduleRouting: {
              primaryModule: null,
              secondaryModules: [],
              confidencePercent: 20,
              reason: 'project-wide Goal は独立候補にしない。',
            },
            constraintGoalIds: [],
            planModeOpenQuestions: [],
            evidence: [{ source: 'quality', label: 'missing capability', value: 'coverage' }],
            evaluationContribution: 10,
            importancePercent: 98,
            confidencePercent: 75,
            tokenSize: 'small',
            complexity: 'simple',
            taskPrompt: 'package.json に test:coverage script を追加してください。',
            acceptanceCriteria: 'coverage capability が runnable になる。',
            verificationPlan: 'test:coverage を確認する。',
          },
        ],
      });

      const generateRes = await app.request(
        `http://localhost/api/repositories/${project.id}/mission-task-candidates/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalIds: [featureGoal.id, coverageGoal.id] }),
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

  it('requests Vitest json-summary coverage artifacts for project quality runs', async () => {
    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nightworkers-detail-coverage-reporter-')
    );
    try {
      fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'scripts', 'write-coverage-if-summary-reporter.cjs'),
        [
          "const fs = require('node:fs');",
          "if (!process.argv.includes('--coverage.reporter=json-summary')) process.exit(0);",
          "fs.mkdirSync('coverage', { recursive: true });",
          'fs.writeFileSync(',
          "  'coverage/coverage-summary.json',",
          '  JSON.stringify({',
          '    total: {',
          '      statements: { pct: 91 },',
          '      branches: { pct: 90 },',
          '      functions: { pct: 92 },',
          '      lines: { pct: 93 }',
          '    }',
          '  })',
          ');',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'node scripts/write-coverage-if-summary-reporter.cjs',
          },
        }),
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
      expect(run.command).toContain('--coverage.reporter=json-summary');
      expect(run.errorMessage).toBeNull();
      expect(run.coverageSummary.total.lines.pct).toBe(93);
      expect(run.coverageGate).toMatchObject({
        passed: true,
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('uses all quality runs as the latest coverage and E2E display source', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-quality-all-'));
    try {
      writeCoverageSummary(repoRoot);
      writePlaywrightSummary(repoRoot);
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:coverage': 'echo coverage',
            'test:e2e': 'echo e2e',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'all' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = (await runRes.json()) as { id: string; runType: string };
      expect(run.runType).toBe('all');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      expect(qualityRes.status).toBe(200);
      const quality = await qualityRes.json();

      expect(quality.latestUnitRun).toBeNull();
      expect(quality.latestE2eRun).toBeNull();
      expect(quality.latestAllRun.id).toBe(run.id);
      expect(quality.latestCoverageRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.id).toBe(run.id);
      expect(quality.latestCoverageRun.coverageSummary['src/checkout.ts'].lines.pct).toBe(72);
      expect(quality.latestE2eResultRun.e2eSummary.suites).toMatchObject([
        { title: 'checkout.spec.ts', tests: 1, status: 'passed' },
      ]);
      expect(quality.recentRuns.map((item: { id: string }) => item.id)).toContain(run.id);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps E2E runs visible when the structured artifact is missing', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-missing-'));
    try {
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:e2e': 'echo e2e' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.errorMessage).toContain('E2E artifact not found');

      const qualityRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality`
      );
      const quality = await qualityRes.json();
      expect(quality.latestE2eRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.id).toBe(run.id);
      expect(quality.latestE2eResultRun.e2eSummary).toMatchObject({
        status: 'passed',
        total: 0,
        suites: [],
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('requests Playwright JSON artifacts for E2E quality runs', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-reporter-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'scripts', 'write-e2e-if-json-reporter.cjs'),
        [
          "const fs = require('node:fs');",
          "const path = require('node:path');",
          'const outputFile = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;',
          "const hasJsonReporter = process.argv.some((arg) => arg.includes('--reporter=') && arg.includes('json'));",
          'if (!outputFile || !hasJsonReporter) process.exit(0);',
          'fs.mkdirSync(path.dirname(outputFile), { recursive: true });',
          'fs.writeFileSync(',
          '  outputFile,',
          '  JSON.stringify({',
          '    suites: [',
          '      {',
          "        title: 'smoke.spec.ts',",
          '        specs: [',
          '          {',
          "            title: 'public screens render',",
          '            tests: [{ results: [{ status: "passed", duration: 120 }] }]',
          '          }',
          '        ]',
          '      }',
          '    ]',
          '  })',
          ');',
        ].join('\n'),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          scripts: {
            test: 'echo unit',
            'test:e2e': 'node scripts/write-e2e-if-json-reporter.cjs',
          },
        }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );

      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.status).toBe('completed');
      expect(run.command).toContain('PLAYWRIGHT_JSON_OUTPUT_FILE');
      expect(run.command).toContain('--reporter=list,json');
      expect(run.errorMessage).toBeNull();
      expect(run.e2eSummary).toMatchObject({
        status: 'passed',
        total: 1,
        passed: 1,
        failed: 0,
        suites: [{ title: 'smoke.spec.ts', status: 'passed', tests: 1 }],
      });
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('counts failed tests from E2E artifacts instead of failed suites only', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-detail-e2e-failed-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'playwright-report'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'playwright-report', 'results.json'),
        JSON.stringify({
          suites: [
            {
              title: 'checkout.spec.ts',
              specs: [
                {
                  title: 'loads checkout',
                  tests: [
                    {
                      results: [
                        { status: 'failed', duration: 100, error: { message: 'missing total' } },
                      ],
                    },
                  ],
                },
                {
                  title: 'submits checkout',
                  tests: [
                    {
                      results: [
                        {
                          status: 'failed',
                          duration: 200,
                          error: { message: 'button disabled' },
                        },
                      ],
                    },
                  ],
                },
                {
                  title: 'opens receipt',
                  tests: [{ results: [{ status: 'passed', duration: 50 }] }],
                },
                {
                  title: 'passes after retry',
                  tests: [
                    {
                      results: [
                        { status: 'failed', duration: 30, error: { message: 'first attempt' } },
                        { status: 'passed', duration: 40 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({ scripts: { test: 'echo unit', 'test:e2e': 'echo e2e' } }),
        'utf8'
      );
      const project = await createRepository(repoRoot);

      const runRes = await app.request(
        `http://localhost/api/repositories/${project.id}/quality/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runType: 'e2e' }),
        }
      );
      expect(runRes.status).toBe(201);
      const run = await runRes.json();
      expect(run.e2eSummary).toMatchObject({
        status: 'failed',
        total: 4,
        passed: 2,
        failed: 2,
      });
      expect(run.e2eSummary.suites).toMatchObject([
        { title: 'checkout.spec.ts', status: 'failed', tests: 4, lastFailure: 'button disabled' },
      ]);
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
