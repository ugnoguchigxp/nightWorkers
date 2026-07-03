import { z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import {
  type CreateTasksFromMissionTaskProposalsResponse,
  type Mission,
  type MissionDecompositionPlanningResult,
  type MissionDetail,
  type MissionPlanningResult,
  type MissionProposalTaskMetadata,
  type MissionTaskProposal,
  missionDecompositionPlanningResultSchema,
  missionProposalTaskMetadataSchema,
} from '../../../shared/schemas/mission-planner.schema';
import { type DbTransaction, db } from '../../db/client';
import { tasks } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';
import * as projectDetailRepo from '../project-detail/project-detail.repository';
import { buildProjectSignalSnapshot } from '../project-detail/project-signal-snapshot.service';
import {
  buildMissionDraftSystemPrompt,
  buildMissionDraftUserPrompt,
  buildMissionPlannerInputBundle,
  buildMissionStructureSystemPrompt,
  buildMissionStructureUserPrompt,
  buildMissionTaskProposalsSystemPrompt,
  buildMissionTaskProposalsUserPrompt,
} from './mission-planner.prompts';
import * as repo from './mission-planner.repository';
import {
  callMissionPlannerJson,
  evaluateMissionDecomposition,
  type MissionPlannerLlmSelection,
} from './mission-planner-evaluation.service';
import { validateMissionPlanningResult } from './mission-planner-validation';

const missionDraftSchema = z.object({
  schemaVersion: z.literal('nightworkers.mission-draft/v1'),
  mission: z.object({
    title: z.string().min(1),
    goal: z.string().min(1),
    nonGoals: z.array(z.string()).default([]),
  }),
  blockingClarification: z.boolean().default(false),
  clarificationQuestions: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
});

const missionStructureSchema = z.object({
  schemaVersion: z.literal('nightworkers.mission-structure/v1'),
  objectives: missionDecompositionPlanningResultSchema.shape.objectives,
  workPackages: missionDecompositionPlanningResultSchema.shape.workPackages,
  replanningUnits: missionDecompositionPlanningResultSchema.shape.replanningUnits,
});

const missionTaskProposalsStageSchema = z.object({
  schemaVersion: z.literal('nightworkers.mission-task-proposals/v1'),
  taskProposals: missionDecompositionPlanningResultSchema.shape.taskProposals,
});

async function requireRepository(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) throw new NotFoundError('Repository not found');
  return repository;
}

function defaultMissionTitle(goalText: string) {
  const normalized = goalText.trim().replace(/\s+/g, ' ');
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

async function sourceGoalsForMission(mission: Mission) {
  const goals = await projectDetailRepo.listMissionGoals(mission.repositoryId);
  const selected = mission.sourceGoalIds.length
    ? goals.filter((goal) => mission.sourceGoalIds.includes(goal.id))
    : goals.filter((goal) => goal.active);
  return { allGoals: goals, sourceGoals: selected };
}

async function existingTaskTitles(repositoryId: string) {
  const rows = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.repositoryId, repositoryId));
  return rows.map((row) => row.title);
}

async function buildInputForMission(mission: Mission) {
  const repository = await requireRepository(mission.repositoryId);
  const { sourceGoals } = await sourceGoalsForMission(mission);
  const signal = await buildProjectSignalSnapshot({ repository, goals: sourceGoals });
  const inputBundle = buildMissionPlannerInputBundle({
    mission,
    sourceGoals,
    signal,
    contextStillGuardrails: null,
  });
  return { repository, sourceGoals, signal, inputBundle };
}

async function missionDetail(mission: Mission): Promise<MissionDetail> {
  const latestPlanningResult = mission.latestPlanningResultId
    ? await repo.getPlanningResult(mission.latestPlanningResultId)
    : null;
  const taskProposals = latestPlanningResult
    ? await repo.listTaskProposals(latestPlanningResult.id)
    : await repo.listTaskProposalsForMission(mission.id);
  return { mission, latestPlanningResult, taskProposals };
}

