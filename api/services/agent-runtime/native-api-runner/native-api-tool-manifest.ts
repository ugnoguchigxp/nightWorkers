import type { ProviderToolDefinition } from "../../structured-llm/tool-calls";
import { TODO_MUTATION_LIMITS } from "../../todo-mutation";
import type { WorkerToolName } from "../../tool-policy/types";

export type NativeApiRuntimeToolName =
	| WorkerToolName
	| "todo_list"
	| "list_mcp_tools"
	| "context_initial_instructions"
	| "context_compile"
	| "context_decision"
	| "compile_eval"
	| "register_candidates";

export type NativeApiToolKind =
	| "worker"
	| "todo_control"
	| "mcp_catalog"
	| "context_still";

export type NativeApiToolRegistration = {
	name: NativeApiRuntimeToolName;
	kind: NativeApiToolKind;
	workerToolName?: WorkerToolName;
	definition: ProviderToolDefinition;
};

export type NativeApiToolProfileInput = {
	ontologyMcpEnabled?: boolean;
	projectExplorationCatalogEnabled?: boolean;
};

export const objectSchema = (
	properties: Record<string, unknown>,
	required: string[] = [],
	additionalProperties = false,
) => ({
	type: "object",
	properties,
	required,
	additionalProperties,
});

const todoRevisionFields = {
	todoId: {
		type: "string",
		minLength: 1,
		maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
	},
	expectedTodoRevision: { type: "integer", minimum: 0 },
};

export const todoCommandJsonSchema = {
	oneOf: [
		objectSchema({ op: { const: "list" } }, ["op"]),
		objectSchema(
			{
				op: { const: "replace_plan" },
				expectedPlanRevision: { type: "integer", minimum: 0 },
				todos: {
					type: "array",
					minItems: 1,
					maxItems: TODO_MUTATION_LIMITS.maxTodos,
					items: objectSchema(
						{
							id: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
							},
							title: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxTitleLength,
							},
							objective: {
								type: ["string", "null"],
								maxLength: TODO_MUTATION_LIMITS.maxObjectiveLength,
							},
							context: {
								type: ["string", "null"],
								maxLength: TODO_MUTATION_LIMITS.maxContextLength,
							},
							nextAction: {
								type: "string",
								minLength: 1,
								maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
							},
							acceptanceCriteria: {
								type: "array",
								maxItems: TODO_MUTATION_LIMITS.maxAcceptanceCriteria,
								items: {
									type: "string",
									minLength: 1,
									maxLength: TODO_MUTATION_LIMITS.maxAcceptanceCriterionLength,
								},
							},
							dependsOn: {
								type: "array",
								maxItems: TODO_MUTATION_LIMITS.maxDependencies,
								items: {
									type: "string",
									minLength: 1,
									maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
								},
							},
						},
						["title", "nextAction"],
					),
				},
			},
			["op", "expectedPlanRevision", "todos"],
		),
		...(["start"] as const).map((op) =>
			objectSchema({ op: { const: op }, ...todoRevisionFields }, [
				"op",
				"todoId",
				"expectedTodoRevision",
			]),
		),
		objectSchema(
			{
				op: { const: "resume" },
				...todoRevisionFields,
				userContext: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxContextLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "userContext"],
		),
		objectSchema(
			{
				op: { const: "transition" },
				...todoRevisionFields,
				status: { enum: ["passed", "needs_human", "skipped"] },
				reason: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
				nextTodoId: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxTodoIdLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "status", "reason"],
		),
		objectSchema(
			{
				op: { const: "record_failure" },
				...todoRevisionFields,
				failureSummary: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxReasonLength,
				},
				nextAction: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "failureSummary", "nextAction"],
		),
		objectSchema(
			{
				op: { const: "update_context" },
				...todoRevisionFields,
				context: {
					type: "string",
					maxLength: TODO_MUTATION_LIMITS.maxContextLength,
				},
				nextAction: {
					type: "string",
					minLength: 1,
					maxLength: TODO_MUTATION_LIMITS.maxNextActionLength,
				},
			},
			["op", "todoId", "expectedTodoRevision", "context", "nextAction"],
		),
	],
};

