import { queryOptions } from "@tanstack/react-query";
import { taskOperatorProjectionV1Schema } from "../../../shared/modules/taskOperator";
import { apiFetch } from "../../lib/api-base";

export const taskOperatorProjectionQueryKey = (taskId: string | null) =>
	["taskOperatorView", taskId] as const;

export async function fetchTaskOperatorProjection(taskId: string) {
	const response = await apiFetch(`/api/tasks/${taskId}/operator-view`);
	if (!response.ok) throw new Error("Failed to fetch Task Operator view");
	return taskOperatorProjectionV1Schema.parse(await response.json());
}

export function taskOperatorProjectionQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: taskOperatorProjectionQueryKey(taskId),
		queryFn: () =>
			taskId ? fetchTaskOperatorProjection(taskId) : Promise.resolve(null),
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}
