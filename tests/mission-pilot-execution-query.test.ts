import { describe, expect, it } from "vitest";
import {
	attachArtifactCorrectionRequests,
	buildMissionPilotThoughtEntries,
} from "../api/modules/missionPilot/mission-pilot-execution-query.service";

describe("Mission Pilot execution query", () => {
	it("backfills persisted correction instructions into existing activity events", () => {
		const [event] = attachArtifactCorrectionRequests(
			[
				{
					id: "activity-1",
					payloadJson: {
						correctionRunId: "correction-run-1",
						target: "feature_plan",
					},
				},
			],
			[
				{
					id: "correction-run-1",
					target: "feature_plan",
					focusJson: { kind: "artifact" },
					instruction:
						"HTTP APIの入力・出力・エラー検証はapi_io_contractを正本として扱ってください。",
					preserveUnfocusedContent: true,
				},
			],
		);

		expect(event?.payloadJson).toMatchObject({
			correctionRunId: "correction-run-1",
			correctionRequest: {
				target: "feature_plan",
				focus: { kind: "artifact" },
				instruction:
					"HTTP APIの入力・出力・エラー検証はapi_io_contractを正本として扱ってください。",
				preserveUnfocusedContent: true,
			},
		});
	});

	it("keeps an event payload unchanged when no correction run matches", () => {
		const original = {
			id: "activity-2",
			payloadJson: { correctionRunId: "missing-run" },
		};
		const [event] = attachArtifactCorrectionRequests([original], []);

		expect(event).toBe(original);
	});

	it("projects agent decisions and the complete tool lifecycle into one timeline", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			events: [],
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
								name: "task_update",
								arguments: { secret: "not-for-presentation" },
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

	it("classifies persisted Mission Pilot assistant messages as thoughts", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			events: [],
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

	it("does not re-project Coding Agent run events or consumed run input", () => {
		const now = new Date("2026-07-16T00:00:00Z");
		const input: Parameters<typeof buildMissionPilotThoughtEntries>[0] = {
			sessionId: "pilot-session",
			events: [
				{
					id: "run-event",
					sessionId: "pilot-session",
					eventType: "implementation.completed",
					phase: "test_preparing",
					cycle: 1,
					contextRevision: 2,
					sourceKind: "task_run",
					sourceId: "run-1",
					payloadJson: { finalReport: "Coding Agent output" },
					processStatus: "processed",
					attemptCount: 0,
					lastError: null,
					nextAttemptAt: null,
					processedAt: now,
					createdAt: now,
					updatedAt: now,
				},
			],
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
