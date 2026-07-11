import type { MissionPilotControlSummary } from "../../../shared/schemas/mission-pilot.schema";
export function missionPilotPresentation(summary: MissionPilotControlSummary) {
	const busy =
		summary.activityState === "starting" ||
		summary.activityState === "stopping";
	const hasUnstoppedRun = Boolean(summary.activeRunId);
	return {
		busy,
		playing: summary.desiredState === "playing",
		canPlay: !busy && summary.desiredState === "stopped" && !hasUnstoppedRun,
		canStop: !busy && (summary.desiredState === "playing" || hasUnstoppedRun),
	};
}
