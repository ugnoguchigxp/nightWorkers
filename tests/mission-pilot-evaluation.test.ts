import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as missionPilotRepo from "../api/modules/mission-pilot/mission-pilot.repository";
import * as missionPlannerRepo from "../api/modules/mission-planner/mission-planner.repository";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { completeImplementationQueueEntryForRun } from "../api/modules/nightworkers/run-orchestration/queues";
import * as queueRepo from "../api/modules/queue/queue.repository";
import {
	cleanupMissionPilotFixtureRoots,
	createMissionPilotExecutionFixture,
	postMissionPilot,
} from "./helpers/mission-pilot-fixture";

beforeAll(async () => ensureNightWorkersSchema());
afterAll(cleanupMissionPilotFixtureRoots);

async function attachCompletedRun(input: {
	missionTaskId: string;
	taskId: string;
	repositoryId: string;
	verificationPassed?: boolean;
}) {
	const queueEntry = await queueRepo.createImplementationQueueEntry({
		taskId: input.taskId,
		repositoryId: input.repositoryId,
		executionType: "exclusive",
	});
	const run = await nightworkersRepo.createTaskRun({
		taskId: input.taskId,
		repositoryId: input.repositoryId,
		status: "completed",
		workerKind: "fixture",
		summary: "completed",
		startedAt: new Date(),
		endedAt: new Date(),
		finishedAt: new Date(),
	});
	await queueRepo.updateImplementationQueueEntry(queueEntry.id, {
		status: "execution_completed",
		activeRunId: run.id,
	});
	await missionPilotRepo.updateMissionTask(input.missionTaskId, {
		status: "queued",
		queueEntryId: queueEntry.id,
		activeRunId: run.id,
	});
	if (input.verificationPassed !== undefined) {
		await nightworkersRepo.createTaskEvent({
			taskRunId: run.id,
			type: "checkpoint",
			eventType: "checkpoint",
			message: "verification finished",
			payloadJson: {
				event: {
					type: "verification.finished",
					data: { passed: input.verificationPassed },
				},
			},
		});
	}
	return { queueEntry, run };
}

describe("Mission Pilot evidence sync and evaluation", () => {
	it("best-effort lifecycle hook synchronizes a finalized Mission Pilot Run", async () => {
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
			status: "processing",
			activeRunId: run.id,
		});
		await missionPilotRepo.updateMissionTask(fixture.missionTaskId, {
			status: "running",
			queueEntryId: queueEntry.id,
			activeRunId: run.id,
		});
		await completeImplementationQueueEntryForRun(run.id, "completed");
		expect(
			(await missionPilotRepo.getMissionTask(fixture.missionTaskId))?.status,
		).toBe("awaiting_evaluation");
	});

	it("satisfies Objectives and completes Mission only with successful verification evidence", async () => {
		const fixture = await createMissionPilotExecutionFixture();
		await attachCompletedRun({
			missionTaskId: fixture.missionTaskId,
			taskId: fixture.taskId,
			repositoryId: fixture.repository.id,
			verificationPassed: true,
		});
		const synced = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/sync-execution`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		expect(synced.status).toBe(200);
		expect((await synced.json()).missionTasks[0].status).toBe(
			"awaiting_evaluation",
		);
		const evaluateKey = crypto.randomUUID();
		const evaluated = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/evaluate`,
			{ idempotencyKey: evaluateKey },
		);
		expect(evaluated.status).toBe(200);
		const result = await evaluated.json();
		expect(result.evaluations[0].result).toBe("completed");
		expect(result.mission.status).toBe("completed");
		expect(
			(await missionPilotRepo.listObjectives(fixture.mission.id))[0]?.status,
		).toBe("satisfied");
		const replay = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/evaluate`,
			{ idempotencyKey: evaluateKey },
		);
		expect((await replay.json()).evaluations[0].id).toBe(
			result.evaluations[0].id,
		);
	});

	it("vetoes completion when verification fails and creates human Attention", async () => {
		const fixture = await createMissionPilotExecutionFixture();
		await attachCompletedRun({
			missionTaskId: fixture.missionTaskId,
			taskId: fixture.taskId,
			repositoryId: fixture.repository.id,
			verificationPassed: false,
		});
		const evaluated = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/evaluate`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		const result = await evaluated.json();
		expect(result.evaluations[0].result).toBe("failed");
		expect(result.mission.status).not.toBe("completed");
		expect(
			(await missionPilotRepo.listAttentionItems(fixture.mission.id)).some(
				(item) => item.type === "verification_failed" && item.status === "open",
			),
		).toBe(true);
	});

	it("does not satisfy an Objective from Run completion alone", async () => {
		const fixture = await createMissionPilotExecutionFixture();
		await attachCompletedRun({
			missionTaskId: fixture.missionTaskId,
			taskId: fixture.taskId,
			repositoryId: fixture.repository.id,
		});
		const evaluated = await postMissionPilot(
			`/api/missions/${fixture.mission.id}/evaluate`,
			{ idempotencyKey: crypto.randomUUID() },
		);
		const result = await evaluated.json();
		expect(result.evaluations[0].result).toBe("progressed");
		expect(result.mission.status).not.toBe("completed");
		expect(
			(await missionPlannerRepo.getMission(fixture.mission.id))?.completedAt,
		).toBeNull();
	});
});
