import { z } from "@hono/zod-openapi";
import type {
	GenerateTaskCandidatesResponse,
	MissionGoal,
	ProjectSignalSnapshot,
	TaskGenerationEstimate,
} from "../../../shared/schemas/task-generation.schema";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import * as missionPlannerService from "../mission-planner/mission-planner.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as taskGenerationRepo from "./task-generation.repository";
import * as taskGenerationService from "./task-generation.service";
import { buildProjectSignalSnapshot } from "./task-generation-signal.service";

export const TASK_GENERATION_LARGE_THRESHOLD_LINES = 2_000;
export const TASK_GENERATION_SMALL_THRESHOLD_LINES = 500;

const taskGenerationEstimateResultSchema = z.object({
	schemaVersion: z.literal("nightworkers.task-generation-estimate/v1"),
	estimatedChangedLines: z.number().int().nonnegative(),
	estimatedFileCount: z.number().int().nonnegative(),
	estimatedTaskCount: z.number().int().nonnegative(),
	confidencePercent: z.number().int().min(0).max(100),
	rationale: z.string().min(1),
	assumptions: z.array(z.string().min(1)),
});

type TaskGenerationDependencies = {
	getRepository: typeof nightworkersRepo.getRepository;
	listMissionGoals: typeof taskGenerationRepo.listMissionGoals;
	buildProjectSignalSnapshot: typeof buildProjectSignalSnapshot;
	callStructuredJsonLLM: typeof callStructuredJsonLLM;
	generateMissionTaskCandidates: typeof taskGenerationService.generateMissionTaskCandidates;
	generateMissionCandidatesFromGoals: typeof missionPlannerService.generateMissionCandidatesFromGoals;
	decomposeMission: typeof missionPlannerService.decomposeMission;
	getMissionDetail: typeof missionPlannerService.getMissionDetail;
};

const defaultDependencies: TaskGenerationDependencies = {
	getRepository: nightworkersRepo.getRepository,
	listMissionGoals: taskGenerationRepo.listMissionGoals,
	buildProjectSignalSnapshot,
	callStructuredJsonLLM,
	generateMissionTaskCandidates:
		taskGenerationService.generateMissionTaskCandidates,
	generateMissionCandidatesFromGoals:
		missionPlannerService.generateMissionCandidatesFromGoals,
	decomposeMission: missionPlannerService.decomposeMission,
	getMissionDetail: missionPlannerService.getMissionDetail,
};

export function classifyTaskGenerationScale(
	estimatedChangedLines: number,
): TaskGenerationEstimate["scale"] {
	if (estimatedChangedLines >= TASK_GENERATION_LARGE_THRESHOLD_LINES) {
		return "large";
	}
	if (estimatedChangedLines >= TASK_GENERATION_SMALL_THRESHOLD_LINES) {
		return "medium";
	}
	return "small";
}

function buildTaskGenerationEstimateSystemPrompt() {
	return [
		"Mission Goal と repository signal から、Goal 達成に必要な残作業の規模だけを見積もってください。",
		"実装、Task Candidate 生成、Mission 生成は行わず、JSON schema に従った見積もりだけを返してください。",
		"estimatedChangedLines は新規追加と変更を合わせた概算行数です。既に実装済みの範囲は含めず、残作業だけを数えてください。",
		`推定変更行数が ${TASK_GENERATION_LARGE_THRESHOLD_LINES} 行以上なら後続で Mission 分解し、未満なら直接 Task Candidate を生成します。`,
		"不確実な場合は assumptions に前提を残し、過小評価しないでください。",
		"プロンプト文言と出力本文は日本語を維持してください。",
	].join("\n");
}

function buildTaskGenerationEstimateUserPrompt(input: {
	goals: MissionGoal[];
	signal: ProjectSignalSnapshot;
}) {
	return JSON.stringify(
		{
			instruction:
				"Goal 達成に必要な残作業について、変更行数、対象ファイル数、適切なTask数を見積もってください。",
			thresholds: {
				small: `0-${TASK_GENERATION_SMALL_THRESHOLD_LINES - 1} lines`,
				medium: `${TASK_GENERATION_SMALL_THRESHOLD_LINES}-${TASK_GENERATION_LARGE_THRESHOLD_LINES - 1} lines`,
				large: `${TASK_GENERATION_LARGE_THRESHOLD_LINES}+ lines`,
			},
			goals: input.goals,
			projectSignalSnapshot: input.signal,
			requiredOutput: "nightworkers.task-generation-estimate/v1",
		},
		null,
		2,
	);
}

