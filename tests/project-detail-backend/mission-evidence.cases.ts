import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect } from 'vitest';
import app from '../../api/app';
import * as missionPlannerRepo from '../../api/modules/mission-planner/mission-planner.repository';
import { buildTaskGenerationEvidence } from '../../api/modules/project-detail/task-generation-evidence.service';
import { compileOntologyModuleContext } from '../../api/services/agent-ontology/agent-ontology.service';
import { createRepository } from './helpers';
import { setStructuredLlmFixtureOutput } from './setup';
import './setup';

describe('Project Detail backend mission evidence', () => {
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

      setStructuredLlmFixtureOutput(
        JSON.stringify({
          schemaVersion: 'nightworkers.mission-task-candidates/v1',
          candidates: [
            {
              title: 'todolist 本体を実装する',
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
              planModeOpenQuestions: [
                'UI は単一画面か分割画面か',
                'データモデルは task の最小属性だけにするか',
                '保存先は SQLite の永続化でよいか',
                '完了状態をどう表現するか',
              ],
              evidence: [{ source: 'mission_goal', label: 'goal', value: 'todolist を作る' }],
              evaluationContribution: 40,
              importancePercent: 90,
              confidencePercent: 80,
              tokenSize: 'medium',
              complexity: 'moderate',
              taskPrompt: 'Plan Mode で todolist 本体の実装方針を決めてください。',
              acceptanceCriteria: '本体実装方針が決まる。',
              verificationPlan: '計画をレビューする。',
            },
          ],
        })
      );

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
          planModeOpenQuestions: [
            'UI は単一画面か分割画面か',
            'データモデルは task の最小属性だけにするか',
            '保存先は SQLite の永続化でよいか',
            '完了状態をどう表現するか',
          ],
        },
        projectWideConstraints: [
          expect.objectContaining({
            goalId: coverageGoal.id,
            title: 'カバレッジ維持',
            intent: 'maintain_threshold',
          }),
        ],
        acceptanceCriteria: ['本体実装方針が決まる。'],
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
        tasks: Array<{ id: string; objective: string }>;
      };
      expect(created.tasks[0].objective).toContain('Todo を実現してください。');
      expect(created.tasks[0].objective).toContain('todolist 本体。');
      expect(created.tasks[0].objective).toContain('[Planで確認すること]');
      const objectiveLines = created.tasks[0].objective.split('\n');
      expect(objectiveLines).toContain('- UI は単一画面か分割画面か');
      expect(objectiveLines).toContain('- データモデルは task の最小属性だけにするか');
      expect(objectiveLines).toContain('- 保存先は SQLite の永続化でよいか');
      expect(objectiveLines).toContain('- 完了状態をどう表現するか');
      expect(objectiveLines).toContain('- 編集、削除、並び替えの初期範囲');
      expect(objectiveLines).toContain('- unit / schema / e2e の検証範囲');
      expect(objectiveLines).not.toContain('- 入口画面または route');
      expect(objectiveLines).not.toContain('- データモデル');
      expect(objectiveLines).not.toContain('- 保存方式');
      expect(objectiveLines).not.toContain('- 完了状態の表現');
      expect(created.tasks[0].objective).toContain('[実装上の注意]');
      expect(created.tasks[0].objective).toContain('[完了条件]');
      expect(created.tasks[0].objective).toContain('本体実装方針が決まる。');
      expect(created.tasks[0].objective).toContain('[検証]');
      expect(created.tasks[0].objective).toContain('計画をレビューする。');
      expect(created.tasks[0].objective).not.toContain('Implementation Queue');
      expect(created.tasks[0].objective).not.toContain('todolist 本体を実装する を実現するため');
      expect(created.tasks[0].objective).not.toContain('Primary module:');
      expect(created.tasks[0].objective).not.toContain('根拠:');

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
      setStructuredLlmFixtureOutput(
        JSON.stringify({
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
        })
      );

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
      setStructuredLlmFixtureOutput(
        JSON.stringify({
          schemaVersion: 'nightworkers.mission-task-candidates/v1',
          candidates: [
            {
              title: 'todolist 本体を実装する',
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
              taskPrompt: 'Plan Mode で todolist 本体の実装方針を決めてください。',
              acceptanceCriteria: '本体実装方針が決まる。',
              verificationPlan: '計画をレビューする。',
            },
          ],
        })
      );

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

      setStructuredLlmFixtureOutput(
        JSON.stringify({
          schemaVersion: 'nightworkers.mission-task-candidates/v1',
          candidates: [
            {
              title: 'todolist 本体を実装する',
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
              taskPrompt: 'Plan Mode で todolist 本体の実装方針を決めてください。',
              acceptanceCriteria: '本体実装方針が決まる。',
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
        })
      );

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
});
