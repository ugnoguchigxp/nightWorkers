import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	mermaidParse: vi.fn(),
	buildDataModelSystemPrompt: vi.fn(),
	buildDataModelUserPrompt: vi.fn(),
	renderDataModelArtifactMarkdown: vi.fn(),
	createStructuredGenerationAppError: vi.fn(),
	callStructuredOutputWithRepair: vi.fn(),
	createStructuredOutputContract: vi.fn(),
	parseRepairedJsonWithSchema: vi.fn(),
	normalizeStructuredOutputJsonSchema: vi.fn(),
	createPlanModeTaskMessage: vi.fn(),
	getPlanModeTask: vi.fn(),
	assertPlanModeCapabilityEnabled: vi.fn(),
	resolvePlanArtifactCanonicalInput: vi.fn(),
	projectPlanArtifactInput: vi.fn(),
	buildPlanArtifactPromptBudgetMetadata: vi.fn(),
	renderPlanArtifactInput: vi.fn(),
	createPlanArtifactSourceSelection: vi.fn(),
	getPlanModeWorkspace: vi.fn(),
	assertPlanModeMutable: vi.fn(),
}));

vi.mock("mermaid", () => ({
	default: { parse: mocks.mermaidParse },
}));

vi.mock("../api/services/structured-generation/prompts/data-model", () => ({
	buildDataModelSystemPrompt: mocks.buildDataModelSystemPrompt,
	buildDataModelUserPrompt: mocks.buildDataModelUserPrompt,
	DATA_MODEL_PROMPT_VERSION: "test-data-model-v1",
	renderDataModelArtifactMarkdown: mocks.renderDataModelArtifactMarkdown,
}));

vi.mock(
	"../api/services/structured-generation/structured-generation-error",
	() => ({
		createStructuredGenerationAppError:
			mocks.createStructuredGenerationAppError,
	}),
);

vi.mock(
	"../api/services/structured-generation/structured-output-repair.service",
	() => ({
		callStructuredOutputWithRepair: mocks.callStructuredOutputWithRepair,
	}),
);

vi.mock("../api/services/structured-llm", () => ({
	createStructuredOutputContract: mocks.createStructuredOutputContract,
}));

vi.mock("../api/services/structured-llm/json", () => ({
	parseRepairedJsonWithSchema: mocks.parseRepairedJsonWithSchema,
}));

vi.mock("../api/services/structured-llm/json-schema", () => ({
	normalizeStructuredOutputJsonSchema:
		mocks.normalizeStructuredOutputJsonSchema,
}));

vi.mock("../api/modules/nightworkers/nightworkers.plan-mode-core.port", () => ({
	createPlanModeTaskMessage: mocks.createPlanModeTaskMessage,
	getPlanModeTask: mocks.getPlanModeTask,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.plan-mode-settings.service",
	() => ({
		assertPlanModeCapabilityEnabled: mocks.assertPlanModeCapabilityEnabled,
	}),
);

vi.mock(
	"../api/modules/specification/plan-artifact-input-context.service",
	() => ({
		resolvePlanArtifactCanonicalInput: mocks.resolvePlanArtifactCanonicalInput,
	}),
);

vi.mock(
	"../api/modules/specification/plan-artifact-input-projection",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../api/modules/specification/plan-artifact-input-projection")
		>()),
		projectPlanArtifactInput: mocks.projectPlanArtifactInput,
	}),
);

vi.mock("../api/modules/specification/plan-artifact-input-renderer", () => ({
	buildPlanArtifactPromptBudgetMetadata:
		mocks.buildPlanArtifactPromptBudgetMetadata,
	PLAN_ARTIFACT_GENERATION_TIMEOUT_MS: 12_345,
	renderPlanArtifactInput: mocks.renderPlanArtifactInput,
}));

vi.mock("../api/modules/specification/plan-artifact-source-selection", () => ({
	createPlanArtifactSourceSelection: mocks.createPlanArtifactSourceSelection,
}));

vi.mock("../api/modules/specification/plan-mode-workspace.service", () => ({
	getPlanModeWorkspace: mocks.getPlanModeWorkspace,
}));

