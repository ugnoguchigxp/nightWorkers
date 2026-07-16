import {
	type PilotThoughtEntry,
	type PilotThoughtEntryKind,
	pilotThoughtEntriesSchema,
} from "../../../shared/schemas/mission-pilot-thought.schema";
import type {
	missionPilotConversationItems,
	missionPilotToolCalls,
} from "../../db/mission-pilot-agent-schema";
import type { missionPilotEvents } from "../../db/mission-pilot-schema";
import type { activityEvents, taskMessages } from "../../db/schema";
import { getMissionPilotActionDefinition } from "./agent/mission-pilot-task-action.registry";

export type MissionPilotAgentVisibleItem =
	| { kind: "assistant"; sequence: number; content: string }
	| { kind: "action_requested"; sequence: number; actionId: string }
	| {
			kind: "action_result";
			sequence: number;
			actionId: string;
			status: "succeeded" | "failed";
			summary: string;
	  }
	| { kind: "runtime_error"; sequence: number; message: string }
	| { kind: "context_compacted"; sequence: number; summary: string }
	| {
			kind: "wait";
			sequence: number;
			eventTypes: unknown[];
			reason: string;
	  }
	| { kind: "finish"; sequence: number; summary: string };

export function projectMissionPilotAgentVisibleItems(
	items: ReadonlyArray<{ kind: string; sequence: number; bodyJson: unknown }>,
): MissionPilotAgentVisibleItem[] {
	const projected: MissionPilotAgentVisibleItem[] = [];
	for (const item of items) {
		const body = asRecord(item.bodyJson);
		if (item.kind === "assistant") {
			const content = typeof body.content === "string" ? body.content : "";
			if (content)
				projected.push({ kind: "assistant", sequence: item.sequence, content });
			for (const toolCall of Array.isArray(body.toolCalls)
				? body.toolCalls
				: []) {
				const call = asRecord(toolCall);
				projected.push({
					kind: "action_requested",
					sequence: item.sequence,
					actionId:
						typeof call.name === "string" ? call.name : "unknown_action",
				});
			}
			continue;
		}
		if (item.kind === "runtime_failure") {
			const failure = asRecord(body.failure);
			projected.push({
				kind: "runtime_error",
				sequence: item.sequence,
				message:
					typeof failure.message === "string"
						? failure.message
						: "Mission Pilot runtime failure",
			});
			continue;
		}
		if (item.kind === "compaction_summary") {
			projected.push({
				kind: "context_compacted",
				sequence: item.sequence,
				summary:
					typeof body.summary === "string"
						? body.summary
						: "Mission Pilot conversation contextを圧縮しました。",
			});
			continue;
		}
		if (item.kind !== "tool_result" || typeof body.content !== "string")
			continue;
		projectVisibleToolResult(projected, item.sequence, body.content);
	}
	return projected;
}

function projectVisibleToolResult(
	projected: MissionPilotAgentVisibleItem[],
	sequence: number,
	content: string,
) {
	try {
		const result = asRecord(JSON.parse(content));
		const data = asRecord(result.data);
		if (data.kind === "wait_for_event") {
			projected.push({
				kind: "wait",
				sequence,
				eventTypes: Array.isArray(data.eventTypes) ? data.eventTypes : [],
				reason: typeof data.reason === "string" ? data.reason : "",
			});
			return;
		}
		if (data.kind === "finish") {
			projected.push({
				kind: "finish",
				sequence,
				summary: typeof data.summary === "string" ? data.summary : "",
			});
			return;
		}
		const failure = asRecord(result.failure);
		projected.push({
			kind: "action_result",
			sequence,
			actionId:
				typeof result.actionId === "string"
					? result.actionId
					: "unknown_action",
			status: result.ok === true ? "succeeded" : "failed",
			summary:
				result.ok === true
					? "Mission Pilot actionが完了しました。"
					: typeof failure.message === "string"
						? failure.message
						: "Mission Pilot actionが失敗しました。",
		});
	} catch {}
}

type ThoughtProjectionInput = {
	sessionId: string;
	events: ReadonlyArray<typeof missionPilotEvents.$inferSelect>;
	activityEvents: ReadonlyArray<typeof activityEvents.$inferSelect>;
	messages: ReadonlyArray<typeof taskMessages.$inferSelect>;
	conversationItems: ReadonlyArray<
		typeof missionPilotConversationItems.$inferSelect
	>;
	toolCalls: ReadonlyArray<typeof missionPilotToolCalls.$inferSelect>;
};

type OrderedPilotThoughtEntry = PilotThoughtEntry & { orderHint: number };

