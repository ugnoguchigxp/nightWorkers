import {
	createMissionPilotFixtureRouter,
	createMissionPilotRouter,
	type MissionPilotBackendDependencies,
} from "@nightworkers/mission-pilot/backend";
import { serializeApiError } from "../../lib/api-error-response";
import { AppError } from "../../lib/errors";
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
		if (availability.status === "unavailable") {
			const error = serializeApiError(
				new AppError(
					503,
					"MISSION_PILOT_UNAVAILABLE",
					"Mission Pilot is unavailable.",
					{
						stage: availability.stage,
						reasonCode: availability.errorCode,
					},
				),
			);
			return context.json(error.body, error.status);
		}
		return next();
	});
	return composed.route("/", router);
}
