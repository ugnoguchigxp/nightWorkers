import { z } from "zod";
import {
	TODO_DRAFT_FIELD_GUIDANCE_JA,
	TODO_MUTATION_LIMITS,
} from "../../shared/modules/codingAgent";
import { testConditionMappingToolInputSchema } from "../../shared/schemas/verification-checklist.schema";
import {
	isStarterVariantForStack,
	STARTER_STACKS,
	STARTER_VARIANT_GUIDANCE,
	STARTER_VARIANTS,
} from "../../shared/starter-template-contract";

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
	conditionIds: z
		.array(
			z
				.string()
				.trim()
				.regex(/^AC-\d{3}$/),
		)
		.optional()
		.describe(
			"Optional condition IDs associated with this check result for display and later inspection.",
		),
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

export const nightWorkersCollectTestInventoryInputSchema = z.object({
	runId: z.string().trim().optional(),
	cwd: z.string().trim().optional(),
});

export const nightWorkersRecordTestConditionMappingInputSchema =
	testConditionMappingToolInputSchema;

const todoDraftSchema = z.object({
	todoKey: z
		.string()
		.trim()
		.min(1)
		.max(TODO_MUTATION_LIMITS.maxTodoIdLength)
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.todoKey),
	id: z
		.string()
		.trim()
		.min(1)
		.max(TODO_MUTATION_LIMITS.maxTodoIdLength)
		.optional(),
	title: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTitleLength),
	taskType: z
		.string()
		.trim()
		.min(1)
		.max(TODO_MUTATION_LIMITS.maxTaskTypeLength)
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.taskType),
	objective: z
		.string()
		.max(TODO_MUTATION_LIMITS.maxObjectiveLength)
		.nullable()
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.objective),
	systemContext: z
		.string()
		.trim()
		.min(1)
		.max(TODO_MUTATION_LIMITS.maxTodoSystemContextLength)
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.systemContext),
	context: z
		.string()
		.max(TODO_MUTATION_LIMITS.maxTodoSystemContextLength)
		.nullable()
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.context),
	nextAction: z
		.string()
		.trim()
		.min(1)
		.max(TODO_MUTATION_LIMITS.maxNextActionLength)
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.nextAction),
	acceptanceCriteria: z
		.array(
			z
				.string()
				.trim()
				.min(1)
				.max(TODO_MUTATION_LIMITS.maxAcceptanceCriterionLength),
		)
		.max(TODO_MUTATION_LIMITS.maxAcceptanceCriteria)
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.acceptanceCriteria),
	dependsOnKeys: z
		.array(z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength))
		.max(TODO_MUTATION_LIMITS.maxDependencies)
		.optional()
		.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.dependsOnKeys),
	dependsOn: z
		.array(z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength))
		.max(TODO_MUTATION_LIMITS.maxDependencies)
		.optional(),
});

const todoMutationCommandSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("list") }),
	z.object({
		op: z.literal("replace_plan"),
		expectedPlanRevision: z.number().int().nonnegative(),
		todos: z.array(todoDraftSchema).min(1).max(TODO_MUTATION_LIMITS.maxTodos),
	}),
	z.object({
		op: z.literal("start"),
		todoId: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength),
		expectedTodoRevision: z.number().int().nonnegative(),
	}),
	z.object({
		op: z.literal("resume"),
		todoId: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength),
		expectedTodoRevision: z.number().int().nonnegative(),
		userContext: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxContextLength),
	}),
	z.object({
		op: z.literal("transition"),
		todoId: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength),
		expectedTodoRevision: z.number().int().nonnegative(),
		status: z.enum(["passed", "needs_human", "skipped"]),
		reason: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxReasonLength),
		nextTodoId: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxTodoIdLength)
			.optional(),
	}),
	z.object({
		op: z.literal("record_failure"),
		todoId: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength),
		expectedTodoRevision: z.number().int().nonnegative(),
		failureSummary: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxReasonLength),
		nextAction: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxNextActionLength),
	}),
	z.object({
		op: z.literal("update_context"),
		todoId: z.string().trim().min(1).max(TODO_MUTATION_LIMITS.maxTodoIdLength),
		expectedTodoRevision: z.number().int().nonnegative(),
		systemContext: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxTodoSystemContextLength)
			.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.updateContext),
		context: z
			.string()
			.max(TODO_MUTATION_LIMITS.maxTodoSystemContextLength)
			.optional()
			.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.context),
		nextAction: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxNextActionLength)
			.describe(TODO_DRAFT_FIELD_GUIDANCE_JA.nextAction),
	}),
]);

export const nightWorkersTodoListInputSchema = z.object({
	runId: z
		.string()
		.trim()
		.optional()
		.describe(
			"NightWorkers run id. Defaults to request-scoped run context when available.",
		),
	command: todoMutationCommandSchema.describe(
		"IDとrevisionを指定するTodo command。hostはTodoを暗黙更新しません。",
	),
});

export const nightWorkersImportProjectInputSchema = z
	.object({
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
			.enum(STARTER_STACKS)
			.optional()
			.describe(
				"Starter stack: Hono, Python/FastAPI, Java/Spring Boot, or Rust/Axum. Optional when the default Hono stack is acceptable.",
			),
		repoUrl: z
			.string()
			.trim()
			.optional()
			.describe("Git repository URL or local git path."),
		variant: z
			.enum(STARTER_VARIANTS)
			.optional()
			.describe(
				`Stack-specific starter variant. ${STARTER_VARIANT_GUIDANCE}. 選択した stack に要求 DB の variant がない場合は、同じ stack と runtime version の SQLite variant を雛形として取り込み、Feature Plan に従って要求 DB を実装する。SQLite を最終的な DB 要件へ置き換えない。`,
			),
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
	})
	.superRefine((input, context) => {
		if (input.source === "git" || !input.variant) return;
		const stack = input.stack || "hono";
		if (isStarterVariantForStack(stack, input.variant)) return;
		context.addIssue({
			code: "custom",
			path: ["variant"],
			message: `Unknown ${stack} starter variant: ${input.variant}`,
		});
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
