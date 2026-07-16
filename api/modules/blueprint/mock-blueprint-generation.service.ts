import {
	type MockBlueprint,
	mockBlueprintSchema,
} from "../../../shared/schemas/mock-blueprint.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import {
	buildMockBlueprintSectionCatalog,
	buildMockBlueprintStructuredOutputJsonSchema,
	buildMockBlueprintSystemPrompt,
	buildMockBlueprintUserPrompt,
	MOCK_BLUEPRINT_PROMPT_VERSION,
	mockBlueprintPromptDiagnostics,
} from "../../services/structured-generation/prompts/mock-blueprint";
import { repairStructuredOutputOnce } from "../../services/structured-generation/structured-output-repair.service";
import {
	callStructuredLlmResult,
	createStructuredOutputContract,
	type StructuredLlmIssue,
	type SupervisorLlmDebugEvent,
} from "../../services/structured-llm";
import { StructuredLlmResponseError } from "../../services/structured-llm/contract";
import type { JsonFixWrapperResult } from "../../services/structured-llm/json";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import type { StructuredLlmPromptBudgetMetadata } from "../../services/structured-llm/types";
import type { PlanArtifactInputProjection } from "../specification/plan-artifact-input.types";
import {
	buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
} from "../specification/plan-artifact-input-renderer";

export type GeneratedMockBlueprintDraft = {
	mockBlueprint: MockBlueprint;
	generation: {
		source: "llm";
		promptVersion: typeof MOCK_BLUEPRINT_PROMPT_VERSION;
		rawOutput?: string;
		jsonRepair?: {
			repaired: boolean;
			repairKind: JsonFixWrapperResult["repairKind"];
		};
		attempts: Array<{
			attempt: number;
			rawText: string;
			extractedText: string | null;
			repairedText: string | null;
			repairKind: JsonFixWrapperResult["repairKind"] | null;
		}>;
		validationByAttempt: Array<{
			attempt: number;
			issues: StructuredLlmIssue[];
		}>;
		promptDiagnostics: MockBlueprintPromptDiagnostics;
	};
};

export type MockBlueprintPromptDiagnostics = ReturnType<
	typeof mockBlueprintPromptDiagnostics
>;

export class MockBlueprintDraftGenerationError extends StructuredLlmResponseError {
	rawOutput?: string;
	promptDiagnostics: MockBlueprintPromptDiagnostics;

	constructor(
		error: StructuredLlmResponseError,
		input: {
			promptDiagnostics: MockBlueprintPromptDiagnostics;
		},
	) {
		super({
			rawText: error.rawText,
			issues: error.issues,
			attempts: error.attempts,
			validationByAttempt: error.validationByAttempt,
		});
		this.name = "MockBlueprintDraftGenerationError";
		this.rawOutput = error.rawText;
		this.promptDiagnostics = input.promptDiagnostics;
	}
}

export async function generatePlanModeMockBlueprintDraft(input: {
	taskId: string;
	title: string;
	prompt: string;
	description?: string | null;
	objective?: string | null;
	questionnaireMarkdown?: string | null;
	projectStackContext?: string | null;
	specContext?: string | null;
	emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
	routeOverride?: StructuredLlmModelTarget | null;
	role?: StructuredLlmRole;
	usageTrace?: TraceProvenance;
	signal?: AbortSignal;
	projectionPrompt?: string | null;
	projection?: PlanArtifactInputProjection;
	promptBudgetMetadata?: StructuredLlmPromptBudgetMetadata;
}): Promise<GeneratedMockBlueprintDraft> {
	const schema = buildMockBlueprintStructuredOutputJsonSchema();
	const systemPrompt = buildMockBlueprintSystemPrompt({
		sectionCatalog: buildMockBlueprintSectionCatalog(),
		jsonSchema: schema,
	});
	const userPrompt = buildMockBlueprintUserPrompt({
		task: {
			id: input.taskId,
			title: input.title,
			description: input.description,
			objective: input.objective,
		},
		questionnaireMarkdown: input.questionnaireMarkdown,
		projectStackContext: input.projectStackContext,
		specContext: input.specContext,
		prompt: input.prompt,
		projectionPrompt: input.projectionPrompt,
	});
	const promptDiagnostics = mockBlueprintPromptDiagnostics({
		systemPrompt,
		userPrompt,
		schema,
	});
	const promptBudgetMetadata = input.projection
		? buildPlanArtifactPromptBudgetMetadata({
				projection: input.projection,
				systemPrompt,
				userPrompt,
				role: input.role,
				routeOverride: input.routeOverride,
			})
		: input.promptBudgetMetadata;
	const contract = createStructuredOutputContract({
		name: "mock_blueprint",
		runtimeSchema: mockBlueprintSchema,
		providerJsonSchema: schema,
	});
	const llmOptions = {
		contract,
		emitEvent: input.emitEvent,
		taskId: input.taskId,
		runId: null,
		role: input.role ?? ("plan" as const),
		usageTrace: input.usageTrace,
		routeOverride: input.routeOverride || null,
		promptBudgetMetadata,
		timeoutMs: PLAN_ARTIFACT_GENERATION_TIMEOUT_MS,
		signal: input.signal,
	};
	const initialResult = await callStructuredLlmResult(
		systemPrompt,
		userPrompt,
		llmOptions,
	);
	let generated: Awaited<
		ReturnType<typeof repairStructuredOutputOnce<MockBlueprint>>
	>;
	try {
		generated = await repairStructuredOutputOnce({
			initialResult,
			options: llmOptions,
		});
	} catch (error) {
		if (!(error instanceof StructuredLlmResponseError)) throw error;
		throw new MockBlueprintDraftGenerationError(error, { promptDiagnostics });
	}
	const acceptedAttempt = generated.attempts.at(-1);

	return {
		mockBlueprint: generated.value,
		generation: {
			source: "llm",
			promptVersion: MOCK_BLUEPRINT_PROMPT_VERSION,
			rawOutput: acceptedAttempt?.rawText,
			jsonRepair: {
				repaired: Boolean(acceptedAttempt?.repairedText),
				repairKind: acceptedAttempt?.repairKind ?? "none",
			},
			attempts: generated.attempts,
			validationByAttempt: generated.validationByAttempt,
			promptDiagnostics,
		},
	};
}
