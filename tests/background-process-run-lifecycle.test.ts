import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { backgroundProcesses } from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	getBackgroundProcess,
	startBackgroundCommand,
	stopBackgroundProcess,
	stopBackgroundProcessesForRun,
} from "../api/services/background-processes";

const temporaryDirectories: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

async function createRunFixture() {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-background-lifecycle-"),
	);
	temporaryDirectories.push(directory);
	await fs.writeFile(path.join(directory, "server.log"), "ready\n", "utf8");
	const repository = await repo.createRepository({
		name: `TEST: background lifecycle ${crypto.randomUUID()}`,
		localPath: directory,
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: repository.id,
		title: `TEST: background lifecycle ${crypto.randomUUID()}`,
		status: "running",
	});
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		status: "running",
	});
	return { directory, repository, task, run };
}

describe("background process run lifecycle", () => {
	it("cleans only the terminal Run's managed process group and is idempotent", async () => {
		const fixture = await createRunFixture();
		const otherRun = await repo.createTaskRun({
			taskId: fixture.task.id,
			repositoryId: fixture.repository.id,
			status: "running",
		});
		const first = await startBackgroundCommand({
			runId: fixture.run.id,
			command: "tail -f server.log",
			repoRoot: fixture.directory,
		});
		const second = await startBackgroundCommand({
			runId: fixture.run.id,
			command: "tail -f server.log",
			repoRoot: fixture.directory,
		});
		const foreign = await startBackgroundCommand({
			runId: otherRun.id,
			command: "tail -f server.log",
			repoRoot: fixture.directory,
		});

		await expect(
			stopBackgroundProcessesForRun(fixture.run.id, "run_completed"),
		).resolves.toHaveLength(2);
		await expect(getBackgroundProcess(first.id)).resolves.toMatchObject({
			status: "stopped",
			stopReason: "run_completed",
		});
		await expect(getBackgroundProcess(second.id)).resolves.toMatchObject({
			status: "stopped",
			stopReason: "run_completed",
		});
		await expect(getBackgroundProcess(foreign.id)).resolves.toMatchObject({
			status: "running",
		});
		await expect(
			stopBackgroundProcessesForRun(fixture.run.id, "run_completed"),
		).resolves.toEqual([]);
		await stopBackgroundProcess(foreign.id);
	});

	it("does not kill a record that is not managed by this API process", async () => {
		const fixture = await createRunFixture();
		const recordId = crypto.randomUUID();
		await db.insert(backgroundProcesses).values({
			id: recordId,
			repositoryId: fixture.repository.id,
			taskId: fixture.task.id,
			runId: fixture.run.id,
			command: "tail -f server.log",
			cwd: "",
			status: "running",
			pid: process.pid,
			startedAt: new Date(),
			latestOutput: "",
		});

		await expect(
			stopBackgroundProcessesForRun(fixture.run.id, "run_failed"),
		).resolves.toEqual([
			expect.objectContaining({
				id: recordId,
				status: "lost",
				stopReason: "api_process_restarted_or_tracking_lost",
			}),
		]);
	});
});