function decompositionFailureMessage(error: ValidationError) {
	const cause = error.details?.message;
	return typeof cause === "string" && cause.trim() ? cause : error.message;
}

async function estimateTaskGenerationScale(
	input: { goals: MissionGoal[]; signal: ProjectSignalSnapshot },
	dependencies: TaskGenerationDependencies,
): Promise<TaskGenerationEstimate> {
	const schema = normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(taskGenerationEstimateResultSchema),
	);
	const raw = await dependencies.callStructuredJsonLLM(
		buildTaskGenerationEstimateSystemPrompt(),
		buildTaskGenerationEstimateUserPrompt(input),
		{
			role: "mission_task_generation",
			schemaName: "task_generation_estimate",
			schema,
		},
	);
	const parsed = taskGenerationEstimateResultSchema.parse(JSON.parse(raw));
	return {
		estimatedChangedLines: parsed.estimatedChangedLines,
		estimatedFileCount: parsed.estimatedFileCount,
		estimatedTaskCount: parsed.estimatedTaskCount,
		confidencePercent: parsed.confidencePercent,
		rationale: parsed.rationale,
		assumptions: parsed.assumptions,
		scale: classifyTaskGenerationScale(parsed.estimatedChangedLines),
	};
}

export async function generateTaskCandidates(
	input: {
		repositoryId: string;
		goalIds?: string[];
		includeInactiveGoals?: boolean;
	},
	dependencies: TaskGenerationDependencies = defaultDependencies,
): Promise<GenerateTaskCandidatesResponse> {
	const repository = await dependencies.getRepository(input.repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const allGoals = await dependencies.listMissionGoals(repository.id);
	const selectedGoals = allGoals.filter((goal) => {
		if (input.goalIds?.length && !input.goalIds.includes(goal.id)) return false;
		return input.includeInactiveGoals || goal.active;
	});
	if (selectedGoals.length === 0) {
		throw new ValidationError("At least one mission goal is required");
	}

	const signal = await dependencies.buildProjectSignalSnapshot({
		repository,
		goals: selectedGoals,
	});
	const estimate = await estimateTaskGenerationScale(
		{ goals: selectedGoals, signal },
		dependencies,
	);
	const generationInput = {
		repositoryId: repository.id,
		goalIds: selectedGoals.map((goal) => goal.id),
		includeInactiveGoals: true,
	};

	if (estimate.estimatedChangedLines === 0) {
		return {
			status: "completed",
			generationPath: "direct_task_candidates",
			estimate,
			candidates: [],
			missions: [],
			proposals: [],
			decompositionFailures: [],
		};
	}

	if (estimate.scale !== "large") {
		const generated =
			await dependencies.generateMissionTaskCandidates(generationInput);
		return {
			status: "completed",
			generationPath: "direct_task_candidates",
			estimate,
			candidates: generated.candidates,
			missions: [],
			proposals: [],
			decompositionFailures: [],
		};
	}

	const generatedMissions =
		await dependencies.generateMissionCandidatesFromGoals(generationInput);
	const missions = [];
	const proposals = [];
	const decompositionFailures = [];
	for (const mission of generatedMissions.missions) {
		try {
			const detail = await dependencies.decomposeMission({
				missionId: mission.id,
			});
			missions.push(detail.mission);
			proposals.push(...detail.taskProposals);
		} catch (error) {
			if (!(error instanceof ValidationError)) throw error;
			decompositionFailures.push({
				missionId: mission.id,
				message: decompositionFailureMessage(error),
			});
			const detail = await dependencies.getMissionDetail(mission.id);
			missions.push(detail.mission);
		}
	}
	return {
		status: decompositionFailures.length > 0 ? "needs_attention" : "completed",
		generationPath: "mission_decomposition",
		estimate,
		candidates: [],
		missions,
		proposals,
		decompositionFailures,
	};
}
