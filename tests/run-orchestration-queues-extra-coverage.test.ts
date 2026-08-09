import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	shouldUseIsolatedTaskExecutor: vi.fn(),
	runImplementationQueueInWorker: vi.fn(),
	getSessionQueueMaxConcurrencyFromEnv: vi.fn(),
	projectTaskRunParentStatus: vi.fn(),
	isProcessorReleasedQueueStatus: vi.fn(),
	getTaskRun: vi.fn(),
	updateTaskRunIfStatus: vi.fn(),
	updateTaskStatus: vi.fn(),
	getImplementationQueueSettings: vi.fn(),
	claimNextImplementationQueueEntry: vi.fn(),
	markImplementationQueueEntryProcessing: vi.fn(),
	getImplementationQueueEntry: vi.fn(),
	createRunEvent: vi.fn(),
	createTaskMessage: vi.fn(),
	recoverImplementationQueueEntryFromSnapshot: vi.fn(),
	getImplementationQueueEntryForRun: vi.fn(),
	completeImplementationQueueEntryForRunId: vi.fn(),
	updateImplementationQueueEntry: vi.fn(),
	getRepository: vi.fn(),
	countActiveTaskRuns: vi.fn(),
	claimNextQueuedTask: vi.fn(),
	prepareTaskRunInProcess: vi.fn(),
	startTaskRun: vi.fn(),
	assertRunStatusTransition: vi.fn(),
}));

vi.mock("../api/services/execution/executor-mode", () => ({
	shouldUseIsolatedTaskExecutor: mocks.shouldUseIsolatedTaskExecutor,
}));

vi.mock("../api/services/execution/worker-process-manager", () => ({
	runImplementationQueueInWorker: mocks.runImplementationQueueInWorker,
}));

vi.mock("../api/services/runtime-env", () => ({
	getSessionQueueMaxConcurrencyFromEnv:
		mocks.getSessionQueueMaxConcurrencyFromEnv,
}));

vi.mock("../api/modules/agentsShare", () => ({
	projectTaskRunParentStatus: mocks.projectTaskRunParentStatus,
}));

vi.mock("../api/modules/queue/queue-repository-row-mapper", () => ({
	isProcessorReleasedQueueStatus: mocks.isProcessorReleasedQueueStatus,
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
	updateTaskRunIfStatus: mocks.updateTaskRunIfStatus,
	updateTaskStatus: mocks.updateTaskStatus,
	getImplementationQueueSettings: mocks.getImplementationQueueSettings,
	claimNextImplementationQueueEntry: mocks.claimNextImplementationQueueEntry,
	markImplementationQueueEntryProcessing:
		mocks.markImplementationQueueEntryProcessing,
	getImplementationQueueEntry: mocks.getImplementationQueueEntry,
	createRunEvent: mocks.createRunEvent,
	createTaskMessage: mocks.createTaskMessage,
	recoverImplementationQueueEntryFromSnapshot:
		mocks.recoverImplementationQueueEntryFromSnapshot,
	getImplementationQueueEntryForRun: mocks.getImplementationQueueEntryForRun,
	completeImplementationQueueEntryForRunId:
		mocks.completeImplementationQueueEntryForRunId,
	updateImplementationQueueEntry: mocks.updateImplementationQueueEntry,
	getRepository: mocks.getRepository,
	countActiveTaskRuns: mocks.countActiveTaskRuns,
	claimNextQueuedTask: mocks.claimNextQueuedTask,
}));

vi.mock("../api/modules/nightworkers/run-orchestration/start-task-run", () => ({
	prepareTaskRunInProcess: mocks.prepareTaskRunInProcess,
	startTaskRun: mocks.startTaskRun,
}));

vi.mock("../api/modules/nightworkers/run-orchestration/status", () => ({
	assertRunStatusTransition: mocks.assertRunStatusTransition,
	runStatusTransitionTable: {
		preparing: ["cancelled", "failed"],
		running: ["cancelled", "failed"],
		completed: [],
		needs_human: ["failed"],
	},
}));

