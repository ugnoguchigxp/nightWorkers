import type { MissionPilotControlSummary } from "../../../shared/schemas/mission-pilot.schema";
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
