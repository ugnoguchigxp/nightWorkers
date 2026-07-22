import type { MissionPilotAgentRunProvenance } from "../../../shared/modules/missionPilot";
import type { TaskExecutionType } from "./queue-repository-row-mapper";

export type CreateImplementationQueueEntryData = {
	taskId: string;
	repositoryId: string;
	priority?: number;
	queuePosition?: number | null;
	executionType?: TaskExecutionType;
	executionLockKey?: string | null;
	sequenceGroupId?: string | null;
	sequenceOrder?: number | null;
	sequenceDependsOnEntryId?: string | null;
	schedulingReason?: string | null;
	missionPilotAdmissionKey?: string | null;
	missionPilotAgent?: MissionPilotAgentRunProvenance | null;
	claimReady?: boolean;
	workspaceId?: string | null;
	workspaceRequired?: boolean;
};
