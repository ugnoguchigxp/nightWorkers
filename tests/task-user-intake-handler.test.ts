import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	appendWorkbenchMessage: vi.fn(),
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.workbench-message.service",
	() => ({
		appendWorkbenchMessage: mocks.appendWorkbenchMessage,
	}),
);

import { handleTaskUserIntake } from "../api/modules/nightworkers/nightworkers.user-intake.handler";

describe("Task user intake handler", () => {
	beforeEach(() => {
		mocks.appendWorkbenchMessage.mockReset();
	});

	it("uses the exact Workbench intake command shape for a delegated user", async () => {
		const taskId = "598469c1-c9a6-4e9b-b581-5b00368249f9";
		const messageId = "faec6f1e-d633-4cc2-8e96-2b53ce406620";
		mocks.appendWorkbenchMessage.mockResolvedValue({
			task: null,
			run: null,
			messages: [
				{
					id: messageId,
					role: "user",
					metadataJson: {
						commandProvenance: {
							requestId: "request-1",
							idempotencyKey: "delivery-1",
						},
					},
				},
			],
		});

		await expect(
			handleTaskUserIntake({
				taskId,
				prompt: "Plan Modeで実装計画を開始してください",
				requestId: "request-1",
				idempotencyKey: "delivery-1",
				actor: { kind: "delegated_user", actorId: "mission-pilot-1" },
			}),
		).resolves.toEqual({ taskId, messageId });
		expect(mocks.appendWorkbenchMessage).toHaveBeenCalledWith(taskId, {
			prompt: "Plan Modeで実装計画を開始してください",
			intent: "intake",
			waitForIntake: false,
			source: "workbench",
			commandContext: {
				requestId: "request-1",
				idempotencyKey: "delivery-1",
				actor: { kind: "delegated_user", actorId: "mission-pilot-1" },
			},
		});
	});
});
