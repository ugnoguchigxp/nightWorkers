import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import {
	MISSION_TASK_CANDIDATE_MAX_COUNT,
	type MissionTaskCandidate,
	missionTaskCandidatesResultSchema,
	type ProjectSignalSnapshot,
} from "../../../shared/schemas/task-generation.schema";
import { type DbTransaction, db } from "../../db/client";
import { tasks } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../lib/errors";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import {
	buildNormalizedSupervisorLlmRequest,
	callStructuredJsonLLM,
} from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import {
	applyMissionTaskCandidateSemantics,
	hasQualitySetupCandidate,
	hasQualitySetupText,
	normalizeMissionCandidateTitle,
	selectMissionGoalsForGeneration,
	selectUniqueMissionTaskCandidates,
	validateGeneratedGoalIds,
} from "./task-candidate-semantics";
import * as repo from "./task-generation.repository";
import { buildProjectSignalSnapshot } from "./task-generation-signal.service";

export * from "./mission-goal.service";
export {
	applyMissionTaskCandidateSemantics,
	hasQualitySetupCandidate,
	hasQualitySetupText,
	selectMissionGoalsForGeneration,
} from "./task-candidate-semantics";

const MISSION_TASK_SCHEMA_NAME = "mission_task_candidates";

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

function buildMissionTaskSystemPrompt() {
	return [
		"Mission Goal と project signal から、ユーザーが Task 化する候補だけを JSON schema に従って返してください。",
		`候補数は最大 ${MISSION_TASK_CANDIDATE_MAX_COUNT} 件です。既存 Task や existingUncreatedCandidates と同じ候補を返さないでください。`,
		"候補は必ず Mission Goal の達成に直接つながる作業にしてください。一般的な品質改善、テスト安定化、運用改善は、Goal 本体の実装候補より優先しないでください。",
		"repositorySnapshot を読み、現在の repo が starter/template/別ドメイン実装に見える場合は、最初の候補で Mission Goal のプロダクト本体を作るタスクを提案してください。",
		"未実装の機能 Goal では、最優先候補を candidateKind=feature_entrypoint とし、title は「<機能ドメイン> 本体を実装する」の形にしてください。",
		"feature_entrypoint は Goal 本体を実装する候補です。ただし Task 化後は Plan Mode で UI、データモデル、保存方式、完了状態、編集削除、検証方針を短く決める入口にしてください。",
		"本体機能が未実装の場合、UI 詳細、データモデル詳細、永続化方式、完了状態、編集削除、検証方式は独立候補にせず planModeOpenQuestions に短い箇条書きで入れてください。",
		"candidateKind は feature_entrypoint / feature_followup / constraint_enablement / constraint_verification / investigation のいずれかです。",
		"moduleRouting には primaryModule, secondaryModules, confidencePercent, reason を必ず入れてください。ontology が無い、または低信頼なら primaryModule は null、confidencePercent は低め、reason に未判定理由を書いてください。",
		"project-wide Goal は原則として feature_entrypoint の constraintGoalIds、acceptanceCriteria、verificationPlan、taskPrompt に反映し、単独候補にしないでください。検証基盤が欠ける場合だけ constraint_enablement を出せます。",
		"repositorySnapshot.llmContextFiles が存在する場合は、それを実装状態の優先根拠にしてください。その場合 recentCommitDiffs は読みません。llmContextFiles が無い場合だけ sourceExcerpts / recentCommitDiffs を補助根拠にしてください。Goal 本体が既に実装されていると判断できる場合は、その本体実装タスクを返さず、残っている差分だけを候補にしてください。",
		"既存の Task や未作成候補が Goal 本体の実装をすでに扱っている場合だけ、改善・品質・追加機能の候補を上位にできます。",
		"importancePercent は選択された Mission Goal に対する重要度として 0-100 の整数で算出してください。repo 全体の一般的な重要度ではありません。",
		"evaluationContribution は、その候補を完了した場合に latestEvaluation.overallScore または該当 dimensions がどれだけ改善し得るかを 0-100 の数値で見積もってください。必ず数値を返し、null や空欄は禁止です。",
		"taskPrompt は Composer に入る補助文です。Goal 本体を作ることを主目的に置き、Plan Mode で決める論点は要点だけにしてください。長い前置き、Queue 実行指示、Plan 後の手順説明は書かないでください。",
		"事前に分かっている仕様は、Mission Goal、repositorySnapshot、evidence、acceptanceCriteria から断定できる範囲だけを書いてください。未確認の詳細仕様やユーザーが選べる仕様要素は、除外や禁止として固定せず、Questionnaire / Plan Mode で定義する項目として残してください。",
		"Quality や Evaluation の成功/失敗判定は行わず、保存済み signal を根拠として扱ってください。",
		"unit / coverage / e2e capability が欠けている場合だけ、package.json scripts または project quality settings を整備する候補を高優先にしてください。capability が存在するだけなら Goal 本体より優先しないでください。",
		"秘密情報、生ログ全文、リポジトリ全文を要求しないでください。",
	].join("\n");
}

