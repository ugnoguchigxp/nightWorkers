import { z } from "zod";
import {
	LLM_WRITABLE_TODO_TASK_TYPES,
	NIGHTWORKERS_MANAGED_TODO_TASK_TYPES,
	TODO_TASK_TYPE_ALIASES,
} from "../services/todo-runtime";

export const nightWorkersReadCurrentSpecificationInputSchema = z.object({
	taskId: z
		.string()
		.trim()
		.optional()
		.describe(
			"NightWorkers task id. Defaults to request-scoped task context when available.",
		),
	view: z
		.enum([
			"compact",
			"implementation",
			"migration",
			"ui",
			"verification",
			"full",
		])
		.optional()
		.describe(
			"Specification view to return. compact is the default model-visible view. full returns the complete markdown content.",
		),
	includeDesignContext: z
		.boolean()
		.optional()
		.describe(
			"When true, include the assembled Plan Mode design context built from Questionnaire, Blueprint, Data Model, API Contract, Zod Schema, and flow artifacts.",
		),
});

export const nightWorkersListRecentSpecificationsInputSchema = z.object({
	limit: z
		.number()
		.int()
		.min(1)
		.max(50)
		.optional()
		.describe("Maximum results. Default: 10."),
});

export const nightWorkersRunCheckInputSchema = z.object({
	runId: z
		.string()
		.trim()
		.optional()
		.describe("NightWorkers run id. Defaults to request context."),
	verificationDocumentId: z
		.string()
		.trim()
		.optional()
		.describe(
			"Verification document id. Defaults to the latest task document.",
		),
	command: z.string().trim().min(1),
	cwd: z.string().trim().optional(),
	checkKind: z.enum([
		"lint",
		"format_check",
		"typecheck",
		"test",
		"coverage",
		"build",
		"verify",
		"completion_check",
		"other",
	]),
	conditionIds: z.array(z.string().trim().min(1)).optional(),
	timeoutSeconds: z.number().int().positive().optional(),
	displayMode: z.enum(["summary", "error_excerpt", "full"]).optional(),
});

export const nightWorkersCompletionCheckInputSchema = z.object({
	taskId: z
		.string()
		.trim()
		.optional()
		.describe("NightWorkers task id. Defaults to request context."),
	verificationDocumentId: z.string().trim().optional(),
});

export const nightWorkersTodoListInputSchema = z.object({
	runId: z
		.string()
		.trim()
		.optional()
		.describe(
			"NightWorkers run id. Defaults to request-scoped run context when available.",
		),
	operation: z
		.enum(["list", "replace", "start", "done", "block", "fail"])
		.describe(
			"Todo operation to perform. list is read-only diagnostics. todo_list operation=replace structurally replans the TodoList. todo_list operation=start/done/block/fail transitions existing Todo state.",
		),
	seq: z
		.number()
		.int()
		.positive()
		.optional()
		.describe(
			"Todo seq for start/done/block/fail. done may omit seq to complete the current running Todo.",
		),
	todos: z
		.array(
			z.object({
				seq: z.number().int().positive(),
				title: z.string().trim().min(1),
				description: z.string().optional(),
				taskType: z
					.string()
					.trim()
					.min(1)
					.optional()
					.describe(
						[
							"Optional Todo category. Prefer an LLM-writable taskType such as",
							LLM_WRITABLE_TODO_TASK_TYPES.join(", "),
							"for real work. NightWorkers-managed taskTypes",
							NIGHTWORKERS_MANAGED_TODO_TASK_TYPES.join(", "),
							"and aliases",
							TODO_TASK_TYPE_ALIASES.join(", "),
							"are accepted so echoed SystemContext does not fail MCP validation; replace will merge those gates back into NightWorkers-managed fixed gates.",
						].join(" "),
					),
				procedureId: z.string().trim().min(1).nullable().optional(),
				dependsOn: z
					.array(
						z.union([z.number().int().positive(), z.string().trim().min(1)]),
					)
					.nullable()
					.optional(),
			}),
		)
		.optional()
		.describe(
			"Run Todos decomposed by the LLM. Pass real implementation/review/verification work here; NightWorkers keeps initial/context/knowledge/completion and broad quality gates as managed fixed gates. If SystemContext-managed gates are echoed back, todo_list replace accepts them and merges them back into the fixed gates. For DB schema changes, or when creating/updating migration files, DB schema, DB bootstrap, seed, or persistence table definitions, mark migration work with taskType=data_migration or procedureId=data_migration.apply_migration so the fixed DB migration gate is preserved. That single gate covers migration file creation, migration command execution against the real target DB, read-only focused test/smoke implementation, and schema/API/test verification before done.",
		),
	startFirst: z
		.boolean()
		.optional()
		.describe("Whether the first fixed gate starts as running. Default: true."),
	todoListReplaceReason: z
		.enum([
			"initial_plan",
			"scope_changed",
			"estimate_changed",
			"newly_required_work",
			"blocked_replan",
		])
		.optional()
		.describe(
			"Required with todo_list operation=replace when a Todo is already running. Do not use this with todo_list operation=start/done/block/fail.",
		),
});

