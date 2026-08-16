import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertDraftComplete: vi.fn(),
	hasPlanEvidence: vi.fn(),
	getTask: vi.fn(),
	listTaskMessages: vi.fn(),
	updateTask: vi.fn(),
	createTaskMessage: vi.fn(),
	getTaskRun: vi.fn(),
	getEntry: vi.fn(),
	hasActiveEntry: vi.fn(),
	createEntry: vi.fn(),
	admitEntry: vi.fn(),
	updateEntry: vi.fn(),
	cancelEntryWithoutRun: vi.fn(),
	resumeEntryWithoutRun: vi.fn(),
	completeEntryForRun: vi.fn(),
	stopRun: vi.fn(),
	updateSettings: vi.fn(),
	getTodoSettings: vi.fn(),
	updateTodoSettings: vi.fn(),
	assertApproval: vi.fn(),
	ensureApproval: vi.fn(),
	resolveScheduling: vi.fn(),
	runQueue: vi.fn(),
	isRunningRunStatus: vi.fn(),
	isTerminalQueueStatus: vi.fn(),
	recordRecoveryEvidence: vi.fn(),
	prepareRepository: vi.fn(),
	isProcessorReleased: vi.fn(),
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.planning-helpers.service",
	() => ({
		assertTaskDraftComplete: mocks.assertDraftComplete,
		hasImplementationPlanEvidence: mocks.hasPlanEvidence,
	}),
);
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: mocks.getTask,
	listTaskMessages: mocks.listTaskMessages,
	updateTask: mocks.updateTask,
	createTaskMessage: mocks.createTaskMessage,
	getTaskRun: mocks.getTaskRun,
}));
vi.mock("../api/modules/queue/queue.repository", () => ({
	getImplementationQueueEntry: mocks.getEntry,
	hasActiveImplementationQueueEntry: mocks.hasActiveEntry,
	createImplementationQueueEntry: mocks.createEntry,
	admitImplementationQueueEntry: mocks.admitEntry,
	updateImplementationQueueEntry: mocks.updateEntry,
	cancelImplementationQueueEntryWithoutRun: mocks.cancelEntryWithoutRun,
	resumeImplementationQueueEntryWithoutRun: mocks.resumeEntryWithoutRun,
	QueueEntryTransitionConflict: class QueueEntryTransitionConflict extends Error {},
	completeImplementationQueueEntryForRunId: mocks.completeEntryForRun,
	updateImplementationQueueSettings: mocks.updateSettings,
	getTodoWorkflowSettings: mocks.getTodoSettings,
	updateTodoWorkflowSettings: mocks.updateTodoSettings,
}));
vi.mock("../api/modules/nightworkers/run-orchestration/stop-task-run", () => ({
	stopTaskRun: mocks.stopRun,
}));
vi.mock("../api/modules/queue/queue-admission.service", () => ({
	assertMissionProposalQueueApproval: mocks.assertApproval,
	ensureMissionProposalQueueApproval: mocks.ensureApproval,
	resolveSchedulingDecisionFromMessages: mocks.resolveScheduling,
	runImplementationQueueWhenEnabled: mocks.runQueue,
}));
vi.mock("../api/modules/queue/queue-health.service", () => ({
	isRunningRunStatus: mocks.isRunningRunStatus,
	isTerminalQueueStatus: mocks.isTerminalQueueStatus,
	recordQueueRecoveryEvidence: mocks.recordRecoveryEvidence,
}));
vi.mock("../api/modules/queue/queue-repository-readiness.service", () => ({
	prepareImplementationQueueRepository: mocks.prepareRepository,
}));
vi.mock("../api/modules/queue/queue-repository-row-mapper", () => ({
	isProcessorReleasedQueueStatus: mocks.isProcessorReleased,
}));

const service = await import(
	"../api/modules/queue/queue-entry-commands.service"
);

const taskId = "task-1";
const entryId = "entry-1";
const task = {
	id: taskId,
	repositoryId: "repo-1",
	status: "ready",
	priority: 3,
	updatedAt: new Date("2026-08-16T00:00:00.000Z"),
};
const queuedTask = { ...task, status: "queued" };
const messages = [{ id: "message-1" }];

