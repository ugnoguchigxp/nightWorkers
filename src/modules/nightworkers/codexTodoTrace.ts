import type { TaskEvent } from "./types";

export type CodexTodoTraceItem = {
	id: string;
	seq: number;
	title: string;
	completed: boolean;
};

export function projectLatestCodexTodoTrace(
	events: TaskEvent[],
): CodexTodoTraceItem[] {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		const payload = readRecord(event.payloadJson) ?? {};
		const runEvent = readRecord(payload.runEvent);
		const data =
			readRecord(runEvent?.data) ?? readRecord(payload.payload) ?? payload;
		if (
			data.provider !== "codex" ||
			data.providerItemType !== "todo_list" ||
			data.toolName !== "codex.update_plan" ||
			!Array.isArray(data.items)
		) {
			continue;
		}
		return data.items.flatMap((value, itemIndex) => {
			const item = readRecord(value) ?? {};
			const title = typeof item.text === "string" ? item.text.trim() : "";
			if (!title) return [];
			return [
				{
					id: `${String(data.providerItemId || event.id)}:${itemIndex}`,
					seq: itemIndex + 1,
					title,
					completed: item.completed === true,
				},
			];
		});
	}
	return [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
