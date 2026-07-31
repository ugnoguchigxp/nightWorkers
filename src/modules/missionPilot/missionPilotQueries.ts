import { queryOptions, useQuery } from "@tanstack/react-query";
import type { MissionPilotControlSummary } from "../../../shared/modules/missionPilot";
import { fetchMissionPilotControl } from "./missionPilotCommands";

export const missionPilotControlQueryKey = (taskId: string | null) =>
	["missionPilotControl", taskId] as const;

export function missionPilotControlQueryOptions(taskId: string | null) {
	return queryOptions({
		queryKey: missionPilotControlQueryKey(taskId),
		queryFn: async ({ signal }) => {
			if (!taskId) return null;
			const response = await fetchMissionPilotControl(taskId, signal);
			if (!response.ok)
				throw new Error("Failed to fetch Mission Pilot control state");
			return (await response.json()) as MissionPilotControlSummary | null;
		},
		enabled: Boolean(taskId),
		refetchOnWindowFocus: false,
		refetchOnReconnect: true,
	});
}

export function useMissionPilotControl(
	taskId: string,
	initialSummary?: MissionPilotControlSummary | null,
) {
	const query = useQuery({
		...missionPilotControlQueryOptions(taskId),
		...(initialSummary ? { initialData: initialSummary } : {}),
	});
	return {
		...query,
		summary: query.data ?? unstartedMissionPilotControl(taskId),
	};
}

export function unstartedMissionPilotControl(
	taskId: string,
): MissionPilotControlSummary {
	return {
		taskId,
		desiredState: "stopped",
		activityState: "idle",
		phase: "not_started",
		authorizationVersion: null,
		initialPromptState: "pending",
		initialPromptMessageId: null,
		activeRunId: null,
		nextWakeAt: null,
		version: 0,
		lastErrorCode: null,
		lastError: null,
		stoppedAt: null,
		queueHandoff: null,
		preQueueDiagnostic: null,
		updatedAt: new Date(0).toISOString(),
	};
}

export function mergeMissionPilotControl(
	current: MissionPilotControlSummary | null | undefined,
	incoming: MissionPilotControlSummary,
) {
	return current && current.version > incoming.version ? current : incoming;
}

export function optimisticMissionPilotSummary(
	current: MissionPilotControlSummary,
	action: "play" | "stop",
): MissionPilotControlSummary {
	return {
		...current,
		desiredState: action === "play" ? "playing" : "stopped",
		activityState: action === "play" ? "starting" : "stopping",
		phase: action === "play" ? "starting" : "stopping",
		version: current.version + 1,
		lastError: null,
	};
}
