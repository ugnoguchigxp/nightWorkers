import type { MissionPilotControlSummary } from "./mission-pilot.schema";

export type MissionPilotFrontendClient = {
	getControl(taskId: string): Promise<MissionPilotControlSummary | null>;
	play(
		taskId: string,
		expectedVersion: number,
	): Promise<MissionPilotControlSummary>;
	stop(
		taskId: string,
		expectedVersion: number,
	): Promise<MissionPilotControlSummary>;
};
