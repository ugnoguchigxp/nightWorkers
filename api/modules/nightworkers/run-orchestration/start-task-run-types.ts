import type { StructuredLlmModelTarget } from "../../../services/structured-llm/settings";
import type { ImplementationTodoInput } from "../../../services/todo-runtime";
import type { TaskRunAssociationRequest } from "../../agentsShare";
import type {
	AgentExecutionMode,
	CodingAgentPlanModeRuntimeThreadHandoff,
} from "../../codingAgent";

export type ImplementationPlanConstraint = {
	sourceMessageId: string;
	digest: string;
};

export const INTERACTIVE_REVIEW_START_KIND = "interactive_review" as const;

export type InteractiveReviewStart = {
	kind: typeof INTERACTIVE_REVIEW_START_KIND;
	reviewedRunId: string | null;
};

export type StartTaskRunOptions = {
	executionMode?: AgentExecutionMode;
	executionModeSource?:
		| "message_history"
		| "workbench_intake"
		| "workbench_review_followup"
		| "workbench_review_prompt"
		| "workbench_run"
		| "workbench_plan_task"
		| "workbench_run_task"
		| "implementation_queue"
		| "session_queue"
		| "review_run"
		| "explicit";
	/** 単一Coding Agent runtimeを、明示されたPlan Modeの計画Todoから開始する。 */
	planModeRequested?: boolean;
	/** 直前のintake gateで初期化済みのCodex threadを、最初のCoding Agent Runへ一度だけ渡す。 */
	intakeRuntimeThreadHandoff?: CodingAgentPlanModeRuntimeThreadHandoff;
	/** NightWorkers固有の実装文脈を注入せず、Review roleのCodex threadへPromptを送る。 */
	interactiveReview?: InteractiveReviewStart;
	initialTodos?: ImplementationTodoInput[];
	implementationPlanConstraint?: ImplementationPlanConstraint;
	/** 同じ needs_human Run を同じ provider session / Todo で再開する。 */
	resumeRunId?: string;
	resumeCommand?:
		| {
				kind: "todo" | "runtime_pause";
				todoId: string;
				expectedTodoRevision: number;
				userContext: string;
		  }
		| {
				kind: "process_interruption";
				expectedInterruptionRevision: number;
				todoId: string | null;
				expectedTodoRevision: number | null;
				userContext: string;
		  };
	latestUserMessageOverride?: string;
	runtimeOptionsPatch?: Record<string, unknown>;
	routeOverride?: StructuredLlmModelTarget | null;
	/** 起動元roleがRunを関連付けるための、agentsShare経由の中立request。 */
	runAssociation?: TaskRunAssociationRequest;
};

export function isInteractiveReviewStart(
	options: Pick<StartTaskRunOptions, "interactiveReview">,
) {
	return options.interactiveReview?.kind === INTERACTIVE_REVIEW_START_KIND;
}