function entry(overrides: Record<string, unknown> = {}) {
	return {
		id: entryId,
		taskId,
		repositoryId: "repo-1",
		status: "queued",
		priority: 3,
		queuePosition: 4,
		statusReason: "existing reason",
		processorSlot: null,
		activeRunId: "run-1",
		leaseVersion: 3,
		...overrides,
	};
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.getTask.mockResolvedValue(task);
	mocks.listTaskMessages.mockResolvedValue(messages);
	mocks.updateTask.mockResolvedValue(queuedTask);
	mocks.createTaskMessage.mockResolvedValue({ id: "system-message" });
	mocks.getTaskRun.mockResolvedValue({ id: "run-1", status: "succeeded" });
	mocks.getEntry.mockResolvedValue(entry());
	mocks.hasActiveEntry.mockResolvedValue(false);
	mocks.createEntry.mockResolvedValue(entry());
	mocks.admitEntry.mockResolvedValue({
		entry: entry(),
		task: queuedTask,
		message: { id: "system-message" },
	});
	mocks.updateEntry.mockImplementation(
		async (id: string, changes: Record<string, unknown>) =>
			entry({ id, ...changes }),
	);
	mocks.cancelEntryWithoutRun.mockImplementation(
		async ({ entry: snapshot }) => ({
			kind: "applied",
			entry: entry({
				id: snapshot.id,
				status: "cancelled",
				activeRunId: snapshot.expectedActiveRunId,
				leaseVersion: snapshot.expectedLeaseVersion + 1,
			}),
			task: null,
		}),
	);
	mocks.resumeEntryWithoutRun.mockImplementation(async (snapshot) => ({
		kind: "applied",
		entry: entry({
			id: snapshot.id,
			status: "queued",
			activeRunId: null,
			leaseVersion: snapshot.expectedLeaseVersion + 1,
			claimReady: true,
		}),
		task: null,
	}));
	mocks.stopRun.mockResolvedValue({ id: "run-1", status: "cancelled" });
	mocks.completeEntryForRun.mockResolvedValue(
		entry({ status: "execution_completed" }),
	);
	mocks.updateSettings.mockResolvedValue({ processorCount: 4 });
	mocks.getTodoSettings.mockResolvedValue({ enabled: true });
	mocks.updateTodoSettings.mockResolvedValue({ enabled: false });
	mocks.hasPlanEvidence.mockReturnValue(true);
	mocks.ensureApproval.mockResolvedValue(messages);
	mocks.resolveScheduling.mockReturnValue({
		executionType: "exclusive",
		sequenceGroupId: null,
		sequenceOrder: null,
		schedulingReason: "default",
	});
	mocks.prepareRepository.mockResolvedValue(null);
	mocks.isRunningRunStatus.mockImplementation(
		(status: string) => status === "running",
	);
	mocks.isTerminalQueueStatus.mockImplementation((status: string) =>
		[
			"execution_completed",
			"execution_archived",
			"failed",
			"cancelled",
		].includes(status),
	);
	mocks.isProcessorReleased.mockReturnValue(true);
	mocks.recordRecoveryEvidence.mockResolvedValue(undefined);
});

describe("queue settings and queueTask coverage", () => {
	it("updates settings, triggers scheduling, and delegates todo settings", async () => {
		await expect(
			service.updateImplementationQueueSettings(
				{ processorCount: 4 },
				{ autoDrain: false },
			),
		).resolves.toEqual({ processorCount: 4 });
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });
		await expect(service.getTodoWorkflowSettings()).resolves.toEqual({
			enabled: true,
		});
		await expect(
			service.updateTodoWorkflowSettings({ enabled: false } as never),
		).resolves.toEqual({ enabled: false });
	});

	it("queues and rereads the task", async () => {
		mocks.getTask
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(queuedTask);
		await expect(service.queueTask(taskId, { autoDrain: false })).resolves.toBe(
			queuedTask,
		);
		expect(mocks.admitEntry).toHaveBeenCalledOnce();
	});

	it("fails queueTask when the post-command task disappears", async () => {
		mocks.getTask
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce(null);
		await expect(service.queueTask(taskId)).rejects.toMatchObject({
			statusCode: 404,
			message: "Task not found",
		});
	});
});