export const nightWorkersImportProjectInputSchema = z.object({
	taskId: z
		.string()
		.trim()
		.optional()
		.describe(
			"NightWorkers task id. Defaults to request-scoped task context when available.",
		),
	runId: z
		.string()
		.trim()
		.optional()
		.describe(
			"NightWorkers run id. Used to resolve the task repository when taskId is not available.",
		),
	source: z
		.enum(["starter", "git"])
		.optional()
		.describe(
			"Choose starter for a registered scaffold or git for an arbitrary repository import.",
		),
	stack: z
		.enum(["hono", "python"])
		.optional()
		.describe(
			"Starter stack. Optional when the default Hono stack is acceptable.",
		),
	repoUrl: z
		.string()
		.trim()
		.optional()
		.describe("Git repository URL or local git path."),
	variant: z
		.string()
		.trim()
		.optional()
		.describe("Starter variant, e.g. sqlite, postgres, rag, or auth."),
	overlays: z
		.array(z.string().trim().min(1))
		.optional()
		.describe("Optional overlay refs such as ssr or ssg."),
	targetPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Project-root-relative target path. Defaults to the Project root.",
		),
	overwrite: z
		.boolean()
		.optional()
		.describe(
			"Allow writing into a non-empty target only when replacement is intended.",
		),
	exclude: z
		.array(z.string().trim().min(1))
		.optional()
		.describe("Extra paths to exclude."),
	ref: z
		.string()
		.trim()
		.optional()
		.describe("Optional Git branch, tag, or commit when repoUrl is used."),
	depth: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Shallow clone depth when repoUrl is used and ref is omitted."),
	stripGitDir: z
		.boolean()
		.optional()
		.describe(
			"Remove nested .git metadata when repoUrl is used. Default: true.",
		),
	initialize: z
		.boolean()
		.optional()
		.describe(
			"Run package bootstrap after git init for starter templates. Arbitrary Git imports fall back to dependency initialization when bootstrap is absent. Default: true.",
		),
});

export const nightWorkersListOntologyModulesInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
});

export const nightWorkersGetModuleOntologyInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
	module: z
		.string()
		.trim()
		.min(1)
		.describe("Module id from .agent-ontology/modules.yaml."),
});

export const nightWorkersClassifyGoalInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
	goal: z
		.string()
		.trim()
		.min(1)
		.describe("User goal to classify into module routing."),
});

export const nightWorkersCompileModuleContextInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
	goal: z
		.string()
		.trim()
		.min(1)
		.describe("User goal for the task-scoped module context."),
	primaryModule: z.string().trim().optional().describe("Primary module id."),
	secondaryModules: z
		.array(z.string().trim().min(1))
		.optional()
		.describe("Secondary module ids."),
	repositoryId: z
		.string()
		.uuid()
		.optional()
		.describe(
			"Optional NightWorkers repository id used to collect task generation evidence.",
		),
	missionId: z
		.string()
		.uuid()
		.optional()
		.describe(
			"Optional Mission id used to scope task generation evidence when available.",
		),
	taskCandidateId: z
		.string()
		.uuid()
		.optional()
		.describe(
			"Optional Mission TaskCandidate id used to collect task generation evidence.",
		),
	taskGenerationEvidence: z
		.unknown()
		.optional()
		.describe(
			"Optional Goal/Mission/TaskCandidate evidence for task-scoped summaries.",
		),
	memoryEvidence: z
		.unknown()
		.optional()
		.describe("Optional memory evidence summary."),
	summaryType: z
		.enum(["canonical", "task_scoped"])
		.optional()
		.describe("Requested summary type."),
});

export const nightWorkersCheckBoundaryInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
	primaryModule: z.string().trim().min(1).describe("Primary module id."),
	secondaryModules: z
		.array(z.string().trim().min(1))
		.optional()
		.describe("Secondary module ids."),
	plannedFiles: z
		.array(z.string().trim().min(1))
		.describe(
			"Repository-relative files planned for editing or already touched.",
		),
});

export const nightWorkersGetVerificationPlanInputSchema = z.object({
	repoPath: z
		.string()
		.trim()
		.optional()
		.describe(
			"Repository root. Defaults to request-scoped NightWorkers project when available.",
		),
	primaryModule: z.string().trim().min(1).describe("Primary module id."),
	secondaryModules: z
		.array(z.string().trim().min(1))
		.optional()
		.describe("Secondary module ids."),
});

