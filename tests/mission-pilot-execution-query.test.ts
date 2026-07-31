import { describe, expect, it } from "vitest";
import "./helpers/mission-pilot-runtime";
import { buildMissionPilotThoughtEntries } from "@nightworkers/mission-pilot/testing";

describe("Mission Pilot execution query", () => {
	it("projects agent decisions and the complete tool lifecycle into one timeline", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			activityEvents: [],
			messages: [],
			conversationItems: [
				{
					id: "assistant-1",
					sessionId: "pilot-session",
					sequence: 1,
					kind: "assistant",
					turnId: "turn-1",
					toolCallId: null,
					bodyJson: {
						content: "Taskを更新して次の状態を確認します。",
						toolCalls: [
							{
								id: "provider-call-1",
								name: "execute_task_action",
								arguments: {
									actionId: "task.update",
									arguments: {
										secret: "not-for-presentation",
									},
								},
							},
						],
					},
					sourceKind: null,
					sourceId: null,
					createdAt: now,
				},
				{
					id: "failure-1",
					sessionId: "pilot-session",
					sequence: 2,
					kind: "runtime_failure",
					turnId: "turn-1",
					toolCallId: null,
					bodyJson: {
						failure: { message: "revision conflict" },
					},
					sourceKind: "runtime_failure",
					sourceId: "task.update",
					createdAt: new Date(now.getTime() + 3_000),
				},
			],
			toolCalls: [
				{
					id: "tool-1",
					sessionId: "pilot-session",
					turnId: "turn-1",
					providerCallId: "provider-call-1",
					actionId: "task.update",
					argumentsJson: { secret: "not-for-presentation" },
					status: "succeeded",
					idempotencyKey: "pilot-session:turn-1:provider-call-1",
					expectedTaskRevision: 1,
					resultJson: { taskId: "task-1" },
					failureJson: null,
					startedAt: new Date(now.getTime() + 1_000),
					finishedAt: new Date(now.getTime() + 2_000),
					createdAt: now,
					updatedAt: new Date(now.getTime() + 2_000),
				},
			],
		};

		const entries = buildMissionPilotThoughtEntries(input);

		expect(entries.map((entry) => entry.kind)).toEqual([
			"thought",
			"action_requested",
			"action_requested",
			"action_completed",
			"runtime_error",
		]);
		expect(entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5]);
		expect(JSON.stringify(entries)).not.toContain("not-for-presentation");
		expect(entries.at(-1)?.summary).toBe("revision conflict");
	});

	it("shows concrete Questionnaire read and submit progress", () => {
		const now = new Date("2026-07-30T06:24:19Z");
		const baseToolCall = {
			sessionId: "pilot-session",
			turnId: "turn-1",
			status: "succeeded",
			expectedTaskRevision: 1,
			failureJson: null,
			startedAt: now,
			finishedAt: now,
			createdAt: now,
			updatedAt: now,
		} as const;
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			activityEvents: [],
			messages: [],
			conversationItems: [],
			toolCalls: [
				{
					...baseToolCall,
					id: "read-questionnaire",
					providerCallId: "provider-read-questionnaire",
					actionId: "read_task_resource",
					argumentsJson: {
						resourceKind: "questionnaire",
						resourceId: "questionnaire-1",
					},
					idempotencyKey: "read-questionnaire",
					resultJson: {
						sourceRef: { kind: "questionnaire", id: "questionnaire-1" },
						cursor: 0,
						nextCursor: 14,
						hasMore: true,
						content: {
							totalQuestionCount: 15,
							questions: Array.from({ length: 14 }, (_, index) => ({
								id: `q${index + 1}`,
							})),
						},
					},
				},
				{
					...baseToolCall,
					id: "submit-questionnaire",
					providerCallId: "provider-submit-questionnaire",
					actionId: "questionnaire.submit",
					argumentsJson: {
						questionnaireSessionId: "questionnaire-1",
						answers: [],
					},
					idempotencyKey: "submit-questionnaire",
					resultJson: {
						data: {
							id: "questionnaire-1",
							status: "review_ready",
							answers: Array.from({ length: 15 }, (_, index) => ({
								questionId: `q${index + 1}`,
							})),
						},
					},
				},
			],
		};

		const completions = buildMissionPilotThoughtEntries(input).filter(
			(entry) => entry.kind === "action_completed",
		);

		expect(completions).toEqual([
			expect.objectContaining({
				summary: "Questionnaireを取得しました: 1〜14 / 15件、続きはcursor 14",
				details: expect.objectContaining({
					result: {
						resourceKind: "questionnaire",
						resourceId: "questionnaire-1",
						cursor: 0,
						nextCursor: 14,
						hasMore: true,
						questionCount: 14,
						totalQuestionCount: 15,
					},
				}),
			}),
			expect.objectContaining({
				summary: "Questionnaire回答15件を送信しました（状態: review_ready）",
				details: expect.objectContaining({
					result: {
						questionnaireSessionId: "questionnaire-1",
						questionnaireStatus: "review_ready",
						answerCount: 15,
					},
				}),
			}),
		]);
	});

	it("classifies persisted Mission Pilot assistant messages as thoughts", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			messages: [],
			conversationItems: [],
			toolCalls: [],
			activityEvents: [
				{
					id: "assistant-activity",
					taskId: "task-1",
					runId: null,
					turnId: null,
					parentEventId: null,
					seq: 1,
					runSeq: null,
					kind: "assistant.message",
					source: "mission_pilot",
					status: "completed",
					text: "Mission Pilotの判断本文",
					payloadJson: null,
					artifactId: null,
					clientTempId: null,
					externalId: null,
					dedupeKey: null,
					ingestError: null,
					visibility: "visible",
					traceOwner: "mission_pilot",
					traceChannel: "pilot_thought",
					createdAt: now,
				},
			],
		};

		expect(buildMissionPilotThoughtEntries(input)).toEqual([
			expect.objectContaining({
				kind: "thought",
				summary: "Mission Pilotの判断本文",
			}),
		]);
	});

	it("does not re-project consumed Coding Agent run input", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			activityEvents: [],
			messages: [],
			conversationItems: [
				{
					id: "task-event-input",
					sessionId: "pilot-session",
					sequence: 1,
					kind: "task_event",
					turnId: "turn-1",
					toolCallId: null,
					bodyJson: {
						events: [
							{
								eventType: "task_run.failed",
								payload: { finalReport: "Coding Agent output" },
							},
						],
					},
					sourceKind: "task_event_batch",
					sourceId: "1:1",
					createdAt: now,
				},
			],
			toolCalls: [],
		};

		expect(buildMissionPilotThoughtEntries(input)).toEqual([]);
	});
});
