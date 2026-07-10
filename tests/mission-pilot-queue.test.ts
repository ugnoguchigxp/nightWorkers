import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionTaskProposals } from "../api/db/mission-planner-schema";
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

async function fixture(approved: boolean) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-queue-"));
	roots.push(root);
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission queue ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
		queueEnabled: false,
	});
	const mission = await missionPlannerRepo.createMission({
		repositoryId: repository.id,
		title: "Queue bridge",
		goalText: "Approved candidateをQueueへ接続する",
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
				id: "objective-queue",
				title: "Queueへ接続",
				completionCriteria: ["queued"],
				verificationGate: ["queue test"],
			},
		],
		workPackages: [
			{
				id: "wp-queue",
				title: "Queue",
				purpose: "Queue bridge",
				relatedObjectiveIds: ["objective-queue"],
				suggestedPlanMode: false,
				risk: "high",
				approvalRequired: true,
				verificationGate: ["queue test"],
			},
		],
		taskProposals: [
			{
				id: "task-queue",
				title: "Queue bridgeを実装",
				summary: "MissionTaskを作る",
				purpose: "Queue投入",
				workPackageId: "wp-queue",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-pilot"],
				initialPrompt: "Queue bridgeを実装する",
				expectedOutcome: "一度だけQueueへ入る",
				implementationFocus: ["queue"],
				acceptanceCriteria: ["approved only"],
				verificationGate: ["queue test"],
				risk: "high",
				approvalRequired: true,
				scheduling: {
					executionType: "exclusive",
					reason: "shared queue",
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
			workPackageId: "wp-queue",
			decompositionTaskId: "task-queue",
			status: "proposed",
			title: "Queue bridgeを実装",
			summary: "MissionTaskを作る",
			initialPrompt: "Queue bridgeを実装する",
			expectedOutcome: "一度だけQueueへ入る",
			implementationFocusJson: ["queue"],
			acceptanceCriteriaJson: ["approved only"],
			verificationGateJson: ["queue test"],
			dependenciesJson: [],
			targetFilesOrModulesJson: ["api/modules/mission-pilot"],
			risk: "high",
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
		riskLevel: proposal.risk,
		approvalRequired: true,
		requestedReason: "Queue admission",
		requestedByActor: { type: "human", id: null, displayName: "User" },
		snapshot: snapshot.snapshot,
		snapshotHash: snapshot.hash,
	});
	if (approved)
		approval = await missionPilotRepo.decideApproval({
			approvalId: approval.id,
			status: "approved",
			actor: { type: "human", id: null, displayName: "User" },
			reason: "Approved",
		});
	return { mission, proposal, approval };
}

