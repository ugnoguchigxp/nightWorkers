import type { MissionPilotSourceRef } from "../../../shared/schemas/mission-pilot.schema";
import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
export function createMissionPilotTask(input: {
	repositoryId: string;
	sourceRef: MissionPilotSourceRef;
}) {
	return apiFetch("/api/mission-pilot/tasks", jsonRequest("POST", input));
}
export function playMissionPilotTask(taskId: string, expectedVersion: number) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/play`,
		jsonRequest("POST", { expectedVersion }),
	);
}
export function stopMissionPilotTask(taskId: string, expectedVersion: number) {
	return apiFetch(
		`/api/mission-pilot/tasks/${taskId}/stop`,
		jsonRequest("POST", { expectedVersion }),
	);
}
