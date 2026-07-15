import type { TodoMutationCommand, TodoMutationErrorCode } from "./types";
import { TODO_MUTATION_LIMITS } from "./types";

export function validateTodoMutationCommand(
	command: TodoMutationCommand,
): TodoMutationErrorCode | null {
	if (command.op === "replace_plan") {
		if (
			!Number.isInteger(command.expectedPlanRevision) ||
			command.expectedPlanRevision < 0 ||
			command.todos.length < 1 ||
			command.todos.length > TODO_MUTATION_LIMITS.maxTodos
		) {
			return "INVALID_TODO_COMMAND";
		}
		for (const todo of command.todos) {
			const dependencies = todo.dependsOn ?? [];
			const acceptanceCriteria = todo.acceptanceCriteria ?? [];
			if (
				!todo.title.trim() ||
				todo.title.length > TODO_MUTATION_LIMITS.maxTitleLength ||
				(todo.objective?.length ?? 0) >
					TODO_MUTATION_LIMITS.maxObjectiveLength ||
				!todo.nextAction.trim() ||
				todo.nextAction.length > TODO_MUTATION_LIMITS.maxNextActionLength ||
				(todo.context?.length ?? 0) > TODO_MUTATION_LIMITS.maxContextLength ||
				(todo.id !== undefined &&
					(!todo.id.trim() ||
						todo.id.length > TODO_MUTATION_LIMITS.maxTodoIdLength)) ||
				acceptanceCriteria.length >
					TODO_MUTATION_LIMITS.maxAcceptanceCriteria ||
				acceptanceCriteria.some(
					(item) =>
						!item.trim() ||
						item.length > TODO_MUTATION_LIMITS.maxAcceptanceCriterionLength,
				) ||
				dependencies.length > TODO_MUTATION_LIMITS.maxDependencies ||
				dependencies.some(
					(id) =>
						!id.trim() || id.length > TODO_MUTATION_LIMITS.maxTodoIdLength,
				) ||
				new Set(dependencies).size !== dependencies.length ||
				(todo.id !== undefined && dependencies.includes(todo.id))
			) {
				return "INVALID_TODO_COMMAND";
			}
		}
		return null;
	}
	if (
		!command.todoId.trim() ||
		command.todoId.length > TODO_MUTATION_LIMITS.maxTodoIdLength ||
		!Number.isInteger(command.expectedTodoRevision) ||
		command.expectedTodoRevision < 0
	) {
		return "INVALID_TODO_COMMAND";
	}
	if (
		command.op === "resume" &&
		(!command.userContext.trim() ||
			command.userContext.length > TODO_MUTATION_LIMITS.maxContextLength)
	) {
		return "INVALID_TODO_COMMAND";
	}
	if (
		command.op === "transition" &&
		((command.nextTodoId !== undefined &&
			(!command.nextTodoId.trim() ||
				command.nextTodoId.length > TODO_MUTATION_LIMITS.maxTodoIdLength)) ||
			!command.reason.trim() ||
			command.reason.length > TODO_MUTATION_LIMITS.maxReasonLength)
	) {
		return "INVALID_TODO_COMMAND";
	}
	if (
		command.op === "record_failure" &&
		(!command.failureSummary.trim() ||
			command.failureSummary.length > TODO_MUTATION_LIMITS.maxReasonLength ||
			!command.nextAction.trim() ||
			command.nextAction.length > TODO_MUTATION_LIMITS.maxNextActionLength)
	) {
		return "INVALID_TODO_COMMAND";
	}
	if (
		command.op === "update_context" &&
		(command.context.length > TODO_MUTATION_LIMITS.maxContextLength ||
			!command.nextAction.trim() ||
			command.nextAction.length > TODO_MUTATION_LIMITS.maxNextActionLength)
	) {
		return "INVALID_TODO_COMMAND";
	}
	return null;
}

export function todoMutationErrorMessage(code: TodoMutationErrorCode) {
	const messages: Record<TodoMutationErrorCode, string> = {
		INVALID_TODO_COMMAND: "Todo 更新commandが不正です。",
		RUN_NOT_FOUND: "対象Runが存在しません。",
		RUN_NOT_MUTABLE: "対象RunはTodoを更新できる状態ではありません。",
		TODO_NOT_FOUND: "対象Todoが存在しません。",
		TODO_REVISION_CONFLICT:
			"Todoが更新済みです。最新revisionを取得してください。",
		TODO_PLAN_REVISION_CONFLICT:
			"Todo planが更新済みです。最新plan revisionを取得してください。",
		TODO_NOT_STARTABLE: "対象Todoは開始できる状態ではありません。",
		TODO_NOT_RUNNING: "対象Todoはrunningではありません。",
		TODO_NOT_RESUMABLE: "対象Todoはneeds_humanではありません。",
		TODO_TERMINAL_REOPEN_FORBIDDEN: "terminal Todoは再openできません。",
		CURRENT_TODO_EXISTS:
			"このRunには既にcurrent Todo（runningまたはneeds_human）があります。",
		TODO_DEPENDENCY_NOT_FOUND: "参照先Todo IDがplan内に存在しません。",
		TODO_DEPENDENCY_OPEN: "未完了のdependencyがあるためTodoを開始できません。",
		TODO_DEPENDENCY_CYCLE: "Todo dependencyに循環があります。",
		TODO_ID_DUPLICATED: "Todo IDが重複しています。",
		TODO_MUTATION_CONFLICT:
			"Todo更新を確定できませんでした。最新状態を取得してください。",
	};
	return messages[code];
}
