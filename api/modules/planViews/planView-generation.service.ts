import { z } from "zod";
import type {
	DedicatedDesignView,
	MermaidRenderRepair,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildPlanApiContractSystemPrompt,
	buildPlanApiContractUserPrompt,
	PLAN_API_CONTRACT_PROMPT_VERSION,
	planApiContractStructuredOutputSchema,
} from "../../services/structured-generation/prompts/plan-api-contract";
import {
	buildPlanDedicatedViewSystemPrompt,
	buildPlanDedicatedViewUserPrompt,
	genericDedicatedViewSchema,
	PLAN_DEDICATED_VIEW_PROMPT_VERSION,
} from "../../services/structured-generation/prompts/plan-dedicated-view";
import {
	buildPlanZodSchemaSystemPrompt,
	buildPlanZodSchemaUserPrompt,
	PLAN_ZOD_SCHEMA_PROMPT_VERSION,
	planZodSchemaStructuredOutputSchema,
} from "../../services/structured-generation/prompts/plan-zod-schema";
import { callStructuredJsonLLM } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	listPlanModeTaskMessages,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import { resolvePlanModeProjectStackContext } from "../specification/plan-mode-project-stack-context";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { assertPlanModeMutable } from "../specification/specification-mutability";
import {
	buildZodSchemaSourceEvidence,
	parsePlanApiContractOutput,
	parsePlanZodSchemaOutput,
} from "./plan-view-contract-parser";
import {
	buildClientMermaidRepairPrompt,
	parseGenericDedicatedViewOutput,
	resolveMessage,
} from "./plan-view-generic-parser";
import {
	buildPlanViewMermaidRepairContext,
	buildPlanViewOutputRepairContext,
	normalizePlanViewMermaidArtifact,
	validatePlanViewMermaidArtifact,
} from "./plan-view-mermaid-validator";

export {
	parsePlanApiContractOutput,
	parsePlanZodSchemaOutput,
} from "./plan-view-contract-parser";
export {
	buildClientMermaidRepairPrompt,
	parseGenericDedicatedViewOutput,
	resolveMessage,
} from "./plan-view-generic-parser";
export {
	normalizePlanViewMermaidArtifact,
	validatePlanViewMermaidArtifact,
} from "./plan-view-mermaid-validator";

