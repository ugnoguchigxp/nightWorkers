import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  type MissionGoal,
  type MissionTaskCandidate,
  type MissionTaskCandidateBatch,
  missionGoalSchema,
  missionTaskCandidateBatchSchema,
  missionTaskCandidateSchema,
  type ProjectQualityRun,
  projectQualityRunSchema,
} from '../../../shared/schemas/project-detail.schema';
import { type DbTransaction, db } from '../../db/client';
import {
  missionGoals,
  missionTaskCandidateBatches,
  missionTaskCandidates,
  projectQualityRuns,
} from '../../db/project-detail-schema';
import { tasks } from '../../db/schema';

type Db = typeof db | DbTransaction;

function mapGoal(row: typeof missionGoals.$inferSelect): MissionGoal {
  return missionGoalSchema.parse(row);
}

function mapBatch(row: typeof missionTaskCandidateBatches.$inferSelect): MissionTaskCandidateBatch {
  return missionTaskCandidateBatchSchema.parse({
    id: row.id,
    repositoryId: row.repositoryId,
    status: row.status,
    requestedGoalIds: row.requestedGoalIdsJson,
    signalSnapshot: row.signalSnapshotJson,
    selectedModel: row.selectedModelJson ?? null,
    rawOutput: row.rawOutputJson ?? null,
    errorMessage: row.errorMessage ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapCandidate(
  row: typeof missionTaskCandidates.$inferSelect & { goalTitle?: string | null }
): MissionTaskCandidate {
  return missionTaskCandidateSchema.parse({
    id: row.id,
    batchId: row.batchId,
    repositoryId: row.repositoryId,
    goalId: row.goalId ?? null,
    goalTitle: row.goalTitle ?? null,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    evidence: row.evidenceJson,
    evaluationContribution: row.evaluationContribution ?? null,
    importancePercent: row.importancePercent,
    confidencePercent: row.confidencePercent,
    tokenSize: row.tokenSize,
    complexity: row.complexity,
    taskPrompt: row.taskPrompt,
    acceptanceCriteria: row.acceptanceCriteria,
    verificationPlan: row.verificationPlan,
    status: row.status,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapQualityRun(row: typeof projectQualityRuns.$inferSelect): ProjectQualityRun {
  return projectQualityRunSchema.parse({
    id: row.id,
    repositoryId: row.repositoryId,
    runType: row.runType,
    status: row.status,
    command: row.command,
    exitCode: row.exitCode ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? null,
    outputArtifactId: row.outputArtifactId ?? null,
    latestOutput: row.latestOutput ?? null,
    coverageSummary: row.coverageSummaryJson ?? null,
    coverageGate: row.coverageGateJson ?? null,
    e2eSummary: row.e2eSummaryJson ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export async function listMissionGoals(repositoryId: string) {
  const rows = await db
    .select()
    .from(missionGoals)
    .where(eq(missionGoals.repositoryId, repositoryId))
    .orderBy(missionGoals.sortOrder, missionGoals.createdAt);
  return rows.map(mapGoal);
}

export async function getMissionGoal(goalId: string) {
  const [row] = await db.select().from(missionGoals).where(eq(missionGoals.id, goalId));
  return row ? mapGoal(row) : null;
}

export async function createMissionGoal(input: {
  repositoryId: string;
  title: string;
  goalText: string;
  active: boolean;
  source?: 'user' | 'preset';
}) {
  const [latestGoal] = await db
    .select({ maxSortOrder: missionGoals.sortOrder })
    .from(missionGoals)
    .where(eq(missionGoals.repositoryId, input.repositoryId))
    .orderBy(desc(missionGoals.sortOrder))
    .limit(1);
  const [row] = await db
    .insert(missionGoals)
    .values({
      repositoryId: input.repositoryId,
      title: input.title,
      goalText: input.goalText,
      active: input.active,
      source: input.source ?? 'user',
      sortOrder: (latestGoal?.maxSortOrder ?? -1) + 1,
    })
    .returning();
  return mapGoal(row);
}

export async function updateMissionGoal(
  goalId: string,
  input: { title?: string; goalText?: string; active?: boolean; sortOrder?: number }
) {
  const [row] = await db
    .update(missionGoals)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(missionGoals.id, goalId))
    .returning();
  return row ? mapGoal(row) : null;
}

export async function deleteMissionGoal(goalId: string) {
  const [row] = await db.delete(missionGoals).where(eq(missionGoals.id, goalId)).returning();
  return row ? mapGoal(row) : null;
}

export async function createRunningMissionBatch(input: {
  repositoryId: string;
  requestedGoalIds: string[];
  signalSnapshot: unknown;
}) {
  const now = new Date();
  const [row] = await db
    .insert(missionTaskCandidateBatches)
    .values({
      repositoryId: input.repositoryId,
      status: 'running',
      requestedGoalIdsJson: input.requestedGoalIds,
      signalSnapshotJson: input.signalSnapshot,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapBatch(row);
}

export async function completeMissionBatch(input: {
  batchId: string;
  rawOutput: unknown;
  selectedModel: unknown;
}) {
  const [row] = await db
    .update(missionTaskCandidateBatches)
    .set({
      status: 'completed',
      rawOutputJson: input.rawOutput,
      selectedModelJson: input.selectedModel,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(missionTaskCandidateBatches.id, input.batchId))
    .returning();
  return row ? mapBatch(row) : null;
}

export async function failMissionBatch(input: {
  batchId: string;
  errorMessage: string;
  rawOutput?: unknown;
  selectedModel?: unknown;
}) {
  const [row] = await db
    .update(missionTaskCandidateBatches)
    .set({
      status: 'failed',
      errorMessage: input.errorMessage,
      rawOutputJson: input.rawOutput ?? null,
      selectedModelJson: input.selectedModel ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(missionTaskCandidateBatches.id, input.batchId))
    .returning();
  return row ? mapBatch(row) : null;
}

export async function createMissionCandidates(
  input: Array<typeof missionTaskCandidates.$inferInsert>
) {
  if (input.length === 0) return [];
  const rows = await db.insert(missionTaskCandidates).values(input).returning();
  return rows.map((row) => mapCandidate(row));
}

export async function listMissionCandidates(input: { repositoryId: string; status?: string }) {
  const filters = [eq(missionTaskCandidates.repositoryId, input.repositoryId)];
  if (input.status) filters.push(eq(missionTaskCandidates.status, input.status));
  const rows = await db
    .select({
      id: missionTaskCandidates.id,
      createdAt: missionTaskCandidates.createdAt,
      updatedAt: missionTaskCandidates.updatedAt,
      batchId: missionTaskCandidates.batchId,
      repositoryId: missionTaskCandidates.repositoryId,
      goalId: missionTaskCandidates.goalId,
      goalTitle: missionGoals.title,
      title: missionTaskCandidates.title,
      summary: missionTaskCandidates.summary,
      rationale: missionTaskCandidates.rationale,
      evidenceJson: missionTaskCandidates.evidenceJson,
      evaluationContribution: missionTaskCandidates.evaluationContribution,
      importancePercent: missionTaskCandidates.importancePercent,
      confidencePercent: missionTaskCandidates.confidencePercent,
      tokenSize: missionTaskCandidates.tokenSize,
      complexity: missionTaskCandidates.complexity,
      taskPrompt: missionTaskCandidates.taskPrompt,
      acceptanceCriteria: missionTaskCandidates.acceptanceCriteria,
      verificationPlan: missionTaskCandidates.verificationPlan,
      status: missionTaskCandidates.status,
      taskId: missionTaskCandidates.taskId,
    })
    .from(missionTaskCandidates)
    .leftJoin(missionGoals, eq(missionGoals.id, missionTaskCandidates.goalId))
    .where(and(...filters))
    .orderBy(desc(missionTaskCandidates.createdAt));
  return rows.map(mapCandidate);
}

export async function getMissionCandidate(candidateId: string) {
  const rows = await db
    .select({
      id: missionTaskCandidates.id,
      createdAt: missionTaskCandidates.createdAt,
      updatedAt: missionTaskCandidates.updatedAt,
      batchId: missionTaskCandidates.batchId,
      repositoryId: missionTaskCandidates.repositoryId,
      goalId: missionTaskCandidates.goalId,
      goalTitle: missionGoals.title,
      title: missionTaskCandidates.title,
      summary: missionTaskCandidates.summary,
      rationale: missionTaskCandidates.rationale,
      evidenceJson: missionTaskCandidates.evidenceJson,
      evaluationContribution: missionTaskCandidates.evaluationContribution,
      importancePercent: missionTaskCandidates.importancePercent,
      confidencePercent: missionTaskCandidates.confidencePercent,
      tokenSize: missionTaskCandidates.tokenSize,
      complexity: missionTaskCandidates.complexity,
      taskPrompt: missionTaskCandidates.taskPrompt,
      acceptanceCriteria: missionTaskCandidates.acceptanceCriteria,
      verificationPlan: missionTaskCandidates.verificationPlan,
      status: missionTaskCandidates.status,
      taskId: missionTaskCandidates.taskId,
    })
    .from(missionTaskCandidates)
    .leftJoin(missionGoals, eq(missionGoals.id, missionTaskCandidates.goalId))
    .where(eq(missionTaskCandidates.id, candidateId))
    .limit(1);
  return rows[0] ? mapCandidate(rows[0]) : null;
}

export async function updateMissionCandidate(
  candidateId: string,
  input: { status?: string; taskId?: string | null },
  database: Db = db
) {
  const [row] = await database
    .update(missionTaskCandidates)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(missionTaskCandidates.id, candidateId))
    .returning();
  return row ? mapCandidate(row) : null;
}

export async function listMissionCandidatesByIds(candidateIds: string[], database: Db = db) {
  if (candidateIds.length === 0) return [];
  const rows = await database
    .select()
    .from(missionTaskCandidates)
    .where(inArray(missionTaskCandidates.id, candidateIds));
  return rows.map((row) => mapCandidate(row));
}

export async function createTaskFromMissionCandidate(
  candidate: MissionTaskCandidate,
  status: 'draft' | 'ready',
  database: Db = db
) {
  const [task] = await database
    .insert(tasks)
    .values({
      repositoryId: candidate.repositoryId,
      title: candidate.title,
      description: [
        candidate.summary,
        '',
        'Rationale:',
        candidate.rationale,
        '',
        'Evidence:',
        ...candidate.evidence.map((item) => `- ${item.label}: ${item.value}`),
      ].join('\n'),
      objective: candidate.taskPrompt,
      acceptanceCriteria: `${candidate.acceptanceCriteria}\n\nVerification:\n${candidate.verificationPlan}`,
      status,
      createdBy: 'mission-task-candidate',
    })
    .returning();
  return task;
}

export async function createProjectQualityRun(input: {
  repositoryId: string;
  runType: 'unit' | 'e2e' | 'all';
  command: string;
}) {
  const now = new Date();
  const [row] = await db
    .insert(projectQualityRuns)
    .values({
      repositoryId: input.repositoryId,
      runType: input.runType,
      status: 'running',
      command: input.command,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapQualityRun(row);
}

export async function completeProjectQualityRun(input: {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode?: number | null;
  latestOutput?: string | null;
  coverageSummary?: unknown;
  coverageGate?: unknown;
  e2eSummary?: unknown;
  errorMessage?: string | null;
}) {
  const [row] = await db
    .update(projectQualityRuns)
    .set({
      status: input.status,
      exitCode: input.exitCode ?? null,
      latestOutput: input.latestOutput ?? null,
      coverageSummaryJson: input.coverageSummary ?? null,
      coverageGateJson: input.coverageGate ?? null,
      e2eSummaryJson: input.e2eSummary ?? null,
      errorMessage: input.errorMessage ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectQualityRuns.id, input.runId))
    .returning();
  return row ? mapQualityRun(row) : null;
}

export async function listProjectQualityRuns(repositoryId: string) {
  const rows = await db
    .select()
    .from(projectQualityRuns)
    .where(eq(projectQualityRuns.repositoryId, repositoryId))
    .orderBy(desc(projectQualityRuns.createdAt));
  return rows.map(mapQualityRun);
}

export async function getProjectQualityRun(runId: string) {
  const [row] = await db.select().from(projectQualityRuns).where(eq(projectQualityRuns.id, runId));
  return row ? mapQualityRun(row) : null;
}

export async function getLatestProjectQualityRun(input: {
  repositoryId: string;
  runType?: string;
}) {
  const filters = [eq(projectQualityRuns.repositoryId, input.repositoryId)];
  if (input.runType) filters.push(eq(projectQualityRuns.runType, input.runType));
  const [row] = await db
    .select()
    .from(projectQualityRuns)
    .where(and(...filters))
    .orderBy(desc(projectQualityRuns.createdAt))
    .limit(1);
  return row ? mapQualityRun(row) : null;
}

export async function listRunningProjectQualityRuns(repositoryId: string) {
  const rows = await db
    .select()
    .from(projectQualityRuns)
    .where(
      and(
        eq(projectQualityRuns.repositoryId, repositoryId),
        eq(projectQualityRuns.status, 'running')
      )
    )
    .orderBy(desc(projectQualityRuns.createdAt));
  return rows.map(mapQualityRun);
}