describe("createImplementationQueueEntry coverage", () => {
	it("rejects a missing task and every terminal status", async () => {
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			service.createImplementationQueueEntry(taskId),
		).rejects.toMatchObject({ statusCode: 404 });
		for (const status of ["completed", "cancelled", "failed", "timed_out"]) {
			mocks.getTask.mockResolvedValueOnce({ ...task, status });
			await expect(
				service.createImplementationQueueEntry(taskId),
			).rejects.toMatchObject({ code: "TASK_TERMINAL" });
		}
	});

	it("propagates draft validation before repository admission", async () => {
		const error = new Error("draft incomplete");
		mocks.assertDraftComplete.mockImplementationOnce(() => {
			throw error;
		});
		await expect(service.createImplementationQueueEntry(taskId)).rejects.toBe(
			error,
		);
		expect(mocks.hasActiveEntry).not.toHaveBeenCalled();
	});

	it("rejects duplicate entries and tasks without implementation evidence", async () => {
		mocks.hasActiveEntry.mockResolvedValueOnce(true);
		await expect(
			service.createImplementationQueueEntry(taskId),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_EXISTS" });
		mocks.hasPlanEvidence.mockReturnValueOnce(false);
		mocks.getTask.mockResolvedValueOnce({ ...task, status: "draft" });
		await expect(
			service.createImplementationQueueEntry(taskId),
		).rejects.toMatchObject({ code: "IMPLEMENTATION_PLAN_REQUIRED" });
	});

	it("rechecks admission preconditions after workspace preparation changes the Task snapshot", async () => {
		mocks.hasPlanEvidence.mockReturnValue(false);
		mocks.getTask
			.mockResolvedValueOnce(task)
			.mockResolvedValueOnce({ ...task, status: "running" });

		await expect(
			service.createImplementationQueueEntry(taskId, { autoDrain: false }),
		).rejects.toMatchObject({ code: "IMPLEMENTATION_PLAN_REQUIRED" });
		expect(mocks.admitEntry).not.toHaveBeenCalled();
	});

	it("allows ready tasks without plan evidence and materializes workspace metadata", async () => {
		mocks.hasPlanEvidence.mockReturnValue(false);
		mocks.prepareRepository.mockResolvedValue({ id: "workspace-1" });
		const result = await service.createImplementationQueueEntry(taskId, {
			autoDrain: false,
		});
		expect(result).toEqual(entry());
		expect(mocks.assertApproval).toHaveBeenCalledWith(messages);
		expect(mocks.admitEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				task: expect.objectContaining({
					id: taskId,
					expectedStatus: "ready",
				}),
				entry: {
					taskId,
					repositoryId: "repo-1",
					priority: 3,
					executionType: "exclusive",
					executionLockKey: "repository:repo-1",
					sequenceGroupId: null,
					sequenceOrder: null,
					schedulingReason: "default",
					workspaceId: "workspace-1",
					workspaceRequired: true,
				},
			}),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });
	});

	it("keeps already queued tasks and omits workspace metadata", async () => {
		mocks.getTask.mockResolvedValue(queuedTask);
		await service.createImplementationQueueEntry(taskId);
		expect(mocks.admitEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				task: expect.objectContaining({ expectedStatus: "queued" }),
				entry: expect.objectContaining({
					workspaceId: null,
					workspaceRequired: false,
				}),
			}),
		);
	});

	it("does not schedule when transactional admission reports a Task conflict", async () => {
		mocks.admitEntry.mockRejectedValueOnce(new Error("Task snapshot conflict"));
		await expect(
			service.createImplementationQueueEntry(taskId),
		).rejects.toThrow("Task snapshot conflict");
		expect(mocks.runQueue).not.toHaveBeenCalled();
	});

	it("does not publish or schedule when queue persistence fails", async () => {
		const error = new Error("repository write failed");
		mocks.admitEntry.mockRejectedValue(error);
		await expect(service.createImplementationQueueEntry(taskId)).rejects.toBe(
			error,
		);
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
		expect(mocks.runQueue).not.toHaveBeenCalled();
	});

	it("maps the active-task unique constraint to the Queue conflict contract", async () => {
		mocks.admitEntry.mockRejectedValueOnce({
			code: "SQLITE_CONSTRAINT_UNIQUE",
		});
		await expect(
			service.createImplementationQueueEntry(taskId),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_EXISTS", statusCode: 409 });
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
		expect(mocks.runQueue).not.toHaveBeenCalled();
	});
});

