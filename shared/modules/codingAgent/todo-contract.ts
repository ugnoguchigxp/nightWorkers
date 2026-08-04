import { z } from "zod";
import {
	IMPLEMENTATION_PLAN_LIMITS,
	type ImplementationPlanStep,
	implementationPlanStepSchema,
} from "../agentsShare";

export const AGENT_TODO_STATUSES = [
	"pending",
	"running",
	"passed",
	"needs_human",
	"skipped",
] as const;

export const TODO_MUTATION_LIMITS = {
	maxTodos: IMPLEMENTATION_PLAN_LIMITS.maxSteps,
	maxTodoIdLength: 128,
	maxDependencies: 12,
	maxTitleLength: IMPLEMENTATION_PLAN_LIMITS.maxTitleLength,
	maxTaskTypeLength: 64,
	maxObjectiveLength: 8_000,
	maxContextLength: 20_000,
	maxTodoSystemContextLength: IMPLEMENTATION_PLAN_LIMITS.maxSystemContextLength,
	maxNextActionLength: 4_000,
	maxReasonLength: 8_000,
	maxAcceptanceCriteria: 12,
	maxAcceptanceCriterionLength: 2_000,
} as const;

export const TODO_DRAFT_FIELD_GUIDANCE_JA = {
	todoKey:
		"このRun内でTodoを安定して参照するlocal key。replace_planとdependsOnKeysではこの値を使い、start等の個別更新ではtool resultのcanonical idとrevisionを使う。",
	objective:
		"このTodoで達成する局所的な目的。Task名の言い換えではなく、設計書の実装計画上の成果を具体化する。",
	systemContext:
		"このTodoを実行するときに最優先で読む局所SystemContext。設計書の該当制約、非目標、参照先、判断済み事項、検証条件だけを短く記録する。共通SystemContextや設計書全文は複製しない。",
	context:
		"systemContextの旧互換alias。新しいTodoではsystemContextを使用する。",
	taskType:
		"Todoの意味を示す短い分類。runtime modeやtool制限には使わず、例としてinspection、implementation、data_migration、verificationを指定できる。",
	nextAction:
		"局所SystemContextを読んだうえで次に行う具体的な一手。hostに次工程を推測させない。",
	acceptanceCriteria:
		"このTodoをpassedと判断する観測可能な条件。設計書の完了条件や適用されるquality gateを工程単位へ対応付ける。",
	dependsOnKeys:
		"同じRunのreplace_plan内にある先行TodoのtodoKey。serverがcanonical Todo IDへ解決する。",
	updateContext:
		"作業で得た新事実と、以後も忘れてはいけない工程固有の制約を反映した局所SystemContext。共通SystemContext全文は複製しない。",
} as const;

export type AgentTodoStatus = (typeof AGENT_TODO_STATUSES)[number];
export type TodoCreatedBy = "agent" | "human" | "migration";

export const humanBlockerSchema = z
	.object({
		question: z
			.string()
			.trim()
			.min(1)
			.max(TODO_MUTATION_LIMITS.maxReasonLength),
		requiredInput: z.enum([
			"information",
			"decision",
			"credential",
			"permission",
			"external_change",
		]),
		basis: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("task_context") }).strict(),
			z
				.object({
					kind: z.literal("tool_failure"),
					toolName: z.string().trim().min(1).max(128),
					failureCode: z.string().trim().min(1).max(128),
					recoveryDisposition: z.literal("human_input"),
				})
				.strict(),
		]),
	})
	.strict();

export type HumanBlocker = z.infer<typeof humanBlockerSchema>;

export type CodingAgentSystemContextSnapshot = {
	version: number;
	planModeRequested: boolean;
	todoPolicy: "adaptive";
	roleInstructionsJa: string;
	domainModuleBoundaryJa?: string;
	taskGoal: string;
	projectRulesJa: string[];
	todoRequirementJa: string;
	failureRecoveryJa: string;
	completionRuleJa: string;
	toolContractJa: string;
	registeredRepositoryRoot: string;
};

