import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
	type MissionGoal,
	type MissionTaskCandidate,
	type MissionTaskCandidateBatch,
	missionGoalSchema,
	missionTaskCandidateBatchSchema,
	missionTaskCandidateSchema,
	missionTaskCandidateSourceSchema,
} from "../../../shared/schemas/task-generation.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	missionGoals,
	missionTaskCandidateBatches,
	missionTaskCandidates,
} from "../../db/task-generation-schema";
import { createTask } from "../nightworkers/nightworkers.repository";
import { buildMissionCandidateTaskObjective } from "./mission-task-objective";

type Db = typeof db | DbTransaction;

function mapGoal(row: typeof missionGoals.$inferSelect): MissionGoal {
	return missionGoalSchema.parse({
		id: row.id,
		repositoryId: row.repositoryId,
		title: row.title,
		goalText: row.goalText,
		active: row.active,
		source: row.source,
		sortOrder: row.sortOrder,
		interpretation: {
			scope: row.interpretationScope,
			intent: row.interpretationIntent,
			source: row.interpretationSource,
			confidencePercent: row.interpretationConfidencePercent,
			reason: row.interpretationReason ?? null,
		},
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapBatch(
	row: typeof missionTaskCandidateBatches.$inferSelect,
): MissionTaskCandidateBatch {
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

export function mapCandidate(
	row: typeof missionTaskCandidates.$inferSelect & {
		goalTitle?: string | null;
	},
): MissionTaskCandidate {
	const source = (() => {
		if (row.sourceKind === "mission_goals") return { kind: "mission_goals" };
		if (row.sourceKind === "security_scan") {
			return missionTaskCandidateSourceSchema.parse(row.sourceRefJson);
		}
		throw new Error(`Unsupported task candidate source: ${row.sourceKind}`);
	})();
	return missionTaskCandidateSchema.parse({
		id: row.id,
		batchId: row.batchId,
		repositoryId: row.repositoryId,
		goalId: row.goalId ?? null,
		goalTitle: row.goalTitle ?? null,
		source,
		candidateKind: row.candidateKind ?? "feature_followup",
		moduleRouting: {
			primaryModule: row.primaryModule ?? null,
			secondaryModules: Array.isArray(row.secondaryModulesJson)
				? row.secondaryModulesJson
				: [],
			confidencePercent: row.routingConfidencePercent ?? 0,
			reason: row.routingReason ?? null,
		},
		constraintGoalIds: Array.isArray(row.constraintGoalIdsJson)
			? row.constraintGoalIdsJson
			: [],
		planModeOpenQuestions: Array.isArray(row.planModeOpenQuestionsJson)
			? row.planModeOpenQuestionsJson
			: [],
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

export async function listMissionGoals(repositoryId: string) {
	const rows = await db
		.select()
		.from(missionGoals)
		.where(eq(missionGoals.repositoryId, repositoryId))
		.orderBy(missionGoals.sortOrder, missionGoals.createdAt);
	return rows.map(mapGoal);
}

export async function getMissionGoal(goalId: string) {
	const [row] = await db
		.select()
		.from(missionGoals)
		.where(eq(missionGoals.id, goalId));
	return row ? mapGoal(row) : null;
}

export async function createMissionGoal(input: {
	repositoryId: string;
	title: string;
	goalText: string;
	active: boolean;
	source?: "user" | "preset";
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
			source: input.source ?? "user",
			sortOrder: (latestGoal?.maxSortOrder ?? -1) + 1,
			interpretationScope:
				input.source === "preset" ? "project_wide" : "unknown",
			interpretationIntent:
				input.source === "preset" ? "maintain_threshold" : "unknown",
			interpretationSource: input.source === "preset" ? "preset" : "unknown",
			interpretationConfidencePercent: input.source === "preset" ? 100 : 0,
			interpretationReason:
				input.source === "preset"
					? "Preset Goal はプロジェクト横断制約として扱う"
					: null,
		})
		.returning();
	return mapGoal(row);
}

export async function updateMissionGoal(
	goalId: string,
	input: {
		title?: string;
		goalText?: string;
		active?: boolean;
		sortOrder?: number;
	},
) {
	const [row] = await db
		.update(missionGoals)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(missionGoals.id, goalId))
		.returning();
	return row ? mapGoal(row) : null;
}

export async function deleteMissionGoal(goalId: string) {
	const [row] = await db
		.delete(missionGoals)
		.where(eq(missionGoals.id, goalId))
		.returning();
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
			status: "running",
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
			status: "completed",
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
			status: "failed",
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
	input: Array<typeof missionTaskCandidates.$inferInsert>,
) {
	if (input.length === 0) return [];
	const rows = await db.insert(missionTaskCandidates).values(input).returning();
	return rows.map((row) => mapCandidate(row));
}

export async function listMissionCandidates(input: {
	repositoryId: string;
	status?: string;
}) {
	const filters = [eq(missionTaskCandidates.repositoryId, input.repositoryId)];
	if (input.status)
		filters.push(eq(missionTaskCandidates.status, input.status));
	const rows = await db
		.select({
			id: missionTaskCandidates.id,
			createdAt: missionTaskCandidates.createdAt,
			updatedAt: missionTaskCandidates.updatedAt,
			batchId: missionTaskCandidates.batchId,
			repositoryId: missionTaskCandidates.repositoryId,
			goalId: missionTaskCandidates.goalId,
			goalTitle: missionGoals.title,
			sourceKind: missionTaskCandidates.sourceKind,
			sourceRefJson: missionTaskCandidates.sourceRefJson,
			candidateKind: missionTaskCandidates.candidateKind,
			primaryModule: missionTaskCandidates.primaryModule,
			secondaryModulesJson: missionTaskCandidates.secondaryModulesJson,
			routingConfidencePercent: missionTaskCandidates.routingConfidencePercent,
			routingReason: missionTaskCandidates.routingReason,
			constraintGoalIdsJson: missionTaskCandidates.constraintGoalIdsJson,
			planModeOpenQuestionsJson:
				missionTaskCandidates.planModeOpenQuestionsJson,
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
			sourceKind: missionTaskCandidates.sourceKind,
			sourceRefJson: missionTaskCandidates.sourceRefJson,
			candidateKind: missionTaskCandidates.candidateKind,
			primaryModule: missionTaskCandidates.primaryModule,
			secondaryModulesJson: missionTaskCandidates.secondaryModulesJson,
			routingConfidencePercent: missionTaskCandidates.routingConfidencePercent,
			routingReason: missionTaskCandidates.routingReason,
			constraintGoalIdsJson: missionTaskCandidates.constraintGoalIdsJson,
			planModeOpenQuestionsJson:
				missionTaskCandidates.planModeOpenQuestionsJson,
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

export async function getMissionCandidateByTaskId(taskId: string) {
	const rows = await db
		.select({
			id: missionTaskCandidates.id,
			createdAt: missionTaskCandidates.createdAt,
			updatedAt: missionTaskCandidates.updatedAt,
			batchId: missionTaskCandidates.batchId,
			repositoryId: missionTaskCandidates.repositoryId,
			goalId: missionTaskCandidates.goalId,
			goalTitle: missionGoals.title,
			sourceKind: missionTaskCandidates.sourceKind,
			sourceRefJson: missionTaskCandidates.sourceRefJson,
			candidateKind: missionTaskCandidates.candidateKind,
			primaryModule: missionTaskCandidates.primaryModule,
			secondaryModulesJson: missionTaskCandidates.secondaryModulesJson,
			routingConfidencePercent: missionTaskCandidates.routingConfidencePercent,
			routingReason: missionTaskCandidates.routingReason,
			constraintGoalIdsJson: missionTaskCandidates.constraintGoalIdsJson,
			planModeOpenQuestionsJson:
				missionTaskCandidates.planModeOpenQuestionsJson,
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
		.where(eq(missionTaskCandidates.taskId, taskId))
		.limit(1);
	return rows[0] ? mapCandidate(rows[0]) : null;
}

export async function updateMissionCandidate(
	candidateId: string,
	input: { status?: string; taskId?: string | null },
	database: Db = db,
) {
	const [row] = await database
		.update(missionTaskCandidates)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(missionTaskCandidates.id, candidateId))
		.returning();
	return row ? mapCandidate(row) : null;
}

export async function reactivateDeletedTaskMissionCandidates(
	repositoryId: string,
	database: Db = db,
) {
	const now = new Date();
	await database
		.update(missionTaskCandidates)
		.set({ status: "candidate", updatedAt: now })
		.where(
			and(
				eq(missionTaskCandidates.repositoryId, repositoryId),
				eq(missionTaskCandidates.status, "task_created"),
				isNull(missionTaskCandidates.taskId),
			),
		);
}

export async function listMissionCandidatesByIds(
	candidateIds: string[],
	database: Db = db,
) {
	if (candidateIds.length === 0) return [];
	const rows = await database
		.select({
			id: missionTaskCandidates.id,
			createdAt: missionTaskCandidates.createdAt,
			updatedAt: missionTaskCandidates.updatedAt,
			batchId: missionTaskCandidates.batchId,
			repositoryId: missionTaskCandidates.repositoryId,
			goalId: missionTaskCandidates.goalId,
			goalTitle: missionGoals.title,
			sourceKind: missionTaskCandidates.sourceKind,
			sourceRefJson: missionTaskCandidates.sourceRefJson,
			candidateKind: missionTaskCandidates.candidateKind,
			primaryModule: missionTaskCandidates.primaryModule,
			secondaryModulesJson: missionTaskCandidates.secondaryModulesJson,
			routingConfidencePercent: missionTaskCandidates.routingConfidencePercent,
			routingReason: missionTaskCandidates.routingReason,
			constraintGoalIdsJson: missionTaskCandidates.constraintGoalIdsJson,
			planModeOpenQuestionsJson:
				missionTaskCandidates.planModeOpenQuestionsJson,
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
		.where(inArray(missionTaskCandidates.id, candidateIds));
	return rows.map((row) => mapCandidate(row));
}

export async function claimMissionCandidate(
	candidateId: string,
	database: Db = db,
) {
	const [claimed] = await database
		.update(missionTaskCandidates)
		.set({ status: "selected", updatedAt: new Date() })
		.where(
			and(
				eq(missionTaskCandidates.id, candidateId),
				inArray(missionTaskCandidates.status, ["candidate", "selected"]),
				isNull(missionTaskCandidates.taskId),
			),
		)
		.returning({ id: missionTaskCandidates.id });
	return Boolean(claimed);
}

export async function createTaskFromMissionCandidate(
	candidate: MissionTaskCandidate,
	status: "draft" | "ready",
	database: DbTransaction,
) {
	return createTask(
		{
			repositoryId: candidate.repositoryId,
			title: candidate.title,
			description: [
				candidate.summary,
				"",
				"Rationale:",
				candidate.rationale,
				"",
				"Evidence:",
				...candidate.evidence.map((item) => `- ${item.label}: ${item.value}`),
			].join("\n"),
			objective: buildMissionCandidateTaskObjective(candidate),
			acceptanceCriteria: `${candidate.acceptanceCriteria}\n\nVerification:\n${candidate.verificationPlan}`,
			status,
			createdBy:
				candidate.source.kind === "security_scan"
					? "security-scan-task-candidate"
					: "mission-task-candidate",
		},
		database,
	);
}
