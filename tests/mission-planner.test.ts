import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const structuredLlmFixture = vi.hoisted(() => ({
  outputs: [] as unknown[],
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
          providerEndpointId: 'fixture-mission-planner',
          routeSource: 'primary',
          model: 'fixture-mission-planner-model',
        },
      });
      const next = structuredLlmFixture.outputs.shift();
      if (!next) throw new Error('No Mission Planner fixture output queued');
      return JSON.stringify(next);
    }),
  };
});

import app from '../api/app';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as missionPlannerService from '../api/modules/mission-planner/mission-planner.service';
import { validateMissionPlanningResult } from '../api/modules/mission-planner/mission-planner-validation';
import * as nightworkersRepo from '../api/modules/nightworkers/nightworkers.repository';
import * as queueService from '../api/modules/queue/queue-management.service';
import {
  missionDecompositionEvaluationSchema,
  missionDecompositionPlanningResultSchema,
} from '../shared/schemas/mission-planner.schema';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

beforeEach(() => {
  structuredLlmFixture.outputs = [];
});

function createRepoRoot() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-mission-'));
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({
      scripts: {
        test: 'vitest run',
        verify: 'bunx vitest run',
      },
    })
  );
  return repoRoot;
}

async function createRepository() {
  return nightworkersRepo.createRepository({
    name: `TEST: Mission Planner ${crypto.randomUUID()}`,
    localPath: createRepoRoot(),
    branch: 'main',
    queueEnabled: true,
  });
}

function planningResultFixture() {
  return missionDecompositionPlanningResultSchema.parse({
    schemaVersion: 'nightworkers.mission-decomposition-result/v1',
    mission: {
      title: 'Queue reliability mission',
      goal: 'Queue 実行の信頼性を改善する。',
      nonGoals: ['Queue processor の claim logic は変更しない。'],
    },
    objectives: [
      {
        id: 'obj-queue',
        title: 'Queue admission metadata を安定させる',
        completionCriteria: ['Mission proposal 由来の scheduling metadata が保持される。'],
        verificationGate: ['Queue entry 作成時に sequence metadata が反映される。'],
      },
    ],
    workPackages: [
      {
        id: 'wp-backend',
        title: 'Backend contract',
        purpose: 'Mission proposal から Task 化する contract を追加する。',
        relatedObjectiveIds: ['obj-queue'],
        suggestedPlanMode: false,
        risk: 'medium',
        approvalRequired: false,
      },
    ],
    taskProposals: [
      {
        id: 'task-backend',
        title: 'Mission proposal Task 化 contract を実装する',
        summary: 'proposal の initialPrompt と scheduling hint を Task metadata に保存する。',
        purpose: 'review_pending result から Task を明示作成できるようにする。',
        workPackageId: 'wp-backend',
        dependencies: [],
        targetFilesOrModules: ['api/modules/mission-planner'],
        initialPrompt: [
          '目的: Mission proposal から Task を作成できるようにする。',
          '対象範囲: api/modules/mission-planner と Queue metadata handoff。',
          '非目標: Queue processor の claim logic は変更しない。',
          '実装方針: proposal metadata を task message に保存する。',
          '完了条件: proposal が task_created になり taskId が入る。',
          '検証: focused vitest を実行する。',
          '注意点: scheduling hint を失わない。',
        ].join('\n'),
        expectedOutcome: 'Task 化後も Mission traceability が残る。',
        implementationFocus: ['metadata persistence', 'route contract'],
        acceptanceCriteria: ['proposal selected by user creates a Task'],
        verificationGate: ['bunx vitest run tests/mission-planner.test.ts'],
        risk: 'medium',
        approvalRequired: false,
        scheduling: {
          executionType: 'sequence',
          reason: 'Mission dependency order',
          sequenceGroupId: 'mission-result-wp-backend',
          sequenceOrder: 0,
          dependsOnTaskIds: [],
        },
      },
    ],
    replanningUnits: [
      {
        id: 'replan-backend',
        trigger: 'metadata handoff fails',
        scope: 'work_package',
        targetId: 'wp-backend',
        action: 'pause',
      },
    ],
  });
}

