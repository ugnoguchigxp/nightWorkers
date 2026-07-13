import type { NativeApiExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import {
	buildStandardImplementationTodoList,
	type ImplementationTodoInput,
	type TodoVerificationPolicy,
} from "../../../services/todo-runtime";
import type {
	ReplaceTaskRunTodoInput,
	TaskRunTodoRow,
} from "../nightworkers.runs-support";

const CANCELLED_ACTIVE_REASON = "Run was cancelled while this Todo was active.";
const CANCELLED_PENDING_REASON =
	"Skipped because the run was cancelled before this Todo started.";

export function buildInitialTaskRunTodos(input: {
	executionMode: NativeApiExecutionMode;
	resumedTodos: ReplaceTaskRunTodoInput[] | null;
	initialTodos: ImplementationTodoInput[];
	requireDataMigrationGates: boolean;
	verificationPolicy: TodoVerificationPolicy | null;
}): ReplaceTaskRunTodoInput[] {
	if (
		input.executionMode === "planning" ||
		input.executionMode === "general_answer" ||
		input.executionMode === "test"
	) {
		return [];
	}
	return (
		input.resumedTodos ??
		buildStandardImplementationTodoList({
			todos: input.initialTodos,
			startFirst: true,
			requireDataMigrationGates: input.requireDataMigrationGates,
			verificationPolicy: input.verificationPolicy,
		})
	);
}

export async function resolveInitialTaskRunTodos(input: {
	executionMode: NativeApiExecutionMode;
	resumeTodosFromRunId?: string;
	loadTodosForRun: (runId: string) => Promise<TaskRunTodoRow[]>;
	initialTodos: ImplementationTodoInput[];
	requireDataMigrationGates: boolean;
	verificationPolicy: TodoVerificationPolicy | null;
}): Promise<ReplaceTaskRunTodoInput[]> {
	const resumedTodos = input.resumeTodosFromRunId
		? buildInterruptedRunResumeTodos(
				await input.loadTodosForRun(input.resumeTodosFromRunId),
			)
		: null;
	return buildInitialTaskRunTodos({ ...input, resumedTodos });
}

export function buildInterruptedRunResumeTodos(
	todos: TaskRunTodoRow[],
	now = new Date(),
): ReplaceTaskRunTodoInput[] {
	return todos.map((todo) => {
		const base = {
			seq: todo.seq,
			title: todo.title,
			description: todo.description,
			taskType: todo.taskType,
			status: todo.status,
			procedureId: todo.procedureId,
			procedureSnapshot: todo.procedureSnapshot,
			contextSnapshot: todo.contextSnapshot,
			completionGateResult: todo.completionGateResult,
			evidenceRequirementsJson: todo.evidenceRequirementsJson,
			evidenceRefsJson: todo.evidenceRefsJson,
			dependsOn: todo.dependsOn,
			statusReason: todo.statusReason,
			startedAt: todo.startedAt,
			completedAt: todo.completedAt,
		};
		if (
			todo.status === "failed" &&
			todo.statusReason === CANCELLED_ACTIVE_REASON
		) {
			return {
				...base,
				status: "running",
				statusReason: null,
				completionGateResult: null,
				completedAt: null,
				startedAt: now,
			};
		}
		if (
			todo.status === "skipped" &&
			todo.statusReason === CANCELLED_PENDING_REASON
		) {
			return {
				...base,
				status: "pending",
				statusReason: null,
				completionGateResult: null,
				evidenceRefsJson: [],
				completedAt: null,
				startedAt: null,
			};
		}
		return base;
	});
}
