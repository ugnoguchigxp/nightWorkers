import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import {
	ensureCurrentPlanRevision,
	validateMissionTaskGraphDiff,
} from "../api/modules/mission-pilot/mission-pilot-replan";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import * as queueRepo from "../api/modules/queue/queue.repository";
import {
	cleanupMissionPilotFixtureRoots,
	createMissionPilotExecutionFixture,
	postMissionPilot,
} from "./helpers/mission-pilot-fixture";

beforeAll(async () => ensureNightWorkersSchema());
afterAll(cleanupMissionPilotFixtureRoots);

async function createFailedEvaluation() {
	const fixture = await createMissionPilotExecutionFixture();
	const queueEntry = await queueRepo.createImplementationQueueEntry({
		taskId: fixture.taskId,
		repositoryId: fixture.repository.id,
		executionType: "exclusive",
	});
	const run = await nightworkersRepo.createTaskRun({
		taskId: fixture.taskId,
		repositoryId: fixture.repository.id,
		status: "completed",
		workerKind: "fixture",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	await queueRepo.updateImplementationQueueEntry(queueEntry.id, {
		status: "execution_completed",
		activeRunId: run.id,
	});
	await missionPilotRepo.updateMissionTask(fixture.missionTaskId, {
		status: "queued",
		queueEntryId: queueEntry.id,
		activeRunId: run.id,
	});
	await nightworkersRepo.createTaskEvent({
		taskRunId: run.id,
		type: "checkpoint",
		eventType: "checkpoint",
		message: "verification failed",
		payloadJson: {
			event: { type: "verification.finished", data: { passed: false } },
		},
	});
	const response = await postMissionPilot(
		`/api/missions/${fixture.mission.id}/evaluate`,
		{ idempotencyKey: crypto.randomUUID() },
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		evaluations: Array<{ id: string }>;
	};
	return { ...fixture, evaluationId: body.evaluations[0].id };
}

describe("Mission Pilot replan", () => {
	it("creates an unapplied suggestion from failure and applies it only after approval", async () => {
		const fixture = await createFailedEvaluation();
		const suggested = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/replan-suggestions`,
			{
				evaluationId: fixture.evaluationId,
				idempotencyKey: crypto.randomUUID(),
			},
		);
		expect(suggested.status).toBe(200);
		const suggestionBody = (await suggested.json()) as {
			suggestion: { id: string; status: string };
			revision: {
				id: string;
				revisionNumber: number;
				planningResultId: string;
			};
		};
		expect(suggestionBody.suggestion.status).toBe("awaiting_approval");
		expect(suggestionBody.revision.revisionNumber).toBe(1);
		expect(
			(await missionPilotRepo.listAttentionItems(fixture.mission.id)).some(
				(item) => item.type === "replan_approval_required",
			),
		).toBe(true);

		const beforeApply = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/replan-suggestions/${suggestionBody.suggestion.id}/apply`,
			{ approvalId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
		);
		expect(beforeApply.status).toBe(404);

		const approvalResponse = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/approvals`,
			{
				targetType: "replan_suggestion",
				targetId: suggestionBody.suggestion.id,
				approvalType: "replan",
				reason: "差分を確認する",
				idempotencyKey: crypto.randomUUID(),
			},
		);
		expect(approvalResponse.status).toBe(201);
		const { approval } = (await approvalResponse.json()) as {
			approval: { id: string };
		};
		const approved = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/approvals/${approval.id}/approve`,
			{ reason: "差分を承認する", idempotencyKey: crypto.randomUUID() },
		);
		expect(approved.status).toBe(200);
		const applyKey = crypto.randomUUID();
		const applied = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/replan-suggestions/${suggestionBody.suggestion.id}/apply`,
			{ approvalId: approval.id, idempotencyKey: applyKey },
		);
		expect(applied.status).toBe(200);
		const appliedBody = (await applied.json()) as {
			suggestion: { status: string };
			revision: { id: string; revisionNumber: number };
		};
		expect(appliedBody.suggestion.status).toBe("applied");
		expect(appliedBody.revision.revisionNumber).toBe(2);
		const replay = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/replan-suggestions/${suggestionBody.suggestion.id}/apply`,
			{ approvalId: approval.id, idempotencyKey: applyKey },
		);
		expect(
			((await replay.json()) as { revision: { id: string } }).revision.id,
		).toBe(appliedBody.revision.id);
	});

	it("rejects dependency cycles and active MissionTask mutation", async () => {
		const fixture = await createMissionPilotExecutionFixture();
		const revision = await ensureCurrentPlanRevision(fixture.mission.id);
		const newCandidate = {
			id: "follow-up",
			workPackageId: "wp-evidence",
			title: "Follow up",
			summary: "Follow up",
			purpose: "test",
			dependencies: ["task-evidence"],
			targetFilesOrModules: [],
			initialPrompt: "test",
			expectedOutcome: "test",
			implementationFocus: [],
			acceptanceCriteria: ["test"],
			verificationGate: ["test"],
			risk: "low" as const,
			approvalRequired: true,
			scheduling: {
				executionType: "exclusive" as const,
				reason: "test",
				sequenceGroupId: null,
				sequenceOrder: null,
				dependsOnTaskIds: [],
			},
		};
		await expect(
			validateMissionTaskGraphDiff({
				missionId: fixture.mission.id,
				baseRevision: revision,
				operations: [
					{ op: "add_candidate", candidate: newCandidate },
					{
						op: "add_dependency",
						candidateId: "task-evidence",
						dependsOnCandidateId: "follow-up",
					},
				],
			}),
		).rejects.toMatchObject({ code: "MISSION_REPLAN_DEPENDENCY_CYCLE" });
		await missionPilotRepo.updateMissionTask(fixture.missionTaskId, {
			status: "running",
		});
		await expect(
			validateMissionTaskGraphDiff({
				missionId: fixture.mission.id,
				baseRevision: revision,
				operations: [
					{
						op: "update_candidate",
						candidateId: "task-evidence",
						patch: { title: "mutated" },
					},
				],
			}),
		).rejects.toMatchObject({ code: "MISSION_REPLAN_ACTIVE_TASK_MUTATION" });
	});
});
