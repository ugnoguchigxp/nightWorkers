import { describe, expect, it } from "vitest";
import {
	extractOmittedViewDecisions,
	formatDesignContextKind,
	isFlowViewKind,
	renderAssembledDataModelContract,
	renderDataModelDdlReference,
	renderDataModelSummary,
	renderImplementationReferenceSection,
	renderMessageReferenceSummary,
	renderPlanModeReferences,
	renderPlanViewReferences,
	renderQuestionnaireSessionReferences,
	renderWorkspaceArtifactReference,
	renderWorkspaceArtifactSection,
	workspaceArtifacts,
} from "../api/modules/specification/specification-plan-reference-renderer";
import {
	compactJson,
	compactText,
	ddlType,
	digestText,
	findLatestBlueprintMessage,
	findLatestDataModelMessage,
	findLatestPlanViewMessage,
	getMessageApiContract,
	getMessageBlueprint,
	getMessageDataModelArtifact,
	getMessageZodSchema,
	isDataModelMessageMetadata,
	isRecord,
	renderApiContractReference,
	renderQuestionnaireAnswer,
	renderQuestionnaireAnswerMarkdown,
	renderZodSchemaReference,
	safeSqlIdentifier,
	schemaNameFromContent,
	summarizeComponentSchema,
	summarizeJsonShape,
	summarizeRequestShape,
	summarizeResponseShape,
	summarizeZodSourceShape,
	toRecordArray,
	uniqueStrings,
} from "../api/modules/specification/specification-schema-reference-renderer";

const apiArtifact = {
	title: "Users API",
	summary: "Create and inspect users",
	openapi: {
		components: {
			schemas: {
				UserInput: {
					type: "object",
					required: ["name", "role"],
					properties: {
						name: { type: "string" },
						role: { enum: ["admin", "member"] },
						note: {},
					},
				},
			},
		},
		paths: {
			"/users": {
				post: {
					operationId: "createUser",
					description: "Creates a user",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/UserInput" },
							},
						},
					},
					responses: {
						201: {
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/UserInput" },
								},
							},
						},
						400: {
							schema: {
								properties: { error: { type: "string" } },
								required: ["error"],
							},
						},
					},
				},
				parameters: "ignored",
			},
		},
	},
};

