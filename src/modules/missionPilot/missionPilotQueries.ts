import type { MissionPilotControlSummary } from "../../../shared/schemas/mission-pilot.schema";
import type { Task } from "../nightworkers/types";
export function mergeMissionPilotSummary(
	tasks: Task[],
	taskId: string,
	incoming: MissionPilotControlSummary,
) {
	return tasks.map((task) =>
		task.id !== taskId ||
		(task.missionPilot && task.missionPilot.version > incoming.version)
			? task
			: { ...task, missionPilot: incoming },
	);
}

export function mergeTaskPreservingMissionPilot(
	current: Task | undefined,
	incoming: Task,
) {
	if (!current?.missionPilot || incoming.missionPilot) return incoming;
	return { ...incoming, missionPilot: current.missionPilot };
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
