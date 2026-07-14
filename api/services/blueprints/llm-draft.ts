import { createHash } from "node:crypto";
import {
	type AppBlueprint,
	appBlueprintSchema,
} from "../../../shared/schemas/app-blueprint.schema";
import { blueprintCatalog } from "../blueprint-catalog";
import { buildBlueprintSystemPrompt } from "../structured-generation/prompts/app-blueprint";
import { callStructuredOutputWithRepair } from "../structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	type StructuredLlmIssue,
	type SupervisorLlmDebugEvent,
} from "../structured-llm";
import {
	type JsonFixWrapperResult,
	parseRepairedJsonWithSchema,
} from "../structured-llm/json";
import {
	renderSupervisorReferenceDocuments,
	resolveSupervisorReferenceDocuments,
	summarizeSupervisorReferenceDocuments,
} from "../supervisor/skills/registry";
import type { SupervisorRoutingHypothesis } from "../supervisor/skills/types";
import {
	buildAppBlueprintStructuredOutputJsonSchema,
	renderAppBlueprintJsonSchema,
} from "./json-schema";
import { validateAppBlueprint } from "./validation";

type BlueprintReferenceDocumentsSummary = ReturnType<
	typeof summarizeSupervisorReferenceDocuments
>;

export type PlanModeBlueprintRequestContract = {
	schemaName: "app_blueprint";
	requiredArtifact: "AppBlueprint JSON";
	regularBlueprintDataContract: {
		databaseSchema: { tables: []; relations: [] };
		dataBindings: [];
		sectionDataBindingId: "forbidden";
		dataModelWorkflowOnly: true;
	};
	referenceDocuments: BlueprintReferenceDocumentsSummary;
	userRequest: {
		taskId: string;
		title: string;
		userRequest: string;
		projectStackContext: string | null;
		routingHypothesis: SupervisorRoutingHypothesis | null;
		requiredArtifact: "AppBlueprint JSON";
	};
};

export type BlueprintPromptDiagnostics = {
	schemaIncluded: boolean;
	schemaDigest: string;
	schemaBytes: number;
	catalogComponentCount: number;
	referenceDocumentCount: number;
	referenceDocuments: BlueprintReferenceDocumentsSummary;
};

export type GeneratedBlueprintDraft = {
	blueprint: AppBlueprint;
	validation: ReturnType<typeof validateAppBlueprint>;
	generation: {
		source: "llm";
		degradedReasons: string[];
		rawOutput?: string;
		jsonRepair?: BlueprintJsonRepairDiagnostics;
		referenceDocuments: BlueprintReferenceDocumentsSummary;
		promptDiagnostics: BlueprintPromptDiagnostics;
	};
};

export type BlueprintJsonRepairDiagnostics = {
	repaired: boolean;
	repairKind: JsonFixWrapperResult["repairKind"];
};

export class BlueprintDraftGenerationError extends Error {
	rawOutput?: string;
	promptDiagnostics: BlueprintPromptDiagnostics;

	constructor(
		message: string,
		input: {
			rawOutput?: string;
			promptDiagnostics: BlueprintPromptDiagnostics;
		},
	) {
		super(message);
		this.name = "BlueprintDraftGenerationError";
		this.rawOutput = input.rawOutput;
		this.promptDiagnostics = input.promptDiagnostics;
	}
}

