import { describe, expect, it } from "vitest";
import "./helpers/mission-pilot-runtime";
import {
	buildMissionPilotThoughtEntries,
	projectMissionPilotAgentVisibleItems,
} from "../packages/mission-pilot/src/backend/runtime/mission-pilot-thought-projection";

const at = (milliseconds = 0) =>
	new Date(Date.parse("2026-08-08T00:00:00.000Z") + milliseconds);

function conversation(
	id: string,
	kind: string,
	bodyJson: unknown,
	sequence = 1,
) {
	return {
		id,
		sessionId: "session-1",
		sequence,
		kind,
		turnId: "turn-1",
		toolCallId: null,
		bodyJson,
		sourceKind: null,
		sourceId: null,
		createdAt: at(sequence),
	};
}

function toolCall(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		sessionId: "session-1",
		turnId: "turn-1",
		providerCallId: `provider-${id}`,
		actionId: "unknown.action",
		argumentsJson: {},
		status: "succeeded" as const,
		idempotencyKey: `key-${id}`,
		expectedTaskRevision: null,
		resultJson: {},
		failureJson: null,
		startedAt: null,
		finishedAt: at(20),
		createdAt: at(10),
		updatedAt: at(20),
		...overrides,
	};
}

describe("Mission Pilot thought projection coverage", () => {
	it("projects every agent-visible item variant and tolerates malformed data", () => {
		const items = projectMissionPilotAgentVisibleItems([
			{
				kind: "assistant",
				sequence: 1,
				bodyJson: {
					content: "判断本文",
					toolCalls: [
						{
							name: "execute_task_action",
							arguments: { actionId: "task.update" },
						},
						{ name: "agent.finish", arguments: null },
						{ arguments: [] },
					],
				},
			},
			{ kind: "assistant", sequence: 2, bodyJson: { content: 4 } },
			{
				kind: "runtime_failure",
				sequence: 3,
				bodyJson: { failure: { message: "broken" } },
			},
			{ kind: "runtime_failure", sequence: 4, bodyJson: null },
			{
				kind: "compaction_summary",
				sequence: 5,
				bodyJson: { summary: "圧縮済み" },
			},
			{ kind: "compaction_summary", sequence: 6, bodyJson: [] },
			{
				kind: "tool_result",
				sequence: 7,
				bodyJson: {
					content: JSON.stringify({
						data: {
							kind: "wait_for_event",
							eventTypes: ["task.updated"],
							reason: "待機",
						},
					}),
				},
			},
			{
				kind: "tool_result",
				sequence: 8,
				bodyJson: {
					content: JSON.stringify({ data: { kind: "wait_for_event" } }),
				},
			},
			{
				kind: "tool_result",
				sequence: 9,
				bodyJson: {
					content: JSON.stringify({
						data: { kind: "finish", summary: "完了" },
					}),
				},
			},
			{
				kind: "tool_result",
				sequence: 10,
				bodyJson: { content: JSON.stringify({ data: { kind: "finish" } }) },
			},
			{
				kind: "tool_result",
				sequence: 11,
				bodyJson: {
					content: JSON.stringify({ ok: true, actionId: "task.update" }),
				},
			},
			{
				kind: "tool_result",
				sequence: 12,
				bodyJson: {
					content: JSON.stringify({ ok: false, failure: { message: "拒否" } }),
				},
			},
			{
				kind: "tool_result",
				sequence: 13,
				bodyJson: { content: JSON.stringify({ ok: false, failure: [] }) },
			},
			{ kind: "tool_result", sequence: 14, bodyJson: { content: "{" } },
			{ kind: "tool_result", sequence: 15, bodyJson: { content: 2 } },
			{ kind: "ignored", sequence: 16, bodyJson: {} },
		]);

		expect(items.map((item) => item.kind)).toEqual([
			"assistant",
			"action_requested",
			"action_requested",
			"action_requested",
			"runtime_error",
			"runtime_error",
			"context_compacted",
			"context_compacted",
			"wait",
			"wait",
			"finish",
			"finish",
			"action_result",
			"action_result",
			"action_result",
		]);
		expect(items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ actionId: "task.update" }),
				expect.objectContaining({ actionId: "agent.finish" }),
				expect.objectContaining({ actionId: "unknown_action" }),
				expect.objectContaining({ message: "Mission Pilot runtime failure" }),
				expect.objectContaining({
					summary: "Mission Pilot conversation contextを圧縮しました。",
				}),
				expect.objectContaining({ eventTypes: [], reason: "" }),
				expect.objectContaining({ status: "failed", summary: "拒否" }),
				expect.objectContaining({
					status: "failed",
					summary: "Mission Pilot actionが失敗しました。",
				}),
			]),
		);
	});

	it("maps activity, unmirrored messages, and conversation records", () => {
		const activityKinds = [
			"llm.usage",
			"llm.error",
			"tool.error",
			"system.error",
			"runtime.decision",
			"assistant.delta",
			"assistant.message",
			"assistant.raw_output",
			"llm.response_delta",
			"llm.response_final",
			"llm.decision_json",
			"llm.schema_result",
			"tool.call",
			"tool.result",
			"custom.event",
		];
		const entries = buildMissionPilotThoughtEntries({
			sessionId: "session-1",
			activityEvents: activityKinds.map((kind, index) => ({
				id: `event-${index}`,
				seq: index,
				kind,
				status: "succeeded" as const,
				text: index === 0 ? "  " : ` ${kind} `,
				payloadJson: index === 0 ? null : { index },
				externalId: index === 0 ? "mirrored" : null,
				createdAt: at(index),
			})),
			messages: [
				{
					id: "mirrored",
					content: "除外",
					messageType: "assistant",
					metadataJson: null,
					createdAt: at(30),
				},
				{
					id: "standalone",
					content: "独立メッセージ",
					messageType: "assistant",
					metadataJson: { source: "test" },
					createdAt: at(31),
				},
			],
			conversationItems: [
				conversation("assistant", "assistant", { content: "  thought  " }, 40),
				conversation("blank", "assistant", { content: "   " }, 41),
				conversation("non-string", "assistant", { content: 1 }, 42),
				conversation(
					"failure",
					"runtime_failure",
					{ failure: { message: "failure" } },
					43,
				),
				conversation("fallback", "runtime_failure", { failure: null }, 44),
				conversation(
					"compact",
					"compaction_summary",
					{ summary: "s", sourceDigest: "d", paging: { cursor: 1 } },
					45,
				),
				conversation("repair", "repair_request", { reason: "revise" }, 46),
				conversation("ignored", "task_event", {}, 47),
			],
			toolCalls: [],
		});

		expect(entries.some((entry) => entry.id === "task-message:mirrored")).toBe(
			false,
		);
		expect(entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "activity-event:event-0",
					kind: "llm_usage",
					summary: "llm.usage",
				}),
				expect.objectContaining({
					kind: "runtime_error",
					summary: "llm.error",
				}),
				expect.objectContaining({
					kind: "thought",
					summary: "runtime.decision",
				}),
				expect.objectContaining({
					kind: "action_requested",
					summary: "tool.call",
				}),
				expect.objectContaining({
					kind: "action_completed",
					summary: "tool.result",
				}),
				expect.objectContaining({
					kind: "state_changed",
					summary: "custom.event",
				}),
				expect.objectContaining({
					id: "task-message:standalone",
					summary: "独立メッセージ",
				}),
				expect.objectContaining({
					id: "conversation-item:assistant",
					summary: "thought",
				}),
				expect.objectContaining({
					id: "conversation-item:fallback",
					summary: "Mission Pilot runtime failure",
				}),
				expect.objectContaining({
					id: "conversation-item:compact",
					kind: "state_changed",
				}),
				expect.objectContaining({
					id: "conversation-item:repair",
					kind: "state_changed",
				}),
			]),
		);
		expect(entries.map((entry) => entry.sequence)).toEqual(
			entries.map((_, index) => index + 1),
		);
	});

	it("summarizes all tool completion states and safe result projections", () => {
		const calls = [
			toolCall("pending", { finishedAt: null }),
			toolCall("started", { startedAt: at(11), finishedAt: null }),
			toolCall("cancelled", { status: "cancelled", actionId: "task.update" }),
			toolCall("failed-message", {
				status: "failed",
				actionId: "task.update",
				failureJson: {
					kind: "conflict",
					message: "revision",
					providerCode: "P1",
					httpStatus: 409,
					retryable: false,
				},
			}),
			toolCall("failed-fallback", { status: "failed", failureJson: {} }),
			toolCall("wait", {
				actionId: "agent.wait_for_event",
				resultJson: { reason: "ignored without kind" },
			}),
			toolCall("wait-reason", {
				resultJson: {
					kind: "wait_for_event",
					reason: "event待ち",
					eventTypes: ["task.updated"],
				},
			}),
			toolCall("wait-fallback", {
				resultJson: { kind: "wait_for_event", reason: " " },
			}),
			toolCall("finish-action", { actionId: "agent.finish", resultJson: {} }),
			toolCall("finish-summary", {
				resultJson: { kind: "finish", summary: "finished" },
			}),
			toolCall("finish-fallback", {
				resultJson: { kind: "finish", summary: " " },
			}),
			toolCall("resource-other", {
				actionId: "read_task_resource",
				resultJson: { sourceRef: { kind: "plan" } },
			}),
			toolCall("resource-empty", {
				actionId: "read_task_resource",
				resultJson: {
					sourceRef: { kind: "questionnaire", id: "q" },
					cursor: 1.5,
					content: {},
				},
			}),
			toolCall("resource-page", {
				actionId: "read_task_resource",
				resultJson: {
					sourceRef: { kind: "questionnaire", id: "q" },
					cursor: 2,
					nextCursor: 4,
					content: { questions: [{}, {}] },
				},
			}),
			toolCall("submit-empty", {
				actionId: "questionnaire.submit",
				resultJson: { data: {} },
			}),
			toolCall("submit-status", {
				actionId: "questionnaire.submit",
				resultJson: { data: { id: "q", status: "done", answers: [{}, {}] } },
			}),
		];
		const entries = buildMissionPilotThoughtEntries({
			sessionId: "session-1",
			activityEvents: [],
			messages: [],
			conversationItems: [],
			toolCalls: calls as never,
		});
		const finished = entries.filter((entry) => entry.id.endsWith(":finished"));

		expect(finished).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "tool-call:cancelled:finished",
					kind: "action_failed",
					summary: expect.stringContaining("キャンセル"),
				}),
				expect.objectContaining({
					id: "tool-call:failed-message:finished",
					kind: "action_failed",
					summary: expect.stringContaining("revision"),
				}),
				expect.objectContaining({
					id: "tool-call:failed-fallback:finished",
					summary: expect.not.stringContaining("—"),
				}),
				expect.objectContaining({
					id: "tool-call:wait:finished",
					kind: "waiting",
					summary: expect.stringContaining("完了しました"),
				}),
				expect.objectContaining({
					id: "tool-call:wait-reason:finished",
					kind: "waiting",
					summary: "event待ち",
				}),
				expect.objectContaining({
					id: "tool-call:wait-fallback:finished",
					summary: "Mission PilotはTask eventを待機しています。",
				}),
				expect.objectContaining({
					id: "tool-call:finish-action:finished",
					kind: "finished",
					summary: expect.stringContaining("完了しました"),
				}),
				expect.objectContaining({
					id: "tool-call:finish-summary:finished",
					summary: "finished",
				}),
				expect.objectContaining({
					id: "tool-call:finish-fallback:finished",
					summary: "Mission Pilotが処理を完了しました。",
				}),
				expect.objectContaining({
					id: "tool-call:resource-empty:finished",
					summary: "Questionnaireを取得しました: 0 / 0件、全件取得済み",
				}),
				expect.objectContaining({
					id: "tool-call:resource-page:finished",
					summary: "Questionnaireを取得しました: 3〜4 / 2件、続きはcursor 4",
				}),
				expect.objectContaining({
					id: "tool-call:submit-empty:finished",
					summary: "Questionnaire回答0件を送信しました",
				}),
				expect.objectContaining({
					id: "tool-call:submit-status:finished",
					summary: "Questionnaire回答2件を送信しました（状態: done）",
				}),
			]),
		);
		expect(
			entries.filter((entry) => entry.id.startsWith("tool-call:pending")),
		).toHaveLength(1);
		expect(
			entries.filter((entry) => entry.id.startsWith("tool-call:started")),
		).toHaveLength(2);
		const failure = finished.find(
			(entry) => entry.id === "tool-call:failed-message:finished",
		);
		expect(failure?.details).toEqual(
			expect.objectContaining({
				failure: expect.objectContaining({ httpStatus: 409, retryable: false }),
			}),
		);
	});

	it("uses time, order hint, then id as stable ordering keys", () => {
		const entries = buildMissionPilotThoughtEntries({
			sessionId: "session-1",
			activityEvents: [
				{
					id: "z",
					seq: 1,
					kind: "custom",
					status: "pending",
					text: "z",
					payloadJson: null,
					externalId: null,
					createdAt: at(),
				},
				{
					id: "a",
					seq: 1,
					kind: "custom",
					status: "pending",
					text: "a",
					payloadJson: null,
					externalId: null,
					createdAt: at(),
				},
			],
			messages: [],
			conversationItems: [],
			toolCalls: [],
		});
		expect(entries.map((entry) => entry.id)).toEqual([
			"activity-event:a",
			"activity-event:z",
		]);
	});
});
