import type { NativeApiExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import type { StructuredLlmModelTarget } from "../../../services/structured-llm/settings";
import type { ImplementationTodoInput } from "../../../services/todo-runtime";

export type ImplementationPlanConstraint = {
	sourceMessageId: string;
	digest: string;
};

export type StartTaskRunOptions = {
	executionMode?: NativeApiExecutionMode;
	executionModeSource?:
		| "message_history"
		| "workbench_intake"
		| "workbench_run"
		| "workbench_run_task"
		| "implementation_queue"
		| "session_queue"
		| "review_run"
		| "test_mode"
		| "explicit";
	initialTodos?: ImplementationTodoInput[];
	implementationPlanConstraint?: ImplementationPlanConstraint;
	/** 同じ needs_human Run を同じ provider session / Todo で再開する。 */
	resumeRunId?: string;
	resumeCommand?: {
		todoId: string;
		expectedTodoRevision: number;
		userContext: string;
	};
	latestUserMessageOverride?: string;
	runtimeOptionsPatch?: Record<string, unknown>;
	routeOverride?: StructuredLlmModelTarget | null;
	missionPilotPhase?:
		| "repository_bootstrap"
		| "implementation"
		| "test"
		| "review";
};
