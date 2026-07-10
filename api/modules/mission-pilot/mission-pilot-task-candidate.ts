import {
	type MissionPilotTaskCandidate,
	missionPilotTaskCandidateSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import type { MissionTaskProposal } from "../../../shared/schemas/mission-planner.schema";

export function toMissionPilotTaskCandidate(
	proposal: MissionTaskProposal,
): MissionPilotTaskCandidate {
	return missionPilotTaskCandidateSchema.parse({
		source: "mission_task_proposal",
		missionId: proposal.missionId,
		planningResultId: proposal.planningResultId,
		taskCandidateId: proposal.id,
		workPackageId: proposal.workPackageId,
		decompositionTaskId: proposal.decompositionTaskId,
		status: proposal.status,
		title: proposal.title,
		summary: proposal.summary,
		initialPrompt: proposal.initialPrompt,
		expectedOutcome: proposal.expectedOutcome,
		implementationFocus: proposal.implementationFocus,
		acceptanceCriteria: proposal.acceptanceCriteria,
		verificationGate: proposal.verificationGate,
		dependencies: proposal.dependencies,
		targetFilesOrModules: proposal.targetFilesOrModules,
		risk: proposal.risk,
		approvalRequired: proposal.approvalRequired,
		scheduling: proposal.scheduling,
		taskId: proposal.taskId,
		createdAt: proposal.createdAt,
		updatedAt: proposal.updatedAt,
	});
}
