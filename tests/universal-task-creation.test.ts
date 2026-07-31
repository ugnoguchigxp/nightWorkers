import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import * as missionPilotRepo from "@nightworkers/mission-pilot/backend";
import {
	missionPilotAgentSessions,
	missionPilotContextSnapshots,
	missionPilotSessions,
	missionPilotTaskEventInbox,
} from "@nightworkers/mission-pilot/backend";
import {
	claimAgentPlay,
	claimAgentStop,
	initializeMissionPilotAgentTaskMessageEvents,
	play,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories } from "../api/db/schema";
import { createTask } from "../api/modules/nightworkers/nightworkers.basic.service";
import { appendTaskMessage } from "../api/modules/nightworkers/nightworkers.workbench-message.service";

const repositoryIds: string[] = [];

beforeAll(() => {
	ensureNightWorkersSchema();
	initializeMissionPilotAgentTaskMessageEvents();
});
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
	}
});

describe("Universal Task creation", () => {
	it("creates a neutral Task without provisioning a Mission Pilot session", async () => {
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

		expect(task).not.toHaveProperty("missionPilot");
		expect(
			await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(0);
		await expect(play(task.id, 0)).rejects.toMatchObject({
			statusCode: 400,
			code: "MISSION_PILOT_INITIAL_PROMPT_REQUIRED",
		});
		expect(
			await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(0);
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
				.where(eq(missionPilotTaskEventInbox.taskId, task.id)),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(0);
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
		const session = await missionPilotRepo.getOrCreateSession({
			task: {
				id: task.id,
				repositoryId,
				title: task.title,
				description: task.description ?? null,
				objective: task.objective ?? null,
				acceptanceCriteria: task.acceptanceCriteria ?? null,
			},
			sourceKind: "task",
			sourceId: task.id,
		});
		const claimed = await claimAgentPlay(task.id, session.version);
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
			taskRevision: updated.revision,
		});
		const [current] = await db
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, session?.id ?? ""))
			.limit(1);
		expect(
			await claimAgentStop(task.id, current?.version ?? -1),
		).not.toBeNull();
	});

	it("converges concurrent lazy session creation without duplicating state", async () => {
		const repositoryId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.insert(repositories).values({
			id: repositoryId,
			name: "Universal Task atomicity",
			localPath: `/tmp/${repositoryId}`,
			branch: "main",
		});
		const task = await createTask({
			repositoryId,
			title: "Concurrent Play Task",
			objective: "Run Mission Pilot",
		});
		const input = {
			task: {
				id: task.id,
				repositoryId,
				title: task.title,
				description: task.description ?? null,
				objective: task.objective ?? null,
				acceptanceCriteria: task.acceptanceCriteria ?? null,
			},
			sourceKind: "task" as const,
			sourceId: task.id,
		};
		const [first, second] = await Promise.all([
			missionPilotRepo.getOrCreateSession(input),
			missionPilotRepo.getOrCreateSession(input),
		]);
		expect(second.id).toBe(first.id);
		expect(
			await db
				.select()
				.from(missionPilotSessions)
				.where(eq(missionPilotSessions.taskId, task.id)),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, first.id)),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(missionPilotAgentSessions)
				.where(eq(missionPilotAgentSessions.sessionId, first.id)),
		).toHaveLength(1);
	});
});
