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
	genericDedicatedViewArtifactSchema,
	genericDedicatedViewSchema,
	PLAN_DEDICATED_VIEW_PROMPT_VERSION,
} from "../../services/structured-generation/prompts/plan-dedicated-view";
import {
	buildPlanZodSchemaSystemPrompt,
	buildPlanZodSchemaUserPrompt,
	PLAN_ZOD_SCHEMA_PROMPT_VERSION,
	planZodSchemaStructuredOutputSchema,
} from "../../services/structured-generation/prompts/plan-zod-schema";
import { createStructuredGenerationAppError } from "../../services/structured-generation/structured-generation-error";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import { createStructuredOutputContract } from "../../services/structured-llm";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredProviderExecutionPolicy } from "../agentsShare";
import {
	createPlanModeTaskMessage,
	getPlanModeTask,
	getPlanModeTaskMessage,
} from "../nightworkers/nightworkers.plan-mode-core.port";
import { assertPlanModeCapabilityEnabled } from "../nightworkers/nightworkers.plan-mode-settings.service";
import type { PlanArtifactSourceSelection } from "../specification/plan-artifact-input.types";
import { resolvePlanArtifactCanonicalInput } from "../specification/plan-artifact-input-context.service";
import { projectPlanArtifactInput } from "../specification/plan-artifact-input-projection";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
	renderPlanArtifactInput,
} from "../specification/plan-artifact-input-renderer";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { getPlanModeWorkspace } from "../specification/plan-mode-workspace.service";
import { assertPlanModeMutable } from "../specification/specification-mutability";
import {
	buildZodSchemaSourceEvidence,
	parsePlanApiContractOutput,
	parsePlanZodSchemaOutput,
	planApiContractDraftSchema,
	planZodSchemaDraftSchema,
} from "./plan-view-contract-parser";
import {
	buildClientMermaidRepairPrompt,
	parseGenericDedicatedViewOutput,
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
} from "./plan-view-generic-parser";
export {
	normalizePlanViewMermaidArtifact,
	validatePlanViewMermaidArtifact,
} from "./plan-view-mermaid-validator";

