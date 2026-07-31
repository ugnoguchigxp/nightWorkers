export type MissionPilotAvailability =
	| { status: "ready" }
	| {
			status: "unavailable";
			stage: "storage" | "runtime";
			errorCode:
				| "MISSION_PILOT_STORAGE_UNAVAILABLE"
				| "MISSION_PILOT_RUNTIME_UNAVAILABLE";
	  };

let availability: MissionPilotAvailability = { status: "ready" };

export function getMissionPilotAvailability(): MissionPilotAvailability {
	return availability;
}

export function markMissionPilotReady() {
	availability = { status: "ready" };
}

export function markMissionPilotUnavailable(
	stage: "storage" | "runtime",
): Extract<MissionPilotAvailability, { status: "unavailable" }> {
	availability = {
		status: "unavailable",
		stage,
		errorCode:
			stage === "storage"
				? "MISSION_PILOT_STORAGE_UNAVAILABLE"
				: "MISSION_PILOT_RUNTIME_UNAVAILABLE",
	};
	return availability;
}