export const workerToolDefinitions: NativeApiToolRegistration[] = [
	{
		name: "read_current_specification",
		kind: "worker",
		workerToolName: "read_current_specification",
		definition: {
			name: "read_current_specification",
			description:
				"Read the latest NightWorkers task specification. Defaults to view='compact'; use view='full' only when exact full markdown is necessary. Set includeDesignContext=true to include assembled Plan Mode artifact contracts. Strongly recommended when a specification, plan, or artifact is the source of truth, but not required for every task.",
			inputSchema: objectSchema({
				view: {
					type: "string",
					enum: [
						"compact",
						"implementation",
						"migration",
						"ui",
						"verification",
						"full",
					],
				},
				includeDesignContext: { type: "boolean" },
			}),
		},
	},
	{
		name: "list_dir",
		kind: "worker",
		workerToolName: "list_dir",
		definition: {
			name: "list_dir",
			description: "List files and directories under the repository root.",
			inputSchema: objectSchema({
				relativePath: { type: "string" },
				recursive: { type: "boolean" },
				maxEntries: { type: "number" },
			}),
		},
	},
	{
		name: "read_file",
		kind: "worker",
		workerToolName: "read_file",
		definition: {
			name: "read_file",
			description: "Read a file from the repository root.",
			inputSchema: objectSchema(
				{
					filePath: { type: "string" },
					startLine: { type: "number" },
					endLine: { type: "number" },
					fresh: { type: "boolean" },
				},
				["filePath"],
			),
		},
	},
	{
		name: "search_files",
		kind: "worker",
		workerToolName: "search_files",
		definition: {
			name: "search_files",
			description: "Search repository files for a text query.",
			inputSchema: objectSchema(
				{
					query: { type: "string" },
					glob: { type: "string" },
				},
				["query"],
			),
		},
	},
	{
		name: "apply_patch",
		kind: "worker",
		workerToolName: "apply_patch",
		definition: {
			name: "apply_patch",
			description:
				"Apply a unified patch to repository files. In planning mode, use only when the user has clearly moved into implementation or the reason is explicit in the final report.",
			inputSchema: objectSchema({ patchContent: { type: "string" } }, [
				"patchContent",
			]),
		},
	},
	{
		name: "replace_content",
		kind: "worker",
		workerToolName: "replace_content",
		definition: {
			name: "replace_content",
			description: "Replace file content using a literal or regex needle.",
			inputSchema: objectSchema(
				{
					filePath: { type: "string" },
					needle: { type: "string" },
					replacement: { type: "string" },
					mode: { type: "string", enum: ["literal", "regex"] },
					allowMultipleOccurrences: { type: "boolean" },
				},
				["filePath", "needle", "replacement"],
			),
		},
	},
	{
		name: "import_project",
		kind: "worker",
		workerToolName: "import_project",
		definition: {
			name: "import_project",
			description:
				"Import a starter scaffold or Git repository into the project. Use this as the only project import entrypoint.",
			inputSchema: objectSchema({
				source: { type: "string", enum: ["starter", "git"] },
				stack: {
					type: "string",
					enum: ["hono", "python", "java", "rust"],
				},
				variant: {
					type: "string",
					enum: [
						"sqlite",
						"baseline",
						"postgres",
						"pgvector",
						"rag",
						"turso",
						"cloudflare",
						"api-only",
						"java8-sqlite",
						"java8-postgres",
						"java25-sqlite",
						"java25-postgres",
						"pgsql",
					],
				},
				overlays: { type: "array", items: { type: "string" } },
				repoUrl: { type: "string" },
				ref: { type: "string" },
				depth: { type: "number" },
				targetPath: { type: "string" },
				overwrite: { type: "boolean" },
				stripGitDir: { type: "boolean" },
				exclude: { type: "array", items: { type: "string" } },
				initialize: { type: "boolean" },
			}),
		},
	},
	{
		name: "run_check",
		kind: "worker",
		workerToolName: "run_check",
		definition: {
			name: "run_check",
			description:
				"Run a check command in the registered repository and return its typed result and raw stdout/stderr. The result does not update Todo or Run status automatically.",
			inputSchema: objectSchema(
				{
					command: { type: "string" },
					checkKind: {
						type: "string",
						enum: [
							"lint",
							"format_check",
							"typecheck",
							"test",
							"coverage",
							"build",
							"verify",
							"completion_check",
							"other",
						],
					},
					cwd: { type: "string" },
					conditionIds: { type: "array", items: { type: "string" } },
					verificationDocumentId: { type: "string" },
					timeoutSeconds: { type: "number" },
					displayMode: {
						type: "string",
						enum: ["summary", "error_excerpt", "full"],
					},
				},
				["command", "checkKind"],
			),
		},
	},
	{
		name: "run_verification",
		kind: "worker",
		workerToolName: "run_verification",
		definition: {
			name: "run_verification",
			description:
				"Run a verification command and return its typed result. Choose the relevant command from the current Task and Todo context.",
			inputSchema: objectSchema(
				{
					command: { type: "string" },
					reason: { type: "string" },
					cwd: { type: "string" },
					timeoutSeconds: { type: "number" },
				},
				["command", "reason"],
			),
		},
	},
	{
		name: "completion_check",
		kind: "worker",
		workerToolName: "completion_check",
		definition: {
			name: "completion_check",
			description:
				"Read the current verification checklist projection and return a typed status without changing Todo or Run state.",
			inputSchema: objectSchema({
				taskId: { type: "string" },
				verificationDocumentId: { type: "string" },
			}),
		},
	},
	{
		name: "project_exploration_catalog",
		kind: "worker",
		workerToolName: "project_exploration_catalog",
		definition: {
			name: "project_exploration_catalog",
			description:
				"現在のProjectに対する、変更候補file・関連test・検証commandのbounded catalogを取得します。projectPathやMCP内部IDは入力せず、Task/Todoから分かるfocusだけを指定してください。",
			inputSchema: objectSchema(
				{
					focus: objectSchema({
						paths: {
							type: "array",
							items: { type: "string" },
							maxItems: 10,
						},
						modules: {
							type: "array",
							items: { type: "string" },
							maxItems: 5,
						},
						terms: {
							type: "array",
							items: { type: "string" },
							maxItems: 10,
						},
					}),
				},
				["focus"],
			),
		},
	},
	{
		name: "mcp_call_tool",
		kind: "worker",
		workerToolName: "mcp_call_tool",
		definition: {
			name: "mcp_call_tool",
			description:
				"Call an enabled MCP tool by serverId and toolName. Use list_mcp_tools first when the target server or schema is unclear.",
			inputSchema: objectSchema(
				{
					serverId: { type: "string" },
					toolName: { type: "string" },
					arguments: { type: "object" },
				},
				["serverId", "toolName"],
			),
		},
	},
	{
		name: "git_status",
		kind: "worker",
		workerToolName: "git_status",
		definition: {
			name: "git_status",
			description:
				"Inspect the current repository git status without mutating files.",
			inputSchema: objectSchema({}),
		},
	},
	{
		name: "git_diff",
		kind: "worker",
		workerToolName: "git_diff",
		definition: {
			name: "git_diff",
			description: "Inspect the current repository diff.",
			inputSchema: objectSchema({}),
		},
	},
];

