import type { TaskOperatorProjectionV1 } from "../../../shared/modules/taskOperator";
import { apiFetch } from "../../lib/api-base";

export async function fetchTaskOperatorProjection(taskId: string) {
	const response = await apiFetch(`/api/tasks/${taskId}/operator-view`);
	if (!response.ok) throw new Error("Failed to fetch Task Operator view");
	return (await response.json()) as TaskOperatorProjectionV1;
}
