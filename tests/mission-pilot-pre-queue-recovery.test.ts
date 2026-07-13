import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import {
	repositories,
	taskEvents,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../api/db/schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import { reconcileMissionPilotPreQueueSessions } from "../api/modules/missionPilot/mission-pilot-pre-queue-recovery.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Mission Pilot pre-Queue recovery", () => {
	it("does not classify a Session that already owns a post-Queue phase run", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const phaseRunId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const now = new Date();
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot post-Queue boundary",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		const session = await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Post-Queue Test attention",
					objective: "Keep startup recovery in the post-Queue coordinator",
					status: "needs_review",
				})
				.returning();
			return createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		await db.insert(taskRuns).values({
			id: runId,
			taskId,
			repositoryId,
			status: "completed",
			finishedAt: now,
		});
		await db.insert(missionPilotPhaseRuns).values({
			id: phaseRunId,
			sessionId: session.id,
			taskId,
			phase: "test",
			cycle: 1,
			attempt: 1,
			runId,
			inputContextRevision: session.contextRevision,
			inputContextDigest: session.contextDigest,
			status: "failed",
			verdict: "attention",
			evidenceJson: {},
			startedAt: now,
			finishedAt: now,
		});
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "attention",
				activePhaseRunId: phaseRunId,
				version: 4,
			})
			.where(eq(missionPilotSessions.id, session.id));

		expect(await reconcileMissionPilotPreQueueSessions()).toBe(0);
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, session.id),
			}),
		).toMatchObject({
			desiredState: "playing",
			phase: "attention",
			activePhaseRunId: phaseRunId,
			version: 4,
		});
	});

	it("classifies a terminal Task with a pre-Queue WorkBench run without rollback", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const session = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "Mission Pilot corrupt recovery",
				localPath: `/tmp/${repositoryId}`,
				branch: "main",
			});
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Corrupt Mission Pilot",
					objective: "Do not restart implementation automatically",
					acceptanceCriteria: "Operator diagnostic is retained",
					status: "completed",
				})
				.returning();
			const session = await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
			await tx
				.update(missionPilotSessions)
				.set({
					desiredState: "playing",
					phase: "initial_intake",
					version: session.version + 1,
					updatedAt: new Date(),
				})
				.where(eq(missionPilotSessions.id, session.id));
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "completed",
			});
			await tx.insert(taskEvents).values({
				taskRunId: runId,
				seq: 1,
				type: "state_change",
				eventType: "state_change",
				message: "Task run created",
				payloadJson: {
					runEvent: {
						data: {
							executionMode: "implementation",
							executionModeSource: "workbench_intake",
						},
					},
				},
			});
			await tx.insert(taskEvents).values({
				taskRunId: runId,
				seq: 2,
				type: "checkpoint",
				eventType: "git.diff_collected",
				message: "Workspace diff collected",
				payloadJson: {},
			});
			await tx.insert(taskRunCommitRecords).values({
				runId,
				repositoryId,
			});
			return session;
		});

		expect(await reconcileMissionPilotPreQueueSessions()).toBeGreaterThan(0);
		const [task, run, recovered] = await Promise.all([
			db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
			db.query.taskRuns.findFirst({ where: eq(taskRuns.id, runId) }),
			db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, session.id),
			}),
		]);
		expect(task?.status).toBe("completed");
		expect(run?.status).toBe("completed");
		expect(recovered).toMatchObject({
			desiredState: "stopped",
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL",
			preQueueDiagnosticJson: expect.objectContaining({
				code: "MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL",
				taskStatus: "completed",
				runIds: [runId],
				queueEntryIds: [],
				runSourceRefs: [
					expect.objectContaining({
						runId,
						executionMode: "implementation",
						executionModeSource: "workbench_intake",
					}),
				],
				commitRecordIds: expect.arrayContaining([expect.any(String)]),
				diffEventIds: expect.arrayContaining([expect.any(String)]),
			}),
		});
		const recoveredVersion = recovered?.version;
		expect(await reconcileMissionPilotPreQueueSessions()).toBe(0);
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, session.id),
			}),
		).toMatchObject({ version: recoveredVersion });
	});
});
