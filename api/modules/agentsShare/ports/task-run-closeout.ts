import type { TaskRunStatus, TaskStatus } from "../../../db/schema";

export type TaskRunCloseoutInput = {
	taskId: string;
	runId: string;
	runStatus: TaskRunStatus;
	executionMode: string;
};

export type TaskRunParentStatusProjection = {
	handled: boolean;
	status: TaskStatus;
};

export type TaskRunCloseoutHandler = {
	projectParentTaskStatus?: (
		input: TaskRunCloseoutInput,
	) =>
		| Promise<TaskRunParentStatusProjection | null>
		| TaskRunParentStatusProjection
		| null;
	continueAfterRun?: (input: TaskRunCloseoutInput) => Promise<void> | void;
};

const handlers = new Set<TaskRunCloseoutHandler>();

export function registerTaskRunCloseoutHandler(
	handler: TaskRunCloseoutHandler,
) {
	handlers.add(handler);
	return () => handlers.delete(handler);
}

export async function projectTaskRunParentStatus(
	input: TaskRunCloseoutInput,
): Promise<TaskRunParentStatusProjection> {
	let projection: TaskRunParentStatusProjection = {
		handled: false,
		status: input.runStatus,
	};
	for (const handler of handlers) {
		const next = await handler.projectParentTaskStatus?.(input);
		if (!next) continue;
		projection = next;
		if (next.handled) break;
	}
	return projection;
}

export async function continueAfterTaskRun(input: TaskRunCloseoutInput) {
	const settled = await Promise.allSettled(
		[...handlers].map((handler) =>
			Promise.resolve().then(() => handler.continueAfterRun?.(input)),
		),
	);
	return settled.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
}