async function post(url: string, body: unknown) {
	return app.request(`http://localhost${url}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("Mission Pilot Queue bridge", () => {
	it("materializes and enqueues an approved TaskCandidate exactly once", async () => {
		const { mission, proposal, approval } = await fixture(true);
		const materializeKey = crypto.randomUUID();
		const materialized = await post(
			`/api/missions/${mission.id}/task-candidates/${proposal.id}/materialize`,
			{
				approvalId: approval.id,
				mode: "ready",
				idempotencyKey: materializeKey,
			},
		);
		expect(materialized.status).toBe(200);
		const first = (await materialized.json()) as {
			missionTask: { id: string; nightworkersTaskId: string; status: string };
			task: { id: string };
		};
		expect(first.missionTask.status).toBe("task_created");
		expect(first.missionTask.nightworkersTaskId).toBe(first.task.id);
		const messages = await nightworkersRepo.listTaskMessages(first.task.id);
		expect(messages[0]?.metadataJson).toMatchObject({
			source: "mission_pilot",
			missionPilot: { approvalId: approval.id },
		});

		const replay = await post(
			`/api/missions/${mission.id}/task-candidates/${proposal.id}/materialize`,
			{
				approvalId: approval.id,
				mode: "ready",
				idempotencyKey: materializeKey,
			},
		);
		expect((await replay.json()).missionTask.id).toBe(first.missionTask.id);

		const enqueueKey = crypto.randomUUID();
		const queued = await post(
			`/api/missions/${mission.id}/tasks/${first.missionTask.id}/enqueue`,
			{ idempotencyKey: enqueueKey },
		);
		expect(queued.status).toBe(200);
		const queuedBody = (await queued.json()) as {
			missionTask: { status: string; queueEntryId: string };
			queueEntry: { id: string; executionType: string };
		};
		expect(queuedBody.missionTask.status).toBe("queued");
		expect(queuedBody.missionTask.queueEntryId).toBe(queuedBody.queueEntry.id);
		expect(queuedBody.queueEntry.executionType).toBe("exclusive");
		const enqueueReplay = await post(
			`/api/missions/${mission.id}/tasks/${first.missionTask.id}/enqueue`,
			{ idempotencyKey: enqueueKey },
		);
		expect((await enqueueReplay.json()).queueEntry.id).toBe(
			queuedBody.queueEntry.id,
		);
	});

	it("rejects unapproved materialization and does not allow the legacy boolean to bypass a stale Mission Pilot approval", async () => {
		const pending = await fixture(false);
		const denied = await post(
			`/api/missions/${pending.mission.id}/task-candidates/${pending.proposal.id}/materialize`,
			{
				approvalId: pending.approval.id,
				mode: "ready",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		expect(denied.status).toBe(409);

		const current = await fixture(true);
		const materialized = await post(
			`/api/missions/${current.mission.id}/task-candidates/${current.proposal.id}/materialize`,
			{
				approvalId: current.approval.id,
				mode: "ready",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		const body = (await materialized.json()) as { task: { id: string } };
		await db
			.update(missionTaskProposals)
			.set({ title: "Changed after materialization", updatedAt: new Date() })
			.where(eq(missionTaskProposals.id, current.proposal.id));
		const bypass = await post("/api/implementation-queue/entries", {
			taskId: body.task.id,
			approveMissionProposal: true,
		});
		expect(bypass.status).toBe(409);
		expect((await bypass.json()).code).toBe("MISSION_APPROVAL_REQUIRED");
	});

	it("enforces Mission lifecycle on the public Queue endpoint", async () => {
		const current = await fixture(true);
		const materialized = await post(
			`/api/missions/${current.mission.id}/task-candidates/${current.proposal.id}/materialize`,
			{
				approvalId: current.approval.id,
				mode: "ready",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		const body = (await materialized.json()) as { task: { id: string } };
		await missionPlannerRepo.updateMission(current.mission.id, {
			status: "completed",
		});
		const denied = await post("/api/implementation-queue/entries", {
			taskId: body.task.id,
			approveMissionProposal: true,
		});
		expect(denied.status).toBe(409);
		expect((await denied.json()).code).toBe("MISSION_APPROVAL_REQUIRED");
	});

	it("compensates a Queue entry when Mission linkage fails and permits retry", async () => {
		const current = await fixture(true);
		const materialized = await post(
			`/api/missions/${current.mission.id}/task-candidates/${current.proposal.id}/materialize`,
			{
				approvalId: current.approval.id,
				mode: "ready",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		const body = (await materialized.json()) as {
			missionTask: { id: string };
			task: { id: string };
		};
		const original = missionPilotRepo.updateMissionTask;
		const spy = vi
			.spyOn(missionPilotRepo, "updateMissionTask")
			.mockRejectedValueOnce(new Error("forced linkage failure"));
		const failed = await post(
			`/api/missions/${current.mission.id}/tasks/${body.missionTask.id}/enqueue`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		expect(failed.status).toBe(500);
		spy.mockImplementation(original);
		expect(
			await queueRepo.hasActiveImplementationQueueEntry(body.task.id),
		).toBe(false);
		expect((await nightworkersRepo.getTask(body.task.id))?.status).toBe(
			"ready",
		);
		const retry = await post(
			`/api/missions/${current.mission.id}/tasks/${body.missionTask.id}/enqueue`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		expect(retry.status).toBe(200);
	});
});
