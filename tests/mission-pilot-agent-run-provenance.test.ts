import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	queueTask: vi.fn(async () => ({ id: "queue" })),
	startVerificationRunFromArtifact: vi.fn(async () => ({ id: "test-run" })),
	startTaskRun: vi.fn(async () => ({ id: "implementation-run" })),
	startReviewRun: vi.fn(async () => ({ id: "review-run" })),
}));

vi.mock("../api/modules/nightworkers/nightworkers.service", () => ({
	queueTask: mocks.queueTask,
	startVerificationRunFromArtifact: mocks.startVerificationRunFromArtifact,
}));
vi.mock(
	"../api/modules/nightworkers/run-orchestration/start-task-run-entry",
	() => ({ startTaskRun: mocks.startTaskRun }),
);
vi.mock("../api/modules/review/review-mode.service", () => ({
	startReviewRun: mocks.startReviewRun,
}));

import { executeMissionPilotAction } from "../api/modules/missionPilot/agent/mission-pilot-action-command-executor";

const context = {
	sessionId: "session-1",
	toolCallId: "tool-call-1",
	idempotencyKey: "session-1:tool-call-1",
	sourceRunId: "source-run-1",
};
const provenance = {
	kind: "agent",
	sessionId: context.sessionId,
	toolCallId: context.toolCallId,
	idempotencyKey: context.idempotencyKey,
	completionOwner: "mission_pilot",
	sourceRunId: context.sourceRunId,
};

describe("Mission Pilot agent Run provenance", () => {
	it("passes the same ownership envelope to Implementation, Test, Review, and Queue paths", async () => {
		await executeMissionPilotAction(
			"task-1",
			"run.implementation.start",
			{ request: "implement" },
			context,
		);
		await executeMissionPilotAction(
			"task-1",
			"run.test.start",
			{
				projectId: "project-1",
				specArtifactId: "artifact-1",
				action: "run_unit_tests",
			},
			context,
		);
		await executeMissionPilotAction(
			"task-1",
			"review.run.start",
			{ reviewSessionId: "review-session-1" },
			context,
		);
		await executeMissionPilotAction(
			"task-1",
			"task.queue.enqueue",
			{},
			context,
		);

		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				codingAgentInvocationSource: "mission_pilot",
				missionPilotAgent: provenance,
			}),
		);
		expect(mocks.startVerificationRunFromArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ missionPilotAgent: provenance }),
		);
		expect(mocks.startReviewRun).toHaveBeenCalledWith(
			"review-session-1",
			undefined,
			{ missionPilotAgent: provenance },
		);
		expect(mocks.queueTask).toHaveBeenCalledWith("task-1", {
			missionPilotAgent: provenance,
		});
	});
});
