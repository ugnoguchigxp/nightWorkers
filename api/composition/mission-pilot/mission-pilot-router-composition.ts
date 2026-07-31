import {
	createMissionPilotFixtureRouter,
	createMissionPilotRouter,
	type MissionPilotBackendDependencies,
} from "@nightworkers/mission-pilot/backend";

export function createComposedMissionPilotRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	return createMissionPilotRouter(dependencies);
}

export function createComposedMissionPilotFixtureRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	return createMissionPilotFixtureRouter(dependencies);
}
