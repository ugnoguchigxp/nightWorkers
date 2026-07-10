import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../api/app";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionTaskProposals } from "../api/db/mission-planner-schema";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import * as missionPlannerRepo from "../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { missionDecompositionPlanningResultSchema } from "../shared/schemas/mission-planner.schema";

const roots: string[] = [];

beforeAll(async () => ensureNightWorkersSchema());
afterAll(() => {
	for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-approval-"));
	roots.push(root);
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: Mission approval ${crypto.randomUUID()}`,
		localPath: root,
		branch: "main",
		queueEnabled: false,
	});
	const mission = await missionPlannerRepo.createMission({
		repositoryId: repository.id,
		title: "Approval boundary",
		goalText: "Snapshot-bound approvalを検証する。",
		nonGoals: [],
		sourceGoalIds: [],
	});
	const run = await missionPlannerRepo.createRunningDecompositionRun({
		missionId: mission.id,
		repositoryId: repository.id,
		inputBundle: {},
	});
	const planningResult = missionDecompositionPlanningResultSchema.parse({
		schemaVersion: "nightworkers.mission-decomposition-result/v1",
		mission: { title: mission.title, goal: mission.goalText, nonGoals: [] },
		objectives: [
			{
				id: "objective-approval",
				title: "承認境界を作る",
				completionCriteria: ["Decision is auditable"],
				verificationGate: ["focused test"],
			},
		],
		workPackages: [
			{
				id: "wp-approval",
				title: "Approval",
				purpose: "Queue前の判断を固定する",
				relatedObjectiveIds: ["objective-approval"],
				suggestedPlanMode: false,
				risk: "high",
				approvalRequired: true,
				verificationGate: ["focused test"],
			},
		],
		taskProposals: [
			{
				id: "task-approval",
				title: "承認対象を実装する",
				summary: "Snapshotを固定する",
				purpose: "Stale approvalを防ぐ",
				workPackageId: "wp-approval",
				dependencies: [],
				targetFilesOrModules: ["api/modules/mission-pilot"],
				initialPrompt: "承認境界を実装する",
				expectedOutcome: "承認を監査できる",
				implementationFocus: ["snapshot"],
				acceptanceCriteria: ["stale detection"],
				verificationGate: ["focused test"],
				risk: "high",
				approvalRequired: true,
				scheduling: {
					executionType: "exclusive",
					reason: "shared schema",
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
		planningResult,
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
			workPackageId: "wp-approval",
			decompositionTaskId: "task-approval",
			status: "proposed",
			title: "承認対象を実装する",
			summary: "Snapshotを固定する",
			initialPrompt: "承認境界を実装する",
			expectedOutcome: "承認を監査できる",
			implementationFocusJson: ["snapshot"],
			acceptanceCriteriaJson: ["stale detection"],
			verificationGateJson: ["focused test"],
			dependenciesJson: [],
			targetFilesOrModulesJson: ["api/modules/mission-pilot"],
			risk: "high",
			approvalRequired: true,
			schedulingJson: planningResult.taskProposals[0].scheduling,
		},
	]);
	return { mission: await missionPlannerRepo.getMission(mission.id), proposal };
}

async function requestApproval(missionId: string, proposalId: string) {
	const request = {
		targetType: "task_candidate",
		targetId: proposalId,
		approvalType: "queue_admission",
		reason: "Queue投入前に確認する",
		idempotencyKey: crypto.randomUUID(),
	};
	const response = await app.request(
		`http://localhost/api/missions/${missionId}/approvals`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		},
	);
	return { response, request };
}

describe("Mission Pilot approval", () => {
	it("persists one snapshot-bound request and resolves Attention on approval", async () => {
		const { mission, proposal } = await fixture();
		if (!mission) throw new Error("Mission fixture missing");
		const { response, request } = await requestApproval(
			mission.id,
			proposal.id,
		);
		expect(response.status).toBe(201);
		const body = (await response.json()) as {
			approval: { id: string; snapshotHash: string };
		};
		expect(body.approval.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

		const replay = await app.request(
			`http://localhost/api/missions/${mission.id}/approvals`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
			},
		);
		expect(replay.status).toBe(200);
		expect((await replay.json()).approval.id).toBe(body.approval.id);

		const approved = await app.request(
			`http://localhost/api/missions/${mission.id}/approvals/${body.approval.id}/approve`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reason: "実行を承認する",
					idempotencyKey: crypto.randomUUID(),
				}),
			},
		);
		expect(approved.status).toBe(200);
		expect((await approved.json()).status).toBe("approved");
		const attention = await missionPilotRepo.listAttentionItems(mission.id);
		expect(attention).toMatchObject([{ status: "resolved" }]);
	});

	it("marks the approval stale and records the decision when the candidate changes", async () => {
		const { mission, proposal } = await fixture();
		if (!mission) throw new Error("Mission fixture missing");
		const { response } = await requestApproval(mission.id, proposal.id);
		const body = (await response.json()) as { approval: { id: string } };
		await db
			.update(missionTaskProposals)
			.set({ title: "変更後のTaskCandidate", updatedAt: new Date() })
			.where(eq(missionTaskProposals.id, proposal.id));

		const stale = await app.request(
			`http://localhost/api/missions/${mission.id}/approvals/${body.approval.id}/approve`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reason: "承認する",
					idempotencyKey: crypto.randomUUID(),
				}),
			},
		);
		expect(stale.status).toBe(409);
		expect((await missionPilotRepo.getApproval(body.approval.id))?.status).toBe(
			"stale",
		);
		expect(
			(await missionPilotRepo.listAttentionItems(mission.id))[0]?.status,
		).toBe("resolved");
		expect(
			(await missionPilotRepo.listMissionEvents(mission.id)).map(
				(event) => event.eventType,
			),
		).toContain("approval_stale");
	});

	it("allows only one concurrent approval decision to commit", async () => {
		const { mission, proposal } = await fixture();
		if (!mission) throw new Error("Mission fixture missing");
		const { response } = await requestApproval(mission.id, proposal.id);
		const body = (await response.json()) as { approval: { id: string } };
		const decide = (decision: "approve" | "reject") =>
			app.request(
				`http://localhost/api/missions/${mission.id}/approvals/${body.approval.id}/${decision}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						reason: `Concurrent ${decision}`,
						idempotencyKey: crypto.randomUUID(),
					}),
				},
			);
		const responses = await Promise.all([decide("approve"), decide("reject")]);
		expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
		const events = await missionPilotRepo.listMissionEvents(mission.id);
		expect(
			events.filter((event) =>
				["approval_approved", "approval_rejected"].includes(event.eventType),
			),
		).toHaveLength(1);
	});

	it("deduplicates concurrent open requests for the same snapshot", async () => {
		const { mission, proposal } = await fixture();
		if (!mission) throw new Error("Mission fixture missing");
		const responses = await Promise.all([
			requestApproval(mission.id, proposal.id),
			requestApproval(mission.id, proposal.id),
		]);
		expect(responses.map(({ response }) => response.status).sort()).toEqual([
			200, 201,
		]);
		expect(await missionPilotRepo.listApprovals(mission.id)).toHaveLength(1);
	});
});
