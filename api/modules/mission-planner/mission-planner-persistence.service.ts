import type {
	Mission,
	MissionPlanningResult,
} from "../../../shared/schemas/mission-planner.schema";
import type { DbTransaction } from "../../db/client";
import * as repo from "./mission-planner.repository";

export async function persistReviewPendingProposals(
	input: {
		mission: Mission;
		planningResult: MissionPlanningResult;
	},
	database?: DbTransaction,
) {
	const existing = await repo.listTaskProposals(
		input.planningResult.id,
		database,
	);
	const existingDecompositionTaskIds = new Set(
		existing.map((proposal) => proposal.decompositionTaskId),
	);
	const rows = input.planningResult.planningResult.taskProposals
		.filter((proposal) => !existingDecompositionTaskIds.has(proposal.id))
		.map((proposal) => ({
			missionId: input.mission.id,
			planningResultId: input.planningResult.id,
			repositoryId: input.mission.repositoryId,
			workPackageId: proposal.workPackageId,
			decompositionTaskId: proposal.id,
			status: "proposed",
			title: proposal.title,
			summary: proposal.summary,
			initialPrompt: proposal.initialPrompt,
			expectedOutcome: proposal.expectedOutcome,
			implementationFocusJson: proposal.implementationFocus,
			acceptanceCriteriaJson: proposal.acceptanceCriteria,
			verificationGateJson: proposal.verificationGate,
			dependenciesJson: proposal.dependencies,
			targetFilesOrModulesJson: proposal.targetFilesOrModules,
			risk: proposal.risk,
			approvalRequired: proposal.approvalRequired,
			schedulingJson: proposal.scheduling,
		}));
	return repo.createTaskProposals(rows, database);
}