export const nativeApiToolRegistrations: NativeApiToolRegistration[] = [
	...workerToolDefinitions,
	{
		name: "list_mcp_tools",
		kind: "mcp_catalog",
		definition: {
			name: "list_mcp_tools",
			description:
				"List enabled MCP tools available to this runtime. Use this when deciding which MCP capability to call.",
			inputSchema: objectSchema({}),
		},
	},
	{
		name: "context_initial_instructions",
		kind: "context_still",
		definition: {
			name: "context_initial_instructions",
			description:
				"Run contextStill initial_instructions. Strongly recommended before substantive work when it has not run in this run, but failure does not automatically stop the task.",
			inputSchema: objectSchema({}),
		},
	},
	{
		name: "context_compile",
		kind: "context_still",
		definition: {
			name: "context_compile",
			description:
				"Compile task context. Strongly recommended when repo history, prior decisions, or implementation guidance would materially improve the work. Requires a concrete goal.",
			inputSchema: objectSchema(
				{
					goal: { type: "string", minLength: 1 },
					domains: { type: "array", items: { type: "string" } },
					technologies: { type: "array", items: { type: "string" } },
					changeTypes: { type: "array", items: { type: "string" } },
				},
				["goal"],
			),
		},
	},
	{
		name: "context_decision",
		kind: "context_still",
		definition: {
			name: "context_decision",
			description:
				"Ask contextStill for a decision before escalating to the user, after failed tests/review, or when unfinished Todo/status remains. Strongly recommended at real decision points; do not use as a generic search tool.",
			inputSchema: objectSchema(
				{
					decisionPoint: { type: "string", minLength: 1 },
					metadata: { type: "object" },
					retrievalHints: { type: "object" },
					sessionId: { type: "string" },
				},
				["decisionPoint"],
			),
		},
	},
	{
		name: "compile_eval",
		kind: "context_still",
		definition: {
			name: "compile_eval",
			description:
				"Record the required contextStill compile_eval during closeout when context_compile was used; do not treat failure as automatic task failure.",
			inputSchema: objectSchema(
				{
					title: { type: "string" },
					outcome: {
						type: "string",
						enum: ["useful", "partial", "misleading", "unused"],
					},
					body: { type: "string" },
					relevance: { type: "integer" },
					coverage: { type: "integer" },
					specificity: { type: "integer" },
					actionability: { type: "integer" },
					clarity: { type: "integer" },
					runId: { type: "string" },
				},
				[
					"actionability",
					"body",
					"clarity",
					"coverage",
					"outcome",
					"relevance",
					"specificity",
				],
			),
		},
	},
	{
		name: "register_candidates",
		kind: "context_still",
		definition: {
			name: "register_candidates",
			description:
				"Register reusable lessons with contextStill. Recommended during closeout when project-independent rules or procedures were learned.",
			inputSchema: objectSchema({ items: { type: "array" } }, ["items"]),
		},
	},
	{
		name: "todo_list",
		kind: "todo_control",
		definition: {
			name: "todo_list",
			description:
				"ID・revision指定のcommandでTodo planとcurrent Todoを明示更新します。hostは次Todoを推測せず、tool結果だけを返します。",
			inputSchema: objectSchema(
				{
					command: todoCommandJsonSchema,
				},
				["command"],
			),
		},
	},
];