describe("specification schema reference renderer coverage", () => {
	it("covers digest, uniqueness, compact JSON, identifiers, text, and DDL types", () => {
		expect(digestText("value")).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(uniqueStrings(["a", "b", "a"])).toEqual(["a", "b"]);
		expect(compactJson("plain")).toBe("plain");
		expect(compactJson(null)).toBe("");
		expect(compactJson(undefined)).toBe("");
		expect(compactJson({ a: 1 })).toBe('{"a":1}');
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(compactJson(circular)).toBe("[object Object]");
		expect(safeSqlIdentifier(" __User Profile! ")).toBe("user_profile");
		expect(compactText("  one\n two  ", 20)).toBe("one two");
		expect(compactText("abcdefgh", 5)).toBe("abcd…");
		expect(compactText("abc", 0)).toBe("…");
		expect(["number", "integer"].map(ddlType)).toEqual(["INTEGER", "INTEGER"]);
		expect(ddlType("boolean")).toBe("BOOLEAN");
		expect(["date", "datetime", "timestamp"].map(ddlType)).toEqual([
			"DATETIME",
			"DATETIME",
			"DATETIME",
		]);
		expect(ddlType("json")).toBe("JSON");
		expect(ddlType("uuid")).toBe("TEXT");
	});

	it("renders API operations with referenced and inline request/response shapes", () => {
		const rendered = renderApiContractReference(apiArtifact);
		expect(rendered).toContain("API Contract: Users API");
		expect(rendered).toContain("POST /users (createUser): Creates a user");
		expect(rendered).toContain(
			"request: UserInput; required; name:string, role:enum(admin|member), note:unknown?",
		);
		expect(rendered).toContain("201 UserInput");
		expect(rendered).toContain("400 {error:string}");
		expect(renderApiContractReference(null)).toBe("");
		expect(renderApiContractReference({ openapi: { paths: [] } })).toBe(
			"API Contract: API Contract",
		);
	});

	it("summarizes request and response variants", () => {
		expect(summarizeRequestShape(null, apiArtifact)).toBe("");
		expect(
			summarizeRequestShape(
				{
					required: false,
					schema: { properties: { id: { type: "integer" } } },
				},
				apiArtifact,
			),
		).toBe("optional; id:integer?");
		expect(summarizeRequestShape({ schema: {} }, apiArtifact)).toBe("");
		expect(summarizeResponseShape(null, apiArtifact)).toBe("");
		expect(summarizeResponseShape({ 204: "none" }, apiArtifact)).toBe("204");
		expect(schemaNameFromContent({})).toBe("");
		expect(
			schemaNameFromContent({
				content: { "application/json": { schema: { $ref: "User" } } },
			}),
		).toBe("User");
		expect(summarizeComponentSchema(apiArtifact, "Missing")).toBe("");
	});

	it("limits component and inline shapes and marks optional fields", () => {
		const properties = Object.fromEntries(
			Array.from({ length: 10 }, (_, index) => [
				`field${index}`,
				{ type: "string" },
			]),
		);
		const artifact = {
			openapi: {
				components: { schemas: { Big: { properties, required: ["field0"] } } },
			},
		};
		const summary = summarizeComponentSchema(artifact, "Big");
		expect(summary.split(", ")).toHaveLength(8);
		expect(summary).toContain("field0:string");
		expect(summary).toContain("field1:string?");
		expect(summarizeJsonShape({})).toBe("");
		expect(
			summarizeJsonShape({
				properties: { state: { enum: ["on", "off"] }, unknown: null },
				required: ["state"],
			}),
		).toBe("state:enum(on|off), unknown:unknown?");
	});

	it("renders Zod field declarations and infers source shapes", () => {
		const artifact = {
			schemaName: "UserSchema",
			summary: "A user",
			owner: "identity",
			fields: [
				{
					name: "role",
					type: "string",
					required: false,
					enumOptions: ["admin", "", "member"],
				},
				{ name: "age" },
				"ignored",
			],
			zodSource:
				"z.object({ name: z.string(), age: z.number().optional(), active: z.boolean() })",
		};
		const rendered = renderZodSchemaReference(artifact);
		expect(rendered).toContain("role:string/optional(admin|member)");
		expect(rendered).toContain("age:unknown/required");
		expect(rendered).toContain("name:string, age:number?, active:boolean");
		expect(renderZodSchemaReference(null)).toBe("");
		expect(renderZodSchemaReference({ title: "Empty", zodSource: 2 })).toBe(
			"Zod Schema: Empty",
		);
		expect(summarizeZodSourceShape(" ")).toBe("");
		expect(summarizeZodSourceShape("z.string()")).toBe("");
	});

	it("finds blueprint, data-model, and dedicated-view messages", () => {
		const messages = [
			{
				id: "old",
				content: "old",
				metadataJson: {
					intent: "app_blueprint",
					appBlueprint: { title: "Old" },
				},
			},
			{
				id: "data",
				metadataJson: {
					intent: "app_blueprint",
					appBlueprint: {},
					source: "data-model",
					dataModelArtifact: { summary: "model" },
				},
			},
			{
				id: "new",
				metadataJson: {
					intent: "mock_blueprint",
					mockBlueprint: { title: "New" },
				},
			},
			{
				id: "api",
				metadataJson: {
					view: "api_io_contract",
					apiContract: { title: "API" },
				},
			},
			{
				id: "zod",
				metadataJson: {
					view: "zod_schema_design",
					artifactKind: "plan_mode_dedicated_view",
					artifactPayload: { schemaName: "S" },
				},
			},
		];
		expect(
			findLatestBlueprintMessage(messages, {
				kind: "blueprint",
				preferredMessageId: "old",
			})?.id,
		).toBe("old");
		expect(
			findLatestBlueprintMessage(messages, {
				kind: "blueprint",
				preferredMessageId: "missing",
			})?.id,
		).toBe("new");
		expect(findLatestDataModelMessage(messages)?.id).toBe("data");
		expect(findLatestPlanViewMessage(messages, "api_io_contract")?.id).toBe(
			"api",
		);
		expect(findLatestPlanViewMessage(messages, "zod_schema_design")?.id).toBe(
			"zod",
		);
		expect(getMessageBlueprint(messages[2])).toEqual({ title: "New" });
		expect(getMessageDataModelArtifact(messages[1])).toEqual({
			summary: "model",
		});
		expect(getMessageApiContract(messages[3])).toEqual({ title: "API" });
		expect(getMessageZodSchema(messages[4])).toEqual({ schemaName: "S" });
	});

	it("covers metadata artifact fallbacks and type guards", () => {
		expect(getMessageBlueprint(undefined)).toBeNull();
		expect(
			getMessageDataModelArtifact({
				id: "x",
				metadataJson: { dataModelArtifact: [] },
			}),
		).toBeNull();
		expect(getMessageApiContract(undefined)).toBeNull();
		expect(
			getMessageApiContract({
				id: "x",
				metadataJson: { artifactPayload: { a: 1 } },
			}),
		).toEqual({ a: 1 });
		expect(
			getMessageApiContract({
				id: "x",
				metadataJson: { artifactKind: "plan_mode_api_contract", title: "A" },
			}),
		).toMatchObject({ title: "A" });
		expect(getMessageZodSchema(undefined)).toBeNull();
		expect(
			getMessageZodSchema({ id: "x", metadataJson: { zodSchema: { a: 1 } } }),
		).toEqual({ a: 1 });
		expect(
			getMessageZodSchema({
				id: "x",
				metadataJson: { artifactKind: "plan_mode_zod_schema" },
			}),
		).toMatchObject({ artifactKind: "plan_mode_zod_schema" });
		expect(
			isDataModelMessageMetadata({
				artifactKind: "plan_mode_dedicated_view",
				view: "data_model",
			}),
		).toBe(true);
		expect(isDataModelMessageMetadata({ artifactType: "data_model" })).toBe(
			true,
		);
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(toRecordArray([{}, null, [], { a: 1 }])).toEqual([{}, { a: 1 }]);
		expect(toRecordArray("no")).toEqual([]);
	});

	it("renders every questionnaire answer form", () => {
		const question = {
			options: [{ id: "a", label: "Alpha" }, { id: "b" }, null],
		};
		expect(renderQuestionnaireAnswer(question, undefined)).toBe("未回答");
		expect(
			renderQuestionnaireAnswer(question, { deferred: true } as never),
		).toBe("後で決める");
		expect(
			renderQuestionnaireAnswer(question, { booleanValue: true } as never),
		).toBe("はい");
		expect(
			renderQuestionnaireAnswer(question, { booleanValue: false } as never),
		).toBe("いいえ");
		expect(
			renderQuestionnaireAnswer(question, { freeText: "  custom  " } as never),
		).toBe("custom");
		expect(
			renderQuestionnaireAnswer(question, {
				selectedOptionIds: ["a", "missing"],
				rankedOptionIds: ["b"],
			} as never),
		).toBe("Alpha, missing, b");
		expect(renderQuestionnaireAnswer(question, {} as never)).toBe("未回答");
	});

	it("renders questionnaire metadata lines and empty sessions", () => {
		const session = {
			id: "session-1",
			questionSets: [
				{
					questionnaire: {
						questionSets: [
							{
								questions: [
									{
										id: "q1",
										question: "Choose",
										decisionKey: "choice",
										why: "Reason",
										outputSection: "Scope",
										options: [],
									},
								],
							},
						],
					},
				},
			],
			answers: [{ questionId: "q1", answer: { freeText: "answer" } }],
		};
		const rendered = renderQuestionnaireAnswerMarkdown(session as never);
		expect(rendered).toContain("Decision key: choice");
		expect(rendered).toContain("Why: Reason");
		expect(rendered).toContain("Section: Scope");
		expect(
			renderQuestionnaireAnswerMarkdown({
				id: "x",
				questionSets: [],
				answers: [],
			}),
		).toBe("- No questionnaire answers.");
	});
});

