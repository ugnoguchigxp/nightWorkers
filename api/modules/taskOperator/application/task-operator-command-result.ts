import type { TaskOperatorResourceRef } from "../../../../shared/modules/taskOperator";

export function describeTaskOperatorCommandResult(
	actionId: string,
	result: unknown,
): {
	operationRef: TaskOperatorResourceRef | null;
	resourceRefs: TaskOperatorResourceRef[];
} {
	const value = asRecord(result);
	const id =
		typeof value.runId === "string"
			? value.runId
			: typeof value.id === "string"
				? value.id
				: typeof value.taskId === "string"
					? value.taskId
					: null;
	if (!id) return { operationRef: null, resourceRefs: [] };
	const kind = actionId.startsWith("run.")
		? "run"
		: actionId.startsWith("task.queue.")
			? "queue"
			: actionId === "task.message.send"
				? "task_message"
				: actionId.startsWith("questionnaire.")
					? "questionnaire"
					: actionId.startsWith("plan.artifact.")
						? "artifact"
						: actionId.startsWith("git.")
							? "git_operation"
							: actionId.startsWith("background_process.")
								? "background_process"
								: "task";
	const ref = {
		kind,
		id,
		revision:
			typeof value.revision === "number"
				? Math.max(0, Math.trunc(value.revision))
				: 0,
	};
	return { operationRef: ref, resourceRefs: [ref] };
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
