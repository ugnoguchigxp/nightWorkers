import type { TaskOperatorProjectionV1 } from "../../../../shared/modules/taskOperator";
import type { Task } from "../types";

export function overlayTaskOperatorSession(
	session: Task | null,
	view: TaskOperatorProjectionV1 | null,
) {
	if (!session || !view || view.task.id !== session.id) return session;
	return {
		...session,
		title: view.task.title,
		status: view.task.status,
		objective: view.task.objective?.truncated
			? session.objective
			: (view.task.objective?.text ?? null),
		acceptanceCriteria: view.task.acceptanceCriteria?.truncated
			? session.acceptanceCriteria
			: (view.task.acceptanceCriteria?.text ?? null),
	};
}
