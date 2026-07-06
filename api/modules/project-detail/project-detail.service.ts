import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { missionGoalTemplates } from "../../../shared/mission-goal-templates";
import {
	type E2ESummary,
	e2eSummarySchema,
	MISSION_TASK_CANDIDATE_MAX_COUNT,
	type MissionGoal,
	type MissionTaskCandidate,
	type MissionTaskCandidatesResult,
	missionTaskCandidatesResultSchema,
	type ProjectQualityCapabilities,
	type ProjectQualityRun,
	type ProjectSignalSnapshot,
} from "../../../shared/schemas/project-detail.schema";
import { db } from "../../db/client";
import { llmUsageRecords, taskRuns, tasks } from "../../db/schema";
import { NotFoundError, ValidationError } from "../../lib/errors";
import {
	calculateUsageCost,
	findPricingForUsage,
} from "../../services/pricing";
import { detectProjectStackProfile } from "../../services/project-stack-context";
import {
	evaluateCoverageGate,
	readCoverageSummaryFile,
} from "../../services/quality/coverage-gate";
import { readTestQualitySettingsFile } from "../../services/settings/test-quality-settings";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import {
	buildNormalizedSupervisorLlmRequest,
	callStructuredJsonLLM,
} from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as projectEvaluationRepo from "../project-evaluation/project-evaluation.repository";
import * as repo from "./project-detail.repository";
import { getFreshProjectMeta } from "./project-meta.service";
import {
	buildProjectSignalSnapshot,
	detectQualityCapabilities,
} from "./project-signal-snapshot.service";

const MISSION_TASK_SCHEMA_NAME = "mission_task_candidates";
const MAX_OUTPUT_CHARS = 120_000;
const RECENT_QUALITY_RUN_LIMIT = 10;
const COVERAGE_SUMMARY_REPORTER_ARGS =
	"--coverage.reporter=json-summary --coverage.reporter=text";
const E2E_JSON_OUTPUT_PATH = path.join("test-results", "e2e-results.json");
const PLAYWRIGHT_JSON_REPORTER_ARGS = "--reporter=list,json";
const E2E_ARTIFACT_PATHS = [
	E2E_JSON_OUTPUT_PATH,
	path.join("playwright-report", "results.json"),
	path.join("playwright-report", "test-results.json"),
];

type PlaywrightSuiteSummary = E2ESummary["suites"][number] & {
	failedTests: number;
};
type QualitySetupCandidateLike = {
	title: string;
	summary: string;
	rationale: string;
	taskPrompt: string;
	acceptanceCriteria: string;
	verificationPlan: string;
	importancePercent: number;
	evidence: Array<{ source: string; label: string; value: string }>;
};

export const missionGoalPresets = missionGoalTemplates;

async function requireRepository(repositoryId: string) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return repository;
}

