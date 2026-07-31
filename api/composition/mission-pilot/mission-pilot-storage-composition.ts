import {
	bootstrapMissionPilotStorage,
	type MissionPilotStorageDependencies,
} from "@nightworkers/mission-pilot/backend";

export function bootstrapComposedMissionPilotStorage(
	dependencies: MissionPilotStorageDependencies,
) {
	return bootstrapMissionPilotStorage(dependencies);
}
