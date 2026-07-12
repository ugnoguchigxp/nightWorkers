import type {
	CreateTasksFromMissionTaskProposalsResponse,
	Mission,
	MissionPlanningResult,
	MissionProposalTaskMetadata,
	MissionTaskProposal,
} from "../../../shared/schemas/mission-planner.schema";
import { missionProposalTaskMetadataSchema } from "../../../shared/schemas/mission-planner.schema";
import { type DbTransaction, db } from "../../db/client";
import { NotFoundError, ValidationError } from "../../lib/errors";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { createTaskWithMissionPilot } from "../nightworkers/nightworkers.task-creation.service";
import * as repo from "./mission-planner.repository";

function workPackageForProposal(
	planningResult: MissionPlanningResult,
	proposal: MissionTaskProposal,
) {
	return planningResult.planningResult.workPackages.find(
		(workPackage) => workPackage.id === proposal.workPackageId,
	);
}

function buildTaskObjective(input: {
	proposal: MissionTaskProposal;
	planningResult: MissionPlanningResult;
}) {
	const workPackage = workPackageForProposal(
		input.planningResult,
		input.proposal,
	);
	if (!workPackage?.suggestedPlanMode) return input.proposal.initialPrompt;
	return [
		"この Mission proposal は、まず実装計画を作成してください。",
		"Plan 完了後に Implementation Queue へ入れて実装する前提で、Queue 実行者が迷わない粒度にしてください。",
		"",
		"[Mission proposal initial prompt]",
		input.proposal.initialPrompt,
	].join("\n");
}

function buildTaskDescription(input: {
	mission: Mission;
	proposal: MissionTaskProposal;
	planningResult: MissionPlanningResult;
}) {
	const workPackage = workPackageForProposal(
		input.planningResult,
		input.proposal,
	);
	return [
		input.proposal.summary,
		"",
		`Source Mission: ${input.mission.id}`,
		`Planning Result: ${input.planningResult.id}`,
		`Work Package: ${workPackage?.title ?? input.proposal.workPackageId} (${input.proposal.workPackageId})`,
		`Expected outcome: ${input.proposal.expectedOutcome}`,
		`Risk: ${input.proposal.risk}`,
		`Approval required: ${input.proposal.approvalRequired ? "yes" : "no"}`,
		input.proposal.dependencies.length
			? `Dependencies:\n${input.proposal.dependencies.map((dependency) => `- ${dependency}`).join("\n")}`
			: "Dependencies: none",
		input.proposal.implementationFocus.length
			? `Implementation focus:\n${input.proposal.implementationFocus.map((focus) => `- ${focus}`).join("\n")}`
			: null,
	]
		.filter(Boolean)
		.join("\n");
}

function buildAcceptanceCriteria(proposal: MissionTaskProposal) {
	return [
		...proposal.acceptanceCriteria,
		"",
		"Verification gate:",
		...proposal.verificationGate.map((gate) => `- ${gate}`),
	].join("\n");
}

function metadataForProposal(
	proposal: MissionTaskProposal,
): MissionProposalTaskMetadata {
	return missionProposalTaskMetadataSchema.parse({
		source: "mission_task_proposal",
		missionId: proposal.missionId,
		planningResultId: proposal.planningResultId,
		proposalId: proposal.id,
		workPackageId: proposal.workPackageId,
		decompositionTaskId: proposal.decompositionTaskId,
		dependencies: proposal.dependencies,
		risk: proposal.risk,
		approvalRequired: proposal.approvalRequired,
		scheduling: proposal.scheduling,
	});
}

type MissionPlannerDb = typeof db | DbTransaction;

