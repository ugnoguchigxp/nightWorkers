import { isCodingAgentChatTrace } from "../codingAgent";
import type { TaskMessage } from "./types";

const terminalWorkbenchIntakeMessageIntents = new Set([
	"coding_agent_run_blocked",
	"design_questionnaire_ready",
	"intake_failed",
	"plan_mode_run_blocked",
]);

export function isWorkbenchIntakeTerminalMessage(message: TaskMessage) {
	if (message.role !== "system") return false;
	const metadata =
		message.metadataJson &&
		typeof message.metadataJson === "object" &&
		!Array.isArray(message.metadataJson)
			? (message.metadataJson as Record<string, unknown>)
			: {};
	return (
		metadata.source === "workbench" &&
		terminalWorkbenchIntakeMessageIntents.has(String(metadata.intent ?? ""))
	);
}

export function shouldCompletePendingChat(input: {
	message: TaskMessage;
	pendingTaskId: string | null;
	pendingRunId: string | null;
}) {
	const { message } = input;
	if (input.pendingTaskId && message.taskId !== input.pendingTaskId)
		return false;
	if (isWorkbenchIntakeTerminalMessage(message)) return true;
	return (
		message.role === "assistant" &&
		isCodingAgentChatTrace(message) &&
		(!input.pendingRunId || message.runId === input.pendingRunId)
	);
}