const PLAN_VIEW_MERMAID_MAX_ATTEMPTS = 2;
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
	sourceSelection?: PlanArtifactSourceSelection;
	mermaidRenderRepair?: MermaidRenderRepair;
	routeOverride?: StructuredLlmModelTarget | null;
	role?: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	trace?: TraceProvenance;
	llmUsageTrace?: TraceProvenance;
	signal?: AbortSignal;
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

	const mermaidRepairSourceMessage = input.mermaidRenderRepair
		? await getPlanModeTaskMessage(input.mermaidRenderRepair.sourceMessageId)
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
	const target = parsedView.data as Parameters<
		typeof resolvePlanArtifactCanonicalInput
	>[0]["target"];
	const canonical = await resolvePlanArtifactCanonicalInput({
		taskId,
		target,
		questionnaireSessionId: input.questionnaireSessionId ?? null,
		sourceSelection:
			input.sourceSelection ??
			createPlanArtifactSourceSelection({
				policy: "explicit_request",
				previousTargetMessageId: input.mermaidRenderRepair?.sourceMessageId,
			}),
		regenerationRequest: input.mermaidRenderRepair
			? buildClientMermaidRepairPrompt(input.mermaidRenderRepair)
			: (input.prompt ?? null),
	});
	const projection = projectPlanArtifactInput(canonical);
	const renderedInput = renderPlanArtifactInput(projection);
	const sourceMessageIds = projection.provenance.sourceMessageIds;
	if (parsedView.data === "api_io_contract") {
		const artifact = await generateApiContractArtifactFromLlm({
			taskId,
			task: renderedInput.task,
			projectStackContext: renderedInput.projectContext,
			featurePlan: renderedInput.featurePlan,
			questionnaire: renderedInput.questionnaire,
			blueprint: renderedInput.blueprint,
			dataModel: renderedInput.dataModel,
			prompt: renderedInput.regenerationRequest ?? "",
			projectionPrompt: renderedInput.prompt,
			projection,
			routeOverride: input.routeOverride || null,
			role: input.role ?? "plan",
			executionPolicy: input.executionPolicy,
			usageTrace: input.llmUsageTrace,
			signal: input.signal,
		});
		input.signal?.throwIfAborted();
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
				featurePlanMessageId:
					input.sourceSelection?.featurePlanMessageId ?? null,
				questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
				sourceBlueprintMessageId:
					input.sourceSelection?.blueprintMessageId ?? null,
				sourceDataModelMessageId:
					input.sourceSelection?.dataModelMessageId ?? null,
				sourceMessageIds,
				generation: {
					promptVersion: PLAN_API_CONTRACT_PROMPT_VERSION,
					inputProjection: projectionMetadata(
						projection,
						canonical.questionnaire?.sessionId ?? null,
					),
				},
			},
			trace: input.trace,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	}
	if (parsedView.data === "zod_schema_design") {
		const artifact = await generateZodSchemaArtifactFromLlm({
			taskId,
			task: renderedInput.task,
			projectStackContext: renderedInput.projectContext,
			featurePlan: renderedInput.featurePlan,
			questionnaire: renderedInput.questionnaire,
			blueprint: renderedInput.blueprint,
			dataModel: renderedInput.dataModel,
			prompt: renderedInput.regenerationRequest ?? "",
			projectionPrompt: renderedInput.prompt,
			projection,
			routeOverride: input.routeOverride || null,
			role: input.role ?? "plan",
			executionPolicy: input.executionPolicy,
			usageTrace: input.llmUsageTrace,
			signal: input.signal,
		});
		input.signal?.throwIfAborted();
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
				featurePlanMessageId:
					input.sourceSelection?.featurePlanMessageId ?? null,
				questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
				sourceBlueprintMessageId:
					input.sourceSelection?.blueprintMessageId ?? null,
				sourceDataModelMessageId:
					input.sourceSelection?.dataModelMessageId ?? null,
				sourceMessageIds,
				generation: {
					promptVersion: PLAN_ZOD_SCHEMA_PROMPT_VERSION,
					inputProjection: projectionMetadata(
						projection,
						canonical.questionnaire?.sessionId ?? null,
					),
				},
			},
			trace: input.trace,
		});
		return { message, workspace: await getPlanModeWorkspace(taskId) };
	}
	const artifact = await generateArtifactFromLlm({
		view: markdownPlanViewSchema.parse(parsedView.data),
		taskId,
		task: renderedInput.task,
		projectStackContext: renderedInput.projectContext,
		featurePlan: renderedInput.featurePlan,
		questionnaire: renderedInput.questionnaire,
		blueprint: renderedInput.blueprint,
		dataModel: renderedInput.dataModel,
		prompt: renderedInput.regenerationRequest ?? "",
		projectionPrompt: renderedInput.prompt,
		projection,
		routeOverride: input.routeOverride || null,
		role: input.role ?? "plan",
		executionPolicy: input.executionPolicy,
		usageTrace: input.llmUsageTrace,
		signal: input.signal,
	});
	input.signal?.throwIfAborted();
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
			featurePlanMessageId: input.sourceSelection?.featurePlanMessageId ?? null,
			questionnaireSessionId: canonical.questionnaire?.sessionId ?? null,
			sourceBlueprintMessageId:
				input.sourceSelection?.blueprintMessageId ?? null,
			sourceDataModelMessageId:
				input.sourceSelection?.dataModelMessageId ?? null,
			sourceMessageIds,
			generation: {
				promptVersion: PLAN_DEDICATED_VIEW_PROMPT_VERSION,
				inputProjection: projectionMetadata(
					projection,
					canonical.questionnaire?.sessionId ?? null,
				),
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
	projectionPrompt?: string;
	projection: ReturnType<typeof projectPlanArtifactInput>;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
}) {
	let lastRawOutput: string | null = null;
	try {
		let repairContext: string | null = null;
		let lastError: unknown = null;
		for (
			let attempt = 1;
			attempt <= PLAN_VIEW_MERMAID_MAX_ATTEMPTS;
			attempt += 1
		) {
			const systemPrompt = buildPlanDedicatedViewSystemPrompt(input.view);
			const userPrompt = buildPlanDedicatedViewUserPrompt({
				...input,
				repairContext,
			});
			const generated = await callStructuredOutputWithRepair({
				systemPrompt,
				userPrompt,
				options: {
					contract: createStructuredOutputContract({
						name: "plan_mode_dedicated_view",
						runtimeSchema: genericDedicatedViewArtifactSchema,
						providerJsonSchema: genericDedicatedViewSchema,
					}),
					taskId: input.taskId,
					runId: null,
					role: input.role,
					executionPolicy: input.executionPolicy,
					usageTrace: input.usageTrace,
					routeOverride: input.routeOverride,
					promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
						projection: input.projection,
						systemPrompt,
						userPrompt,
						role: input.role,
						routeOverride: input.routeOverride,
					}),
					timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
					signal: input.signal,
				},
			});
			const rawOutput =
				generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
			lastRawOutput = rawOutput;
			try {
				const artifact = normalizePlanViewMermaidArtifact(
					parseGenericDedicatedViewOutput(
						JSON.stringify(generated.value),
						input.view,
					),
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
		throw createStructuredGenerationAppError({
			code: "PLAN_VIEW_GENERATION_FAILED",
			fallbackMessage: "Plan view generation failed.",
			error: err,
			lastRawText: lastRawOutput,
		});
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
	projectionPrompt?: string;
	projection: ReturnType<typeof projectPlanArtifactInput>;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
}) {
	let lastRawOutput: string | null = null;
	try {
		const systemPrompt = buildPlanApiContractSystemPrompt();
		const userPrompt = buildPlanApiContractUserPrompt(input);
		const generated = await callStructuredOutputWithRepair({
			systemPrompt,
			userPrompt,
			options: {
				contract: createStructuredOutputContract({
					name: "plan_mode_api_contract",
					runtimeSchema: planApiContractDraftSchema,
					providerJsonSchema: planApiContractStructuredOutputSchema,
				}),
				taskId: input.taskId,
				runId: null,
				role: input.role,
				executionPolicy: input.executionPolicy,
				usageTrace: input.usageTrace,
				routeOverride: input.routeOverride,
				promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
					projection: input.projection,
					systemPrompt,
					userPrompt,
					role: input.role,
					routeOverride: input.routeOverride,
				}),
				timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
				signal: input.signal,
			},
		});
		lastRawOutput =
			generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
		return parsePlanApiContractOutput(JSON.stringify(generated.value));
	} catch (err) {
		throw createStructuredGenerationAppError({
			code: "PLAN_API_CONTRACT_GENERATION_FAILED",
			fallbackMessage: "Plan API contract generation failed.",
			error: err,
			lastRawText: lastRawOutput,
		});
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
	projectionPrompt?: string;
	projection: ReturnType<typeof projectPlanArtifactInput>;
	routeOverride: StructuredLlmModelTarget | null;
	role: StructuredLlmRole;
	executionPolicy?: StructuredProviderExecutionPolicy;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
}) {
	let lastRawOutput: string | null = null;
	try {
		const systemPrompt = buildPlanZodSchemaSystemPrompt();
		const userPrompt = buildPlanZodSchemaUserPrompt(input);
		const generated = await callStructuredOutputWithRepair({
			systemPrompt,
			userPrompt,
			options: {
				contract: createStructuredOutputContract({
					name: "plan_mode_zod_schema",
					runtimeSchema: planZodSchemaDraftSchema,
					providerJsonSchema: planZodSchemaStructuredOutputSchema,
				}),
				taskId: input.taskId,
				runId: null,
				role: input.role,
				executionPolicy: input.executionPolicy,
				usageTrace: input.usageTrace,
				routeOverride: input.routeOverride,
				promptBudgetMetadata: buildPlanArtifactPromptBudgetMetadata({
					projection: input.projection,
					systemPrompt,
					userPrompt,
					role: input.role,
					routeOverride: input.routeOverride,
				}),
				timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
				signal: input.signal,
			},
		});
		lastRawOutput =
			generated.attempts.at(-1)?.rawText ?? JSON.stringify(generated.value);
		return parsePlanZodSchemaOutput(JSON.stringify(generated.value), {
			sourceText: buildZodSchemaSourceEvidence(input),
		});
	} catch (err) {
		throw createStructuredGenerationAppError({
			code: "PLAN_ZOD_SCHEMA_GENERATION_FAILED",
			fallbackMessage: "Plan Zod schema generation failed.",
			error: err,
			lastRawText: lastRawOutput,
		});
	}
}

function projectionMetadata(
	projection: ReturnType<typeof projectPlanArtifactInput>,
	questionnaireSessionId: string | null,
) {
	return {
		version: projection.version,
		target: projection.target,
		digest: projection.diagnostics.projectionDigest,
		contextRevision: projection.provenance.contextRevision,
		contextDigest: projection.provenance.contextDigest,
		routingRevision: projection.provenance.routingRevision,
		questionnaireSessionId,
		questionnaireDigest: projection.provenance.questionnaireDigest,
		sourceMessageIds: projection.provenance.sourceMessageIds,
		sourceDigests: projection.provenance.sourceDigests,
		sectionBytes: projection.diagnostics.sectionBytes,
	};
}
