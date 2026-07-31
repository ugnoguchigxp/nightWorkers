import {
	createMissionPilotFixtureRouter,
	createMissionPilotRouter,
	type MissionPilotBackendDependencies,
} from "@nightworkers/mission-pilot/backend";
import { createOpenApiRouter } from "../../lib/openapi";
import { getMissionPilotAvailability } from "./mission-pilot-availability";

export function createComposedMissionPilotRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	return wrapMissionPilotRouter(createMissionPilotRouter(dependencies));
}

export function createComposedMissionPilotFixtureRouter(
	dependencies: MissionPilotBackendDependencies,
) {
	return wrapMissionPilotRouter(createMissionPilotFixtureRouter(dependencies));
}

function wrapMissionPilotRouter(
	router: ReturnType<typeof createMissionPilotRouter>,
) {
	const composed = createOpenApiRouter();
	composed.use("*", async (context, next) => {
		const availability = getMissionPilotAvailability();
		if (availability.status === "unavailable")
			return context.json(
				{
					error: "Mission Pilot is unavailable.",
					code: "MISSION_PILOT_UNAVAILABLE",
					details: {
						stage: availability.stage,
						reasonCode: availability.errorCode,
					},
				},
				503,
			);
		return next();
	});
	return composed.route("/", router);
}
