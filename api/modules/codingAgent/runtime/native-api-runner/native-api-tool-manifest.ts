import {
	COMPLETION_CHECK_ASSURANCE_DESCRIPTION_JA,
	codingAgentCollectTestInventoryJsonSchema,
	codingAgentRunCheckJsonSchema,
	RUN_CHECK_MANAGED_EVIDENCE_DESCRIPTION_JA,
	TEST_EVIDENCE_MAPPING_TOOL_DESCRIPTION_JA,
	TEST_INVENTORY_TOOL_DESCRIPTION_JA,
} from "../../../../../shared/modules/codingAgent";
import { testConditionMappingJsonSchema } from "../../../../../shared/schemas/verification-checklist.schema";
import type { ProviderToolDefinition } from "../../../../services/structured-llm/tool-calls";
import type { WorkerToolName } from "../../../../services/tool-policy/types";
import { todoCommandJsonSchema } from "./native-api-todo-tool";
import { objectSchema } from "./native-api-tool-schema";

export { todoCommandJsonSchema } from "./native-api-todo-tool";
export { objectSchema } from "./native-api-tool-schema";

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
				"登録済みProjectのrepository fileへunified patchを適用します。current Todoの目的と受け入れ条件に基づいて使用してください。",
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
			description: RUN_CHECK_MANAGED_EVIDENCE_DESCRIPTION_JA,
			inputSchema: codingAgentRunCheckJsonSchema,
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
			description: COMPLETION_CHECK_ASSURANCE_DESCRIPTION_JA,
			inputSchema: objectSchema({
				taskId: { type: "string" },
				verificationDocumentId: { type: "string" },
			}),
		},
	},
	{
		name: "collect_test_inventory",
		kind: "worker",
		workerToolName: "collect_test_inventory",
		definition: {
			name: "collect_test_inventory",
			description: TEST_INVENTORY_TOOL_DESCRIPTION_JA,
			inputSchema: codingAgentCollectTestInventoryJsonSchema,
		},
	},
	{
		name: "record_test_condition_mapping",
		kind: "worker",
		workerToolName: "record_test_condition_mapping",
		definition: {
			name: "record_test_condition_mapping",
			description: TEST_EVIDENCE_MAPPING_TOOL_DESCRIPTION_JA,
			inputSchema: testConditionMappingJsonSchema,
		},
	},
	{
		name: "project_exploration_catalog",
		kind: "worker",
		workerToolName: "project_exploration_catalog",
		definition: {
			name: "project_exploration_catalog",
			description:
				"現在のProjectに対する変更候補file・関連test・検証commandのbounded catalogを取得します。利用可否と呼び出す順序はsystem promptのProject Static Intelligence Workflowに従い、projectPathやMCP内部IDは入力せず、Task/Todoから分かるfocusだけを指定してください。",
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
				"Todoが品質を上げるRunでだけ使い、ID・revision指定のcommandでTodo planとcurrent Todoを明示更新します。各TodoのsystemContextは工程中の最優先局所指示です。hostは次Todoを推測しません。",
			inputSchema: objectSchema(
				{
					command: todoCommandJsonSchema,
				},
				["command"],
			),
		},
	},
];
