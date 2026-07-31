import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import {
	backfillStoppedMissionPilotAgentSessions,
	claimStop,
	finishStop,
	getSessionByTaskId,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskRuns, tasks } from "../api/db/schema";
import {
	createSession,
	missionPilotAgentSessions,
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/modules/missionPilot/persistence";
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

	it("provisions a stopped Session when the draft prompt is empty", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		await db.transaction(async (tx) => {
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
		});
		expect(
			await db.select().from(tasks).where(eq(tasks.id, taskId)),
		).toHaveLength(1);
		expect(await getSessionByTaskId(taskId)).toMatchObject({
			desiredState: "stopped",
			initialPromptSnapshot: "",
		});
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
		expect(latest).toBeNull();
		expect(await getSessionByTaskId(taskId)).toMatchObject({
			desiredState: "playing",
			phase: "starting",
			version: 3,
		});
	});

	it("does not couple Coding Agent completion to Mission Pilot session state", async () => {
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
			phase: "running",
			activeRunId: runId,
			version: 2,
		});
	});

	it("migrates a pre-agent session to stopped without stopping its Coding Agent run", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		let sessionId = "";
		await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Migrating Pilot",
					objective: "Agent sessionへ安全に移行する",
					status: "running",
				})
				.returning();
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "running",
			});
			const session = await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
			sessionId = session.id;
			await tx
				.delete(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, session.id));
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
		expect(await backfillStoppedMissionPilotAgentSessions()).toBe(1);
		await expect(getSessionByTaskId(taskId)).resolves.toMatchObject({
			desiredState: "stopped",
			phase: "created",
			activeRunId: null,
			version: 3,
		});
		expect(
			await db
				.select()
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, sessionId)),
		).toHaveLength(1);
		await expect(
			db.select().from(taskRuns).where(eq(taskRuns.id, runId)),
		).resolves.toMatchObject([{ status: "running" }]);
	});
});
