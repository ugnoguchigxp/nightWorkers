import { queryOptions } from "@tanstack/react-query";
import { taskOperatorProjectionV1Schema } from "../../../shared/modules/taskOperator";
import { apiFetch } from "../../lib/api-base";
import { readJsonResponse } from "../../lib/api-error";

export const taskOperatorProjectionQueryKey = (taskId: string | null) =>
	["taskOperatorView", taskId] as const;

export async function fetchTaskOperatorProjection(taskId: string) {
	const response = await apiFetch(`/api/tasks/${taskId}/operator-view`);
	return readJsonResponse(response, taskOperatorProjectionV1Schema);
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
