import type { MissionPilotControlSummary } from "./session";

export type MissionPilotRealtimeEvent = {
	type: "mission_pilot.updated";
	taskId: string;
	payload: MissionPilotControlSummary;
};

export type MissionPilotRealtimeExtensionHandler = (
	event: unknown,
) => boolean;