function buildMissionTaskUserPrompt(input: {
	signal: ProjectSignalSnapshot;
	existingCandidates: MissionTaskCandidate[];
	existingTaskTitles: string[];
}) {
	return JSON.stringify(
		{
			missionGoals: input.signal.activeGoals,
			goalInterpretationPolicy: {
				userGoals:
					"登録時には LLM 分類しないため unknown のまま渡ることがある。候補生成時に routing と candidateKind で解釈する。",
				presetGoals:
					"preset Goal は project_wide constraint として扱い、feature_entrypoint の制約・検証条件に反映する。",
			},
			projectWideGoals: input.signal.activeGoals.filter(
				(goal) => goal.interpretation.scope === "project_wide",
			),
			moduleOntology: input.signal.repositorySnapshot?.moduleOntology ?? null,
			projectSignalSnapshot: input.signal,
			generationRules: [
				"各候補は Mission Goal に直接紐付ける。",
				"Goal の対象プロダクトが repositorySnapshot.llmContextFiles に見当たる場合は、それを最優先の実装状態として扱う。",
				"llmContextFiles が無い場合だけ、sourceFiles / sourceExcerpts / recentCommitDiffs から Goal 対象プロダクトの有無を判断する。",
				"Goal の対象プロダクトが確認できない場合、最初の候補はそのプロダクト本体を作るタスクにする。",
				"未実装の機能 Goal の最初の候補は candidateKind=feature_entrypoint とし、title は「<機能ドメイン> 本体を実装する」にする。",
				"本体未実装時の UI 詳細、状態管理、永続化、編集削除、検証方式は候補にせず planModeOpenQuestions に短く入れる。",
				"projectWideGoals は constraintGoalIds と acceptanceCriteria / verificationPlan / taskPrompt へ反映する。",
				"moduleOntology が無い場合も失敗にせず、moduleRouting は null/低 confidence と reason で表現する。",
				"Goal の対象プロダクトが実装済みと判断できる場合、同じ本体実装タスクは返さない。",
				"importancePercent は Goal 達成への重要度を示す。",
				"evaluationContribution は評価改善の見込みを数値で示し、null にしない。",
				"taskPrompt は Goal 本体を作るための短い Plan Mode 補助文にする。",
				"taskPrompt には長い前置き、Queue 実行指示、Plan 後の手順説明を含めない。",
				`候補数は最大 ${MISSION_TASK_CANDIDATE_MAX_COUNT} 件にし、existingUncreatedCandidates / existingTaskTitles と title が重なる候補は返さない。`,
			],
			existingUncreatedCandidates: input.existingCandidates.map(
				(candidate) => ({
					id: candidate.id,
					title: candidate.title,
					status: candidate.status,
				}),
			),
			existingTaskTitles: input.existingTaskTitles,
			outputSchema: "nightworkers.mission-task-candidates/v1",
		},
		null,
		2,
	);
}

function selectedModelForMissionPrompt(
	systemPrompt: string,
	userPrompt: string,
) {
	const schema = buildMissionTaskCandidatesResponseJsonSchema();
	const normalized = buildNormalizedSupervisorLlmRequest({
		systemPrompt,
		userPrompt,
		label: MISSION_TASK_SCHEMA_NAME,
		role: "mission_task_generation",
		jsonSchema: { name: MISSION_TASK_SCHEMA_NAME, schema },
	});
	return {
		role: "mission_task_generation",
		providerId: normalized.providerId,
		providerEndpointId: normalized.providerEndpointId ?? null,
		routeSource: normalized.routeSource ?? null,
		modelOrDeployment: normalized.modelOrDeployment,
		thinkingDepth: normalized.thinkingDepth ?? null,
	};
}

