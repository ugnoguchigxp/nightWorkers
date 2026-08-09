import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	type Row = {
		id?: string;
		content?: string | null;
		metadataJson?: Record<string, unknown> | null;
	};
	const record = (value: unknown): Record<string, unknown> | null =>
		value !== null && typeof value === "object"
			? (value as Record<string, unknown>)
			: null;
	const metadata = (message: unknown) => record(record(message)?.metadataJson);
	const latestByKind = (messages: unknown, kind: string) =>
		(Array.isArray(messages) ? [...messages] : [])
			.reverse()
			.find((message) => metadata(message)?.kind === kind) as Row | undefined;
	const findLatestBlueprintMessage = vi.fn(
		(messages: unknown, options?: { preferredMessageId?: string | null }) => {
			const rows = Array.isArray(messages) ? (messages as Row[]) : [];
			return (
				rows.find((message) => message.id === options?.preferredMessageId) ??
				latestByKind(rows, "blueprint")
			);
		},
	);
	const findLatestDataModelMessage = vi.fn((messages: unknown) =>
		latestByKind(messages, "data_model"),
	);
	const findLatestPlanViewMessage = vi.fn((messages: unknown, kind: string) =>
		latestByKind(messages, kind),
	);
	const getMetadataField = (message: unknown, field: string) =>
		record(metadata(message)?.[field]);
	const compactText = vi.fn(
		(value: unknown, limit = Number.POSITIVE_INFINITY) => {
			const text = String(value ?? "").trim();
			return text.length > limit ? text.slice(0, limit) : text;
		},
	);
	return {
		buildImplementationPlanGuidance: vi.fn(
			(context: string) => `guidance:${context}`,
		),
		compactText,
		digestText: vi.fn((content: string) => `digest:${content}`),
		extractOmittedViewDecisions: vi.fn((messages: unknown) =>
			(Array.isArray(messages) ? messages : []).flatMap((message) => {
				const omitted = metadata(message)?.omittedViews;
				return Array.isArray(omitted) ? omitted : [];
			}),
		),
		findLatestBlueprintMessage,
		findLatestDataModelMessage,
		findLatestPlanViewMessage,
		formatDesignContextKind: vi.fn((kind: string) =>
			kind.replaceAll("_", " ").toUpperCase(),
		),
		getMessageApiContract: vi.fn((message: unknown) =>
			getMetadataField(message, "apiContract"),
		),
		getMessageBlueprint: vi.fn((message: unknown) =>
			getMetadataField(message, "blueprint"),
		),
		getMessageDataModelArtifact: vi.fn((message: unknown) =>
			getMetadataField(message, "dataModel"),
		),
		getMessageZodSchema: vi.fn((message: unknown) =>
			getMetadataField(message, "zodSchema"),
		),
		isFlowViewKind: vi.fn((kind: string) =>
			["user_flow", "activity_flow", "sequence_flow"].includes(kind),
		),
		renderApiContractReference: vi.fn(
			(contract: Record<string, unknown>) =>
				`api:${String(contract.title || "untitled")}`,
		),
		renderAssembledDataModelContract: vi.fn(
			(model: Record<string, unknown>) =>
				`assembled-data:${String(model.title || "untitled")}`,
		),
		renderCompressedBlueprintNaturalLanguage: vi.fn(
			(blueprint: Record<string, unknown> | null) =>
				blueprint
					? `blueprint:${String(blueprint.name || "unnamed")}`
					: "blueprint:none",
		),
		renderDataModelDdlReference: vi.fn(
			(model: Record<string, unknown> | null) =>
				model ? `ddl:${String(model.title || "untitled")}` : "ddl:none",
		),
		renderMessageReferenceSummary: vi.fn(
			(message: Row | undefined, mode: string) =>
				message?.content ? `${mode}:${message.content}` : "",
		),
		renderPlanModeReferences: vi.fn(
			(workspace: Record<string, unknown>) =>
				`workspace:${Array.isArray(workspace.featurePlanArtifacts) ? workspace.featurePlanArtifacts.length : 0}`,
		),
		renderPlanViewReferences: vi.fn(
			(input: {
				apiContract: Record<string, unknown> | null;
				zodSchema: Record<string, unknown> | null;
			}) =>
				`views:${String(input.apiContract?.title || "none")}/${String(input.zodSchema?.schemaName || "none")}`,
		),
		renderQuestionnaireAnswerMarkdown: vi.fn(
			(session: { id: string }) => `answers:${session.id}`,
		),
		renderZodSchemaReference: vi.fn(
			(schema: Record<string, unknown>) =>
				`zod:${String(schema.schemaName || schema.title || "untitled")}`,
		),
		uniqueStrings: vi.fn((values: string[]) => [...new Set(values)]),
		workspaceArtifacts: vi.fn(
			(workspace: Record<string, unknown>, key: string) => {
				const value = workspace[key];
				return Array.isArray(value) ? value : [];
			},
		),
	};
});

