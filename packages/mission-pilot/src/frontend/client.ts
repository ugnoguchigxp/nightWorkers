import {
	type MissionPilotFrontendClient,
	missionPilotControlSummarySchema,
} from "../contracts";
import { getMissionPilotFrontendHost } from "./host";

export function createMissionPilotFrontendClient(
	request = getMissionPilotFrontendHost().request,
): MissionPilotFrontendClient {
	return {
		async getControl(taskId) {
			const response = await request(`/api/mission-pilot/tasks/${taskId}`);
			if (!response.ok) throw await responseError(response);
			const payload: unknown = await response.json();
			return payload === null
				? null
				: missionPilotControlSummarySchema.parse(payload);
		},
		async play(taskId, expectedVersion) {
			return command(request, taskId, "play", expectedVersion);
		},
		async stop(taskId, expectedVersion) {
			return command(request, taskId, "stop", expectedVersion);
		},
	};
}

async function command(
	request: (input: string, init?: RequestInit) => Promise<Response>,
	taskId: string,
	action: "play" | "stop",
	expectedVersion: number,
) {
	const response = await request(
		`/api/mission-pilot/tasks/${taskId}/${action}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedVersion }),
		},
	);
	if (!response.ok) throw await responseError(response);
	const payload = (await response.json()) as { missionPilot?: unknown };
	return missionPilotControlSummarySchema.parse(payload.missionPilot);
}

async function responseError(response: Response) {
	const message = await response.text();
	return new Error(
		message || `Mission Pilot request failed (${response.status})`,
	);
}