import {
	activatePreparedQueueRun,
	archiveImplementationQueueEntryForRun,
	completeImplementationQueueEntryForRun,
	IMPLEMENTATION_QUEUE_HEARTBEAT_INTERVAL_MS,
	IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
	resolveLeaseConflictRunStatus,
	runImplementationQueue,
	runImplementationQueueInProcess,
	runSessionQueueForRepository,
	shouldAutoDrainImplementationQueue,
	shouldContinueSessionQueue,
} from "../api/modules/nightworkers/run-orchestration/queues";

const preparedRun = {
	id: "run-1",
	status: "preparing",
	taskId: "task-1",
};

function queueEntry(id = "entry-1", taskId = "task-1") {
	return {
		id,
		taskId,
		status: "claimed",
		leaseVersion: 3,
	};
}

function claimOnce(entry = queueEntry()) {
	mocks.claimNextImplementationQueueEntry
		.mockReset()
		.mockResolvedValueOnce({ kind: "claimed", entry })
		.mockResolvedValue({ kind: "empty" });
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.shouldUseIsolatedTaskExecutor.mockReturnValue(false);
	mocks.runImplementationQueueInWorker.mockResolvedValue([]);
	mocks.getSessionQueueMaxConcurrencyFromEnv.mockReturnValue(4);
	mocks.projectTaskRunParentStatus.mockResolvedValue({
		handled: true,
		status: "failed",
	});
	mocks.isProcessorReleasedQueueStatus.mockReturnValue(false);
	mocks.getImplementationQueueSettings.mockResolvedValue({ processorCount: 2 });
	mocks.claimNextImplementationQueueEntry.mockResolvedValue({ kind: "empty" });
	mocks.markImplementationQueueEntryProcessing.mockResolvedValue({
		id: "entry-1",
		status: "processing",
		processorSlot: 2,
		leaseOwnerId: "lease-owner",
		leaseVersion: 3,
	});
	mocks.createRunEvent.mockResolvedValue({});
	mocks.createTaskMessage.mockResolvedValue({});
	mocks.getTaskRun.mockResolvedValue(null);
	mocks.updateTaskRunIfStatus.mockResolvedValue(null);
	mocks.updateTaskStatus.mockResolvedValue({});
	mocks.recoverImplementationQueueEntryFromSnapshot.mockResolvedValue({});
	mocks.getImplementationQueueEntryForRun.mockResolvedValue(null);
	mocks.completeImplementationQueueEntryForRunId.mockResolvedValue(null);
	mocks.updateImplementationQueueEntry.mockResolvedValue({});
	mocks.getRepository.mockResolvedValue({
		id: "repository-1",
		queueEnabled: true,
		maxConcurrentSessions: 2,
	});
	mocks.countActiveTaskRuns.mockResolvedValue(0);
	mocks.claimNextQueuedTask.mockResolvedValue(null);
	mocks.prepareTaskRunInProcess.mockResolvedValue({
		run: preparedRun,
		launch: vi.fn().mockResolvedValue(undefined),
	});
	mocks.startTaskRun.mockResolvedValue(preparedRun);
});

