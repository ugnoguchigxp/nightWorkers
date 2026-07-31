import type {
	MissionPilotRuntimeDependencies,
} from "@nightworkers/mission-pilot/backend";
import { startMissionPilotRuntime } from "@nightworkers/mission-pilot/backend";

export function startComposedMissionPilotRuntime(
	dependencies: MissionPilotRuntimeDependencies,
) {
	return startMissionPilotRuntime(dependencies);
}
