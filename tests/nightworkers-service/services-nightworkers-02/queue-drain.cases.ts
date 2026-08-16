import { beforeEach, describe, expect, it, vi } from "vitest";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { runSessionQueueForRepository } from "../../../api/modules/nightworkers/nightworkers.service";
import * as taskRunStarter from "../../../api/modules/nightworkers/run-orchestration/start-task-run";
import { repoRoot } from "./setup";

describe("NightWorkers service", () => {
	beforeEach(async () => {
		await runSessionQueueForRepository("test-session-queue-drain-flush");
		vi.clearAllMocks();
	});

	it("starts the next queued session when project queue capacity is available", async () => {
		const task = {
			id: "task-next",
			repositoryId: "repo-queue",
		};
		const run = {
			id: "run-next",
			taskId: task.id,
			repositoryId: task.repositoryId,
			status: "running",
		};
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: task.repositoryId,
			localPath: repoRoot,
			queueEnabled: true,
			maxConcurrentSessions: 1,
			safetyPolicy: {},
			repositoryIdentityStatus: "ready",
			repositoryIdentityRevision: 1,
		} as never);
		vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);
		vi.mocked(repo.claimNextQueuedTask)
			.mockResolvedValueOnce(task as never)
			.mockResolvedValueOnce(null);
		vi.mocked(taskRunStarter.startTaskRun).mockResolvedValue(run as never);

		const started = await runSessionQueueForRepository(task.repositoryId);

		expect(started).toHaveLength(1);
		expect(repo.claimNextQueuedTask).toHaveBeenCalledWith(task.repositoryId);
		expect(taskRunStarter.startTaskRun).toHaveBeenCalledWith(task.id, {
			executionMode: "implementation",
			executionModeSource: "session_queue",
		});
	});

	it("does not claim queued sessions when global capacity is full", async () => {
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: "repo-full",
			localPath: repoRoot,
			queueEnabled: true,
			maxConcurrentSessions: 3,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(2);

		const previousLimit = process.env.SESSION_QUEUE_MAX_CONCURRENCY;
		process.env.SESSION_QUEUE_MAX_CONCURRENCY = "2";
		try {
			const started = await runSessionQueueForRepository("repo-full");
			expect(started).toHaveLength(0);
			expect(repo.claimNextQueuedTask).not.toHaveBeenCalledWith("repo-full");
		} finally {
			if (previousLimit === undefined)
				delete process.env.SESSION_QUEUE_MAX_CONCURRENCY;
			else process.env.SESSION_QUEUE_MAX_CONCURRENCY = previousLimit;
		}
	});

	it("waits for sessionQueueDrainPromise if queue drain is already in progress", async () => {
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: "repo-drain",
			localPath: repoRoot,
			queueEnabled: true,
			maxConcurrentSessions: 1,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);

		vi.mocked(repo.claimNextQueuedTask).mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return null;
		});

		const [started1, started2] = await Promise.all([
			runSessionQueueForRepository("repo-drain"),
			runSessionQueueForRepository("repo-drain"),
		]);

		expect(started1).toHaveLength(0);
		expect(started2).toHaveLength(0);
	});

	it("fails task status and logs message if startTaskRun fails inside claim next task", async () => {
		vi.mocked(repo.getRepository).mockResolvedValue({
			id: "repo-fail-start",
			localPath: repoRoot,
			queueEnabled: true,
			maxConcurrentSessions: 1,
			safetyPolicy: {},
		} as never);
		vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);
		vi.mocked(repo.claimNextQueuedTask).mockResolvedValue({
			id: "task-fail-run",
			repositoryId: "repo-fail-start",
		} as never);
		vi.mocked(taskRunStarter.startTaskRun).mockRejectedValue(
			new Error("Mock startTaskRun failure"),
		);

		const started = await runSessionQueueForRepository("repo-fail-start");
		expect(started).toHaveLength(0);
		expect(repo.updateTaskStatus).toHaveBeenCalledWith(
			"task-fail-run",
			"failed",
		);
		expect(repo.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-fail-run",
				role: "system",
				content: expect.stringContaining(
					"Session queue failed to start this task",
				),
			}),
		);
	});
});
