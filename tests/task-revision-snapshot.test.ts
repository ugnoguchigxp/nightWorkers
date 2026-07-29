import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { tasks } from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { assertResumedTaskRevisionBinding } from "../api/modules/nightworkers/run-orchestration/start-task-run-evidence";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("Task revision snapshots", () => {
	it("increments only for Task meaning changes and rejects a stale revision", async () => {
		const repository = await repo.createRepository({
			name: `TEST: task revision ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const created = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: original goal",
			objective: "original",
		});
		expect(created.revision).toBe(1);
		if (!created.currentRevisionSnapshotId)
			throw new Error("Task revision snapshot is missing");
		const initialSnapshot = await repo.getTaskRevisionSnapshot(
			created.currentRevisionSnapshotId,
		);
		expect(initialSnapshot).toMatchObject({
			taskId: created.id,
			revision: 1,
			sourceKind: "canonical",
		});

		const statusOnly = await repo.updateTask(
			created.id,
			{ status: "ready" },
			{ expectedRevision: 1 },
		);
		expect(statusOnly?.revision).toBe(1);
		expect(statusOnly?.currentRevisionSnapshotId).toBe(initialSnapshot?.id);

		const semantic = await repo.updateTask(
			created.id,
			{ objective: "changed" },
			{ expectedRevision: 1 },
		);
		expect(semantic?.revision).toBe(2);
		expect(semantic?.currentRevisionSnapshotId).not.toBe(initialSnapshot?.id);
		if (!semantic?.currentRevisionSnapshotId)
			throw new Error("Updated Task revision snapshot is missing");
		expect(
			await repo.getTaskRevisionSnapshot(semantic.currentRevisionSnapshotId),
		).toMatchObject({ revision: 2, objective: "changed" });

		await expect(
			repo.updateTask(
				created.id,
				{ objective: "stale write" },
				{ expectedRevision: 1 },
			),
		).resolves.toBeUndefined();
	});

	it("repairs a missing current snapshot pointer during bootstrap", async () => {
		const repository = await repo.createRepository({
			name: `TEST: task revision repair ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: revision pointer repair",
		});
		const snapshotId = task.currentRevisionSnapshotId;
		if (!snapshotId) throw new Error("Task revision snapshot is missing");
		await db
			.update(tasks)
			.set({ currentRevisionSnapshotId: null })
			.where(eq(tasks.id, task.id));

		await ensureNightWorkersSchema();

		expect((await repo.getTask(task.id))?.currentRevisionSnapshotId).toBe(
			snapshotId,
		);
	});

	it("rejects resuming a Run after the Task revision changed", () => {
		expect(() =>
			assertResumedTaskRevisionBinding({
				resuming: true,
				task: {
					revision: 2,
					currentRevisionSnapshotId: "snapshot-2",
				},
				run: {
					taskRevision: 1,
					taskRevisionSnapshotId: "snapshot-1",
				},
			}),
		).toThrow("Task revision");
	});
});
