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
