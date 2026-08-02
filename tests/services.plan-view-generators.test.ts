import { describe, expect, it } from "vitest";
import { planApiContractOpenApiSchema } from "../api/modules/planViews/plan-api-contract-openapi";
import {
	buildClientMermaidRepairPrompt,
	normalizePlanViewMermaidArtifact,
	parseGenericDedicatedViewOutput,
	parsePlanApiContractOutput,
	parsePlanZodSchemaOutput,
	validatePlanViewMermaidArtifact,
} from "../api/modules/planViews/planView-generation.service";
import { planViewGenerateRequestSchema } from "../api/modules/planViews/planView-route-definitions";
import {
	buildPlanApiContractUserPrompt,
	planApiContractStructuredOutputSchema,
} from "../api/services/structured-generation/prompts/plan-api-contract";
import {
	buildPlanDedicatedViewUserPrompt,
	genericDedicatedViewSchema,
} from "../api/services/structured-generation/prompts/plan-dedicated-view";
import { planZodSchemaStructuredOutputSchema } from "../api/services/structured-generation/prompts/plan-zod-schema";
import { resolveCodexOutputSchemaMode } from "../api/services/structured-llm/codex-output-schema";
import { planApiContractArtifactSchema } from "../shared/schemas/plan-mode-artifact.schema";

function createMinimalOpenApiDocument() {
	return {
		openapi: "3.1.0",
		info: {
			title: "Task API Contract",
			version: "0.1.0",
			summary: "Task retrieval contract.",
		},
		paths: {
			"/api/tasks/{taskId}": {
				get: {
					operationId: "getTask",
					summary: "Get task",
					tags: ["tasks"],
					parameters: [
						{
							name: "taskId",
							in: "path",
							required: true,
							description: "Task identifier",
							schema: { type: "string", format: "uuid" },
						},
					],
					responses: {
						"200": {
							description: "Task response",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/Task" },
								},
							},
						},
					},
				},
			},
		},
		components: {
			schemas: {
				Task: {
					type: "object",
					additionalProperties: false,
					required: ["id"],
					properties: { id: { type: "string", format: "uuid" } },
				},
			},
		},
	};
}

