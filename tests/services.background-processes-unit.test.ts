import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { backgroundProcesses, taskRuns } from "../api/db/schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import {
	getBackgroundProcess,
	listBackgroundProcesses,
	startBackgroundCommand,
	stopBackgroundProcess,
} from "../api/services/background-processes/index";

let dummyRepoDir: string;
let project: unknown;
let task: unknown;
let run: unknown;

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

beforeEach(async () => {
	dummyRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-bg-unit-"),
	);
	await fs.writeFile(path.join(dummyRepoDir, "server.log"), "ready\n", "utf-8");

	// Create repository, task, and run records in database
	project = await repo.createRepository({
		name: `TEST: bg repo ${crypto.randomUUID()}`,
		localPath: dummyRepoDir,
		branch: "main",
	});
	task = await repo.createTask({
		repositoryId: project.id,
		title: "TEST: bg task",
		status: "running",
	});
	const [createdRun] = await db
		.insert(taskRuns)
		.values({
			taskId: task.id,
			repositoryId: project.id,
			status: "running",
			workerKind: "native-local-worker",
		})
		.returning();
	run = createdRun;
});

afterEach(async () => {
	await fs.rm(dummyRepoDir, { recursive: true, force: true });
});

describe("background-processes service unit tests", () => {
	describe("resolveOwnership", () => {
		it("resolves ownership when runId is provided", async () => {
			const processRecord = await startBackgroundCommand({
				runId: run.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});
			expect(processRecord.runId).toBe(run.id);
			expect(processRecord.taskId).toBe(task.id);
			expect(processRecord.repositoryId).toBe(project.id);
			await stopBackgroundProcess(processRecord.id);
		});

		it("resolves ownership when taskId is provided", async () => {
			const processRecord = await startBackgroundCommand({
				taskId: task.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});
			expect(processRecord.runId).toBeNull();
			expect(processRecord.taskId).toBe(task.id);
			expect(processRecord.repositoryId).toBe(project.id);
			await stopBackgroundProcess(processRecord.id);
		});

		it("resolves ownership when repositoryId is provided", async () => {
			const processRecord = await startBackgroundCommand({
				repositoryId: project.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});
			expect(processRecord.runId).toBeNull();
			expect(processRecord.taskId).toBeNull();
			expect(processRecord.repositoryId).toBe(project.id);
			await stopBackgroundProcess(processRecord.id);
		});

		it("throws error when none of runId, taskId, repositoryId are provided", async () => {
			await expect(
				startBackgroundCommand({
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
				}),
			).rejects.toThrow(
				"Background command requires repositoryId, taskId, or runId.",
			);
		});

		it("throws error when runId does not exist", async () => {
			await expect(
				startBackgroundCommand({
					runId: "non-existent-run-id",
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
				}),
			).rejects.toThrow("Run not found");
		});

		it("throws error when taskId does not exist", async () => {
			await expect(
				startBackgroundCommand({
					taskId: "non-existent-task-id",
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
				}),
			).rejects.toThrow("Task not found");
		});

		it("throws error when repositoryId does not exist", async () => {
			await expect(
				startBackgroundCommand({
					repositoryId: "non-existent-repo-id",
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
				}),
			).rejects.toThrow("Repository not found");
		});
	});

	describe("startBackgroundCommand validations", () => {
		it("throws when path policy blocks the cwd", async () => {
			await expect(
				startBackgroundCommand({
					repositoryId: project.id,
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
					cwd: "../outside-dir",
					allowedPaths: [dummyRepoDir],
				}),
			).rejects.toThrow("denied");
		});

		it("throws when command policy blocks the command", async () => {
			await expect(
				startBackgroundCommand({
					repositoryId: project.id,
					command: "tail -f server.log",
					repoRoot: dummyRepoDir,
					blockedCommands: ["tail"],
				}),
			).rejects.toThrow("blocklist");
		});

		it("throws when command classification is not background-safe", async () => {
			await expect(
				startBackgroundCommand({
					repositoryId: project.id,
					command: "ls",
					repoRoot: dummyRepoDir,
				}),
			).rejects.toThrow("Command is not classified as background-safe");
		});
	});

	describe("command execution and output handling", () => {
		it("captures stdout/stderr, updates latestOutput in DB, and finishes with completed/failed or stops", async () => {
			// Append some output to the log file to trigger tail output
			await fs.writeFile(
				path.join(dummyRepoDir, "server.log"),
				"initial log content\n",
				"utf-8",
			);

			const processRecord = await startBackgroundCommand({
				runId: run.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});

			expect(processRecord.status).toBe("running");

			// Wait a bit to let the output flow
			await new Promise((r) => setTimeout(r, 200));

			const current = await getBackgroundProcess(processRecord.id);
			expect(current).toBeTruthy();
			if (!current) throw new Error("Expected background process record.");
			expect(current.latestOutput).toContain("initial log content");

			// Stop the process and check database updates
			const stopped = await stopBackgroundProcess(processRecord.id);
			expect(stopped).toBeTruthy();
			if (!stopped) throw new Error("Expected stopped background process.");
			expect(stopped.status).toBe("stopped");
			expect(stopped.stopReason).toBe("user_requested");
			expect(stopped.outputArtifactId).toBeNull();
		});

		it("redacts secret-shaped output before persisting it", async () => {
			await fs.writeFile(
				path.join(dummyRepoDir, "server.log"),
				"PROJECT_TOKEN=project-secret-value\n",
				"utf-8",
			);
			const processRecord = await startBackgroundCommand({
				runId: run.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});

			await new Promise((resolve) => setTimeout(resolve, 200));
			const current = await getBackgroundProcess(processRecord.id);
			expect(current?.latestOutput).toContain("[REDACTED]");
			expect(current?.latestOutput).not.toContain("project-secret-value");

			await stopBackgroundProcess(processRecord.id);
		});
	});

	describe("list and get with reconciliation", () => {
		it("reconciles lost processes when calling list or get", async () => {
			const id = crypto.randomUUID();
			await db.insert(backgroundProcesses).values({
				id,
				repositoryId: project.id,
				taskId: task.id,
				runId: run.id,
				command: "tail -f server.log",
				cwd: "",
				status: "running",
				startedAt: new Date(),
				latestOutput: "initial output",
			});

			const list = await listBackgroundProcesses({ runId: run.id });
			const record = list.find((r) => r.id === id);
			expect(record).toBeDefined();
			if (!record) throw new Error("Expected reconciled background process.");
			expect(record.status).toBe("lost");
			expect(record.stopReason).toBe("api_process_restarted_or_tracking_lost");
		});
	});

	describe("stopBackgroundProcess", () => {
		it("returns null if process not found", async () => {
			const result = await stopBackgroundProcess("non-existent-id");
			expect(result).toBeNull();
		});

		it("returns process if process status is already completed", async () => {
			const id = crypto.randomUUID();
			await db.insert(backgroundProcesses).values({
				id,
				repositoryId: project.id,
				command: "tail -f server.log",
				cwd: "",
				status: "completed",
				startedAt: new Date(),
				latestOutput: "",
			});

			const result = await stopBackgroundProcess(id);
			expect(result).toBeTruthy();
			if (!result) throw new Error("Expected completed background process.");
			expect(result.status).toBe("completed");
		});

		it("marks process as stopped and kills the child process when active", async () => {
			const processRecord = await startBackgroundCommand({
				runId: run.id,
				command: "tail -f server.log",
				repoRoot: dummyRepoDir,
			});

			const stopped = await stopBackgroundProcess(
				processRecord.id,
				"custom_reason",
			);
			expect(stopped).toBeTruthy();
			if (!stopped) throw new Error("Expected stopped background process.");
			expect(stopped.status).toBe("stopped");
			expect(stopped.stopReason).toBe("custom_reason");

			const current = await getBackgroundProcess(processRecord.id);
			expect(current).toBeTruthy();
			if (!current) throw new Error("Expected current background process.");
			expect(current.status).toBe("stopped");
		});
	});
});
