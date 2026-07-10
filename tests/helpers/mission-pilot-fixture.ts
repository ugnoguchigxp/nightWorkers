import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import app from "../../api/app";
import * as missionPilotRepo from "../../api/modules/mission-pilot/mission-pilot.repository";
import { buildMissionTaskCandidateSnapshot } from "../../api/modules/mission-pilot/mission-pilot-approval";
import * as missionPlannerRepo from "../../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../../api/modules/nightworkers/nightworkers.repository";
import { missionDecompositionPlanningResultSchema } from "../../shared/schemas/mission-planner.schema";

export const missionPilotFixtureRoots: string[] = [];

export function cleanupMissionPilotFixtureRoots() {
	for (const root of missionPilotFixtureRoots)
		fs.rmSync(root, { recursive: true, force: true });
}

export async function postMissionPilot(url: string, body: unknown) {
	return app.request(`http://localhost${url}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

export async function createMissionPilotExecutionFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-evidence-"));
	missionPilotFixtureRoots.push(root);
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission evidence ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
		queueEnabled: false,
	});
	const mission = await missionPlannerRepo.createMission({
		repositoryId: repository.id,
		title: "Mission evidence fixture",
		goalText: "Execution evidenceでObjectiveを評価する",
		nonGoals: [],
		sourceGoalIds: [],
	});
	const decompositionRun =
		await missionPlannerRepo.createRunningDecompositionRun({
			missionId: mission.id,
			repositoryId: repository.id,
			inputBundle: {},
		});
	const planning = missionDecompositionPlanningResultSchema.parse({
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: { title: mission.title, goal: mission.goalText, nonGoals: [] },
		objectives: [
			{
				id: "objective-evidence",
				title: "Evidenceで完了判定する",
				completionCriteria: ["verified"],
				verificationGate: ["tests pass"],
			},
		],
		workPackages: [
			{
				id: "wp-evidence",
				title: "Evidence",
				purpose: "deterministic evaluation",
				relatedObjectiveIds: ["objective-evidence"],
				suggestedPlanMode: false,
				risk: "medium",
				approvalRequired: true,
				verificationGate: ["tests pass"],
			},
		],
		taskProposals: [
			{
				id: "task-evidence",
				title: "Evidence task",
				summary: "Evidenceを作る",
				purpose: "evaluate",
				workPackageId: "wp-evidence",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-pilot"],
				initialPrompt: "実装して検証する",
				expectedOutcome: "verified",
				implementationFocus: ["evidence"],
				acceptanceCriteria: ["tests pass"],
				verificationGate: ["tests pass"],
				risk: "medium",
				approvalRequired: true,
				scheduling: {
					executionType: "exclusive",
					reason: "controlled",
					sequenceGroupId: null,
					sequenceOrder: null,
					dependsOnTaskIds: [],
				},
			},
		],
		replanningUnits: [],
	});
	const planningResult = await missionPlannerRepo.createPlanningResult({
		missionId: mission.id,
		repositoryId: repository.id,
		decompositionRunId: decompositionRun.id,
		status: "review_pending",
		planningResult: planning,
	});
	await missionPlannerRepo.updateMission(mission.id, {
		status: "review_pending",
		latestPlanningResultId: planningResult.id,
	});
	const [proposal] = await missionPlannerRepo.createTaskProposals([
		{
			missionId: mission.id,
			repositoryId: repository.id,
			planningResultId: planningResult.id,
			workPackageId: "wp-evidence",
			decompositionTaskId: "task-evidence",
			status: "proposed",
			title: "Evidence task",
			summary: "Evidenceを作る",
			initialPrompt: "実装して検証する",
			expectedOutcome: "verified",
			implementationFocusJson: ["evidence"],
			acceptanceCriteriaJson: ["tests pass"],
			verificationGateJson: ["tests pass"],
			dependenciesJson: [],
			targetFilesOrModulesJson: ["api/modules/mission-pilot"],
			risk: "medium",
			approvalRequired: true,
			schedulingJson: planning.taskProposals[0].scheduling,
		},
	]);
	const [objective] = await missionPilotRepo.upsertObjectivesFromPlanningResult(
		{
			missionId: mission.id,
			repositoryId: repository.id,
			planningResult,
		},
	);
	const snapshot = buildMissionTaskCandidateSnapshot(proposal);
	let approval = await missionPilotRepo.createApproval({
		missionId: mission.id,
		repositoryId: repository.id,
		targetType: "task_candidate",
		targetId: proposal.id,
		approvalType: "queue_admission",
		riskLevel: proposal.risk,
		approvalRequired: true,
		requestedReason: "fixture",
		requestedByActor: { type: "human", id: null, displayName: "User" },
		snapshot: snapshot.snapshot,
		snapshotHash: snapshot.hash,
	});
	approval = await missionPilotRepo.decideApproval({
		approvalId: approval.id,
		status: "approved",
		actor: { type: "human", id: null, displayName: "User" },
		reason: "fixture",
	});
	if (!approval) throw new Error("Fixture approval failed");
	const materialized = await postMissionPilot(
		`/api/missions/${mission.id}/task-candidates/${proposal.id}/materialize`,
		{
			approvalId: approval.id,
			mode: "ready",
			idempotencyKey: crypto.randomUUID(),
		},
	);
	const materializedBody = (await materialized.json()) as {
		missionTask: { id: string };
		task: { id: string };
	};
	return {
		repository,
		mission,
		planningResult,
		proposal,
		objective,
		missionTaskId: materializedBody.missionTask.id,
		taskId: materializedBody.task.id,
	};
}
