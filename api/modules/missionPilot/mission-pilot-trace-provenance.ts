import { eq } from "drizzle-orm";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { db } from "../../db/client";
import { missionPilotPhaseRuns } from "../../db/mission-pilot-schema";
import { registerRunOrchestrationRefResolver } from "../agentsShare";

type MissionPilotArtifactRef = {
	sessionId: string;
	phaseRunId?: string;
	phase?: string;
	cycle?: number;
	attempt?: number;
};

export function missionPilotArtifactTrace(
	input: MissionPilotArtifactRef,
): TraceProvenance {
	return {
		owner: "mission_pilot",
		channel: "artifact",
		producer: {
			kind: "structured_llm",
			role: "mission_pilot",
		},
		orchestrationRef: {
			kind: "mission_pilot",
			...input,
		},
	};
}

registerRunOrchestrationRefResolver(async (runId) => {
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, runId))
		.limit(1);
	if (!phaseRun) return null;
	return {
		kind: "mission_pilot",
		sessionId: phaseRun.sessionId,
		phaseRunId: phaseRun.id,
		phase: phaseRun.phase,
		cycle: phaseRun.cycle,
		attempt: phaseRun.attempt,
	};
});