export function buildMissionTaskCandidatesResponseJsonSchema() {
	return normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(missionTaskCandidatesResultSchema),
	);
}

function selectionFromLlmEvent(event: SupervisorLlmDebugEvent) {
	if (event.type !== "model.request_started") return null;
	const data = event.data || {};
	return {
		role: "mission_task_generation",
		providerId: typeof data.provider === "string" ? data.provider : "unknown",
		providerEndpointId:
			typeof data.providerEndpointId === "string"
				? data.providerEndpointId
				: null,
		routeSource: typeof data.routeSource === "string" ? data.routeSource : null,
		modelOrDeployment: typeof data.model === "string" ? data.model : null,
		thinkingDepth:
			typeof data.thinkingDepth === "string" ? data.thinkingDepth : null,
	};
}

export async function listMissionTaskCandidates(input: {
	repositoryId: string;
	status?: string;
}) {
	await requireRepository(input.repositoryId);
	await repo.reactivateDeletedTaskMissionCandidates(input.repositoryId);
	return repo.listMissionCandidates(input);
}

export async function getMissionTaskCandidate(candidateId: string) {
	const candidate = await repo.getMissionCandidate(candidateId);
	if (!candidate) throw new NotFoundError("Mission task candidate not found");
	return candidate;
}

export async function updateMissionTaskCandidate(
	candidateId: string,
	input: { status?: string },
) {
	const existing = await repo.getMissionCandidate(candidateId);
	if (!existing) throw new NotFoundError("Mission task candidate not found");
	if (input.status === "task_created") {
		throw new ValidationError(
			"Task-created status is only set by create-tasks",
		);
	}
	if (
		existing.status === "task_created" &&
		input.status &&
		input.status !== "task_created"
	) {
		throw new ValidationError(
			"Task-created candidates cannot be moved back to another status",
		);
	}
	const updated = await repo.updateMissionCandidate(candidateId, input);
	if (!updated) throw new NotFoundError("Mission task candidate not found");
	return updated;
}

export async function generateMissionTaskCandidates(input: {
	repositoryId: string;
	goalIds?: string[];
	includeInactiveGoals?: boolean;
}) {
	const repository = await requireRepository(input.repositoryId);
	const allGoals = await repo.listMissionGoals(repository.id);
	const selectedGoals = selectMissionGoalsForGeneration(allGoals, input);
	if (selectedGoals.length === 0)
		throw new ValidationError("At least one mission goal is required");
	await repo.reactivateDeletedTaskMissionCandidates(repository.id);
	const signal = await buildProjectSignalSnapshot({
		repository,
		goals: selectedGoals,
	});
	const batch = await repo.createRunningMissionBatch({
		repositoryId: repository.id,
		requestedGoalIds: selectedGoals.map((goal) => goal.id),
		signalSnapshot: signal,
	});

	const existingCandidates = await repo.listMissionCandidates({
		repositoryId: repository.id,
		status: "candidate",
	});
	const existingTasks = await db
		.select({ title: tasks.title })
		.from(tasks)
		.where(eq(tasks.repositoryId, repository.id));
	const systemPrompt = buildMissionTaskSystemPrompt();
	const userPrompt = buildMissionTaskUserPrompt({
		signal,
		existingCandidates,
		existingTaskTitles: existingTasks.map((task) => task.title),
	});
	let selectedModel: unknown = selectedModelForMissionPrompt(
		systemPrompt,
		userPrompt,
	);
	try {
		const raw = await callStructuredJsonLLM(systemPrompt, userPrompt, {
			role: "mission_task_generation",
			schemaName: MISSION_TASK_SCHEMA_NAME,
			schema: buildMissionTaskCandidatesResponseJsonSchema(),
			emitEvent: async (event) => {
				const nextSelection = selectionFromLlmEvent(event);
				if (nextSelection) selectedModel = nextSelection;
			},
		});
		const rawOutput = JSON.parse(raw) as unknown;
		const parsed = missionTaskCandidatesResultSchema.parse(rawOutput);
		const blockedTitleKeys = new Set([
			...existingCandidates.map((candidate) =>
				normalizeMissionCandidateTitle(candidate.title),
			),
			...existingTasks.map((task) =>
				normalizeMissionCandidateTitle(task.title),
			),
		]);
		const semanticCandidates = applyMissionTaskCandidateSemantics(
			parsed.candidates,
			selectedGoals,
		);
		const selectedCandidates = selectUniqueMissionTaskCandidates(
			semanticCandidates,
			blockedTitleKeys,
		);
		validateGeneratedGoalIds(selectedCandidates, selectedGoals);
		if (
			signal.qualityCapabilities.missingCapabilities.length > 0 &&
			!hasQualitySetupCandidate(selectedCandidates) &&
			!hasQualitySetupCandidate(existingCandidates) &&
			!existingTasks.some((task) => hasQualitySetupText(task.title))
		) {
			throw new ValidationError(
				"Mission task generation must prioritize missing quality capabilities",
				{
					missingCapabilities: signal.qualityCapabilities.missingCapabilities,
				},
			);
		}
		await repo.completeMissionBatch({
			batchId: batch.id,
			rawOutput,
			selectedModel,
		});
		const candidates = await repo.createMissionCandidates(
			selectedCandidates.map((candidate) => {
				return {
					batchId: batch.id,
					repositoryId: repository.id,
					goalId: candidate.goalId ?? null,
					candidateKind: candidate.candidateKind,
					primaryModule: candidate.moduleRouting.primaryModule,
					secondaryModulesJson: candidate.moduleRouting.secondaryModules,
					routingConfidencePercent: candidate.moduleRouting.confidencePercent,
					routingReason: candidate.moduleRouting.reason,
					constraintGoalIdsJson: candidate.constraintGoalIds,
					planModeOpenQuestionsJson: candidate.planModeOpenQuestions,
					title: candidate.title,
					summary: candidate.summary,
					rationale: candidate.rationale,
					evidenceJson: candidate.evidence,
					evaluationContribution: candidate.evaluationContribution ?? null,
					importancePercent: candidate.importancePercent,
					confidencePercent: candidate.confidencePercent,
					tokenSize: candidate.tokenSize,
					complexity: candidate.complexity,
					taskPrompt: candidate.taskPrompt,
					acceptanceCriteria: candidate.acceptanceCriteria,
					verificationPlan: candidate.verificationPlan,
					status: "candidate",
				};
			}),
		);
		return { batchId: batch.id, status: "completed" as const, candidates };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await repo.failMissionBatch({
			batchId: batch.id,
			errorMessage: message,
			selectedModel,
		});
		throw new ValidationError("Mission task generation failed", { message });
	}
}