export function buildMissionPilotThoughtEntries(
	input: ThoughtProjectionInput,
): PilotThoughtEntry[] {
	const entries = [
		...input.events.map((event) =>
			projectCoordinatorEvent(input.sessionId, event),
		),
		...input.activityEvents.map((event) =>
			projectActivityEvent(input.sessionId, event),
		),
		...projectUnmirroredMessages(input),
		...input.conversationItems.flatMap((item) => {
			const projected = projectConversationItem(input.sessionId, item);
			return projected ? [projected] : [];
		}),
		...input.toolCalls.flatMap((call) =>
			projectToolCallLifecycle(input.sessionId, call),
		),
	];
	return pilotThoughtEntriesSchema.parse(
		entries
			.sort(compareOrderedPilotThoughtEntries)
			.map(({ orderHint: _, ...entry }, index) => ({
				...entry,
				sequence: index + 1,
			})),
	);
}

function projectCoordinatorEvent(
	sessionId: string,
	event: typeof missionPilotEvents.$inferSelect,
): OrderedPilotThoughtEntry {
	return {
		id: `mission-pilot-event:${event.id}`,
		sessionId,
		sequence: 0,
		occurredAt: event.createdAt,
		kind: "state_changed",
		summary: event.eventType,
		details: compactDetails({
			phase: event.phase,
			cycle: event.cycle,
			contextRevision: event.contextRevision,
			sourceKind: event.sourceKind,
			sourceId: event.sourceId,
			processStatus: event.processStatus,
			attemptCount: event.attemptCount,
			lastError: event.lastError,
			payload: event.payloadJson,
		}),
		sourceRef: { kind: "mission_pilot_event", id: event.id },
		orderHint: 100,
	};
}

function projectActivityEvent(
	sessionId: string,
	event: typeof activityEvents.$inferSelect,
): OrderedPilotThoughtEntry {
	return {
		id: `activity-event:${event.id}`,
		sessionId,
		sequence: 0,
		occurredAt: event.createdAt,
		kind: activityEntryKind(event.kind),
		summary: event.text?.trim() || event.kind,
		details: compactDetails({
			activityKind: event.kind,
			status: event.status,
			payload: event.payloadJson,
		}),
		sourceRef: { kind: "activity_event", id: event.id },
		orderHint: 200 + event.seq,
	};
}

function projectUnmirroredMessages(
	input: ThoughtProjectionInput,
): OrderedPilotThoughtEntry[] {
	const mirroredMessageIds = new Set(
		input.activityEvents
			.map((event) => event.externalId)
			.filter((value): value is string => typeof value === "string"),
	);
	return input.messages
		.filter((message) => !mirroredMessageIds.has(message.id))
		.map((message) => ({
			id: `task-message:${message.id}`,
			sessionId: input.sessionId,
			sequence: 0,
			occurredAt: message.createdAt,
			kind: "thought" as const,
			summary: message.content,
			details: compactDetails({
				messageType: message.messageType,
				metadata: message.metadataJson,
			}),
			sourceRef: { kind: "task_message", id: message.id },
			orderHint: 300,
		}));
}

function projectConversationItem(
	sessionId: string,
	item: typeof missionPilotConversationItems.$inferSelect,
): OrderedPilotThoughtEntry | null {
	const body = asRecord(item.bodyJson);
	if (item.kind === "assistant") {
		const content = typeof body.content === "string" ? body.content.trim() : "";
		return content
			? conversationEntry(sessionId, item, "thought", content, {
					turnId: item.turnId,
				})
			: null;
	}
	if (item.kind === "runtime_failure") {
		const failure = asRecord(body.failure);
		return conversationEntry(
			sessionId,
			item,
			"runtime_error",
			typeof failure.message === "string"
				? failure.message
				: "Mission Pilot runtime failure",
			{ failure },
		);
	}
	if (item.kind === "compaction_summary")
		return conversationEntry(
			sessionId,
			item,
			"state_changed",
			"Mission Pilot conversation contextを圧縮しました。",
			{
				summary: body.summary,
				sourceDigest: body.sourceDigest,
				paging: body.paging,
			},
		);
	if (item.kind === "repair_request")
		return conversationEntry(
			sessionId,
			item,
			"state_changed",
			"Mission Pilotの修正要求を記録しました。",
			{ request: body },
		);
	if (item.kind === "task_event" || item.kind === "run_outcome")
		return conversationEntry(
			sessionId,
			item,
			"state_changed",
			item.kind === "task_event"
				? "Mission PilotがTask eventを取り込みました。"
				: "Mission PilotがRun結果を取り込みました。",
			{ payload: body },
		);
	return null;
}

function conversationEntry(
	sessionId: string,
	item: typeof missionPilotConversationItems.$inferSelect,
	kind: PilotThoughtEntryKind,
	summary: string,
	details: Record<string, unknown>,
): OrderedPilotThoughtEntry {
	return {
		id: `conversation-item:${item.id}`,
		sessionId,
		sequence: 0,
		occurredAt: item.createdAt,
		kind,
		summary,
		details: compactDetails(details),
		sourceRef: { kind: "mission_pilot_conversation_item", id: item.id },
		orderHint: 1_000 + item.sequence,
	};
}

