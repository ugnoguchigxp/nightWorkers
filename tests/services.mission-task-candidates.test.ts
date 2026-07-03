import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import { buildMissionTaskCandidatesResponseJsonSchema } from '../api/modules/project-detail/project-detail.service';
import { buildProjectSignalSnapshot } from '../api/modules/project-detail/project-signal-snapshot.service';
import { missionTaskCandidatesResultSchema } from '../shared/schemas/project-detail.schema';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('Mission task candidate generation helpers', () => {
  it('builds a structured-output compatible mission task candidate response schema', () => {
    const schema = buildMissionTaskCandidatesResponseJsonSchema();
    expect(JSON.stringify(schema)).not.toContain('"$schema"');
    expect(JSON.stringify(schema)).not.toContain('"default"');
    expectAllObjectPropertiesRequired(schema);

    const root = asRecord(schema);
    const candidates = asRecord(asRecord(root.properties).candidates);
    const candidate = asRecord(candidates.items);
    expect(candidate.required).toEqual([
      'title',
      'summary',
      'rationale',
      'goalId',
      'evidence',
      'evaluationContribution',
      'importancePercent',
      'confidencePercent',
      'tokenSize',
      'complexity',
      'taskPrompt',
      'acceptanceCriteria',
      'verificationPlan',
    ]);
    expect(JSON.stringify(asRecord(candidate.properties).goalId)).toContain('"null"');
    expect(JSON.stringify(asRecord(candidate.properties).evaluationContribution)).not.toContain(
      '"null"'
    );
  });

  it('requires evaluationContribution while accepting null goalId', () => {
    expect(() =>
      missionTaskCandidatesResultSchema.parse({
        schemaVersion: 'nightworkers.mission-task-candidates/v1',
        candidates: [
          {
            title: '候補',
            summary: '要約',
            rationale: '理由',
            goalId: null,
            evidence: [],
            evaluationContribution: null,
            importancePercent: 50,
            confidencePercent: 80,
            tokenSize: 'small',
            complexity: 'simple',
            taskPrompt: '実装してください。',
            acceptanceCriteria: '完了していること。',
            verificationPlan: 'テストする。',
          },
        ],
      })
    ).toThrow();

    const parsed = missionTaskCandidatesResultSchema.parse({
      schemaVersion: 'nightworkers.mission-task-candidates/v1',
      candidates: [
        {
          title: '候補',
          summary: '要約',
          rationale: '理由',
          goalId: null,
          evidence: [],
          evaluationContribution: 35,
          importancePercent: 50,
          confidencePercent: 80,
          tokenSize: 'small',
          complexity: 'simple',
          taskPrompt: '実装してください。',
          acceptanceCriteria: '完了していること。',
          verificationPlan: 'テストする。',
        },
      ],
    });

    expect(parsed.candidates[0]?.goalId).toBeNull();
    expect(parsed.candidates[0]?.evaluationContribution).toBe(35);
  });

  it('adds compact repository implementation context to mission signals', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-mission-signal-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'web/src/routes'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          name: 'hono-standard',
          description: 'Template app',
          scripts: { test: 'vitest run', verify: 'bun run test' },
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(repoRoot, 'README.md'), '# Hono Standard\nTemplate app', 'utf8');
      fs.writeFileSync(
        path.join(repoRoot, 'LLM_CONTEXT.md'),
        'LLM CONTEXT: todo workflow is already implemented in routes.',
        'utf8'
      );
      fs.writeFileSync(path.join(repoRoot, 'web/src/routes/home-route.tsx'), 'export {}', 'utf8');
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.name', 'NightWorkers Test'], { cwd: repoRoot });
      execFileSync('git', ['add', 'package.json'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'initial template'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      fs.writeFileSync(
        path.join(repoRoot, 'web/src/routes/home-route.tsx'),
        'export const route = "todo";',
        'utf8'
      );
      execFileSync('git', ['add', 'web/src/routes/home-route.tsx'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'add todo route'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      fs.writeFileSync(
        path.join(repoRoot, 'web/src/routes/home-route.tsx'),
        'export const route = "todo-list";',
        'utf8'
      );
      execFileSync('git', ['add', 'web/src/routes/home-route.tsx'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'refine todo route'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });

      const snapshot = await buildProjectSignalSnapshot({
        repository: {
          id: crypto.randomUUID(),
          name: 'todo',
          localPath: repoRoot,
          branch: 'main',
        },
        goals: [
          {
            id: crypto.randomUUID(),
            repositoryId: crypto.randomUUID(),
            title: 'todo listを作る',
            goalText: '使いやすい todo list を作る',
            active: true,
            source: 'user',
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      expect(snapshot.repositorySnapshot).toMatchObject({
        packageName: 'hono-standard',
        description: 'Template app',
      });
      expect(snapshot.repositorySnapshot?.readmeExcerpt).toContain('Hono Standard');
      expect(snapshot.repositorySnapshot?.sourceFiles).toContain('web/src/routes/home-route.tsx');
      expect(snapshot.repositorySnapshot?.sourceExcerpts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'README.md',
            excerpt: expect.stringContaining('Hono Standard'),
          }),
          expect.objectContaining({ path: 'web/src/routes/home-route.tsx' }),
        ])
      );
      expect(snapshot.repositorySnapshot?.llmContextFiles).toEqual([
        expect.objectContaining({
          path: 'LLM_CONTEXT.md',
          excerpt: expect.stringContaining('todo workflow is already implemented'),
        }),
      ]);
      expect(snapshot.repositorySnapshot?.recentCommitDiffs).toHaveLength(0);
      expect(snapshot.repositorySnapshot?.packageScripts).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'verify' })])
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('adds recent non-initial commit diffs only when LLM context is absent', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-mission-diff-'));
    try {
      fs.mkdirSync(path.join(repoRoot, 'web/src/routes'), { recursive: true });
      fs.writeFileSync(
        path.join(repoRoot, 'package.json'),
        JSON.stringify({
          name: 'hono-standard',
          scripts: { test: 'vitest run' },
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(repoRoot, 'web/src/routes/home-route.tsx'), 'export {}', 'utf8');
      execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.name', 'NightWorkers Test'], { cwd: repoRoot });
      execFileSync('git', ['add', '.'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'initial template'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      fs.writeFileSync(
        path.join(repoRoot, 'web/src/routes/home-route.tsx'),
        'export const route = "todo";',
        'utf8'
      );
      execFileSync('git', ['add', 'web/src/routes/home-route.tsx'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'add todo route'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      fs.writeFileSync(
        path.join(repoRoot, 'web/src/routes/home-route.tsx'),
        'export const route = "todo-list";',
        'utf8'
      );
      execFileSync('git', ['add', 'web/src/routes/home-route.tsx'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-m', 'refine todo route'], {
        cwd: repoRoot,
        stdio: 'ignore',
      });

      const snapshot = await buildProjectSignalSnapshot({
        repository: {
          id: crypto.randomUUID(),
          name: 'todo',
          localPath: repoRoot,
          branch: 'main',
        },
        goals: [
          {
            id: crypto.randomUUID(),
            repositoryId: crypto.randomUUID(),
            title: 'todo listを作る',
            goalText: '使いやすい todo list を作る',
            active: true,
            source: 'user',
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      expect(snapshot.repositorySnapshot?.llmContextFiles).toHaveLength(0);
      expect(snapshot.repositorySnapshot?.recentCommitDiffs).toHaveLength(2);
      expect(snapshot.repositorySnapshot?.recentCommitDiffs.map((item) => item.subject)).toEqual([
        'refine todo route',
        'add todo route',
      ]);
      expect(JSON.stringify(snapshot.repositorySnapshot?.recentCommitDiffs)).not.toContain(
        'initial template'
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function expectAllObjectPropertiesRequired(schema: unknown) {
  if (!schema || typeof schema !== 'object') return;
  const record = schema as Record<string, unknown>;
  if (record.type === 'object' && record.properties && typeof record.properties === 'object') {
    expect(record.required).toEqual(Object.keys(record.properties as Record<string, unknown>));
    expect(record.additionalProperties).toBe(false);
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) expectAllObjectPropertiesRequired(item);
    } else {
      expectAllObjectPropertiesRequired(value);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}
