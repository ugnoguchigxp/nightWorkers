import { beforeEach, describe, expect, it, vi } from "vitest";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { startTaskRunInProcess } from "../api/modules/nightworkers/run-orchestration/start-task-run";
import { startTaskRun } from "../api/modules/nightworkers/run-orchestration/start-task-run-entry";
import { prepareImplementationQueueRepository } from "../api/modules/queue/queue-repository-readiness.service";
import { shouldUseIsolatedTaskExecutor } from "../api/services/execution/executor-mode";
import { startTaskRunInWorker } from "../api/services/execution/worker-process-manager";

vi.mock("../api/services/execution/executor-mode", () => ({
	shouldUseIsolatedTaskExecutor: vi.fn(),
}));
vi.mock("../api/services/execution/worker-process-manager", () => ({
	startTaskRunInWorker: vi.fn(),
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: vi.fn(),
	listTaskMessages: vi.fn(),
	listTaskRunsForTask: vi.fn(),
}));
vi.mock("../api/modules/queue/queue-repository-readiness.service", () => ({
	prepareImplementationQueueRepository: vi.fn(),
}));
vi.mock("../api/modules/nightworkers/run-orchestration/start-task-run", () => ({
	startTaskRunInProcess: vi.fn(),
}));

const task = {
	id: "task-1",
	repositoryId: "repository-1",
	worktreePath: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(shouldUseIsolatedTaskExecutor).mockReturnValue(false);
	vi.mocked(nightworkersRepo.getTask).mockResolvedValue(task as never);
	vi.mocked(nightworkersRepo.listTaskMessages).mockResolvedValue([] as never);
	vi.mocked(nightworkersRepo.listTaskRunsForTask).mockResolvedValue(
		[] as never,
	);
	vi.mocked(prepareImplementationQueueRepository).mockResolvedValue({
		id: "workspace-1",
		status: "ready",
	} as never);
	vi.mocked(startTaskRunInProcess).mockResolvedValue({ id: "run-1" } as never);
});

describe("startTaskRun workspace preparation", () => {
	it("prepares a dedicated worktree before starting a task without prior runs", async () => {
		await expect(startTaskRun(task.id)).resolves.toMatchObject({ id: "run-1" });

		expect(prepareImplementationQueueRepository).toHaveBeenCalledWith({
			task: { id: task.id, repositoryId: task.repositoryId },
			messages: [],
		});
		expect(
			vi.mocked(prepareImplementationQueueRepository).mock
				.invocationCallOrder[0],
		).toBeLessThan(
			vi.mocked(startTaskRunInProcess).mock.invocationCallOrder[0],
		);
		expect(startTaskRunInWorker).not.toHaveBeenCalled();
	});

	it("requires explicit migration for a legacy task with prior runs", async () => {
		vi.mocked(nightworkersRepo.listTaskRunsForTask).mockResolvedValue([
			{ id: "legacy-run" },
		] as never);

		await expect(startTaskRun(task.id)).rejects.toMatchObject({
			code: "workspace_migration_required",
		});

		expect(prepareImplementationQueueRepository).not.toHaveBeenCalled();
		expect(startTaskRunInProcess).not.toHaveBeenCalled();
	});
});
