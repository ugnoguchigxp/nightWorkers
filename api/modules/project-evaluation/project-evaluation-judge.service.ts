import { z } from "@hono/zod-openapi";
import {
	type ProjectEvaluationBundle,
	type ProjectEvaluationDimensionKey,
	type ProjectEvaluationReport,
	type ProjectEvaluationRun,
	type ProjectImprovementIdea,
	projectEvaluationReportSchema,
	projectImprovementIdeasResultSchema,
} from "../../../shared/schemas/project-evaluation.schema";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import {
	buildNormalizedSupervisorLlmRequest,
	createStructuredOutputContract,
	structuredLlmAttemptValueText,
} from "../../services/structured-llm";
import {
	buildProjectEvaluationSystemPrompt,
	buildProjectEvaluationUserPrompt,
	buildProjectImprovementSystemPrompt,
	buildProjectImprovementUserPrompt,
} from "./project-evaluation-prompts";

export type ProjectEvaluationLlmSelection = {
	role: "evaluation";
	providerId: string;
	providerEndpointId: string | null;
	routeSource: string | null;
	modelOrDeployment: string | null;
	thinkingDepth: string | null;
};

function toJsonSchema(schema: z.ZodTypeAny) {
	return z.toJSONSchema(schema);
}

function fallbackSelectedModelForPrompts(
	systemPrompt: string,
	userPrompt: string,
	schemaName: string,
	schema: unknown,
): ProjectEvaluationLlmSelection {
	const normalized = buildNormalizedSupervisorLlmRequest({
		systemPrompt,
		userPrompt,
		label: schemaName,
		role: "evaluation",
		jsonSchema: {
			name: schemaName,
			schema,
		},
	});
	return {
		role: "evaluation",
		providerId: normalized.providerId,
		providerEndpointId: normalized.providerEndpointId ?? null,
		routeSource: normalized.routeSource ?? null,
		modelOrDeployment: normalized.modelOrDeployment,
		thinkingDepth: normalized.thinkingDepth ?? null,
	};
}

function selectionFromDebugEvent(
	event: SupervisorLlmDebugEvent,
): ProjectEvaluationLlmSelection | null {
	if (event.type !== "model.request_started") return null;
	const data = event.data || {};
	return {
		role: "evaluation",
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

async function callProjectEvaluationJson(input: {
	systemPrompt: string;
	userPrompt: string;
	schemaName: string;
	schema: z.ZodTypeAny;
	onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}) {
	let selectedModel = fallbackSelectedModelForPrompts(
		input.systemPrompt,
		input.userPrompt,
		input.schemaName,
		toJsonSchema(input.schema),
	);
	const generated = await callStructuredOutputWithRepair({
		systemPrompt: input.systemPrompt,
		userPrompt: input.userPrompt,
		options: {
			contract: createStructuredOutputContract({
				name: input.schemaName,
				runtimeSchema: input.schema,
			}),
			role: "evaluation",
			emitEvent: async (event) => {
				const nextSelection = selectionFromDebugEvent(event);
				if (nextSelection) selectedModel = nextSelection;
				await input.onLlmEvent?.(event);
			},
		},
	});
	return { generated, selectedModel };
}

export async function judgeProjectEvaluation(input: {
	bundle: ProjectEvaluationBundle;
	baselinePrompt?: string;
	onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<{
	report: ProjectEvaluationReport;
	rawOutput: unknown;
	selectedModel: ProjectEvaluationLlmSelection;
}> {
	const systemPrompt = buildProjectEvaluationSystemPrompt();
	const userPrompt = buildProjectEvaluationUserPrompt(input);
	const called = await callProjectEvaluationJson({
		systemPrompt,
		userPrompt,
		schemaName: "project_evaluation",
		schema: projectEvaluationReportSchema,
		onLlmEvent: input.onLlmEvent,
	});
	const acceptedAttempt = called.generated.attempts.at(-1);
	const rawOutput = JSON.parse(
		acceptedAttempt
			? structuredLlmAttemptValueText(acceptedAttempt)
			: JSON.stringify(called.generated.value),
	) as unknown;
	const report = called.generated.value as ProjectEvaluationReport;
	return {
		report,
		rawOutput,
		selectedModel: called.selectedModel,
	};
}

export async function generateProjectImprovementIdeas(input: {
	evaluation: ProjectEvaluationRun;
	bundle: ProjectEvaluationBundle;
	dimensionKeys: ProjectEvaluationDimensionKey[];
	onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<{
	ideas: ProjectImprovementIdea[];
	rawOutput: unknown;
	selectedModel: ProjectEvaluationLlmSelection;
}> {
	const systemPrompt = buildProjectImprovementSystemPrompt();
	const userPrompt = buildProjectImprovementUserPrompt(input);
	const called = await callProjectEvaluationJson({
		systemPrompt,
		userPrompt,
		schemaName: "project_improvement_ideas",
		schema: projectImprovementIdeasResultSchema,
		onLlmEvent: input.onLlmEvent,
	});
	const acceptedAttempt = called.generated.attempts.at(-1);
	const rawOutput = JSON.parse(
		acceptedAttempt
			? structuredLlmAttemptValueText(acceptedAttempt)
			: JSON.stringify(called.generated.value),
	) as unknown;
	const parsed = called.generated.value as z.infer<
		typeof projectImprovementIdeasResultSchema
	>;
	return {
		ideas: parsed.ideas,
		rawOutput,
		selectedModel: called.selectedModel,
	};
}
