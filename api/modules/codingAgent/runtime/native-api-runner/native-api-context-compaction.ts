import type { NativeApiHistoryItem } from "./native-api-tool-history";

export type NativeApiBaselineCompactionResult = {
	history: NativeApiHistoryItem[];
	retainedHistoryItems: number;
	previousHistoryItems: number;
	reason: string;
};

export function compactNativeApiHistoryToBaseline(input: {
	baselineHistory: readonly NativeApiHistoryItem[];
	previousHistory: readonly NativeApiHistoryItem[];
	reason: string;
	todoSnapshotItem?: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	currentTodoItem?: Extract<NativeApiHistoryItem, { type: "user" }> | null;
	postImportHistoryItem?: Extract<
		NativeApiHistoryItem,
		{ type: "user" }
	> | null;
}): NativeApiBaselineCompactionResult {
	const history = [...input.baselineHistory];
	appendIfPresent(history, buildConversationSummary(input.previousHistory));
	appendIfPresent(history, input.todoSnapshotItem);
	appendIfPresent(history, input.currentTodoItem);
	appendIfPresent(history, input.postImportHistoryItem);
	return {
		history,
		retainedHistoryItems: history.length,
		previousHistoryItems: input.previousHistory.length,
		reason: input.reason,
	};
}

function buildConversationSummary(
	history: readonly NativeApiHistoryItem[],
): Extract<NativeApiHistoryItem, { type: "user" }> | null {
	const entries = history
		.filter((item) => item.type !== "system")
		.slice(-24)
		.map((item) => {
			if (item.type === "user") {
				return { type: "user", source: item.source, content: item.content };
			}
			if (item.type === "assistant") {
				return {
					type: "assistant",
					content: item.content,
					toolCalls: item.toolCalls?.map((call) => ({
						id: call.id,
						name: call.name,
					})),
				};
			}
			return {
				type: "tool_result",
				toolCallId: item.toolCallId,
				toolName: item.toolName,
				ok: item.result.ok,
				content: item.result.content,
			};
		});
	if (!entries.length) return null;
	return {
		type: "user",
		source: "runtime",
		content: [
			"[Conversation Summary Before Compaction]",
			JSON.stringify(entries).slice(0, 24_000),
		].join("\n"),
	};
}

function appendIfPresent(
	history: NativeApiHistoryItem[],
	item: Extract<NativeApiHistoryItem, { type: "user" }> | null | undefined,
) {
	if (!item) return;
	if (
		history.some(
			(existing) =>
				existing.type === "user" && existing.content === item.content,
		)
	) {
		return;
	}
	history.push(item);
}
