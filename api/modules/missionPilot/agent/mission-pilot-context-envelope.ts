import type {
	ProviderToolDefinition,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import {
	missionPilotDigest,
	sliceMissionPilotUtf8Page,
} from "./mission-pilot-content-page";

const MAX_PROJECTED_BYTES = 16_000;
export function projectMissionPilotProviderMessages(
	messages: ProviderToolMessage[],
	maxBytes = MAX_PROJECTED_BYTES,
) {
	return messages.map((message) => {
		if (message.role !== "tool" || typeof message.content !== "string")
			return message;
		const bytes = Buffer.byteLength(message.content, "utf8");
		if (bytes <= maxBytes) return message;
		const page = sliceMissionPilotUtf8Page(message.content, {
			maxBytes,
			maxChars: maxBytes,
		});
		return {
			...message,
			content: JSON.stringify({
				truncated: true,
				contentPrefix: page.content,
				originalChars: message.content.length,
				originalBytes: bytes,
				digest: missionPilotDigest(message.content),
				nextCursor: page.page.nextCursor,
			}),
		};
	});
}
export function estimateMissionPilotProviderRequestTokens(input: {
	systemContext: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
}) {
	return (
		Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / 4) + 2_000
	);
}
export function boundMissionPilotCompactionInput(
	messages: ProviderToolMessage[],
	maxBytes = 64_000,
) {
	if (Buffer.byteLength(JSON.stringify(messages), "utf8") <= maxBytes)
		return [...messages];
	const first = messages[0] ?? { role: "user" as const, content: "" };
	const initialUser = messages.find((message) => message.role === "user");
	const last = messages.at(-1) ?? first;
	const keptIndexes = new Set(
		[first, initialUser, last]
			.filter((message): message is ProviderToolMessage => Boolean(message))
			.map((message) => messages.indexOf(message)),
	);
	const omittedIndexes = messages.flatMap((_, index) =>
		keptIndexes.has(index) ? [] : [index],
	);
	const notice: ProviderToolMessage = {
		role: "user",
		content: JSON.stringify({
			type: "compaction_input_page",
			message:
				"compaction入力上限のため中間conversationを省略しました。正本は改変されていません。見えているユーザー依頼、採用済み判断、実行済みaction、未解決事項、正本参照を維持してください。",
			canonicalDigest: missionPilotDigest(JSON.stringify(messages)),
			omittedMessageIndexes: {
				from: omittedIndexes[0] ?? null,
				to: omittedIndexes.at(-1) ?? null,
				count: omittedIndexes.length,
			},
		}),
	};
	const bounded: ProviderToolMessage[] = [
		first,
		...(initialUser && initialUser !== first ? [initialUser] : []),
		notice,
		...(last !== first && last !== initialUser ? [last] : []),
	];
	if (Buffer.byteLength(JSON.stringify(bounded), "utf8") <= maxBytes)
		return bounded;
	const essential = [first, notice, ...(last !== first ? [last] : [])];
	const perMessageBytes = Math.max(
		1,
		Math.floor(maxBytes / Math.max(1, essential.length)),
	);
	return essential.map((message) => {
		if (message === notice) return message;
		if (typeof message.content !== "string") return message;
		const page = sliceMissionPilotUtf8Page(message.content, {
			maxBytes: perMessageBytes,
			maxChars: perMessageBytes,
		});
		return { ...message, content: page.content };
	});
}