export async function createMission(input: {
  repositoryId: string;
  title?: string;
  goalText: string;
  nonGoals?: string[];
  sourceGoalIds?: string[];
}) {
  await requireRepository(input.repositoryId);
  const sourceGoalIds = [...new Set(input.sourceGoalIds ?? [])];
  if (sourceGoalIds.length) {
    const goals = await projectDetailRepo.listMissionGoals(input.repositoryId);
    const goalIds = new Set(goals.map((goal) => goal.id));
    const missing = sourceGoalIds.filter((id) => !goalIds.has(id));
    if (missing.length) throw new ValidationError('Mission source goal not found', { missing });
  }
  return repo.createMission({
    repositoryId: input.repositoryId,
    title: input.title?.trim() || defaultMissionTitle(input.goalText),
    goalText: input.goalText.trim(),
    nonGoals: input.nonGoals ?? [],
    sourceGoalIds,
  });
}

export async function listMissions(repositoryId: string) {
  await requireRepository(repositoryId);
  return repo.listMissions(repositoryId);
}

export async function getMissionDetail(missionId: string) {
  const mission = await repo.getMission(missionId);
  if (!mission) throw new NotFoundError('Mission not found');
  return missionDetail(mission);
}

function mergePlanningResult(input: {
  missionDraft: z.infer<typeof missionDraftSchema>;
  structure: z.infer<typeof missionStructureSchema>;
  taskProposals: z.infer<typeof missionTaskProposalsStageSchema>;
}): MissionDecompositionPlanningResult {
  return missionDecompositionPlanningResultSchema.parse({
    schemaVersion: 'nightworkers.mission-decomposition-result/v1',
    mission: input.missionDraft.mission,
    objectives: input.structure.objectives,
    workPackages: input.structure.workPackages,
    taskProposals: input.taskProposals.taskProposals,
    replanningUnits: input.structure.replanningUnits,
  });
}

function finalStatusFromEvaluation(verdict: string) {
  if (verdict === 'review_ready' || verdict === 'needs_human_approval') {
    return { missionStatus: 'review_pending', resultStatus: 'review_pending' };
  }
  if (verdict === 'needs_clarification') {
    return { missionStatus: 'needs_clarification', resultStatus: 'needs_clarification' };
  }
  if (verdict === 'blocked') return { missionStatus: 'blocked', resultStatus: 'blocked' };
  return { missionStatus: 'draft', resultStatus: 'needs_revision' };
}

async function persistReviewPendingProposals(
  input: {
    mission: Mission;
    planningResult: MissionPlanningResult;
  },
  database?: DbTransaction
) {
  const existing = await repo.listTaskProposals(input.planningResult.id, database);
  const existingDecompositionTaskIds = new Set(
    existing.map((proposal) => proposal.decompositionTaskId)
  );
  const rows = input.planningResult.planningResult.taskProposals
    .filter((proposal) => !existingDecompositionTaskIds.has(proposal.id))
    .map((proposal) => ({
      missionId: input.mission.id,
      planningResultId: input.planningResult.id,
      repositoryId: input.mission.repositoryId,
      workPackageId: proposal.workPackageId,
      decompositionTaskId: proposal.id,
      status: 'proposed',
      title: proposal.title,
      summary: proposal.summary,
      initialPrompt: proposal.initialPrompt,
      expectedOutcome: proposal.expectedOutcome,
      implementationFocusJson: proposal.implementationFocus,
      acceptanceCriteriaJson: proposal.acceptanceCriteria,
      verificationGateJson: proposal.verificationGate,
      dependenciesJson: proposal.dependencies,
      targetFilesOrModulesJson: proposal.targetFilesOrModules,
      risk: proposal.risk,
      approvalRequired: proposal.approvalRequired,
      schedulingJson: proposal.scheduling,
    }));
  return repo.createTaskProposals(rows, database);
}

