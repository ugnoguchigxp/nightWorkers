import { afterEach, describe, expect, it, vi } from "vitest";
import { executeMissionPilotAction } from "../api/modules/missionPilot/agent/mission-pilot-action-command-executor";
import * as nightworkersService from "../api/modules/nightworkers/nightworkers.service";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Mission Pilot action trace propagation", () => {
	it("stores visible assistant messages in the Pilot Thought channel", async () => {
		const appendMessage = vi
			.spyOn(nightworkersService, "appendAssistantTaskMessage")
			.mockResolvedValue({ id: "message-1" } as never);

		await executeMissionPilotAction(
			"task-1",
			"task.message.send",
			{ content: "ユーザーへ確認したいことがあります。" },
			{
				sessionId: "pilot-session",
				toolCallId: "tool-call-1",
				idempotencyKey: "pilot-session:tool-call-1",
				expectedTaskRevision: 1,
				sourceRunId: null,
			},
		);

		expect(appendMessage).toHaveBeenCalledWith(
			"task-1",
			"ユーザーへ確認したいことがあります。",
			expect.objectContaining({
				source: "mission_pilot",
				missionPilotSessionId: "pilot-session",
			}),
			{
				owner: "mission_pilot",
				channel: "pilot_thought",
				producer: {
					kind: "structured_llm",
					role: "mission_pilot",
				},
				orchestrationRef: {
					kind: "mission_pilot",
					sessionId: "pilot-session",
				},
			},
		);
	});

	it("keeps Questionnaire provider routing separate from Pilot Thought ownership", async () => {
		const signal = new AbortController().signal;
		const generateFollowUp = vi
			.spyOn(nightworkersService, "generateDesignQuestionnaireFollowUp")
			.mockResolvedValue({ id: "questionnaire-session" } as never);

		await executeMissionPilotAction(
			"task-1",
			"questionnaire.follow_up.generate",
			{ questionnaireSessionId: "questionnaire-session" },
			{
				sessionId: "pilot-session",
				toolCallId: "tool-call-1",
				idempotencyKey: "pilot-session:tool-call-1",
				expectedTaskRevision: 1,
				sourceRunId: null,
				signal,
			},
		);

		expect(generateFollowUp).toHaveBeenCalledWith(
			"task-1",
			"questionnaire-session",
			{
				signal,
				usageTrace: {
					owner: "mission_pilot",
					channel: "pilot_thought",
					producer: {
						kind: "structured_llm",
						role: "mission_pilot",
					},
					orchestrationRef: {
						kind: "mission_pilot",
						sessionId: "pilot-session",
					},
				},
			},
		);
	});
});
