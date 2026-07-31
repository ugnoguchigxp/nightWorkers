import type { MissionPilotHostPorts } from "@nightworkers/mission-pilot/contracts";
import {
	bootstrapMissionPilotTables,
	type MissionPilotSqlClient,
} from "../../modules/missionPilot/persistence/bootstrap";
import {
	markMissionPilotReady,
	markMissionPilotUnavailable,
} from "./mission-pilot-availability";

export async function bootstrapComposedMissionPilotStorage(dependencies: {
	client: MissionPilotSqlClient;
	logger: MissionPilotHostPorts["logger"];
}) {
	try {
		await bootstrapMissionPilotTables(dependencies.client);
		markMissionPilotReady();
		return { status: "ready" as const };
	} catch (error) {
		const availability = markMissionPilotUnavailable("storage");
		dependencies.logger.error("Mission Pilot storage is unavailable.", {
			errorCode: availability.errorCode,
			errorMessage: error instanceof Error ? error.message : String(error),
		});
		return { ...availability, error };
	}
}
