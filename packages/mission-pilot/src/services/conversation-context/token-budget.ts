export const MISSION_PILOT_USAGE_ESTIMATE_ALGORITHM_VERSION =
	"characters_div_4_v1";

export function estimateMissionPilotUsageTokens(value: string) {
	return Math.ceil(value.length / 4);
}

// Retained for existing callers while each new consumer names its estimate purpose.
export const estimateTokens = estimateMissionPilotUsageTokens;