describe("patchImplementationQueueEntry coverage", () => {
	it("rejects missing entries", async () => {
		mocks.getEntry.mockResolvedValue(null);
		await expect(
			service.patchImplementationQueueEntry(entryId, {}),
		).rejects.toMatchObject({ statusCode: 404 });
	});

	it("cancels an inactive entry with Queue and Task snapshots in one command", async () => {
		mocks.getTask.mockResolvedValueOnce(queuedTask);
		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		const cancelled = await service.patchImplementationQueueEntry(
			entryId,
			{ action: "cancel" },
			{ autoDrain: false },
		);
		expect(cancelled).toMatchObject({ status: "cancelled" });
		expect(mocks.cancelEntryWithoutRun).toHaveBeenCalledWith(
			expect.objectContaining({
				entry: expect.objectContaining({
					expectedStatus: "queued",
					expectedLeaseVersion: 3,
					expectedActiveRunId: null,
				}),
				task: expect.objectContaining({ expectedStatus: "queued" }),
			}),
		);
		expect(mocks.updateTask).not.toHaveBeenCalled();

		mocks.getTask.mockResolvedValueOnce(task);
		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		await service.patchImplementationQueueEntry(entryId, { action: "cancel" });
		expect(mocks.cancelEntryWithoutRun).toHaveBeenCalledTimes(2);

		mocks.getTask.mockResolvedValueOnce(null);
		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		await expect(
			service.patchImplementationQueueEntry(entryId, { action: "cancel" }),
		).rejects.toMatchObject({ statusCode: 404 });
	});

	it("resumes only inactive needs_human entries to queued and schedules a claim", async () => {
		await expect(
			service.patchImplementationQueueEntry(entryId, { action: "resume" }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_NOT_RESUMABLE" });
		mocks.getEntry.mockResolvedValueOnce(
			entry({ status: "needs_human", activeRunId: null }),
		);
		await expect(
			service.patchImplementationQueueEntry(
				entryId,
				{ action: "resume" },
				{ autoDrain: false },
			),
		).resolves.toMatchObject({
			status: "queued",
			activeRunId: null,
			claimReady: true,
		});
		expect(mocks.resumeEntryWithoutRun).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedStatus: "needs_human",
				expectedActiveRunId: null,
			}),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });
	});

	it("requires the Task Run resume command for an active human-blocked Run", async () => {
		mocks.getEntry.mockResolvedValueOnce(
			entry({ status: "needs_human", activeRunId: "run-1" }),
		);
		mocks.getTaskRun.mockResolvedValueOnce({
			id: "run-1",
			status: "needs_human",
		});
		await expect(
			service.patchImplementationQueueEntry(entryId, { action: "resume" }),
		).rejects.toMatchObject({
			code: "QUEUE_RUN_REQUIRES_TASK_RESUME",
			details: { activeRunId: "run-1" },
		});
		expect(mocks.resumeEntryWithoutRun).not.toHaveBeenCalled();
	});

	it("reorders only queued entries and preserves omitted values", async () => {
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "processing" }));
		await expect(
			service.patchImplementationQueueEntry(entryId, { priority: 9 }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_NOT_REORDERABLE" });
		await service.patchImplementationQueueEntry(entryId, {
			priority: 0,
			queuePosition: 0,
		});
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(entryId, {
			priority: 0,
			queuePosition: 0,
		});
		await service.patchImplementationQueueEntry(entryId, {
			priority: undefined,
			queuePosition: null,
		});
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(entryId, {
			priority: 3,
			queuePosition: 4,
		});
	});
});

