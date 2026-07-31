import { getMissionPilotFrontendHost } from "./host";

function request(input: string, init?: RequestInit) {
	return getMissionPilotFrontendHost().request(input, init);
}

function jsonRequest(method: "PATCH" | "POST", body: unknown): RequestInit {
	return {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	};
}

export function playMissionPilotTask(taskId: string, expectedVersion: number) {
	return request(
		`/api/mission-pilot/tasks/${taskId}/play`,
		jsonRequest("POST", { expectedVersion }),
	);
}
export function stopMissionPilotTask(taskId: string, expectedVersion: number) {
	return request(
		`/api/mission-pilot/tasks/${taskId}/stop`,
		jsonRequest("POST", { expectedVersion }),
	);
}
export function fetchMissionPilotControl(taskId: string, signal?: AbortSignal) {
	return request(`/api/mission-pilot/tasks/${taskId}`, { signal });
}
export function fetchMissionPilotPlanProgress(taskId: string) {
	return request(`/api/mission-pilot/tasks/${taskId}/plan-progress`);
}
export function fetchMissionPilotExecutionTrace(taskId: string) {
	return request(`/api/mission-pilot/tasks/${taskId}/execution`);
}