vi.mock(
	"../api/modules/specification/specification-blueprint-renderer",
	() => ({
		buildImplementationPlanGuidance: mocks.buildImplementationPlanGuidance,
		renderCompressedBlueprintNaturalLanguage:
			mocks.renderCompressedBlueprintNaturalLanguage,
	}),
);
vi.mock(
	"../api/modules/specification/specification-plan-reference-renderer",
	() => ({
		extractOmittedViewDecisions: mocks.extractOmittedViewDecisions,
		formatDesignContextKind: mocks.formatDesignContextKind,
		isFlowViewKind: mocks.isFlowViewKind,
		renderAssembledDataModelContract: mocks.renderAssembledDataModelContract,
		renderDataModelDdlReference: mocks.renderDataModelDdlReference,
		renderMessageReferenceSummary: mocks.renderMessageReferenceSummary,
		renderPlanModeReferences: mocks.renderPlanModeReferences,
		renderPlanViewReferences: mocks.renderPlanViewReferences,
		workspaceArtifacts: mocks.workspaceArtifacts,
	}),
);
vi.mock(
	"../api/modules/specification/specification-schema-reference-renderer",
	() => ({
		compactText: mocks.compactText,
		digestText: mocks.digestText,
		findLatestBlueprintMessage: mocks.findLatestBlueprintMessage,
		findLatestDataModelMessage: mocks.findLatestDataModelMessage,
		findLatestPlanViewMessage: mocks.findLatestPlanViewMessage,
		getMessageApiContract: mocks.getMessageApiContract,
		getMessageBlueprint: mocks.getMessageBlueprint,
		getMessageDataModelArtifact: mocks.getMessageDataModelArtifact,
		getMessageZodSchema: mocks.getMessageZodSchema,
		renderApiContractReference: mocks.renderApiContractReference,
		renderQuestionnaireAnswerMarkdown: mocks.renderQuestionnaireAnswerMarkdown,
		renderZodSchemaReference: mocks.renderZodSchemaReference,
		uniqueStrings: mocks.uniqueStrings,
	}),
);

import {
	buildAssembledDesignContext,
	buildSpecificationDocumentContext,
	renderAssembledDesignContextMarkdown,
	sanitizeSpecificationTargetNaming,
} from "../api/modules/specification/specification-document-renderer";

const emptyWorkspace = {
	featurePlanArtifacts: [],
	blueprintArtifacts: [],
	dataModelArtifacts: [],
	dedicatedViewArtifacts: [],
	questionnaireSessions: [],
	decisionReviews: [],
	implementationReferences: [],
};

const session = {
	id: "session-1",
	questionSets: [],
	answers: [],
};

function artifact(
	id: string,
	kind: string,
	title: string,
	sourceMessageId: string,
) {
	return {
		id,
		kind,
		title,
		sourceMessageId,
		createdAt: "2026-08-09T00:00:00.000Z",
	};
}