describe("archiveImplementationQueueEntry coverage", () => {
	it("rejects missing and non-terminal entries", async () => {
		mocks.getEntry.mockResolvedValueOnce(null);
		await expect(
			service.archiveImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ statusCode: 404 });
		await expect(
			service.archiveImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_NOT_ARCHIVABLE" });
	});

	it.each([
		"execution_completed",
		"failed",
		"cancelled",
	])("archives %s entries and releases scheduling", async (status) => {
		mocks.getEntry.mockResolvedValueOnce(entry({ status }));
		await expect(
			service.archiveImplementationQueueEntry(entryId, {
				autoDrain: false,
			}),
		).resolves.toMatchObject({ status: "execution_archived" });
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(
			entryId,
			expect.objectContaining({
				status: "execution_archived",
				processorSlot: null,
				archivedAt: expect.any(Date),
			}),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });
	});
});

describe("recoverImplementationQueueEntry coverage", () => {
	it("rejects missing entries and unsupported actions", async () => {
		mocks.getEntry.mockResolvedValueOnce(null);
		await expect(
			service.recoverImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ statusCode: 404 });
		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		await expect(
			service.recoverImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ code: "QUEUE_RECOVERY_ACTION_INVALID" });
		expect(mocks.getTaskRun).not.toHaveBeenCalled();
	});

	it("delegates archive and cancel recovery and records cancellation evidence", async () => {
		mocks.getEntry.mockResolvedValue(entry({ status: "failed" }));
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "archive" }),
		).resolves.toMatchObject({ status: "execution_archived" });

		mocks.getEntry.mockResolvedValue(
			entry({ status: "queued", activeRunId: null }),
		);
		mocks.getTask.mockResolvedValue(task);
		await expect(
			service.recoverImplementationQueueEntry(entryId, {
				action: "cancel",
				note: "stop",
			}),
		).resolves.toMatchObject({ status: "cancelled" });
		expect(mocks.recordRecoveryEvidence).toHaveBeenCalledWith({
			taskId,
			runId: null,
			queueEntryId: entryId,
			action: "cancel",
			reason: "manual_cancel",
			note: "stop",
		});
	});

	it("rejects unsafe completion without a terminal active run", async () => {
		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "complete" }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_COMPLETION_UNSAFE" });
		mocks.getEntry.mockResolvedValueOnce(entry());
		mocks.getTaskRun.mockResolvedValueOnce({ id: "run-1", status: "running" });
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "complete" }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_COMPLETION_UNSAFE" });
	});

	it("handles completion conflicts and idempotent terminal entries", async () => {
		mocks.completeEntryForRun.mockResolvedValue(null);
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "processing" }));
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "complete" }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_COMPLETION_CONFLICT" });
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "complete" }),
		).resolves.toMatchObject({ status: "failed" });
	});

	it("records successful completion and schedules only released statuses", async () => {
		const completed = entry({ status: "execution_completed" });
		mocks.completeEntryForRun.mockResolvedValue(completed);
		await expect(
			service.recoverImplementationQueueEntry(
				entryId,
				{ action: "complete", note: "verified" },
				{ autoDrain: false },
			),
		).resolves.toBe(completed);
		expect(mocks.recordRecoveryEvidence).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "complete",
				reason: "manual_complete",
				note: "verified",
			}),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });

		mocks.runQueue.mockClear();
		mocks.isProcessorReleased.mockReturnValue(false);
		await service.recoverImplementationQueueEntry(entryId, {
			action: "complete",
		});
		expect(mocks.runQueue).not.toHaveBeenCalled();
	});

	it("rejects retry while a run is active", async () => {
		mocks.getTaskRun.mockResolvedValue({ id: "run-1", status: "running" });
		await expect(
			service.recoverImplementationQueueEntry(entryId, { action: "retry" }),
		).rejects.toMatchObject({ code: "QUEUE_ENTRY_RETRY_UNSAFE" });
	});

	it("retries terminal and runless entries with normalized notes", async () => {
		await service.recoverImplementationQueueEntry(
			entryId,
			{ action: "retry", note: "  try again  " },
			{ autoDrain: false },
		);
		expect(mocks.updateEntry).toHaveBeenCalledWith(
			entryId,
			expect.objectContaining({
				status: "queued",
				activeRunId: null,
				statusReason: "try again",
			}),
		);
		expect(mocks.recordRecoveryEvidence).toHaveBeenCalledWith(
			expect.objectContaining({ runId: "run-1", action: "retry" }),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });

		mocks.getEntry.mockResolvedValueOnce(entry({ activeRunId: null }));
		await service.recoverImplementationQueueEntry(entryId, {
			action: "retry",
			note: " ",
		});
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(
			entryId,
			expect.objectContaining({ statusReason: null }),
		);
		expect(mocks.recordRecoveryEvidence).toHaveBeenLastCalledWith(
			expect.objectContaining({ runId: undefined }),
		);
	});

	it("marks entries needs_human with supplied or default reasons", async () => {
		await service.recoverImplementationQueueEntry(entryId, {
			action: "mark_needs_human",
			note: "  investigate  ",
		});
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(
			entryId,
			expect.objectContaining({
				status: "needs_human",
				statusReason: "investigate",
			}),
		);
		await service.recoverImplementationQueueEntry(entryId, {
			action: "mark_needs_human",
		});
		expect(mocks.updateEntry).toHaveBeenLastCalledWith(
			entryId,
			expect.objectContaining({
				statusReason: "Marked needs_human by Queue recovery.",
			}),
		);
	});
});

