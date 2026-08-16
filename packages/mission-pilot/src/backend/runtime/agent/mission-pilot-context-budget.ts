import {
	MISSION_PILOT_CONTEXT_HARD_TOKENS,
	MISSION_PILOT_CONTEXT_SOFT_TOKENS,
} from "./mission-pilot-agent.constants";

export type MissionPilotContextBudgets = {
	softTokenBudget: number;
	hardTokenBudget: number;
};

export function resolveMissionPilotContextBudgets(input: {
	softTokenBudget?: number;
	hardTokenBudget?: number;
}): MissionPilotContextBudgets {
	const hardTokenBudget =
		input.hardTokenBudget ?? MISSION_PILOT_CONTEXT_HARD_TOKENS;
	const softTokenBudget =
		input.softTokenBudget ??
		Math.min(MISSION_PILOT_CONTEXT_SOFT_TOKENS, hardTokenBudget);
	if (
		!Number.isSafeInteger(softTokenBudget) ||
		!Number.isSafeInteger(hardTokenBudget) ||
		softTokenBudget < 1 ||
		hardTokenBudget < 1 ||
		softTokenBudget > hardTokenBudget
	) {
		throw new Error(
			"MISSION_PILOT_CONTEXT_TOKEN_BUDGET_INVALID: softTokenBudget must be a positive integer less than or equal to hardTokenBudget.",
		);
	}
	return { softTokenBudget, hardTokenBudget };
}