export const nightWorkersCodexToolManifest = {
	read_current_specification: {
		title: "Read Current Specification",
		description:
			"Read the latest NightWorkers draft specification markdown for a task. Defaults to view=compact; use view=full only when the complete markdown is necessary. Pass includeDesignContext=true to include assembled Plan Mode artifact contracts. This is read-only and does not edit project files.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersReadCurrentSpecificationInputSchema,
	},
	list_recent_specifications: {
		title: "List Recent Specifications",
		description:
			"List recent NightWorkers draft specifications with task ids so Codex can choose the right task before reading the full specification.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersListRecentSpecificationsInputSchema,
	},
	todo_list: {
		title: "Todo List",
		description:
			"Maintain the current run TodoList with one JSON operation. todo_list operation=replace structurally replans the TodoList and requires todoListReplaceReason when a Todo is already running. todo_list operation=start/done/block/fail transitions existing Todo state. todo_list operation=done automatically starts the next pending Todo.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersTodoListInputSchema,
	},
	run_check: {
		title: "Run Check",
		description:
			"Run a NightWorkers-managed check command and store raw stdout/stderr as formal verification evidence. Use for lint, format:check, typecheck, test, coverage, build, and verify.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersRunCheckInputSchema,
	},
	completion_check: {
		title: "Completion Check",
		description:
			"Check required Verification Checklist items from managed NightWorkers evidence before closeout.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCompletionCheckInputSchema,
	},
	import_project: {
		title: "Import Project",
		description:
			"Single import entrypoint for NightWorkers projects. Use source=starter with stack/variant for new scaffolds, or source=git with repoUrl for arbitrary Git repositories.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersImportProjectInputSchema,
	},
	list_modules: {
		title: "List Ontology Modules",
		description:
			"List coding-agent module ontology entries from .agent-ontology/modules.yaml. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersListOntologyModulesInputSchema,
	},
	get_module_ontology: {
		title: "Get Module Ontology",
		description:
			"Read one module ontology manifest, including owned paths, invariants, boundaries, and verification plan. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersGetModuleOntologyInputSchema,
	},
	classify_goal: {
		title: "Classify Goal",
		description:
			"Classify a user goal into primaryModule, secondaryModules, changeTypes, risk, confidence, and reason using module ontology evidence. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersClassifyGoalInputSchema,
	},
	compile_module_context: {
		title: "Compile Module Context",
		description:
			"Compile canonical or task-scoped module context from ontology manifest, code evidence, task generation evidence, and memory hints. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCompileModuleContextInputSchema,
	},
	check_boundary: {
		title: "Check Boundary",
		description:
			"Check planned or touched files against module owned paths, allowed crossings, read-mostly paths, and unknown paths. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCheckBoundaryInputSchema,
	},
	get_verification_plan: {
		title: "Get Verification Plan",
		description:
			"Return baseline, focused, and full verification commands for a primary module and optional secondary modules. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersGetVerificationPlanInputSchema,
	},
} as const;

export type NightWorkersCodexToolName =
	keyof typeof nightWorkersCodexToolManifest;
export type NightWorkersCodexToolExecutionMode =
	| "planning"
	| "implementation"
	| "test"
	| "review"
	| "general_answer";

const PLAN_MODE_READ_ONLY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
	"read_current_specification",
	"list_recent_specifications",
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);

const ONTOLOGY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);

export function getNightWorkersCodexToolNames(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.keys(nightWorkersCodexToolManifest)
		.filter((tool): tool is NightWorkersCodexToolName =>
			isNightWorkersCodexToolAllowedForMode(
				tool as NightWorkersCodexToolName,
				input.executionMode,
				input.ontologyMcpEnabled,
			),
		)
		.map((tool) => `nightworkers.${tool}`);
}

export function buildNightWorkersCodexToolApprovalConfig(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.fromEntries(
		Object.entries(nightWorkersCodexToolManifest)
			.filter(([name]) =>
				isNightWorkersCodexToolAllowedForMode(
					name as NightWorkersCodexToolName,
					input.executionMode,
					input.ontologyMcpEnabled,
				),
			)
			.map(([name, definition]) => [
				name,
				{ approval_mode: definition.approvalMode },
			]),
	);
}

export function buildNightWorkersCodexToolConfigLines(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.entries(nightWorkersCodexToolManifest)
		.filter(([name]) =>
			isNightWorkersCodexToolAllowedForMode(
				name as NightWorkersCodexToolName,
				input.executionMode,
				input.ontologyMcpEnabled,
			),
		)
		.flatMap(([name, definition]) => [
			"",
			`[mcp_servers.nightworkers.tools.${name}]`,
			`approval_mode = "${definition.approvalMode}"`,
		]);
}

export function isNightWorkersCodexToolAllowedForMode(
	tool: NightWorkersCodexToolName,
	executionMode?: string,
	ontologyMcpEnabled = false,
) {
	if (!ontologyMcpEnabled && ONTOLOGY_CODEX_TOOLS.has(tool)) return false;
	if (executionMode !== "planning") return true;
	return PLAN_MODE_READ_ONLY_CODEX_TOOLS.has(tool);
}

export function toNightWorkersJsonSchema(schema: z.ZodTypeAny) {
	const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
	const { $schema: _ignored, ...rest } = jsonSchema;
	return rest;
}