export async function getProjectDetailMetrics(repositoryId: string) {
	const repository = await requireRepository(repositoryId);
	const [runs, usageRows, latestEvaluation, latestQuality] = await Promise.all([
		db.select().from(taskRuns).where(eq(taskRuns.repositoryId, repositoryId)),
		db
			.select({
				taskId: llmUsageRecords.taskId,
				title: tasks.title,
				provider: llmUsageRecords.provider,
				model: llmUsageRecords.model,
				inputTokens: llmUsageRecords.inputTokens,
				outputTokens: llmUsageRecords.outputTokens,
				cachedInputTokens: llmUsageRecords.cachedInputTokens,
				reasoningOutputTokens: llmUsageRecords.reasoningOutputTokens,
				stateCardTokens: llmUsageRecords.stateCardTokens,
				systemPromptTokens: llmUsageRecords.systemPromptTokens,
				userPromptTokens: llmUsageRecords.userPromptTokens,
				totalTokens: llmUsageRecords.totalTokens,
				durationMs: llmUsageRecords.durationMs,
				createdAt: llmUsageRecords.createdAt,
			})
			.from(llmUsageRecords)
			.innerJoin(tasks, eq(tasks.id, llmUsageRecords.taskId))
			.where(eq(tasks.repositoryId, repositoryId)),
		projectEvaluationRepo.getLatestProjectEvaluation(repositoryId),
		repo.getLatestProjectQualityRun({ repositoryId }),
	]);
	const projectMeta = await getFreshProjectMeta(repository);

	const totalTokens = usageRows.reduce(
		(sum, row) => sum + normalizeUsageTotal(row),
		0,
	);
	const inputTokens = usageRows.reduce(
		(sum, row) => sum + (row.inputTokens ?? 0),
		0,
	);
	const outputTokens = usageRows.reduce(
		(sum, row) => sum + (row.outputTokens ?? 0),
		0,
	);
	const cachedInputTokens = usageRows.reduce(
		(sum, row) => sum + (row.cachedInputTokens ?? 0),
		0,
	);
	const reasoningOutputTokens = usageRows.reduce(
		(sum, row) => sum + (row.reasoningOutputTokens ?? 0),
		0,
	);
	const stateCardTokens = usageRows.reduce(
		(sum, row) => sum + (row.stateCardTokens ?? 0),
		0,
	);
	const promptInputTokens = usageRows.reduce(
		(sum, row) =>
			sum +
			(row.systemPromptTokens ?? 0) +
			(row.userPromptTokens ?? 0) +
			(row.stateCardTokens ?? 0),
		0,
	);
	const totalDurationMs = usageRows.reduce(
		(sum, row) => sum + Math.max(0, row.durationMs),
		0,
	);
	const measuredDurationCallCount = usageRows.filter(
		(row) => row.durationMs > 0,
	).length;
	const outputDurationMs = usageRows.reduce(
		(sum, row) =>
			sum + ((row.outputTokens ?? 0) > 0 ? Math.max(0, row.durationMs) : 0),
		0,
	);
	const outputTokensPerSecond = calculateOutputTokensPerSecond({
		outputTokens,
		outputDurationMs,
	});
	const modelMap = new Map<
		string,
		{
			provider: string;
			model: string | null;
			calls: number;
			tokens: number;
			inputTokens: number;
			outputTokens: number;
			cachedInputTokens: number;
			reasoningOutputTokens: number;
			totalDurationMs: number;
			outputDurationMs: number;
			outputTokensPerSecond: number | null;
			cost: number | null;
		}
	>();
	const taskMap = new Map<
		string,
		{
			taskId: string;
			title: string;
			tokens: number;
			inputTokens: number;
			outputTokens: number;
			cachedInputTokens: number;
			reasoningOutputTokens: number;
			totalDurationMs: number;
			outputDurationMs: number;
			outputTokensPerSecond: number | null;
			cost: number | null;
		}
	>();
	let totalCost = 0;
	let pricedUsageCount = 0;
	for (const row of usageRows) {
		const usageCost = await calculateProjectDetailUsageCost(row);
		const modelKey = `${row.provider}:${row.model ?? ""}`;
		const modelEntry = modelMap.get(modelKey) ?? {
			provider: row.provider,
			model: row.model ?? null,
			calls: 0,
			tokens: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			reasoningOutputTokens: 0,
			totalDurationMs: 0,
			outputDurationMs: 0,
			outputTokensPerSecond: null,
			cost: null,
		};
		modelEntry.calls += 1;
		modelEntry.tokens += normalizeUsageTotal(row);
		modelEntry.inputTokens += row.inputTokens ?? 0;
		modelEntry.outputTokens += row.outputTokens ?? 0;
		modelEntry.cachedInputTokens += row.cachedInputTokens ?? 0;
		modelEntry.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
		modelEntry.totalDurationMs += Math.max(0, row.durationMs);
		if ((row.outputTokens ?? 0) > 0)
			modelEntry.outputDurationMs += Math.max(0, row.durationMs);
		modelEntry.outputTokensPerSecond =
			calculateOutputTokensPerSecond(modelEntry);
		if (usageCost !== null) {
			modelEntry.cost = (modelEntry.cost ?? 0) + usageCost;
		}
		modelMap.set(modelKey, modelEntry);

		const taskEntry = taskMap.get(row.taskId) ?? {
			taskId: row.taskId,
			title: row.title,
			tokens: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			reasoningOutputTokens: 0,
			totalDurationMs: 0,
			outputDurationMs: 0,
			outputTokensPerSecond: null,
			cost: null,
		};
		taskEntry.tokens += normalizeUsageTotal(row);
		taskEntry.inputTokens += row.inputTokens ?? 0;
		taskEntry.outputTokens += row.outputTokens ?? 0;
		taskEntry.cachedInputTokens += row.cachedInputTokens ?? 0;
		taskEntry.reasoningOutputTokens += row.reasoningOutputTokens ?? 0;
		taskEntry.totalDurationMs += Math.max(0, row.durationMs);
		if ((row.outputTokens ?? 0) > 0)
			taskEntry.outputDurationMs += Math.max(0, row.durationMs);
		taskEntry.outputTokensPerSecond = calculateOutputTokensPerSecond(taskEntry);
		if (usageCost !== null) {
			taskEntry.cost = (taskEntry.cost ?? 0) + usageCost;
			totalCost += usageCost;
			pricedUsageCount += 1;
		}
		taskMap.set(row.taskId, taskEntry);
	}
	const coverageMetrics = latestQuality?.coverageGate?.metrics ?? [];
	const coverageAverage =
		coverageMetrics.length > 0
			? Math.round(
					(coverageMetrics.reduce(
						(sum, metric) => sum + metric.actualPercent,
						0,
					) /
						coverageMetrics.length) *
						100,
				) / 100
			: null;

	return {
		stackProfile: detectProjectStackProfile(repository.localPath),
		projectMeta,
		runs: {
			total: runs.length,
			completed: runs.filter((run) => run.status === "completed").length,
			failed: runs.filter(
				(run) => run.status === "failed" || run.status === "timed_out",
			).length,
		},
		llmUsage: {
			totalTokens,
			promptInputTokens,
			inputTokens,
			outputTokens,
			cachedInputTokens,
			reasoningOutputTokens,
			stateCardTokens,
			totalDurationMs,
			outputDurationMs,
			measuredDurationCallCount,
			outputTokensPerSecond,
			callCount: usageRows.length,
			totalCost: pricedUsageCount > 0 ? totalCost : null,
			averageTokensPerRun:
				runs.length > 0 ? Math.round(totalTokens / runs.length) : null,
			averageCostPerRun:
				runs.length > 0 && pricedUsageCount > 0
					? totalCost / runs.length
					: null,
			modelMix: [...modelMap.values()],
			topTokenTasks: [...taskMap.values()]
				.sort((a, b) => b.tokens - a.tokens)
				.slice(0, 5),
		},
		health: {
			latestEvaluationScore: latestEvaluation?.overallScore ?? null,
			coverageAverage,
		},
	};
}