function projectToolCallLifecycle(
	sessionId: string,
	call: typeof missionPilotToolCalls.$inferSelect,
): OrderedPilotThoughtEntry[] {
	const title =
		getMissionPilotActionDefinition(call.actionId)?.title ?? call.actionId;
	const details = compactDetails({
		actionId: call.actionId,
		turnId: call.turnId,
		expectedTaskRevision: call.expectedTaskRevision,
	});
	const entries: OrderedPilotThoughtEntry[] = [
		toolEntry(call, sessionId, "requested", {
			occurredAt: call.createdAt,
			kind: "action_requested",
			status: "pending",
			summary: `Actionを要求しました: ${title}`,
			details,
			orderHint: 2_000,
		}),
	];
	if (call.startedAt)
		entries.push(
			toolEntry(call, sessionId, "started", {
				occurredAt: call.startedAt,
				kind: "action_requested",
				status: "running",
				summary: `実行しています: ${title}`,
				details,
				orderHint: 2_001,
			}),
		);
	if (call.finishedAt) {
		const result = asRecord(call.resultJson);
		const failure = asRecord(call.failureJson);
		entries.push(
			toolEntry(call, sessionId, "finished", {
				occurredAt: call.finishedAt,
				kind: toolCompletionKind(call.actionId, call.status, result),
				status: call.status,
				summary: toolCompletionSummary(title, call.status, result, failure),
				details: compactDetails({
					actionId: call.actionId,
					turnId: call.turnId,
					expectedTaskRevision: call.expectedTaskRevision,
					result: safeControlResult(result),
					failure: safeFailure(failure),
				}),
				orderHint:
					call.status === "failed" || call.status === "cancelled"
						? 2_003
						: 2_002,
			}),
		);
	}
	return entries;
}

function toolEntry(
	call: typeof missionPilotToolCalls.$inferSelect,
	sessionId: string,
	stage: string,
	input: Omit<
		OrderedPilotThoughtEntry,
		"id" | "sessionId" | "sequence" | "sourceRef"
	>,
): OrderedPilotThoughtEntry {
	return {
		id: `tool-call:${call.id}:${stage}`,
		sessionId,
		sequence: 0,
		sourceRef: { kind: "mission_pilot_tool_call", id: call.id },
		...input,
	};
}

function toolCompletionKind(
	actionId: string,
	status: string,
	result: Record<string, unknown>,
): PilotThoughtEntryKind {
	if (status === "failed" || status === "cancelled") return "action_failed";
	if (actionId === "agent.wait_for_event" || result.kind === "wait_for_event")
		return "waiting";
	if (actionId === "agent.finish" || result.kind === "finish")
		return "finished";
	return "action_completed";
}

function toolCompletionSummary(
	title: string,
	status: string,
	result: Record<string, unknown>,
	failure: Record<string, unknown>,
) {
	if (status === "cancelled") return `キャンセルしました: ${title}`;
	if (status === "failed")
		return typeof failure.message === "string"
			? `失敗しました: ${title} — ${failure.message}`
			: `失敗しました: ${title}`;
	if (result.kind === "wait_for_event")
		return typeof result.reason === "string" && result.reason.trim()
			? result.reason
			: "Mission PilotはTask eventを待機しています。";
	if (result.kind === "finish")
		return typeof result.summary === "string" && result.summary.trim()
			? result.summary
			: "Mission Pilotが処理を完了しました。";
	return `完了しました: ${title}`;
}

function safeControlResult(result: Record<string, unknown>) {
	return compactDetails({
		kind: result.kind,
		reason: result.reason,
		summary: result.summary,
		eventTypes: result.eventTypes,
	});
}

function safeFailure(failure: Record<string, unknown>) {
	return compactDetails({
		kind: failure.kind,
		message: failure.message,
		providerCode: failure.providerCode,
		httpStatus: failure.httpStatus,
		retryable: failure.retryable,
	});
}

function activityEntryKind(kind: string): PilotThoughtEntryKind {
	if (kind === "llm.usage") return "llm_usage";
	if (kind === "llm.error" || kind === "tool.error" || kind === "system.error")
		return "runtime_error";
	if (
		kind === "runtime.decision" ||
		kind === "assistant.delta" ||
		kind === "assistant.message" ||
		kind === "assistant.raw_output" ||
		kind === "llm.response_delta" ||
		kind === "llm.response_final" ||
		kind === "llm.decision_json" ||
		kind === "llm.schema_result"
	)
		return "thought";
	if (kind === "tool.call") return "action_requested";
	if (kind === "tool.result") return "action_completed";
	return "state_changed";
}

function compareOrderedPilotThoughtEntries(
	a: OrderedPilotThoughtEntry,
	b: OrderedPilotThoughtEntry,
) {
	const timeDifference =
		new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
	if (timeDifference !== 0) return timeDifference;
	const orderDifference = a.orderHint - b.orderHint;
	return orderDifference !== 0 ? orderDifference : a.id.localeCompare(b.id);
}

function compactDetails(
	value: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const entries = Object.entries(value).filter(
		([, entry]) => entry !== undefined && entry !== null,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
