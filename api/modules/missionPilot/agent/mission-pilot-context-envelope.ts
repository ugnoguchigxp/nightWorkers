import crypto from "node:crypto";
import type {
	ProviderToolDefinition,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";

export const MISSION_PILOT_CONTEXT_SOFT_TOKENS = 80_000;
export const MISSION_PILOT_CONTEXT_HARD_TOKENS = 110_000;
export const MISSION_PILOT_RESERVED_OUTPUT_TOKENS = 8_000;
const MAX_PROJECTED_MESSAGE_BYTES = 24_000;

export function projectMissionPilotProviderMessages(
	messages: ProviderToolMessage[],
): ProviderToolMessage[] {
	return messages.map((message) => {
		if (typeof message.content !== "string") return message;
		const originalBytes = Buffer.byteLength(message.content, "utf8");
		if (originalBytes <= MAX_PROJECTED_MESSAGE_BYTES) return message;
		const page = sliceMissionPilotUtf8Page(message.content, {
			maxChars: message.content.length,
			maxBytes: MAX_PROJECTED_MESSAGE_BYTES,
		});
		const projected = JSON.stringify({
			truncated: true,
			digest: `sha256:${crypto.createHash("sha256").update(message.content).digest("hex")}`,
			originalChars: message.content.length,
			originalBytes,
			contentPrefix: page.content,
			nextCursor: page.page.nextCursor,
			note: "完全な本文は永続化済みです。Task・Artifact・Run の正本は対応する read tool で再取得してください。nextCursor は監査用本文内の文字位置です。",
		});
		return { ...message, content: projected } as ProviderToolMessage;
	});
}

export function estimateMissionPilotProviderRequestTokens(input: {
	systemContext: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	reservedOutputTokens?: number;
}) {
	const requestBytes = Buffer.byteLength(
		input.systemContext +
			JSON.stringify(input.messages) +
			JSON.stringify(input.tools),
		"utf8",
	);
	return (
		requestBytes +
		(input.reservedOutputTokens ?? MISSION_PILOT_RESERVED_OUTPUT_TOKENS)
	);
}

export function boundMissionPilotCompactionInput(
	messages: ProviderToolMessage[],
	maxBytes = MISSION_PILOT_CONTEXT_HARD_TOKENS -
		MISSION_PILOT_RESERVED_OUTPUT_TOKENS -
		2_000,
) {
	const budget = Number.isFinite(maxBytes)
		? Math.max(2, Math.floor(maxBytes))
		: MISSION_PILOT_CONTEXT_HARD_TOKENS -
			MISSION_PILOT_RESERVED_OUTPUT_TOKENS -
			2_000;
	if (messages.length === 0) return [];

	const selected = new Map<number, ProviderToolMessage>();
	const first = messages[0];
	if (first && serializedBytes([first]) <= budget) selected.set(0, first);

	for (let index = messages.length - 1; index >= 1; index--) {
		const message = messages[index];
		if (!message) continue;
		const candidate = new Map(selected);
		candidate.set(index, message);
		if (
			serializedBytes(withOmissionMarker(candidate, messages.length)) <= budget
		)
			selected.set(index, message);
	}

	let bounded = withOmissionMarker(selected, messages.length);
	while (bounded.length > 0 && serializedBytes(bounded) > budget) {
		const removable = [...selected.keys()].find((index) => index !== 0);
		if (removable === undefined) {
			if (!selected.delete(0)) return [];
		} else selected.delete(removable);
		bounded = withOmissionMarker(selected, messages.length);
	}
	return bounded;
}

function withOmissionMarker(
	selected: Map<number, ProviderToolMessage>,
	totalMessages: number,
) {
	const ordered = [...selected.entries()].sort(
		([left], [right]) => left - right,
	);
	const omitted = totalMessages - ordered.length;
	if (omitted === 0) return ordered.map(([, message]) => message);
	const marker: ProviderToolMessage = {
		role: "user",
		content: `Context envelope notice: ${omitted} 件の中間メッセージを圧縮入力から省略しました。Task・Artifact・Run の正本は read tool で再確認してください。`,
	};
	const messages = ordered.map(([, message]) => message);
	messages.splice(selected.has(0) ? 1 : 0, 0, marker);
	return messages;
}

function serializedBytes(messages: ProviderToolMessage[]) {
	return Buffer.byteLength(JSON.stringify(messages), "utf8");
}
