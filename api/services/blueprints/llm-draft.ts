import { createHash } from "node:crypto";
import {
	type AppBlueprint,
	appBlueprintSchema,
} from "../../../shared/schemas/app-blueprint.schema";
import { p } from "../../systemContexts/catalog";
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
	buildAppBlueprintStructuredOutputJsonSchema,
	renderAppBlueprintJsonSchema,
} from "./json-schema";
import { validateAppBlueprint } from "./validation";

export type PlanModeBlueprintRequestContract = {
	schemaName: "app_blueprint";
	requiredArtifact: "AppBlueprint JSON";
	regularBlueprintDataContract: {
		databaseSchema: { tables: []; relations: [] };
		dataBindings: [];
		sectionDataBindingId: "forbidden";
		dataModelWorkflowOnly: true;
	};
	userRequest: {
		taskId: string;
		title: string;
		userRequest: string;
		projectStackContext: string | null;
		requiredArtifact: "AppBlueprint JSON";
	};
};

export type BlueprintPromptDiagnostics = {
	schemaIncluded: boolean;
	schemaDigest: string;
	schemaBytes: number;
	catalogComponentCount: number;
};

export type GeneratedBlueprintDraft = {
	blueprint: AppBlueprint;
	validation: ReturnType<typeof validateAppBlueprint>;
	generation: {
		source: "llm";
		degradedReasons: string[];
		rawOutput?: string;
		jsonRepair?: BlueprintJsonRepairDiagnostics;
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
	emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedBlueprintDraft> {
	const requestContract = buildPlanModeBlueprintRequestContract(input);
	const appBlueprintJsonSchema = renderAppBlueprintJsonSchema();
	const promptDiagnostics = buildPromptDiagnostics(appBlueprintJsonSchema);
	try {
		const generated = await callStructuredOutputWithRepair({
			systemPrompt: buildBlueprintSystemPrompt(
				{
					appBlueprintJsonSchema,
				},
				p,
			),
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

export function buildPlanModeBlueprintRequestContract(input: {
	taskId: string;
	title: string;
	prompt: string;
	projectStackContext?: string | null;
}): PlanModeBlueprintRequestContract {
	return {
		schemaName: "app_blueprint",
		requiredArtifact: "AppBlueprint JSON",
		regularBlueprintDataContract: {
			databaseSchema: { tables: [], relations: [] },
			dataBindings: [],
			sectionDataBindingId: "forbidden",
			dataModelWorkflowOnly: true,
		},
		userRequest: {
			taskId: input.taskId,
			title: input.title,
			userRequest: input.prompt,
			projectStackContext: input.projectStackContext || null,
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
			promptDiagnostics: buildPromptDiagnostics(renderAppBlueprintJsonSchema()),
		},
	);
}

function buildPromptDiagnostics(schema: string): BlueprintPromptDiagnostics {
	return {
		schemaIncluded: true,
		schemaDigest: createHash("sha256").update(schema).digest("hex"),
		schemaBytes: Buffer.byteLength(schema, "utf8"),
		catalogComponentCount: blueprintCatalog.length,
	};
}
