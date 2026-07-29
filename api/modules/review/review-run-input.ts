import type { TaskRunAssociationRequest } from "../agentsShare";
import type { ReviewTargetManifestContext } from "./review-target-manifest";

export type ReviewRunMissionInput = {
	targetRunIds?: string[];
	targetManifestContext?: ReviewTargetManifestContext;
	runAssociation?: TaskRunAssociationRequest;
	reviewCorrection?: Record<string, unknown>;
};
