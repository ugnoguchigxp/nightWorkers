import { AppError } from "../../../lib/errors";

type ActiveRunResource = {
	id: string;
	currentTodoRef?: { id: string } | null;
} | null;

export function assertTaskOperatorActiveRunResource(
	activeRun: ActiveRunResource,
	runId: string,
	todoId?: string,
) {
	if (
		activeRun?.id === runId &&
		(todoId === undefined || activeRun.currentTodoRef?.id === todoId)
	)
		return;
	throw new AppError(
		403,
		"TASK_RESOURCE_OWNERSHIP_MISMATCH",
		"Run or Todo does not belong to the requested Task.",
	);
}