export async function decomposeMission(input: { missionId: string; force?: boolean }) {
  const mission = await repo.getMission(input.missionId);
  if (!mission) throw new NotFoundError('Mission not found');
  if (!input.force) {
    const activeResults = await repo.listActivePlanningResultsForMission(mission.id);
    if (activeResults.some((result) => result.status === 'review_pending')) {
      throw new AppError(
        409,
        'MISSION_REVIEW_PENDING',
        'Mission already has a review pending result.'
      );
    }
  }

  const { signal, inputBundle } = await buildInputForMission(mission);
  await repo.updateMission(mission.id, { status: 'decomposing', statusReason: null });
  const run = await repo.createRunningDecompositionRun({
    missionId: mission.id,
    repositoryId: mission.repositoryId,
    inputBundle,
  });
  const stageOutputs = run.stageOutputs;
  const selectedModels: MissionPlannerLlmSelection[] = [];
  let currentMission = mission;
  try {
    const missionDraftCall = await callMissionPlannerJson({
      stage: 'mission_draft',
      systemPrompt: buildMissionDraftSystemPrompt(),
      userPrompt: buildMissionDraftUserPrompt({ inputBundle }),
      schemaName: 'mission_draft',
      schema: missionDraftSchema,
      onSelection: (selection) => selectedModels.push(selection),
    });
    stageOutputs.missionDraft = missionDraftCall.rawOutput;
    if (!selectedModels.some((selection) => selection.stage === 'mission_draft')) {
      selectedModels.push(missionDraftCall.selectedModel);
    }
    await repo.updateDecompositionRun(run.id, { stageOutputs, selectedModels });
    const normalizedMission = await repo.updateMission(mission.id, {
      title: missionDraftCall.parsed.mission.title,
      goalText: missionDraftCall.parsed.mission.goal,
      nonGoals: missionDraftCall.parsed.mission.nonGoals,
    });
    if (!normalizedMission) throw new NotFoundError('Mission not found');
    currentMission = normalizedMission;

    if (missionDraftCall.parsed.blockingClarification) {
      await db.transaction(async (tx) => {
        await repo.updateDecompositionRun(
          run.id,
          { status: 'completed', stageOutputs, selectedModels, completedAt: new Date() },
          tx
        );
        await repo.updateMission(
          currentMission.id,
          {
            status: 'needs_clarification',
            statusReason: missionDraftCall.parsed.clarificationQuestions.join('\n') || null,
          },
          tx
        );
      });
      const updated = await repo.getMission(currentMission.id);
      if (!updated) throw new NotFoundError('Mission not found');
      return missionDetail(updated);
    }

    const structureCall = await callMissionPlannerJson({
      stage: 'structure',
      systemPrompt: buildMissionStructureSystemPrompt(),
      userPrompt: buildMissionStructureUserPrompt({
        missionDraft: missionDraftCall.parsed,
        inputBundle,
      }),
      schemaName: 'mission_structure',
      schema: missionStructureSchema,
      onSelection: (selection) => selectedModels.push(selection),
    });
    stageOutputs.structure = structureCall.rawOutput;
    if (!selectedModels.some((selection) => selection.stage === 'structure')) {
      selectedModels.push(structureCall.selectedModel);
    }
    await repo.updateDecompositionRun(run.id, { stageOutputs, selectedModels });

    const taskProposalsCall = await callMissionPlannerJson({
      stage: 'task_proposals',
      systemPrompt: buildMissionTaskProposalsSystemPrompt(),
      userPrompt: buildMissionTaskProposalsUserPrompt({
        missionDraft: missionDraftCall.parsed,
        structure: structureCall.parsed,
        inputBundle,
        existingTaskTitles: await existingTaskTitles(mission.repositoryId),
      }),
      schemaName: 'mission_task_proposals',
      schema: missionTaskProposalsStageSchema,
      onSelection: (selection) => selectedModels.push(selection),
    });
    stageOutputs.taskProposals = taskProposalsCall.rawOutput;
    if (!selectedModels.some((selection) => selection.stage === 'task_proposals')) {
      selectedModels.push(taskProposalsCall.selectedModel);
    }

    const planningResultJson = mergePlanningResult({
      missionDraft: missionDraftCall.parsed,
      structure: structureCall.parsed,
      taskProposals: taskProposalsCall.parsed,
    });
    const draftResult = await repo.createPlanningResult({
      missionId: mission.id,
      repositoryId: mission.repositoryId,
      decompositionRunId: run.id,
      status: 'draft',
      planningResult: planningResultJson,
    });
    await repo.updateMission(mission.id, {
      status: 'evaluating',
      latestPlanningResultId: draftResult.id,
    });

    const deterministicChecks = validateMissionPlanningResult(planningResultJson);
    if (deterministicChecks.status === 'fail') {
      await db.transaction(async (tx) => {
        await repo.updatePlanningResult(
          draftResult.id,
          {
            status: 'needs_revision',
            deterministicChecks,
            statusReason: 'Deterministic validation failed.',
          },
          tx
        );
        await repo.updateDecompositionRun(
          run.id,
          { status: 'completed', stageOutputs, selectedModels, completedAt: new Date() },
          tx
        );
        await repo.updateMission(
          mission.id,
          {
            status: 'draft',
            statusReason: 'Deterministic validation failed.',
          },
          tx
        );
      });
      const updated = await repo.getMission(mission.id);
      if (!updated) throw new NotFoundError('Mission not found');
      return missionDetail(updated);
    }

    const evaluated = await evaluateMissionDecomposition({
      mission: currentMission,
      planningResult: planningResultJson,
      deterministicChecks,
      signal,
      existingTaskTitles: await existingTaskTitles(mission.repositoryId),
    });
    stageOutputs.evaluation = evaluated.rawOutput;
    if (!selectedModels.some((selection) => selection.stage === 'evaluation')) {
      selectedModels.push(evaluated.selectedModel);
    }
    const finalStatus = finalStatusFromEvaluation(evaluated.parsed.verdict);
    await db.transaction(async (tx) => {
      const updatedResult = await repo.updatePlanningResult(
        draftResult.id,
        {
          status: finalStatus.resultStatus,
          deterministicChecks,
          evaluation: evaluated.parsed,
          statusReason: evaluated.parsed.verdict,
        },
        tx
      );
      await repo.updateDecompositionRun(
        run.id,
        { status: 'completed', stageOutputs, selectedModels, completedAt: new Date() },
        tx
      );
      await repo.updateMission(
        currentMission.id,
        {
          status: finalStatus.missionStatus,
          latestPlanningResultId: draftResult.id,
          statusReason: evaluated.parsed.verdict,
        },
        tx
      );
      if (updatedResult && updatedResult.status === 'review_pending') {
        await persistReviewPendingProposals(
          { mission: currentMission, planningResult: updatedResult },
          tx
        );
      }
    });
    const updated = await repo.getMission(currentMission.id);
    if (!updated) throw new NotFoundError('Mission not found');
    return missionDetail(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.transaction(async (tx) => {
      await repo.updateDecompositionRun(
        run.id,
        {
          status: 'failed',
          stageOutputs,
          selectedModels,
          errorMessage: message,
          completedAt: new Date(),
        },
        tx
      );
      await repo.updateMission(mission.id, { status: 'blocked', statusReason: message }, tx);
    });
    throw new ValidationError('Mission decomposition failed', { message });
  }
}

export async function evaluatePlanningResult(resultId: string) {
  const planningResult = await repo.getPlanningResult(resultId);
  if (!planningResult) throw new NotFoundError('Mission planning result not found');
  const mission = await repo.getMission(planningResult.missionId);
  if (!mission) throw new NotFoundError('Mission not found');
  const run = await repo.getDecompositionRun(planningResult.decompositionRunId);
  const inputBundle = run?.inputBundle as { projectSignalSnapshot?: unknown } | undefined;
  const signal = inputBundle?.projectSignalSnapshot;
  if (!signal || typeof signal !== 'object') {
    throw new ValidationError(
      'Mission planning result cannot be evaluated without input bundle signal'
    );
  }
  const deterministicChecks =
    planningResult.deterministicChecks ??
    validateMissionPlanningResult(planningResult.planningResult);
  if (deterministicChecks.status === 'fail') {
    const updated = await repo.updatePlanningResult(resultId, {
      status: 'needs_revision',
      deterministicChecks,
      statusReason: 'Deterministic validation failed.',
    });
    if (!updated) throw new NotFoundError('Mission planning result not found');
    return updated;
  }
  const evaluated = await evaluateMissionDecomposition({
    mission,
    planningResult: planningResult.planningResult,
    deterministicChecks,
    signal: signal as never,
    existingTaskTitles: await existingTaskTitles(mission.repositoryId),
  });
  const finalStatus = finalStatusFromEvaluation(evaluated.parsed.verdict);
  const updated = await db.transaction(async (tx) => {
    const updatedResult = await repo.updatePlanningResult(
      resultId,
      {
        status: finalStatus.resultStatus,
        deterministicChecks,
        evaluation: evaluated.parsed,
        statusReason: evaluated.parsed.verdict,
      },
      tx
    );
    if (!updatedResult) throw new NotFoundError('Mission planning result not found');
    await repo.updateMission(
      mission.id,
      {
        status: finalStatus.missionStatus,
        latestPlanningResultId: updatedResult.id,
        statusReason: evaluated.parsed.verdict,
      },
      tx
    );
    if (updatedResult.status === 'review_pending') {
      await persistReviewPendingProposals({ mission, planningResult: updatedResult }, tx);
    }
    return updatedResult;
  });
  return updated;
}

export async function listPlanningResults(missionId: string) {
  const mission = await repo.getMission(missionId);
  if (!mission) throw new NotFoundError('Mission not found');
  return repo.listPlanningResults(missionId);
}

export async function requestPlanningRevision(input: { planningResultId: string; reason: string }) {
  const planningResult = await repo.getPlanningResult(input.planningResultId);
  if (!planningResult) throw new NotFoundError('Mission planning result not found');
  const updated = await repo.updatePlanningResult(planningResult.id, {
    status: 'needs_revision',
    statusReason: input.reason,
  });
  await repo.updateMission(planningResult.missionId, {
    status: 'draft',
    statusReason: input.reason,
  });
  if (!updated) throw new NotFoundError('Mission planning result not found');
  return updated;
}

export async function listTaskProposals(planningResultId: string) {
  const planningResult = await repo.getPlanningResult(planningResultId);
  if (!planningResult) throw new NotFoundError('Mission planning result not found');
  return repo.listTaskProposals(planningResultId);
}

export async function dismissTaskProposal(proposalId: string) {
  const proposal = await repo.getTaskProposal(proposalId);
  if (!proposal) throw new NotFoundError('Mission task proposal not found');
  if (proposal.status === 'task_created') {
    throw new ValidationError('Task-created proposals cannot be dismissed');
  }
  const updated = await repo.updateTaskProposal(proposal.id, { status: 'dismissed' });
  if (!updated) throw new NotFoundError('Mission task proposal not found');
  return updated;
}

function workPackageForProposal(
  planningResult: MissionPlanningResult,
  proposal: MissionTaskProposal
) {
  return planningResult.planningResult.workPackages.find(
    (workPackage) => workPackage.id === proposal.workPackageId
  );
}

function buildTaskObjective(input: {
  proposal: MissionTaskProposal;
  planningResult: MissionPlanningResult;
}) {
  const workPackage = workPackageForProposal(input.planningResult, input.proposal);
  if (!workPackage?.suggestedPlanMode) return input.proposal.initialPrompt;
  return [
    'この Mission proposal は、まず実装計画を作成してください。',
    'Plan 完了後に Implementation Queue へ入れて実装する前提で、Queue 実行者が迷わない粒度にしてください。',
    '',
    '[Mission proposal initial prompt]',
    input.proposal.initialPrompt,
  ].join('\n');
}

function buildTaskDescription(input: {
  mission: Mission;
  proposal: MissionTaskProposal;
  planningResult: MissionPlanningResult;
}) {
  const workPackage = workPackageForProposal(input.planningResult, input.proposal);
  return [
    input.proposal.summary,
    '',
    `Source Mission: ${input.mission.id}`,
    `Planning Result: ${input.planningResult.id}`,
    `Work Package: ${workPackage?.title ?? input.proposal.workPackageId} (${input.proposal.workPackageId})`,
    `Expected outcome: ${input.proposal.expectedOutcome}`,
    `Risk: ${input.proposal.risk}`,
    `Approval required: ${input.proposal.approvalRequired ? 'yes' : 'no'}`,
    input.proposal.dependencies.length
      ? `Dependencies:\n${input.proposal.dependencies.map((dependency) => `- ${dependency}`).join('\n')}`
      : 'Dependencies: none',
    input.proposal.implementationFocus.length
      ? `Implementation focus:\n${input.proposal.implementationFocus.map((focus) => `- ${focus}`).join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildAcceptanceCriteria(proposal: MissionTaskProposal) {
  return [
    ...proposal.acceptanceCriteria,
    '',
    'Verification gate:',
    ...proposal.verificationGate.map((gate) => `- ${gate}`),
  ].join('\n');
}

function metadataForProposal(proposal: MissionTaskProposal): MissionProposalTaskMetadata {
  return missionProposalTaskMetadataSchema.parse({
    source: 'mission_task_proposal',
    missionId: proposal.missionId,
    planningResultId: proposal.planningResultId,
    proposalId: proposal.id,
    workPackageId: proposal.workPackageId,
    decompositionTaskId: proposal.decompositionTaskId,
    dependencies: proposal.dependencies,
    risk: proposal.risk,
    approvalRequired: proposal.approvalRequired,
    scheduling: proposal.scheduling,
  });
}

export async function createTasksFromMissionTaskProposals(input: {
  proposalIds: string[];
  mode: 'draft' | 'ready';
}): Promise<CreateTasksFromMissionTaskProposalsResponse> {
  const uniqueProposalIds = [...new Set(input.proposalIds)];
  const foundProposals = await repo.getTaskProposalsByIds(uniqueProposalIds);
  if (foundProposals.length !== uniqueProposalIds.length) {
    throw new NotFoundError('Mission task proposal not found');
  }
  const proposalById = new Map(foundProposals.map((proposal) => [proposal.id, proposal]));
  const proposals = uniqueProposalIds
    .map((proposalId) => proposalById.get(proposalId))
    .filter((proposal): proposal is MissionTaskProposal => Boolean(proposal));
  const repositoryIds = new Set(proposals.map((proposal) => proposal.repositoryId));
  if (repositoryIds.size !== 1) {
    throw new ValidationError('Selected Mission task proposals must belong to one repository');
  }
  for (const proposal of proposals) {
    if (proposal.status === 'task_created' || proposal.taskId) {
      throw new ValidationError('Mission task proposal already has a linked task', {
        proposalId: proposal.id,
      });
    }
    if (proposal.status === 'dismissed') {
      throw new ValidationError('Dismissed Mission task proposals cannot be converted to tasks', {
        proposalId: proposal.id,
      });
    }
  }

  const planningResults = new Map<string, MissionPlanningResult>();
  const missions = new Map<string, Mission>();
  for (const proposal of proposals) {
    const planningResult = await repo.getPlanningResult(proposal.planningResultId);
    if (!planningResult) throw new NotFoundError('Mission planning result not found');
    const mission = await repo.getMission(proposal.missionId);
    if (!mission) throw new NotFoundError('Mission not found');
    if (planningResult.status !== 'review_pending') {
      throw new ValidationError(
        'Mission task proposals can only be converted from review_pending planning results',
        {
          planningResultId: planningResult.id,
          status: planningResult.status,
        }
      );
    }
    if (mission.latestPlanningResultId !== planningResult.id) {
      throw new ValidationError('Mission task proposal belongs to a stale planning result', {
        missionId: mission.id,
        planningResultId: planningResult.id,
        latestPlanningResultId: mission.latestPlanningResultId,
      });
    }
    planningResults.set(planningResult.id, planningResult);
    missions.set(mission.id, mission);
  }

  const created = [];
  const updatedProposals = [];
  for (let index = 0; index < proposals.length; index += 1) {
    const proposal = proposals[index];
    const planningResult = planningResults.get(proposal.planningResultId);
    const mission = missions.get(proposal.missionId);
    if (!planningResult || !mission) continue;
    const task = await nightworkersRepo.createTask({
      repositoryId: proposal.repositoryId,
      title: proposal.title,
      description: buildTaskDescription({ mission, proposal, planningResult }),
      objective: buildTaskObjective({ proposal, planningResult }),
      acceptanceCriteria: buildAcceptanceCriteria(proposal),
      status: input.mode,
      priority: proposals.length - index,
      createdBy: 'mission-task-proposal',
    });
    await nightworkersRepo.createTaskMessage({
      taskId: task.id,
      role: 'system',
      content: 'Mission task proposal metadata attached.',
      messageType: 'text',
      payloadJson: {
        source: 'mission_task_proposal',
        missionProposal: metadataForProposal(proposal),
      },
    });
    const updated = await repo.updateTaskProposal(proposal.id, {
      status: 'task_created',
      taskId: task.id,
    });
    created.push(task);
    if (updated) updatedProposals.push(updated);
    if (mission.status === 'review_pending') {
      await repo.updateMission(mission.id, { status: 'active', statusReason: null });
    }
  }
  return { tasks: created, proposals: updatedProposals };
}
