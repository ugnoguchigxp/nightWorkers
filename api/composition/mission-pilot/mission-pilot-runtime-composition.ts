import type { MissionPilotRuntimeDependencies } from "@nightworkers/mission-pilot/backend";
import { startMissionPilotRuntime } from "@nightworkers/mission-pilot/backend";
import {
	getMissionPilotAvailability,
	markMissionPilotReady,
	markMissionPilotUnavailable,
} from "./mission-pilot-availability";

export async function startComposedMissionPilotRuntime(
	dependencies: MissionPilotRuntimeDependencies,
) {
	if (getMissionPilotAvailability().status === "unavailable")
		return { async stop() {} };
	try {
		const runtime = await startMissionPilotRuntime(dependencies);
		markMissionPilotReady();
		return runtime;
	} catch (error) {
		const availability = markMissionPilotUnavailable("runtime");
		dependencies.host.logger.error("Mission Pilot runtime is unavailable.", {
			errorCode: availability.errorCode,
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return { async stop() {} };
	}
}
