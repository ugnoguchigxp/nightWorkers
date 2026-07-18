import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotAgentSessions,
	missionPilotTaskEventInbox,
} from "../api/db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
import {
	claimAgentPlay,
	claimAgentStop,
} from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import { backfillMissingTaskSessions } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	play,
	reconcileMissionPilotStartup,
} from "../api/modules/missionPilot/mission-pilot.service";
import { createTask } from "../api/modules/nightworkers/nightworkers.basic.service";
import { createTaskWithMissionPilot } from "../api/modules/nightworkers/nightworkers.task-creation.service";
import { appendTaskMessage } from "../api/modules/nightworkers/nightworkers.workbench-message.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("Universal Task creation", () => {
	it("atomically provisions a stopped Mission Pilot Session for a new Task", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Universal Task creation",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});

		const task = await createTask({
			repositoryId,
			title: "New Session",
			description: "",
			objective: "",
			acceptanceCriteria: "",
		});

		expect(task.missionPilot).toMatchObject({
			taskId: task.id,
			desiredState: "stopped",
			phase: "created",
			authorizationVersion: null,
			initialPromptState: "pending",
		});
		const session = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, task.id),
		});
		expect(session).toMatchObject({
			taskId: task.id,
			repositoryId,
			sourceKind: "task",
			sourceId: task.id,
			desiredState: "stopped",
			phase: "created",
			initialPromptSnapshot: "",
		});
		expect(
			await db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, session?.id ?? "")),
		).toHaveLength(1);
		await expect(
			play(task.id, task.missionPilot.version),
		).rejects.toMatchObject({
			statusCode: 400,
			code: "MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
		});
	});

	it("idempotently backfills an existing Task without activating it", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Universal Task backfill",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Existing Task without Mission Pilot",
			objective: "",
			status: "completed",
		});

		await backfillMissingTaskSessions();
		const firstSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, taskId),
		});
		await backfillMissingTaskSessions();
		await reconcileMissionPilotStartup();
		const secondSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, taskId),
		});
		expect(secondSession?.id).toBe(firstSession?.id);
		expect(secondSession).toMatchObject({
			desiredState: "stopped",
			phase: "created",
			authorizationVersion: null,
			sourceKind: "task",
			sourceId: taskId,
		});
		expect(
			await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		).toMatchObject({ status: "completed" });
	});

	it("keeps normal user messages out of the Mission Pilot inbox while stopped", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Stopped Mission Pilot prompt isolation",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId,
			title: "New Session",
			objective: "",
		});
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, task.id));
		const [agentBefore] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, session?.id ?? ""));

		const updated = await appendTaskMessage(
			task.id,
			"通常のPlan Modeで実装計画を作成してください",
		);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(updated.title).toBe("通常のPlan Modeで実装計画を作成してください");
		expect(
			await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(eq(missionPilotTaskEventInbox.sessionId, session?.id ?? "")),
		).toHaveLength(0);
		const [agentAfter] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, session?.id ?? ""));
		expect(agentAfter?.nextEventSequence).toBe(agentBefore?.nextEventSequence);
	});

	it("publishes user messages only to an active Mission Pilot agent", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Active Mission Pilot prompt events",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId,
			title: "New Session",
			objective: "Active Mission Pilot event test",
		});
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, task.id));
		const claimed = await claimAgentPlay(task.id, session?.version ?? -1);
		expect(claimed).not.toBeNull();
		await db
			.update(missionPilotAgentSessions)
			.set({ runtimeState: "completed", updatedAt: new Date() })
			.where(eq(missionPilotAgentSessions.sessionId, session?.id ?? ""));

		const updated = await appendTaskMessage(task.id, "ユーザーからの追加指示");
		await new Promise((resolve) => setTimeout(resolve, 30));
		await appendTaskMessage(task.id, "Mission Pilot自身の指示", {
			source: "mission_pilot",
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const events = await db
			.select()
			.from(missionPilotTaskEventInbox)
			.where(eq(missionPilotTaskEventInbox.sessionId, session?.id ?? ""));

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			eventType: "task.user_message_added",
			taskRevision: updated.updatedAt.getTime(),
		});
		const current = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, session?.id ?? ""),
		});
		expect(
			await claimAgentStop(task.id, current?.version ?? -1),
		).not.toBeNull();
	});

	it("rolls back Task insertion when Session provisioning conflicts", async () => {
		const repositoryId = crypto.randomUUID();
		const sourceId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Universal Task atomicity",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		await createTaskWithMissionPilot({
			repositoryId,
			title: "First source task",
			status: "draft",
			missionPilotSourceRef: {
				source: "mission_task_candidate",
				id: sourceId,
			},
		});
		const before = await db
			.select()
			.from(tasks)
			.where(eq(tasks.repositoryId, repositoryId));
		await expect(
			createTaskWithMissionPilot({
				repositoryId,
				title: "Conflicting source task",
				status: "draft",
				missionPilotSourceRef: {
					source: "mission_task_candidate",
					id: sourceId,
				},
			}),
		).rejects.toBeTruthy();
		const after = await db
			.select()
			.from(tasks)
			.where(eq(tasks.repositoryId, repositoryId));
		expect(after).toHaveLength(before.length);
		expect(after.some((task) => task.title === "Conflicting source task")).toBe(
			false,
		);
	});
});
