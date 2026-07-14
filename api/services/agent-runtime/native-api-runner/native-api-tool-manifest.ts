import type { ProviderToolDefinition } from "../../structured-llm/tool-calls";
import type { WorkerToolName } from "../../tool-policy/types";
import type { NativeApiExecutionMode } from "./native-api-mode";

export type NativeApiRuntimeToolName =
	| WorkerToolName
	| "todo_list"
	| "list_mcp_tools"
	| "context_initial_instructions"
	| "context_compile"
	| "context_decision"
	| "compile_eval"
	| "register_candidates"
	| "new_context"
	| "finalize_answer";

export type NativeApiToolKind =
	| "worker"
	| "todo_control"
	| "mcp_catalog"
	| "context_still"
	| "context_window"
	| "terminal";

export type NativeApiToolRegistration = {
	name: NativeApiRuntimeToolName;
	kind: NativeApiToolKind;
	workerToolName?: WorkerToolName;
	definition: ProviderToolDefinition;
};

export type NativeApiToolProfileTodo = {
	taskType?: string | null;
	procedureId?: string | null;
};

export type NativeApiToolProfileInput = {
	executionMode?: NativeApiExecutionMode;
	currentTodo?: NativeApiToolProfileTodo | null;
	ontologyMcpEnabled?: boolean;
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
				"Run a NightWorkers-managed check command and store raw stdout/stderr as formal verification evidence. Use this for lint, format:check, typecheck, test, coverage, build, verify, and completion_check-oriented commands.",
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
				"Run a verification command. If package.json defines a verify script, prefer that verify command as the representative final verification before completion; use typecheck/lint/test/build as focused checks or fallbacks.",
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
				"Check whether required Verification Checklist items are matched by NightWorkers-managed test evidence. If this fails, continue fixing failed or unknown required conditions.",
			inputSchema: objectSchema({
				taskId: { type: "string" },
				verificationDocumentId: { type: "string" },
			}),
		},
	},
	{
		name: "reviewer_evaluation",
		kind: "worker",
		workerToolName: "reviewer_evaluation",
		definition: {
			name: "reviewer_evaluation",
			description:
				"Run the final NightWorkers reviewer evaluation for a Review Mode run. If the reviewer returns changes_requested or blocking findings, fix them, rerun the needed checks, and run reviewer_evaluation again until no unresolved findings remain.",
			inputSchema: objectSchema({
				runId: { type: "string" },
				rubricId: { type: "string" },
				mode: {
					type: "string",
					enum: ["deterministic_only", "llm_assisted"],
				},
				persist: { type: "boolean" },
			}),
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
		name: "new_context",
		kind: "context_window",
		definition: {
			name: "new_context",
			description:
				"Start a new context window without summarizing conversation history.",
			inputSchema: objectSchema({}),
		},
	},
	{
		name: "todo_list",
		kind: "todo_control",
		definition: {
			name: "todo_list",
			description:
				"Control the NightWorkers TodoList. Use todo_list operation=replace only for structural replanning; use todo_list operation=start/done/block/fail for existing Todo state transitions.",
			inputSchema: objectSchema(
				{
					operation: {
						type: "string",
						enum: ["replace", "start", "done", "block", "fail"],
					},
					seq: { type: "number" },
					todos: { type: "array" },
					startFirst: { type: "boolean" },
					evidenceRefs: {
						type: "array",
						items: { type: "string" },
						description:
							"Evidence references returned by NightWorkers tool outcomes. Use with operation=done when required.",
					},
					todoListReplaceReason: {
						type: "string",
						enum: [
							"initial_plan",
							"scope_changed",
							"estimate_changed",
							"newly_required_work",
							"blocked_replan",
						],
						description:
							"Required with todo_list operation=replace when a Todo is already running. Do not provide this for start/done/block/fail.",
					},
				},
				["operation"],
			),
		},
	},
	{
		name: "finalize_answer",
		kind: "terminal",
		definition: {
			name: "finalize_answer",
			description:
				"Finalize the native API runner after all required gates for the current mode are complete. If the coverage autonomy gate rejects finalize_answer, continue in a test-focused loop by adding or repairing unit tests; do not add test-only branches, coverage-ignore comments, or production logic hacks just to satisfy coverage.",
			inputSchema: objectSchema(
				{
					finalReport: { type: "string" },
					summary: { type: "string" },
				},
				["finalReport"],
			),
		},
	},
];
