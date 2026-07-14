import type { TaskMessage } from "./types";

export function isWorkspaceOnlyTaskMessage(message: TaskMessage): boolean {
	const intent = (message.metadataJson as Record<string, unknown>)?.intent;
	return intent === "feature_plan";
}

export function isUserVisibleChatMessage(message: TaskMessage): boolean {
	if (message.traceChannel !== "chat") return false;
	if (message.role !== "user" && message.role !== "assistant") return false;
	const intent = (message.metadataJson as Record<string, unknown>)?.intent;
	return (
		intent !== "blueprint_raw_output" &&
		intent !== "data_model_raw_output" &&
		!isWorkspaceOnlyTaskMessage(message)
	);
}
