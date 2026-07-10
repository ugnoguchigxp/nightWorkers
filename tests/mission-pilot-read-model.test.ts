import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import * as missionPlannerRepo from "../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import type { MissionPilotDetail } from "../shared/schemas/mission-pilot.schema";
import {
	type MissionPlanningResult,
	missionDecompositionPlanningResultSchema,
} from "../shared/schemas/mission-planner.schema";

const repoRoots: string[] = [];

beforeAll(async () => ensureNightWorkersSchema());
afterAll(() => {
	for (const root of repoRoots)
		fs.rmSync(root, { recursive: true, force: true });
});

function createRepoRoot() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-pilot-read-"));
	repoRoots.push(root);
	return root;
}

async function createReviewPendingMission() {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission Pilot read model ${crypto.randomUUID()}`,
		localPath: createRepoRoot(),
		branch: "main",
		queueEnabled: false,
	});
	const mission = await missionPlannerRepo.createMission({
		repositoryId: repository.id,
		title: "Read-only cockpit",
		goalText: "Mission Pilotの現在状態を読む。",
		nonGoals: ["mutation commandは追加しない。"],
		sourceGoalIds: [],
	});
	const run = await missionPlannerRepo.createRunningDecompositionRun({
		missionId: mission.id,
		repositoryId: repository.id,
		inputBundle: {},
	});
	const planningResult = missionDecompositionPlanningResultSchema.parse({
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: {
			title: mission.title,
			goal: mission.goalText,
			nonGoals: mission.nonGoals,
		},
		objectives: [
			{
				id: "objective-read-model",
				title: "Cockpitを表示する",
				completionCriteria: ["ObjectiveとTaskCandidateを表示できる。"],
				verificationGate: ["GETでmutationが発生しない。"],
			},
		],
		workPackages: [
			{
				id: "wp-read-model",
				title: "Read model",
				purpose: "既存状態を統合する。",
				relatedObjectiveIds: ["objective-read-model"],
				suggestedPlanMode: false,
				risk: "medium",
				approvalRequired: true,
				verificationGate: ["focused test"],
			},
		],
		taskProposals: [
			{
				id: "task-read-model",
				title: "Read modelを追加する",
				summary: "Mission Pilot detailを返す。",
				purpose: "Cockpitのbackend contractを作る。",
				workPackageId: "wp-read-model",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-pilot"],
				initialPrompt: "Read-only Mission Pilot detailを実装する。",
				expectedOutcome: "GETで現在状態を取得できる。",
				implementationFocus: ["read model"],
				acceptanceCriteria: ["GET is read-only"],
				verificationGate: ["focused test"],
				risk: "medium",
				approvalRequired: true,
				scheduling: {
					executionType: "exclusive",
					reason: "Shared schema",
					sequenceGroupId: null,
					sequenceOrder: null,
					dependsOnTaskIds: [],
				},
			},
		],
		replanningUnits: [],
	});
	const storedResult = await missionPlannerRepo.createPlanningResult({
		missionId: mission.id,
		repositoryId: repository.id,
		decompositionRunId: run.id,
		status: "review_pending",
		planningResult,
		statusReason: "review_ready",
	});
	await missionPlannerRepo.updateMission(mission.id, {
		status: "review_pending",
		latestPlanningResultId: storedResult.id,
	});
	await missionPlannerRepo.createTaskProposals([
		{
			missionId: mission.id,
			repositoryId: repository.id,
			planningResultId: storedResult.id,
			workPackageId: "wp-read-model",
			decompositionTaskId: "task-read-model",
			status: "proposed",
			title: "Read modelを追加する",
			summary: "Mission Pilot detailを返す。",
			initialPrompt: "Read-only Mission Pilot detailを実装する。",
			expectedOutcome: "GETで現在状態を取得できる。",
			implementationFocusJson: ["read model"],
			acceptanceCriteriaJson: ["GET is read-only"],
			verificationGateJson: ["focused test"],
			dependenciesJson: [],
			targetFilesOrModulesJson: ["api/modules/mission-pilot"],
			risk: "medium",
			approvalRequired: true,
			schedulingJson: planningResult.taskProposals[0].scheduling,
		},
	]);
	await missionPilotRepo.upsertObjectivesFromPlanningResult({
		missionId: mission.id,
		repositoryId: repository.id,
		planningResult: storedResult as MissionPlanningResult,
	});
	await missionPilotRepo.appendMissionEvent({
		missionId: mission.id,
		repositoryId: repository.id,
		eventType: "mission_decomposed",
		summary: "Mission decompositionがreview-readyになりました。",
		actor: { type: "system", id: null, displayName: "Mission Planner" },
		sourceKind: "planning_result",
		sourceId: storedResult.id,
	});
	return mission;
}

describe("Mission Pilot read model", () => {
	it("returns Objective, proposal-only TaskCandidate, derived attention, and timeline without mutating", async () => {
		const mission = await createReviewPendingMission();
		const before = await client.execute(
			`SELECT
        (SELECT count(*) FROM mission_objectives WHERE mission_id = '${mission.id}') AS objectives,
        (SELECT count(*) FROM mission_events WHERE mission_id = '${mission.id}') AS events`,
		);

		const first = await app.request(
			`http://localhost/api/missions/${mission.id}/pilot-detail`,
		);
		expect(first.status).toBe(200);
		const detail = (await first.json()) as MissionPilotDetail;
		expect(detail.objectives).toHaveLength(1);
		expect(detail.taskCandidates).toMatchObject([
			{
				source: "mission_task_proposal",
				approvalRequired: true,
			},
		]);
		expect(detail.attentionItems).toHaveLength(1);
		expect(detail.events).toHaveLength(1);

		const second = await app.request(
			`http://localhost/api/missions/${mission.id}/pilot-detail`,
		);
		expect(second.status).toBe(200);
		const after = await client.execute(
			`SELECT
        (SELECT count(*) FROM mission_objectives WHERE mission_id = '${mission.id}') AS objectives,
        (SELECT count(*) FROM mission_events WHERE mission_id = '${mission.id}') AS events`,
		);
		expect(after.rows).toEqual(before.rows);
	});
});