describe("requeueImplementationQueueEntry coverage", () => {
	it("rejects missing, active, missing-task, and cancelled-task states", async () => {
		mocks.getEntry.mockResolvedValueOnce(null);
		await expect(
			service.requeueImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ statusCode: 404 });
		for (const status of [
			"queued",
			"claimed",
			"processing",
			"awaiting_commit_decision",
		]) {
			mocks.getEntry.mockResolvedValueOnce(entry({ status }));
			await expect(
				service.requeueImplementationQueueEntry(entryId),
			).rejects.toMatchObject({ code: "QUEUE_ENTRY_ALREADY_ACTIVE" });
		}
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(
			service.requeueImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ statusCode: 404 });
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		mocks.getTask.mockResolvedValueOnce({ ...task, status: "cancelled" });
		await expect(
			service.requeueImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ code: "TASK_CANCELLED" });
	});

	it("archives the previous entry, queues the task, and preserves ordering", async () => {
		const next = entry({ id: "entry-2", priority: 3, queuePosition: 4 });
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		mocks.createEntry.mockResolvedValueOnce(next);
		await expect(
			service.requeueImplementationQueueEntry(
				entryId,
				{ note: "  retry after fix  " },
				{ autoDrain: false },
			),
		).resolves.toBe(next);
		expect(mocks.updateEntry).toHaveBeenCalledWith(
			entryId,
			expect.objectContaining({
				status: "execution_archived",
				statusReason: "retry after fix",
			}),
		);
		expect(mocks.updateTask).toHaveBeenCalledWith(taskId, { status: "queued" });
		expect(mocks.createEntry).toHaveBeenCalledWith({
			taskId,
			repositoryId: "repo-1",
			priority: 3,
			queuePosition: 4,
		});
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({
					previousQueueEntryId: entryId,
					queueEntryId: "entry-2",
					note: "retry after fix",
				}),
			}),
		);
		expect(mocks.runQueue).toHaveBeenCalledWith({ autoDrain: false });
	});

	it("skips redundant archive/task updates and omits a blank note", async () => {
		mocks.getEntry.mockResolvedValueOnce(
			entry({ status: "execution_archived" }),
		);
		mocks.getTask.mockResolvedValueOnce(queuedTask);
		await service.requeueImplementationQueueEntry(entryId, { note: " " });
		expect(mocks.updateEntry).not.toHaveBeenCalled();
		expect(mocks.updateTask).not.toHaveBeenCalled();
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				payloadJson: expect.objectContaining({ note: undefined }),
			}),
		);
	});

	it("stops downstream writes when task or queue persistence conflicts", async () => {
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		mocks.updateTask.mockResolvedValueOnce(null);
		await expect(
			service.requeueImplementationQueueEntry(entryId),
		).rejects.toMatchObject({ statusCode: 404 });
		expect(mocks.createEntry).not.toHaveBeenCalled();

		const error = new Error("queue insert conflict");
		mocks.getEntry.mockResolvedValueOnce(entry({ status: "failed" }));
		mocks.createEntry.mockRejectedValueOnce(error);
		await expect(service.requeueImplementationQueueEntry(entryId)).rejects.toBe(
			error,
		);
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
		expect(mocks.runQueue).not.toHaveBeenCalled();
	});
});
