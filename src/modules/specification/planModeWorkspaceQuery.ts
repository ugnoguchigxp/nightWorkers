import { queryOptions } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type { PlanModeWorkspace } from "../nightworkers/types";
import { fetchPlanModeWorkspace } from "./specificationCommands";

export const planModeWorkspaceQueryKey = (taskId: string | null) =>
	["planModeWorkspace", taskId] as const;

export function planModeWorkspaceQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: planModeWorkspaceQueryKey(taskId),
		queryFn: async () => {
			if (!taskId) return null;
			return readJsonResponse<PlanModeWorkspace>(
				await fetchPlanModeWorkspace(taskId),
			);
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}
