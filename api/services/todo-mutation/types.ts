export const AGENT_TODO_STATUSES = [
	"pending",
	"running",
	"passed",
	"needs_human",
	"skipped",
] as const;

export const TODO_MUTATION_LIMITS = {
	maxTodos: 100,
	maxTodoIdLength: 128,
	maxDependencies: 100,
	maxTitleLength: 200,
	maxObjectiveLength: 8_000,
	maxContextLength: 20_000,
	maxNextActionLength: 4_000,
	maxReasonLength: 8_000,
	maxAcceptanceCriteria: 50,
	maxAcceptanceCriterionLength: 2_000,
} as const;

export const TODO_DRAFT_FIELD_GUIDANCE_JA = {
	objective:
		"このTodoで達成する局所的な目的。Task名の言い換えではなく、設計書の実装計画上の成果を具体化する。",
	context:
		"このTodoを実行するLLM自身への局所SystemContext兼リマインダー。設計書の該当制約・非目標・参照先と、quality gate、verify、template/import、安全規則など、この工程に適用される固定SystemContextだけを選んで記録する。共通SystemContextや設計書全文は複製しない。",
	nextAction:
		"局所SystemContextを読んだうえで次に行う具体的な一手。hostに次工程を推測させない。",
	acceptanceCriteria:
		"このTodoをpassedと判断する観測可能な条件。設計書の完了条件や適用されるquality gateを工程単位へ対応付ける。",
	updateContext:
		"作業で得た新事実と、以後も忘れてはいけない工程固有のリマインダーを反映した局所SystemContext。共通SystemContext全文は複製しない。",
} as const;

export type AgentTodoStatus = (typeof AGENT_TODO_STATUSES)[number];
export type TodoCreatedBy = "agent" | "human" | "migration";

export type CodingAgentSystemContextSnapshot = {
	version: number;
	invocationSource: "user" | "mission_pilot";
	planModeRequested: boolean;
	roleInstructionsJa: string;
	taskGoal: string;
	projectRulesJa: string[];
	todoRequirementJa: string;
	failureRecoveryJa: string;
	completionRuleJa: string;
	toolContractJa: string;
	registeredRepositoryRoot: string;
};

export type TodoDraft = {
	id?: string;
	title: string;
	objective?: string | null;
	context?: string | null;
	nextAction: string;
	acceptanceCriteria?: string[];
	dependsOn?: string[];
};

export type TodoMutationCommand =
	| {
			op: "replace_plan";
			expectedPlanRevision: number;
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
			status: "passed" | "needs_human" | "skipped";
			reason: string;
			nextTodoId?: string;
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
			context: string;
			nextAction: string;
	  };

export type TodoMutationErrorCode =
	| "INVALID_TODO_COMMAND"
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
	| "TODO_ID_DUPLICATED"
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