vi.mock("../api/modules/specification/specification-mutability", () => ({
	assertPlanModeMutable: mocks.assertPlanModeMutable,
}));

import {
	buildDataModelResponseJsonSchema,
	DataModelGenerationError,
	generateDataModelArtifact,
	parseDataModelOutput,
} from "../api/modules/dataModel/dataModel-generation.service";

const task = {
	id: "task-1",
	repositoryId: "repository-1",
	title: "Data Model Task",
};

const sourceSelection = {
	policy: "explicit_request",
	featurePlanMessageId: "feature-message",
	blueprintMessageId: "blueprint-message",
};

const canonical = {
	task,
	questionnaire: { sessionId: "questionnaire-1" },
};

const projection = {
	version: 2,
	target: "data_model",
	diagnostics: {
		projectionDigest: "projection-digest",
		sectionBytes: { task: 100, featurePlan: 200 },
	},
	provenance: {
		contextRevision: 3,
		contextDigest: "context-digest",
		routingRevision: 4,
		questionnaireDigest: "questionnaire-digest",
		sourceMessageIds: ["source-1", "source-2"],
		sourceDigests: { "source-1": "digest-1" },
	},
};

const renderedInput = {
	task: "rendered task",
	projectContext: "rendered project",
	featurePlan: "rendered feature plan",
	questionnaire: "rendered questionnaire",
	blueprint: "rendered blueprint",
	regenerationRequest: "rendered regeneration request",
	prompt: "rendered projection prompt",
};

const minimalArtifact = {
	artifactKind: "plan_mode_dedicated_view",
	view: "data_model",
	title: "Generated Data Model",
	summary: "A generated model",
	canonicalSource: "json_shape",
	derivedTables: [],
	relations: [],
	constraints: [],
	openQuestions: [],
};

function generated(value: unknown, rawText = "raw provider output") {
	return { value, attempts: [{ rawText }] };
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.mermaidParse.mockResolvedValue(true);
	mocks.buildDataModelSystemPrompt.mockImplementation(
		(schema: string) => `system:${schema}`,
	);
	mocks.buildDataModelUserPrompt.mockImplementation(
		(input: { repairContext?: string | null }) =>
			`user:${input.repairContext ?? "initial"}`,
	);
	mocks.renderDataModelArtifactMarkdown.mockReturnValue(
		"# Generated Data Model",
	);
	mocks.createStructuredGenerationAppError.mockImplementation(
		(input: {
			code: string;
			fallbackMessage: string;
			error: unknown;
			lastRawText: string | null;
		}) =>
			Object.assign(new Error(input.fallbackMessage), {
				code: input.code,
				cause: input.error,
				lastRawText: input.lastRawText,
			}),
	);
	mocks.callStructuredOutputWithRepair.mockResolvedValue(
		generated(minimalArtifact),
	);
	mocks.createStructuredOutputContract.mockReturnValue({ name: "contract" });
	mocks.normalizeStructuredOutputJsonSchema.mockImplementation(
		(schema: unknown) => ({ normalized: true, schema }),
	);
	mocks.getPlanModeTask.mockResolvedValue(task);
	mocks.resolvePlanArtifactCanonicalInput.mockResolvedValue(canonical);
	mocks.projectPlanArtifactInput.mockReturnValue(projection);
	mocks.renderPlanArtifactInput.mockReturnValue(renderedInput);
	mocks.buildPlanArtifactPromptBudgetMetadata.mockReturnValue({ budget: true });
	mocks.createPlanArtifactSourceSelection.mockReturnValue(sourceSelection);
	mocks.createPlanModeTaskMessage.mockResolvedValue({ id: "message-1" });
	mocks.getPlanModeWorkspace.mockResolvedValue({ id: "workspace-1" });
});