describe("run orchestration queue extra coverage", () => {
	it("covers status, environment, lease, and activation decisions", async () => {
		for (const status of ["completed", "cancelled", "failed"]) {
			expect(shouldContinueSessionQueue(status)).toBe(true);
		}
		expect(shouldContinueSessionQueue("running")).toBe(false);
		expect(shouldAutoDrainImplementationQueue({})).toBe(true);
		expect(
			shouldAutoDrainImplementationQueue({ NIGHTWORKERS_QUEUE_WORKER: "1" }),
		).toBe(false);
		expect(IMPLEMENTATION_QUEUE_LEASE_TTL_MS).toBe(1_800_000);
		expect(IMPLEMENTATION_QUEUE_HEARTBEAT_INTERVAL_MS).toBe(60_000);
		expect(resolveLeaseConflictRunStatus("needs_human")).toBe("needs_human");
		expect(resolveLeaseConflictRunStatus("running")).toBe("cancelled");
		expect(resolveLeaseConflictRunStatus("unknown")).toBe("unknown");

		const attachment = { id: "attachment" };
		const associate = vi.fn().mockResolvedValue(undefined);
		const launch = vi.fn().mockResolvedValue(undefined);
		await expect(
			activatePreparedQueueRun({
				attach: vi.fn().mockResolvedValue(null),
				associate,
				launch,
			}),
		).resolves.toEqual({ kind: "lease_conflict" });
		await expect(
			activatePreparedQueueRun({
				attach: vi.fn().mockResolvedValue(attachment),
				associate,
				launch: null,
			}),
		).resolves.toEqual({ kind: "not_launchable", attachment });
		await expect(
			activatePreparedQueueRun({
				attach: vi.fn().mockResolvedValue(attachment),
				associate,
				launch,
			}),
		).resolves.toEqual({ kind: "launched", attachment });
		const error = new Error("activation failed");
		await expect(
			activatePreparedQueueRun({
				attach: vi.fn().mockResolvedValue(attachment),
				associate: vi.fn().mockRejectedValue(error),
				launch,
			}),
		).resolves.toEqual({ kind: "activation_failed", attachment, error });
	});

	it("selects isolated execution or drains an empty in-process queue", async () => {
		mocks.shouldUseIsolatedTaskExecutor.mockReturnValueOnce(true);
		mocks.runImplementationQueueInWorker.mockResolvedValueOnce(["worker-run"]);
		await expect(runImplementationQueue()).resolves.toEqual(["worker-run"]);
		await expect(runImplementationQueue()).resolves.toEqual([]);
		expect(mocks.getImplementationQueueSettings).toHaveBeenCalled();
		expect(mocks.claimNextImplementationQueueEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				processorCount: 2,
				leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
				allowExpiredClaimRecovery: false,
			}),
		);
	});

	it("shares a concurrent in-process drain and clears it for a retry", async () => {
		let releaseSettings: (() => void) | undefined;
		mocks.getImplementationQueueSettings.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseSettings = () => resolve({ processorCount: 1 });
				}),
		);
		const first = runImplementationQueueInProcess();
		await vi.waitFor(() => expect(releaseSettings).toBeTypeOf("function"));
		const concurrent = runImplementationQueueInProcess();
		releaseSettings?.();
		await expect(first).resolves.toEqual([]);
		await expect(concurrent).resolves.toEqual([]);
		await expect(runImplementationQueueInProcess()).resolves.toEqual([]);
	});

	it("launches claimed work in priority order and tolerates message failure", async () => {
		const firstEntry = queueEntry("priority-entry", "priority-task");
		const secondEntry = queueEntry("normal-entry", "normal-task");
		mocks.claimNextImplementationQueueEntry
			.mockResolvedValueOnce({ kind: "claimed", entry: firstEntry })
			.mockResolvedValueOnce({ kind: "claimed", entry: secondEntry })
			.mockResolvedValue({ kind: "capacity" });
		const firstRun = { ...preparedRun, id: "priority-run" };
		const secondRun = { ...preparedRun, id: "normal-run" };
		mocks.prepareTaskRunInProcess
			.mockResolvedValueOnce({
				run: firstRun,
				launch: vi.fn().mockResolvedValue(undefined),
			})
			.mockResolvedValueOnce({
				run: secondRun,
				launch: vi.fn().mockResolvedValue(undefined),
			});
		mocks.markImplementationQueueEntryProcessing
			.mockResolvedValueOnce({
				id: firstEntry.id,
				status: "processing",
				processorSlot: null,
				leaseOwnerId: "owner-1",
				leaseVersion: 3,
			})
			.mockResolvedValueOnce({
				id: secondEntry.id,
				status: "processing",
				processorSlot: 4,
				leaseOwnerId: "owner-2",
				leaseVersion: 3,
			});
		mocks.createTaskMessage.mockRejectedValue(new Error("message unavailable"));

		await expect(runImplementationQueueInProcess()).resolves.toEqual([
			firstRun,
			secondRun,
		]);
		expect(mocks.prepareTaskRunInProcess.mock.calls.map(([id]) => id)).toEqual([
			"priority-task",
			"normal-task",
		]);
		expect(mocks.createTaskMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				content: "Implementation Queue processor 1 started this run.",
			}),
		);
	});

	it("handles not-launchable work and retries after launch activation failure", async () => {
		const terminalRun = {
			...preparedRun,
			id: "terminal-run",
			status: "completed",
		};
		const failedRun = { ...preparedRun, id: "failed-launch-run" };
		mocks.claimNextImplementationQueueEntry
			.mockResolvedValueOnce({
				kind: "claimed",
				entry: queueEntry("terminal-entry", "terminal-task"),
			})
			.mockResolvedValueOnce({
				kind: "claimed",
				entry: queueEntry("failed-entry", "failed-task"),
			})
			.mockResolvedValue({ kind: "empty" });
		mocks.prepareTaskRunInProcess
			.mockResolvedValueOnce({ run: terminalRun, launch: null })
			.mockResolvedValueOnce({
				run: failedRun,
				launch: vi.fn().mockRejectedValue("launch rejected"),
			});
		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			id: "terminal-entry",
			status: "execution_completed",
		});
		mocks.getTaskRun.mockResolvedValueOnce(null);
		mocks.createTaskMessage.mockRejectedValueOnce(new Error("ignored"));

		await expect(runImplementationQueueInProcess()).resolves.toEqual([]);
		expect(mocks.completeImplementationQueueEntryForRunId).toHaveBeenCalledWith(
			{
				runId: "terminal-run",
				runStatus: "completed",
			},
		);
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				content:
					"Implementation Queue failed before runtime launch: launch rejected",
			}),
		);
	});

	it("projects activation failure and handles terminal, human, and CAS states", async () => {
		async function failWith(runId: string) {
			claimOnce(queueEntry(`entry-${runId}`, `task-${runId}`));
			mocks.prepareTaskRunInProcess.mockResolvedValueOnce({
				run: { ...preparedRun, id: runId, taskId: `task-${runId}` },
				launch: vi.fn().mockRejectedValue(new Error(`failure-${runId}`)),
			});
			await runImplementationQueueInProcess();
		}

		mocks.getTaskRun.mockResolvedValueOnce({ status: "completed" });
		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			status: "processing",
		});
		await failWith("terminal");

		mocks.getTaskRun.mockResolvedValueOnce({ status: "needs_human" });
		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			status: "processing",
		});
		await failWith("human");

		mocks.getTaskRun.mockResolvedValueOnce({ status: "running" });
		mocks.updateTaskRunIfStatus.mockResolvedValueOnce({ status: "failed" });
		mocks.projectTaskRunParentStatus.mockResolvedValueOnce({
			handled: false,
			status: "failed",
		});
		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			status: "processing",
		});
		await failWith("projected");

		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running" })
			.mockResolvedValueOnce({ status: "cancelled" });
		mocks.updateTaskRunIfStatus.mockResolvedValueOnce(null);
		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			status: "processing",
		});
		await failWith("cas-race");

		mocks.getTaskRun.mockResolvedValueOnce({ status: "running" });
		mocks.updateTaskRunIfStatus.mockResolvedValueOnce(null);
		await failWith("cas-missing");

		expect(mocks.assertRunStatusTransition).toHaveBeenCalledWith(
			"running",
			"failed",
		);
		expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
			"task-projected",
			"failed",
		);
	});

	it("records lease conflicts across cancellation and concurrent status races", async () => {
		async function conflict(run: Record<string, unknown>, entryId: string) {
			const entry = queueEntry(entryId, `task-${entryId}`);
			claimOnce(entry);
			mocks.prepareTaskRunInProcess.mockResolvedValueOnce({
				run,
				launch: vi.fn(),
			});
			mocks.markImplementationQueueEntryProcessing.mockResolvedValueOnce(null);
			await runImplementationQueueInProcess();
		}

		mocks.getImplementationQueueEntry.mockResolvedValueOnce(null);
		mocks.getTaskRun.mockResolvedValueOnce(null);
		mocks.updateTaskRunIfStatus.mockResolvedValueOnce({ status: "cancelled" });
		await conflict(
			{ ...preparedRun, id: "cancelled-run", status: "running" },
			"a",
		);

		mocks.getImplementationQueueEntry.mockResolvedValueOnce({
			status: "processing",
			activeRunId: "other-run",
			leaseOwnerId: "other-owner",
			leaseVersion: 9,
		});
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running" })
			.mockResolvedValueOnce({ status: "needs_human" });
		mocks.updateTaskRunIfStatus.mockResolvedValueOnce(null);
		await conflict({ ...preparedRun, id: "raced-run", status: "running" }, "b");

		mocks.getImplementationQueueEntry.mockResolvedValueOnce({
			status: "claimed",
			activeRunId: null,
		});
		mocks.getTaskRun.mockResolvedValueOnce({ status: "needs_human" });
		await conflict(
			{ ...preparedRun, id: "human-run", status: "needs_human" },
			"c",
		);

		expect(mocks.updateTaskStatus).toHaveBeenCalledWith("task-a", "queued");
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					actualStatus: null,
					actualLeaseOwnerId: null,
					actualLeaseVersion: null,
					actualActiveRunId: null,
					runtimeLaunched: false,
				}),
			}),
		);
	});

	it("recovers claimed entries when preparation throws Error or a primitive", async () => {
		for (const [index, thrown] of [
			new Error("prepare failed"),
			"primitive failure",
		].entries()) {
			claimOnce(queueEntry(`broken-${index}`, `broken-task-${index}`));
			mocks.prepareTaskRunInProcess.mockRejectedValueOnce(thrown);
			await expect(runImplementationQueueInProcess()).resolves.toEqual([]);
		}
		expect(
			mocks.recoverImplementationQueueEntryFromSnapshot,
		).toHaveBeenNthCalledWith(
			1,
			"broken-0",
			{ status: "claimed", leaseVersion: 3 },
			expect.objectContaining({
				status: "failed",
				statusReason: "prepare failed",
			}),
		);
		expect(mocks.createTaskMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				content:
					"Implementation Queue failed to start this task: primitive failure",
			}),
		);
	});

	it("completes queue bookkeeping with optional results and swallows errors", async () => {
		await completeImplementationQueueEntryForRun("missing", "failed");
		expect(
			mocks.completeImplementationQueueEntryForRunId,
		).not.toHaveBeenCalled();

		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			id: "entry-1",
			status: "processing",
		});
		mocks.completeImplementationQueueEntryForRunId.mockResolvedValueOnce(null);
		mocks.isProcessorReleasedQueueStatus.mockReturnValueOnce(false);
		await completeImplementationQueueEntryForRun("run-1", "failed");

		mocks.getImplementationQueueEntryForRun.mockResolvedValueOnce({
			id: "entry-2",
			status: "processing",
		});
		mocks.completeImplementationQueueEntryForRunId.mockResolvedValueOnce({
			status: "execution_completed",
		});
		mocks.isProcessorReleasedQueueStatus.mockReturnValueOnce(true);
		mocks.shouldUseIsolatedTaskExecutor.mockReturnValueOnce(true);
		await completeImplementationQueueEntryForRun("run-2", "completed");
		await vi.waitFor(() =>
			expect(mocks.runImplementationQueueInWorker).toHaveBeenCalled(),
		);

		mocks.getImplementationQueueEntryForRun.mockRejectedValueOnce(
			new Error("lookup failed"),
		);
		await expect(
			completeImplementationQueueEntryForRun("errored", "failed"),
		).resolves.toBeUndefined();
	});

	it("archives only terminal queue entries and ignores persistence errors", async () => {
		mocks.getImplementationQueueEntryForRun
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "active", status: "processing" })
			.mockResolvedValueOnce({ id: "done", status: "execution_completed" })
			.mockResolvedValueOnce({ id: "failed", status: "failed" });
		await archiveImplementationQueueEntryForRun("missing");
		await archiveImplementationQueueEntryForRun("active");
		await archiveImplementationQueueEntryForRun("done");
		mocks.updateImplementationQueueEntry.mockRejectedValueOnce(
			new Error("archive failed"),
		);
		await expect(
			archiveImplementationQueueEntryForRun("failed"),
		).resolves.toBeUndefined();
		expect(mocks.updateImplementationQueueEntry).toHaveBeenCalledWith(
			"done",
			expect.objectContaining({
				status: "execution_archived",
				processorSlot: null,
			}),
		);
	});

	it("honors repository, global, project, and empty queue capacity", async () => {
		mocks.getRepository.mockResolvedValueOnce(null);
		await expect(runSessionQueueForRepository("missing")).resolves.toEqual([]);

		mocks.getRepository.mockResolvedValueOnce({ queueEnabled: false });
		await expect(runSessionQueueForRepository("disabled")).resolves.toEqual([]);

		mocks.countActiveTaskRuns.mockResolvedValueOnce(4);
		await expect(runSessionQueueForRepository("global-full")).resolves.toEqual(
			[],
		);

		mocks.getRepository.mockResolvedValueOnce({
			queueEnabled: true,
			maxConcurrentSessions: 0,
		});
		mocks.countActiveTaskRuns.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
		await expect(runSessionQueueForRepository("project-full")).resolves.toEqual(
			[],
		);

		mocks.countActiveTaskRuns.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
		mocks.claimNextQueuedTask.mockResolvedValueOnce(null);
		await expect(runSessionQueueForRepository("empty")).resolves.toEqual([]);
	});

	it("starts session tasks in repository order and stops after an error", async () => {
		const highPriority = { id: "high-priority" };
		const normal = { id: "normal" };
		mocks.getRepository.mockResolvedValue({
			queueEnabled: true,
			maxConcurrentSessions: 2.8,
		});
		mocks.countActiveTaskRuns.mockResolvedValue(0);
		mocks.claimNextQueuedTask
			.mockResolvedValueOnce(highPriority)
			.mockResolvedValueOnce(normal)
			.mockResolvedValueOnce(null);
		const highRun = { ...preparedRun, id: "high-run" };
		const normalRun = { ...preparedRun, id: "normal-run" };
		mocks.startTaskRun
			.mockResolvedValueOnce(highRun)
			.mockResolvedValueOnce(normalRun);
		await expect(runSessionQueueForRepository("repository-1")).resolves.toEqual(
			[highRun, normalRun],
		);
		expect(mocks.startTaskRun.mock.calls.map(([id]) => id)).toEqual([
			"high-priority",
			"normal",
		]);

		mocks.claimNextQueuedTask.mockResolvedValueOnce({ id: "broken" });
		mocks.startTaskRun.mockRejectedValueOnce("session start failed");
		await expect(runSessionQueueForRepository("repository-1")).resolves.toEqual(
			[],
		);
		expect(mocks.updateTaskStatus).toHaveBeenCalledWith("broken", "failed");
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				content:
					"Session queue failed to start this task: session start failed",
			}),
		);
	});

	it("coalesces concurrent repository requests into the active drain", async () => {
		let releaseRepository: (() => void) | undefined;
		mocks.getRepository.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseRepository = () =>
						resolve({ queueEnabled: true, maxConcurrentSessions: 1 });
				}),
		);
		const first = runSessionQueueForRepository("repository-a");
		await vi.waitFor(() => expect(releaseRepository).toBeTypeOf("function"));
		const concurrent = runSessionQueueForRepository("repository-b");
		releaseRepository?.();
		await expect(first).resolves.toEqual([]);
		await expect(concurrent).resolves.toEqual([]);
		expect(mocks.getRepository).toHaveBeenCalledWith("repository-a");
		expect(mocks.getRepository).toHaveBeenCalledWith("repository-b");
	});
});