async function calculateProjectDetailUsageCost(row: {
	provider: string;
	model?: string | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	reasoningOutputTokens?: number | null;
	createdAt: Date;
}) {
	const pricing = await findPricingForUsage({
		provider: row.provider,
		model: row.model ?? null,
		createdAt: row.createdAt,
	});
	if (!pricing || pricing.currencyCode !== "USD") return null;
	return calculateUsageCost({
		inputTokens: row.inputTokens ?? null,
		outputTokens: row.outputTokens ?? null,
		cachedInputTokens: row.cachedInputTokens ?? null,
		reasoningOutputTokens: row.reasoningOutputTokens ?? null,
		pricing,
	}).totalCost;
}

function normalizeUsageTotal(row: {
	totalTokens?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
}) {
	return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

function calculateOutputTokensPerSecond(input: {
	outputTokens: number;
	outputDurationMs: number;
}) {
	if (input.outputTokens <= 0 || input.outputDurationMs <= 0) return null;
	return (
		Math.round((input.outputTokens / (input.outputDurationMs / 1000)) * 100) /
		100
	);
}

export async function listMissionGoals(repositoryId: string) {
	await requireRepository(repositoryId);
	return repo.listMissionGoals(repositoryId);
}

export async function createMissionGoal(
	repositoryId: string,
	input: { title: string; goalText: string; active: boolean },
) {
	await requireRepository(repositoryId);
	return repo.createMissionGoal({ repositoryId, ...input, source: "user" });
}

export async function updateMissionGoal(
	repositoryId: string,
	goalId: string,
	input: {
		title?: string;
		goalText?: string;
		active?: boolean;
		sortOrder?: number;
	},
) {
	await requireRepository(repositoryId);
	const existing = await repo.getMissionGoal(goalId);
	if (!existing || existing.repositoryId !== repositoryId)
		throw new NotFoundError("Mission goal not found");
	const updated = await repo.updateMissionGoal(goalId, input);
	if (!updated) throw new NotFoundError("Mission goal not found");
	return updated;
}

export async function deleteMissionGoal(repositoryId: string, goalId: string) {
	await requireRepository(repositoryId);
	const existing = await repo.getMissionGoal(goalId);
	if (!existing || existing.repositoryId !== repositoryId)
		throw new NotFoundError("Mission goal not found");
	const deleted = await repo.deleteMissionGoal(goalId);
	if (!deleted) throw new NotFoundError("Mission goal not found");
	return deleted;
}

export function listMissionGoalPresets() {
	return missionGoalPresets.map((preset) => ({ ...preset }));
}

export async function createMissionGoalFromPreset(
	repositoryId: string,
	input: { presetId: string; active: boolean },
) {
	await requireRepository(repositoryId);
	const preset = missionGoalPresets.find((item) => item.id === input.presetId);
	if (!preset) throw new NotFoundError("Mission goal preset not found");
	return repo.createMissionGoal({
		repositoryId,
		title: preset.title,
		goalText: preset.goalText,
		active: input.active,
		source: "preset",
	});
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

function hasQualitySetupCandidate(candidates: QualitySetupCandidateLike[]) {
	return candidates.some((candidate) => {
		const text = [
			candidate.title,
			candidate.summary,
			candidate.rationale,
			candidate.taskPrompt,
			candidate.acceptanceCriteria,
			candidate.verificationPlan,
			...candidate.evidence.map((item) => `${item.label} ${item.value}`),
		]
			.join("\n")
			.toLowerCase();
		return (
			candidate.importancePercent >= 95 &&
			candidate.evidence.some((item) => item.source === "quality") &&
			hasQualitySetupText(text)
		);
	});
}

function hasQualitySetupText(text: string) {
	const normalized = text.toLowerCase();
	return (
		normalized.includes("package.json") ||
		normalized.includes("test:coverage") ||
		normalized.includes("test:e2e") ||
		normalized.includes("unit") ||
		normalized.includes("coverage")
	);
}

function candidateKindPriority(
	candidate: MissionTaskCandidatesResult["candidates"][number],
) {
	switch (candidate.candidateKind) {
		case "feature_entrypoint":
			return 0;
		case "investigation":
			return 1;
		case "feature_followup":
			return 2;
		case "constraint_enablement":
			return 3;
		case "constraint_verification":
			return 4;
	}
}

function mergeUniqueStrings(values: string[]) {
	const seen = new Set<string>();
	return values.filter((value) => {
		const normalized = value.trim();
		if (!normalized || seen.has(normalized)) return false;
		seen.add(normalized);
		return true;
	});
}

function candidateAsPlanModeQuestion(
	candidate: MissionTaskCandidatesResult["candidates"][number],
) {
	return `「${candidate.title}」は、本体実装方針の中で必要性と範囲を決める。`;
}

export function applyMissionTaskCandidateSemantics(
	candidates: MissionTaskCandidatesResult["candidates"],
	selectedGoals: MissionGoal[],
) {
	const projectWideGoalIds = selectedGoals
		.filter((goal) => goal.interpretation.scope === "project_wide")
		.map((goal) => goal.id);
	const projectWideGoalIdSet = new Set(projectWideGoalIds);
	const featureEntrypoints = candidates.filter(
		(candidate) => candidate.candidateKind === "feature_entrypoint",
	);
	const entrypointGoalIds = new Set(
		featureEntrypoints
			.map((candidate) => candidate.goalId)
			.filter((goalId): goalId is string => Boolean(goalId)),
	);
	const singleEntrypoint =
		featureEntrypoints.length === 1 ? featureEntrypoints[0] : null;
	const deferredByGoal = new Map<string, string[]>();
	const deferredToSingleEntrypoint: string[] = [];
	const deferredProjectWideDetails: string[] = [];
	const selected: MissionTaskCandidatesResult["candidates"] = [];

	for (const candidate of candidates) {
		const goalId = candidate.goalId;
		const isPlanModeDetail =
			candidate.candidateKind === "feature_followup" ||
			candidate.candidateKind === "constraint_verification";
		if (goalId && entrypointGoalIds.has(goalId) && isPlanModeDetail) {
			deferredByGoal.set(goalId, [
				...(deferredByGoal.get(goalId) ?? []),
				candidateAsPlanModeQuestion(candidate),
			]);
			continue;
		}
		if (!goalId && singleEntrypoint && isPlanModeDetail) {
			deferredToSingleEntrypoint.push(candidateAsPlanModeQuestion(candidate));
			continue;
		}
		if (
			goalId &&
			projectWideGoalIdSet.has(goalId) &&
			featureEntrypoints.length > 0 &&
			isPlanModeDetail
		) {
			deferredProjectWideDetails.push(candidateAsPlanModeQuestion(candidate));
			continue;
		}
		selected.push(candidate);
	}

	return selected
		.map((candidate) => {
			if (candidate.candidateKind !== "feature_entrypoint") return candidate;
			return {
				...candidate,
				constraintGoalIds: mergeUniqueStrings([
					...candidate.constraintGoalIds,
					...projectWideGoalIds,
				]),
				planModeOpenQuestions: mergeUniqueStrings([
					...candidate.planModeOpenQuestions,
					...(candidate.goalId
						? (deferredByGoal.get(candidate.goalId) ?? [])
						: []),
					...(candidate === singleEntrypoint ? deferredToSingleEntrypoint : []),
					...deferredProjectWideDetails,
				]),
			};
		})
		.sort((a, b) => {
			const priorityDelta = candidateKindPriority(a) - candidateKindPriority(b);
			if (priorityDelta !== 0) return priorityDelta;
			return b.importancePercent - a.importancePercent;
		});
}

function normalizeMissionCandidateTitle(title: string) {
	return title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s　"'`.,:;!?()[\]{}<>「」『』【】・_-]+/g, "");
}

function selectUniqueMissionTaskCandidates(
	candidates: MissionTaskCandidatesResult["candidates"],
	blockedTitleKeys: Set<string>,
) {
	const seen = new Set<string>();
	const selected: MissionTaskCandidatesResult["candidates"] = [];
	for (const candidate of candidates) {
		const key = normalizeMissionCandidateTitle(candidate.title);
		if (!key || seen.has(key) || blockedTitleKeys.has(key)) continue;
		seen.add(key);
		selected.push(candidate);
	}
	return selected;
}

function validateGeneratedGoalIds(
	candidates: MissionTaskCandidatesResult["candidates"],
	allowedGoals: MissionGoal[],
) {
	const allowedGoalIds = new Set(allowedGoals.map((goal) => goal.id));
	for (const candidate of candidates) {
		if (candidate.goalId && !allowedGoalIds.has(candidate.goalId)) {
			throw new ValidationError(
				"Mission task generation returned an unknown goalId",
				{
					goalId: candidate.goalId,
				},
			);
		}
		for (const goalId of candidate.constraintGoalIds) {
			if (!allowedGoalIds.has(goalId)) {
				throw new ValidationError(
					"Mission task generation returned an unknown constraintGoalId",
					{
						goalId,
					},
				);
			}
		}
	}
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
	const selectedGoals = allGoals.filter((goal) => {
		if (input.goalIds?.length && !input.goalIds.includes(goal.id)) return false;
		return input.includeInactiveGoals || goal.active;
	});
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
}) {
	await requireRepository(input.repositoryId);
	const candidates = await repo.listMissionCandidatesByIds(input.candidateIds);
	if (candidates.length !== input.candidateIds.length) {
		throw new NotFoundError("Mission task candidate not found");
	}
	for (const candidate of candidates) {
		if (candidate.repositoryId !== input.repositoryId)
			throw new NotFoundError("Mission task candidate not found");
		if (candidate.status === "task_created" || candidate.taskId) {
			throw new ValidationError(
				"Mission task candidate already has a linked task",
				{
					candidateId: candidate.id,
				},
			);
		}
		if (candidate.status === "dismissed") {
			throw new ValidationError(
				"Dismissed candidates cannot be converted to tasks",
				{
					candidateId: candidate.id,
				},
			);
		}
	}
	return db.transaction(async (tx) => {
		const createdTasks = [];
		const updatedCandidates = [];
		for (const candidate of candidates) {
			const task = await repo.createTaskFromMissionCandidate(
				candidate,
				input.mode,
				tx,
			);
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

function commandForQualityRun(
	capabilities: ProjectQualityCapabilities,
	runType: "unit" | "e2e" | "all",
) {
	if (runType === "unit") {
		if (!capabilities.unit.runnable || !capabilities.unit.command) {
			throw new ValidationError("missing_quality_capability", {
				missingCapabilities: ["unit"],
			});
		}
		return [
			capabilities.unit.command,
			coverageCommandWithSummaryReporter(capabilities),
		]
			.filter(Boolean)
			.join(" && ");
	}
	if (runType === "e2e") {
		if (!capabilities.e2e.runnable || !capabilities.e2e.command) {
			throw new ValidationError("missing_quality_capability", {
				missingCapabilities: ["e2e"],
			});
		}
		return e2eCommandWithJsonReporter(capabilities.e2e.command);
	}
	if (!capabilities.all.runnable || !capabilities.all.command) {
		throw new ValidationError("missing_quality_capability", {
			missingCapabilities: capabilities.all.missingCapabilities,
		});
	}
	return [
		capabilities.unit.command,
		coverageCommandWithSummaryReporter(capabilities),
		capabilities.e2e.command
			? e2eCommandWithJsonReporter(capabilities.e2e.command)
			: undefined,
	]
		.filter(Boolean)
		.join(" && ");
}

function coverageCommandWithSummaryReporter(
	capabilities: ProjectQualityCapabilities,
) {
	const command = capabilities.coverage.command;
	if (!command) return undefined;
	if (command.includes("--coverage.reporter=json-summary")) return command;
	if (/\bbun\s+run\b/.test(command))
		return `${command} -- ${COVERAGE_SUMMARY_REPORTER_ARGS}`;
	return `${command} ${COVERAGE_SUMMARY_REPORTER_ARGS}`;
}

function e2eCommandWithJsonReporter(command: string) {
	const commandWithReporter =
		command.includes("--reporter") && command.includes("json")
			? command
			: appendCommandArgs(command, PLAYWRIGHT_JSON_REPORTER_ARGS);
	if (commandWithReporter.includes("PLAYWRIGHT_JSON_OUTPUT_FILE="))
		return commandWithReporter;
	return `PLAYWRIGHT_JSON_OUTPUT_FILE=${shellQuote(E2E_JSON_OUTPUT_PATH)} ${commandWithReporter}`;
}

function appendCommandArgs(command: string, args: string) {
	if (/\bbun\s+run\b/.test(command)) return `${command} -- ${args}`;
	return `${command} ${args}`;
}

function shellQuote(value: string) {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

async function runShellCommand(input: {
	command: string;
	cwd: string;
	timeoutSeconds: number;
}) {
	return new Promise<{
		exitCode: number | null;
		output: string;
		timedOut: boolean;
	}>((resolve) => {
		const child = spawn(input.command, {
			cwd: input.cwd,
			shell: true,
			env: { ...process.env, CI: process.env.CI ?? "1" },
		});
		let output = "";
		const append = (chunk: Buffer) => {
			output += chunk.toString("utf8");
			if (output.length > MAX_OUTPUT_CHARS)
				output = output.slice(-MAX_OUTPUT_CHARS);
		};
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			resolve({ exitCode: null, output, timedOut: true });
		}, input.timeoutSeconds * 1000);
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			resolve({ exitCode, output, timedOut: false });
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({
				exitCode: null,
				output: `${output}\n${error.message}`,
				timedOut: false,
			});
		});
	});
}

function readCoverageArtifacts(repositoryRoot: string) {
	const summaryPath = path.join(
		repositoryRoot,
		"coverage",
		"coverage-summary.json",
	);
	if (!fs.existsSync(summaryPath))
		return {
			coverageSummary: null,
			coverageGate: null,
			error: "coverage-summary.json not found",
		};
	try {
		const coverageSummary = readCoverageSummaryFile(summaryPath);
		const coverageGate = evaluateCoverageGate(
			readTestQualitySettingsFile(repositoryRoot),
			coverageSummary,
			{
				summaryPath,
			},
		);
		return { coverageSummary, coverageGate, error: null };
	} catch (error) {
		return {
			coverageSummary: null,
			coverageGate: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function minimalE2eSummary(exitCode: number | null) {
	return e2eSummarySchema.parse({
		status:
			exitCode === 0 ? "passed" : exitCode === null ? "unknown" : "failed",
		total: 0,
		passed: 0,
		failed: exitCode === 0 ? 0 : 1,
		skipped: 0,
		durationMs: null,
		suites: [],
	});
}

function readE2eArtifacts(repositoryRoot: string, exitCode: number | null) {
	const fallback = minimalE2eSummary(exitCode);
	const artifactPath = E2E_ARTIFACT_PATHS.map((candidate) =>
		path.join(repositoryRoot, candidate),
	).find((candidate) => fs.existsSync(candidate));
	if (!artifactPath) {
		return {
			e2eSummary: fallback,
			error: `E2E artifact not found (${E2E_ARTIFACT_PATHS.join(", ")})`,
		};
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as unknown;
		return {
			e2eSummary: parsePlaywrightJsonSummary(parsed, exitCode),
			error: null,
		};
	} catch (error) {
		return {
			e2eSummary: fallback,
			error: `Failed to read E2E artifact: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function parsePlaywrightJsonSummary(
	input: unknown,
	exitCode: number | null,
): E2ESummary {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new ValidationError("E2E artifact must be a JSON object");
	}
	const suites = collectPlaywrightSuites(input as Record<string, unknown>, []);
	const totals = suites.reduce(
		(acc, suite) => ({
			total: acc.total + suite.tests,
			failed: acc.failed + suite.failedTests,
			durationMs: acc.durationMs + (suite.durationMs ?? 0),
		}),
		{ total: 0, failed: 0, durationMs: 0 },
	);
	const total = totals.total;
	const failedCount = Math.min(total, totals.failed);
	return e2eSummarySchema.parse({
		status:
			failedCount > 0
				? "failed"
				: exitCode === null
					? "unknown"
					: exitCode === 0
						? "passed"
						: "failed",
		total,
		passed: Math.max(0, total - failedCount),
		failed: failedCount,
		skipped: 0,
		durationMs: totals.durationMs > 0 ? totals.durationMs : null,
		suites: suites.map(({ failedTests: _failedTests, ...suite }) => suite),
	});
}

function collectPlaywrightSuites(
	node: Record<string, unknown>,
	pathParts: string[],
): PlaywrightSuiteSummary[] {
	const title =
		typeof node.title === "string" && node.title.trim()
			? node.title.trim()
			: null;
	const nextPath = title ? [...pathParts, title] : pathParts;
	const directSpecs = Array.isArray(node.specs) ? node.specs : [];
	const rows =
		directSpecs.length > 0
			? [summarizePlaywrightSuite(nextPath, directSpecs)]
			: [];
	const children = Array.isArray(node.suites) ? node.suites : [];
	for (const child of children) {
		if (child && typeof child === "object" && !Array.isArray(child)) {
			rows.push(
				...collectPlaywrightSuites(child as Record<string, unknown>, nextPath),
			);
		}
	}
	return rows.filter((suite) => suite.tests > 0);
}

function summarizePlaywrightSuite(
	pathParts: string[],
	specs: unknown[],
): PlaywrightSuiteSummary {
	let tests = 0;
	let failedTests = 0;
	let durationMs = 0;
	let lastFailure: string | null = null;
	for (const spec of specs) {
		if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
		const specRecord = spec as Record<string, unknown>;
		const specTitle =
			typeof specRecord.title === "string" ? specRecord.title : "test";
		const testEntries = Array.isArray(specRecord.tests) ? specRecord.tests : [];
		for (const testEntry of testEntries) {
			if (
				!testEntry ||
				typeof testEntry !== "object" ||
				Array.isArray(testEntry)
			)
				continue;
			tests += 1;
			const testRecord = testEntry as Record<string, unknown>;
			const results = Array.isArray(testRecord.results)
				? testRecord.results
				: [];
			const resultRecords = results.filter(
				(result): result is Record<string, unknown> =>
					Boolean(result) &&
					typeof result === "object" &&
					!Array.isArray(result),
			);
			const failedResult = resultRecords[resultRecords.length - 1];
			const finalStatus = failedResult?.status;
			if (failedResult) {
				if (finalStatus === "failed" || finalStatus === "timedOut") {
					failedTests += 1;
					lastFailure =
						firstString(failedResult.error) ??
						firstString(failedResult.errors) ??
						firstString(failedResult.errorMessage) ??
						specTitle;
				}
			}
			durationMs += resultRecords.reduce(
				(sum, result) =>
					sum + (typeof result.duration === "number" ? result.duration : 0),
				0,
			);
		}
	}
	return {
		title: pathParts.length > 0 ? pathParts.join(" / ") : "E2E",
		status: failedTests > 0 ? "failed" : "passed",
		tests,
		durationMs: durationMs > 0 ? durationMs : null,
		lastFailure,
		failedTests,
	};
}

function firstString(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = firstString(item);
			if (found) return found;
		}
	}
	if (value && typeof value === "object") {
		for (const key of ["message", "value", "name"] as const) {
			const found = firstString((value as Record<string, unknown>)[key]);
			if (found) return found;
		}
	}
	return null;
}

function selectLatestQualityRunWithArtifact(
	runs: ProjectQualityRun[],
	artifact: "coverage" | "e2e",
) {
	return (
		runs.find((run) =>
			artifact === "coverage"
				? Boolean(run.coverageSummary || run.coverageGate)
				: Boolean(run.e2eSummary),
		) ?? null
	);
}

export async function getProjectQuality(repositoryId: string) {
	const repository = await requireRepository(repositoryId);
	const [latestUnitRun, latestE2eRun, latestAllRun, runningRuns, allRuns] =
		await Promise.all([
			repo.getLatestProjectQualityRun({ repositoryId, runType: "unit" }),
			repo.getLatestProjectQualityRun({ repositoryId, runType: "e2e" }),
			repo.getLatestProjectQualityRun({ repositoryId, runType: "all" }),
			repo.listRunningProjectQualityRuns(repositoryId),
			repo.listProjectQualityRuns(repositoryId),
		]);
	const recentRuns = allRuns.slice(0, RECENT_QUALITY_RUN_LIMIT);
	return {
		capabilities: detectQualityCapabilities(repository.localPath),
		latestUnitRun,
		latestE2eRun,
		latestCoverageRun: selectLatestQualityRunWithArtifact(allRuns, "coverage"),
		latestE2eResultRun: selectLatestQualityRunWithArtifact(allRuns, "e2e"),
		latestAllRun,
		recentRuns,
		runningRuns,
	};
}

export async function listProjectQualityRuns(repositoryId: string) {
	await requireRepository(repositoryId);
	return repo.listProjectQualityRuns(repositoryId);
}

export async function getProjectQualityRun(
	repositoryId: string,
	runId: string,
) {
	await requireRepository(repositoryId);
	const run = await repo.getProjectQualityRun(runId);
	if (!run) throw new NotFoundError("Project quality run not found");
	if (run.repositoryId !== repositoryId)
		throw new NotFoundError("Project quality run not found");
	return run;
}

export async function createProjectQualityRun(input: {
	repositoryId: string;
	runType: "unit" | "e2e" | "all";
}) {
	const repository = await requireRepository(input.repositoryId);
	const capabilities = detectQualityCapabilities(repository.localPath);
	const command = commandForQualityRun(capabilities, input.runType);
	const run = await repo.createProjectQualityRun({
		repositoryId: repository.id,
		runType: input.runType,
		command,
	});
	const timeoutSeconds = repository.safetyPolicy?.maxCommandSeconds ?? 600;
	const commandResult = await runShellCommand({
		command,
		cwd: repository.localPath,
		timeoutSeconds,
	});
	const needsCoverage = input.runType === "unit" || input.runType === "all";
	const needsE2e = input.runType === "e2e" || input.runType === "all";
	const coverage = needsCoverage
		? readCoverageArtifacts(repository.localPath)
		: { coverageSummary: null, coverageGate: null, error: null };
	const e2e = needsE2e
		? readE2eArtifacts(repository.localPath, commandResult.exitCode)
		: { e2eSummary: null, error: null };
	const errorMessage = [
		commandResult.timedOut
			? `command timed out after ${timeoutSeconds}s`
			: null,
		coverage.error,
		e2e.error,
	]
		.filter(Boolean)
		.join("; ");
	const status =
		commandResult.exitCode === 0 && !commandResult.timedOut
			? "completed"
			: "failed";
	const completed = await repo.completeProjectQualityRun({
		runId: run.id,
		status,
		exitCode: commandResult.exitCode,
		latestOutput: commandResult.output,
		coverageSummary: coverage.coverageSummary,
		coverageGate: coverage.coverageGate,
		e2eSummary: e2e.e2eSummary,
		errorMessage: errorMessage || null,
	});
	if (!completed) throw new NotFoundError("Project quality run not found");
	return completed;
}

export async function cancelProjectQualityRun(
	repositoryId: string,
	runId: string,
) {
	await requireRepository(repositoryId);
	const run = await repo.getProjectQualityRun(runId);
	if (!run) throw new NotFoundError("Project quality run not found");
	if (run.repositoryId !== repositoryId)
		throw new NotFoundError("Project quality run not found");
	if (run.status !== "running" && run.status !== "queued") return run;
	const cancelled = await repo.completeProjectQualityRun({
		runId,
		status: "cancelled",
		errorMessage: "cancelled",
	});
	if (!cancelled) throw new NotFoundError("Project quality run not found");
	return cancelled;
}