describe("Plan View generation helpers", () => {
	it("uses direct OpenAPI JSON and prompt validation for dynamic endpoint keys", () => {
		expectStrictRequiredProperties(genericDedicatedViewSchema);
		expectStrictRequiredProperties(planZodSchemaStructuredOutputSchema);
		expectNoFreeObjects(planZodSchemaStructuredOutputSchema);
		const serialized = JSON.stringify(planApiContractStructuredOutputSchema);
		expect(serialized).toContain('"openapi"');
		expect(serialized).toContain('"paths"');
		expect(serialized).toContain('"components"');
		expect(serialized).not.toContain('"operations"');
		expect(serialized).not.toContain("schemaJson");
		expect(serialized).not.toContain("stateTransitions");
		expect(
			resolveCodexOutputSchemaMode(planApiContractStructuredOutputSchema).mode,
		).toBe("prompt_validated_json");
	});

	it("includes project stack context in API Contract input", () => {
		const prompt = buildPlanApiContractUserPrompt({
			task: "Title: API",
			projectStackContext:
				"- 既存 Project stack: TypeScript + React + Vite + Hono",
			featurePlan: "Feature Plan は未生成です。",
			questionnaire: "Questionnaire は未生成です。",
			blueprint: "Blueprint は未生成です。",
			dataModel: "Data Model は未生成です。",
			prompt: "API contract を作る",
		});

		expect(prompt).toContain("## Project Stack Context");
		expect(prompt).toContain("TypeScript + React + Vite + Hono");
	});

	it("includes Mermaid repair context in Plan View input", () => {
		const prompt = buildPlanDedicatedViewUserPrompt({
			view: "user_flow",
			task: "Title: Checkout",
			featurePlan: "Feature Plan",
			questionnaire: "Questionnaire",
			blueprint: "Blueprint",
			dataModel: "Data Model",
			prompt: "User Flow を作る",
			repairContext:
				"Parse error on line 2\n```mermaid\nflowchart TD\n  A -->\n```",
		});

		expect(prompt).toContain("## Mermaid Parse Repair");
		expect(prompt).toContain("Parse error on line 2");
		expect(prompt).toContain("最小修正");
	});

	it("builds a client render repair prompt with the error and previous chart", () => {
		const prompt = buildClientMermaidRepairPrompt({
			sourceMessageId: "9785b143-06a6-4b72-b285-14f1e8a4f9d5",
			stage: "chart_render",
			error: "Parse error on line 3",
			chart: 'flowchart TD\n  A["User"] --> B["Details"]',
		});

		expect(prompt).toContain("失敗段階: chart_render");
		expect(prompt).toContain("Parse error on line 3");
		expect(prompt).toContain('A["User"] --> B["Details"]');
		expect(prompt).toContain("最小修正");
	});

	it("accepts chart failures and rejects UI-only failures in the repair contract", () => {
		const baseRepair = {
			sourceMessageId: "9785b143-06a6-4b72-b285-14f1e8a4f9d5",
			error: "render failed",
			chart: "flowchart TD\n  A --> B",
		};
		expect(
			planViewGenerateRequestSchema.safeParse({
				mermaidRenderRepair: { ...baseRepair, stage: "chart_render" },
			}).success,
		).toBe(true);
		expect(
			planViewGenerateRequestSchema.safeParse({
				mermaidRenderRepair: { ...baseRepair, stage: "svg_import" },
			}).success,
		).toBe(false);
	});

	it("accepts User Flow Mermaid flowchart artifacts", () => {
		const artifact = parseGenericDedicatedViewOutput(
			JSON.stringify({
				artifactKind: "plan_mode_dedicated_view",
				view: "user_flow",
				title: "Checkout User Flow",
				markdown:
					"```mermaid\nflowchart TD\n  OpenCheckout[Open checkout] --> SubmitPayment[Submit payment]\n```",
				diagramKind: "flowchart",
			}),
			"user_flow",
		);

		expect(artifact.view).toBe("user_flow");
		expect(artifact.diagramKind).toBe("flowchart");
	});

	it("sanitizes Markdown syntax inside generated flowchart labels before saving", () => {
		const artifact = normalizePlanViewMermaidArtifact({
			artifactKind: "plan_mode_dedicated_view",
			view: "user_flow",
			title: "User Flow",
			markdown:
				'```mermaid\nflowchart TD\n  step29["`styles.css` で共通の余白、見出し間隔、ボタン優先度を調整する"]\n```',
			diagramKind: "flowchart",
		});

		expect(artifact.markdown).toContain("styles.css");
		expect(artifact.markdown).not.toContain("`styles.css`");
	});

	it("validates labeled User Flow flowcharts without invoking DOMPurify-only parse paths", async () => {
		const artifact = normalizePlanViewMermaidArtifact({
			artifactKind: "plan_mode_dedicated_view",
			view: "user_flow",
			title: "Checkout User Flow",
			markdown: [
				"```mermaid",
				"flowchart TD",
				"  subgraph shopper [Shopper]",
				"    entry[Open checkout] -->|clicks pay| review[[Review order]]",
				"  end",
				'  review -- confirms payment --> complete@{ shape: rect, label: "Payment complete" }',
				"```",
			].join("\n"),
			diagramKind: "flowchart",
		});

		await expect(validatePlanViewMermaidArtifact(artifact)).resolves.toBeNull();
		expect(artifact.markdown).toContain("Open checkout");
		expect(artifact.markdown).toContain("clicks pay");
	});

	it("rejects User Flow Markdown-only artifacts", () => {
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "user_flow",
					title: "Checkout User Flow",
					markdown:
						"# Checkout User Flow\n\n1. User opens checkout.\n2. User submits payment.",
					diagramKind: null,
				}),
				"user_flow",
			),
		).toThrow("Mermaid diagram");
	});

	it("accepts minimal OpenAPI 3.1 JSON and builds the existing artifact", () => {
		const artifact = parsePlanApiContractOutput(
			JSON.stringify(createMinimalOpenApiDocument()),
		);

		expect(artifact.artifactKind).toBe("plan_mode_api_contract");
		expect(artifact.view).toBe("api_io_contract");
		expect(artifact.title).toBe("Task API Contract");
		expect(artifact.summary).toBe("Task retrieval contract.");
		expect(artifact.openapi.openapi).toBe("3.1.0");
		expect(
			artifact.openapi.paths["/api/tasks/{taskId}"]?.get?.operationId,
		).toBe("getTask");
		expect(artifact.stateTransitions).toEqual([]);
		expect(artifact.validation).toBeUndefined();
	});

	it("validates minimal OpenAPI without adding fields that trigger repair", () => {
		const document = createMinimalOpenApiDocument();
		const { tags: _tags, ...operationWithoutTags } =
			document.paths["/api/tasks/{taskId}"].get;
		const minimalDocument = {
			...document,
			paths: {
				"/api/tasks/{taskId}": { get: operationWithoutTags },
			},
		};
		const parsed = planApiContractOpenApiSchema.safeParse(minimalDocument);

		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data).toEqual(minimalDocument);
	});

	it("continues to read legacy API Contract validation metadata", () => {
		const artifact = parsePlanApiContractOutput(
			JSON.stringify(createMinimalOpenApiDocument()),
		);
		const legacyArtifact = planApiContractArtifactSchema.parse({
			...artifact,
			validation: [
				{
					schemaName: "Task",
					owner: "response",
					strictness: "strict",
					examples: [],
				},
			],
		});

		expect(legacyArtifact.validation).toEqual([
			expect.objectContaining({ schemaName: "Task", owner: "response" }),
		]);
	});

	it("preserves direct OpenAPI request, response, schema, and security objects", () => {
		const document = createMinimalOpenApiDocument();
		const getTask = document.paths["/api/tasks/{taskId}"].get;
		const requestBody = {
			required: true,
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/TaskRequest" },
				},
			},
		};
		Object.assign(getTask, { requestBody });
		Object.assign(document.components.schemas, {
			TaskRequest: {
				type: "object",
				additionalProperties: false,
				required: ["title"],
				properties: { title: { type: "string", minLength: 1 } },
			},
		});
		Object.assign(document.components, {
			securitySchemes: {
				bearerAuth: { type: "http", scheme: "bearer" },
			},
		});
		const directDocument = {
			...document,
			security: [{ bearerAuth: [] }],
		};
		const artifact = parsePlanApiContractOutput(JSON.stringify(directDocument));

		expect(
			artifact.openapi.paths["/api/tasks/{taskId}"]?.get?.requestBody,
		).toEqual(requestBody);
		expect(artifact.openapi.components.securitySchemes).toEqual({
			bearerAuth: { type: "http", scheme: "bearer" },
		});
		expect(artifact.openapi.security).toEqual([{ bearerAuth: [] }]);
		expect(artifact.validation).toBeUndefined();
	});

	it("rejects invalid and unresolved JSON Schema objects", () => {
		const invalidType = createMinimalOpenApiDocument();
		Object.assign(invalidType.components.schemas.Task, { type: "strng" });
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(invalidType)),
		).toThrow("not a valid JSON Schema type");

		const unresolved = createMinimalOpenApiDocument();
		Object.assign(
			unresolved.paths["/api/tasks/{taskId}"].get.responses["200"].content[
				"application/json"
			].schema,
			{ $ref: "#/components/schemas/MissingTask" },
		);
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(unresolved)),
		).toThrow("references unknown schema: MissingTask");
	});

	it("preserves response text and accepts local JSON Pointer subpaths", () => {
		const document = createMinimalOpenApiDocument();
		Object.assign(document.components.schemas, {
			TaskId: { $ref: "#/components/schemas/Task/properties/id" },
		});
		document.paths["/api/tasks/{taskId}"].get.responses["200"] = {
			description: "Task identifier",
			content: {
				"application/json": {
					schema: { $ref: "#/components/schemas/TaskId" },
				},
			},
		};
		const artifact = parsePlanApiContractOutput(JSON.stringify(document));

		expect(
			artifact.openapi.paths["/api/tasks/{taskId}"]?.get?.responses["200"],
		).toMatchObject({ description: "Task identifier" });
		expect(artifact.openapi.components.schemas.TaskId).toEqual({
			$ref: "#/components/schemas/Task/properties/id",
		});
	});

	it("rejects contradictory OpenAPI path, method, response, and operation invariants", () => {
		const emptyPathItem = createMinimalOpenApiDocument();
		emptyPathItem.paths["/api/tasks/{taskId}"] = {} as never;
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(emptyPathItem)),
		).toThrow("valid OpenAPI 3.1 document");

		const optionalPathParameter = createMinimalOpenApiDocument();
		optionalPathParameter.paths[
			"/api/tasks/{taskId}"
		].get.parameters[0].required = false;
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(optionalPathParameter)),
		).toThrow("path parameter must be required");

		const missingPathParameter = createMinimalOpenApiDocument();
		missingPathParameter.paths["/api/tasks/{taskId}"].get.parameters = [];
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(missingPathParameter)),
		).toThrow("is missing path parameter");

		const missingParameterSchema = createMinimalOpenApiDocument();
		Object.assign(
			missingParameterSchema.paths["/api/tasks/{taskId}"].get.parameters[0],
			{ schema: undefined },
		);
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(missingParameterSchema)),
		).toThrow("requires a schema");

		const invalidStatus = createMinimalOpenApiDocument();
		invalidStatus.paths["/api/tasks/{taskId}"].get.responses = {
			"20": { description: "Invalid" },
		};
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(invalidStatus)),
		).toThrow("invalid response status");

		const invalidResponseContent = createMinimalOpenApiDocument();
		Object.assign(
			invalidResponseContent.paths["/api/tasks/{taskId}"].get.responses["200"],
			{ content: {} },
		);
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(invalidResponseContent)),
		).toThrow("requires content.application/json.schema");

		const duplicateOperation = createMinimalOpenApiDocument();
		Object.assign(duplicateOperation.paths, {
			"/api/tasks": {
				get: {
					operationId: "getTask",
					responses: { "200": { description: "Task list" } },
				},
			},
		});
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(duplicateOperation)),
		).toThrow("Duplicate operationId");

		const unsupportedMethod = createMinimalOpenApiDocument();
		Object.assign(unsupportedMethod.paths["/api/tasks/{taskId}"], {
			trace: unsupportedMethod.paths["/api/tasks/{taskId}"].get,
		});
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(unsupportedMethod)),
		).toThrow("Unsupported OpenAPI operation method");

		const unknownSecurityScheme = createMinimalOpenApiDocument();
		const securedDocument = {
			...unknownSecurityScheme,
			security: [{ missingAuth: [] }],
		};
		expect(() =>
			parsePlanApiContractOutput(JSON.stringify(securedDocument)),
		).toThrow("references unknown security scheme: missingAuth");
	});

	it("rejects the removed DSL and artifact wrappers", () => {
		expect(() =>
			parsePlanApiContractOutput(
				JSON.stringify({
					title: "Task API Contract",
					operations: [],
					schemas: [],
				}),
			),
		).toThrow("valid OpenAPI 3.1 document");
		expect(() =>
			parsePlanApiContractOutput(
				JSON.stringify({
					artifactKind: "plan_mode_api_contract",
					view: "api_io_contract",
					openapi: createMinimalOpenApiDocument(),
				}),
			),
		).toThrow("valid OpenAPI 3.1 document");
	});

	it("rejects unsupported diagrams", () => {
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "activity_flow",
					title: "Invalid Flow",
					markdown: `\`\`\`mermaid\n${"use" + "case"}Diagram\n  actor User\n\`\`\``,
					diagramKind: "flowchart",
				}),
				"activity_flow",
			),
		).toThrow("not allowed");
	});

	it("rejects Activity Flow Markdown-only artifacts", () => {
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "activity_flow",
					title: "Activity Flow",
					markdown: "# Activity Flow\n\n- Validate input\n- Save task",
					diagramKind: null,
				}),
				"activity_flow",
			),
		).toThrow("Mermaid diagram");
	});

	it("requires diagramKind when a diagram view returns Mermaid", () => {
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "sequence_flow",
					title: "Sequence Flow",
					markdown: "```mermaid\nsequenceDiagram\n  User->>API: submit\n```",
				}),
				"sequence_flow",
			),
		).toThrow("diagramKind");
	});

	it("rejects Sequence Flow Markdown-only artifacts", () => {
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "sequence_flow",
					title: "Sequence Flow",
					markdown:
						"# Sequence Flow\n\n- User submits request\n- API returns response",
					diagramKind: null,
				}),
				"sequence_flow",
			),
		).toThrow("Mermaid diagram");
	});

	it("normalizes Zod schema source into form fields and validation rules", () => {
		const artifact = parsePlanZodSchemaOutput(
			JSON.stringify({
				artifactKind: "plan_mode_zod_schema",
				view: "zod_schema_design",
				title: "Tool Input Schema",
				summary: "Worker tool input validation.",
				schemaName: "CreateTodoToolInputSchema",
				owner: "worker_tool_input",
				zodSource:
					'const CreateTodoToolInputSchema = z.object({ title: z.string().min(1).max(80).describe("Todo title"), priority: z.enum(["low", "normal", "high"]).default("normal"), retryCount: z.number().int().min(0).max(3).optional(), dryRun: z.boolean().default(false) }).strict();',
				openQuestions: [],
			}),
		);

		expect(artifact.view).toBe("zod_schema_design");
		expect(artifact.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "title",
					type: "string",
					required: true,
					description: "Todo title",
				}),
				expect.objectContaining({
					name: "priority",
					type: "enum",
					required: false,
					enumOptions: ["low", "normal", "high"],
					defaultValue: "normal",
				}),
				expect.objectContaining({
					name: "retryCount",
					type: "number",
					required: false,
				}),
			]),
		);
		expect(
			artifact.fields.find((field) => field.name === "title")?.rules,
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "min", args: [1] }),
				expect.objectContaining({ name: "max", args: [80] }),
			]),
		);
	});

	it("normalizes referenced and nested Zod schema fields without treating them as unknown input", () => {
		const artifact = parsePlanZodSchemaOutput(
			JSON.stringify({
				artifactKind: "plan_mode_zod_schema",
				view: "zod_schema_design",
				title: "Todo Tool Input Schema",
				summary: "Worker tool input validation.",
				schemaName: "CreateTodoToolInputSchema",
				owner: "worker_tool_input",
				zodSource:
					'const CreateTodoToolInputSchema = z.object({ owner: ownerSchema.describe("owner ref"), boundaries: z.object({ schemaBoundary: z.string().min(1).describe("schema の責務範囲") }).strict(), tags: z.array(z.string().min(1)).min(1).describe("Todo tags") }).strict();',
				openQuestions: [],
			}),
		);

		const owner = artifact.fields.find((field) => field.name === "owner");
		const boundaries = artifact.fields.find(
			(field) => field.name === "boundaries",
		);
		const tags = artifact.fields.find((field) => field.name === "tags");
		const boundaryChildren = (boundaries?.children || []) as Array<
			Record<string, unknown>
		>;

		expect(owner).toEqual(
			expect.objectContaining({
				type: "reference",
				referencedSchema: "ownerSchema",
				description: "owner ref",
			}),
		);
		expect(boundaries).toEqual(expect.objectContaining({ type: "object" }));
		expect(boundaryChildren).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "schemaBoundary",
					type: "string",
					description: "schema の責務範囲",
				}),
			]),
		);
		expect(tags).toEqual(
			expect.objectContaining({
				type: "array",
				description: "Todo tags",
			}),
		);
		expect(artifact.unsupportedExpressions).toEqual([]);
	});

	it("rejects Plan Mode decision schemas in the Zod schema view", () => {
		expect(() =>
			parsePlanZodSchemaOutput(
				JSON.stringify({
					artifactKind: "plan_mode_zod_schema",
					view: "zod_schema_design",
					title: "Todo List Plan Decision Schema",
					summary: "Plan Mode decision validation.",
					schemaName: "TodoListPlanDecisionSchema",
					owner: "llm_json",
					zodSource:
						"const TodoListPlanDecisionSchema = z.object({ uiStructure: z.string().min(1) }).strict();",
					openQuestions: [],
				}),
			),
		).toThrow("targeted Plan Mode metadata");
	});

	it("rejects aggregate or speculative Zod schemas that are not backed by the source scope", () => {
		expect(() =>
			parsePlanZodSchemaOutput(
				JSON.stringify({
					artifactKind: "plan_mode_zod_schema",
					view: "zod_schema_design",
					title: "Task Runtime Schema",
					summary: "Todo task runtime validation.",
					schemaName: "TaskRuntimeSchema",
					owner: "worker_tool_input",
					zodSource: [
						"const TaskInputSchema = z.object({ title: z.string().min(1) }).strict();",
						"const TaskUpdateInputSchema = z.object({ id: z.number().int().positive(), title: z.string().optional() }).strict();",
						"const TaskFilterSchema = z.object({ search: z.string().optional() }).strict();",
						'const TaskSortSchema = z.object({ field: z.enum(["createdAt", "title"]) }).strict();',
						"const TaskSettingsSchema = z.object({ showCompleted: z.boolean().default(true) }).strict();",
						"const TaskRuntimeSchema = z.object({ create: TaskInputSchema, update: TaskUpdateInputSchema, filter: TaskFilterSchema, sort: TaskSortSchema, settings: TaskSettingsSchema }).strict();",
					].join("\n"),
					openQuestions: [],
				}),
				{
					sourceText:
						"Todo の作成、編集、完了状態の切り替え、削除に必要な入力だけを扱う。",
				},
			),
		).toThrow("aggregate/root schema");
	});

	it("rejects unrequested filter schemas but allows them when the source scope explicitly asks for filtering", () => {
		const filterSchemaOutput = JSON.stringify({
			artifactKind: "plan_mode_zod_schema",
			view: "zod_schema_design",
			title: "Task Filter Schema",
			summary: "Todo task filter validation.",
			schemaName: "TaskFilterSchema",
			owner: "worker_tool_input",
			zodSource:
				"const TaskFilterSchema = z.object({ search: z.string().min(1).max(200).optional() }).strict();",
			openQuestions: [],
		});

		expect(() =>
			parsePlanZodSchemaOutput(filterSchemaOutput, {
				sourceText: "Todo の作成と編集に必要な入力だけを扱う。",
			}),
		).toThrow("filter/search schema");

		expect(
			parsePlanZodSchemaOutput(filterSchemaOutput, {
				sourceText: "Todo 一覧は検索語で filter できる。検索条件の入力も扱う。",
			}).schemaName,
		).toBe("TaskFilterSchema");
	});

	it("covers dedicated view markdown validation failures and text sanitization", () => {
		// 1. Expected diagram kind mismatch
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "user_flow",
					title: "User Flow",
					markdown: "```mermaid\nflowchart TD\n  A --> B\n```",
					diagramKind: "sequenceDiagram",
				}),
				"user_flow",
			),
		).toThrow("must use flowchart");

		// 2. Expected diagram kind mismatch when no explicit mermaid block
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "user_flow",
					title: "User Flow",
					markdown: "No diagram here",
					diagramKind: "sequenceDiagram",
				}),
				"user_flow",
			),
		).toThrow("rendered as a Mermaid diagram");

		// 3. Expected view mismatch
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "activity_flow",
					title: "Activity Flow",
					markdown: "```mermaid\nflowchart TD\n  draft --> ready\n```",
					diagramKind: "flowchart",
				}),
				"user_flow",
			),
		).toThrow("expected user_flow");

		// 4. Mermaid block without expectedDiagramKind marker
		expect(() =>
			parseGenericDedicatedViewOutput(
				JSON.stringify({
					artifactKind: "plan_mode_dedicated_view",
					view: "user_flow",
					title: "User Flow",
					markdown: "```mermaid\nsequenceDiagram\n  A ->> B: msg\n```",
					diagramKind: "flowchart",
				}),
				"user_flow",
			),
		).toThrow("must include flowchart ");

		// 5. sanitizeMermaidText edge cases (length limits, special chars removal)
		const longText = "a".repeat(150);
		const sanitized = normalizePlanViewMermaidArtifact({
			artifactKind: "plan_mode_dedicated_view",
			view: "user_flow",
			title: "User Flow",
			markdown: `\`\`\`mermaid\nflowchart TD\n  step["\`${longText}\` [link](url) {special} <chars>"]\n\`\`\``,
			diagramKind: "flowchart",
		});
		expect(sanitized.markdown).toContain("a".repeat(119));
		expect(sanitized.markdown).not.toContain("a".repeat(120));
		expect(sanitized.markdown).not.toContain("{special}");
		expect(sanitized.markdown).not.toContain("<chars>");
	});
});

function expectStrictRequiredProperties(schema: unknown) {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
	const record = schema as Record<string, unknown>;
	if (record.additionalProperties === false && isRecord(record.properties)) {
		const required = Array.isArray(record.required)
			? record.required.map(String)
			: [];
		expect(required.sort()).toEqual(Object.keys(record.properties).sort());
	}
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) {
			for (const item of value) expectStrictRequiredProperties(item);
		} else {
			expectStrictRequiredProperties(value);
		}
	}
}

function expectNoFreeObjects(schema: unknown) {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
	const record = schema as Record<string, unknown>;
	const type = record.type;
	const includesObject =
		type === "object" ||
		(Array.isArray(type) && type.map(String).includes("object"));
	if (includesObject) {
		expect(record.additionalProperties).toBe(false);
	}
	for (const value of Object.values(record)) {
		if (Array.isArray(value)) {
			for (const item of value) expectNoFreeObjects(item);
		} else {
			expectNoFreeObjects(value);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
