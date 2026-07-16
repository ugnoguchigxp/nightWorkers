import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, taskRuns, tasks } from "../api/db/schema";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	applyMissionPilotTaskStatusAfterRun,
	projectMissionPilotTaskStatus,
} from "../api/modules/nightworkers/run-orchestration/task-status-projection-policy";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

async function fixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "status sovereignty",
			localPath: "/tmp/status-sovereignty",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({ id: taskId, repositoryId, title: "status sovereignty" })
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	const playing = await claimAgentPlay(taskId, session.version);
	if (!playing) throw new Error("status fixture did not start");
	return { repositoryId, taskId, sessionId: playing.id };
}

describe("Mission Pilot Task status sovereignty", () => {
	it.each([
		"completed",
		"failed",
		"needs_human",
		"timed_out",
		"cancelled",
	] as const)("keeps an agent-owned terminal Run non-terminal: %s", (runStatus) => {
		expect(
			projectMissionPilotTaskStatus({
				runStatus,
				ownership: "agent",
				sessionDesiredState: "playing",
				currentTaskStatus: "running",
			}),
		).toBe("needs_review");
	});

	it("does not downgrade a Task after an explicit Agent stop", () => {
		expect(
			projectMissionPilotTaskStatus({
				runStatus: "failed",
				ownership: "agent",
				sessionDesiredState: "stopped",
				currentTaskStatus: "ready",
			}),
		).toBe("ready");
	});

	it("preserves the legacy Run status projection", () => {
		expect(
			projectMissionPilotTaskStatus({
				runStatus: "completed",
				ownership: "legacy",
				sessionDesiredState: "playing",
				currentTaskStatus: "running",
			}),
		).toBe("completed");
	});

	it.each([
		"completed",
		"archived",
		"cancelled",
	] as const)("never downgrades an explicitly terminal Task after a late Run event: %s", (currentTaskStatus) => {
		expect(
			projectMissionPilotTaskStatus({
				runStatus: "failed",
				ownership: "agent",
				sessionDesiredState: "playing",
				currentTaskStatus,
			}),
		).toBe(currentTaskStatus);
	});

	it("keeps explicit completion when a delayed terminal callback is applied", async () => {
		const state = await fixture();
		const runId = crypto.randomUUID();
		await db.insert(taskRuns).values({
			id: runId,
			taskId: state.taskId,
			repositoryId: state.repositoryId,
			status: "failed",
			contextSnapshot: {
				missionPilotAgent: {
					kind: "agent",
					sessionId: state.sessionId,
					toolCallId: "late-run",
					idempotencyKey: "late-run",
					completionOwner: "mission_pilot",
					sourceRunId: null,
				},
			},
		});
		await db
			.update(tasks)
			.set({
				status: "completed",
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(tasks.id, state.taskId));

		await applyMissionPilotTaskStatusAfterRun({
			taskId: state.taskId,
			runId,
			runStatus: "failed",
		});
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		expect(task?.status).toBe("completed");
	});

	it("does not let an older Run overwrite a newer active Run projection", async () => {
		const state = await fixture();
		const oldRunId = crypto.randomUUID();
		const provenance = {
			kind: "agent" as const,
			sessionId: state.sessionId,
			toolCallId: "old-run",
			idempotencyKey: "old-run",
			completionOwner: "mission_pilot" as const,
			sourceRunId: null,
		};
		await db.insert(taskRuns).values([
			{
				id: oldRunId,
				taskId: state.taskId,
				repositoryId: state.repositoryId,
				status: "failed",
				contextSnapshot: { missionPilotAgent: provenance },
			},
			{
				id: crypto.randomUUID(),
				taskId: state.taskId,
				repositoryId: state.repositoryId,
				status: "running",
				contextSnapshot: {
					missionPilotAgent: {
						...provenance,
						toolCallId: "new-run",
						idempotencyKey: "new-run",
					},
				},
			},
		]);
		await db
			.update(tasks)
			.set({ status: "running", updatedAt: new Date() })
			.where(eq(tasks.id, state.taskId));

		await applyMissionPilotTaskStatusAfterRun({
			taskId: state.taskId,
			runId: oldRunId,
			runStatus: "failed",
		});
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		expect(task?.status).toBe("running");
	});
});
