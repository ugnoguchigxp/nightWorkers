export const AGENT_TODO_STATUSES = [
	"pending",
	"running",
	"passed",
	"needs_human",
	"skipped",
] as const;

export const TODO_MUTATION_LIMITS = {
	maxTodos: 12,
	maxTodoIdLength: 128,
	maxDependencies: 12,
	maxTitleLength: 200,
	maxTaskTypeLength: 64,
	maxObjectiveLength: 8_000,
	maxContextLength: 20_000,
	maxTodoSystemContextLength: 4_000,
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
	nextAction: string;
	acceptanceCriteria?: string[];
	dependsOnKeys?: string[];
	/** @deprecated replace_planではdependsOnKeysとして互換正規化する。 */
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
			systemContext?: string;
			/** @deprecated systemContextへ互換正規化する。 */
			context?: string;
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
