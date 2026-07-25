import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { missionPilotAgentSessions } from "../api/db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskRuns, tasks } from "../api/db/schema";
import { backfillStoppedMissionPilotAgentSessions } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	claimPostQueueResume,
	claimStop,
	createSession,
	finishStop,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
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
	it("prefers the durable post-Queue phase over a stale queued resume phase", async () => {
		const repositoryId = await insertRepository();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const phaseRunId = crypto.randomUUID();
		const now = new Date();
		const session = await db.transaction(async (tx) => {
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Resume post-Queue Test",
					objective: "Recover the terminal Test phase",
					status: "needs_review",
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
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "completed",
				finishedAt: now,
			});
			await tx.insert(missionPilotPhaseRuns).values({
				id: phaseRunId,
				sessionId: session.id,
				taskId,
				phase: "implementation",
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
			await tx
				.update(missionPilotSessions)
				.set({
					desiredState: "stopped",
					phase: "attention",
					resumePhase: "queued",
					activePhaseRunId: phaseRunId,
					version: 5,
				})
				.where(eq(missionPilotSessions.id, session.id));
			return session;
		});

		expect(await claimPostQueueResume(taskId, 5)).toMatchObject({
			id: session.id,
			desiredState: "playing",
			phase: "attention",
			resumePhase: null,
			activePhaseRunId: phaseRunId,
			version: 6,
		});
	});

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
