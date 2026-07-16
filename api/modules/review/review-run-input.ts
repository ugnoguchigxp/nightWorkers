import type { MissionPilotAgentRunProvenance } from "../../../shared/schemas/mission-pilot-agent.schema";
import type { ReviewTargetManifestContext } from "./review-target-manifest";

export type ReviewRunMissionInput = {
	targetRunIds?: string[];
	targetManifestContext?: ReviewTargetManifestContext;
	missionPilot?: Record<string, unknown>;
	missionPilotAgent?: MissionPilotAgentRunProvenance;
	reviewCorrection?: Record<string, unknown>;
};
