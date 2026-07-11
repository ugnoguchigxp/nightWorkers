import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import {
	claimInitialPromptDispatch,
	claimStop,
	createSession,
	ensureInitialPromptMessage,
	finishStop,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
import { reconcileMissionPilotStartup } from "../api/modules/missionPilot/mission-pilot.service";
import { updateTaskRun } from "../api/modules/nightworkers/nightworkers.runs.repository";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function insertRepository() {
	const id = crypto.randomUUID();
	repositoryIds.push(id);
	await db.insert(repositories).values({
		id,
		name: "Mission Pilot test",
		localPath: "/tmp/mission-pilot",
		branch: "main",
	});
	return id;
}

describe("Mission Pilot repository", () => {
	it("creates Task, Session, and Context revision 1 atomically", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		const sourceId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Pilot",
					objective: "計画を実装する",
					status: "draft",
				})
				.returning();
			await createSession(
				{ task, sourceKind: "mission_task_candidate", sourceId },
				tx,
			);
		});
		const session = await getSessionByTaskId(taskId);
		if (!session) throw new Error("Session was not created");
		expect(session).toMatchObject({
			desiredState: "stopped",
			phase: "created",
			initialPromptState: "pending",
			authorizationVersion: null,
			contextRevision: 1,
		});
		const snapshots = await db
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, session.id));
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.digest).toBe(session?.contextDigest);
	});

	it("rolls the Task back when the initial prompt is empty", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await expect(
			db.transaction(async (tx) => {
				const [task] = await tx
					.insert(tasks)
					.values({
						id: taskId,
						repositoryId,
						title: "Invalid",
						objective: "",
						status: "draft",
					})
					.returning();
				await createSession(
					{
						task,
						sourceKind: "mission_task_candidate",
						sourceId: crypto.randomUUID(),
					},
					tx,
				);
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
		});
		expect(
			await db.select().from(tasks).where(eq(tasks.id, taskId)),
		).toHaveLength(0);
	});

	it("persists the initial user message exactly once", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Pilot",
					objective: "一度だけ送る",
					status: "draft",
				})
				.returning();
			await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		const row = await getSessionByTaskId(taskId);
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", phase: "starting", version: 1 })
			.where(eq(missionPilotSessions.taskId, taskId));
		const first = await ensureInitialPromptMessage(taskId);
		const second = await ensureInitialPromptMessage(taskId);
		expect(first?.messageId).toBe(second?.messageId);
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, taskId),
						eq(taskMessages.messageType, "mission_pilot_initial_prompt"),
					),
				),
		).toHaveLength(1);
		expect(row?.initialPromptState).toBe("pending");
	});

	it("rolls the initial message back when Stop wins the Play race", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Stopped Pilot",
					objective: "送信してはいけない",
					status: "draft",
				})
				.returning();
			await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		await expect(ensureInitialPromptMessage(taskId)).rejects.toThrow(
			"stopped before the initial prompt",
		);
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(eq(taskMessages.taskId, taskId)),
		).toHaveLength(0);
	});

	it("recovers dispatching state from durable message evidence", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Recovering Pilot",
					objective: "証跡から復旧する",
					status: "draft",
				})
				.returning();
			await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", phase: "starting", version: 1 })
			.where(eq(missionPilotSessions.taskId, taskId));
		const dispatching = await claimInitialPromptDispatch(taskId);
		expect(dispatching).toMatchObject({
			initialPromptState: "dispatching",
			version: 2,
		});
		const evidenceId = crypto.randomUUID();
		await db.insert(taskMessages).values({
			id: evidenceId,
			taskId,
			role: "user",
			content: "証跡から復旧する",
			messageType: "mission_pilot_initial_prompt",
			metadataJson: { source: "mission_pilot", intent: "initial_prompt" },
		});
		const recovered = await ensureInitialPromptMessage(taskId);
		expect(recovered).toMatchObject({
			messageId: evidenceId,
			inserted: false,
			row: { initialPromptState: "sent" },
		});
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(eq(taskMessages.taskId, taskId)),
		).toHaveLength(1);
	});

	it("does not let a late Stop completion overwrite a newer Play", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Race Pilot",
					objective: "競合を守る",
					status: "draft",
				})
				.returning();
			await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", phase: "initial_intake", version: 1 })
			.where(eq(missionPilotSessions.taskId, taskId));
		const stopping = await claimStop(taskId, 1);
		expect(stopping?.version).toBe(2);
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", phase: "starting", version: 3 })
			.where(eq(missionPilotSessions.taskId, taskId));
		const latest = await finishStop(taskId, 2);
		expect(latest).toMatchObject({
			desiredState: "playing",
			phase: "starting",
			version: 3,
		});
	});

	it("clears the active run while preserving playing intent on natural completion", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Completing Pilot",
					objective: "run完了を同期する",
					status: "running",
				})
				.returning();
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "running",
			});
			await createSession(
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
					phase: "running",
					activeRunId: runId,
					version: 2,
				})
				.where(eq(missionPilotSessions.taskId, taskId));
		});
		await updateTaskRun(runId, { status: "completed", endedAt: new Date() });
		await expect(getSessionByTaskId(taskId)).resolves.toMatchObject({
			desiredState: "playing",
			phase: "initial_intake",
			activeRunId: null,
			version: 3,
		});
	});

	it("turns an interrupted starting state into retryable attention on startup", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Restarting Pilot",
					objective: "安全に再開する",
					status: "draft",
				})
				.returning();
			await createSession(
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
					phase: "starting",
					initialPromptState: "dispatching",
					version: 2,
				})
				.where(eq(missionPilotSessions.taskId, taskId));
		});
		expect(await reconcileMissionPilotStartup()).toBeGreaterThanOrEqual(1);
		await expect(getSessionByTaskId(taskId)).resolves.toMatchObject({
			desiredState: "stopped",
			phase: "attention",
			initialPromptState: "dispatching",
			lastErrorCode: "MISSION_PILOT_RESTART_RECOVERY_REQUIRED",
			version: 3,
		});
	});
});