export type TodoDraft = {
	todoKey?: string;
	/** @deprecated replace_planではRun-local todoKeyとして互換正規化する。 */
	id?: string;
	title: string;
	taskType?: string;
	objective?: string | null;
	systemContext?: string;
	/** @deprecated systemContextへ互換正規化する。 */
	context?: string | null;
	nextAction?: string;
	acceptanceCriteria?: string[];
	dependsOnKeys?: string[];
	/** @deprecated replace_planではdependsOnKeysとして互換正規化する。 */
	dependsOn?: string[];
};

export const codingAgentTodoListCommandSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("list") }).strict(),
	z
		.object({
			op: z.literal("plan"),
			steps: z
				.array(implementationPlanStepSchema)
				.min(1)
				.max(TODO_MUTATION_LIMITS.maxTodos),
		})
		.strict(),
	z
		.object({
			op: z.literal("complete_current"),
			note: z
				.string()
				.trim()
				.min(1)
				.max(TODO_MUTATION_LIMITS.maxReasonLength)
				.optional(),
		})
		.strict(),
	z
		.object({
			op: z.literal("block_current"),
			humanBlocker: humanBlockerSchema,
		})
		.strict(),
	z
		.object({
			op: z.literal("replace_remaining"),
			steps: z
				.array(implementationPlanStepSchema)
				.min(1)
				.max(TODO_MUTATION_LIMITS.maxTodos),
		})
		.strict(),
]);

export type CodingAgentTodoListCommand = z.infer<
	typeof codingAgentTodoListCommandSchema
>;

export type TodoMutationCommand =
	| {
			op: "plan";
			steps: ImplementationPlanStep[];
	  }
	| {
			op: "complete_current";
			note?: string;
	  }
	| {
			op: "block_current";
			humanBlocker: HumanBlocker;
	  }
	| {
			op: "replace_remaining";
			steps: ImplementationPlanStep[];
	  }
	| {
			op: "replace_plan";
			expectedPlanRevision?: number;
			todos: TodoDraft[];
	  }
	| { op: "start"; todoId: string; expectedTodoRevision: number }
	| {
			op: "resume";
			todoId: string;
			expectedTodoRevision: number;
			userContext: string;
	  }
	| {
			op: "transition";
			todoId: string;
			expectedTodoRevision: number;
			status: "passed" | "skipped";
			reason: string;
			humanBlocker?: never;
			nextTodoId?: string;
	  }
	| {
			op: "transition";
			todoId: string;
			expectedTodoRevision: number;
			status: "needs_human";
			humanBlocker: HumanBlocker;
			reason?: never;
			nextTodoId?: never;
	  }
	| {
			op: "record_failure";
			todoId: string;
			expectedTodoRevision: number;
			failureSummary: string;
			nextAction: string;
	  }
	| {
			op: "update_context";
			todoId: string;
			expectedTodoRevision: number;
			systemContext?: string;
			/** @deprecated systemContextへ互換正規化する。 */
			context?: string;
			nextAction: string;
	  };

export type TodoMutationErrorCode =
	| "INVALID_TODO_COMMAND"
	| "TODO_HUMAN_BLOCKER_NOT_ESTABLISHED"
	| "RUN_NOT_FOUND"
	| "RUN_NOT_MUTABLE"
	| "TODO_NOT_FOUND"
	| "TODO_REVISION_CONFLICT"
	| "TODO_PLAN_REVISION_CONFLICT"
	| "TODO_NOT_STARTABLE"
	| "TODO_NOT_RUNNING"
	| "TODO_NOT_RESUMABLE"
	| "TODO_TERMINAL_REOPEN_FORBIDDEN"
	| "CURRENT_TODO_EXISTS"
	| "TODO_DEPENDENCY_NOT_FOUND"
	| "TODO_DEPENDENCY_OPEN"
	| "TODO_DEPENDENCY_CYCLE"
	| "TODO_KEY_DUPLICATED"
	| "TODO_ID_DUPLICATED"
	| "TODO_IDENTITY_CONFLICT"
	| "TODO_MUTATION_CONFLICT";

export type TodoMutationSnapshot<TTodo> = {
	planRevision: number;
	todos: TTodo[];
	currentTodo: TTodo | null;
};

export type TodoMutationResult<TTodo> =
	| ({ ok: true } & TodoMutationSnapshot<TTodo>)
	| ({
			ok: false;
			error: { code: TodoMutationErrorCode; message: string };
	  } & TodoMutationSnapshot<TTodo>);
