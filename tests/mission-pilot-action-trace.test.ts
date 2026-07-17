import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeMissionPilotAction } from "../api/modules/missionPilot/agent/mission-pilot-action-command-executor";

const mocks = vi.hoisted(() => ({
	appendMessage: vi.fn(),
	generateFollowUp: vi.fn(),
	questionnaireBelongsToTask: vi.fn(),
}));

vi.mock("../api/modules/task", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/modules/task")>()),
	sendTaskOperatorMessage: mocks.appendMessage,
}));

vi.mock("../api/modules/questionnaire", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/modules/questionnaire")>()),
	generateDesignQuestionnaireFollowUp: mocks.generateFollowUp,
	questionnaireSessionBelongsToTask: mocks.questionnaireBelongsToTask,
}));

vi.mock("../api/modules/taskOperator/application/task-operator.query", () => ({
	readTaskOperatorProjection: vi.fn(async () => ({
		task: { revision: 1, status: "planning" },
		questionnaire: { id: "questionnaire-session" },
		commandCatalog: {
			availableIds: ["task.message.send", "questionnaire.follow_up.generate"],
		},
	})),
}));

beforeEach(() => {
	mocks.appendMessage.mockReset().mockResolvedValue({ id: "message-1" });
	mocks.generateFollowUp
		.mockReset()
		.mockResolvedValue({ id: "questionnaire-session" });
	mocks.questionnaireBelongsToTask.mockReset().mockResolvedValue(true);
});

describe("Mission Pilot action trace propagation", () => {
	it("stores visible assistant messages in the Pilot Thought channel", async () => {
		await executeMissionPilotAction(
			"task-1",
			"task.message.send",
			{ content: "ユーザーへ確認したいことがあります。" },
			{
				sessionId: "pilot-session",
				toolCallId: "tool-call-2",
				idempotencyKey: "pilot-session:tool-call-2",
				expectedTaskRevision: 1,
				sourceRunId: null,
			},
		);

		expect(mocks.appendMessage).toHaveBeenCalledWith(
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

		expect(mocks.generateFollowUp).toHaveBeenCalledWith(
			"task-1",
			"questionnaire-session",
			expect.objectContaining({
				role: "mission_pilot",
				executionPolicy: expect.objectContaining({
					allowProviderTools: false,
					enableMcp: false,
					enableMemory: false,
					isolatedHome: true,
				}),
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
			}),
		);
	});
});
