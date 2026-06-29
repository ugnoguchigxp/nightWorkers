import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from '@hono/zod-openapi';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import { buildProjectEvaluationBundle } from '../api/modules/project-evaluation/project-evaluation-bundle.service';
import { LLM_ROLE_ORDER, llmRoleSchema } from '../api/routes/settings-runtime';
import {
  projectEvaluationReportSchema,
  projectImprovementIdeasResultSchema,
} from '../shared/schemas/project-evaluation.schema';

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
          providerEndpointId: 'fixture-evaluation',
          routeSource: 'primary',
          model: 'fixture-eval-model',
          thinkingDepth: 'high',
        },
      });
      if (options.schemaName === 'project_improvement_ideas') {
        return JSON.stringify({
          schemaVersion: 'nightworkers.project-improvement-ideas/v1',
          ideas: [
            {
              title: '評価履歴を実データで表示する',
              summary:
                '保存済み評価と履歴を UI に接続し、Project owner が前回との差分を判断できる状態にする。',
              agentPrompt:
                'Project Evaluation の保存済み評価、選択軸、改善案を読み取り、UI と API の実データ接続を実装してください。',
              expectedOutcome: '評価履歴、選択軸、改善案、Task 化結果が mock なしで表示される。',
              implementationFocus: ['API response を UI controller に接続する'],
              targetDimensions: ['implementationCompleteness'],
              scoreImpacts: [
                {
                  dimensionKey: 'implementationCompleteness',
                  currentScore: 70,
                  expectedScoreGain: 8,
                  expectedScoreAfter: 78,
                  rationale: 'mock を除去して実データで評価 loop を閉じるため。',
                },
              ],
            },
          ],
        });
      }
      return JSON.stringify({
        schemaVersion: 'nightworkers.project-evaluation-report/v1',
        overallScore: 70,
        confidence: 0.71,
        summary: 'repository bundle と保存済み証跡に基づく評価です。',
        dimensions: [
          {
            key: 'implementationCompleteness',
            label: '実装完成度',
            score: 70,
            confidence: 0.72,
            rationale: '評価画面は実 API と DB に接続されている。',
            evidence: ['README.md', 'package.json'],
            concerns: ['runtime verification は未実施'],
          },
        ],
        strengths: ['local-first DB に保存できる'],
        weaknesses: ['source sampling は初期範囲外'],
        nextEvidenceToCollect: ['bun run verify の結果'],
      });
    }),
  };
});

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('project evaluation real logic', () => {
  it('adds evaluation as a structured LLM role', () => {
    expect(llmRoleSchema.parse('evaluation')).toBe('evaluation');
    expect(LLM_ROLE_ORDER).toEqual([
      'plan',
      'evaluation',
      'implementation',
      'test',
      'review',
      'quality_gate',
      'completion',
    ]);
  });

  it('parses evaluation and improvement structured outputs', () => {
    const reportJsonSchema = z.toJSONSchema(projectEvaluationReportSchema) as {
      properties?: { dimensions?: { items?: { properties?: Record<string, unknown> } } };
    };
    expect(reportJsonSchema.properties?.dimensions?.items?.properties).not.toHaveProperty(
      'evaluationId'
    );
    expect(
      projectEvaluationReportSchema.parse({
        schemaVersion: 'nightworkers.project-evaluation-report/v1',
        overallScore: 80,
        confidence: 0.8,
        summary: '実データ評価です。',
        dimensions: [
          {
            key: 'security',
            label: 'セキュリティ',
            score: 72,
            confidence: 0.6,
            rationale: 'redaction がある。',
            evidence: [],
            concerns: [],
          },
        ],
      }).overallScore
    ).toBe(80);
    expect(
      projectImprovementIdeasResultSchema.parse({
        schemaVersion: 'nightworkers.project-improvement-ideas/v1',
        ideas: [
          {
            title: 'redaction を検証する',
            summary: 'secret-like path を評価 bundle から除外する。',
            agentPrompt: 'redaction test を追加する。',
            expectedOutcome: '.env が bundle に入らない。',
            implementationFocus: ['bundle builder'],
            targetDimensions: ['security'],
            scoreImpacts: [],
          },
        ],
      }).ideas
    ).toHaveLength(1);
  });

  it('builds a bundle from the registered repository root without secret-like paths', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-eval-bundle-'));
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Test Project\n');
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'project guidance\n');
    fs.writeFileSync(path.join(repoRoot, '.env'), 'SECRET=value\n');
    fs.writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify({ scripts: { verify: 'bun test' } })
    );
    fs.mkdirSync(path.join(repoRoot, 'node_modules'));
    fs.writeFileSync(path.join(repoRoot, 'node_modules', 'leak.js'), 'secret');
    try {
      const bundle = await buildProjectEvaluationBundle({
        repository: {
          id: crypto.randomUUID(),
          name: 'Bundle Test',
          localPath: repoRoot,
          branch: 'main',
          allowed: true,
          queueEnabled: false,
          maxConcurrentSessions: 1,
          safetyPolicy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      expect(bundle.inputs.readme).toContain('Test Project');
      expect(bundle.inputs.scripts.verify).toBe('bun test');
      expect(bundle.inputs.repoTree.join('\n')).not.toContain('.env');
      expect(bundle.inputs.repoTree.join('\n')).not.toContain('node_modules');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('runs evaluation, generates improvements, and creates linked ready tasks through API', async () => {
    const { default: app } = await import('../api/app');
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-eval-api-'));
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# API Project\n');
    fs.writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify({ scripts: { verify: 'bun run verify' } })
    );
    try {
      const createRepoRes = await app.request('http://localhost/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `TEST: Evaluation ${crypto.randomUUID()}`,
          localPath: repoRoot,
          branch: 'main',
        }),
      });
      expect(createRepoRes.status).toBe(201);
      const project = await createRepoRes.json();

      const evalRes = await app.request(
        `http://localhost/api/repositories/${project.id}/evaluations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      expect(evalRes.status, await evalRes.clone().text()).toBe(201);
      const evaluationDetail = await evalRes.json();
      expect(evaluationDetail.evaluation.overallScore).toBe(70);
      expect(evaluationDetail.evaluation.dimensions[0].key).toBe('implementationCompleteness');
      expect(evaluationDetail.evaluation.selectedModel).toMatchObject({
        providerId: 'fixture',
        providerEndpointId: 'fixture-evaluation',
        modelOrDeployment: 'fixture-eval-model',
        thinkingDepth: 'high',
      });

      const improvementsRes = await app.request(
        `http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/improvements`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dimensionKeys: ['implementationCompleteness'] }),
        }
      );
      expect(improvementsRes.status, await improvementsRes.clone().text()).toBe(201);
      const improvements = await improvementsRes.json();
      expect(improvements.ideas).toHaveLength(1);

      const tasksRes = await app.request(
        `http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideaIds: [improvements.ideas[0].id], mode: 'ready' }),
        }
      );
      expect(tasksRes.status, await tasksRes.clone().text()).toBe(201);
      const tasks = await tasksRes.json();
      expect(tasks.tasks[0]).toMatchObject({
        status: 'ready',
        createdBy: 'project-evaluation',
      });
      expect(tasks.taskLinks[0]).toMatchObject({
        evaluationId: evaluationDetail.evaluation.id,
        ideaId: improvements.ideas[0].id,
        taskId: tasks.tasks[0].id,
      });

      const duplicateTasksRes = await app.request(
        `http://localhost/api/project-evaluations/${evaluationDetail.evaluation.id}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ideaIds: [improvements.ideas[0].id], mode: 'ready' }),
        }
      );
      expect(duplicateTasksRes.status).toBe(400);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
