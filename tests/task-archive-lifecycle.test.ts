import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { taskArchiveRecords } from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
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
});
