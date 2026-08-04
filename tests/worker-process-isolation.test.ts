import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { prepareImplementationQueueRepository } from "../api/modules/queue/queue-repository-readiness.service";
import {
	getIsolatedWorkerCount,
	runImplementationQueueInWorker,
	shutdownIsolatedTaskWorkers,
	startTaskRunInWorker,
} from "../api/services/execution/worker-process-manager";

describe("worker process isolation", () => {
	afterEach(async () => {
		await shutdownIsolatedTaskWorkers();
	});

	it("starts the queue claimant through IPC without terminating the API test process", async () => {
		const tempDirectory = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-worker-process-test-"),
		);
		try {
			const workerDatabasePath = path.join(tempDirectory, "worker.db");
			const runs = await runImplementationQueueInWorker({
				environment: {
					DATABASE_URL: `file:${workerDatabasePath}`,
					NODE_ENV: "test",
				},
			});
			expect(Array.isArray(runs)).toBe(true);
			expect(process.exitCode).not.toBe(1);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(getIsolatedWorkerCount()).toBe(0);
			await expect(fs.stat(workerDatabasePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await fs.rm(tempDirectory, { recursive: true, force: true });
		}
	}, 20_000);

	it("persists an isolated Task worker lifecycle only through the owner", async () => {
		const repositoryDirectory = await fs.mkdtemp(
			path.join(os.tmpdir(), "nightworkers-owner-task-worker-"),
		);
		const workerDatabasePath = path.join(
			repositoryDirectory,
			"worker-must-not-open.db",
		);
		let repositoryId: string | null = null;
		try {
			execFileSync("git", ["init", "-b", "main", repositoryDirectory]);
			execFileSync("git", [
				"-C",
				repositoryDirectory,
				"config",
				"user.email",
				"worker@test.invalid",
			]);
			execFileSync("git", [
				"-C",
				repositoryDirectory,
				"config",
				"user.name",
				"Worker Test",
			]);
			await fs.writeFile(
				path.join(repositoryDirectory, "README.md"),
				"fixture\n",
			);
			execFileSync("git", ["-C", repositoryDirectory, "add", "README.md"]);
			execFileSync("git", [
				"-C",
				repositoryDirectory,
				"commit",
				"-m",
				"fixture",
			]);

			const repository = await repo.createRepository({
				name: `owner-worker-${crypto.randomUUID()}`,
				localPath: repositoryDirectory,
				branch: "main",
				allowed: true,
			});
			repositoryId = repository.id;
			const task = await repo.createTask({
				repositoryId: repository.id,
				title: "Persistence Owner worker fixture",
				description: "[fixture:tool_failure]",
				objective: "[fixture:tool_failure]",
				status: "draft",
			});
			await repo.createTaskMessage({
				taskId: task.id,
				role: "user",
				content: "[fixture:tool_failure]",
				messageType: "text",
			});
			await prepareImplementationQueueRepository({
				task,
				messages: await repo.listTaskMessages(task.id),
			});

			const run = await startTaskRunInWorker<{ id: string }>(
				task.id,
				{},
				{
					environment: {
						NIGHTWORKERS_E2E: "1",
						NIGHTWORKERS_E2E_RUNTIME_FIXTURE: "1",
						DATABASE_URL: `file:${workerDatabasePath}`,
					},
				},
			);
			const terminal = await waitForTerminalRun(run.id);

			expect(terminal?.status).toBe("blocked");
			await expect(fs.stat(workerDatabasePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
			await waitForWorkersToExit();
		} finally {
			if (repositoryId) await repo.deleteRepository(repositoryId);
			await fs.rm(repositoryDirectory, { recursive: true, force: true });
		}
	}, 30_000);
});

async function waitForTerminalRun(runId: string) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const run = await repo.getTaskRun(runId);
		if (
			run &&
			["blocked", "completed", "cancelled", "failed", "needs_human"].includes(
				run.status,
			)
		)
			return run;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Task worker did not reach a terminal state: ${runId}`);
}

async function waitForWorkersToExit() {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (getIsolatedWorkerCount() === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Isolated worker did not exit after its Run became terminal");
}
