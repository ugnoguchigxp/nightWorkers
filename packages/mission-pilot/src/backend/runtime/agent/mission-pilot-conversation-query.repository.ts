import { createHash } from "node:crypto";
import type { ProviderToolMessage } from "../../../services/structured-llm/public";
import { callMissionPilotPersistence } from "../../persistence-port";
import { toControlSummary } from "../../storage/repository";
import { publishMissionPilotUpdated } from "../mission-pilot-realtime";
import { clearMissionPilotAgentTaskActive } from "./mission-pilot-agent-active-registry";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";

export async function finishMissionPilotAgentTurn(input: {
	sessionId: string;
	turnId: string;
	leaseOwner: string;
	state: "waiting" | "attention" | "completed" | "stopped";
	error?: unknown;
}) {
	const updated = await callMissionPilotPersistence(
		"finishMissionPilotAgentTurn",
		input,
	);
	if (updated) {
		if (input.state === "completed")
			clearMissionPilotAgentTaskActive(updated.taskId);
		publishMissionPilotUpdated(updated.taskId, toControlSummary(updated));
	}
	return updated;
}

export function loadMissionPilotProviderMessages(
	sessionId: string,
): Promise<ProviderToolMessage[]> {
	return callMissionPilotPersistence(
		"loadMissionPilotProviderMessages",
		sessionId,
	);
}

const MAX_PROVIDER_CONVERSATION_BYTES = 48_000;
const MAX_PROVIDER_MESSAGE_BYTES = 12_000;

export function boundMissionPilotProviderConversation(
	messages: ProviderToolMessage[],
) {
	const system = messages.find((message) => message.role === "system");
	const selected: ProviderToolMessage[] = [];
	let bytes = system ? Buffer.byteLength(JSON.stringify(system), "utf8") : 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const source = messages[index];
		if (!source || source === system) continue;
		const message = boundProviderMessage(source);
		const nextBytes = Buffer.byteLength(JSON.stringify(message), "utf8");
		if (bytes + nextBytes > MAX_PROVIDER_CONVERSATION_BYTES) continue;
		selected.unshift(message);
		bytes += nextBytes;
	}
	return system ? [system, ...selected] : selected;
}

function boundProviderMessage(
	message: ProviderToolMessage,
): ProviderToolMessage {
	if (typeof message.content !== "string") return message;
	const originalBytes = Buffer.byteLength(message.content, "utf8");
	if (originalBytes <= MAX_PROVIDER_MESSAGE_BYTES) return message;
	const page = sliceMissionPilotUtf8Page(message.content, {
		maxBytes: 8_000,
		maxChars: 8_000,
	});
	return {
		...message,
		content: JSON.stringify({
			type: "bounded_conversation_receipt",
			contentPrefix: page.content,
			originalBytes,
			sourceDigest: digest(message.content),
			nextCursor: page.page.nextCursor,
		}),
	};
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function getMissionPilotConversationCheckpoint(sessionId: string) {
	return callMissionPilotPersistence(
		"getMissionPilotConversationCheckpoint",
		sessionId,
	);
}

export function listMissionPilotConversation(sessionId: string) {
	return callMissionPilotPersistence("listMissionPilotConversation", sessionId);
}

export function reconcileInterruptedMissionPilotAgentSessions(
	now = new Date(),
) {
	return callMissionPilotPersistence(
		"reconcileInterruptedMissionPilotAgentSessions",
		now,
	);
}