async function persistMissionProposalTasks(input: {
	mode: "draft" | "ready";
	proposals: MissionTaskProposal[];
	planningResults: Map<string, MissionPlanningResult>;
	missions: Map<string, Mission>;
	database: MissionPlannerDb;
	transaction: DbTransaction;
}) {
	const created = [];
	const updatedProposals = [];
	for (let index = 0; index < input.proposals.length; index += 1) {
		const proposal = input.proposals[index];
		const planningResult = input.planningResults.get(proposal.planningResultId);
		const mission = input.missions.get(proposal.missionId);
		if (!planningResult || !mission) continue;
		const task = await createTaskWithMissionPilot(
			{
				repositoryId: proposal.repositoryId,
				title: proposal.title,
				description: buildTaskDescription({
					mission,
					proposal,
					planningResult,
				}),
				objective: buildTaskObjective({ proposal, planningResult }),
				acceptanceCriteria: buildAcceptanceCriteria(proposal),
				status: input.mode,
				priority: input.proposals.length - index,
				createdBy: "mission-task-proposal",
				missionPilotSourceRef: {
					source: "mission_task_proposal",
					id: proposal.id,
				},
			},
			input.transaction,
		);
		await nightworkersRepo.createTaskMessage(
			{
				taskId: task.id,
				role: "system",
				content: "Mission task proposal metadata attached.",
				messageType: "text",
				payloadJson: {
					source: "mission_task_proposal",
					missionProposal: metadataForProposal(proposal),
				},
			},
			input.database,
		);
		const updated = await repo.updateTaskProposal(
			proposal.id,
			{ status: "task_created", taskId: task.id },
			input.database,
		);
		created.push(task);
		if (updated) updatedProposals.push(updated);
		if (mission.status === "review_pending") {
			await repo.updateMission(
				mission.id,
				{ status: "active", statusReason: null },
				input.database,
			);
		}
	}
	return { tasks: created, proposals: updatedProposals };
}

export async function createTasksFromMissionTaskProposals(input: {
	proposalIds: string[];
	mode: "draft" | "ready";
}): Promise<CreateTasksFromMissionTaskProposalsResponse> {
	const uniqueProposalIds = [...new Set(input.proposalIds)];
	const foundProposals = await repo.getTaskProposalsByIds(uniqueProposalIds);
	if (foundProposals.length !== uniqueProposalIds.length) {
		throw new NotFoundError("Mission task proposal not found");
	}
	const proposalById = new Map(
		foundProposals.map((proposal) => [proposal.id, proposal]),
	);
	const proposals = uniqueProposalIds
		.map((proposalId) => proposalById.get(proposalId))
		.filter((proposal): proposal is MissionTaskProposal => Boolean(proposal));
	const repositoryIds = new Set(
		proposals.map((proposal) => proposal.repositoryId),
	);
	if (repositoryIds.size !== 1) {
		throw new ValidationError(
			"Selected Mission task proposals must belong to one repository",
		);
	}
	for (const proposal of proposals) {
		if (proposal.status === "task_created" || proposal.taskId) {
			throw new ValidationError(
				"Mission task proposal already has a linked task",
				{
					proposalId: proposal.id,
				},
			);
		}
		if (proposal.status === "dismissed") {
			throw new ValidationError(
				"Dismissed Mission task proposals cannot be converted to tasks",
				{
					proposalId: proposal.id,
				},
			);
		}
	}

	const planningResults = new Map<string, MissionPlanningResult>();
	const missions = new Map<string, Mission>();
	for (const proposal of proposals) {
		const planningResult = await repo.getPlanningResult(
			proposal.planningResultId,
		);
		if (!planningResult)
			throw new NotFoundError("Mission planning result not found");
		const mission = await repo.getMission(proposal.missionId);
		if (!mission) throw new NotFoundError("Mission not found");
		if (planningResult.status !== "review_pending") {
			throw new ValidationError(
				"Mission task proposals can only be converted from review_pending planning results",
				{
					planningResultId: planningResult.id,
					status: planningResult.status,
				},
			);
		}
		if (mission.latestPlanningResultId !== planningResult.id) {
			throw new ValidationError(
				"Mission task proposal belongs to a stale planning result",
				{
					missionId: mission.id,
					planningResultId: planningResult.id,
					latestPlanningResultId: mission.latestPlanningResultId,
				},
			);
		}
		planningResults.set(planningResult.id, planningResult);
		missions.set(mission.id, mission);
	}

	return db.transaction((tx) =>
		persistMissionProposalTasks({
			mode: input.mode,
			proposals,
			planningResults,
			missions,
			database: tx,
			transaction: tx,
		}),
	);
}