describe("data model generation service extra coverage", () => {
	it("reports parser failures and preserves raw provider output", () => {
		mocks.parseRepairedJsonWithSchema
			.mockReturnValueOnce({ ok: false })
			.mockReturnValueOnce({ ok: false });
		expect(() => parseDataModelOutput("not-json")).toThrow(
			"did not contain valid JSON",
		);
		try {
			parseDataModelOutput("not-json-again");
		} catch (error) {
			expect(error).toBeInstanceOf(DataModelGenerationError);
		}

		mocks.parseRepairedJsonWithSchema.mockReturnValueOnce({
			ok: true,
			value: { ...minimalArtifact, canonicalSource: "ddl", ddl: "   " },
		});
		expect(() => parseDataModelOutput("ddl-without-body")).toThrow(
			"must include ddl",
		);

		mocks.parseRepairedJsonWithSchema.mockReturnValueOnce({
			ok: true,
			value: minimalArtifact,
		});
		expect(parseDataModelOutput("valid")).toBe(minimalArtifact);
		expect(new DataModelGenerationError("custom").rawOutput).toBeUndefined();
		expect(new DataModelGenerationError("custom", "raw")).toMatchObject({
			name: "DataModelGenerationError",
			message: "custom",
			rawOutput: "raw",
		});
	});

	it("builds and normalizes the provider response schema", () => {
		const schema = buildDataModelResponseJsonSchema();
		expect(schema).toMatchObject({ normalized: true });
		expect(mocks.normalizeStructuredOutputJsonSchema).toHaveBeenCalledOnce();
	});

	it("validates Task existence, capability, and mutability before generation", async () => {
		mocks.getPlanModeTask.mockResolvedValueOnce(null);
		await expect(generateDataModelArtifact("missing")).rejects.toMatchObject({
			statusCode: 404,
		});

		mocks.assertPlanModeCapabilityEnabled.mockImplementationOnce(() => {
			throw new Error("capability disabled");
		});
		await expect(generateDataModelArtifact(task.id)).rejects.toThrow(
			"capability disabled",
		);

		mocks.assertPlanModeMutable.mockImplementationOnce(() => {
			throw new Error("revision conflict");
		});
		await expect(generateDataModelArtifact(task.id)).rejects.toThrow(
			"revision conflict",
		);
		expect(mocks.callStructuredOutputWithRepair).not.toHaveBeenCalled();
	});

	it("generates, validates, persists, and returns the default artifact lifecycle", async () => {
		await expect(generateDataModelArtifact(task.id)).resolves.toEqual({
			message: { id: "message-1" },
			workspace: { id: "workspace-1" },
		});
		expect(mocks.createPlanArtifactSourceSelection).toHaveBeenCalledWith({
			policy: "explicit_request",
		});
		expect(mocks.resolvePlanArtifactCanonicalInput).toHaveBeenCalledWith({
			taskId: task.id,
			target: "data_model",
			questionnaireSessionId: null,
			sourceSelection,
			regenerationRequest: null,
		});
		expect(mocks.callStructuredOutputWithRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					taskId: task.id,
					runId: null,
					role: "plan",
					routeOverride: null,
					timeoutMs: 12_345,
				}),
			}),
		);
		expect(mocks.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				content: "# Generated Data Model",
				payloadJson: expect.objectContaining({
					title: minimalArtifact.title,
					featurePlanMessageId: null,
					questionnaireSessionId: "questionnaire-1",
					sourceBlueprintMessageId: null,
					sourceMessageIds: ["source-1", "source-2"],
					generation: {
						promptVersion: "test-data-model-v1",
						inputProjection: expect.objectContaining({
							version: 2,
							digest: "projection-digest",
							questionnaireSessionId: "questionnaire-1",
						}),
					},
				}),
			}),
		);
	});

	it("forwards explicit sources, provider policy, trace, role, and abort signal", async () => {
		const signal = { throwIfAborted: vi.fn() };
		const routeOverride = {
			providerEndpointId: "provider-1",
			model: "model-1",
		};
		const executionPolicy = { allowFallback: false };
		const trace = {
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
		};
		await generateDataModelArtifact(task.id, {
			prompt: "regenerate this",
			questionnaireSessionId: "requested-questionnaire",
			sourceSelection,
			routeOverride,
			role: "review",
			executionPolicy: executionPolicy as never,
			trace: trace as never,
			llmUsageTrace: trace as never,
			signal: signal as never,
		});
		expect(mocks.resolvePlanArtifactCanonicalInput).toHaveBeenCalledWith(
			expect.objectContaining({
				questionnaireSessionId: "requested-questionnaire",
				sourceSelection,
				regenerationRequest: "regenerate this",
			}),
		);
		expect(mocks.callStructuredOutputWithRepair).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					role: "review",
					executionPolicy,
					usageTrace: trace,
					routeOverride,
					signal,
				}),
			}),
		);
		expect(signal.throwIfAborted).toHaveBeenCalledOnce();
		expect(mocks.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				trace,
				payloadJson: expect.objectContaining({
					featurePlanMessageId: "feature-message",
					sourceBlueprintMessageId: "blueprint-message",
				}),
			}),
		);
	});

	it("uses empty prompt and questionnaire metadata fallbacks", async () => {
		mocks.resolvePlanArtifactCanonicalInput.mockResolvedValueOnce({ task });
		mocks.renderPlanArtifactInput.mockReturnValueOnce({
			...renderedInput,
			regenerationRequest: null,
		});
		await generateDataModelArtifact(task.id);
		expect(mocks.buildDataModelUserPrompt).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "" }),
		);
		expect(mocks.createPlanModeTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					questionnaireSessionId: null,
					generation: {
						promptVersion: "test-data-model-v1",
						inputProjection: expect.objectContaining({
							questionnaireSessionId: null,
						}),
					},
				}),
			}),
		);
	});

	it("does not persist when aborted after provider generation", async () => {
		const abortError = new Error("aborted");
		const signal = {
			throwIfAborted: vi.fn(() => {
				throw abortError;
			}),
		};
		await expect(
			generateDataModelArtifact(task.id, { signal: signal as never }),
		).rejects.toBe(abortError);
		expect(mocks.createPlanModeTaskMessage).not.toHaveBeenCalled();
	});

	it("preserves repository conflicts and workspace failures after generation", async () => {
		const conflict = Object.assign(new Error("message revision conflict"), {
			code: "REVISION_CONFLICT",
		});
		mocks.createPlanModeTaskMessage.mockRejectedValueOnce(conflict);
		await expect(generateDataModelArtifact(task.id)).rejects.toBe(conflict);

		mocks.getPlanModeWorkspace.mockRejectedValueOnce(
			new Error("workspace unavailable"),
		);
		await expect(generateDataModelArtifact(task.id)).rejects.toThrow(
			"workspace unavailable",
		);
	});

	it("repairs a missing DDL using raw-output context and JSON fallback", async () => {
		const invalidDdl = {
			...minimalArtifact,
			canonicalSource: "ddl",
			ddl: " ",
		};
		const validDdl = {
			...invalidDdl,
			ddl: "CREATE TABLE items (id TEXT PRIMARY KEY);",
		};
		mocks.callStructuredOutputWithRepair
			.mockResolvedValueOnce(generated(invalidDdl, "invalid ddl raw"))
			.mockResolvedValueOnce({ value: validDdl, attempts: [] });
		await generateDataModelArtifact(task.id);
		expect(mocks.callStructuredOutputWithRepair).toHaveBeenCalledTimes(2);
		expect(mocks.buildDataModelUserPrompt).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				repairContext: expect.stringContaining("DDL-backed Data Model output"),
			}),
		);
		expect(mocks.buildDataModelUserPrompt).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				repairContext: expect.stringContaining("invalid ddl raw"),
			}),
		);
	});

	it("repairs invalid Mermaid and renders table, key, relation, and sanitizer variants", async () => {
		const complexArtifact = {
			...minimalArtifact,
			derivedTables: [
				{
					name: "",
					purpose: "fallback table",
					columns: [],
					indexes: [],
				},
				{
					name: "123 weird--table",
					purpose: "typed table",
					columns: [
						{
							name: "foreign id",
							type: "9 odd type",
							nullable: false,
							primaryKey: true,
							unique: true,
							defaultValue: "now()",
						},
						{
							name: "",
							type: "   ",
							nullable: true,
							primaryKey: false,
							unique: false,
							defaultValue: null,
						},
						{
							name: "plain",
							type: "TEXT",
							nullable: true,
							primaryKey: false,
							unique: false,
							defaultValue: null,
						},
					],
					indexes: [],
				},
			],
			relations: [
				{
					from: "123 weird--table.foreign id",
					to: "missing.target",
					cardinality: "one_to_one",
					reason: 'one: "quoted" relation',
				},
				{
					from: "123 weird--table.foreign id",
					to: "table_without_column",
					cardinality: "one_to_many",
					reason: "",
				},
				{
					from: "unknown.id",
					to: "123 weird--table.foreign id",
					cardinality: "many_to_one",
					reason:
						"many words for a very long relationship label that is truncated after ten words exactly",
				},
				{
					from: "unknown.id",
					to: "other.id",
					cardinality: "many_to_many",
					reason: "many",
				},
				{
					from: "unknown",
					to: "other",
					cardinality: "unsupported",
					reason: "   ",
				},
				{
					from: "",
					to: "",
					cardinality: "unsupported",
					reason: "fallback",
				},
			],
		};
		mocks.callStructuredOutputWithRepair.mockResolvedValue(
			generated(complexArtifact),
		);
		mocks.mermaidParse
			.mockRejectedValueOnce(new Error("Mermaid parse failed"))
			.mockResolvedValueOnce(true);
		await generateDataModelArtifact(task.id);
		expect(mocks.mermaidParse).toHaveBeenCalledTimes(2);
		const chart = mocks.mermaidParse.mock.calls[0]?.[0] as string;
		expect(chart).toContain("table_1");
		expect(chart).toContain("string no_columns");
		expect(chart).toContain("_123_weird_table");
		expect(chart).toContain("PK, FK, UK");
		expect(chart).toContain("not null, default now()");
		expect(chart).toContain("||--||");
		expect(chart).toContain("||--o{");
		expect(chart).toContain("}o--||");
		expect(chart).toContain("}o--o{");
		expect(chart).toContain(" -- ");
		expect(mocks.buildDataModelUserPrompt).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				repairContext: expect.stringContaining("Previous Mermaid source"),
			}),
		);
	});

	it("wraps exhausted Mermaid failures including primitive parse errors", async () => {
		const artifact = {
			...minimalArtifact,
			derivedTables: [{ name: "items", columns: [], indexes: [] }],
		};
		mocks.callStructuredOutputWithRepair.mockResolvedValue(generated(artifact));
		mocks.mermaidParse.mockRejectedValue("primitive mermaid failure");
		await expect(generateDataModelArtifact(task.id)).rejects.toMatchObject({
			code: "DATA_MODEL_GENERATION_FAILED",
			lastRawText: "raw provider output",
		});
		expect(mocks.createStructuredGenerationAppError).toHaveBeenCalledWith(
			expect.objectContaining({
				fallbackMessage: "Data Model generation failed.",
				lastRawText: "raw provider output",
			}),
		);
	});

	it("wraps provider exceptions before any raw text is available", async () => {
		mocks.callStructuredOutputWithRepair.mockRejectedValueOnce(
			new Error("provider unavailable"),
		);
		await expect(generateDataModelArtifact(task.id)).rejects.toMatchObject({
			code: "DATA_MODEL_GENERATION_FAILED",
			lastRawText: null,
		});
	});

	it("uses the generic generation error when validation throws primitives", async () => {
		const primitiveThrowingArtifact = {} as Record<string, unknown>;
		Object.defineProperty(primitiveThrowingArtifact, "canonicalSource", {
			get() {
				throw "primitive validation failure";
			},
		});
		mocks.callStructuredOutputWithRepair.mockResolvedValue({
			value: primitiveThrowingArtifact,
			attempts: [],
		});
		await expect(generateDataModelArtifact(task.id)).rejects.toMatchObject({
			code: "DATA_MODEL_GENERATION_FAILED",
		});
		expect(mocks.createStructuredGenerationAppError).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.objectContaining({
					message: "Data Model generation failed.",
				}),
			}),
		);
	});
});
