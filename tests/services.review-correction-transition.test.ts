import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createReviewFindings: vi.fn(),
	createRunEvent: vi.fn(),
	createTaskMessage: vi.fn(),
	getReviewSession: vi.fn(),
	listReviewArtifacts: vi.fn(),
	startTaskRun: vi.fn(),
	upsertReviewArtifact: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	createRunEvent: mocks.createRunEvent,
	createTaskMessage: mocks.createTaskMessage,
}));

vi.mock("../api/modules/review/review-mode.repository", () => ({
	createReviewFindings: mocks.createReviewFindings,
	getReviewSession: mocks.getReviewSession,
	listReviewArtifacts: mocks.listReviewArtifacts,
	upsertReviewArtifact: mocks.upsertReviewArtifact,
}));

vi.mock(
	"../api/modules/nightworkers/run-orchestration/start-task-run-entry",
	() => ({ startTaskRun: mocks.startTaskRun }),
);

import { finalizeReviewRunFromRuntime } from "../api/modules/review/review-run-finalize.service";

describe("Review correction transition", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getReviewSession.mockResolvedValue({
			id: "review-session-1",
			runId: "implementation-run-1",
			taskId: "task-1",
		});
		mocks.listReviewArtifacts.mockResolvedValue([]);
		mocks.startTaskRun.mockResolvedValue({ id: "correction-run-1" });
	});

	it("starts a new Implementation Session for direct applyFixes options", async () => {
		await finalizeReviewRunFromRuntime(
			finalizeInput({ applyFixes: true, commitChanges: true }),
		);

		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				executionMode: "implementation",
				runtimeOptionsPatch: {
					reviewCorrection: expect.objectContaining({
						phase: "implementation",
						cycle: 1,
						applyFixes: true,
						commitChanges: true,
					}),
				},
			}),
		);
	});

	it("increments the correction cycle for a follow-up Review", async () => {
		await finalizeReviewRunFromRuntime({
			...finalizeInput({ applyFixes: true, commitChanges: false }),
			contextSnapshot: {
				...reviewContext({ applyFixes: true, commitChanges: false }),
				reviewCorrection: { phase: "review", cycle: 1 },
			},
		});

		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				runtimeOptionsPatch: {
					reviewCorrection: expect.objectContaining({ cycle: 2 }),
				},
			}),
		);
	});

	it("does not duplicate Mission Pilot correction ownership", async () => {
		await finalizeReviewRunFromRuntime({
			...finalizeInput({ applyFixes: true, commitChanges: true }),
			contextSnapshot: {
				...reviewContext({ applyFixes: true, commitChanges: true }),
				missionPilot: { sessionId: "pilot-1" },
			},
		});

		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});
});

function finalizeInput(options: {
	applyFixes: boolean;
	commitChanges: boolean;
}) {
	return {
		runId: "review-run-1",
		taskId: "task-1",
		status: "completed" as const,
		contextSnapshot: reviewContext(options),
		runtimeResult: {
			terminalState: "completed" as const,
			summary: "Review completed",
			finalReport: JSON.stringify({
				findings: [
					{
						severity: "warning",
						title: "Fix the persisted transition",
						body: "Accepted finding",
						path: "api/example.ts",
					},
				],
			}),
			stoppedBy: "decision" as const,
			riskLevel: "medium" as const,
			diffPatch: "",
			logContent: "",
		},
	};
}

function reviewContext(options: {
	applyFixes: boolean;
	commitChanges: boolean;
}) {
	return {
		reviewRun: {
			reviewSessionId: "review-session-1",
			reviewedRunId: "implementation-run-1",
			options,
		},
	};
}