const PLAN_VIEW_MERMAID_MAX_ATTEMPTS = 3;
export const genericPlanViewSchema = z.enum([
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export type GenericPlanView = z.infer<typeof genericPlanViewSchema>;

export const markdownPlanViewSchema = z.enum([
	"user_flow",
	"activity_flow",
	"sequence_flow",
]);

export type MarkdownPlanView = z.infer<typeof markdownPlanViewSchema>;

export type PlanViewGenerationInput = {
	prompt?: string;
	questionnaireSessionId?: string | null;
	featurePlanMessageId?: string | null;
	sourceBlueprintMessageId?: string | null;
	sourceDataModelMessageId?: string | null;
	mermaidRenderRepair?: MermaidRenderRepair;
	routeOverride?: StructuredLlmModelTarget | null;
	role?: StructuredLlmRole;
	trace?: TraceProvenance;
	llmUsageTrace?: TraceProvenance;
};

export async function generatePlanViewArtifact(
	taskId: string,
	view: DedicatedDesignView,
	input: PlanViewGenerationInput = {},
) {
	const parsedView = genericPlanViewSchema.safeParse(view);
	if (!parsedView.success) {
		throw new AppError(
			422,
			"UNSUPPORTED_PLAN_VIEW",
			`Unsupported generic plan view: ${view}`,
		);
	}
	const task = await getPlanModeTask(taskId);
	if (!task) throw new NotFoundError("Task not found");
	assertPlanModeCapabilityEnabled(parsedView.data);
	assertPlanModeMutable(task);

	const messages = await listPlanModeTaskMessages(taskId);
	const mermaidRepairSourceMessage = input.mermaidRenderRepair
		? messages.find(
				(message) => message.id === input.mermaidRenderRepair?.sourceMessageId,
			) || null
		: null;
	if (input.mermaidRenderRepair) {
		const repairMetadata = (mermaidRepairSourceMessage?.metadataJson ||
			{}) as Record<string, unknown>;
		if (
			!mermaidRepairSourceMessage ||
			repairMetadata.artifactKind !== "plan_mode_dedicated_view" ||
			repairMetadata.view !== parsedView.data
		) {
			throw new AppError(
				422,
				"INVALID_MERMAID_REPAIR_SOURCE",
				"Mermaid repair source must belong to the requested Plan Mode view.",
			);
		}
	}
	const featurePlanMessage = resolveMessage(
		messages,
		input.featurePlanMessageId,
		"feature_plan",
	);
	const blueprintMessage = resolveMessage(
		messages,
		input.sourceBlueprintMessageId,
		"blueprint",
	);
	const dataModelMessage = resolveMessage(
		messages,
		input.sourceDataModelMessageId,
		"data_model",
	);
	const prompt = input.mermaidRenderRepair
		? buildClientMermaidRepairPrompt(input.mermaidRenderRepair)
		: input.prompt?.trim() ||
			task.objective ||
			task.description ||
			task.title ||
			"No additional prompt.";
	const projectStackContext = await resolvePlanModeProjectStackContext(
		task.repositoryId,
	);
	const sourceMessageIds = [
		featurePlanMessage?.id,
		blueprintMessage?.id,
		dataModelMessage?.id,
		mermaidRepairSourceMessage?.id,
	].filter((id): id is string => Boolean(id));
	if (parsedView.data === "api_io_contract") {
		const artifact = await generateApiContractArtifactFromLlm({
			taskId,
			task: renderTaskContext(task),
			projectStackContext,
			featurePlan: featurePlanMessage?.content || "Feature Plan は未生成です。",
			questionnaire: input.questionnaireSessionId
				? `Questionnaire session: ${input.questionnaireSessionId}`
				: "Questionnaire は指定されていません。",
			blueprint: blueprintMessage?.content || "Blueprint は未生成です。",
			dataModel: dataModelMessage?.content || "Data Model は未生成です。",
			prompt,
			routeOverride: input.routeOverride || null,
			role: input.role ?? "plan",
			usageTrace: input.llmUsageTrace,
		});
		const message = await createPlanModeTaskMessage({
			taskId,
			role: "assistant",
			content: JSON.stringify(artifact.openapi, null, 2),
			messageType: "api_contract",
			payloadJson: {
				artifactKind: "plan_mode_api_contract",
				view: artifact.view,
				source: "dedicated-view-generator",
				title: artifact.title,
				intent: "plan_mode_dedicated_view",
				artifactType: artifact.view,
				apiContract: artifact,
				artifactPayload: artifact,
				featurePlanMessageId: featurePlanMessage?.id ?? null,
				questionnaireSessionId: input.questionnaireSessionId ?? null,
				sourceBlueprintMessageId: blueprintMessage?.id ?? null,
				sourceDataModelMessageId: dataModelMessage?.id ?? null,
				sourceMessageIds,
				generation: {
					promptVersion: PLAN_API_CONTRACT_PROMPT_VERSION,
				},
			},
			trace: input.trace,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	}
	if (parsedView.data === "zod_schema_design") {
		const artifact = await generateZodSchemaArtifactFromLlm({
			taskId,
			task: renderTaskContext(task),
			projectStackContext,
			featurePlan: featurePlanMessage?.content || "Feature Plan は未生成です。",
			questionnaire: input.questionnaireSessionId
				? `Questionnaire session: ${input.questionnaireSessionId}`
				: "Questionnaire は指定されていません。",
			blueprint: blueprintMessage?.content || "Blueprint は未生成です。",
			dataModel: dataModelMessage?.content || "Data Model は未生成です。",
			prompt,
			routeOverride: input.routeOverride || null,
			role: input.role ?? "plan",
			usageTrace: input.llmUsageTrace,
		});
		const message = await createPlanModeTaskMessage({
			taskId,
			role: "assistant",
			content: artifact.zodSource,
			messageType: "zod_schema",
			payloadJson: {
				artifactKind: "plan_mode_zod_schema",
				view: artifact.view,
				source: "dedicated-view-generator",
				title: artifact.title,
				intent: "plan_mode_dedicated_view",
				artifactType: artifact.view,
				zodSchema: artifact,
				artifactPayload: artifact,
				featurePlanMessageId: featurePlanMessage?.id ?? null,
				questionnaireSessionId: input.questionnaireSessionId ?? null,
				sourceBlueprintMessageId: blueprintMessage?.id ?? null,
				sourceDataModelMessageId: dataModelMessage?.id ?? null,
				sourceMessageIds,
				generation: {
					promptVersion: PLAN_ZOD_SCHEMA_PROMPT_VERSION,
				},
			},
			trace: input.trace,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	}
	const artifact = await generateArtifactFromLlm({
		view: markdownPlanViewSchema.parse(parsedView.data),
		taskId,
		task: renderTaskContext(task),
		projectStackContext,
		featurePlan: featurePlanMessage?.content || "Feature Plan は未生成です。",
		questionnaire: input.questionnaireSessionId
			? `Questionnaire session: ${input.questionnaireSessionId}`
			: "Questionnaire は指定されていません。",
		blueprint: blueprintMessage?.content || "Blueprint は未生成です。",
		dataModel: dataModelMessage?.content || "Data Model は未生成です。",
		prompt,
		routeOverride: input.routeOverride || null,
		role: input.role ?? "plan",
		usageTrace: input.llmUsageTrace,
	});
	const message = await createPlanModeTaskMessage({
		taskId,
		role: "assistant",
		content: artifact.markdown,
		messageType: "markdown_document",
		payloadJson: {
			artifactKind: "plan_mode_dedicated_view",
			view: artifact.view,
			source: "dedicated-view-generator",
			title: artifact.title,
			intent: "plan_mode_dedicated_view",
			artifactType: artifact.view,
			...(artifact.diagramKind ? { diagramKind: artifact.diagramKind } : {}),
			featurePlanMessageId: featurePlanMessage?.id ?? null,
			questionnaireSessionId: input.questionnaireSessionId ?? null,
			sourceBlueprintMessageId: blueprintMessage?.id ?? null,
			sourceDataModelMessageId: dataModelMessage?.id ?? null,
			sourceMessageIds,
			generation: {
				promptVersion: PLAN_DEDICATED_VIEW_PROMPT_VERSION,
				...(input.mermaidRenderRepair
					? {
							repair: {
								source: "client_mermaid_render" as const,
								sourceMessageId: input.mermaidRenderRepair.sourceMessageId,
								stage: input.mermaidRenderRepair.stage,
							},
						}
					: {}),
			},
		},
		trace: input.trace,
	});
	return { message, workspace: await getPlanModeWorkspace(taskId) };
}

async function generateArtifactFromLlm(input: {
	view: MarkdownPlanView;
	taskId: string;
	task: string;
	projectStackContext: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}) {
	try {
		let repairContext: string | null = null;
		let lastError: unknown = null;
		for (
			let attempt = 1;
			attempt <= PLAN_VIEW_MERMAID_MAX_ATTEMPTS;
			attempt += 1
		) {
			const rawOutput = await callStructuredJsonLLM(
				buildPlanDedicatedViewSystemPrompt(input.view),
				buildPlanDedicatedViewUserPrompt({ ...input, repairContext }),
				{
					schemaName: "plan_mode_dedicated_view",
					schema: genericDedicatedViewSchema,
					taskId: input.taskId,
					runId: null,
					role: input.role,
					usageTrace: input.usageTrace,
					routeOverride: input.routeOverride,
				},
			);
			try {
				const artifact = normalizePlanViewMermaidArtifact(
					parseGenericDedicatedViewOutput(rawOutput, input.view),
				);
				const mermaidError = await validatePlanViewMermaidArtifact(artifact);
				if (!mermaidError) return artifact;
				lastError = new Error(mermaidError.error);
				repairContext = buildPlanViewMermaidRepairContext({
					artifact,
					chart: mermaidError.chart,
					error: mermaidError.error,
				});
			} catch (err) {
				lastError = err;
				repairContext = buildPlanViewOutputRepairContext(rawOutput, err);
			}
		}
		throw lastError instanceof Error
			? lastError
			: new Error("Plan view generation failed.");
	} catch (err) {
		if (err instanceof AppError) throw err;
		const message =
			err instanceof Error ? err.message : "Plan view generation failed.";
		throw new AppError(502, "PLAN_VIEW_GENERATION_FAILED", message);
	}
}

async function generateApiContractArtifactFromLlm(input: {
	taskId: string;
	task: string;
	projectStackContext: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}) {
	try {
		const rawOutput = await callStructuredJsonLLM(
			buildPlanApiContractSystemPrompt(),
			buildPlanApiContractUserPrompt(input),
			{
				schemaName: "plan_mode_api_contract",
				schema: planApiContractStructuredOutputSchema,
				taskId: input.taskId,
				runId: null,
				role: input.role,
				usageTrace: input.usageTrace,
				routeOverride: input.routeOverride,
			},
		);
		return parsePlanApiContractOutput(rawOutput);
	} catch (err) {
		if (err instanceof AppError) throw err;
		const message =
			err instanceof Error
				? err.message
				: "Plan API contract generation failed.";
		throw new AppError(502, "PLAN_API_CONTRACT_GENERATION_FAILED", message);
	}
}

async function generateZodSchemaArtifactFromLlm(input: {
	taskId: string;
	task: string;
	projectStackContext: string;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}) {
	try {
		const rawOutput = await callStructuredJsonLLM(
			buildPlanZodSchemaSystemPrompt(),
			buildPlanZodSchemaUserPrompt(input),
			{
				schemaName: "plan_mode_zod_schema",
				schema: planZodSchemaStructuredOutputSchema,
				taskId: input.taskId,
				runId: null,
				role: input.role,
				usageTrace: input.usageTrace,
				routeOverride: input.routeOverride,
			},
		);
		return parsePlanZodSchemaOutput(rawOutput, {
			sourceText: buildZodSchemaSourceEvidence(input),
		});
	} catch (err) {
		if (err instanceof AppError) throw err;
		const message =
			err instanceof Error ? err.message : "Plan Zod schema generation failed.";
		throw new AppError(502, "PLAN_ZOD_SCHEMA_GENERATION_FAILED", message);
	}
}

function renderTaskContext(task: {
	title?: string | null;
	description?: string | null;
	objective?: string | null;
}) {
	return [
		`Title: ${task.title || "Untitled"}`,
		task.description ? `Description: ${task.description}` : "",
		task.objective ? `Objective: ${task.objective}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