export async function generatePlanModeBlueprintDraft(input: {
	taskId: string;
	title: string;
	prompt: string;
	projectStackContext?: string | null;
	routing?: SupervisorRoutingHypothesis;
	emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedBlueprintDraft> {
	const referenceDocuments = resolveSupervisorReferenceDocuments(
		input.routing || blueprintRoutingFallback,
	);
	const referenceDocumentSummary =
		summarizeSupervisorReferenceDocuments(referenceDocuments);
	const requestContract = buildPlanModeBlueprintRequestContract(
		input,
		referenceDocumentSummary,
	);
	const appBlueprintJsonSchema = renderAppBlueprintJsonSchema();
	const promptDiagnostics = buildPromptDiagnostics(
		appBlueprintJsonSchema,
		referenceDocumentSummary,
	);
	try {
		const generated = await callStructuredOutputWithRepair({
			systemPrompt: buildBlueprintSystemPrompt({
				referenceContext:
					renderSupervisorReferenceDocuments(referenceDocuments),
				appBlueprintJsonSchema,
			}),
			userPrompt: JSON.stringify(requestContract.userRequest, null, 2),
			options: {
				contract: createStructuredOutputContract({
					name: requestContract.schemaName,
					runtimeSchema: appBlueprintSchema,
					providerJsonSchema: buildAppBlueprintStructuredOutputJsonSchema(),
				}),
				emitEvent: input.emitEvent,
				taskId: input.taskId,
				runId: null,
				role: "plan",
			},
			validateFacts: validateBlueprintFacts,
		});
		const blueprint = generated.value;
		const validation = validateAppBlueprint(blueprint);
		const acceptedAttempt = generated.attempts.at(-1);
		return {
			blueprint,
			validation,
			generation: {
				source: "llm",
				degradedReasons: [],
				rawOutput: acceptedAttempt?.rawText,
				jsonRepair: {
					repaired: Boolean(acceptedAttempt?.repairedText),
					repairKind: acceptedAttempt?.repairKind ?? "none",
				},
				referenceDocuments: referenceDocumentSummary,
				promptDiagnostics,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new BlueprintDraftGenerationError(message, {
			rawOutput: (error as { rawText?: string }).rawText,
			promptDiagnostics,
		});
	}
}

function validateBlueprintFacts(blueprint: AppBlueprint): StructuredLlmIssue[] {
	const validation = validateAppBlueprint(blueprint);
	return validation.valid
		? []
		: validation.issues.map((issue) => ({
				stage: "fact" as const,
				path: issue.path.split(".").filter(Boolean),
				code: issue.code,
				message: issue.message,
			}));
}

export function buildPlanModeBlueprintRequestContract(
	input: {
		taskId: string;
		title: string;
		prompt: string;
		projectStackContext?: string | null;
		routing?: SupervisorRoutingHypothesis;
	},
	referenceDocuments: BlueprintReferenceDocumentsSummary = summarizeSupervisorReferenceDocuments(
		resolveSupervisorReferenceDocuments(
			input.routing || blueprintRoutingFallback,
		),
	),
): PlanModeBlueprintRequestContract {
	return {
		schemaName: "app_blueprint",
		requiredArtifact: "AppBlueprint JSON",
		regularBlueprintDataContract: {
			databaseSchema: { tables: [], relations: [] },
			dataBindings: [],
			sectionDataBindingId: "forbidden",
			dataModelWorkflowOnly: true,
		},
		referenceDocuments,
		userRequest: {
			taskId: input.taskId,
			title: input.title,
			userRequest: input.prompt,
			projectStackContext: input.projectStackContext || null,
			routingHypothesis: input.routing || null,
			requiredArtifact: "AppBlueprint JSON",
		},
	};
}

export function parseAndValidateBlueprintOutput(rawOutput: string): {
	blueprint: AppBlueprint;
	validation: ReturnType<typeof validateAppBlueprint>;
	jsonRepair: BlueprintJsonRepairDiagnostics;
} {
	const parsed = parseRepairedJsonWithSchema(rawOutput, appBlueprintSchema);
	if (!parsed.ok) throw blueprintOutputError(rawOutput);
	const blueprint = parsed.value;
	const validation = validateAppBlueprint(blueprint);
	if (!validation.valid) throw blueprintOutputError(rawOutput);
	return {
		blueprint,
		validation,
		jsonRepair: { repaired: parsed.repaired, repairKind: parsed.repairKind },
	};
}

function blueprintOutputError(rawOutput: string) {
	return new BlueprintDraftGenerationError(
		rawOutput.trim() || "LLM response was empty.",
		{
			rawOutput,
			promptDiagnostics: buildPromptDiagnostics(
				renderAppBlueprintJsonSchema(),
				[],
			),
		},
	);
}

const blueprintRoutingFallback: SupervisorRoutingHypothesis = {
	primaryMode: "planning",
	secondaryModes: ["review"],
	phase: "plan",
	workKinds: ["blueprint", "ui_ux"],
	overlays: ["user_facing_change"],
	subtype: "app_blueprint",
	requiredEvidence: ["latest user request"],
	nextReferenceFiles: ["references/work_kinds/blueprint.md"],
	confidence: 0.7,
};

function buildPromptDiagnostics(
	schema: string,
	referenceDocuments: BlueprintReferenceDocumentsSummary,
): BlueprintPromptDiagnostics {
	return {
		schemaIncluded: true,
		schemaDigest: createHash("sha256").update(schema).digest("hex"),
		schemaBytes: Buffer.byteLength(schema, "utf8"),
		catalogComponentCount: blueprintCatalog.length,
		referenceDocumentCount: referenceDocuments.length,
		referenceDocuments,
	};
}
