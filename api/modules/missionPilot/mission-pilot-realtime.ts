import type { MissionPilotControlSummary } from "../../../shared/schemas/mission-pilot.schema";
import type { MissionPilotPlanProgress } from "../../../shared/schemas/mission-pilot-plan-progress.schema";
import type { taskMessages } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";

type TaskMessage = typeof taskMessages.$inferSelect;

export function publishMissionPilotUpdated(
	taskId: string,
	missionPilot: MissionPilotControlSummary,
) {
	nightWorkersRealtimeBroker.publish(taskId, {
		type: "mission_pilot.updated",
		payload: { taskId, missionPilot },
	});
}

export function publishMissionPilotInitialPrompt(message: TaskMessage) {
	nightWorkersRealtimeBroker.publish(message.taskId, {
		type: "task_message_created",
		payload: { message },
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
