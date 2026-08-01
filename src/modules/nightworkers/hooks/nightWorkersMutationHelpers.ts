import type { QueryClient } from "@tanstack/react-query";
import type { TaskOperatorProjectionV1 } from "../../../../shared/modules/taskOperator";
import { CodingAgentCommandError } from "../../codingAgent";
import { patchTask as patchTaskCommand } from "../nightWorkersCommands";
import type { Task } from "../types";

type TaskPatchInput = {
	title?: string;
	description?: string;
	objective?: string;
	acceptanceCriteria?: string;
	status?: string;
	priority?: number;
};

export async function patchTask(sessionId: string, input: TaskPatchInput) {
	const res = await patchTaskCommand(sessionId, input);
	if (!res.ok) throw new Error(await res.text());
	return (await res.json()) as Task;
}

export function resolveNextActiveSessionId(
	currentId: string | null,
	sessions: Pick<Task, "id">[],
) {
	if (currentId && sessions.some((session) => session.id === currentId))
		return currentId;
	return sessions[0]?.id ?? null;
}

export function syncTaskNavigationCaches(queryClient: QueryClient, task: Task) {
	queryClient.setQueryData<Task[]>(["sessions"], (previous = []) =>
		previous.map((session) => (session.id === task.id ? task : session)),
	);
	queryClient.setQueryData<TaskOperatorProjectionV1 | null>(
		["taskOperatorView", task.id],
		(previous) =>
			previous
				? {
						...previous,
						task: {
							...previous.task,
							status: task.status as TaskOperatorProjectionV1["task"]["status"],
						},
					}
				: previous,
	);
}

export async function refreshTaskNavigationQueries(
	queryClient: QueryClient,
	taskId: string,
) {
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: ["sessions"],
			exact: true,
		}),
		queryClient.invalidateQueries({
			queryKey: ["taskOperatorView", taskId],
			exact: true,
		}),
	]);
}

export function buildPriorityUpdates(sessionIds: string[], sessions: Task[]) {
	const currentPriorityById = new Map(
		sessions.map((session) => [session.id, session.priority]),
	);
	return sessionIds
		.map((sessionId, index) => ({
			sessionId,
			priority: sessionIds.length - index,
		}))
		.filter(
			({ sessionId, priority }) =>
				currentPriorityById.get(sessionId) !== priority,
		);
}

export async function invalidateCommandFailure(
	queryClient: QueryClient,
	taskId: string,
	error: unknown,
) {
	if (!(error instanceof CodingAgentCommandError)) return;
	if (
		error.failure.code !== "TASK_OPERATOR_COMMAND_IN_PROGRESS" &&
		error.failure.code !== "TASK_OPERATOR_COMMAND_OUTCOME_UNKNOWN" &&
		error.failure.kind !== "revision_conflict"
	)
		return;
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: ["taskOperatorView", taskId],
			exact: true,
		}),
		queryClient.invalidateQueries({
			queryKey: ["sessionRuns", taskId],
			exact: true,
		}),
	]);
}
