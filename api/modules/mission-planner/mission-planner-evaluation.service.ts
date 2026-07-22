import { z } from "@hono/zod-openapi";
import {
	type Mission,
	type MissionDecompositionEvaluation,
	type MissionDecompositionPlanningResult,
	type MissionDeterministicCheckReport,
	missionDecompositionEvaluationSchema,
} from "../../../shared/schemas/mission-planner.schema";
import type { ProjectSignalSnapshot } from "../../../shared/schemas/task-generation.schema";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import {
	buildNormalizedSupervisorLlmRequest,
	createStructuredOutputContract,
	mergeStructuredLlmCallUsage,
	type StructuredLlmCallUsage,
	structuredLlmAttemptValueText,
	structuredLlmCallUsageFromEvent,
} from "../../services/structured-llm";
import {
	buildMissionEvaluationSystemPrompt,
	buildMissionEvaluationUserPrompt,
} from "./mission-planner.prompts";

export type MissionPlannerLlmSelection = {
	stage:
		| "mission_candidates"
		| "mission_draft"
		| "structure"
		| "task_proposals"
		| "evaluation";
	providerId: string;
	providerEndpointId: string | null;
	routeSource: string | null;
	modelOrDeployment: string | null;
	thinkingDepth: string | null;
	llmUsage?: StructuredLlmCallUsage | null;
};

export function fallbackSelectedModelForMissionStage(input: {
	stage: MissionPlannerLlmSelection["stage"];
	systemPrompt: string;
	userPrompt: string;
	schemaName: string;
	schema: unknown;
}): MissionPlannerLlmSelection {
	const normalized = buildNormalizedSupervisorLlmRequest({
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		label: input.schemaName,
		role:
			input.stage === "evaluation" ? "evaluation" : "mission_task_generation",
		jsonSchema: { name: input.schemaName, schema: input.schema },
	});
	return {
		stage: input.stage,
		providerId: normalized.providerId,
		providerEndpointId: normalized.providerEndpointId ?? null,
		routeSource: normalized.routeSource ?? null,
		modelOrDeployment: normalized.modelOrDeployment,
		thinkingDepth: normalized.thinkingDepth ?? null,
	};
}

export function missionSelectionFromDebugEvent(
	stage: MissionPlannerLlmSelection["stage"],
	event: SupervisorLlmDebugEvent,
): MissionPlannerLlmSelection | null {
	if (event.type !== "model.request_started") return null;
	const data = event.data || {};
	return {
		stage,
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

export async function callMissionPlannerJson<T>(input: {
	stage: MissionPlannerLlmSelection["stage"];
	systemPrompt: string;
	userPrompt: string;
	schemaName: string;
	schema: z.ZodType<T>;
	thinkingDepthOverride?: "low" | "medium" | "high" | "very_high";
	onSelection?: (selection: MissionPlannerLlmSelection) => void;
}): Promise<{
	parsed: T;
	rawOutput: unknown;
	selectedModel: MissionPlannerLlmSelection;
	llmUsage: StructuredLlmCallUsage | null;
}> {
	const jsonSchema = z.toJSONSchema(input.schema);
	let selectedModel = fallbackSelectedModelForMissionStage({
		stage: input.stage,
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		schemaName: input.schemaName,
		schema: jsonSchema,
	});
	const routeOverride =
		input.thinkingDepthOverride &&
		selectedModel.providerEndpointId &&
		selectedModel.modelOrDeployment
			? {
					providerEndpointId: selectedModel.providerEndpointId,
					model: selectedModel.modelOrDeployment,
					thinkingDepth: input.thinkingDepthOverride,
				}
			: null;
	let llmUsage: StructuredLlmCallUsage | null = null;
	const generated = await callStructuredOutputWithRepair({
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		options: {
			contract: createStructuredOutputContract({
				name: input.schemaName,
				runtimeSchema: input.schema,
				providerJsonSchema: jsonSchema,
			}),
			role:
				input.stage === "evaluation" ? "evaluation" : "mission_task_generation",
			routeOverride,
			emitEvent: async (event) => {
				const nextUsage = structuredLlmCallUsageFromEvent(event);
				if (nextUsage) {
					llmUsage = mergeStructuredLlmCallUsage(llmUsage, nextUsage);
				}
				const nextSelection = missionSelectionFromDebugEvent(
					input.stage,
					event,
				);
				if (nextSelection) {
					selectedModel = nextSelection;
					input.onSelection?.(nextSelection);
				}
			},
		},
	});
	const acceptedAttempt = generated.attempts.at(-1);
	const rawOutput = JSON.parse(
		acceptedAttempt
			? structuredLlmAttemptValueText(acceptedAttempt)
			: JSON.stringify(generated.value),
	) as unknown;
	return {
		parsed: generated.value,
		rawOutput,
		selectedModel: llmUsage ? { ...selectedModel, llmUsage } : selectedModel,
		llmUsage,
	};
}

export async function evaluateMissionDecomposition(input: {
	mission: Mission;
	planningResult: MissionDecompositionPlanningResult;
	deterministicChecks: MissionDeterministicCheckReport;
	signal: ProjectSignalSnapshot;
	existingTaskTitles: string[];
}) {
	const systemPrompt = buildMissionEvaluationSystemPrompt();
	const userPrompt = buildMissionEvaluationUserPrompt(input);
	const result = await callMissionPlannerJson<MissionDecompositionEvaluation>({
		stage: "evaluation",
		systemPrompt,
		userPrompt,
		schemaName: "mission_decomposition_evaluation",
		schema: missionDecompositionEvaluationSchema,
	});
	return result;
}
