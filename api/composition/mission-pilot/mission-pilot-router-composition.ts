import {
	createMissionPilotRouter,
	type MissionPilotBackendDependencies,
} from "@nightworkers/mission-pilot/backend";

export function createComposedMissionPilotRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	return createMissionPilotRouter(dependencies);
}
