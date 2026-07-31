import type {
	MissionPilotControlSummary,
	MissionPilotPlanProgress,
} from "../../contracts";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";

export function publishMissionPilotUpdated(
	taskId: string,
	missionPilot: MissionPilotControlSummary,
) {
	nightWorkersRealtimeBroker.publish(taskId, {
		type: "mission_pilot.updated",
		payload: { taskId, missionPilot },
	});
}

export function publishMissionPilotPlanProgressUpdated(
	taskId: string,
	progress: MissionPilotPlanProgress,
) {
	nightWorkersRealtimeBroker.publish(taskId, {
		type: "mission_pilot.plan_progress_updated",
		payload: { taskId, progress },
	});
}