describe("specification plan reference renderer coverage", () => {
	it("renders explicit, empty, generated, indexed, and related DDL", () => {
		expect(renderDataModelDdlReference(null)).toBe("Data Model は未生成です。");
		expect(
			renderDataModelDdlReference({ ddl: "  CREATE TABLE custom(id TEXT); " }),
		).toBe("CREATE TABLE custom(id TEXT);");
		expect(renderDataModelDdlReference({ derivedTables: [] })).toBe(
			"Data Model には table が定義されていません。",
		);
		const artifact = {
			derivedTables: [
				{ name: "Empty Table", columns: [] },
				{
					id: "Users",
					columns: [
						{
							name: "ID",
							type: "integer",
							primaryKey: true,
							nullable: false,
							unique: true,
						},
						{ id: "profile", type: "json" },
						{ type: "boolean" },
					],
					indexes: [["ID", "profile"], "invalid", []],
				},
			],
			relations: [
				{
					fromTable: "Users",
					fromColumn: "profile",
					toTable: "Empty Table",
					toColumn: "id",
				},
				{ fromTable: "Users" },
			],
		};
		const ddl = renderDataModelDdlReference(artifact);
		expect(ddl).toContain("-- columns are not defined");
		expect(ddl).toContain("id INTEGER PRIMARY KEY NOT NULL UNIQUE,");
		expect(ddl).toContain("column_3 BOOLEAN");
		expect(ddl).toContain("CREATE INDEX idx_users_id_profile");
		expect(ddl).toContain("ALTER TABLE users ADD FOREIGN KEY");
	});

	it("renders an assembled data-model contract and summary", () => {
		const artifact = {
			canonicalSource: "questionnaire",
			summary: "Canonical model",
			derivedTables: [
				{
					name: "users",
					columns: [
						{
							name: "id",
							type: "uuid",
							primaryKey: true,
							nullable: false,
							unique: true,
						},
					],
				},
			],
			relations: [
				{
					from: "users",
					cardinality: "many-to-one",
					to: "teams",
					reason: "membership",
				},
			],
			constraints: ["IDs are immutable", ""],
		};
		const rendered = renderAssembledDataModelContract(artifact);
		expect(rendered).toContain("Canonical source: questionnaire");
		expect(rendered).toContain("users: id:uuid:pk:required:unique");
		expect(rendered).toContain("users -> many-to-one -> teams -> membership");
		expect(rendered).toContain("IDs are immutable");
		expect(
			renderDataModelSummary({ ...artifact, ddl: "CREATE TABLE users" }),
		).toContain("DDL: CREATE TABLE users");
		expect(renderAssembledDataModelContract({ canonicalSource: "" })).toContain(
			"Canonical source: unknown",
		);
	});

	it("renders plan-view presence and absence", () => {
		expect(
			renderPlanViewReferences({ apiContract: null, zodSchema: null }),
		).toBe("API Contract / Zod Schema は未生成です。");
		expect(
			renderPlanViewReferences({
				apiContract: apiArtifact,
				zodSchema: { schemaName: "User" },
			}),
		).toContain("Zod Schema: User");
	});

	it("renders artifact sections, questionnaire sessions, and implementation references", () => {
		const artifact = {
			id: "a1",
			kind: "blueprint",
			title: "Blueprint",
			sourceMessageId: "m1",
			adoptionState: "adopted",
			sourceArtifactMessageId: "origin",
		};
		const message = {
			id: "m1",
			content: "content",
			metadataJson: { appBlueprint: { title: "App", summary: "Summary" } },
		};
		const map = new Map([["m1", message]]);
		expect(
			renderWorkspaceArtifactSection("Empty", [], map, "feature_plan"),
		).toBe("Empty: none");
		expect(
			renderWorkspaceArtifactSection(
				"Blueprints",
				[artifact] as never,
				map,
				"blueprint",
			),
		).toContain("adoption=adopted");
		expect(
			renderWorkspaceArtifactReference(artifact as never, message, "blueprint"),
		).toContain("source=origin");
		const workspace = {
			questionnaireSessions: [
				{
					id: "q1",
					status: "completed",
					answeredCount: 2,
					totalQuestionCount: 2,
					sourceBlueprintMessageId: "m1",
					latestReviewId: "r1",
				},
			],
			implementationReferences: [
				{
					id: "i1",
					taskId: "t1",
					title: "Implementation",
					sourceMessageId: "m2",
				},
				{ id: "i2", taskId: "t2", title: "No message" },
			],
		};
		expect(renderQuestionnaireSessionReferences(workspace as never)).toContain(
			"sourceBlueprint=m1",
		);
		expect(
			renderImplementationReferenceSection(
				workspace as never,
				new Map([["m2", { id: "m2", content: "Implemented" }]]),
			),
		).toContain("summary: Implemented");
		expect(renderQuestionnaireSessionReferences({} as never)).toBe(
			"Questionnaire Sessions: none",
		);
		expect(renderImplementationReferenceSection({} as never, new Map())).toBe(
			"Implementation References: none",
		);
	});

	it("renders all message reference modes and fallbacks", () => {
		expect(renderMessageReferenceSummary(undefined, "feature_plan")).toBe("");
		expect(
			renderMessageReferenceSummary(
				{ id: "x", content: "plain" },
				"feature_plan",
			),
		).toBe("plain");
		expect(
			renderMessageReferenceSummary({ id: "x", metadataJson: {} }, "blueprint"),
		).toBe("");
		expect(
			renderMessageReferenceSummary(
				{
					id: "x",
					content: "fallback",
					metadataJson: { markdown: "markdown" },
				},
				"dedicated_view",
			),
		).toBe("markdown");
		expect(
			renderMessageReferenceSummary(
				{ id: "x", metadataJson: { apiContract: apiArtifact } },
				"dedicated_view",
			),
		).toContain("API Contract");
		expect(
			renderMessageReferenceSummary(
				{ id: "x", metadataJson: { zodSchema: { schemaName: "S" } } },
				"dedicated_view",
			),
		).toContain("Zod Schema: S");
		expect(
			renderMessageReferenceSummary(
				{
					id: "x",
					metadataJson: {
						dataModelArtifact: {
							summary: "Model",
							derivedTables: [{ name: "users" }],
						},
					},
				},
				"dedicated_view",
			),
		).toContain("Tables: users");
		expect(
			renderMessageReferenceSummary(
				{ id: "x", content: "review", metadataJson: {} },
				"decision_review",
			),
		).toBe("review");
		expect(
			renderMessageReferenceSummary(
				{
					id: "x",
					metadataJson: { markdownDocumentData: { content: "document" } },
				},
				"feature_plan",
			),
		).toBe("document");
	});

	it("assembles all plan mode reference sections", () => {
		const workspace = {
			featurePlanArtifacts: [],
			blueprintArtifacts: [],
			dedicatedViewArtifacts: [],
			decisionReviews: [],
			questionnaireSessions: [],
			implementationReferences: [],
		};
		const rendered = renderPlanModeReferences(workspace as never, []);
		expect(rendered).toContain("Feature Plans: none");
		expect(rendered).toContain("Implementation References: none");
		expect(
			workspaceArtifacts(workspace as never, "featurePlanArtifacts"),
		).toEqual([]);
		expect(
			workspaceArtifacts(
				{ featurePlanArtifacts: null } as never,
				"featurePlanArtifacts",
			),
		).toEqual([]);
	});

	it("extracts omitted views from every supported metadata location", () => {
		const messages = [
			{
				id: "1",
				metadataJson: {
					planModeGate: {
						originalGate: {
							dedicatedViews: [
								{ view: "user_flow", decision: "omit", reason: "simple" },
							],
						},
						dedicatedViews: [{ view: "activity_flow", decision: "omit" }],
					},
				},
			},
			{
				id: "2",
				metadataJson: {
					planMode: {
						dedicatedViews: [{ view: "sequence_flow", decision: "omit" }, null],
					},
					dedicatedViews: [{ view: "blueprint", decision: "include" }],
					viewDecisions: [
						{ view: "data_model", decision: "omit", reason: 2 },
						"bad",
					],
				},
			},
			{ id: "3", metadataJson: null },
		];
		expect(extractOmittedViewDecisions(messages)).toEqual([
			{ view: "user_flow", reason: "simple" },
			{ view: "activity_flow" },
			{ view: "sequence_flow" },
			{ view: "data_model" },
		]);
	});

	it("identifies flow view kinds and formats labels", () => {
		expect(isFlowViewKind("user_flow")).toBe(true);
		expect(isFlowViewKind("activity_flow")).toBe(true);
		expect(isFlowViewKind("sequence_flow")).toBe(true);
		expect(isFlowViewKind("blueprint")).toBe(false);
		expect(formatDesignContextKind("api_io_contract")).toBe("Api Io Contract");
	});
});
