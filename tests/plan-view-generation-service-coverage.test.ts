import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
	getPlanModeTask: vi.fn(),
	getPlanModeTaskMessage: vi.fn(),
	createPlanModeTaskMessage: vi.fn(),
}));
const settings = vi.hoisted(() => ({
	assertPlanModeCapabilityEnabled: vi.fn(),
}));
const mutability = vi.hoisted(() => ({ assertPlanModeMutable: vi.fn() }));
const canonical = vi.hoisted(() => ({
	resolvePlanArtifactCanonicalInput: vi.fn(),
}));
const projection = vi.hoisted(() => ({ projectPlanArtifactInput: vi.fn() }));
const sourceSelection = vi.hoisted(() => ({
	createPlanArtifactSourceSelection: vi.fn(),
}));
const workspace = vi.hoisted(() => ({ getPlanModeWorkspace: vi.fn() }));
const renderer = vi.hoisted(() => ({
	buildPlanArtifactPromptBudgetMetadata: vi.fn(() => ({ total: 1 })),
	renderPlanArtifactInput: vi.fn(),
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS: 12_345,
}));
const structured = vi.hoisted(() => ({
	callStructuredOutputWithRepair: vi.fn(),
	createStructuredOutputContract: vi.fn((input) => input),
}));
const contractParser = vi.hoisted(() => ({
	buildZodSchemaSourceEvidence: vi.fn(() => "zod evidence"),
	parsePlanApiContractOutput: vi.fn(),
	parsePlanZodSchemaOutput: vi.fn(),
	planApiContractOpenApiSchema: {},
	planZodSchemaDraftSchema: {},
}));
const genericParser = vi.hoisted(() => ({
	buildClientMermaidRepairPrompt: vi.fn(() => "repair request"),
	parseGenericDedicatedViewOutput: vi.fn(),
}));
const mermaid = vi.hoisted(() => ({
	buildPlanViewMermaidRepairContext: vi.fn(() => "mermaid repair context"),
	buildPlanViewOutputRepairContext: vi.fn(() => "output repair context"),
	normalizePlanViewMermaidArtifact: vi.fn((artifact) => artifact),
	validatePlanViewMermaidArtifact: vi.fn(),
}));
const errors = vi.hoisted(() => ({
	createStructuredGenerationAppError: vi.fn(),
}));
const dedicatedPrompt = vi.hoisted(() => ({
	buildPlanDedicatedViewSystemPrompt: vi.fn((view) => `system:${view}`),
	buildPlanDedicatedViewUserPrompt: vi.fn(
		(input) => `user:${input.view}:${input.repairContext ?? "none"}`,
	),
	genericDedicatedViewArtifactSchema: {},
	genericDedicatedViewSchema: {},
	PLAN_DEDICATED_VIEW_PROMPT_VERSION: "dedicated-v1",
}));
const apiPrompt = vi.hoisted(() => ({
	buildPlanApiContractSystemPrompt: vi.fn(() => "api system"),
	buildPlanApiContractUserPrompt: vi.fn(() => "api user"),
	PLAN_API_CONTRACT_PROMPT_VERSION: "api-v1",
	planApiContractStructuredOutputSchema: {},
}));
const zodPrompt = vi.hoisted(() => ({
	buildPlanZodSchemaSystemPrompt: vi.fn(() => "zod system"),
	buildPlanZodSchemaUserPrompt: vi.fn(() => "zod user"),
	PLAN_ZOD_SCHEMA_PROMPT_VERSION: "zod-v1",
	planZodSchemaStructuredOutputSchema: {},
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.plan-mode-core.port",
	() => core,
);
vi.mock(
	"../api/modules/nightworkers/nightworkers.plan-mode-settings.service",
	() => settings,
);
vi.mock(
	"../api/modules/specification/specification-mutability",
	() => mutability,
);
vi.mock(
	"../api/modules/specification/plan-artifact-input-context.service",
	() => canonical,
);
vi.mock(
	"../api/modules/specification/plan-artifact-input-projection",
	() => projection,
);
vi.mock(
	"../api/modules/specification/plan-artifact-source-selection",
	() => sourceSelection,
);
vi.mock(
	"../api/modules/specification/plan-mode-workspace.service",
	() => workspace,
);
vi.mock(
	"../api/modules/specification/plan-artifact-input-renderer",
	() => renderer,
);
vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({
		callStructuredOutputWithRepair: structured.callStructuredOutputWithRepair,
	}),
);
vi.mock("../api/services/structured-llm", () => ({
	createStructuredOutputContract: structured.createStructuredOutputContract,
}));
vi.mock(
	"../api/modules/planViews/plan-view-contract-parser",
	() => contractParser,
);
vi.mock(
	"../api/modules/planViews/plan-view-generic-parser",
	() => genericParser,
);
vi.mock("../api/modules/planViews/plan-view-mermaid-validator", () => mermaid);
vi.mock(
	"../api/services/structured-generation/structured-generation-error",
	() => errors,
);
vi.mock(
	"../api/services/structured-generation/prompts/plan-dedicated-view",
	() => dedicatedPrompt,
);
vi.mock(
	"../api/services/structured-generation/prompts/plan-api-contract",
	() => apiPrompt,
);
vi.mock(
	"../api/services/structured-generation/prompts/plan-zod-schema",
	() => zodPrompt,
);

import { AppError } from "../api/lib/errors";
import { generatePlanViewArtifact } from "../api/modules/planViews/planView-generation.service";

const provenance = {
	contextRevision: 2,
	contextDigest: "context-digest",
	routingRevision: 3,
	questionnaireDigest: "questionnaire-digest",
	sourceMessageIds: ["source-1"],
	sourceDigests: { task: "task-digest" },
};

function generation(value: unknown, rawText?: string) {
	return {
		value,
		attempts: rawText === undefined ? [] : [{ rawText }],
	};
}

describe("plan view generation service coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		core.getPlanModeTask.mockResolvedValue({
			id: "task-1",
			status: "planning",
		});
		core.getPlanModeTaskMessage.mockResolvedValue(null);
		core.createPlanModeTaskMessage.mockImplementation(async (input) => ({
			id: "message-generated",
			...input,
		}));
		canonical.resolvePlanArtifactCanonicalInput.mockResolvedValue({
			questionnaire: { sessionId: "questionnaire-1" },
		});
		projection.projectPlanArtifactInput.mockReturnValue({
			version: 1,
			target: "user_flow",
			provenance,
			diagnostics: {
				projectionDigest: "projection-digest",
				sectionBytes: { task: 12 },
			},
		});
		renderer.renderPlanArtifactInput.mockReturnValue({
			task: "task",
			projectContext: "stack",
			featurePlan: "feature plan",
			questionnaire: "questionnaire",
			blueprint: "blueprint",
			dataModel: "data model",
			regenerationRequest: null,
			prompt: "projection prompt",
		});
		sourceSelection.createPlanArtifactSourceSelection.mockReturnValue({
			policy: "explicit_request",
		});
		workspace.getPlanModeWorkspace.mockResolvedValue({ taskId: "task-1" });
		mermaid.validatePlanViewMermaidArtifact.mockResolvedValue(null);
		genericParser.parseGenericDedicatedViewOutput.mockImplementation(
			(_raw, view) => ({
				artifactKind: "plan_mode_dedicated_view",
				view,
				title: `${view} title`,
				markdown: "```mermaid\nflowchart TD\n A-->B\n```",
				diagramKind: "flowchart",
			}),
		);
		contractParser.parsePlanApiContractOutput.mockReturnValue({
			artifactKind: "plan_mode_api_contract",
			view: "api_io_contract",
			title: "API Contract",
			openapi: { openapi: "3.1.0" },
		});
		contractParser.parsePlanZodSchemaOutput.mockReturnValue({
			artifactKind: "plan_mode_zod_schema",
			view: "zod_schema_design",
			title: "Zod Schema",
			zodSource: "const schema = z.object({});",
		});
		errors.createStructuredGenerationAppError.mockImplementation(
			(input) =>
				new AppError(502, input.code, input.fallbackMessage, {
					lastRawText: input.lastRawText,
				}),
		);
	});

	it("rejects unsupported views, missing tasks, and mutability failures", async () => {
		await expect(
			generatePlanViewArtifact("task-1", "unknown" as never),
		).rejects.toMatchObject({ code: "UNSUPPORTED_PLAN_VIEW" });

		core.getPlanModeTask.mockResolvedValueOnce(null);
		await expect(
			generatePlanViewArtifact("task-1", "user_flow"),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});

		settings.assertPlanModeCapabilityEnabled.mockImplementationOnce(() => {
			throw new AppError(403, "DISABLED", "disabled");
		});
		await expect(
			generatePlanViewArtifact("task-1", "user_flow"),
		).rejects.toMatchObject({
			code: "DISABLED",
		});

		mutability.assertPlanModeMutable.mockImplementationOnce(() => {
			throw new AppError(409, "IMMUTABLE", "immutable");
		});
		await expect(
			generatePlanViewArtifact("task-1", "user_flow"),
		).rejects.toMatchObject({
			code: "IMMUTABLE",
		});
	});

	it("validates Mermaid repair ownership", async () => {
		const repair = {
			sourceMessageId: "source-message",
			stage: "chart_render" as const,
			error: "parse error",
			chart: "flowchart TD\nA-->",
		};
		await expect(
			generatePlanViewArtifact("task-1", "user_flow", {
				mermaidRenderRepair: repair,
			}),
		).rejects.toMatchObject({ code: "INVALID_MERMAID_REPAIR_SOURCE" });

		core.getPlanModeTaskMessage.mockResolvedValueOnce({
			metadataJson: { artifactKind: "wrong", view: "user_flow" },
		});
		await expect(
			generatePlanViewArtifact("task-1", "user_flow", {
				mermaidRenderRepair: repair,
			}),
		).rejects.toMatchObject({ code: "INVALID_MERMAID_REPAIR_SOURCE" });

		core.getPlanModeTaskMessage.mockResolvedValueOnce({
			metadataJson: {
				artifactKind: "plan_mode_dedicated_view",
				view: "activity_flow",
			},
		});
		await expect(
			generatePlanViewArtifact("task-1", "user_flow", {
				mermaidRenderRepair: repair,
			}),
		).rejects.toMatchObject({ code: "INVALID_MERMAID_REPAIR_SOURCE" });
	});

	it.each([
		"user_flow",
		"activity_flow",
		"sequence_flow",
	] as const)("generates and persists the %s markdown view", async (view) => {
		structured.callStructuredOutputWithRepair.mockResolvedValue(
			generation({ view, output: true }, "raw markdown"),
		);
		projection.projectPlanArtifactInput.mockReturnValueOnce({
			version: 1,
			target: view,
			provenance,
			diagnostics: { projectionDigest: "digest", sectionBytes: {} },
		});
		const result = await generatePlanViewArtifact("task-1", view, {
			prompt: "make it",
			routeOverride: { providerEndpointId: "endpoint", model: "model" },
			role: "review",
			trace: { traceId: "trace" } as never,
			llmUsageTrace: { traceId: "usage" } as never,
		});
		expect(result.workspace).toEqual({ taskId: "task-1" });
		expect(core.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				messageType: "markdown_document",
				content: expect.stringContaining("mermaid"),
				payloadJson: expect.objectContaining({
					view,
					diagramKind: "flowchart",
					questionnaireSessionId: "questionnaire-1",
				}),
			}),
		);
	});

	it("uses explicit source selection and persists Mermaid repair metadata", async () => {
		const repair = {
			sourceMessageId: "source-message",
			stage: "chart_render" as const,
			error: "parse error",
			chart: "flowchart TD\nA-->",
		};
		core.getPlanModeTaskMessage.mockResolvedValue({
			metadataJson: {
				artifactKind: "plan_mode_dedicated_view",
				view: "user_flow",
			},
		});
		structured.callStructuredOutputWithRepair.mockResolvedValue(
			generation({ ok: true }),
		);
		const explicit = {
			policy: "explicit_request" as const,
			featurePlanMessageId: "feature-1",
			blueprintMessageId: "blueprint-1",
			dataModelMessageId: "data-1",
		};

		await generatePlanViewArtifact("task-1", "user_flow", {
			mermaidRenderRepair: repair,
			sourceSelection: explicit,
		});

		expect(genericParser.buildClientMermaidRepairPrompt).toHaveBeenCalledWith(
			repair,
		);
		expect(canonical.resolvePlanArtifactCanonicalInput).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceSelection: explicit,
				regenerationRequest: "repair request",
			}),
		);
		expect(core.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					featurePlanMessageId: "feature-1",
					sourceBlueprintMessageId: "blueprint-1",
					sourceDataModelMessageId: "data-1",
					generation: expect.objectContaining({
						repair: expect.objectContaining({
							sourceMessageId: "source-message",
						}),
					}),
				}),
			}),
		);
	});

	it("repairs Mermaid validation and parser failures before succeeding", async () => {
		structured.callStructuredOutputWithRepair
			.mockResolvedValueOnce(generation({ attempt: 1 }, "raw one"))
			.mockResolvedValueOnce(generation({ attempt: 2 }, "raw two"));
		mermaid.validatePlanViewMermaidArtifact
			.mockResolvedValueOnce({ chart: "A-->", error: "parse failure" })
			.mockResolvedValueOnce(null);
		await generatePlanViewArtifact("task-1", "user_flow");
		expect(mermaid.buildPlanViewMermaidRepairContext).toHaveBeenCalled();
		expect(
			dedicatedPrompt.buildPlanDedicatedViewUserPrompt,
		).toHaveBeenLastCalledWith(
			expect.objectContaining({ repairContext: "mermaid repair context" }),
		);

		vi.clearAllMocks();
		structured.callStructuredOutputWithRepair
			.mockResolvedValueOnce(generation({ attempt: 1 }, "bad raw"))
			.mockResolvedValueOnce(generation({ attempt: 2 }, "good raw"));
		genericParser.parseGenericDedicatedViewOutput
			.mockImplementationOnce(() => {
				throw "invalid output";
			})
			.mockReturnValueOnce({
				artifactKind: "plan_mode_dedicated_view",
				view: "user_flow",
				title: "fixed",
				markdown: "```mermaid\nflowchart TD\nA-->B\n```",
				diagramKind: null,
			});
		mermaid.validatePlanViewMermaidArtifact.mockResolvedValue(null);
		core.getPlanModeTask.mockResolvedValue({ id: "task-1" });
		canonical.resolvePlanArtifactCanonicalInput.mockResolvedValue({
			questionnaire: null,
		});
		projection.projectPlanArtifactInput.mockReturnValue({
			version: 1,
			target: "user_flow",
			provenance,
			diagnostics: { projectionDigest: "digest", sectionBytes: {} },
		});
		renderer.renderPlanArtifactInput.mockReturnValue({
			task: "task",
			projectContext: "",
			featurePlan: "",
			questionnaire: "",
			blueprint: "",
			dataModel: "",
			prompt: "",
		});
		workspace.getPlanModeWorkspace.mockResolvedValue({ taskId: "task-1" });
		core.createPlanModeTaskMessage.mockResolvedValue({ id: "message" });
		await generatePlanViewArtifact("task-1", "user_flow");
		expect(mermaid.buildPlanViewOutputRepairContext).toHaveBeenCalledWith(
			"bad raw",
			"invalid output",
		);
		expect(core.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.not.objectContaining({
					diagramKind: expect.anything(),
				}),
			}),
		);
	});

	it("converts exhausted and provider failures into structured errors", async () => {
		structured.callStructuredOutputWithRepair.mockResolvedValue(
			generation({ bad: true }, "last raw"),
		);
		mermaid.validatePlanViewMermaidArtifact.mockResolvedValue({
			chart: "bad",
			error: "still invalid",
		});
		await expect(
			generatePlanViewArtifact("task-1", "user_flow"),
		).rejects.toMatchObject({
			code: "PLAN_VIEW_GENERATION_FAILED",
			details: { lastRawText: "last raw" },
		});

		structured.callStructuredOutputWithRepair.mockRejectedValueOnce(
			"provider offline",
		);
		await expect(
			generatePlanViewArtifact("task-1", "activity_flow"),
		).rejects.toMatchObject({
			code: "PLAN_VIEW_GENERATION_FAILED",
			details: { lastRawText: null },
		});
	});

	it("generates API contract and Zod schema artifacts", async () => {
		structured.callStructuredOutputWithRepair.mockResolvedValueOnce(
			generation({ openapi: "3.1.0" }, "api raw"),
		);
		await generatePlanViewArtifact("task-1", "api_io_contract", {
			sourceSelection: { policy: "latest_accepted" },
		});
		expect(contractParser.parsePlanApiContractOutput).toHaveBeenCalledWith(
			JSON.stringify({ openapi: "3.1.0" }),
		);
		expect(core.createPlanModeTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ messageType: "api_contract" }),
		);

		structured.callStructuredOutputWithRepair.mockResolvedValueOnce(
			generation({ schema: true }),
		);
		await generatePlanViewArtifact("task-1", "zod_schema_design");
		expect(contractParser.parsePlanZodSchemaOutput).toHaveBeenCalledWith(
			JSON.stringify({ schema: true }),
			{ sourceText: "zod evidence" },
		);
		expect(core.createPlanModeTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				messageType: "zod_schema",
				content: "const schema = z.object({});",
			}),
		);
	});

	it("wraps API, Zod, and abort failures with their own codes", async () => {
		structured.callStructuredOutputWithRepair.mockRejectedValueOnce(
			new Error("api failed"),
		);
		await expect(
			generatePlanViewArtifact("task-1", "api_io_contract"),
		).rejects.toMatchObject({
			code: "PLAN_API_CONTRACT_GENERATION_FAILED",
		});

		structured.callStructuredOutputWithRepair.mockRejectedValueOnce(
			new Error("zod failed"),
		);
		await expect(
			generatePlanViewArtifact("task-1", "zod_schema_design"),
		).rejects.toMatchObject({
			code: "PLAN_ZOD_SCHEMA_GENERATION_FAILED",
		});

		structured.callStructuredOutputWithRepair.mockResolvedValueOnce(
			generation({ ok: true }),
		);
		contractParser.parsePlanApiContractOutput.mockReturnValueOnce({
			view: "api_io_contract",
			title: "API",
			openapi: {},
		});
		const signal = {
			throwIfAborted: vi.fn(() => {
				throw new Error("aborted");
			}),
		};
		await expect(
			generatePlanViewArtifact("task-1", "api_io_contract", {
				signal: signal as never,
			}),
		).rejects.toThrow("aborted");
		expect(core.createPlanModeTaskMessage).not.toHaveBeenCalled();
	});
});
