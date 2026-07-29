import crypto from "node:crypto";
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

vi.mock(
	"../api/modules/missionPilot/mission-pilot-delegation",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../api/modules/missionPilot/mission-pilot-delegation")
		>()),
		missionPilotDelegatedAuthorizationPort: {
			authorize: vi.fn(async () => ({ capabilities: ["plan"] })),
		},
	}),
);

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

function delegatedPrincipal() {
	return {
		kind: "delegated_user" as const,
		actorId: "pilot-session",
		authorizationRef: "mission-pilot-delegation:pilot-session",
		subjectUserId: "local-task-operator-user",
		delegationRef: {
			sessionId: "pilot-session",
			taskId: "task-1",
			grantedAt: "2026-07-29T00:00:00.000Z",
			capabilityDigest: "test-capability-digest",
		},
	};
}

describe("Mission Pilot action trace propagation", () => {
	it("stores visible assistant messages in the Pilot Thought channel", async () => {
		const toolCallId = crypto.randomUUID();
		await executeMissionPilotAction(
			"task-1",
			"task.message.send",
			{
				content: "ユーザーへ確認したいことがあります。",
			},
			{
				sessionId: "pilot-session",
				toolCallId,
				idempotencyKey: `pilot-session:${toolCallId}`,
				expectedTaskRevision: 1,
				principal: delegatedPrincipal(),
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
		const questionnaireSessionId = crypto.randomUUID();
		const toolCallId = crypto.randomUUID();
		mocks.questionnaireBelongsToTask.mockResolvedValueOnce(true);
		mocks.generateFollowUp.mockResolvedValueOnce({
			id: questionnaireSessionId,
		});
		await executeMissionPilotAction(
			"task-1",
			"questionnaire.follow_up.generate",
			{
				questionnaireSessionId,
			},
			{
				sessionId: "pilot-session",
				toolCallId,
				idempotencyKey: `pilot-session:${toolCallId}`,
				expectedTaskRevision: 1,
				principal: delegatedPrincipal(),
				signal,
			},
		);

		expect(mocks.generateFollowUp).toHaveBeenCalledWith(
			"task-1",
			questionnaireSessionId,
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