describe("specification document renderer extra coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds a complete specification input in stable field order", () => {
		const messages = [
			{
				id: "blueprint-old",
				metadataJson: {
					kind: "blueprint",
					blueprint: { name: "Old Blueprint" },
				},
			},
			{
				id: "blueprint-preferred",
				metadataJson: {
					kind: "blueprint",
					blueprint: { name: "Preferred Blueprint" },
				},
			},
			{
				id: "data",
				metadataJson: { kind: "data_model", dataModel: { title: "Schema" } },
			},
			{
				id: "api",
				metadataJson: {
					kind: "api_io_contract",
					apiContract: { title: "HTTP" },
				},
			},
			{
				id: "zod",
				metadataJson: {
					kind: "zod_schema_design",
					zodSchema: { schemaName: "InputSchema" },
				},
			},
		];
		const result = buildSpecificationDocumentContext({
			task: {
				title: "Create feature",
				description: "A description",
				objective: "An objective",
			},
			session,
			workspace: { ...emptyWorkspace, featurePlanArtifacts: [{}] },
			messages,
			projectStackContext: "  React and API  ",
			preferredBlueprintMessageId: "blueprint-preferred",
		});

		expect(result).toMatchObject({
			task: [
				"Title: Create feature",
				"Description: A description",
				"Objective: An objective",
			].join("\n"),
			projectStackContext: "React and API",
			questionnaireDecisions: "answers:session-1",
			blueprintSummary: "blueprint:Preferred Blueprint",
			dataModelDdl: "ddl:Schema",
			planViewReferences: "views:HTTP/InputSchema",
			planModeReferences: "workspace:1",
			userRegenerationRequest: null,
			artifactInputPrompt: null,
		});
		expect(result.implementationPlanGuidance).toContain("Create feature");
		expect(result.implementationPlanGuidance).toContain(
			"blueprint:Preferred Blueprint",
		);
		expect(mocks.findLatestBlueprintMessage).toHaveBeenCalledWith(messages, {
			kind: "blueprint",
			preferredMessageId: "blueprint-preferred",
		});
	});

	it("uses all document fallbacks for an untitled task without a session", () => {
		const result = buildSpecificationDocumentContext({
			task: { title: null, description: null, objective: null },
			session: null,
			workspace: emptyWorkspace,
			messages: [],
			projectStackContext: "   ",
		});

		expect(result.task).toBe("Title: Untitled");
		expect(result.projectStackContext).toBe("Project stack は未検出です。");
		expect(result.questionnaireDecisions).toBe(
			"- Questionnaire は未生成です。",
		);
		expect(result.blueprintSummary).toBe("blueprint:none");
		expect(result.dataModelDdl).toBe("ddl:none");
		expect(result.planViewReferences).toBe("views:none/none");
	});

	it("assembles every supported section and skips invalid or empty views", () => {
		const messages = [
			{
				id: "blueprint-message",
				metadataJson: {
					kind: "blueprint",
					blueprint: { name: "Product Blueprint" },
				},
			},
			{
				id: "data-message",
				metadataJson: {
					kind: "data_model",
					dataModel: { title: "Product Data" },
				},
			},
			{
				id: "api-message",
				metadataJson: {
					kind: "api_io_contract",
					apiContract: { title: "Product API" },
				},
			},
			{
				id: "zod-message",
				metadataJson: {
					kind: "zod_schema_design",
					zodSchema: { schemaName: "ProductInput", title: "Input" },
				},
			},
			{ id: "flow-message", content: "open then save" },
			{ id: "empty-flow", content: "" },
			{ id: "review-message", content: "adopt option A" },
			{ id: "empty-review", content: null },
			{
				id: "omissions",
				metadataJson: {
					omittedViews: [{ view: "sequence_flow", reason: "not needed" }],
				},
			},
		];
		const context = buildAssembledDesignContext({
			taskId: "task-full",
			task: { title: "Product", objective: "Ship the first release" },
			session,
			workspace: {
				...emptyWorkspace,
				dedicatedViewArtifacts: [
					artifact("flow", "user_flow", "Primary Flow", "flow-message"),
					artifact("flow-empty", "activity_flow", "", "empty-flow"),
					artifact("flow-missing", "sequence_flow", "Missing", "missing"),
					artifact("not-flow", "api_io_contract", "API", "api-message"),
				],
				decisionReviews: [
					artifact("review", "decision_review", "", "review-message"),
					artifact("review-empty", "decision_review", "Empty", "empty-review"),
				],
			},
			messages,
			projectStackContext: "  TypeScript stack  ",
		});

		expect(context.questionnaireSessionId).toBe("session-1");
		expect(context.sections.map((section) => section.kind)).toEqual([
			"questionnaire",
			"blueprint",
			"data_model",
			"api_io_contract",
			"zod_schema_design",
			"user_flow",
			"decision_review",
		]);
		expect(context.sections).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "blueprint",
					title: "Product Blueprint",
					content: "blueprint:Product Blueprint",
				}),
				expect.objectContaining({
					kind: "data_model",
					title: "Product Data",
					content: "assembled-data:Product Data",
				}),
				expect.objectContaining({
					kind: "api_io_contract",
					title: "Product API",
					content: "api:Product API",
				}),
				expect.objectContaining({
					kind: "zod_schema_design",
					title: "ProductInput",
					content: "zod:ProductInput",
				}),
				expect.objectContaining({
					kind: "user_flow",
					title: "Primary Flow",
					content: "dedicated_view:open then save",
				}),
				expect.objectContaining({
					kind: "decision_review",
					title: "Decision Review",
					content: "decision_review:adopt option A",
				}),
			]),
		);
		expect(context.sourceMessageIds).toEqual([
			"blueprint-message",
			"data-message",
			"api-message",
			"zod-message",
			"flow-message",
			"review-message",
		]);
		expect(context.omittedViews).toEqual([
			{ view: "sequence_flow", reason: "not needed" },
		]);
		expect(context.warnings).toEqual([]);
		expect(context.summary).toContain("Task: Product");
		expect(context.summary).toContain("Objective: Ship the first release");
		expect(context.summary).toContain("Project: TypeScript stack");
		expect(context.summary).toContain("Omitted views: sequence_flow");
	});

	it("records missing core artifacts and uses section title fallbacks", () => {
		const missing = buildAssembledDesignContext({
			taskId: "task-empty",
			task: { title: null, objective: null },
			session: null,
			workspace: emptyWorkspace,
			messages: [],
			projectStackContext: " ",
		});
		expect(missing).toMatchObject({
			questionnaireSessionId: null,
			sections: [],
			sourceMessageIds: [],
			omittedViews: [],
			warnings: [
				"Questionnaire は未生成です。",
				"Blueprint は未生成です。",
				"Data Model は未生成です。",
			],
		});
		expect(missing.summary).toBe("Task: Untitled\nSections: none");

		const fallbackTitles = buildAssembledDesignContext({
			taskId: "task-fallbacks",
			task: { title: "Fallbacks" },
			session: null,
			workspace: emptyWorkspace,
			messages: [
				{
					id: "blueprint",
					metadataJson: { kind: "blueprint", blueprint: { id: "bp" } },
				},
				{
					id: "data",
					metadataJson: { kind: "data_model", dataModel: { id: "dm" } },
				},
				{
					id: "api",
					metadataJson: {
						kind: "api_io_contract",
						apiContract: { id: "api" },
					},
				},
				{
					id: "zod-title",
					metadataJson: {
						kind: "zod_schema_design",
						zodSchema: { title: "Title Schema" },
					},
				},
			],
		});
		expect(fallbackTitles.sections.map((section) => section.title)).toEqual([
			"Blueprint",
			"Data Model",
			"API Contract",
			"Title Schema",
		]);
	});

	it("renders optional markdown blocks, fallbacks, and source ordering", () => {
		const markdown = renderAssembledDesignContextMarkdown({
			taskId: "task-render",
			generatedAt: "2026-08-09T01:02:03.000Z",
			questionnaireSessionId: "session-render",
			summary: "Summary body",
			omittedViews: [
				{ view: "user_flow", reason: "covered elsewhere" },
				{ view: "sequence_flow" },
			],
			warnings: ["warning one", "warning two"],
			sections: [
				{
					kind: "blueprint",
					title: "Blueprint A",
					sourceMessageId: "message-a",
					digest: "digest-a",
					content: "Blueprint content",
				},
				{
					kind: "decision_review",
					title: "Review B",
					sourceMessageId: null,
					digest: null,
					content: "",
				},
			],
			sourceMessageIds: ["message-a", "message-b"],
		});

		expect(markdown).toContain("questionnaireSessionId: session-render");
		expect(markdown).toContain("- user_flow: covered elsewhere");
		expect(markdown).toContain("- sequence_flow");
		expect(markdown).toContain("## Warnings\n- warning one\n- warning two");
		expect(markdown).toContain(
			"## BLUEPRINT: Blueprint A\nsourceMessageId: message-a\ndigest: digest-a\nBlueprint content",
		);
		expect(markdown).toContain("## DECISION REVIEW: Review B\nNo content.");
		expect(markdown).toContain("## Source Messages\n- message-a\n- message-b");
		expect(markdown.indexOf("## Summary")).toBeLessThan(
			markdown.indexOf("## Omitted Views"),
		);
		expect(markdown.indexOf("## Omitted Views")).toBeLessThan(
			markdown.indexOf("## Warnings"),
		);
	});

	it("renders a minimal context with a summary fallback", () => {
		const markdown = renderAssembledDesignContextMarkdown({
			taskId: "task-minimal",
			generatedAt: "2026-08-09T00:00:00.000Z",
			questionnaireSessionId: null,
			summary: "",
			omittedViews: [],
			warnings: [],
			sections: [],
			sourceMessageIds: [],
		});

		expect(markdown).toBe(
			[
				"[Assembled Design Context]",
				"taskId: task-minimal",
				"generatedAt: 2026-08-09T00:00:00.000Z",
				"## Summary",
				"No assembled design context summary.",
			].join("\n"),
		);
	});

	it("sanitizes product naming only when NightWorkers is not the target", () => {
		expect(
			sanitizeSpecificationTargetNaming(
				"NightWorkers remains NightWorker",
				"- Project name: nightworkers",
			),
		).toBe("NightWorkers remains NightWorker");
		expect(
			sanitizeSpecificationTargetNaming(
				"NightWorkers remains",
				"Repository: /code/nightWorkers/packages/app",
			),
		).toBe("NightWorkers remains");
		expect(
			sanitizeSpecificationTargetNaming(
				"Unrelated product remains",
				"- Project name: Customer Portal",
			),
		).toBe("Unrelated product remains");
		expect(
			sanitizeSpecificationTargetNaming(
				"NightWorkers and nightworker integrations",
				"- Project name: Customer Portal",
			),
		).toBe(
			"対象プロジェクト（Customer Portal） and 対象プロジェクト（Customer Portal） integrations",
		);
		expect(
			sanitizeSpecificationTargetNaming(
				"NightWorkers integration",
				"- Project name:   ",
			),
		).toBe("対象プロジェクト integration");
	});
});
