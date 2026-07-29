import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { taskArchiveRecords } from "../api/db/mission-pilot-schema";
import {
	repositories,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../api/db/schema";
import { readUsage } from "../api/modules/gitworktree/gitworktree.repository";
import {
	archiveCompletedTask,
	reopenCompletedTask,
	restoreArchivedTask,
} from "../api/modules/nightworkers/task-archive.service";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function createTask(status: "running" | "completed") {
	const repositoryId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "archive test",
		localPath: "/tmp/archive-test",
		branch: "main",
	});
	const id = crypto.randomUUID();
	await db.insert(tasks).values({ id, repositoryId, title: "Archive", status });
	return id;
}

async function createPendingCloseoutFixture() {
	const repositoryId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.insert(repositories).values({
		id: repositoryId,
		name: "archive closeout test",
		localPath: "/tmp/archive-closeout-test",
		branch: "main",
	});
	const taskId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	const worktreePath = `/tmp/archive-closeout-${taskId}`;
	await db.insert(tasks).values({
		id: taskId,
		repositoryId,
		title: "Archive pending closeout",
		status: "completed",
		worktreePath,
	});
	await db.insert(taskRuns).values({
		id: runId,
		taskId,
		repositoryId,
		status: "completed",
		worktreePath,
	});
	await db.insert(taskRunCommitRecords).values({
		id: crypto.randomUUID(),
		runId,
		repositoryId,
		status: "ready",
		verificationStatus: "partial",
	});
	return { repositoryId, taskId, runId, worktreePath };
}

describe("true Task Archive lifecycle", () => {
	it("rejects archive before completed", async () => {
		const taskId = await createTask("running");
		await expect(archiveCompletedTask({ taskId })).rejects.toThrow(
			"Task must be completed",
		);
	});

	it("archives exactly once and restores to completed without resuming", async () => {
		const taskId = await createTask("completed");
		const first = await archiveCompletedTask({ taskId });
		expect(first.task.status).toBe("archived");
		expect(first.task.archivedAt).toBeInstanceOf(Date);
		const duplicate = await archiveCompletedTask({ taskId });
		expect(duplicate.duplicate).toBe(true);
		const records = await db
			.select()
			.from(taskArchiveRecords)
			.where(eq(taskArchiveRecords.taskId, taskId));
		expect(records).toHaveLength(1);
		const restored = await restoreArchivedTask(taskId);
		expect(restored?.status).toBe("completed");
		const reopened = await reopenCompletedTask(taskId);
		expect(reopened?.status).toBe("ready");
	});

	it("requires explicit closeout discard and releases worktree usage when archived", async () => {
		const fixture = await createPendingCloseoutFixture();
		const usageBefore = await readUsage(fixture.repositoryId);
		expect(usageBefore.get(fixture.worktreePath)?.pendingCloseoutCount).toBe(1);

		await expect(
			archiveCompletedTask({ taskId: fixture.taskId }),
		).rejects.toMatchObject({ code: "TASK_CLOSEOUT_PENDING" });

		const archived = await archiveCompletedTask({
			taskId: fixture.taskId,
			discardPendingCloseouts: true,
		});
		expect(archived.task.status).toBe("archived");
		const [commitRecord] = await db
			.select()
			.from(taskRunCommitRecords)
			.where(eq(taskRunCommitRecords.runId, fixture.runId));
		expect(commitRecord).toMatchObject({
			status: "discarded",
			statusReason:
				"Pending Git closeout was explicitly discarded when the Task was archived.",
		});
		expect(
			await db
				.select()
				.from(taskArchiveRecords)
				.where(eq(taskArchiveRecords.taskId, fixture.taskId)),
		).toEqual([
			expect.objectContaining({
				evidenceJson: {
					discardedCloseoutRunIds: [fixture.runId],
				},
			}),
		]);
		expect(
			(await readUsage(fixture.repositoryId)).get(fixture.worktreePath),
		).toBeUndefined();
	});
});