function reviewReadyEvaluationOutput() {
  return missionDecompositionEvaluationSchema.parse({
    schemaVersion: 'nightworkers.mission-decomposition-evaluation/v1',
    verdict: 'review_ready',
    confidence: 'high',
    dimensions: [
      {
        key: 'goal_alignment',
        status: 'pass',
        rationale: 'Goal と proposal が対応している。',
        suggestedCorrection: null,
      },
    ],
    courseCorrections: [],
  });
}

function queueLlmOutputs() {
  const planningResult = planningResultFixture();
  structuredLlmFixture.outputs = [
    {
      schemaVersion: 'nightworkers.mission-draft/v1',
      mission: planningResult.mission,
      blockingClarification: false,
      clarificationQuestions: [],
      riskNotes: [],
    },
    {
      schemaVersion: 'nightworkers.mission-structure/v1',
      objectives: planningResult.objectives,
      workPackages: planningResult.workPackages,
      replanningUnits: planningResult.replanningUnits,
    },
    {
      schemaVersion: 'nightworkers.mission-task-proposals/v1',
      taskProposals: planningResult.taskProposals,
    },
    reviewReadyEvaluationOutput(),
  ];
}

describe('Mission Planner schemas and validation', () => {
  it('parses a planning result and evaluation contract', () => {
    expect(planningResultFixture().schemaVersion).toBe(
      'nightworkers.mission-decomposition-result/v1'
    );
    expect(
      missionDecompositionEvaluationSchema.parse({
        schemaVersion: 'nightworkers.mission-decomposition-evaluation/v1',
        verdict: 'needs_human_approval',
        confidence: 'medium',
        dimensions: [],
        courseCorrections: [],
      }).verdict
    ).toBe('needs_human_approval');
  });

  it('fails deterministic validation for dependency cycles and unsafe scheduling', () => {
    const fixture = planningResultFixture();
    fixture.taskProposals[0].dependencies = ['task-backend'];
    fixture.taskProposals[0].risk = 'high';
    fixture.taskProposals[0].approvalRequired = false;
    fixture.taskProposals[0].scheduling.executionType = 'normal';
    const report = validateMissionPlanningResult(fixture);
    expect(report.status).toBe('fail');
    expect(
      report.checks.some((check) => check.key === 'dependency_cycle' && check.status === 'fail')
    ).toBe(true);
    expect(
      report.checks.some(
        (check) => check.key === 'approval_required_for_high_risk' && check.status === 'fail'
      )
    ).toBe(true);
  });
});

