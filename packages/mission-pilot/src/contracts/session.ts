export type MissionPilotControlSummary = {
	sessionId: string;
	taskId: string;
	desiredState: "playing" | "stopped";
	phase: string;
	version: number;
	lastActivityAt: string | null;
	nextEligibleAt: string | null;
};
