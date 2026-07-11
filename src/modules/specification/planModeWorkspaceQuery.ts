import { queryOptions } from "@tanstack/react-query";
import type { PlanModeWorkspace } from "../nightworkers/types";
import { fetchPlanModeWorkspace } from "./specificationCommands";

export const planModeWorkspaceQueryKey = (taskId: string | null) =>
	["planModeWorkspace", taskId] as const;

export function planModeWorkspaceQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: planModeWorkspaceQueryKey(taskId),
		queryFn: async () => {
			if (!taskId) return null;
			const response = await fetchPlanModeWorkspace(taskId);
			if (!response.ok) throw new Error("Failed to fetch Plan Mode workspace");
			return (await response.json()) as PlanModeWorkspace;
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}