describe('Mission Planner service and routes', () => {
  it('creates a review-pending planning result and materializes selected proposals as Tasks', async () => {
    const repository = await createRepository();
    queueLlmOutputs();
    const mission = await missionPlannerService.createMission({
      repositoryId: repository.id,
      goalText: 'Queue 実行の信頼性を Mission として分解してください。',
      nonGoals: ['Queue processor の claim logic は変更しない。'],
    });

    const detail = await missionPlannerService.decomposeMission({ missionId: mission.id });
    expect(detail.mission.status).toBe('review_pending');
    expect(detail.mission.title).toBe('Queue reliability mission');
    expect(detail.mission.goalText).toBe('Queue 実行の信頼性を改善する。');
    expect(detail.latestPlanningResult?.status).toBe('review_pending');
    expect(detail.taskProposals).toHaveLength(1);

    const created = await missionPlannerService.createTasksFromMissionTaskProposals({
      proposalIds: [detail.taskProposals[0].id],
      mode: 'ready',
    });
    expect(created.tasks[0]).toMatchObject({
      title: 'Mission proposal Task 化 contract を実装する',
      status: 'ready',
      createdBy: 'mission-task-proposal',
    });
    expect(created.proposals[0]).toMatchObject({
      status: 'task_created',
      taskId: created.tasks[0].id,
    });

    const messages = await nightworkersRepo.listTaskMessages(created.tasks[0].id);
    expect(messages.at(-1)?.metadataJson).toMatchObject({
      source: 'mission_task_proposal',
      missionProposal: {
        source: 'mission_task_proposal',
        proposalId: detail.taskProposals[0].id,
        scheduling: { executionType: 'sequence', sequenceOrder: 0 },
      },
    });
  });

  it('does not duplicate proposals when a review-pending result is evaluated again', async () => {
    const repository = await createRepository();
    queueLlmOutputs();
    const mission = await missionPlannerService.createMission({
      repositoryId: repository.id,
      goalText: '再評価しても proposal が重複しないことを確認する。',
    });
    const detail = await missionPlannerService.decomposeMission({ missionId: mission.id });
    expect(detail.latestPlanningResult?.status).toBe('review_pending');
    expect(detail.taskProposals).toHaveLength(1);

    structuredLlmFixture.outputs = [reviewReadyEvaluationOutput()];
    await missionPlannerService.evaluatePlanningResult(detail.latestPlanningResult?.id ?? '');

    const proposals = await missionPlannerService.listTaskProposals(
      detail.latestPlanningResult?.id ?? ''
    );
    expect(proposals).toHaveLength(1);
  });

  it('blocks task materialization after a planning result leaves review_pending', async () => {
    const repository = await createRepository();
    queueLlmOutputs();
    const mission = await missionPlannerService.createMission({
      repositoryId: repository.id,
      goalText: 'revision 後の stale proposal を Task 化できないことを確認する。',
    });
    const detail = await missionPlannerService.decomposeMission({ missionId: mission.id });
    expect(detail.taskProposals).toHaveLength(1);
    await missionPlannerService.requestPlanningRevision({
      planningResultId: detail.latestPlanningResult?.id ?? '',
      reason: 'ユーザーが再分解を要求した。',
    });

    await expect(
      missionPlannerService.createTasksFromMissionTaskProposals({
        proposalIds: [detail.taskProposals[0].id],
        mode: 'ready',
      })
    ).rejects.toThrow(/review_pending/);
  });

  it('exposes create/list Mission routes', async () => {
    const repository = await createRepository();
    const createRes = await app.request(
      `http://localhost/api/repositories/${repository.id}/missions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalText: 'Route contract を確認する。' }),
      }
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const listRes = await app.request(
      `http://localhost/api/repositories/${repository.id}/missions`
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.map((mission: { id: string }) => mission.id)).toContain(created.id);
  });
});

describe('Mission Planner queue handoff', () => {
  it('prefers Mission proposal scheduling metadata when creating queue entries', async () => {
    const repository = await createRepository();
    const task = await nightworkersRepo.createTask({
      repositoryId: repository.id,
      title: `TEST: Mission queue handoff ${crypto.randomUUID()}`,
      description: 'Queue handoff fixture',
      objective: 'Use mission metadata',
      acceptanceCriteria: 'Queue entry receives sequence scheduling',
      status: 'ready',
      createdBy: 'mission-task-proposal',
    });
    await nightworkersRepo.createTaskMessage({
      taskId: task.id,
      role: 'system',
      content: 'Mission task proposal metadata attached.',
      messageType: 'text',
      payloadJson: {
        source: 'mission_task_proposal',
        missionProposal: {
          source: 'mission_task_proposal',
          missionId: crypto.randomUUID(),
          planningResultId: crypto.randomUUID(),
          proposalId: crypto.randomUUID(),
          workPackageId: 'wp-sequence',
          decompositionTaskId: 'task-sequence',
          dependencies: [],
          risk: 'medium',
          approvalRequired: false,
          scheduling: {
            executionType: 'sequence',
            reason: 'Mission-defined order',
            sequenceGroupId: 'mission-sequence-group',
            sequenceOrder: 3,
            dependsOnTaskIds: [],
          },
        },
      },
    });

    const entry = await queueService.createImplementationQueueEntry(task.id, { autoDrain: false });
    expect(entry).toMatchObject({
      executionType: 'sequence',
      sequenceGroupId: 'mission-sequence-group',
      sequenceOrder: 3,
      schedulingReason: 'Mission-defined order',
    });
  });
});