export async function createTasksFromMissionCandidates(input: {
	repositoryId: string;
	candidateIds: string[];
	mode: "draft" | "ready";
	onTaskCreated?: (
		task: typeof tasks.$inferSelect,
		tx: DbTransaction,
	) => Promise<void>;
}) {
	await requireRepository(input.repositoryId);
	return db.transaction(async (tx) => {
		const candidates = await repo.listMissionCandidatesByIds(
			input.candidateIds,
			tx,
		);
		validateTaskCreationCandidates(candidates, input);
		const createdTasks = [];
		const updatedCandidates = [];
		for (const candidate of candidates) {
			const claimed = await repo.claimMissionCandidate(candidate.id, tx);
			if (!claimed) {
				throw new ValidationError(
					"Mission task candidate is no longer available",
					{ candidateId: candidate.id },
				);
			}
			const task = await repo.createTaskFromMissionCandidate(
				candidate,
				input.mode,
				tx,
			);
			await input.onTaskCreated?.(task, tx);
			const updated = await repo.updateMissionCandidate(
				candidate.id,
				{ status: "task_created", taskId: task.id },
				tx,
			);
			createdTasks.push(task);
			if (updated) updatedCandidates.push(updated);
		}
		return { tasks: createdTasks, candidates: updatedCandidates };
	});
}

function validateTaskCreationCandidates(
	candidates: MissionTaskCandidate[],
	input: { repositoryId: string; candidateIds: string[] },
) {
	if (candidates.length !== input.candidateIds.length) {
		throw new NotFoundError("Mission task candidate not found");
	}
	for (const candidate of candidates) {
		if (candidate.repositoryId !== input.repositoryId) {
			throw new NotFoundError("Mission task candidate not found");
		}
		if (candidate.status === "task_created" || candidate.taskId) {
			throw new ValidationError(
				"Mission task candidate already has a linked task",
				{ candidateId: candidate.id },
			);
		}
		if (candidate.status === "dismissed") {
			throw new ValidationError(
				"Dismissed candidates cannot be converted to tasks",
				{ candidateId: candidate.id },
			);
		}
	}
}
