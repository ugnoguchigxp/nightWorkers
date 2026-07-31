import { queryOptions } from "@tanstack/react-query";
import type { MissionPilotPlanProgress } from "../contracts";
import { fetchMissionPilotPlanProgress } from "./missionPilotCommands";

export const missionPilotPlanProgressQueryKey = (taskId: string | null) =>
	["missionPilotPlanProgress", taskId] as const;

export function missionPilotPlanProgressQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: missionPilotPlanProgressQueryKey(taskId),
		queryFn: async () => {
			if (!taskId) return null;
			const response = await fetchMissionPilotPlanProgress(taskId);
			if (!response.ok)
				throw new Error("Failed to fetch Mission Pilot Plan progress");
			return (await response.json()) as MissionPilotPlanProgress | null;
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}
