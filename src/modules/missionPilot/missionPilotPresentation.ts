import type { MissionPilotControlSummary } from "../../../shared/modules/missionPilot";
export function missionPilotPresentation(summary: MissionPilotControlSummary) {
	const busy =
		summary.activityState === "starting" ||
		summary.activityState === "stopping";
	const hasUnstoppedRun = Boolean(summary.activeRunId);
	const hasUnstoppedRuntime =
		summary.lastErrorCode === "MISSION_PILOT_RUNTIME_STOP_TIMEOUT";
	return {
		busy,
		attention: summary.activityState === "attention",
		diagnostic: summary.preQueueDiagnostic,
		playing: summary.desiredState === "playing",
		canPlay:
			!busy &&
			summary.desiredState === "stopped" &&
			!hasUnstoppedRun &&
			!hasUnstoppedRuntime,
		canStop:
			!busy &&
			(summary.desiredState === "playing" ||
				hasUnstoppedRun ||
				hasUnstoppedRuntime),
	};
}
