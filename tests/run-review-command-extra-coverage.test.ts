import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getRun: vi.fn(),
	getTask: vi.fn(),
	listEvents: vi.fn(),
	createEvent: vi.fn(),
	updateRun: vi.fn(),
	updateTaskStatus: vi.fn(),
	decideOutcome: vi.fn(),
	buildResult: vi.fn(),
	collectEvidence: vi.fn(),
	recordConfirmations: vi.fn(),
	completeQueue: vi.fn(),
	archiveQueue: vi.fn(),
	runQueue: vi.fn(),
	shouldContinue: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getRun,
	getTask: mocks.getTask,
	listTaskEventsForRun: mocks.listEvents,
	createRunEvent: mocks.createEvent,
	updateTaskRun: mocks.updateRun,
	updateTaskStatus: mocks.updateTaskStatus,
}));

vi.mock("../api/services/run-control/run-outcome-gate", () => ({
	decideRunOutcome: mocks.decideOutcome,
}));

vi.mock("../api/modules/codingAgent", () => ({
	recordManualConditionConfirmationsForReview: mocks.recordConfirmations,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.run-orchestration.service",
	() => ({
		archiveImplementationQueueEntryForRun: mocks.archiveQueue,
		completeImplementationQueueEntryForRun: mocks.completeQueue,
		runSessionQueueForRepository: mocks.runQueue,
		shouldContinueSessionQueue: mocks.shouldContinue,
	}),
);

vi.mock("../api/modules/review/results/build-review-result", () => ({
	buildReviewResult: mocks.buildResult,
}));

vi.mock("../api/modules/review/results/evidence-collector", () => ({
	collectDefaultReviewEvidence: mocks.collectEvidence,
}));

import { reviewTaskRunCommand } from "../api/modules/run/application/run-review.command";

const baseRun = {
	id: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	status: "needs_review",
	finalReport: "report",
	summary: "summary",
};

const request = {
	action: "approve" as const,
	note: "approved",
	evidenceRefs: [{ kind: "run_event" as const, eventId: "provided" }],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getRun.mockResolvedValue(baseRun);
	mocks.getTask.mockResolvedValue({
		id: "task-1",
		repositoryId: "fallback-repo",
		revision: 4,
	});
	mocks.listEvents.mockResolvedValue([{ id: "event-1" }]);
	mocks.decideOutcome.mockReturnValue({
		status: "completed",
		summary: "outcome summary",
		reason: "approved",
	});
	mocks.buildResult.mockReturnValue({ id: "review-result-1" });
	mocks.collectEvidence.mockReturnValue([
		{ kind: "run_event", eventId: "default" },
	]);
	mocks.shouldContinue.mockReturnValue(true);
	for (const mock of [
		mocks.createEvent,
		mocks.updateRun,
		mocks.updateTaskStatus,
		mocks.recordConfirmations,
		mocks.completeQueue,
		mocks.archiveQueue,
		mocks.runQueue,
	])
		mock.mockResolvedValue(undefined);
});

describe("run review command extra coverage", () => {
	it("rejects an absent run", async () => {
		mocks.getRun.mockResolvedValueOnce(null);
		await expect(reviewTaskRunCommand("missing", request)).rejects.toThrow(
			"Run not found",
		);
	});

	it("enforces resource ownership before reading task revision", async () => {
		await expect(
			reviewTaskRunCommand("run-1", request, {
				expectedTaskId: "other-task",
				expectedTaskRevision: 4,
			}),
		).rejects.toMatchObject({ code: "TASK_RESOURCE_OWNERSHIP_MISMATCH" });
		expect(mocks.getTask).not.toHaveBeenCalled();
	});

	it.each([
		[{ id: "task-1", revision: 5 }, 5],
		[null, null],
	] as const)("rejects a stale revision with current revision %#", async (task, expectedCurrent) => {
		mocks.getTask.mockResolvedValueOnce(task);
		await expect(
			reviewTaskRunCommand("run-1", request, {
				expectedTaskId: "task-1",
				expectedTaskRevision: 4,
			}),
		).rejects.toMatchObject({
			code: "TASK_REVISION_CONFLICT",
			details: { currentTaskRevision: expectedCurrent },
		});
	});

	it("completes an approved run with explicit evidence and direct repository queue", async () => {
		const result = await reviewTaskRunCommand("run-1", request, {
			expectedTaskId: "task-1",
			expectedTaskRevision: 4,
		});
		expect(result).toMatchObject({ ok: true, status: "completed" });
		expect(mocks.collectEvidence).not.toHaveBeenCalled();
		expect(mocks.buildResult).toHaveBeenCalledWith(
			expect.objectContaining({ evidenceRefs: request.evidenceRefs }),
		);
		expect(mocks.recordConfirmations).toHaveBeenCalledWith(
			expect.objectContaining({ actorId: "review-result-1" }),
		);
		expect(mocks.archiveQueue).toHaveBeenCalledWith("run-1");
		expect(mocks.getTask).toHaveBeenCalledOnce();
		expect(mocks.runQueue).toHaveBeenCalledWith("repository-1");
		expect(mocks.createEvent).toHaveBeenCalledTimes(2);
	});

	it("uses runtime and request fallbacks with collected evidence", async () => {
		mocks.getRun.mockResolvedValueOnce({
			...baseRun,
			status: "unknown",
			finalReport: null,
			summary: null,
		});
		mocks.decideOutcome.mockReturnValueOnce({
			status: "needs_human",
			summary: "needs attention",
			reason: "human",
		});
		mocks.shouldContinue.mockReturnValueOnce(false);
		const result = await reviewTaskRunCommand("run-1", {
			action: "request_changes",
			note: "",
			evidenceRefs: [],
		});
		expect(result.status).toBe("needs_human");
		expect(mocks.decideOutcome).toHaveBeenCalledWith({
			runtime: expect.objectContaining({
				finalReport: "",
				terminalState: "needs_review",
				summary: "Review action: request_changes",
			}),
			humanAction: "request_changes",
		});
		expect(mocks.collectEvidence).toHaveBeenCalled();
		expect(mocks.recordConfirmations).not.toHaveBeenCalled();
		expect(mocks.archiveQueue).not.toHaveBeenCalled();
		expect(mocks.runQueue).not.toHaveBeenCalled();
		expect(mocks.updateRun).toHaveBeenCalledWith("run-1", {
			status: "needs_human",
			summary: "needs attention",
		});
	});

	it.each([
		"completed",
		"needs_review",
		"needs_human",
		"failed",
		"timed_out",
		"blocked",
	] as const)("passes terminal state %s to the outcome gate", async (status) => {
		mocks.getRun.mockResolvedValueOnce({ ...baseRun, status });
		mocks.decideOutcome.mockReturnValueOnce({
			status: "failed",
			summary: "failed",
			reason: "test",
		});
		mocks.shouldContinue.mockReturnValueOnce(false);
		await reviewTaskRunCommand("run-1", { action: "reject", note: null });
		expect(mocks.decideOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: expect.objectContaining({ terminalState: status }),
			}),
		);
	});

	it("loads the task repository only when the run has no repository", async () => {
		mocks.getRun.mockResolvedValueOnce({ ...baseRun, repositoryId: null });
		mocks.getTask.mockResolvedValueOnce({ repositoryId: "task-repository" });
		await reviewTaskRunCommand("run-1", request);
		expect(mocks.runQueue).toHaveBeenCalledWith("task-repository");

		mocks.getRun.mockResolvedValueOnce({ ...baseRun, repositoryId: null });
		mocks.getTask.mockResolvedValueOnce(null);
		await reviewTaskRunCommand("run-1", request);
		expect(mocks.runQueue).toHaveBeenCalledTimes(1);
	});
});
