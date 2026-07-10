import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
	type MissionGoal,
	type MissionTaskCandidate,
	type MissionTaskCandidateBatch,
	missionGoalSchema,
	missionTaskCandidateBatchSchema,
	missionTaskCandidateSchema,
	type ProjectQualityRun,
	projectQualityRunSchema,
} from "../../../shared/schemas/project-detail.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	missionGoals,
	missionTaskCandidateBatches,
	missionTaskCandidates,
	projectQualityRuns,
} from "../../db/project-detail-schema";
import { tasks } from "../../db/schema";

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

function mapCandidate(
	row: typeof missionTaskCandidates.$inferSelect & {
		goalTitle?: string | null;
	},
): MissionTaskCandidate {
	return missionTaskCandidateSchema.parse({
		id: row.id,
		batchId: row.batchId,
		repositoryId: row.repositoryId,
		goalId: row.goalId ?? null,
		goalTitle: row.goalTitle ?? null,
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

function mapQualityRun(
	row: typeof projectQualityRuns.$inferSelect,
): ProjectQualityRun {
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

export async function createTaskFromMissionCandidate(
	candidate: MissionTaskCandidate,
	status: "draft" | "ready",
	database: Db = db,
) {
	const [task] = await database
		.insert(tasks)
		.values({
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
			createdBy: "mission-task-candidate",
		})
		.returning();
	return task;
}

function buildMissionCandidateTaskObjective(candidate: MissionTaskCandidate) {
	const primaryGoal = candidate.goalTitle?.trim() || candidate.title;
	const implementationTarget = formatWorkTarget(candidate.title);
	const planCheckItems = buildPlanCheckItems(candidate.planModeOpenQuestions);
	return [
		formatGoalInstruction(primaryGoal),
		"",
		"[作るもの]",
		`${implementationTarget}。`,
		candidate.summary,
		"",
		"[Planで確認すること]",
		...planCheckItems.map((item) => `- ${item}`),
		"",
		"[実装上の注意]",
		"- 未確認の仕様は固定せず、選択肢として残す。",
		"- 既存サンプル機能の改修に広げない。",
		"- schema、API、DB、UI の境界を明示する。",
		"",
		"[完了条件]",
		candidate.acceptanceCriteria,
		"",
		"[検証]",
		candidate.verificationPlan,
	].join("\n");
}

function formatGoalInstruction(goal: string) {
	if (goal.endsWith("を作る")) return `${goal.slice(0, -3)}を作ってください。`;
	if (goal.endsWith("を実装する"))
		return `${goal.slice(0, -5)}を実装してください。`;
	if (goal.endsWith("する")) return `${goal.slice(0, -2)}してください。`;
	return `${goal} を実現してください。`;
}

function formatWorkTarget(title: string) {
	if (title.endsWith("本体を実装する")) return `${title.slice(0, -7)}本体`;
	return title;
}

type PlanCheckCategory = {
	key: string;
	fallback: string;
	patterns: RegExp[];
};

const PLAN_CHECK_CATEGORIES: PlanCheckCategory[] = [
	{
		key: "entry",
		fallback: "入口画面または route",
		patterns: [/入口|画面|route|ルート|ホーム|UI|単一画面|分割画面/],
	},
	{
		key: "model",
		fallback: "データモデル",
		patterns: [
			/データモデル|属性|項目|title|note|due|priority|tags|task の最小属性/,
		],
	},
	{
		key: "storage",
		fallback: "保存方式",
		patterns: [/保存|永続|SQLite|API|shared schema|migration|DB/],
	},
	{
		key: "state",
		fallback: "完了状態の表現",
		patterns: [/完了|状態|completed|done|archive|アーカイブ/],
	},
	{
		key: "operations",
		fallback: "編集、削除、並び替えの初期範囲",
		patterns: [/編集|削除|並び替え|一括|操作/],
	},
	{
		key: "verification",
		fallback: "unit / schema / e2e の検証範囲",
		patterns: [/検証|unit|schema|e2e|test|verify/i],
	},
];

function buildPlanCheckItems(openQuestions: string[]) {
	const assigned = new Map<string, string>();
	const extra: string[] = [];

	for (const question of openQuestions
		.map((item) => item.trim())
		.filter(Boolean)) {
		const category = PLAN_CHECK_CATEGORIES.find((candidate) =>
			candidate.patterns.some((pattern) => pattern.test(question)),
		);
		if (category && !assigned.has(category.key)) {
			assigned.set(category.key, question);
		} else if (!category) {
			extra.push(question);
		}
	}

	return [
		...PLAN_CHECK_CATEGORIES.map(
			(category) => assigned.get(category.key) ?? category.fallback,
		),
		...extra.slice(0, 2),
	];
}

export async function createProjectQualityRun(input: {
	repositoryId: string;
	runType: "unit" | "e2e" | "all";
	command: string;
}) {
	const now = new Date();
	const [row] = await db
		.insert(projectQualityRuns)
		.values({
			repositoryId: input.repositoryId,
			runType: input.runType,
			status: "running",
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
	status: "completed" | "failed" | "cancelled";
	exitCode?: number | null;
	latestOutput?: string | null;
	coverageSummary?: unknown;
	coverageGate?: unknown;
	e2eSummary?: unknown;
	errorMessage?: string | null;
	onlyIfRunning?: boolean;
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
		.where(
			input.onlyIfRunning
				? and(
						eq(projectQualityRuns.id, input.runId),
						eq(projectQualityRuns.status, "running"),
					)
				: eq(projectQualityRuns.id, input.runId),
		)
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
	const [row] = await db
		.select()
		.from(projectQualityRuns)
		.where(eq(projectQualityRuns.id, runId));
	return row ? mapQualityRun(row) : null;
}

export async function getLatestProjectQualityRun(input: {
	repositoryId: string;
	runType?: string;
}) {
	const filters = [eq(projectQualityRuns.repositoryId, input.repositoryId)];
	if (input.runType)
		filters.push(eq(projectQualityRuns.runType, input.runType));
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
				eq(projectQualityRuns.status, "running"),
			),
		)
		.orderBy(desc(projectQualityRuns.createdAt));
	return rows.map(mapQualityRun);
}
