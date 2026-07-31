import type { MissionPilotControlSummary } from "./session";

export type MissionPilotFrontendClient = {
	getControl(taskId: string): Promise<MissionPilotControlSummary>;
	play(taskId: string, expectedVersion: number): Promise<MissionPilotControlSummary>;
	stop(taskId: string, expectedVersion: number): Promise<MissionPilotControlSummary>;
};
