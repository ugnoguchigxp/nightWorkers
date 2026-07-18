type CodingAgentRunLike = {
	contextSnapshot?: unknown | null;
};

export type CodingAgentRunMode = "plan" | "implementation";

export function readCodingAgentRunMode(
	run: CodingAgentRunLike | null | undefined,
): CodingAgentRunMode {
	const snapshot = record(run?.contextSnapshot);
	return snapshot?.planModeRequested === true ? "plan" : "implementation";
}

export function isStandaloneCodingAgentPlanRun(
	run: CodingAgentRunLike | null | undefined,
) {
	return readCodingAgentRunMode(run) === "plan";
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
