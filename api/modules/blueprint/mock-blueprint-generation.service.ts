import type { MockBlueprint } from "../../../shared/schemas/mock-blueprint.schema";
import {
	buildMockBlueprintSectionCatalog,
	buildMockBlueprintStructuredOutputJsonSchema,
	buildMockBlueprintSystemPrompt,
	buildMockBlueprintUserPrompt,
	MOCK_BLUEPRINT_PROMPT_VERSION,
	mockBlueprintPromptDiagnostics,
} from "../../services/structured-generation/prompts/mock-blueprint";
import {
	callStructuredJsonLLM,
	type SupervisorLlmDebugEvent,
} from "../../services/structured-llm";
import type { JsonFixWrapperResult } from "../../services/structured-llm/json";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../services/structured-llm/settings";
import { parseMockBlueprintJsonOutput } from "./mock-blueprint-parser";

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
		promptDiagnostics: MockBlueprintPromptDiagnostics;
	};
};

export type MockBlueprintPromptDiagnostics = ReturnType<
	typeof mockBlueprintPromptDiagnostics
>;

export class MockBlueprintDraftGenerationError extends Error {
	rawOutput?: string;
	promptDiagnostics: MockBlueprintPromptDiagnostics;

	constructor(
		message: string,
		input: {
			rawOutput?: string;
			promptDiagnostics: MockBlueprintPromptDiagnostics;
		},
	) {
		super(message);
		this.name = "MockBlueprintDraftGenerationError";
		this.rawOutput = input.rawOutput;
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
	});
	const promptDiagnostics = mockBlueprintPromptDiagnostics({
		systemPrompt,
		userPrompt,
		schema,
	});
	const rawOutput = await callStructuredJsonLLM(systemPrompt, userPrompt, {
		schemaName: "mock_blueprint",
		schema,
		emitEvent: input.emitEvent,
		taskId: input.taskId,
		runId: null,
		role: input.role ?? "plan",
		routeOverride: input.routeOverride || null,
		allowRawOutputOnJsonParseFailure: true,
	});

	const parsed = parseMockBlueprintJsonOutput(rawOutput);
	if (!parsed.ok) {
		throw new MockBlueprintDraftGenerationError(
			parsed.reason === "schema"
				? `Mock Blueprint LLM output failed schema validation: ${parsed.message}`
				: "Mock Blueprint LLM output did not contain valid JSON.",
			{ rawOutput, promptDiagnostics },
		);
	}

	return {
		mockBlueprint: parsed.value,
		generation: {
			source: "llm",
			promptVersion: MOCK_BLUEPRINT_PROMPT_VERSION,
			rawOutput,
			jsonRepair: {
				repaired: parsed.repaired,
				repairKind: parsed.repairKind,
			},
			promptDiagnostics,
		},
	};
}
