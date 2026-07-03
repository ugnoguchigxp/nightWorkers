import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  type Mission,
  type MissionDecompositionRun,
  type MissionDeterministicCheckReport,
  type MissionPlanningResult,
  type MissionTaskProposal,
  missionDecompositionRunSchema,
  missionPlanningResultSchema,
  missionSchema,
  missionTaskProposalSchema,
} from '../../../shared/schemas/mission-planner.schema';
import { type DbTransaction, db } from '../../db/client';
import {
  missionDecompositionRuns,
  missionPlanningResults,
  missions,
  missionTaskProposals,
} from '../../db/mission-planner-schema';

type Db = typeof db | DbTransaction;

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mapMission(row: typeof missions.$inferSelect): Mission {
  return missionSchema.parse({
    id: row.id,
    repositoryId: row.repositoryId,
    title: row.title,
    goalText: row.goalText,
    nonGoals: stringArray(row.nonGoalsJson),
    status: row.status,
    sourceGoalIds: stringArray(row.sourceGoalIdsJson),
    latestPlanningResultId: row.latestPlanningResultId ?? null,
    statusReason: row.statusReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapRun(row: typeof missionDecompositionRuns.$inferSelect): MissionDecompositionRun {
  return missionDecompositionRunSchema.parse({
    id: row.id,
    missionId: row.missionId,
    repositoryId: row.repositoryId,
    status: row.status,
    inputBundle: row.inputBundleJson,
    stageOutputs: row.stageOutputsJson,
    selectedModels: row.selectedModelsJson,
    errorMessage: row.errorMessage ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapPlanningResult(row: typeof missionPlanningResults.$inferSelect): MissionPlanningResult {
  return missionPlanningResultSchema.parse({
    id: row.id,
    missionId: row.missionId,
    repositoryId: row.repositoryId,
    decompositionRunId: row.decompositionRunId,
    status: row.status,
    planningResult: row.planningResultJson,
    deterministicChecks: row.deterministicChecksJson ?? null,
    evaluation: row.evaluationJson ?? null,
    statusReason: row.statusReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapProposal(row: typeof missionTaskProposals.$inferSelect): MissionTaskProposal {
  return missionTaskProposalSchema.parse({
    id: row.id,
    missionId: row.missionId,
    planningResultId: row.planningResultId,
    repositoryId: row.repositoryId,
    workPackageId: row.workPackageId,
    decompositionTaskId: row.decompositionTaskId,
    status: row.status,
    title: row.title,
    summary: row.summary,
    initialPrompt: row.initialPrompt,
    expectedOutcome: row.expectedOutcome,
    implementationFocus: row.implementationFocusJson,
    acceptanceCriteria: row.acceptanceCriteriaJson,
    verificationGate: row.verificationGateJson,
    dependencies: row.dependenciesJson,
    targetFilesOrModules: row.targetFilesOrModulesJson,
    risk: row.risk,
    approvalRequired: row.approvalRequired,
    scheduling: row.schedulingJson,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function createMission(input: {
  repositoryId: string;
  title: string;
  goalText: string;
  nonGoals: string[];
  sourceGoalIds: string[];
  statusReason?: string | null;
}) {
  const now = new Date();
  const [row] = await db
    .insert(missions)
    .values({
      repositoryId: input.repositoryId,
      title: input.title,
      goalText: input.goalText,
      nonGoalsJson: input.nonGoals,
      sourceGoalIdsJson: input.sourceGoalIds,
      status: 'draft',
      statusReason: input.statusReason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapMission(row);
}

export async function listMissions(repositoryId: string) {
  const rows = await db
    .select()
    .from(missions)
    .where(eq(missions.repositoryId, repositoryId))
    .orderBy(desc(missions.createdAt));
  return rows.map(mapMission);
}

export async function getMission(missionId: string, database: Db = db) {
  const [row] = await database.select().from(missions).where(eq(missions.id, missionId));
  return row ? mapMission(row) : null;
}

export async function deleteMission(missionId: string) {
  const [row] = await db.delete(missions).where(eq(missions.id, missionId)).returning();
  return row ? mapMission(row) : null;
}

export async function updateMission(
  missionId: string,
  input: {
    status?: string;
    latestPlanningResultId?: string | null;
    statusReason?: string | null;
    title?: string;
    goalText?: string;
    nonGoals?: string[];
  },
  database: Db = db
) {
  const [row] = await database
    .update(missions)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.latestPlanningResultId !== undefined
        ? { latestPlanningResultId: input.latestPlanningResultId }
        : {}),
      ...(input.statusReason !== undefined ? { statusReason: input.statusReason } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.goalText !== undefined ? { goalText: input.goalText } : {}),
      ...(input.nonGoals !== undefined ? { nonGoalsJson: input.nonGoals } : {}),
      updatedAt: new Date(),
    })
    .where(eq(missions.id, missionId))
    .returning();
  return row ? mapMission(row) : null;
}

export async function createRunningDecompositionRun(input: {
  missionId: string;
  repositoryId: string;
  inputBundle: unknown;
}) {
  const now = new Date();
  const [row] = await db
    .insert(missionDecompositionRuns)
    .values({
      missionId: input.missionId,
      repositoryId: input.repositoryId,
      status: 'running',
      inputBundleJson: input.inputBundle,
      stageOutputsJson: {
        missionDraft: null,
        structure: null,
        taskProposals: null,
        evaluation: null,
      },
      selectedModelsJson: [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapRun(row);
}

export async function updateDecompositionRun(
  runId: string,
  input: {
    status?: 'running' | 'completed' | 'failed';
    stageOutputs?: MissionDecompositionRun['stageOutputs'];
    selectedModels?: MissionDecompositionRun['selectedModels'];
    errorMessage?: string | null;
    completedAt?: Date | null;
  },
  database: Db = db
) {
  const [row] = await database
    .update(missionDecompositionRuns)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(input.stageOutputs ? { stageOutputsJson: input.stageOutputs } : {}),
      ...(input.selectedModels ? { selectedModelsJson: input.selectedModels } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(missionDecompositionRuns.id, runId))
    .returning();
  return row ? mapRun(row) : null;
}

export async function getDecompositionRun(runId: string, database: Db = db) {
  const [row] = await database
    .select()
    .from(missionDecompositionRuns)
    .where(eq(missionDecompositionRuns.id, runId));
  return row ? mapRun(row) : null;
}

export async function createPlanningResult(
  input: {
    missionId: string;
    repositoryId: string;
    decompositionRunId: string;
    status: string;
    planningResult: unknown;
    deterministicChecks?: MissionDeterministicCheckReport | null;
    evaluation?: unknown | null;
    statusReason?: string | null;
  },
  database: Db = db
) {
  const now = new Date();
  const [row] = await database
    .insert(missionPlanningResults)
    .values({
      missionId: input.missionId,
      repositoryId: input.repositoryId,
      decompositionRunId: input.decompositionRunId,
      status: input.status,
      planningResultJson: input.planningResult,
      deterministicChecksJson: input.deterministicChecks ?? null,
      evaluationJson: input.evaluation ?? null,
      statusReason: input.statusReason ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapPlanningResult(row);
}

export async function getPlanningResult(resultId: string, database: Db = db) {
  const [row] = await database
    .select()
    .from(missionPlanningResults)
    .where(eq(missionPlanningResults.id, resultId));
  return row ? mapPlanningResult(row) : null;
}

export async function listPlanningResults(missionId: string) {
  const rows = await db
    .select()
    .from(missionPlanningResults)
    .where(eq(missionPlanningResults.missionId, missionId))
    .orderBy(desc(missionPlanningResults.createdAt));
  return rows.map(mapPlanningResult);
}

export async function updatePlanningResult(
  resultId: string,
  input: {
    status?: string;
    deterministicChecks?: MissionDeterministicCheckReport | null;
    evaluation?: unknown | null;
    statusReason?: string | null;
  },
  database: Db = db
) {
  const [row] = await database
    .update(missionPlanningResults)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.deterministicChecks !== undefined
        ? { deterministicChecksJson: input.deterministicChecks }
        : {}),
      ...(input.evaluation !== undefined ? { evaluationJson: input.evaluation } : {}),
      ...(input.statusReason !== undefined ? { statusReason: input.statusReason } : {}),
      updatedAt: new Date(),
    })
    .where(eq(missionPlanningResults.id, resultId))
    .returning();
  return row ? mapPlanningResult(row) : null;
}

export async function createTaskProposals(
  proposals: Array<typeof missionTaskProposals.$inferInsert>,
  database: Db = db
) {
  if (proposals.length === 0) return [];
  const rows = await database.insert(missionTaskProposals).values(proposals).returning();
  return rows.map(mapProposal);
}

export async function listTaskProposals(planningResultId: string, database: Db = db) {
  const rows = await database
    .select()
    .from(missionTaskProposals)
    .where(eq(missionTaskProposals.planningResultId, planningResultId))
    .orderBy(missionTaskProposals.createdAt);
  return rows.map(mapProposal);
}

export async function listRepositoryTaskProposals(input: {
  repositoryId: string;
  status?: string;
}) {
  const conditions = [eq(missionTaskProposals.repositoryId, input.repositoryId)];
  if (input.status) conditions.push(eq(missionTaskProposals.status, input.status));
  const rows = await db
    .select()
    .from(missionTaskProposals)
    .where(and(...conditions))
    .orderBy(desc(missionTaskProposals.createdAt));
  return rows.map(mapProposal);
}

export async function listTaskProposalsForMission(missionId: string) {
  const rows = await db
    .select()
    .from(missionTaskProposals)
    .where(eq(missionTaskProposals.missionId, missionId))
    .orderBy(missionTaskProposals.createdAt);
  return rows.map(mapProposal);
}

export async function getTaskProposal(proposalId: string, database: Db = db) {
  const [row] = await database
    .select()
    .from(missionTaskProposals)
    .where(eq(missionTaskProposals.id, proposalId));
  return row ? mapProposal(row) : null;
}

export async function getTaskProposalsByIds(proposalIds: string[], database: Db = db) {
  if (proposalIds.length === 0) return [];
  const rows = await database
    .select()
    .from(missionTaskProposals)
    .where(inArray(missionTaskProposals.id, proposalIds));
  return rows.map(mapProposal);
}

export async function updateTaskProposal(
  proposalId: string,
  input: { status?: string; taskId?: string | null },
  database: Db = db
) {
  const [row] = await database
    .update(missionTaskProposals)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(missionTaskProposals.id, proposalId))
    .returning();
  return row ? mapProposal(row) : null;
}

export async function listActivePlanningResultsForMission(missionId: string) {
  const rows = await db
    .select()
    .from(missionPlanningResults)
    .where(
      and(
        eq(missionPlanningResults.missionId, missionId),
        inArray(missionPlanningResults.status, ['draft', 'evaluating', 'review_pending'])
      )
    );
  return rows.map(mapPlanningResult);
}
