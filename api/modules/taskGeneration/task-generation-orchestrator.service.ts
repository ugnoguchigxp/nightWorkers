import { z } from "@hono/zod-openapi";
import type {
	GenerateTaskCandidatesResponse,
	ProjectSignalSnapshot,
	TaskGenerationEstimate,
	TaskGenerationLlmUsage,
} from "../../../shared/schemas/task-generation.schema";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	mergeStructuredLlmCallUsage,
	structuredLlmCallUsageFromEvent,
} from "../../services/structured-llm";
import { normalizeStructuredOutputJsonSchema } from "../../services/structured-llm/json-schema";
import { p } from "../../systemContexts/catalog";
import * as missionPlannerService from "../mission-planner/mission-planner.service";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as taskGenerationRepo from "./task-generation.repository";
import * as taskGenerationService from "./task-generation.service";
import {
	buildTaskGenerationPromptSignal,
	buildTaskGenerationSystemContext,
} from "./task-generation-prompt-context";
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
	callStructuredOutputWithRepair: typeof callStructuredOutputWithRepair;
	generateMissionTaskCandidates: typeof taskGenerationService.generateMissionTaskCandidates;
	generateMissionPlansFromGoals: typeof missionPlannerService.generateMissionPlansFromGoals;
};

const defaultDependencies: TaskGenerationDependencies = {
	getRepository: nightworkersRepo.getRepository,
	listMissionGoals: taskGenerationRepo.listMissionGoals,
	buildProjectSignalSnapshot,
	callStructuredOutputWithRepair,
	generateMissionTaskCandidates:
		taskGenerationService.generateMissionTaskCandidates,
	generateMissionPlansFromGoals:
		missionPlannerService.generateMissionPlansFromGoals,
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

function buildTaskGenerationEstimateSystemPrompt(
	signal: ProjectSignalSnapshot,
) {
	return p("taskGeneration.estimate", {
		largeThresholdLines: TASK_GENERATION_LARGE_THRESHOLD_LINES,
		generationContext: buildTaskGenerationSystemContext(signal),
	});
}

function buildTaskGenerationEstimateUserPrompt(input: {
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
			projectSignal: buildTaskGenerationPromptSignal(input.signal, "estimate"),
			requiredOutput: "nightworkers.task-generation-estimate/v1",
		},
		null,
		2,
	);
}

async function estimateTaskGenerationScale(
	input: { signal: ProjectSignalSnapshot },
	dependencies: TaskGenerationDependencies,
): Promise<{
	estimate: TaskGenerationEstimate;
	llmUsage: TaskGenerationLlmUsage | null;
}> {
	const schema = normalizeStructuredOutputJsonSchema(
		z.toJSONSchema(taskGenerationEstimateResultSchema),
	);
	let llmUsage: TaskGenerationLlmUsage | null = null;
	const generated = await dependencies.callStructuredOutputWithRepair({
		systemPrompt: buildTaskGenerationEstimateSystemPrompt(input.signal),
		userPrompt: buildTaskGenerationEstimateUserPrompt(input),
		options: {
			contract: createStructuredOutputContract({
				name: "task_generation_estimate",
				runtimeSchema: taskGenerationEstimateResultSchema,
				providerJsonSchema: schema,
			}),
			role: "mission_task_generation",
			emitEvent: (event) => {
				const usage = structuredLlmCallUsageFromEvent(event);
				if (usage) {
					llmUsage = {
						stage: "estimate",
						...mergeStructuredLlmCallUsage(llmUsage, usage),
					};
				}
			},
		},
	});
	const parsed = generated.value;
	return {
		estimate: {
			estimatedChangedLines: parsed.estimatedChangedLines,
			estimatedFileCount: parsed.estimatedFileCount,
			estimatedTaskCount: parsed.estimatedTaskCount,
			confidencePercent: parsed.confidencePercent,
			rationale: parsed.rationale,
			assumptions: parsed.assumptions,
			scale: classifyTaskGenerationScale(parsed.estimatedChangedLines),
		},
		llmUsage,
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
	const estimateResult = await estimateTaskGenerationScale(
		{ signal },
		dependencies,
	);
	const estimate = estimateResult.estimate;
	const priorLlmUsage = estimateResult.llmUsage
		? [estimateResult.llmUsage]
		: [];
	const generationInput = {
		repositoryId: repository.id,
		goalIds: selectedGoals.map((goal) => goal.id),
		includeInactiveGoals: true,
		signal,
		priorLlmUsage,
	};

	if (estimate.estimatedChangedLines === 0) {
		return {
			status: "completed",
			generationPath: "direct_task_candidates",
			estimate,
			candidates: [],
			missions: [],
			proposals: [],
			llmUsage: estimateResult.llmUsage ? [estimateResult.llmUsage] : [],
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
			llmUsage: [estimateResult.llmUsage, generated.llmUsage].filter(
				(usage): usage is TaskGenerationLlmUsage => Boolean(usage),
			),
			decompositionFailures: [],
		};
	}

	const generated =
		await dependencies.generateMissionPlansFromGoals(generationInput);
	return {
		status: "completed",
		generationPath: "mission_decomposition",
		estimate,
		candidates: [],
		missions: generated.missions,
		proposals: generated.proposals,
		llmUsage: [estimateResult.llmUsage, generated.llmUsage].filter(
			(usage): usage is TaskGenerationLlmUsage => Boolean(usage),
		),
		decompositionFailures: [],
	};
}
