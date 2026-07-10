import type { NativeApiExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import type { StructuredLlmModelTarget } from "../../../services/structured-llm/settings";
import type { ImplementationTodoInput } from "../../../services/todo-runtime";

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
	runtimeOptionsPatch?: Record<string, unknown>;
	routeOverride?: StructuredLlmModelTarget | null;
};
