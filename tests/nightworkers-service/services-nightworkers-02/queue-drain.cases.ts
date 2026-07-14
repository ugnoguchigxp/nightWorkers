import { describe, expect, it, vi } from "vitest";
import * as repo from "../../../api/modules/nightworkers/nightworkers.repository";
import { runSessionQueueForRepository } from "../../../api/modules/nightworkers/nightworkers.service";
import * as runtimeRegistry from "../../../api/services/agent-runtime/registry";
import { repoRoot } from "./setup";

describe("NightWorkers service", () => {
	it("starts the next queued session when project queue capacity is available", async () => {
		const task = {
			id: "task-next",
			repositoryId: "repo-queue",
			title: "Queued session",
			description: "Run queued session",
			objective: "Run queued session",
			acceptanceCriteria: "Queued session starts",
			timeoutSeconds: 60,
			status: "running",
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
		} as never);
		vi.mocked(repo.countActiveTaskRuns).mockResolvedValue(0);
		vi.mocked(repo.claimNextQueuedTask)
			.mockResolvedValueOnce(task as never)
			.mockResolvedValueOnce(null);
		vi.mocked(repo.getTask).mockResolvedValue(task as never);
		vi.mocked(repo.listActiveTaskRunsForTask).mockResolvedValue([]);
		vi.mocked(repo.listTaskMessages).mockResolvedValue([
			{ role: "user", content: task.description },
		] as never);
		vi.mocked(repo.createTaskRun).mockResolvedValue(run as never);
		vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
		vi.mocked(repo.listTaskRunsForTask).mockResolvedValue([run] as never);
		vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
		vi.mocked(repo.updateTaskRun).mockResolvedValue(run as never);
		const runtimeStart = vi.fn().mockResolvedValue({
			terminalState: "completed",
			summary: "Queued session done",
			finalReport: "Queued session report",
			stoppedBy: "decision",
			riskLevel: "low",
			diffPatch: "",
			logContent: "",
		});
		vi.mocked(runtimeRegistry.resolveAgentRuntime).mockReturnValue({
			kind: "native-local",
			start: runtimeStart,
			stop: vi.fn(),
		} as never);

		const started = await runSessionQueueForRepository(task.repositoryId);

		expect(started).toHaveLength(1);
		expect(repo.claimNextQueuedTask).toHaveBeenCalledWith(task.repositoryId);
		expect(repo.createTaskRun).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: task.id,
				repositoryId: task.repositoryId,
			}),
			expect.anything(),
		);
		await vi.waitFor(() => {
			expect(runtimeStart).toHaveBeenCalledTimes(1);
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
			expect(repo.claimNextQueuedTask).not.toHaveBeenCalled();
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
		vi.mocked(repo.getTask).mockRejectedValue(
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
