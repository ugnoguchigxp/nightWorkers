import type { MissionPilotAgentRunProvenance } from "../../../shared/modules/missionPilot";
import type { TaskRunAssociationRequest } from "../agentsShare";
import type { ReviewTargetManifestContext } from "./review-target-manifest";

export type ReviewRunMissionInput = {
	targetRunIds?: string[];
	targetManifestContext?: ReviewTargetManifestContext;
	missionPilot?: Record<string, unknown>;
	missionPilotAgent?: MissionPilotAgentRunProvenance;
	runAssociation?: TaskRunAssociationRequest;
	reviewCorrection?: Record<string, unknown>;
};
