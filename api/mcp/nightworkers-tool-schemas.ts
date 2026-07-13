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

export const nightWorkersReviewerEvaluationInputSchema = z.object({
	runId: z
		.string()
		.trim()
		.optional()
		.describe("NightWorkers run id. Defaults to request context."),
	rubricId: z.string().trim().optional(),
	mode: z.enum(["deterministic_only", "llm_assisted"]).optional(),
	persist: z.boolean().optional(),
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
				evidenceRequirements: z
					.array(
						z.object({
							kind: z.enum([
								"observation",
								"workspace_mutation",
								"verification",
								"decision",
								"approval",
							]),
							freshness: z.enum([
								"after_todo_start",
								"after_last_mutation",
								"any",
							]),
							minimumCount: z.number().int().positive().optional(),
						}),
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
	evidenceRefs: z
		.array(z.string().trim().min(1))
		.optional()
		.describe(
			"Evidence references returned by NightWorkers tool outcomes. Used with operation=done when the Todo declares evidence requirements.",
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
		.enum([
			"sqlite",
			"baseline",
			"postgres",
			"pgvector",
			"rag",
			"turso",
			"cloudflare",
			"api-only",
			"auth",
		])
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
