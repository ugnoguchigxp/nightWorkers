import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import { buildMissionTaskCandidateSnapshot } from "../api/modules/mission-pilot/mission-pilot-approval";
import * as missionPlannerRepo from "../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import { missionDecompositionPlanningResultSchema } from "../shared/schemas/mission-planner.schema";

const roots: string[] = [];
beforeAll(async () => ensureNightWorkersSchema());
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

async function post(url: string, body: unknown) {
	return app.request(`http://localhost${url}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function executableFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-autopilot-"));
	roots.push(root);
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission Autopilot ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
		queueEnabled: false,
	});
	const mission = await missionPlannerRepo.createMission({
		repositoryId: repository.id,
		title: "Level 1 Autopilot",
		goalText: "承認済みTaskだけを進める",
		nonGoals: [],
		sourceGoalIds: [],
	});
	const run = await missionPlannerRepo.createRunningDecompositionRun({
		missionId: mission.id,
		repositoryId: repository.id,
		inputBundle: {},
	});
	const result = missionDecompositionPlanningResultSchema.parse({
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: { title: mission.title, goal: mission.goalText, nonGoals: [] },
		objectives: [
			{
				id: "objective-autopilot",
				title: "Approved execution",
				completionCriteria: ["queued"],
				verificationGate: ["autopilot test"],
			},
		],
		workPackages: [
			{
				id: "wp-autopilot",
				title: "Autopilot",
				purpose: "enqueue one",
				relatedObjectiveIds: ["objective-autopilot"],
				suggestedPlanMode: false,
				risk: "low",
				approvalRequired: true,
				verificationGate: ["autopilot test"],
			},
		],
		taskProposals: [
			{
				id: "task-autopilot",
				title: "Approved task",
				summary: "Queueへ投入する",
				purpose: "one action tick",
				workPackageId: "wp-autopilot",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-pilot"],
				initialPrompt: "実装する",
				expectedOutcome: "Queueへ入る",
				implementationFocus: ["autopilot"],
				acceptanceCriteria: ["one action"],
				verificationGate: ["autopilot test"],
				risk: "low",
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
	const stored = await missionPlannerRepo.createPlanningResult({
		missionId: mission.id,
		repositoryId: repository.id,
		decompositionRunId: run.id,
		status: "review_pending",
		planningResult: result,
	});
	await missionPlannerRepo.updateMission(mission.id, {
		status: "review_pending",
		latestPlanningResultId: stored.id,
	});
	const [proposal] = await missionPlannerRepo.createTaskProposals([
		{
			missionId: mission.id,
			repositoryId: repository.id,
			planningResultId: stored.id,
			workPackageId: "wp-autopilot",
			decompositionTaskId: "task-autopilot",
			status: "proposed",
			title: "Approved task",
			summary: "Queueへ投入する",
			initialPrompt: "実装する",
			expectedOutcome: "Queueへ入る",
			implementationFocusJson: ["autopilot"],
			acceptanceCriteriaJson: ["one action"],
			verificationGateJson: ["autopilot test"],
			dependenciesJson: [],
			targetFilesOrModulesJson: ["api/modules/mission-pilot"],
			risk: "low",
			approvalRequired: true,
			schedulingJson: result.taskProposals[0].scheduling,
		},
	]);
	await missionPilotRepo.upsertObjectivesFromPlanningResult({
		missionId: mission.id,
		repositoryId: repository.id,
		planningResult: stored,
	});
	const snapshot = buildMissionTaskCandidateSnapshot(proposal);
	let approval = await missionPilotRepo.createApproval({
		missionId: mission.id,
		repositoryId: repository.id,
		targetType: "task_candidate",
		targetId: proposal.id,
		approvalType: "queue_admission",
		riskLevel: "low",
		approvalRequired: true,
		requestedReason: "approved fixture",
		requestedByActor: { type: "human", id: null, displayName: "User" },
		snapshot: snapshot.snapshot,
		snapshotHash: snapshot.hash,
	});
	approval = await missionPilotRepo.decideApproval({
		approvalId: approval.id,
		status: "approved",
		actor: { type: "human", id: null, displayName: "User" },
		reason: "approved",
	});
	if (!approval) throw new Error("Approval fixture failed");
	const materialized = await post(
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
	return { mission, materialized: materializedBody };
}

async function approveAutopilot(missionId: string) {
	const allowedActions = ["enqueue_approved_task"] as const;
	const requested = await post(`/api/missions/${missionId}/approvals`, {
		targetType: "mission",
		targetId: missionId,
		approvalType: "autopilot_start",
		autopilotConfig: { autonomyLevel: 1, allowedActions },
		reason: "Level 1 approved executionを開始する",
		idempotencyKey: crypto.randomUUID(),
	});
	const requestedBody = (await requested.json()) as {
		approval: { id: string };
	};
	const approved = await post(
		`/api/missions/${missionId}/approvals/${requestedBody.approval.id}/approve`,
		{ reason: "開始を承認する", idempotencyKey: crypto.randomUUID() },
	);
	expect(approved.status).toBe(200);
	return { approvalId: requestedBody.approval.id, allowedActions };
}

describe("Mission Pilot Level 1 Autopilot", () => {
	it("starts only from human approval and one tick enqueues at most one approved task", async () => {
		const { mission, materialized } = await executableFixture();
		const config = await approveAutopilot(mission.id);
		const startKey = crypto.randomUUID();
		const started = await post(`/api/missions/${mission.id}/autopilot/start`, {
			autonomyLevel: 1,
			allowedActions: config.allowedActions,
			approvalId: config.approvalId,
			idempotencyKey: startKey,
		});
		expect(started.status).toBe(200);
		const grant = (await started.json()) as { id: string; status: string };
		expect(grant.status).toBe("active");
		const tickKey = crypto.randomUUID();
		const tick = await post(`/api/missions/${mission.id}/autopilot/tick`, {
			idempotencyKey: tickKey,
		});
		expect(await tick.json()).toMatchObject({
			action: "enqueue_approved_task",
		});
		const replay = await post(`/api/missions/${mission.id}/autopilot/tick`, {
			idempotencyKey: tickKey,
		});
		expect(await replay.json()).toMatchObject({
			action: "enqueue_approved_task",
		});
		expect(
			await queueRepo.hasActiveImplementationQueueEntry(materialized.task.id),
		).toBe(true);
	});

	it("supports pause, resume, revoke, and rejects autonomy above Level 1", async () => {
		const { mission } = await executableFixture();
		const config = await approveAutopilot(mission.id);
		await post(`/api/missions/${mission.id}/autopilot/start`, {
			autonomyLevel: 1,
			allowedActions: config.allowedActions,
			approvalId: config.approvalId,
			idempotencyKey: crypto.randomUUID(),
		});
		const paused = await post(`/api/missions/${mission.id}/autopilot/pause`, {
			idempotencyKey: crypto.randomUUID(),
		});
		expect((await paused.json()).status).toBe("paused");
		const stopped = await post(`/api/missions/${mission.id}/autopilot/tick`, {
			idempotencyKey: crypto.randomUUID(),
		});
		expect(await stopped.json()).toMatchObject({ action: "stopped" });
		const resumed = await post(`/api/missions/${mission.id}/autopilot/resume`, {
			idempotencyKey: crypto.randomUUID(),
		});
		expect((await resumed.json()).status).toBe("active");
		const revoked = await post(`/api/missions/${mission.id}/autopilot/revoke`, {
			idempotencyKey: crypto.randomUUID(),
		});
		expect((await revoked.json()).status).toBe("revoked");
		const invalid = await post(`/api/missions/${mission.id}/autopilot/start`, {
			autonomyLevel: 2,
			allowedActions: ["enqueue_approved_task"],
			approvalId: config.approvalId,
			idempotencyKey: crypto.randomUUID(),
		});
		expect(invalid.status).toBe(400);
	});
});
